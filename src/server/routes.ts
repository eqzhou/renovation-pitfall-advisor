import type { HttpMethod } from '../api/contracts/routes';

/**
 * 服务端路由注册表 —— 云函数层的“实现清单”。
 *
 * M1 阶段为空桩：契约测试会因“契约路由未被服务端实现”而处于红色。
 * M2 实现 /ai/ask 时，在此按 AUTHORS 顺序注册对应处理器即可转绿。
 * 禁止在此注册契约之外的路由；新增路由必须先改 contracts/routes.ts 用例。
 */

export interface ServerRouteImpl {
  id: string;
  method: HttpMethod;
  path: string;
  /** 处理器占位：M2 起填充真实实现 */
  handler?: string;
}

/** 服务端已实现的契约路由索引（id → 实现） */
export const serverRouteRegistry: ReadonlyMap<string, ServerRouteImpl> = new Map();

/**
 * 将一条契约路由标记为"服务端已实现"。
 * 供 M2 起的云函数启动阶段调用（bootstrap），契约测试会据此断言一致性。
 */
export function registerServerRoute(impl: ServerRouteImpl): void {
  const map = serverRouteRegistry as Map<string, ServerRouteImpl>;
  map.set(impl.id, impl);
}

// —— 已上线契约路由注册清单（按实现时间顺序追加，不允许删除；仅允许新增） ——
// M2: 最小问答闭环 —— AI 咨询对话 + 6 个装修场景知识库 Mock
registerServerRoute({
  id: 'ai.ask',
  method: 'POST',
  path: '/ai/ask',
  handler: 'cloudfunctions/ai-ask/index.main',
});
// M3: 额度/付费链路（契约测试先绿，云函数实现紧随其后）
registerServerRoute({
  id: 'quota.get',
  method: 'GET',
  path: '/quota',
  handler: 'cloudfunctions/quota/index.main',
});
registerServerRoute({
  id: 'pay.order.create',
  method: 'POST',
  path: '/pay/order',
  handler: 'cloudfunctions/pay-order/index.main',
});
// M5: 报告 + 反馈（契约里原先两条预留路由）
registerServerRoute({
  id: 'ai.report',
  method: 'POST',
  path: '/ai/report',
  handler: 'cloudfunctions/ai-report/index.main',
});
registerServerRoute({
  id: 'feedback.submit',
  method: 'POST',
  path: '/feedback',
  handler: 'cloudfunctions/feedback/index.main',
});