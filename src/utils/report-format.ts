/**
 * 报告导出为文本 —— 纯函数（无 Taro/IO，可在 vitest node 直接测试）。
 *
 * 把《避坑清单》(AiReportResponse) 渲染成可复制的 Markdown 文本，
 * 供「复制清单」按钮导出到剪贴板/备忘录。
 */
import type { AiReportResponse } from '@/cloudfunctions/shared/types';

/** 分类 → 中文标签（与页面展示一致，独立维护避免依赖页面模块） */
export const CATEGORY_LABELS: Record<string, string> = {
  budget: '预算超支',
  contract: '合同避坑',
  plumbing: '水电改造',
  waterproof: '防水验收',
  acceptance: '阶段验收',
  materials: '主材进场',
  general: '通用建议',
};

export function formatReportToText(report: AiReportResponse): string {
  const lines: string[] = ['《装修避坑清单》', ''];

  if (!report.items || report.items.length === 0) {
    lines.push('暂无可聚合的清单项。', '');
  } else {
    report.items.forEach((it, idx) => {
      lines.push(`${idx + 1}. ${CATEGORY_LABELS[it.category] || it.category}`, '');
      if (it.claim) lines.push(`核心结论：${it.claim}`, '');
      if (it.checks && it.checks.length > 0) {
        lines.push('逐项核对：');
        it.checks.forEach((c) => lines.push(`  □ ${c}`));
        lines.push('');
      }
      if (it.warnings && it.warnings.length > 0) {
        lines.push('风险提醒：');
        it.warnings.forEach((w) => lines.push(`  ⚠ ${w}`));
        lines.push('');
      }
    });
  }

  lines.push(report.disclaimer || '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
