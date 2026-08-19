/**
 * API 路径契约 —— 单一事实源（Single Source of Truth）
 *
 * 规则：新增/修改 API 时，必须在 tests/api-contract.test.ts 中先用例（红），
 * 再到服务端 src/server/routes.ts 注册实现（绿）。
 * 禁止前端手写散落的 URL/云函数名。
 */

/** HTTP 方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** 一条 API 路径契约 */
export interface ApiRoute {
  /** 稳定标识：作为云函数路由名 / 前端调用键（不可随意变更，变更需走契约流程） */
  id: string;
  method: HttpMethod;
  /** 语义路径，如 /ai/ask（供可读诊断与日志） */
  path: string;
  /** 功能标签，用于测试与文档归类 */
  tags: string[];
  /** 鉴权要求：是否需要登录态 openid */
  protected: boolean;
  /** 说明该路由的职责边界 */
  summary: string;
}

/**
 * 第一批 API 路径契约（来自 M1 规划的五条核心接口）。
 * 语义路径统一以斜杠开头、snake_case 命名。
 */
export const API_ROUTES: readonly ApiRoute[] = [
  {
    id: 'ai.ask',
    method: 'POST',
    path: '/ai/ask',
    tags: ['ai', 'chat'],
    protected: false,
    summary: 'AI 咨询对话：输入场景+问题，返回结构化流式答复',
  },
  {
    id: 'ai.report',
    method: 'POST',
    path: '/ai/report',
    tags: ['ai', 'report'],
    protected: true,
    summary: '基于会话生成并返回《装修避坑清单》报告',
  },
  {
    id: 'report.get',
    method: 'GET',
    path: '/report',
    tags: ['ai', 'report'],
    protected: false,
    summary: '按 reportId 读取已保存的报告（分享接收端使用；reportId 即访问凭证）',
  },
  {
    id: 'quota.get',
    method: 'GET',
    path: '/quota',
    tags: ['quota', 'billing'],
    protected: true,
    summary: '查询当前用户免费额度使用情况与解锁状态',
  },
  {
    id: 'pay.order.create',
    method: 'POST',
    path: '/pay/order',
    tags: ['pay', 'billing'],
    protected: true,
    summary: '创建微信支付订单并返回调起支付参数',
  },
  {
    id: 'feedback.submit',
    method: 'POST',
    path: '/feedback',
    tags: ['feedback'],
    protected: false,
    summary: '提交单条回答的“有帮助/无帮助”反馈，不阻塞主流程',
  },
  {
    id: 'feedback.stats',
    method: 'GET',
    path: '/feedback/stats',
    tags: ['feedback', 'ops'],
    protected: true,
    summary: '反馈复盘统计：近 N 天帮助率/每日分布/无帮助问题 Top（仅管理员白名单可见）',
  },
];

/** 契约路由索引：id → route（测试与客户端调用均基于此，避免散落字符串） */
export const ROUTES_BY_ID: ReadonlyMap<string, ApiRoute> = new Map(
  API_ROUTES.map((r) => [r.id, r]),
);

/**
 * 生成契约路由在日志/诊断中的规范标识。
 * 组合形式：`{METHOD} {path}`，如 `POST /ai/ask`。
 */
export function routeKey(route: ApiRoute): string {
  return `${route.method} ${route.path}`;
}