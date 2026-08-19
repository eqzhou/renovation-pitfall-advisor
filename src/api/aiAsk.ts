import { callCloudFunction } from './client';
import type { AiAskRequest, AiAskResponse } from '@/cloudfunctions/shared/types';

/**
 * 调用 ai.ask 的前端封装：优先云函数调用，异常时给出明确错误，不做兜底静默。
 * 透明报错与 envelope 解包逻辑统一收敛在 client.ts 的 callCloudFunction。
 */
export async function aiAsk(req: AiAskRequest): Promise<AiAskResponse> {
  return callCloudFunction<AiAskResponse>('ai.ask', req);
}
