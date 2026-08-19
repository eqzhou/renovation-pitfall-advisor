// 云函数：feedback-stats —— 对应契约 feedback.stats (GET /feedback/stats)
// 管理员复盘：仅 ADMIN_OPENIDS 白名单内的 openid 可查，返回近 N 天反馈聚合统计。
const cloud = require('wx-server-sdk');
const { validateStatsRequest, isAdminOpenid, aggregateFeedback } = require('./impl');
const { envelope } = require('../shared/utils');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const validation = validateStatsRequest(event);
  if (!validation.ok) {
    return envelope(400, validation.reason, undefined);
  }
  try {
    const { OPENID } = cloud.getWXContext();
    // 管理员白名单：未配置则视为无管理员，拒绝访问（透明不兜底）
    const adminList = process.env.ADMIN_OPENIDS || '';
    if (!isAdminOpenid(OPENID, adminList)) {
      return envelope(403, '[feedback.stats] 仅管理员可见（需配置 ADMIN_OPENIDS 白名单）', undefined);
    }

    const db = cloud.database();
    const days = validation.value.days;
    const since = Date.now() - days * 86400000;
    const res = await db
      .collection('feedbacks')
      .where({ createdAt: db.command.gte(since) })
      .limit(5000)
      .get();
    const records = (res && res.data) || [];
    return envelope(0, undefined, aggregateFeedback(records, days, Date.now()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return envelope(500, `[feedback.stats] 服务端处理失败: ${msg}`, undefined);
  }
};
