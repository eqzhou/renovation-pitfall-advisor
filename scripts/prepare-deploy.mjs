/**
 * 云函数部署准备：生成"每个云函数自包含 shared"的独立部署目录。
 *
 * 背景：微信云开发按单云函数目录上传，云端每个函数只有自己的目录。
 * 但本项目云函数用 require('../shared/utils') 跨目录引用共享模块，
 * 直接上传 src/cloudfunctions/<name> 会在云端报 "Cannot find module ../shared/utils"。
 *
 * 解决：运行本脚本（npm run deploy:prep）生成 .deploy/<name>/，
 * 每个目录都包含自己的 index.js/impl.js/package.json + 所需的 shared/ 副本。
 * 之后在微信开发者工具中逐个"导入目录"或"右键上传" .deploy/<name> 即可。
 *
 * 产物 .deploy/ 已加入 .gitignore，不进入版本库。
 */
import { readdirSync, readFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const srcDir = join(root, 'src', 'cloudfunctions');
const deployDir = join(root, '.deploy');

const funcs = readdirSync(srcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'shared')
  .map((d) => d.name)
  .sort();

rmSync(deployDir, { recursive: true, force: true });
mkdirSync(deployDir, { recursive: true });

let count = 0;
for (const name of funcs) {
  const target = join(deployDir, name);
  mkdirSync(target, { recursive: true });
  // 复制该函数自身所有文件
  cpSync(join(srcDir, name), target, { recursive: true });

  // 若函数内任一 .js 引用 ../shared/，则把 shared 副本拷入
  const jsFiles = [];
  function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) jsFiles.push(p);
    }
  }
  walk(join(srcDir, name));
  const usesShared = jsFiles.some((f) => readFileSync(f, 'utf8').includes('../shared/'));
  if (usesShared) {
    cpSync(join(srcDir, 'shared'), join(target, 'shared'), { recursive: true });
  }
  console.log('  ✓ ' + name + (usesShared ? '（含 shared 副本）' : ''));
  count++;
}

console.log(`\n已生成 ${count} 个可部署目录 → ${deployDir}`);
console.log('下一步：微信开发者工具 → 云开发 → 云函数，逐个「导入目录」选择 .deploy/<name> 并「上传并部署：云端安装依赖」。');
