/**
 * ai.report 核心实现。
 *
 * 职责边界：
 *  - validateRequest: 校验 { sessionId, history } 入参；非法透明 400
 *  - buildChecklist:  把 history 里每条 assistant 回答拆分为 {category, claim, checks, warnings}
 *  - saveReport:       将最终报告写入 reports 集合（可选，sessionId 作为幂等键）
 *
 * 前端传 sessionId 可以保证"同一个会话反复点击生成报告只存一份"。
 */

const DISCLAIMER =
  '本报告由 AI 基于会话历史自动整理生成，仅作参考，不替代施工/合同/验收等专业决策。';

/** {sessionId, history:[{role,text?,chunks?,scene?,question?}]} */
function validateRequest(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: '请求体必须为 JSON 对象' };
  }
  const { sessionId, history } = input;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return { ok: false, reason: 'sessionId 必填且不能为空字符串' };
  }
  if (!Array.isArray(history)) {
    return { ok: false, reason: 'history 必须为数组' };
  }
  // 至少要有 1 个 assistant 回答才能出清单
  const assistants = history.filter((m) => m && m.role === 'assistant');
  if (assistants.length === 0) {
    return {
      ok: false,
      reason: 'history 中缺少 assistant 回答，请先进行至少 1 次有效咨询',
    };
  }
  return { ok: true, value: { sessionId, history } };
}

function categoryFromSceneOrText(scene, firstChunkClaim) {
  const scenes = new Set(['budget', 'acceptance', 'contract', 'plumbing', 'waterproof', 'materials']);
  if (scene && scenes.has(scene)) return scene;
  const text = `${scene || ''} ${firstChunkClaim || ''}`;
  const rules = [
    { key: 'budget', rx: /预算|报价|超支|加钱|便宜|贵|节省|省钱/ },
    { key: 'contract', rx: /合同|条款|签字|口头|承诺|附件|违约/ },
    { key: 'plumbing', rx: /水电|开槽|强弱电|绕线|打压|插座|电位|电箱/ },
    { key: 'waterproof', rx: /防水|闭水|漏水|卫生间|淋浴|管根|烟道|止水/ },
    { key: 'acceptance', rx: /验收|中期|竣工|空鼓|垂直度|闭水|打压|进场/ },
    { key: 'materials', rx: /主材|瓷砖|板材|乳胶|油漆|进场|批次|环保|E0|ENF/ },
  ];
  for (const r of rules) {
    if (r.rx.test(text)) return r.key;
  }
  return 'general';
}

function buildChecklist(history) {
  // 1) 把 history 里的"user → assistant"组对：找到 assistant 对应的上一条 user 的 scene
  const pairs = [];
  let lastUser = null;
  for (const msg of history) {
    if (!msg) continue;
    if (msg.role === 'user') {
      lastUser = msg;
      continue;
    }
    if (msg.role === 'assistant' && Array.isArray(msg.chunks) && msg.chunks.length > 0) {
      pairs.push({ user: lastUser, assistant: msg });
      lastUser = null;
    }
  }
  const coveredQuestions = pairs.length;

  // 2) 每一对 → 一个 checklist item
  const items = pairs.map(({ user, assistant }) => {
    const chunks = assistant.chunks || [];
    const claimChunk = chunks.find((c) => c.type === 'claim') || chunks[0];
    const stepChunks = chunks.filter((c) => c.type === 'step');
    const warningChunks = chunks.filter((c) => c.type === 'warning');
    const category = categoryFromSceneOrText(user && user.scene, claimChunk && claimChunk.content);
    return {
      category,
      claim: claimChunk ? claimChunk.content : '',
      checks: stepChunks.map((c) => c.content),
      warnings: warningChunks.map((c) => c.content),
    };
  });

  // 3) 按 category 聚合：同分类合并（claim 多条拼接为 Set 去重、checks/warnings 拼接去重）
  // 注意：ChecklistItem.claim 是 string，多条结论以 "；" 分隔；完全重复的 claim 通过 Set 去重。
  const bucket = new Map();
  for (const it of items) {
    const prev = bucket.get(it.category);
    if (!prev) {
      bucket.set(it.category, it);
    } else {
      const claims = Array.from(new Set([prev.claim, it.claim].filter(Boolean)));
      bucket.set(it.category, {
        category: it.category,
        claim: claims.join('；'),
        checks: Array.from(new Set([...prev.checks, ...it.checks])),
        warnings: Array.from(new Set([...prev.warnings, ...it.warnings])),
      });
    }
  }

  // 4) 按 6 场景 → general 固定顺序输出
  const order = ['budget', 'contract', 'plumbing', 'waterproof', 'acceptance', 'materials', 'general'];
  const ordered = [];
  for (const cat of order) {
    if (bucket.has(cat)) ordered.push(bucket.get(cat));
  }
  return { coveredQuestions, items: ordered };
}

async function saveReport(db, { sessionId, openid, items, coveredQuestions, createdAt }) {
  const col = db.collection('reports');
  // 幂等：同 sessionId 只存一份，返回已有 reportId
  const existing = await col
    .where({ sessionId })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  if (existing && existing.data && existing.data[0]) {
    return { reportId: existing.data[0]._id, created: false };
  }
  const reportId =
    'rpt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await col.add({
    data: {
      _id: reportId,
      reportId,
      sessionId,
      openid,
      items,
      coveredQuestions,
      disclaimer: DISCLAIMER,
      createdAt,
    },
  });
  return { reportId, created: true };
}

module.exports = { validateRequest, buildChecklist, saveReport, DISCLAIMER };
