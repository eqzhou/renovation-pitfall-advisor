/**
 * 会话持久化 —— Taro storage 薄封装（同步 API）。
 *
 * 数据形状由 session-pure.ts 定义；这里只负责读/写/删。
 * storage 读写失败一律静默降级（持久化是增强能力，不应让页面崩溃），
 * 返回值保证安全（load 失败返回空数组 / null）。
 */
import Taro from '@tarojs/taro';
import type { PersistedSession } from './session-pure';

const SESSIONS_KEY = 'renovation.sessions.v1';
const CURRENT_ID_KEY = 'renovation.session.currentId.v1';

export function loadSessions(): PersistedSession[] {
  try {
    const raw = Taro.getStorageSync(SESSIONS_KEY);
    return Array.isArray(raw) ? (raw as PersistedSession[]) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: PersistedSession[]): void {
  try {
    Taro.setStorageSync(SESSIONS_KEY, sessions);
  } catch {
    // 静默：写入失败仅丢失持久化，不影响本次会话
  }
}

export function loadCurrentId(): string | null {
  try {
    const v = Taro.getStorageSync(CURRENT_ID_KEY);
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

export function saveCurrentId(id: string): void {
  try {
    Taro.setStorageSync(CURRENT_ID_KEY, id);
  } catch {
    // 静默
  }
}

export function clearSessions(): void {
  try {
    Taro.removeStorageSync(SESSIONS_KEY);
    Taro.removeStorageSync(CURRENT_ID_KEY);
  } catch {
    // 静默
  }
}
