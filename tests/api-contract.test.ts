/**
 * API 路径契约一致性测试（路径契约测试）
 *
 * 守护目标：防止“前端调用路径 / 云函数路由名”前后端不一致。
 * 规则：新增 API 路由时必须先在此添加用例（红），再到 src/server/routes.ts 实现（绿）。
 *
 * M1 状态说明：
 *  - 用例 1-4 应通过（搭建/唯一性/前端引用一致性）——证明测试桩与校验逻辑正确。
 *  - 用例 5（契约 ⊆ 服务端实现）当前处于【红】状态：服务端注册表为空桩，
 *    这正是 TDD 的起点，M2 注册 /ai/ask 实现后转绿。
 */
import { describe, it, expect } from 'vitest';
import {
  API_ROUTES,
  ROUTES_BY_ID,
  routeKey,
  type ApiRoute,
} from '../src/api/contracts/routes';
import { callSpec, FRONTEND_REFERENCED_ROUTE_IDS } from '../src/api/client';
import { serverRouteRegistry } from '../src/server/routes';

describe('API 路径契约', () => {
  it('契约路由存在且非空', () => {
    expect(API_ROUTES.length).toBeGreaterThan(0);
  });

  it('每个契约路由的 method+path 组合唯一（无重复注册）', () => {
    const keys = API_ROUTES.map(routeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('路由 id 全局唯一', () => {
    const ids = API_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('语义路径格式合法：小写 snake_case、以 / 开头、无尾斜杠', () => {
    for (const route of API_ROUTES) {
      expect(route.path.startsWith('/')).toBe(true);
      expect(route.path.endsWith('/')).toBe(false);
      expect(route.path).toMatch(/^\/[a-z0-9]+(\/[a-z0-9]+)*$/);
    }
  });

  it('前端引用的每个契约 ID 均已注册，且调用路径与契约一致（杜绝前端手写路径）', () => {
    for (const id of FRONTEND_REFERENCED_ROUTE_IDS) {
      const spec = callSpec(id);
      const route = ROUTES_BY_ID.get(id)!;
      expect(spec.method).toBe(route.method);
      expect(spec.path).toBe(route.path);
    }
  });

  it('【TDD 红】契约中的每条路由都已被服务端注册，且 method+path 与契约一致（防止前后端漂移）', () => {
    const unimplemented: string[] = [];
    for (const route of API_ROUTES) {
      const impl = serverRouteRegistry.get(route.id);
      if (!impl) {
        unimplemented.push(`未实现: ${routeKey(route)}`);
        continue;
      }
      expect(impl.method).toBe(route.method);
      expect(impl.path).toBe(route.path);
    }
    // 任何未实现路由都会让本用例失败（红），需到 src/server/routes.ts 补注册
    expect(unimplemented).toEqual([]);
  });
});