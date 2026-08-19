// 云函数：quota —— 对应契约 quota.get (GET /quota)
// 返回用户当日免费额度使用情况与付费解锁状态
const cloud = require('wx-server-sdk');
const { envelope, getUsageOrZero, isPaidActive, getEnvInt } = require('../shared/utils');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (_event, context) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) {
      return envelope(401, '[quota.get] 需要微信登录态才能查询额度', undefined);
    }
    const db = cloud.database();
    const rec = await getUsageOrZero(db, OPENID);
    const limit = Number.isFinite(rec.limit) && rec.limit > 0 ? rec.limit : getEnvInt('DAILY_FREE_LIMIT', 5);
    const paid = isPaidActive(rec);

    return envelope(
      0,
      undefined,
      {
        used: paid ? 0 : rec.used || 0,
        limit,
        paid,
        plan: paid ? (rec.plan || '') : '',
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return envelope(500, `[quota.get] 服务端处理失败: ${msg}`, undefined);
  }
};