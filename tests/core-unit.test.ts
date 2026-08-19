/**
 * 核心纯函数单元测试（TDD 补缺口）。
 *
 * 覆盖范围：
 *  1) ai-ask/impl: validateRequest / parseChunksFromLLM / mockAnswer
 *  2) ai-report/impl: validateRequest / buildChecklist
 *  3) feedback/impl: validateRequest
 *  4) shared/utils: isPaidActive / today+addDays 时区一致性 / PLAN_TO_META 映射
 *
 * 所有被测函数都是纯函数（无 IO），直接 require + 调，不依赖 wx-server-sdk，
 * 可在 vitest node 环境下直接跑。
 */
import { describe, it, expect } from 'vitest';

// 注意：这些 .js 云函数源码直接 require，需 TS 编译期接受 commonjs —— vitest + tsconfig allowJs 已支持
const aiAsk = require('../src/cloudfunctions/ai-ask/impl');
const aiReport = require('../src/cloudfunctions/ai-report/impl');
const feedback = require('../src/cloudfunctions/feedback/impl');
const utils = require('../src/cloudfunctions/shared/utils');

// ———————————— 1. ai-ask ————————————
describe('ai-ask / validateRequest', () => {
  it('scene 缺省、question 非空 => 通过', () => {
    const r = aiAsk.validateRequest({ question: '我家防水怎么做' });
    expect(r.ok).toBe(true);
    expect(r.value!.scene).toBeUndefined();
    expect(r.value!.question).toBe('我家防水怎么做');
  });
  it('scene 6 个合法值全部通过', () => {
    for (const scene of ['budget', 'acceptance', 'contract', 'plumbing', 'waterproof', 'materials']) {
      const r = aiAsk.validateRequest({ scene, question: 'hello' });
      expect(r.ok).toBe(true);
      expect(r.value!.scene).toBe(scene);
    }
  });
  it('scene 非法值 => 400', () => {
    const r = aiAsk.validateRequest({ scene: 'xxx', question: 'hello' });
    expect(r.ok).toBe(false);
    expect(r.reason!).toContain('scene 字段不合法');
  });
  it('question 空字符串 / 空白 => 400', () => {
    expect(aiAsk.validateRequest({ question: '' }).ok).toBe(false);
    expect(aiAsk.validateRequest({ question: '   ' }).ok).toBe(false);
  });
  it('question 缺字段 => 400', () => {
    expect(aiAsk.validateRequest({ scene: 'budget' }).ok).toBe(false);
    expect(aiAsk.validateRequest(undefined as any).ok).toBe(false);
    expect(aiAsk.validateRequest(null as any).ok).toBe(false);
    expect(aiAsk.validateRequest('str' as any).ok).toBe(false);
  });
  it('question 长度超过 1000 字 => 400（新约束）', () => {
    const long = '好'.repeat(1001);
    expect(aiAsk.validateRequest({ question: long }).ok).toBe(false);
  });
});

