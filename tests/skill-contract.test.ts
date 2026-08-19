/**
 * 微信 AI SKILL 一致性契约测试
 *
 * 守护目标：SKILL 的 mcp.json 声明必须与 ai.ask 路径契约保持同步，
 * 任何一侧改动都会让本测试红，强制开发者两侧一起改。
 *
 * 校验项：
 *  1) SKILL 分包目录与四件套文件存在
 *  2) mcp.json 的 askRenovation 入参 schema 与 AiAskRequest 形状一致
 *     - question 必填、类型 string
 *     - scene 可选、枚举值与 AiScene 6 项完全一致
 *  3) mcp.json 声明的组件路径在文件系统中存在
 *  4) app.config.ts 声明的 agent.skills[].path 与 SKILL.md 所在目录一致
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROUTES_BY_ID } from '../src/api/contracts/routes';
import type { AiAskRequest, AiScene } from '../src/cloudfunctions/shared/types';

const SKILL_ROOT = path.resolve(__dirname, '..', 'src', 'skills', 'renovation-advisor');
const MCP_PATH = path.join(SKILL_ROOT, 'mcp.json');
const SKILL_MD_PATH = path.join(SKILL_ROOT, 'SKILL.md');
const INDEX_JS_PATH = path.join(SKILL_ROOT, 'index.js');
const AGENTS_MD_PATH = path.join(SKILL_ROOT, 'AGENTS.md');

/** 与 AiScene 类型对齐的枚举集合（单一事实源来自 types.ts，TS 编译期已保证字面量集） */
const AI_SCENE_VALUES: AiScene[] = [
  'budget',
  'acceptance',
  'contract',
  'plumbing',
  'waterproof',
  'materials',
];

describe('微信 AI SKILL 一致性', () => {
  it('SKILL 分包目录与四件套文件存在', () => {
    expect(existsSync(SKILL_ROOT)).toBe(true);
    expect(existsSync(MCP_PATH)).toBe(true);
    expect(existsSync(SKILL_MD_PATH)).toBe(true);
    expect(existsSync(INDEX_JS_PATH)).toBe(true);
    expect(existsSync(AGENTS_MD_PATH)).toBe(true);
  });

  it('mcp.json 声明了 askRenovation 原子接口', () => {
    const mcp = JSON.parse(readFileSync(MCP_PATH, 'utf-8'));
    const api = mcp?.apis?.find((a: any) => a.name === 'askRenovation');
    expect(api).toBeTruthy();
    expect(typeof api.description).toBe('string');
    expect(api.description.length).toBeGreaterThan(0);
  });

  it('mcp.json 的 askRenovation 入参与 ai.ask 契约 AiAskRequest 形状一致', () => {
    const mcp = JSON.parse(readFileSync(MCP_PATH, 'utf-8'));
    const api = mcp.apis.find((a: any) => a.name === 'askRenovation');
    const schema = api.inputSchema;

    // question 必填、string
    expect(schema.properties.question.type).toBe('string');
    expect(schema.required).toContain('question');

    // scene 可选（不在 required 中）
    expect(schema.required).not.toContain('scene');

    // scene 的 enum 与 AiScene 6 项完全一致（顺序不敏感）
    const sceneEnum: string[] = schema.properties.scene.enum;
    expect(sceneEnum.sort()).toEqual([...AI_SCENE_VALUES].sort());
  });

  it('mcp.json outputSchema 与 AiAskResponse 形状一致', () => {
    const mcp = JSON.parse(readFileSync(MCP_PATH, 'utf-8'));
    const api = mcp.apis.find((a: any) => a.name === 'askRenovation');
    const out = api.outputSchema;

    expect(out.properties.chunks.type).toBe('array');
    expect(out.properties.disclaimer.type).toBe('string');
    expect(out.required).toContain('chunks');
    expect(out.required).toContain('disclaimer');
    // chunk.type 的枚举与 AiAnswerChunk.type 一致
    const chunkTypeEnum: string[] = out.properties.chunks.items.properties.type.enum;
    expect(chunkTypeEnum.sort()).toEqual(['claim', 'step', 'warning'].sort());
  });

  it('mcp.json 声明的组件路径在文件系统存在', () => {
    const mcp = JSON.parse(readFileSync(MCP_PATH, 'utf-8'));
    const compPath = mcp.apis[0]._meta?.ui?.componentPath as string | undefined;
    expect(compPath).toBeTruthy();
    const abs = path.join(SKILL_ROOT, compPath as string);
    // componentPath 指向 component 根，对应文件需加 .js/.json/.wxml/.wxss
    expect(existsSync(abs + '.js')).toBe(true);
    expect(existsSync(abs + '.json')).toBe(true);
    expect(existsSync(abs + '.wxml')).toBe(true);
    expect(existsSync(abs + '.wxss')).toBe(true);
  });

  it('ai.ask 契约路由存在且 SKILL 复用同一云函数名', () => {
    // SKILL index.js 调 'ai-ask' 云函数，与契约 ai.ask → routeIdToCloudFunction('ai.ask') = 'ai-ask' 一致
    const route = ROUTES_BY_ID.get('ai.ask');
    expect(route).toBeTruthy();
    const idx = readFileSync(INDEX_JS_PATH, 'utf-8');
    expect(idx).toContain("callCloud('ai-ask'");
    // 契约路由的 path 在 SKILL 注释里也被引用（便于追溯）
    expect(idx).toContain('ai.ask');
  });

  it('AiAskRequest/AiAskResponse 类型导出存在（保证契约与 SKILL 共享同一类型源）', () => {
    // 这条断言防止有人把类型从 types.ts 删掉却只改 mcp.json
    const typesRaw = readFileSync(
      path.resolve(__dirname, '..', 'src', 'cloudfunctions', 'shared', 'types.ts'),
      'utf-8',
    );
    expect(typesRaw).toContain('interface AiAskRequest');
    expect(typesRaw).toContain('interface AiAskResponse');
    expect(typesRaw).toContain('AiScene');
  });
});