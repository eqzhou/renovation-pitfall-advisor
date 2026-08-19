/**
 * report.get（按 reportId 读取已保存报告）云函数纯函数测试（TDD）。
 *
 * 覆盖：validateGetRequest 入参校验；normalizeReportDoc 文档→响应映射（缺失字段兜底）。
 */
import { describe, it, expect } from 'vitest';

const rg = require('../src/cloudfunctions/report-get/impl');

describe('report-get / validateGetRequest', () => {
  it('reportId 合法 => 通过', () => {
    const r = rg.validateGetRequest({ reportId: 'rpt_abc123' });
    expect(r.ok).toBe(true);
    expect(r.value!.reportId).toBe('rpt_abc123');
  });
  it('reportId 缺失 / 空字符串 => 400', () => {
    expect(rg.validateGetRequest({}).ok).toBe(false);
    expect(rg.validateGetRequest({ reportId: '' }).ok).toBe(false);
    expect(rg.validateGetRequest({ reportId: '   ' }).ok).toBe(false);
    expect(rg.validateGetRequest(null as any).ok).toBe(false);
    expect(rg.validateGetRequest(undefined as any).ok).toBe(false);
  });
  it('reportId 非字符串 => 400', () => {
    expect(rg.validateGetRequest({ reportId: 123 }).ok).toBe(false);
    expect(rg.validateGetRequest({ reportId: ['x'] }).ok).toBe(false);
  });
});

describe('report-get / normalizeReportDoc', () => {
  it('文档字段完整 => 映射为 AiReportResponse', () => {
    const doc = {
      _id: 'rpt_1',
      reportId: 'rpt_1',
      items: [{ category: 'budget', claim: 'c', checks: ['a'], warnings: ['w'] }],
      coveredQuestions: 1,
      disclaimer: '免责',
      createdAt: 1700000000000,
    };
    const r = rg.normalizeReportDoc(doc);
    expect(r.reportId).toBe('rpt_1');
    expect(r.coveredQuestions).toBe(1);
    expect(r.items).toHaveLength(1);
    expect(r.disclaimer).toBe('免责');
    expect(r.createdAt).toBe(1700000000000);
  });
  it('报告不存在（null）=> 返回 null', () => {
    expect(rg.normalizeReportDoc(null)).toBeNull();
    expect(rg.normalizeReportDoc(undefined)).toBeNull();
  });
  it('缺失可选字段 => 安全兜底（items/coveredQuestions 等）', () => {
    const r = rg.normalizeReportDoc({ _id: 'rpt_1' });
    expect(r).not.toBeNull();
    expect(Array.isArray(r!.items)).toBe(true);
    expect(r!.coveredQuestions).toBe(0);
    expect(typeof r!.disclaimer).toBe('string');
    expect(typeof r!.createdAt).toBe('number');
  });
});
