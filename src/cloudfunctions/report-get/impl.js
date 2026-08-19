/**
 * report.get 核心实现（按 reportId 读取已保存的避坑清单报告）。
 *
 * 用途：报告分享接收端 —— 好友点开转发卡片后，前端拿到 reportId，
 * 调用本云函数取回同一份报告展示（报告在生成时已由 ai-report 落库到 reports 集合）。
 *
 * 访问控制：契约 protected=false。reportId 本身就是访问凭证（足够随机），
 * 分享是"拿到 id 即可读"的场景，不强制 openid 归属。
 */

/** {reportId} */
function validateGetRequest(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: '请求体必须为 JSON 对象' };
  }
  const { reportId } = input;
  if (typeof reportId !== 'string' || reportId.trim().length === 0) {
    return { ok: false, reason: 'reportId 必填且不能为空字符串' };
  }
  return { ok: true, value: { reportId: reportId.trim() } };
}

/** reports 集合文档 → AiReportResponse；不存在或异常输入返回 null */
function normalizeReportDoc(doc) {
  if (!doc) return null;
  return {
    reportId: doc.reportId || doc._id || '',
    createdAt: typeof doc.createdAt === 'number' ? doc.createdAt : 0,
    coveredQuestions: Number.isFinite(doc.coveredQuestions) ? doc.coveredQuestions : 0,
    items: Array.isArray(doc.items) ? doc.items : [],
    disclaimer: typeof doc.disclaimer === 'string' ? doc.disclaimer : '',
  };
}

module.exports = { validateGetRequest, normalizeReportDoc };
