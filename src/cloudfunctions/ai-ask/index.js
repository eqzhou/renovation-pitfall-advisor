// 云函数：ai-ask —— 对应契约 ai.ask (POST /ai/ask)
// 注意：云函数由微信服务端 runtime 直接执行，必须使用 wx-server-sdk（非 Taro SDK）。
// 真 LLM 接入时：调整 impl.js 的 LLM_PROVIDER 与对应密钥，契约不变。
const cloud = require('wx-server-sdk');
const { invokeLLM, validateRequest } = require('./impl');
const {
  envelope,
  incrementUsage,
  getUsageOrZero,
  isPaidActive,
  getEnvInt,
} = require('../shared/utils');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const validation = validateRequest(event);
  if (!validation.ok) {
    return envelope(400, validation.reason, undefined);
  }

  try {
    const db = cloud.database();
    const { OPENID } = cloud.getWXContext();
    // 未登录态（极少发生）：仍允许回答，但不做额度扣减
    const openid = OPENID || '';

    let dailyLimit = getEnvInt('DAILY_FREE_LIMIT', 5);
    const record = openid ? await getUsageOrZero(db, openid) : null;
    const paid = record ? isPaidActive(record) : false;

    if (openid && !paid) {
      dailyLimit =
        Number.isFinite(record && record.limit) && record.limit > 0
          ? record.limit
          : dailyLimit;
      if ((record.used || 0) >= dailyLimit) {
        return envelope(
          429,
          `[ai.ask] 今日免费咨询已达上限 (${dailyLimit} 次)，请付费解锁或明日再来`,
          undefined,
        );
      }
    }

    const answer = await invokeLLM(validation.value, cloud);

    if (openid && !paid) {
      // 回答成功后再递增计数（回答失败不扣额度）
      await incrementUsage(db, openid).catch((err) => {
        // 额度写入失败不影响已经返回的答案，但显式打日志，不静默
        console.error('[ai.ask] incrementUsage 失败：', err);
      });
    }

    return envelope(0, undefined, answer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 超时给前端一个可区分的错误码与用户可读文案，便于前端决定是否自动重试
    if (msg.startsWith('[timeout]')) {
      return envelope(
        504,
        `[ai.ask] AI 响应超时，请稍后重试（20s 无响应）。详情：${msg}`,
        undefined,
      );
    }
    return envelope(500, `[ai.ask] 服务端处理失败: ${msg}`, undefined);
  }
};