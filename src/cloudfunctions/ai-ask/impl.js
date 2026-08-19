/**
 * 策略化 LLM 封装（M3 接入真 LLM 起点）。
 *
 * 调度规则（LLM_PROVIDER 环境变量控制）：
 *   - undefined / 'mock'    → 走本地知识库（mockAnswer），保证离线可用
 *   - 'deepseek'            → 调用 DeepSeek Chat Completions（需 DEEPSEEK_API_KEY）
 *   - 'hunyuan'             → 调用 腾讯混元（HUNYUAN_API_KEY/HUNYUAN_MODEL 或云开发内置 getAI()）
 *
 * 透明原则：
 *   - provider 不是 mock，但对应密钥缺失 → 立即抛明确错误，**绝不 fallback 到 mock**
 *   - 大模型返回形状无法解析为 chunks → 抛明确错误，绝不兜底返回乱文字
 */

const DISCLAIMER =
  '本建议由 AI 整理行业资料生成，仅作参考，不替代施工/合同/验收等专业决策。';

/** 真 LLM 调用统一超时（秒）。云函数默认 60s 上限，前端体验 20s 内必须给响应。 */
const LLM_TIMEOUT_MS = 20_000;

/**
 * 带超时的 fetch 封装：timeoutMs 内未响应 → 抛带 [timeout] 标签的错误，
 * 让调用链（ai-ask index.js）可识别并返回"AI 响应超时，请稍后重试"的明确提示。
 */
async function fetchWithTimeout(url, init, timeoutMs = LLM_TIMEOUT_MS) {
  if (typeof AbortController === 'function') {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      if (err && (err.name === 'AbortError' || /abort/i.test(err.message || ''))) {
        throw new Error(`[timeout] LLM 请求超过 ${Math.round(timeoutMs / 1000)}s 未响应`);
      }
      throw err;
    } finally {
      clearTimeout(tid);
    }
  }
  // 极少数老旧运行时无 AbortController → 退化为 Promise.race + 永不 resolve 的空 fetch（
  // 仍可把"超时"的错误抛出去）。
  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => {
      reject(new Error(`[timeout] LLM 请求超过 ${Math.round(timeoutMs / 1000)}s 未响应`));
    }, timeoutMs);
    fetch(url, init)
      .then((r) => {
        clearTimeout(tid);
        resolve(r);
      })
      .catch((err) => {
        clearTimeout(tid);
        reject(err);
      });
  });
}

const SCENES = new Set([
  'budget',
  'acceptance',
  'contract',
  'plumbing',
  'waterproof',
  'materials',
]);

function validateRequest(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: '请求体必须为 JSON 对象' };
  }
  const { scene, question } = input;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return { ok: false, reason: 'question 字段必填且不能为空' };
  }
  if (question.trim().length > 1000) {
    return {
      ok: false,
      reason: `question 过长（上限 1000 字，当前 ${question.trim().length} 字）`,
    };
  }
  if (scene !== undefined && !SCENES.has(scene)) {
    return {
      ok: false,
      reason: `scene 字段不合法，可选值：${Array.from(SCENES).join(', ')}`,
    };
  }
  return { ok: true, value: { scene: scene || undefined, question: question.trim() } };
}

/**
 * M2 的场景知识库（极简版）。真实产品替换成 RAG。
 */
