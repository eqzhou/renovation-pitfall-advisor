/**
 * 报告导出文本格式化 —— 纯函数测试（TDD）。
 *
 * formatReportToText：把 AiReportResponse 渲染成可复制的 Markdown 文本，
 * 供「复制清单」按钮导出；无 Taro/IO 依赖，可在 vitest node 直接跑。
 */
import { describe, it, expect } from 'vitest';
import { formatReportToText, CATEGORY_LABELS } from '../src/utils/report-format';
import type { AiReportResponse } from '@/cloudfunctions/shared/types';

const report: AiReportResponse = {
  reportId: 'rpt_1',
  createdAt: 1_700_000_000_000,
  coveredQuestions: 2,
  items: [
    {
      category: 'budget',
      claim: '预算要预留 15% 浮动空间',
      checks: ['拆成五栏分别报价', '写死增项上限 5%'],
      warnings: ['警惕低价签单后期增项'],
    },
    {
      category: 'waterproof',
      claim: '卫生间防水淋浴区刷 1.8m 高',
      checks: ['闭水试验 48 小时'],
      warnings: [],
    },
  ],
  disclaimer: '本报告由 AI 自动整理生成，仅作参考。',
};

describe('formatReportToText', () => {
  it('输出包含分类标题与核心结论', () => {
    const t = formatReportToText(report);
    expect(t).toContain(CATEGORY_LABELS['budget']);
    expect(t).toContain('预算要预留 15% 浮动空间');
    expect(t).toContain(CATEGORY_LABELS['waterproof']);
  });

  it('输出包含逐项核对与风险提醒', () => {
    const t = formatReportToText(report);
    expect(t).toContain('拆成五栏分别报价');
    expect(t).toContain('写死增项上限 5%');
    expect(t).toContain('警惕低价签单后期增项');
  });

  it('warnings 为空时不输出风险提醒块', () => {
    const t = formatReportToText(report);
    // waterproof 无 warnings，不应出现"风险提醒"字样在第二段之后的无内容占位
    // 简单断言：整个文本仍包含一次"风险提醒"（来自 budget 段），但不含空块标记
    expect(t).toContain('风险提醒');
    expect(t).not.toContain('风险提醒：\n（无）');
  });

  it('结尾附免责声明原文', () => {
    const t = formatReportToText(report);
    expect(t.trimEnd().endsWith('本报告由 AI 自动整理生成，仅作参考。')).toBe(true);
  });

  it('空 items 输出空清单占位且不抛错', () => {
    const t = formatReportToText({ ...report, items: [] });
    expect(t).toContain('暂无可聚合的清单项');
  });
});

describe('CATEGORY_LABELS', () => {
  it('6 大场景 + general 均有中文标签', () => {
    for (const k of ['budget', 'contract', 'plumbing', 'waterproof', 'acceptance', 'materials', 'general']) {
      expect(CATEGORY_LABELS[k]).toBeTruthy();
    }
  });
});
