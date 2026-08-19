import { callCloudFunction } from './client';
import type { AiReportResponse } from '@/cloudfunctions/shared/types';

/** 前端传给 ai.report 的历史消息：与首页 messages 结构一致，为了保证类型一致这里再导出一遍 */
export interface ReportTurnUser {
  role: 'user';
  text: string;
  scene?: string;
}
export interface ReportTurnAssistant {
  role: 'assistant';
  chunks: { type: 'claim' | 'step' | 'warning'; content: string }[];
  disclaimer: string;
}
export type ReportHistory = (ReportTurnUser | ReportTurnAssistant)[];

/**
 * 调用 ai.report —— 基于会话生成《避坑清单》报告
 * protected=true：服务端需要 openid 做归属；未配置环境透明报错不兜底。
 */
export async function aiReport(req: {
  sessionId: string;
  history: ReportHistory;
}): Promise<AiReportResponse> {
  return callCloudFunction<AiReportResponse>('ai.report', req);
}
