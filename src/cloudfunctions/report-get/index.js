// 云函数：report-get —— 对应契约 report.get (GET /report)
const cloud = require('wx-server-sdk');
const { validateGetRequest, normalizeReportDoc } = require('./impl');
const { envelope } = require('../shared/utils');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const validation = validateGetRequest(event);
  if (!validation.ok) {
    return envelope(400, validation.reason, undefined);
  }
  try {
    const db = cloud.database();
    const res = await db
      .collection('reports')
      .doc(validation.value.reportId)
      .get()
      .catch(() => ({ data: null }));
    const report = normalizeReportDoc(res && res.data);
    if (!report) {
      return envelope(404, `[report.get] 报告不存在: ${validation.value.reportId}`, undefined);
    }
    return envelope(0, undefined, report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return envelope(500, `[report.get] 服务端处理失败: ${msg}`, undefined);
  }
};
