import { callCloudFunction } from './client';
import type { AiReportResponse } from '@/cloudfunctions/shared/types';

/**
 * 调用 report.get —— 按 reportId 读取已保存的《避坑清单》报告。
 * 分享接收端使用：好友点开转发卡片后，用卡片携带的 reportId 取回同一份报告。
 */
export async function reportGet(reportId: string): Promise<AiReportResponse> {
  return callCloudFunction<AiReportResponse>('report.get', { reportId });
}
