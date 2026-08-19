// 云函数：pay-notify —— 对应云开发 cloudPay 统一支付回调
// 触发：当用户支付成功后，微信会调用 cloudPay.unifiedOrder 时传入的 functionName（pay-notify）
// 本函数职责（单一）：
//   1) 校验支付回调确实成功（resultCode === 'SUCCESS'）
//   2) 按 outTradeNo（即我们的订单号）把 orders 集合中对应订单状态改为 'paid'
//   3) 把 plan + paid_until 写回当日 usage_daily 文档，实现"解锁"
// 错误处理：任何环节失败都抛错并返回 FAIL 给微信，微信会按官方文档的策略重试；
// 我们不静默兜底，避免"用户付了钱但没解锁"。

const cloud = require('wx-server-sdk');
const { today, addDays, PLAN_TO_META, getEnvInt } = require('../shared/utils');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// addDays 已统一到 shared/utils.js：与 today() 共用 pad() 与时区换算逻辑，
// 保证 paid_until 字符串格式与 isPaidActive 的字符串比较严格一致。

exports.main = async (event) => {
  // cloudPay 回调的标准形状（来自 wx-server-sdk cloudPay）
  const { outTradeNo, resultCode, appid, subMchId, transactionId, timeEnd, totalFee } =
    event || {};

  // 1) 必须有 outTradeNo
  if (!outTradeNo || typeof outTradeNo !== 'string') {
    // 无法定位订单 → 返回 FAIL，微信会稍后重试
    throw new Error('[pay-notify] 缺少 outTradeNo');
  }

  // 2) 非成功不处理，直接返回 SUCCESS 即可（避免重复回调）；但也要明确不解锁
  if (resultCode !== 'SUCCESS') {
    return { errcode: 0, errmsg: 'OK', handled: false, reason: 'resultCode!=SUCCESS' };
  }

  const db = cloud.database();
  const ordersCol = db.collection('orders');
  const usageCol = db.collection('usage_daily');

  // 3) 按 outTradeNo 查到订单
  const orderGet = await ordersCol
    .where({ orderId: outTradeNo })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  const order = orderGet.data && orderGet.data[0];
  if (!order) {
    throw new Error(`[pay-notify] 订单不存在: outTradeNo=${outTradeNo}`);
  }
  if (order.status === 'paid') {
    // 幂等：已经是 paid，微信回调重复触发 → 直接返回成功，不重复写 usage
    return { errcode: 0, errmsg: 'OK', handled: true, idempotent: true, orderId: outTradeNo };
  }

  const planMeta = PLAN_TO_META[order.plan];
  if (!planMeta) {
    throw new Error(`[pay-notify] 订单 plan=${order.plan} 未知`);
  }
  // 4) 先记录旧订单状态：如果 usage 写入失败，需要回滚 orders.status
  //    （因为微信回调一旦返回 errcode!=0 就会 12 次重试，幂等分支靠 order.status==='paid' 触发，
  //    半成功（orders=paid 但 usage 没写）会导致后续重试命中幂等分支 → 用户永远解锁不了）
  const prevStatus = order.status;
  const openid = order.openid;
  if (!openid) {
    throw new Error(`[pay-notify] 订单 openid 缺失: outTradeNo=${outTradeNo}`);
  }
  const dailyLimit = getEnvInt('DAILY_FREE_LIMIT', 5);
  const docId = `${openid}_${today()}`;
  const paidUntil = planMeta.plan === 'forever' ? 'forever' : addDays(planMeta.days - 1);

  // 先写 orders（必须先把订单标记为已支付，避免微信回调重新发起时又生成新订单）
  await ordersCol.doc(order._id).update({
    data: {
      status: 'paid',
      transactionId: transactionId || '',
      timeEnd: timeEnd || '',
      totalFee: typeof totalFee === 'number' ? totalFee : order.totalFee || 0,
      updatedAt: Date.now(),
    },
  });

  // 5) 写回 usage_daily 的 plan + paid_until；失败 → 回滚 orders.status 并抛错（让微信重试）
  try {
    const existing = await usageCol.doc(docId).get().catch(() => ({ data: null }));
    if (existing && existing.data) {
      await usageCol.doc(docId).update({
        data: {
          plan: planMeta.plan,
          paid_until: paidUntil,
          updatedAt: Date.now(),
        },
      });
    } else {
      try {
        await usageCol.add({
          data: {
            _id: docId,
            openid,
            date: today(),
            used: 0,
            limit: dailyLimit,
            plan: planMeta.plan,
            paid_until: paidUntil,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      } catch (addErr) {
        // 并发回调或 incrementUsage 已先创建该 doc：回退到 update 路径
        const msg = addErr instanceof Error ? addErr.message : String(addErr);
        try {
          await usageCol.doc(docId).update({
            data: {
              plan: planMeta.plan,
              paid_until: paidUntil,
              updatedAt: Date.now(),
            },
          });
        } catch (updateErr) {
          const u2 = updateErr instanceof Error ? updateErr.message : String(updateErr);
          throw new Error(`[pay-notify] usage_daily 双重失败: add=${msg}; update=${u2}`);
        }
      }
    }
  } catch (usageErr) {
    // 关键：回滚 orders.status，让下次微信回调重新进入"非幂等"分支，再次尝试解锁
    const detail = usageErr instanceof Error ? usageErr.message : String(usageErr);
    try {
      await ordersCol.doc(order._id).update({
        data: {
          status: prevStatus || 'created',
          updatedAt: Date.now(),
          usageRollbackReason: detail,
        },
      });
    } catch (_r) { /* 回滚本身失败：只能抛错让微信重试 */ }
    throw new Error(`[pay-notify] usage 写入失败，orders 已回滚: ${detail}`);
  }

  // 微信支付回调约定：返回 errcode=0 && errmsg='OK' 才会停止重试
  return {
    errcode: 0,
    errmsg: 'OK',
    handled: true,
    orderId: outTradeNo,
    openid,
    plan: planMeta.plan,
    paidUntil,
  };
};