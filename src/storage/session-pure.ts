/**
 * 会话持久化 —— 纯函数层（无 Taro / 无 IO，可在 vitest node 环境直接测试）。
 *
 * 职责：会话的创建、消息追加（幂等）、反馈更新、场景更新、排序与裁剪。
 * 存储读写由 session-storage.ts 薄封装完成；本模块只处理"数据如何变化"。
 */
import type { AiAnswerChunk, AiScene } from '@/cloudfunctions/shared/types';

export interface PersistedUserMsg {
  id: string;
  role: 'user';
  text: string;
  scene?: AiScene;
}
export interface PersistedAssistantMsg {
  id: string;
  role: 'assistant';
  chunks: AiAnswerChunk[];
  disclaimer: string;
  /** 用户对这条回答的反馈：未评价 = undefined */
  feedback?: boolean;
  /** 该回答对应的用户问题（反馈上报时一起存） */
  question?: string;
}
export type PersistedMsg = PersistedUserMsg | PersistedAssistantMsg;

export interface PersistedSession {
  /** 即 sessionId，随会话持久化，不再每次进入重建 */
  id: string;
  title: string;
  messages: PersistedMsg[];
  activeScene?: AiScene;
  createdAt: number;
  updatedAt: number;
}

/** 会话标题最大长度（超出的用省略号截断） */
export const SESSION_TITLE_MAX = 18;
/** 单会话最大消息数（超限从头部裁剪，防止本地 storage 无限膨胀） */
export const SESSION_MESSAGES_MAX = 100;
/** 本地保留的最大会话数（按最近更新裁剪） */
export const SESSIONS_MAX = 20;

export function makeTitle(text: string): string {
  const t = (text ?? '').trim();
  if (!t) return '新会话';
  return t.length > SESSION_TITLE_MAX ? `${t.slice(0, SESSION_TITLE_MAX)}…` : t;
}

export function createSession(id: string, scene?: AiScene, now = Date.now()): PersistedSession {
  return { id, title: '新会话', messages: [], activeScene: scene, createdAt: now, updatedAt: now };
}

/** 幂等追加一条 user 消息；首条问题回填为会话标题 */
export function appendUser(
  session: PersistedSession,
  msg: PersistedUserMsg,
  now = Date.now(),
): PersistedSession {
  if (session.messages.some((m) => m.id === msg.id)) return session;
  return {
    ...session,
    title: session.title === '新会话' ? makeTitle(msg.text) : session.title,
    activeScene: msg.scene ?? session.activeScene,
    messages: [...session.messages, msg],
    updatedAt: now,
  };
}

/** 幂等追加一条 assistant 消息 */
export function appendAssistant(
  session: PersistedSession,
  msg: PersistedAssistantMsg,
  now = Date.now(),
): PersistedSession {
  if (session.messages.some((m) => m.id === msg.id)) return session;
  return { ...session, messages: [...session.messages, msg], updatedAt: now };
}

/** 更新当前场景（不产生新消息） */
export function setActiveSceneOf(
  session: PersistedSession,
  scene: AiScene | undefined,
  now = Date.now(),
): PersistedSession {
  if (session.activeScene === scene) return session;
  return { ...session, activeScene: scene, updatedAt: now };
}

/** 幂等记录某条回答的反馈 */
export function setFeedbackOf(
  session: PersistedSession,
  answerId: string,
  helpful: boolean,
  now = Date.now(),
): PersistedSession {
  if (!answerId) return session;
  let changed = false;
  const messages = session.messages.map((m) => {
    if (m.role === 'assistant' && m.id === answerId && m.feedback !== helpful) {
      changed = true;
      return { ...m, feedback: helpful };
    }
    return m;
  });
  if (!changed) return session;
  return { ...session, messages, updatedAt: now };
}

/** 按更新时间降序（会话列表展示顺序） */
export function sortByUpdatedAtDesc(sessions: PersistedSession[]): PersistedSession[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 保留最近更新的 max 个会话 */
export function trimSessions(sessions: PersistedSession[], max = SESSIONS_MAX): PersistedSession[] {
  return sortByUpdatedAtDesc(sessions).slice(0, max);
}

/** 超限时从头部裁剪、保留尾部最新 max 条消息 */
export function trimSessionMessages(
  session: PersistedSession,
  max = SESSION_MESSAGES_MAX,
): PersistedSession {
  if (session.messages.length <= max) return session;
  return { ...session, messages: session.messages.slice(-max) };
}
