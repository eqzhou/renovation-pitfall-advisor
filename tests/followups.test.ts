/**
 * ai-ask / buildFollowUps（多轮追问引导）纯函数测试（TDD）。
 *
 * buildFollowUps(scene, question)：检测关键信息缺口（面积/预算/阶段/城市/户型），
 * 返回追问建议（≤3 条）；问题已含关键信息则不追问对应项。
 */
import { describe, it, expect } from 'vitest';

const aiAsk = require('../src/cloudfunctions/ai-ask/impl');

describe('ai-ask / buildFollowUps', () => {
  it('budget 场景缺面积/预算 => 追问这两项', () => {
    const f = aiAsk.buildFollowUps('budget', '装修预算怎么控制');
    const joined = f.join('|');
    expect(joined).toContain('平米');
    expect(joined).toContain('预算');
  });
  it('问题已含面积与预算 => 不再追问这两项', () => {
    const f = aiAsk.buildFollowUps('budget', '我家 90 平，预算 12 万，怎么控制超支');
    const joined = f.join('|');
    expect(joined).not.toContain('平米');
    expect(joined).not.toContain('预算大概');
  });
  it('waterproof 场景追问面积与户型', () => {
    const f = aiAsk.buildFollowUps('waterproof', '卫生间防水怎么验收');
    const joined = f.join('|');
    expect(joined).toContain('平米');
    expect(joined).toContain('居');
  });
  it('通用（无 scene）场景追问阶段与面积', () => {
    const f = aiAsk.buildFollowUps(undefined, '装修要注意什么');
    const joined = f.join('|');
    expect(joined).toContain('阶段');
    expect(joined).toContain('平米');
  });
  it('关键信息齐全 => 返回空数组（不打扰）', () => {
    const f = aiAsk.buildFollowUps(
      'budget',
      '我家 90 平三居在北京，预算 12 万，目前施工中，怎么控制超支',
    );
    expect(f).toEqual([]);
  });
  it('最多返回 3 条', () => {
    const f = aiAsk.buildFollowUps('budget', '装修');
    expect(f.length).toBeLessThanOrEqual(3);
  });
  it('非字符串 question 安全返回空数组', () => {
    expect(aiAsk.buildFollowUps('budget', undefined as any)).toEqual([]);
    expect(aiAsk.buildFollowUps('budget', 123 as any)).toEqual([]);
  });
});
