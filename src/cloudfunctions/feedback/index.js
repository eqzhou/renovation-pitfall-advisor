// 云函数：feedback —— 对应契约 feedback.submit (POST /feedback)
const cloud = require('wx-server-sdk');
const { validateRequest, insertFeedback } = require('./impl');
const { envelope } = require('../shared/utils');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const validation = validateRequest(event);
  if (!validation.ok) {
    return envelope(400, validation.reason, undefined);
  }
  try {
    const { OPENID } = cloud.getWXContext();
    const db = cloud.database();
    const id = await insertFeedback(db, {
      openid: OPENID || '',
      ...validation.value,
    });
    return envelope(0, undefined, { ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return envelope(500, `[feedback.submit] 服务端处理失败: ${msg}`, undefined);
  }
};