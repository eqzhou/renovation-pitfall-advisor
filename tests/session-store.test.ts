/**
 * 会话持久化纯函数单元测试（TDD）。
 *
 * 被测模块 src/storage/session-pure.ts：只依赖纯逻辑（无 Taro/IO），
 * 在 vitest node 环境直接跑。storage 读写是薄封装，不在单测范围。
 */
import { describe, it, expect } from 'vitest';
import {
  createSession,
  makeTitle,
  appendUser,
  appendAssistant,
  setFeedbackOf,
  setActiveSceneOf,
  sortByUpdatedAtDesc,
  trimSessions,
  trimSessionMessages,
  type PersistedSession,
} from '../src/storage/session-pure';

const now = 1_700_000_000_000;
const u = (id: string, text: string, scene?: 'budget') => ({ id, role: 'user' as const, text, scene });
const a = (id: string, content: string) => ({
  id,
  role: 'assistant' as const,
  chunks: [{ type: 'claim' as const, content }],
  disclaimer: '免责声明',
});

describe('session-pure / makeTitle', () => {
  it('空/空白 => 默认标题', () => {
    expect(makeTitle('')).toBe('新会话');
    expect(makeTitle('   ')).toBe('新会话');
    expect(makeTitle(undefined as any)).toBe('新会话');
  });
  it('≤18 字 => 原样', () => {
    expect(makeTitle('我家防水怎么做')).toBe('我家防水怎么做');
  });
  it('>18 字 => 截断并加省略号', () => {
    const long = '预算超支水电防水验收合同主材装修问题测试句子很长很长';
    expect(long.length).toBeGreaterThan(18);
    expect(makeTitle(long)).toBe(`${long.slice(0, 18)}…`);
  });
});

describe('session-pure / createSession', () => {
  it('默认 title 为新会话，messages 为空，记录时间戳', () => {
    const s = createSession('sess_1', undefined, now);
    expect(s.id).toBe('sess_1');
    expect(s.title).toBe('新会话');
    expect(s.messages).toEqual([]);
    expect(s.createdAt).toBe(now);
    expect(s.updatedAt).toBe(now);
  });
  it('可指定初始 scene', () => {
    const s = createSession('sess_1', 'budget', now);
    expect(s.activeScene).toBe('budget');
  });
});

describe('session-pure / appendUser', () => {
  it('追加消息并把 title 回填为问题（保留核心细节）', () => {
    let s = createSession('s1', undefined, now);
    s = appendUser(s, u('u1', '我家卫生间怎么做防水', 'budget'), now + 1);
    expect(s.messages).toHaveLength(1);
    expect(s.title).toBe('我家卫生间怎么做防水');
    expect(s.activeScene).toBe('budget');
    expect(s.updatedAt).toBe(now + 1);
  });
  it('标题已非默认时不再覆盖', () => {
    let s = createSession('s1', undefined, now);
    s = appendUser(s, u('u1', '第一个问题'), now + 1);
    s = appendUser(s, u('u2', '第二个问题'), now + 2);
    expect(s.title).toBe('第一个问题');
  });
  it('同 id 幂等：重复追加被跳过', () => {
    let s = createSession('s1', undefined, now);
    s = appendUser(s, u('u1', '问题'), now + 1);
    s = appendUser(s, u('u1', '问题'), now + 2);
    expect(s.messages).toHaveLength(1);
  });
});

describe('session-pure / appendAssistant', () => {
  it('追加 assistant 消息并刷新 updatedAt', () => {
    let s = createSession('s1', undefined, now);
    s = appendUser(s, u('u1', '问题'), now + 1);
    s = appendAssistant(s, a('a1', '结论'), now + 2);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[1].role).toBe('assistant');
    expect(s.updatedAt).toBe(now + 2);
  });
  it('同 id 幂等', () => {
    let s = createSession('s1', undefined, now);
    s = appendUser(s, u('u1', '问题'), now + 1);
    s = appendAssistant(s, a('a1', '结论'), now + 2);
    s = appendAssistant(s, a('a1', '结论'), now + 3);
    expect(s.messages).toHaveLength(2);
  });
});

describe('session-pure / setFeedbackOf', () => {
  it('只更新目标 assistant 消息的 feedback', () => {
    let s = createSession('s1', undefined, now);
    s = appendUser(s, u('u1', '问题'), now + 1);
    s = appendAssistant(s, a('a1', '结论1'), now + 2);
    s = appendAssistant(s, a('a2', '结论2'), now + 3);
    s = setFeedbackOf(s, 'a1', true, now + 4);
    const msgs = s.messages;
    expect((msgs[1] as any).feedback).toBe(true);
    expect((msgs[2] as any).feedback).toBeUndefined();
  });
  it('不存在的 id / 空 id 不改动', () => {
    let s = createSession('s1', undefined, now);
    s = appendUser(s, u('u1', '问题'), now + 1);
    s = appendAssistant(s, a('a1', '结论'), now + 2);
    const before = s.messages;
    s = setFeedbackOf(s, 'ghost', false, now + 3);
    expect(s.messages).toEqual(before);
    s = setFeedbackOf(s, '', false, now + 4);
    expect(s.messages).toEqual(before);
  });
});

describe('session-pure / setActiveSceneOf', () => {
  it('更新当前场景', () => {
    let s = createSession('s1', undefined, now);
    s = setActiveSceneOf(s, 'contract', now + 1);
    expect(s.activeScene).toBe('contract');
  });
});

describe('session-pure / sort & trim', () => {
  const mk = (id: string, updatedAt: number): PersistedSession =>
    createSession(id, undefined, updatedAt);

  it('sortByUpdatedAtDesc 按更新时间降序', () => {
    const s = sortByUpdatedAtDesc([mk('a', 3), mk('b', 1), mk('c', 2)]);
    expect(s.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
  it('trimSessions 保留最近更新的 max 个', () => {
    const s = trimSessions([mk('a', 3), mk('b', 1), mk('c', 2)], 2);
    expect(s.map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('trimSessionMessages 超限时从头部丢弃、保留尾部最新', () => {
    let s = createSession('s1', undefined, now);
    for (let i = 0; i < 105; i++) s = appendUser(s, u(`u${i}`, `q${i}`), now + i);
    s = trimSessionMessages(s, 100);
    expect(s.messages).toHaveLength(100);
    expect(s.messages[0].id).toBe('u5');
    expect(s.messages[99].id).toBe('u104');
  });
  it('trimSessionMessages 未超限时原样返回', () => {
    let s = createSession('s1', undefined, now);
    s = appendUser(s, u('u1', 'q1'), now + 1);
    expect(trimSessionMessages(s, 100).messages).toHaveLength(1);
  });
});
