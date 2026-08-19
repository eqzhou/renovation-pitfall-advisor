import { callCloudFunction } from './client';
import type { FeedbackStatsResponse } from '@/cloudfunctions/shared/types';

/**
 * 调用 feedback.stats —— 反馈复盘统计（仅管理员白名单可见，否则服务端 403）。
 */
export async function feedbackStats(days?: number): Promise<FeedbackStatsResponse> {
  return callCloudFunction<FeedbackStatsResponse>('feedback.stats', {
    ...(days !== undefined ? { days } : {}),
  });
}
