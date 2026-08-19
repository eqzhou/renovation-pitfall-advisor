import Taro from '@tarojs/taro';
import { ROUTES_BY_ID, type ApiRoute } from './contracts/routes';
import type { ApiEnvelope } from '@/cloudfunctions/shared/types';

/**
 * 前端调用配置工厂：所有调用都基于契约 ID，杜绝“手写 URL/云函数名”导致的路径漂移。
 *
 * 说明：小程序端实际网络层由 Taro.request / wx.cloud.callFunction 承载，
 * 此处只产出“契约 → 调用参数”的映射，便于契约测试校验一致性。
 */

export interface ClientCallSpec {
  id: string;
  method: ApiRoute['method'];
  path: ApiRoute['path'];
}

/**
 * 根据契约 ID 生成前端调用参数。
 * 若传入的契约 ID 不存在，立即抛错（透明报错，不做兜底静默）。
 */
export function callSpec(id: string): ClientCallSpec {
  const route = ROUTES_BY_ID.get(id);
  if (!route) {
    throw new Error(`[contract] 未在契约注册表中找到路由: ${id}`);
  }
  return { id: route.id, method: route.method, path: route.path };
}

/**
 * 契约路由 id → 云函数名的约定映射（唯一实现，所有 client 复用）。
 *
 * 命名规则：把契约 id 的 "." 替换成 "-"，得到云函数文件夹名与主入口文件。
 * 例如 ai.ask → ai-ask（对应 src/cloudfunctions/ai-ask/index.js）。
 * 此规则对前后端同一：契约测试不直接测它，但一旦你改映射会立即调用失败（透明报错）。
 */
export function routeIdToCloudFunction(id: string): string {
  return id.replaceAll('.', '-');
}

/**
 * 统一的云函数调用 + envelope 解包入口：消除 5 个 client 文件里重复的样板代码。
 *
 * 透明原则（与项目硬约束一致，绝不静默兜底）：
 *  - CloudBase 未就绪：抛带语境的 Error，引导用户去微信开发者工具开通云开发
 *  - callFunction 抛错：包装为带 [METHOD path] 前缀的 Error
 *  - envelope.code !== 0：抛服务端错误（含 429 额度、400 参数、500 服务异常）
 *  - envelope.data 缺失：抛响应形状非法错误
 *
 * @param id 契约路由 id（如 'ai.ask'）
 * @param data 调用云函数时透传的 data（任意对象形状；TS interface 不自带 string index
 *             signature，无法直接满足 Taro 的 IAnyObject，因此用 object + 内部断言）
 * @returns envelope.data —— 调用方按 T 断言形状
 */
export async function callCloudFunction<T>(id: string, data: object): Promise<T> {
  const spec = callSpec(id);

  if (!Taro.cloud || typeof Taro.cloud.callFunction !== 'function') {
    throw new Error(
      `[${spec.method} ${spec.path}] CloudBase 未就绪，请先在微信开发者工具中开通云开发并完成 appid 配置`,
    );
  }

  // Taro.cloud.callFunction 有两个重载（回调式 / Promise 式）。
  // 不传 success/fail/complete 时走 Promise 重载，返回 Promise<CallFunctionResult>。
  // 这里用 as 断言绕开 Taro SDK 对 data 的 IAnyObject 类型限制（interface 不满足 index signature）。
  let res: { result?: ApiEnvelope<T> };
  try {
    res = (await Taro.cloud.callFunction({
      name: routeIdToCloudFunction(spec.id),
      data,
    } as Parameters<typeof Taro.cloud.callFunction>[0])) as { result?: ApiEnvelope<T> };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`[${spec.method} ${spec.path}] 云函数调用失败: ${detail}`);
  }

  const envelope = res?.result;
  if (!envelope || typeof envelope !== 'object') {
    throw new Error(`[${spec.method} ${spec.path}] 响应格式非法: ${JSON.stringify(res?.result)}`);
  }
  if (envelope.code !== 0) {
    throw new Error(
      `[${spec.method} ${spec.path}] 服务端错误 (code=${envelope.code}): ${envelope.msg || '未提供错误信息'}`,
    );
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw new Error(`[${spec.method} ${spec.path}] 成功响应缺失 data 字段`);
  }
  return envelope.data;
}

/** 前端已引用的契约 ID 集合 —— 测试断言其全部存在且路径唯一 */
export const FRONTEND_REFERENCED_ROUTE_IDS: readonly string[] = [
  'ai.ask',
  'ai.report',
  'quota.get',
  'pay.order.create',
  'feedback.submit',
];
