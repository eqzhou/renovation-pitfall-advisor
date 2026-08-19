/**
 * feedback.submit 核心实现。
 *
 * 校验：
 *  - answerId 必填且非空
 *  - helpful 必须是布尔值
 *  - comment 可选，长度限制 500 字以内，超过截断
 *  - question 可选，长度限制 300 字以内，超过截断
 *
 * 不阻塞主流程：即使云函数异常，前端也用 try/catch 把 Toast 控制在"非阻塞"。
 * 但校验失败仍给出明确 400，不静默忽略。
 */

function validateRequest(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: '请求体必须为 JSON 对象' };
  }
  const { answerId, helpful, comment, question, sessionId } = input;
  if (typeof answerId !== 'string' || answerId.trim().length === 0) {
    return { ok: false, reason: 'answerId 必填且不能为空字符串' };
  }
  if (typeof helpful !== 'boolean') {
    return { ok: false, reason: 'helpful 必须为布尔值 true/false' };
  }
  if (comment !== undefined && typeof comment !== 'string') {
    return { ok: false, reason: 'comment 必须为字符串' };
  }
  if (question !== undefined && typeof question !== 'string') {
    return { ok: false, reason: 'question 必须为字符串' };
  }
  if (sessionId !== undefined && typeof sessionId !== 'string') {
    return { ok: false, reason: 'sessionId 必须为字符串' };
  }
  return {
    ok: true,
    value: {
      answerId: answerId.trim(),
      helpful,
      comment: typeof comment === 'string' ? comment.slice(0, 500) : undefined,
      question: typeof question === 'string' ? question.slice(0, 300) : undefined,
      sessionId: typeof sessionId === 'string' ? sessionId.slice(0, 128) : undefined,
    },
  };
}

async function insertFeedback(db, { openid, answerId, helpful, comment, question, sessionId }) {
  const id =
    'fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await db.collection('feedbacks').add({
    data: {
      _id: id,
      id,
      openid: openid || '',
      answerId,
      sessionId: sessionId || '',
      helpful,
      comment: comment || '',
      question: question || '',
      createdAt: Date.now(),
    },
  });
  return id;
}

module.exports = { validateRequest, insertFeedback };