// 用 eval 访问 module.exports 的私有函数（非导出的 parseChunksFromLLM 测试会通过 aiAsk 的 mockAnswer 间接覆盖，
// 为了真正覆盖 parse 层，我们在 impl.js 末尾补了导出 parseChunksFromLLM）。
describe('ai-ask / parseChunksFromLLM', () => {
  const parse = aiAsk.parseChunksFromLLM as (raw: any) => unknown[];

  it('合法 JSON 数组形状 => 正确映射', () => {
    const input = JSON.stringify([
      { type: 'claim', content: '核心结论' },
      { type: 'step', content: '第 1 步' },
      { type: 'warning', content: '危险提醒' },
    ]);
    const r = parse(input);
    expect(r).toEqual([
      { type: 'claim', content: '核心结论' },
      { type: 'step', content: '第 1 步' },
      { type: 'warning', content: '危险提醒' },
    ]);
  });
  it('```json 代码块包裹 => 自动解包', () => {
    const input = '```json\n[{"type":"claim","content":"hi"}]\n```';
    expect(parse(input)).toEqual([{ type: 'claim', content: 'hi' }]);
  });
  it('普通 ``` 包裹（无 json 标识）=> 自动解包', () => {
    const input = '```\n[{"type":"claim","content":"hi"}]\n```';
    expect(parse(input)).toEqual([{ type: 'claim', content: 'hi' }]);
  });
  it('前后有废话，中间一个数组 => 用 firstArr/lastArr 切出', () => {
    const input = '好的，给你答复：\n[{ "type": "claim", "content": "结果" }]\n以上是建议';
    expect(parse(input)).toEqual([{ type: 'claim', content: '结果' }]);
  });
  it('空数组 => 非法（至少需要 1 个 chunk）', () => {
    expect(() => parse('[]')).toThrow();
  });
  it('非数组（对象）=> 非法', () => {
    expect(() => parse('{"a":1}')).toThrow();
  });
  it('type 不在 claim/step/warning => 非法', () => {
    expect(() => parse('[{"type":"foo","content":"x"}]')).toThrow();
  });
  it('缺少 content => 非法', () => {
    expect(() => parse('[{"type":"claim"}]')).toThrow();
  });
  it('非字符串输入 => 非法', () => {
    expect(() => parse(null as any)).toThrow();
    expect(() => parse(undefined as any)).toThrow();
    expect(() => parse(42 as any)).toThrow();
  });
  it('chunk 有多余字段不影响（被 map 过滤）', () => {
    const r = parse('[{"type":"step","content":"ok","extra":123}]') as any[];
    expect(r[0]).toEqual({ type: 'step', content: 'ok' });
  });
});

describe('ai-ask / mockAnswer', () => {
  it('6 个 scene 都能拿到 ≥4 chunks 的结构化回答，含 disclaimer', () => {
    for (const scene of ['budget', 'acceptance', 'contract', 'plumbing', 'waterproof', 'materials']) {
      const a = aiAsk.mockAnswer({ scene, question: 'test' });
      expect(a.chunks.length).toBeGreaterThanOrEqual(4);
      expect(a.chunks.some((c: any) => c.type === 'claim')).toBe(true);
      expect(a.chunks.some((c: any) => c.type === 'step')).toBe(true);
      expect(a.chunks.some((c: any) => c.type === 'warning')).toBe(true);
      expect(typeof a.disclaimer).toBe('string');
      expect(a.disclaimer.length).toBeGreaterThan(0);
    }
  });
  it('scene 缺省时走 genericAnswer，含 claim/step/warning', () => {
    const a = aiAsk.mockAnswer({ question: '我想问个自定义问题' });
    expect(a.chunks.some((c: any) => c.type === 'claim')).toBe(true);
    expect(a.chunks.some((c: any) => c.type === 'step')).toBe(true);
    expect(a.chunks.some((c: any) => c.type === 'warning')).toBe(true);
  });
});

