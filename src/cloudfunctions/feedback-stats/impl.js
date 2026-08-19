/**
 * feedback.stats 核心实现（反馈复盘统计）。
 *
 * 职责边界：
 *  - validateStatsRequest:  校验 { days }（可选，默认 7，范围 1-90）
 *  - isAdminOpenid:         管理员 openid 白名单判定（env ADMIN_OPENIDS 逗号分隔）
 *  - aggregateFeedback:     把反馈记录聚合成 { total, helpful, unhelpful, helpfulRate, daily, topUnhelpfulQuestions }
 *
 * 复盘价值：除了整体帮助率，重点给出"无帮助问题 Top5"——
 * 这些是 AI 答得不好、值得优化系统提示/知识库的高信号样本。
 */

/** {days?} */
function validateStatsRequest(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: '请求体必须为 JSON 对象' };
  }
  const { days } = input;
  if (days === undefined) {
    return { ok: true, value: { days: 7 } };
  }
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return { ok: false, reason: `days 必须为 1-90 的整数，当前: ${days}` };
  }
  return { ok: true, value: { days } };
}

/** openid 是否在管理员白名单（逗号分隔、忽略空白与大小写） */
function isAdminOpenid(openid, adminList) {
  if (!openid || typeof adminList !== 'string') return false;
  const normalized = openid.trim().toLowerCase();
  return adminList
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

/** 按东八区（Asia/Shanghai）切日：避免服务器 UTC 时区导致国内用户日期偏一天 */
function formatDate(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 聚合反馈记录。
 * @param records [{helpful, createdAt, question}]
 * @param days   统计窗口（近 N 天）
 * @param now    基准时间（毫秒戳，可注入便于测试）
 */
function aggregateFeedback(records, days = 7, now = Date.now()) {
  const list = Array.isArray(records) ? records : [];
  const total = list.length;
  const helpful = list.filter((r) => r && r.helpful === true).length;
  const unhelpful = list.filter((r) => r && r.helpful === false).length;
  const helpfulRate = total > 0 ? Math.round((helpful / total) * 1000) / 10 : 0;

  // 近 N 天每日分组（含补零，从最旧到最新）
  const dayMs = 86400000;
  const dailyMap = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const date = formatDate(now - i * dayMs);
    dailyMap.set(date, { date, total: 0, helpful: 0, unhelpful: 0 });
  }
  for (const r of list) {
    if (!r) continue;
    const date = formatDate(r.createdAt);
    const slot = dailyMap.get(date);
    if (!slot) continue; // 窗口外不计入每日分布（但已计入 total）
    slot.total += 1;
    if (r.helpful === true) slot.helpful += 1;
    if (r.helpful === false) slot.unhelpful += 1;
  }
  const daily = Array.from(dailyMap.values());

  // 无帮助问题 Top5（按次数降序）—— 复盘最高信号样本
  const qCount = new Map();
  for (const r of list) {
    if (r && r.helpful === false && typeof r.question === 'string' && r.question) {
      qCount.set(r.question, (qCount.get(r.question) || 0) + 1);
    }
  }
  const topUnhelpfulQuestions = Array.from(qCount.entries())
    .map(([question, count]) => ({ question, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { total, helpful, unhelpful, helpfulRate, daily, topUnhelpfulQuestions };
}

module.exports = { validateStatsRequest, isAdminOpenid, aggregateFeedback, formatDate };
