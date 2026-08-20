/**
 * 真实环境联调前自检（本地运行，无需云环境）：
 *   node scripts/verify-real-env.mjs
 *
 * 检查内容：
 *   1) 本地 Node 版本与全局 fetch 可用性（云函数运行时要切 Node18+ 才有 fetch）
 *   2) 所有云函数源码语法（node --check）
 *   3) 所有云函数 package.json 是否含 wx-server-sdk 依赖
 *   4) 扫描代码中引用的 process.env.* 环境变量清单（对照部署时需要配置哪些）
 *   5) 输出云函数部署清单
 *
 * 目的：在微信开发者工具/云开发控制台操作之前，先把能在本地确认的问题全部排除。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const cloudfnDir = join(root, 'src', 'cloudfunctions');

const problems = [];
const notes = [];

// 1) Node / fetch
console.log('▶ Node 版本:', process.version);
if (typeof fetch === 'function') {
  notes.push('全局 fetch 可用 ✓（本地 Node ≥ 18，与云函数 Nodejs18.15+ 一致即可）');
} else {
  problems.push('本地 Node < 18 缺少全局 fetch —— 联调前请升级本地 Node，且云函数运行时选 Nodejs18.15+');
}

// 2) 云函数清单 + 语法 + 依赖（shared 是共享模块目录，非独立云函数）
const dirs = readdirSync(cloudfnDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'shared')
  .map((d) => d.name)
  .sort();

console.log('\n▶ 云函数部署清单（共 ' + dirs.length + ' 个，需在微信开发者工具逐个上传）:');
const needsShared = [];
for (const name of dirs) {
  const dir = join(cloudfnDir, name);
  const indexFile = join(dir, 'index.js');
  const pkgFile = join(dir, 'package.json');

  // 语法检查
  if (existsSync(indexFile)) {
    try {
      execFileSync(process.execPath, ['--check', indexFile], { stdio: 'pipe' });
    } catch (e) {
      problems.push(`${name}/index.js 语法错误: ${String(e.stderr || e.message).trim()}`);
    }
  }

  // 依赖检查
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    const deps = pkg.dependencies || {};
    if (!deps['wx-server-sdk']) {
      problems.push(`${name}/package.json 缺少 wx-server-sdk 依赖`);
    }
  } else {
    problems.push(`${name} 缺少 package.json`);
  }

  // 是否引用 shared 共享模块
  const jsFiles = [];
  function walkJs(d2) {
    for (const e of readdirSync(d2, { withFileTypes: true })) {
      const p = join(d2, e.name);
      if (e.isDirectory()) walkJs(p);
      else if (e.name.endsWith('.js')) jsFiles.push(p);
    }
  }
  walkJs(dir);
  const usesShared = jsFiles.some((f) => readFileSync(f, 'utf8').includes('../shared/'));
  if (usesShared) needsShared.push(name);
  console.log('   - ' + name + (usesShared ? '  [依赖 shared]' : ''));
}

// 3) 环境变量扫描
console.log('\n▶ 代码中引用的环境变量（部署时按需配置）:');
const envRefs = new Set();
const jsFiles = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
}
walk(cloudfnDir);
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  const re = /process\.env\.([A-Z_0-9]+)/g;
  let m;
  while ((m = re.exec(src))) envRefs.add(m[1]);
}
for (const v of [...envRefs].sort()) console.log('   - ' + v);

// 4) 共享目录提示
console.log('\n▶ shared 共享模块:', existsSync(join(cloudfnDir, 'shared', 'utils.js')) ? '存在 ✓' : '缺失 ✗');
console.log(
  '▶ 依赖 shared 的云函数: ' + (needsShared.length ? needsShared.join(', ') : '（无）') +
    '\n   ⚠ 微信云函数按单目录上传，跨目录 require("../shared/utils") 在云端会失效。\n   部署前务必执行 `npm run deploy:prep` 生成含 shared 的部署目录。',
);

// 汇总
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (problems.length === 0) {
  console.log('✓ 本地预检全部通过，可在微信开发者工具继续云函数联调。');
} else {
  console.log('✗ 发现 ' + problems.length + ' 个问题:');
  for (const p of problems) console.log('   - ' + p);
}
if (notes.length) {
  console.log('提示:');
  for (const n of notes) console.log('   - ' + n);
}

process.exit(problems.length === 0 ? 0 : 1);
