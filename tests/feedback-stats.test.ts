/**
 * feedback.stats（反馈复盘统计）云函数纯函数测试（TDD）。
 *
 * 覆盖：validateStatsRequest 入参；aggregateFeedback 聚合（计数/帮助率/每日分组补零/Top 无帮助问题）；
 * isAdminOpenid 管理员白名单判定。
 */
import { describe, it, expect } from 'vitest';

const fs = require('../src/cloudfunctions/feedback-stats/impl');

const DAY = 86400000;
const base = new Date('2026-08-19T12:00:00+08:00').getTime();

function fb(helpful: boolean, createdAt: number, question?: string) {
  return { helpful, createdAt, question };
}

describe('feedback-stats / validateStatsRequest', () => {
  it('缺省 days => 默认 7', () => {
    const r = fs.validateStatsRequest({});
    expect(r.ok).toBe(true);
    expect(r.value!.days).toBe(7);
  });
  it('合法 days => 通过', () => {
    expect(fs.validateStatsRequest({ days: 14 }).value!.days).toBe(14);
    expect(fs.validateStatsRequest({ days: 1 }).value!.days).toBe(1);
  });
  it('days 非数字 / 超出 1-90 => 400', () => {
    expect(fs.validateStatsRequest({ days: '7' }).ok).toBe(false);
    expect(fs.validateStatsRequest({ days: 0 }).ok).toBe(false);
    expect(fs.validateStatsRequest({ days: 91 }).ok).toBe(false);
    expect(fs.validateStatsRequest({ days: -3 }).ok).toBe(false);
  });
});

describe('feedback-stats / aggregateFeedback', () => {
  it('统计总数/有帮助/无帮助/帮助率（保留一位小数）', () => {
    const records = [fb(true, base), fb(false, base), fb(true, base), fb(true, base)];
    const r = fs.aggregateFeedback(records, 7, base);
    expect(r.total).toBe(4);
    expect(r.helpful).toBe(3);
    expect(r.unhelpful).toBe(1);
    expect(r.helpfulRate).toBe(75);
  });
  it('无记录时全部为 0，不抛错', () => {
    const r = fs.aggregateFeedback([], 7, base);
    expect(r.total).toBe(0);
    expect(r.helpfulRate).toBe(0);
    expect(r.daily).toHaveLength(7);
    expect(r.topUnhelpfulQuestions).toEqual([]);
  });
  it('每日分组按近 N 天补零，含今天的记录正确归位', () => {
    const r = fs.aggregateFeedback([fb(true, base)], 3, base);
    expect(r.daily).toHaveLength(3);
    expect(r.daily[2].total).toBe(1); // 今天
    expect(r.daily[2].helpful).toBe(1);
    expect(r.daily[0].total).toBe(0); // 两天前补零
    expect(r.daily[1].total).toBe(0); // 昨天补零
  });
  it('超过 N 天范围的记录不计入每日分布（但计入总数）', () => {
    const old = base - 10 * DAY;
    const r = fs.aggregateFeedback([fb(false, old)], 7, base);
    expect(r.total).toBe(1);
    expect(r.daily.reduce((s: number, d: { total: number }) => s + d.total, 0)).toBe(0);
  });
  it('topUnhelpfulQuestions 按无帮助次数降序取 Top5', () => {
    const records = [
      fb(false, base, '防水怎么验收'),
      fb(false, base, '防水怎么验收'),
      fb(false, base, '预算怎么控制'),
      fb(true, base, '防水怎么验收'),
    ];
    const r = fs.aggregateFeedback(records, 7, base);
    expect(r.topUnhelpfulQuestions[0]).toEqual({ question: '防水怎么验收', count: 2 });
    expect(r.topUnhelpfulQuestions).toHaveLength(2);
  });
  it('无 question 的无帮助记录不进入 Top', () => {
    const r = fs.aggregateFeedback([fb(false, base, undefined)], 7, base);
    expect(r.topUnhelpfulQuestions).toEqual([]);
  });
});

describe('feedback-stats / isAdminOpenid', () => {
  it('openid 在白名单内 => true（支持逗号分隔多个）', () => {
    expect(fs.isAdminOpenid('oA', 'oA,oB')).toBe(true);
    expect(fs.isAdminOpenid('oB', 'oA,oB')).toBe(true);
  });
  it('不在白名单 / 白名单为空 / 输入空 => false', () => {
    expect(fs.isAdminOpenid('oC', 'oA,oB')).toBe(false);
    expect(fs.isAdminOpenid('oA', '')).toBe(false);
    expect(fs.isAdminOpenid('oA', undefined)).toBe(false);
    expect(fs.isAdminOpenid('', 'oA')).toBe(false);
  });
  it('忽略空白与大小写差异', () => {
    expect(fs.isAdminOpenid('oA', ' oA , oB ')).toBe(true);
    expect(fs.isAdminOpenid('oa', 'OA')).toBe(true);
  });
});
