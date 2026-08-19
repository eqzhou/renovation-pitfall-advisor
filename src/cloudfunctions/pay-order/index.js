// 云函数：pay-order —— 对应契约 pay.order.create (POST /pay/order)
// 规则：
//  - 必须是登录态（openid 可用），否则 401 透明报错
//  - 已配置 WXPAY_MCHID + WXPAY_SUB_APPID：调用 cloud.cloudPay.unifiedOrder 下单并返回 payParams
//  - 未配置支付参数：返回 hint 引导并给出订单号，不兜底 mock payParams（避免前端以为已支付成功）
const cloud = require('wx-server-sdk');
const { envelope, PLAN_TO_META, createOrder } = require('../shared/utils');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const PRICE_CENT_BY_PLAN = {
  unlock_day: 199,
  unlock_week: 599,
  unlock_month: 1999,
  unlock_forever: 12999,
};

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) {
      return envelope(401, '[pay.order.create] 需要微信登录态才能下单', undefined);
    }
    const plan = event && event.plan;
    const planMeta = PLAN_TO_META[plan];
    if (!planMeta) {
      return envelope(
        400,
        `[pay.order.create] plan 不合法，可选值：${Object.keys(PLAN_TO_META).join(', ')}`,
        undefined,
      );
    }
    const price = PRICE_CENT_BY_PLAN[plan];

    const db = cloud.database();
    const orderId = await createOrder(db, {
      openid: OPENID,
      plan,
      planMeta,
      price,
      status: 'created',
    });

    // 云开发微信支付：cloudPay 可用且配置了商户号才返回 payParams；
    // 不配置时给出 hint，不做静默兜底
    const mchId = process.env.WXPAY_MCHID;
    const subAppId = process.env.WXPAY_SUB_APPID;
    if (cloud.cloudPay && mchId && subAppId) {
      const unified = await cloud.cloudPay.unifiedOrder({
        envId: process.env.WXPAY_ENV_ID || cloud.DYNAMIC_CURRENT_ENV,
        functionName: 'pay-notify',
        subMchId: mchId,
        subAppid: subAppId,
        body: `装修避坑顾问 · ${planMeta.plan}`,
        outTradeNo: orderId,
        totalFee: price,
        spbillCreateIp: '127.0.0.1',
        tradeType: 'JSAPI',
        nonceStr: Math.random().toString(36).slice(2, 14),
      });
      if (unified && unified.payment) {
        const { payment } = unified;
        return envelope(
          0,
          undefined,
          {
            orderId,
            payParams: {
              timeStamp: payment.timeStamp,
              nonceStr: payment.nonceStr,
              package: payment.package,
              signType: (payment.signType || 'RSA'),
              paySign: payment.paySign,
            },
          },
        );
      }
    }

    // 未配置真支付 → 透明提示，不放虚假的 payParams
    return envelope(
      0,
      undefined,
      {
        orderId,
        hint:
          '当前尚未配置微信支付商户号（WXPAY_MCHID/WXPAY_SUB_APPID），下单已记录订单号，但需先在云开发控制台开通「微信支付」并设置环境变量后才能拉起付款。',
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return envelope(500, `[pay.order.create] 服务端处理失败: ${msg}`, undefined);
  }
};