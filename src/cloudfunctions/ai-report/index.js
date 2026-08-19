// 云函数：ai-report —— 对应契约 ai.report (POST /ai/report)
const cloud = require('wx-server-sdk');
const { validateRequest, buildChecklist, saveReport, DISCLAIMER } = require('./impl');
const { envelope } = require('../shared/utils');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const validation = validateRequest(event);
  if (!validation.ok) {
    return envelope(400, validation.reason, undefined);
  }
  try {
    const { sessionId, history } = validation.value;
    const { OPENID } = cloud.getWXContext();
    // 契约：ai.report protected=true，需要登录态；缺失时给出明确错误
    if (!OPENID) {
      return envelope(401, '[ai.report] 需要微信登录态才能生成报告', undefined);
    }

    const { coveredQuestions, items } = buildChecklist(history);
    const createdAt = Date.now();
    const db = cloud.database();
    const { reportId } = await saveReport(db, {
      sessionId,
      openid: OPENID,
      items,
      coveredQuestions,
      createdAt,
    });

    return envelope(
      0,
      undefined,
      {
        reportId,
        createdAt,
        coveredQuestions,
        items,
        disclaimer: DISCLAIMER,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return envelope(500, `[ai.report] 服务端处理失败: ${msg}`, undefined);
  }
};