import { callCloudFunction } from './client';
import type { QuotaResponse } from '@/cloudfunctions/shared/types';

/**
 * 调用 quota.get —— 查询当前用户免费额度、付费解锁状态。
 *
 * 需要鉴权（契约 protected=true）：云函数内部通过 wx-server-sdk 拿 openid，
 * 前端无需传参；未登录态/未配置环境会给出明确错误不兜底。
 */
export async function quotaGet(): Promise<QuotaResponse> {
  return callCloudFunction<QuotaResponse>('quota.get', {});
}
