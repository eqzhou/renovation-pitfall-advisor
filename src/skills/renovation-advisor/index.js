// SKILL 入口：renovationAdvisor
// 职责：初始化云开发 + 注册 askRenovation 原子接口，复用 ai-ask 云函数（不重写业务）
//
// 约束（来自官方云开发 SKILL 文档）：
//  - wx.cloud.* 仅在原子接口环境可用，组件环境不可用 → 所有数据获取放接口里，组件只渲染
//  - 云开发免鉴权：OPENID 由云函数 getWXContext() 自动拿到，无需前端 wx.login
//  - 不做静默兜底：云函数失败/超时/形状非法 → 接口返回明确 error，让 AI 如实告知用户
//
// 契约一致性：本接口的入参 {scene, question} 与 src/api/contracts/routes.ts 的 ai.ask 契约一致；
// 有 tests/skill-contract.test.ts 断言 mcp.json 与该契约同步，改动任一侧都会红。

function initCloud() {
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.init !== 'function') {
    // 原子接口环境必然有 wx.cloud；若没有，是基础库/配置问题，透明抛错
    throw new Error('[renovationAdvisor] wx.cloud 不可用，请确认基础库 ≥ 3.16.1 且 app.json 已设置 cloud: true');
  }
  // env 留空 → 走当前选中环境；traceUser 记录访问用于额度统计
  wx.cloud.init({ env: '', traceUser: true });
}

function callCloud(name, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: (res) => resolve(res && res.result),
      fail: (err) => reject(err),
    });
  });
}

/**
 * askRenovation 原子接口
 * @param {object} args - {question: string, scene?: string}
 * @returns {Promise<{structuredContent: {chunks, disclaimer}}>}
 *   成功：返回 {structuredContent: {chunks, disclaimer}}，由 answer-card 组件渲染
 *   失败：抛 Error，AI 会据 SKILL.md 的错误处理规则如实告知用户
 */
async function askRenovation(args) {
  const { question, scene } = args || {};
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new Error('[renovationAdvisor] question 字段必填且不能为空');
  }

  const payload = { question: question.trim() };
  if (scene) payload.scene = scene;

  // 直接复用 ai-ask 云函数（契约 ai.ask），不重写任何业务逻辑
  const result = await callCloud('ai-ask', payload);

  if (!result || typeof result !== 'object') {
    throw new Error(`[renovationAdvisor] 云函数返回格式非法: ${JSON.stringify(result)}`);
  }
  if (result.code !== 0) {
    // 透传服务端错误码与信息（含 429 额度、400 参数、500 服务异常），不兜底
    const code = result.code;
    const msg = result.msg || '未提供错误信息';
    throw new Error(`[renovationAdvisor] 服务端错误 (code=${code}): ${msg}`);
  }
  const data = result.data;
  if (!data || !Array.isArray(data.chunks) || typeof data.disclaimer !== 'string') {
    throw new Error(`[renovationAdvisor] 响应 data 形状非法: ${JSON.stringify(data).slice(0, 200)}`);
  }

  // 返回 structuredContent，供 answer-card 组件按 outputSchema 渲染
  return {
    structuredContent: {
      chunks: data.chunks,
      disclaimer: data.disclaimer,
    },
  };
}

// 模块初始化与接口注册（SKILL runtime 约定：module.exports.register）
module.exports = {
  register(api) {
    initCloud();
    api.register('askRenovation', askRenovation);
  },
};