// ———————————— 2. ai-report ————————————
describe('ai-report / validateRequest', () => {
  it('sessionId 空 => 400', () => {
    expect(aiReport.validateRequest({ sessionId: '', history: [] }).ok).toBe(false);
    expect(aiReport.validateRequest({ history: [] }).ok).toBe(false);
  });
  it('history 非数组 => 400', () => {
    expect(aiReport.validateRequest({ sessionId: 's', history: 'abc' as any }).ok).toBe(false);
    expect(aiReport.validateRequest({ sessionId: 's', history: null as any }).ok).toBe(false);
  });
  it('history 中没有 assistant => 400', () => {
    const r = aiReport.validateRequest({
      sessionId: 's',
      history: [{ role: 'user', text: 'hi' }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason!).toContain('缺少 assistant 回答');
  });
  it('至少 1 个带 chunks 的 assistant => 通过', () => {
    const r = aiReport.validateRequest({
      sessionId: 's',
      history: [
        { role: 'user', text: 'hi', scene: 'budget' },
        { role: 'assistant', chunks: [{ type: 'claim', content: 'ok' }] },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe('ai-report / buildChecklist', () => {
  const history1 = [
    { role: 'user', text: '预算', scene: 'budget' as const },
    {
      role: 'assistant' as const,
      chunks: [
        { type: 'claim' as const, content: '预算要拆分五栏' },
        { type: 'step' as const, content: '拆硬装' },
        { type: 'step' as const, content: '写 5% 上限' },
        { type: 'warning' as const, content: '警惕低价签单' },
      ],
    },
    { role: 'user', text: '防水', scene: 'waterproof' as const },
    {
      role: 'assistant' as const,
      chunks: [
        { type: 'claim' as const, content: '防水高度要够' },
        { type: 'step' as const, content: '淋浴区 1.8m' },
        { type: 'warning' as const, content: '管根增强' },
      ],
    },
  ];

  it('按对答组对，coveredQuestions = 2', () => {
    const { coveredQuestions, items } = aiReport.buildChecklist(history1);
    expect(coveredQuestions).toBe(2);
    expect(items.map((it: any) => it.category)).toEqual(['budget', 'waterproof']);
  });

  it('claim / checks / warnings 拆分正确', () => {
    const { items } = aiReport.buildChecklist(history1);
    expect(items[0].claim).toBe('预算要拆分五栏');
    expect(items[0].checks).toEqual(['拆硬装', '写 5% 上限']);
    expect(items[0].warnings).toEqual(['警惕低价签单']);
  });

  it('同 category 合并：checks/warnings 去重，claims 拼接（不丢第二条）', () => {
    const history2 = [
      { role: 'user', text: 'q1', scene: 'budget' as const },
      {
        role: 'assistant' as const,
        chunks: [
          { type: 'claim' as const, content: 'claim A' },
          { type: 'step' as const, content: 'step 1' },
          { type: 'warning' as const, content: 'warn 1' },
        ],
      },
      { role: 'user', text: 'q2', scene: 'budget' as const },
      {
        role: 'assistant' as const,
        chunks: [
          { type: 'claim' as const, content: 'claim B' },
          { type: 'step' as const, content: 'step 1' }, // 与上一条重复 => 去重
          { type: 'step' as const, content: 'step 2' },
          { type: 'warning' as const, content: 'warn 2' },
        ],
      },
    ];
    const { coveredQuestions, items } = aiReport.buildChecklist(history2);
    expect(coveredQuestions).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('budget');
    // checks 去重：step 1 只留一次；step 2 加上
    expect(items[0].checks).toEqual(['step 1', 'step 2']);
    // claims 两条都保留：拼接
    expect(items[0].claim).toContain('claim A');
    expect(items[0].claim).toContain('claim B');
    // warnings 两条都有
    expect(items[0].warnings).toEqual(['warn 1', 'warn 2']);
  });

  it('category 顺序：6 场景 → general，缺失的跳过', () => {
    const history = [
      { role: 'user', text: '' },
      { role: 'assistant' as const, chunks: [{ type: 'claim' as const, content: '通用' }] },
    ];
    const { items } = aiReport.buildChecklist(history);
    expect(items[0].category).toBe('general');
  });

  it('非 scene 消息靠 claim 文本关键词自动分类（contract 例）', () => {
    const history = [
      { role: 'user', text: '' },
      {
        role: 'assistant' as const,
        chunks: [{ type: 'claim' as const, content: '合同违约条款要写死' }],
      },
    ];
    const { items } = aiReport.buildChecklist(history);
    expect(items[0].category).toBe('contract');
  });

  it('assistant 没有 chunks 的消息被跳过，不影响 coveredQuestions 计算', () => {
    const history = [
      { role: 'assistant' as const, chunks: [] }, // 空 chunks 跳过
      { role: 'user', text: '' },
      {
        role: 'assistant' as const,
        chunks: [{ type: 'claim' as const, content: 'OK' }],
      },
    ];
    const { coveredQuestions, items } = aiReport.buildChecklist(history);
    expect(coveredQuestions).toBe(1);
    expect(items).toHaveLength(1);
  });
});

// ———————————— 3. feedback ————————————
describe('feedback / validateRequest', () => {
  it('answerId 必填、helpful 必须布尔', () => {
    expect(feedback.validateRequest(null).ok).toBe(false);
    expect(feedback.validateRequest({}).ok).toBe(false);
    expect(feedback.validateRequest({ answerId: '', helpful: true }).ok).toBe(false);
    expect(feedback.validateRequest({ answerId: 'a_1', helpful: 1 as any }).ok).toBe(false);
  });
  it('comment/question 非字符串 => 400', () => {
    expect(
      feedback.validateRequest({ answerId: 'a_1', helpful: true, comment: 42 as any }).ok,
    ).toBe(false);
    expect(
      feedback.validateRequest({ answerId: 'a_1', helpful: true, question: {} as any }).ok,
    ).toBe(false);
  });
  it('comment 超过 500 字 => 截断到 500；question 超过 300 => 截断到 300', () => {
    const r = feedback.validateRequest({
      answerId: 'a_1',
      helpful: false,
      comment: 'x'.repeat(600),
      question: 'y'.repeat(500),
    });
    expect(r.ok).toBe(true);
    expect(r.value!.comment!.length).toBe(500);
    expect(r.value!.question!.length).toBe(300);
  });
  it('合法请求通过', () => {
    const r = feedback.validateRequest({
      answerId: 'a_1',
      helpful: true,
      comment: 'OK',
      question: '防水怎么做',
    });
    expect(r.ok).toBe(true);
    expect(r.value!).toEqual({
      answerId: 'a_1',
      helpful: true,
      comment: 'OK',
      question: '防水怎么做',
    });
  });
});

// ———————————— 4. shared/utils ————————————
describe('utils / isPaidActive', () => {
  // isPaidActive 内部直接调用 today() 本地闭包（不是 module.exports.today），所以不 stub today。
  // 改为基于真实 today() 计算相对日期来测边界。
  const todayStr = utils.today();
  const tomorrow = utils.addDays(1);
  const yesterday = utils.addDays(-1);

  it('plan=forever => 永远 true', () => {
    expect(utils.isPaidActive({ plan: 'forever', paid_until: 'forever' })).toBe(true);
    expect(utils.isPaidActive({ plan: 'forever', paid_until: '' })).toBe(true);
  });
  it('paid_until >= 今天 => true；< 今天 => false', () => {
    expect(utils.isPaidActive({ plan: 'day', paid_until: todayStr })).toBe(true);
    expect(utils.isPaidActive({ plan: 'week', paid_until: tomorrow })).toBe(true);
    expect(utils.isPaidActive({ plan: 'month', paid_until: yesterday })).toBe(false);
  });
  it('未付费/空 plan 或空 paid_until => false', () => {
    expect(utils.isPaidActive(null)).toBe(false);
    expect(utils.isPaidActive(undefined)).toBe(false);
    expect(utils.isPaidActive({ plan: '', paid_until: '' })).toBe(false);
    expect(utils.isPaidActive({ plan: '', paid_until: tomorrow })).toBe(false); // plan 必须非空
    expect(utils.isPaidActive({ plan: 'day', paid_until: '' })).toBe(false);
  });
});

describe('utils / today + addDays', () => {
  it('today() 与 addDays(0) 都为相同格式 YYYY-MM-DD，单数字带前导 0', () => {
    const today = utils.today();
    const add0 = utils.addDays(0);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(add0).toBe(today); // addDays(0) 等于今天
  });
  it('addDays(1) = 明天；addDays(-1) = 昨天', () => {
    const now = new Date();
    const shifted = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60 * 1000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${d.getMonth() + 1 < 10 ? '0' : ''}${d.getMonth() + 1}-${d.getDate() < 10 ? '0' : ''}${d.getDate()}`;
    const tomorrow = new Date(shifted);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(shifted);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(utils.addDays(1)).toBe(fmt(tomorrow));
    expect(utils.addDays(-1)).toBe(fmt(yesterday));
  });
});

describe('utils / PLAN_TO_META', () => {
  it('4 个 unlock_* 映射与 pay-order 前端常量一一对应（顺序敏感）', () => {
    expect(utils.PLAN_TO_META).toEqual({
      unlock_day: { plan: 'day', days: 1 },
      unlock_week: { plan: 'week', days: 7 },
      unlock_month: { plan: 'month', days: 30 },
      unlock_forever: { plan: 'forever', days: Number.POSITIVE_INFINITY },
    });
  });
});
