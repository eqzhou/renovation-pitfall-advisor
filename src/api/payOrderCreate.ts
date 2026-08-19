import { callCloudFunction } from './client';
import type {
  PayOrderCreateRequest,
  PayOrderCreateResponse,
} from '@/cloudfunctions/shared/types';

/**
 * 调用 pay.order.create —— 创建付费订单并返回支付参数。
 *
 * protected=true，云函数内部基于 openid 创建订单；未配置真实支付环境时，
 * 云函数会返回 hint（透明提示）而不是静默兜底，前端可据此展示支付引导。
 */
export async function payOrderCreate(
  req: PayOrderCreateRequest,
): Promise<PayOrderCreateResponse> {
  return callCloudFunction<PayOrderCreateResponse>('pay.order.create', req);
}
