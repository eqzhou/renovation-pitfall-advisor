/**
 * 云函数共享工具（纯 JS，wx-server-sdk runtime 友好）。
 *
 * - today(): 拿到当日的 YYYY-MM-DD（按 Asia/Shanghai）
 * - envelope(): 标准响应外壳
 * - getEnvInt(name, fallback): 安全读整数环境变量
 * - incrementUsage(openid, db): 每日用量 +1 / 或付费判断
 */

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 返回中国大陆时区（Asia/Shanghai）的当日日期字符串，与服务器时区无关。 */
function today() {
  const now = new Date();
  const shifted = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60 * 1000);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

/**
 * 相对"今日（Asia/Shanghai）"加 n 天，返回 YYYY-MM-DD。
 * 与 today() 共用 pad() 与时区换算逻辑，保证格式严格一致；
 * 用于付费 plan 的 paid_until 计算（pay-notify 与 quota.get 共享此函数）。
 */
function addDays(n) {
  const now = new Date();
  const shifted = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60 * 1000);
  shifted.setDate(shifted.getDate() + Number(n));
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

function envelope(code, msg, data) {
  const resp = { code };
  if (msg !== undefined && msg !== null && msg !== '') resp.msg = msg;
  if (data !== undefined) resp.data = data;
  return resp;
}

function getEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * 计划 id -> 解锁类型与过期天（相对今天）
 *  ''      = 未付费
 *  'day'   = 24h（当天）
 *  'week'  = 7 天
 *  'month' = 30 天
 *  'forever' = 不过期
 */
const PLAN_TO_META = {
  unlock_day: { plan: 'day', days: 1 },
  unlock_week: { plan: 'week', days: 7 },
  unlock_month: { plan: 'month', days: 30 },
  unlock_forever: { plan: 'forever', days: Number.POSITIVE_INFINITY },
};

/** 判断是否仍在付费解锁有效期内（paid_until 为到期 YYYY-MM-DD，或 forever 关键字） */
function isPaidActive(record) {
  if (!record) return false;
  if (record.plan === 'forever') return true;
  // plan 为非空（说明有过支付）且 paid_until >= 今天 → 仍有效
  // 注意：字符串比较 YYYY-MM-DD 可以正确比较，前导 0 保证字典序与日期序一致
  if (!record.plan || !record.paid_until) return false;
  return record.paid_until >= today();
}

/**
 * 基于云数据库的日用量记录 +1（免费次数用完但付费了仍不计入 used 上限）。返回更新后的记录。
 *
 * 并发安全：先读后写存在竞态——两个并发请求都进入"doc 不存在 → add"路径时，
 * 第二个会因 _id 冲突 throw。这里在 add 失败时回退到 update（用 db.command.inc 保证原子），
 * 避免用量未扣导致超额免费咨询。
 */
async function incrementUsage(db, openid) {
  const _today = today();
  const docId = `${openid}_${_today}`;
  const col = db.collection('usage_daily');
  const dailyLimit = getEnvInt('DAILY_FREE_LIMIT', 5);

  // wx-server-sdk 的 update/doc 不支持原生 upsert，先读再写
  const existing = await col.doc(docId).get().catch(() => ({ data: null }));
  if (existing && existing.data) {
    const after = await col
      .doc(docId)
      .update({ data: { used: db.command.inc(1), updatedAt: Date.now() } });
    return { ...existing.data, used: (existing.data.used || 0) + 1, _updatedStats: after };
  }
  // doc 不存在 → add 新记录；并发回调时 _id 可能已被人抢先创建 → 回退到 update
  try {
    await col.add({
      data: {
        _id: docId,
        openid,
        date: _today,
        used: 1,
        limit: dailyLimit,
        plan: '',
        paid_until: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    return {
      openid,
      date: _today,
      used: 1,
      limit: dailyLimit,
      plan: '',
      paid_until: '',
    };
  } catch (addErr) {
    // 并发竞态：doc 已被抢先创建。回退到原子 inc 路径，保证用量一定 +1。
    const msg = addErr instanceof Error ? addErr.message : String(addErr);
    try {
      const before = await col.doc(docId).get();
      const beforeUsed = (before && before.data && before.data.used) || 0;
      await col
        .doc(docId)
        .update({ data: { used: db.command.inc(1), updatedAt: Date.now() } });
      return { ...(before && before.data), used: beforeUsed + 1, _recoveredFrom: 'add-conflict', _addErr: msg };
    } catch (updateErr) {
      const u2 = updateErr instanceof Error ? updateErr.message : String(updateErr);
      // 集合未创建等：透明报错，不兜底静默
      throw new Error(`[usage.increment] 用量写入双重失败 (doc=${docId}): add=${msg}; update=${u2}`);
    }
  }
}

/**
 * 读取日用量记录。
 * 关键：如果当日 doc 不存在（今天第一次咨询前的首次 quota.get 调用），
 * 回查"最近任意一份仍在有效期内的 plan"并带到返回值。否则跨日期首次查 quota
 * 会得到 plan=''（哪怕用户昨天刚买了月卡），前端展示"未付费"引发客诉焦虑。
 *
 * 回查范围：openid 下按 createdAt 倒序取最近 90 条。O(1) 判断有效期，代价可接受。
 */
async function getUsageOrZero(db, openid) {
  const _today = today();
  const docId = `${openid}_${_today}`;
  const col = db.collection('usage_daily');
  const r = await col.doc(docId).get().catch(() => ({ data: null }));
  if (r && r.data) return r.data;

  // 当日 doc 不存在 → 回查任意一份历史记录，看有没有在有效期内的 plan
  const empty = {
    openid,
    date: _today,
    used: 0,
    limit: getEnvInt('DAILY_FREE_LIMIT', 5),
    plan: '',
    paid_until: '',
  };
  try {
    const hist = await col
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .limit(90)
      .get()
      .catch(() => ({ data: [] }));
    if (hist && Array.isArray(hist.data)) {
      for (const rec of hist.data) {
        // isPaidActive 也会调 today()，日期不同步可以接受（同函数内 <1s 时差）
        if (isPaidActive(rec)) {
          // 找到仍在有效期内的最近一份 → 把 plan/paid_until 带到今日空壳
          empty.plan = rec.plan || '';
          empty.paid_until = rec.paid_until || '';
          break;
        }
      }
    }
  } catch (_) {
    // 回查失败不阻断 quota.get：只返回当日空壳即可，用户下次提问 incrementUsage
    // 会再创建今日 doc（届时 pay-notify 应该已经把 plan 写回了）
  }
  return empty;
}

/** 写入订单记录（云数据库 orders 集合）。返回订单号。 */
async function createOrder(db, { openid, plan, planMeta, price, status }) {
  const orderId =
    'pay_' +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);
  await db.collection('orders').add({
    data: {
      _id: orderId,
      orderId,
      openid,
      plan,
      resolved_plan: planMeta.plan,
      days: Number.isFinite(planMeta.days) ? planMeta.days : 0,
      forever: planMeta.plan === 'forever',
      price,
      status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  return orderId;
}

module.exports = {
  today,
  addDays,
  envelope,
  getEnvInt,
  PLAN_TO_META,
  isPaidActive,
  incrementUsage,
  getUsageOrZero,
  createOrder,
};