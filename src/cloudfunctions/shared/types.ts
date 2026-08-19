/**
 * 云函数共享类型。
 *
 * M2 先跑通「单场景 AI 问答 + Mock」链路；真实大模型接入时，
 * 只需替换 ai-ask 内部的 model 调用，不影响前端契约。
 */

export type AiScene =
  | 'budget' // 预算
  | 'acceptance' // 验收
  | 'contract' // 合同
  | 'plumbing' // 水电
  | 'waterproof' // 防水
  | 'materials'; // 材料

/** AI 咨询请求体 */
export interface AiAskRequest {
  scene?: AiScene;
  question: string;
}

/** 流式回答块（M2 先全量返回，不真正流式，类型上保留 chunk 形态便于后续平滑切换） */
export interface AiAnswerChunk {
  content: string;
  /** 段落类型：结论 / 步骤 / 提醒 */
  type: 'claim' | 'step' | 'warning';
}

/** AI 咨询响应体 */
export interface AiAskResponse {
  chunks: AiAnswerChunk[];
  disclaimer: string;
}

/** AI 报告：基于会话历史的结构化《避坑清单》 */
export interface ChecklistItem {
  /** 项目所属分类，按 6 大场景聚合 */
  category: AiScene | 'general';
  /** 核心结论 */
  claim: string;
  /** 逐条可核对的要点（1 条 chunk 对应 1 条） */
  checks: string[];
  /** 风险提醒（如果对应回答里有 warning chunks） */
  warnings: string[];
}

export interface AiReportResponse {
  /** 报告唯一 ID，可保存到集合便于后续分享 */
  reportId: string;
  /** 报告生成时间（毫秒戳） */
  createdAt: number;
  /** 会话中一共纳入了多少条提问 */
  coveredQuestions: number;
  /** 结构化核对项（按 category 聚合） */
  items: ChecklistItem[];
  /** 免责声明原文 */
  disclaimer: string;
}

/** 反馈请求体：针对单条回答的评价 */
export interface FeedbackSubmitRequest {
  /** 前端生成的回答唯一 id（回答入 messages 数组后可拿到 index，或者由前端给每条 msg 发 uuid） */
  answerId: string;
  /** true = 有帮助；false = 无帮助 */
  helpful: boolean;
  /** 可选文本反馈 */
  comment?: string;
  /** 可选：回答的首个问题原文，便于离线复盘 */
  question?: string;
  /** 可选：会话 sessionId（前端首次打开小程序时 shortId('sess_') 生成，与 report 幂等键同源）；
   *  无此 id 时 feedbacks.answerId 将无法跨小程序生命周期追溯（msg id 只存在于前端内存），
   *  因此建议调用方始终传入；服务端校验为可选（兼容旧版前端），入库时缺省为空串。 */
  sessionId?: string;
}

export interface FeedbackSubmitResponse {
  ok: boolean;
  /** 入库的记录 id */
  id: string;
}

/** 用户额度响应体 */
export interface QuotaResponse {
  /** 当日已消耗免费咨询次数 */
  used: number;
  /** 每日免费上限（默认 5，可配置） */
  limit: number;
  /** 是否付费解锁（解锁后不计免费额度） */
  paid: boolean;
  /** 若 paid=true，解锁有效期至（YYYY-MM-DD），当日为 "" 表示永久/不限制 */
  plan: 'day' | 'week' | 'month' | 'forever' | '';
}

/** 下单请求体 */
export interface PayOrderCreateRequest {
  /** 计划 id：与小程序支付后台配置的商品 SKU 对应 */
  plan: 'unlock_day' | 'unlock_week' | 'unlock_month' | 'unlock_forever';
}

/** 下单响应体：返回 Taro.requestPayment 所需参数或跳转路径 */
export interface PayOrderCreateResponse {
  orderId: string;
  /** 若已接入云开发支付，返回可直接用于 wx.requestPayment 的参数 */
  payParams?: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'MD5' | 'HMAC-SHA256' | 'RSA';
    paySign: string;
  };
  /** 未配置支付环境时的透明提示（前端展示后引导走人工/客服） */
  hint?: string;
}

/** 反馈复盘统计响应体（feedback.stats） */
export interface FeedbackStatsResponse {
  /** 窗口内反馈总数 */
  total: number;
  /** 有帮助数 */
  helpful: number;
  /** 无帮助数 */
  unhelpful: number;
  /** 帮助率（保留一位小数百分比，如 75 表示 75%） */
  helpfulRate: number;
  /** 近 N 天每日分布（从旧到新，含补零） */
  daily: { date: string; total: number; helpful: number; unhelpful: number }[];
  /** 被标记“无帮助”次数最多的问题 Top5（复盘最高信号样本） */
  topUnhelpfulQuestions: { question: string; count: number }[];
}

/** 统一响应外壳：无论成功/失败都返回固定结构，前端透明处理 */
export interface ApiEnvelope<T> {
  code: number; // 0 成功；其他均为明确错误码
  msg?: string; // 错误时必带
  data?: T; // 成功时必带
}