const SCENE_WIKI = {
  budget: [
    {
      type: 'claim',
      content:
        '装修预算最容易超支的是"水电改造 + 防水 + 吊顶"这三项隐蔽工程，建议整体预留 15%-20% 的浮动空间。',
    },
    {
      type: 'step',
      content:
        '第 1 步：把预算拆成"硬装主材/辅材+人工/软装/家电/不可预见"五栏，每一栏单独报价，避免打包价。',
    },
    {
      type: 'step',
      content:
        '第 2 步：合同里务必写入"增项累计金额不得超过合同总额 5%，超过部分由乙方承担"的条款。',
    },
    {
      type: 'warning',
      content: '警惕"低价签单、后期增项"的套路，所有口头承诺必须落到纸面报价单并签字。',
    },
  ],
  acceptance: [
    {
      type: 'claim',
      content:
        '验收最关键的是"闭水试验、电路绝缘、墙面垂直度、瓷砖空鼓"这四项，任何一项不合格都不能签字。',
    },
    {
      type: 'step',
      content:
        '第 1 步：闭水试验必须蓄水 24-48 小时，并请楼下邻居确认顶面无渗漏，留下视频为证。',
    },
    {
      type: 'step',
      content:
        '第 2 步：用空鼓锤敲瓷砖，整面墙空鼓率 >5% 或单块砖中心空鼓必须返工。',
    },
    {
      type: 'warning',
      content: '所有水路接口、电路插座都要逐一通电/打压测试，不可只抽测。',
    },
  ],
  contract: [
    {
      type: 'claim',
      content:
        '装修合同里必须写死"工期、付款节点、违约责任、增项上限、验收标准、售后质保"这 6 要素。',
    },
    {
      type: 'step',
      content:
        '第 1 步：付款节点建议 30/30/30/10（开工/隐蔽/中期/竣工），最后 10% 作为质保金满 3 个月再付。',
    },
    {
      type: 'step',
      content:
        '第 2 步：把报价单中的"品牌/规格/型号"三项逐条写进合同附件，防止现场以次充好。',
    },
    {
      type: 'warning',
      content: '"口头约定"一律不算数，口头承诺必须补充成书面签字附件。',
    },
  ],
  plumbing: [
    {
      type: 'claim',
      content:
        '水电改造的三大坑是：绕线算米、强弱电同槽、冷热水管间距不足。一旦返工代价巨大。',
    },
    {
      type: 'step',
      content:
        '第 1 步：交底前先在图纸上画好点位，现场复核后再开槽，避免后期临时加线绕路。',
    },
    {
      type: 'step',
      content:
        '第 2 步：强电走顶、弱电走地；同一槽内强弱电必须有屏蔽层且间距 ≥30cm。',
    },
    {
      type: 'warning',
      content: '改造结束立刻拍照录像、做水路打压试验（0.8MPa 稳压 30 分钟压降 <0.05MPa）。',
    },
  ],
  waterproof: [
    {
      type: 'claim',
      content:
        '防水返工的代价是"砸砖 + 楼下赔偿"，必须在施工阶段就把高度、遍数、闭水试验做足。',
    },
    {
      type: 'step',
      content:
        '第 1 步：卫生间墙面淋浴区至少刷 1.8m 高，其余 ≥30cm；涂刷至少两遍并成膜后再做闭水。',
    },
    {
      type: 'step',
      content:
        '第 2 步：闭水 48 小时、通知楼下业主到场共同确认，双方拍照留证。',
    },
    {
      type: 'warning',
      content: '门口止水坎、烟道、管根三个角落最容易漏，必须加玻璃纤维布做增强层。',
    },
  ],
  materials: [
    {
      type: 'claim',
      content:
        '主材进场必须核对"品牌/型号/批次/合格证"，和合同附件完全一致再签收。',
    },
    {
      type: 'step',
      content:
        '第 1 步：瓷砖、地板、乳胶漆这类有色差风险的材料，尽量同批次进货，保留包装箱。',
    },
    {
      type: 'step',
      content:
        '第 2 步：板材、胶粘剂重点看 E0/ENF 级环保认证，不接受"三无散装"产品。',
    },
    {
      type: 'warning',
      content: '警惕"同厂代工"说法，必须认原品牌包装和原厂发票，不可口头承认等级。',
    },
  ],
};

function genericAnswer(question) {
  return [
    {
      type: 'claim',
      content: `关于"${question}"，核心要先锁定"你处于装修哪一阶段（前期/施工中/验收后）"，再决定找谁拍板。`,
    },
    {
      type: 'step',
      content:
        '第 1 步：先把问题对应到合同或报价单中的一个具体项，才能界定责任方与金额。',
    },
    {
      type: 'step',
      content:
        '第 2 步：有争议时先留证据（照片/视频/聊天记录/签字单据），再协商，最后走第三方监理或 12315。',
    },
    {
      type: 'warning',
      content:
        '涉及金额较大时，建议拉一位独立第三方监理现场确认，费用远低于返工成本。',
    },
  ];
}

function mockAnswer({ scene, question }) {
  const base = scene && SCENE_WIKI[scene] ? SCENE_WIKI[scene] : genericAnswer(question);
  const chunks = base.map((c) => ({ content: c.content, type: c.type }));
  return { chunks, disclaimer: DISCLAIMER };
}

/** 组装给真 LLM 的 system prompt：带上知识库基础 + 强约束 JSON 输出 */
function buildSystemPrompt() {
  const wikis = Object.entries(SCENE_WIKI)
    .map(([k, items]) => `【${k}】\n${items.map((i) => `- (${i.type}) ${i.content}`).join('\n')}`)
    .join('\n\n');
  return (
    '你是「装修避坑顾问」AI。基于以下装修知识库 + 行业常识，严格按指定形状回答用户问题：\n\n' +
    '## 输出格式约束（必须严格遵守）\n' +
    '只能返回一个 JSON 数组，数组元素为对象，每个对象含两个字段：\n' +
    '  - "type": 必须是 "claim" 或 "step" 或 "warning"\n' +
    '  - "content": 对应内容的中文句子（不含 Markdown/图片）\n' +
    '推荐顺序：1 个 claim（核心结论） → 2-3 个 step（分步骤） → 1 个 warning（风险提醒）。\n' +
    '除了 JSON 数组本身之外，不要输出任何额外文字、解释、注释或 ``` 代码块。\n\n' +
    '## 知识库（可择要引用、可结合用户问题扩展，但不要捏造明显错误事实）\n' +
    wikis
  );
}

