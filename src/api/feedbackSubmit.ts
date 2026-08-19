import { callCloudFunction } from './client';
import type {
  FeedbackSubmitRequest,
  FeedbackSubmitResponse,
} from '@/cloudfunctions/shared/types';

/**
 * 调用 feedback.submit —— 提交单条回答的评价（不阻塞主流程）。
 *
 * 契约 feedback.submit protected=false；但为了归属分析仍会附带 openid（未登录则为空串）。
 * 即使调用失败也仅在前端给出轻提示，不影响用户继续提问。
 */
export async function feedbackSubmit(
  req: FeedbackSubmitRequest,
): Promise<FeedbackSubmitResponse> {
  return callCloudFunction<FeedbackSubmitResponse>('feedback.submit', req);
}