/** 从 LLM 的文本里解析出 JSON 数组 chunks；解析失败抛明确错误不兜底 */
function parseChunksFromLLM(rawText) {
  if (typeof rawText !== 'string') {
    throw new Error(`LLM 返回类型非法：${typeof rawText}`);
  }
  const trimmed = rawText.trim();
  const candidates = [];
  // 容忍 ```json / ``` 代码块包裹
  if (trimmed.startsWith('```')) {
    const end = trimmed.indexOf('```', 3);
    const inner = end > 0 ? trimmed.slice(3, end) : trimmed.slice(3);
    candidates.push(inner.replace(/^json/i, '').trim());
  }
  const firstArr = trimmed.indexOf('[');
  const lastArr = trimmed.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) {
    candidates.push(trimmed.slice(firstArr, lastArr + 1));
  }
  candidates.push(trimmed);
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand);
      // 空数组视为非法：LLM 没给出有效答复 → 抛错让前端给出明确错误提示
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(
          (c) =>
            c &&
            typeof c.content === 'string' &&
            (c.type === 'claim' || c.type === 'step' || c.type === 'warning'),
        )
      ) {
        return parsed.map((c) => ({ type: c.type, content: String(c.content) }));
      }
    } catch (_) {
      // 尝试下一个候选
    }
  }
  throw new Error(`LLM 输出未能解析为规定形状：${trimmed.slice(0, 200)}`);
}

async function requestDeepSeek({ scene, question }) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('[LLM] provider=deepseek 但 DEEPSEEK_API_KEY 未配置，无法调用（不会回退到 mock）');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  // 注意：不使用 response_format: { type: 'json_object' }。
  // 该模式要求顶层必须是 JSON 对象（DeepSeek 文档明确约束），而我们的 system prompt
  // 要求返回 JSON 数组。两者冲突会让模型直接拒绝输出 → parseChunksFromLLM 失败。
  // 改为依赖 system prompt 的强约束 + parseChunksFromLLM 对 ```json 代码块的容忍。
  const resp = await fetchWithTimeout(
    'https://api.deepseek.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          {
            role: 'user',
            content:
              `场景：${scene || '未指定'}\n问题：${question}\n\n` +
              '请按 system prompt 要求，只输出 JSON 数组。',
          },
        ],
      }),
    },
    LLM_TIMEOUT_MS,
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`[LLM] deepseek HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  return parseChunksFromLLM(content);
}

async function requestHunyuan({ scene, question }, cloudSdk) {
  // 方式一：云开发内置 AI（微信 AI 小程序成长计划推荐路径）
  if (cloudSdk && typeof cloudSdk.getAI === 'function') {
    const ai = cloudSdk.getAI();
    if (ai && typeof ai.run === 'function') {
      const res = await ai.run({
        model: process.env.HUNYUAN_MODEL || 'hunyuan-turbo-latest',
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          {
            role: 'user',
            content:
              `场景：${scene || '未指定'}\n问题：${question}\n\n` +
              '请按 system prompt 要求，只输出 JSON 数组。',
          },
        ],
      });
      // 兼容 run 返回形状不同的情况
      const content =
        (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) ||
        (res && typeof res.output === 'string' && res.output) ||
        (typeof res === 'string' ? res : JSON.stringify(res || ''));
      return parseChunksFromLLM(content);
    }
  }
  // 方式二：HTTP 直连（配置 HUNYUAN_API_KEY 时）
  const key = process.env.HUNYUAN_API_KEY;
  if (!key) throw new Error('[LLM] provider=hunyuan 但既无 cloud.getAI 可用，也未配置 HUNYUAN_API_KEY（不会回退到 mock）');
  const model = process.env.HUNYUAN_MODEL || 'hunyuan-turbo-latest';
  const resp = await fetchWithTimeout(
    'https://api.hunyuan.tencentcloudapi.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          {
            role: 'user',
            content:
              `场景：${scene || '未指定'}\n问题：${question}\n\n` +
              '请按 system prompt 要求，只输出 JSON 数组。',
          },
        ],
      }),
    },
    LLM_TIMEOUT_MS,
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`[LLM] hunyuan HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  return parseChunksFromLLM(content);
}

/** 统一入口：按 provider 调用对应 LLM，失败不回退 */
async function invokeLLM(params, cloudSdk) {
  const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  switch (provider) {
    case 'mock':
    case '':
      return mockAnswer(params);
    case 'deepseek': {
      const chunks = await requestDeepSeek(params);
      return { chunks, disclaimer: DISCLAIMER };
    }
    case 'hunyuan': {
      const chunks = await requestHunyuan(params, cloudSdk);
      return { chunks, disclaimer: DISCLAIMER };
    }
    default:
      throw new Error(
        `[LLM] 未知的 LLM_PROVIDER=${provider}，合法值：mock/deepseek/hunyuan（不会回退到默认值）`,
      );
  }
}

// parseChunksFromLLM 导出：便于单元测试直接测（也是未来 SDK 层复用的入口）
module.exports = { validateRequest, invokeLLM, mockAnswer, parseChunksFromLLM };