// sync-runtime.mjs — v3.2.1-t（架构调整·同步自动化）
// 一条命令完成：build（host+client，含版本注入）→ --check 漂移校验 → 同步运行环境
// → md5 校验 → 提示重启 DSH + 刷新页面。
//
// 用法：
//   node scripts/sync-runtime.mjs                 # 部署到**所有**安装了本插件的 profile
//                                                 # （v3.3.x：web+desktop 双实例开发机不再漏部署）
//   DSH_RUNTIME_DIR=<path> node scripts/sync-runtime.mjs   # 只部署指定目录
//
// 运行环境目录优先级：环境变量 DSH_RUNTIME_DIR > $DSH_HOME/profiles/* 全量发现。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;

function run(script, args) {
  execFileSync(NODE, [join(root, 'scripts', script), ...args], { stdio: 'inherit', cwd: root });
}

// v3.3.x（多 profile 部署）：旧实现只部署单个 profile（web 优先、否则 readdir 第一个），
// 双 profile 开发机上另一个 profile 永远跑旧代码（「我明明修了」假象的根源）。
// 现默认部署到**所有**安装了本插件的 profile；DSH_RUNTIME_DIR 仍可限定单目标。
function runtimeDirs() {
  if (process.env.DSH_RUNTIME_DIR) return [resolve(process.env.DSH_RUNTIME_DIR)];
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  const profilesDir = join(home, 'profiles');
  const targets = [];
  if (existsSync(profilesDir)) {
    for (const d of require('node:fs').readdirSync(profilesDir)) {
      const cand = join(profilesDir, d, 'node_modules', 'dsh-prompt-enhancer');
      if (existsSync(cand)) targets.push(cand);
    }
  }
  if (!targets.length) {
    throw new Error('未找到任何运行环境目录：' + profilesDir + '/<profile>/node_modules/dsh-prompt-enhancer（可用 DSH_RUNTIME_DIR 指定）');
  }
  return targets;
}

function md5(p) {
  return createHash('md5').update(readFileSync(p)).digest('hex');
}

// 1. 构建（含版本注入）
console.log('== 1/4 构建 host + client ==');
run('build-host.mjs', []);
run('build-client.mjs', []);

// 2. 漂移校验（产物必须等于源码重建）
console.log('== 2/4 漂移校验（源码 ↔ 产物）==');
run('build-host.mjs', ['--check']);
run('build-client.mjs', ['--check']);

// 3. 同步运行环境（产物 + 运行必需文件）
const targets = runtimeDirs();
console.log('== 3/4 同步运行环境（' + targets.length + ' 个 profile）==');
const files = ['plugin-host.js', 'plugin-client.js', 'package.json', 'README.md', 'README.en.md', 'cordis.patch.yml'];
for (const rt of targets) {
  console.log('--- 目标：' + rt);
  for (const f of files) {
    const s = join(root, f);
    if (existsSync(s)) { cpSync(s, join(rt, f), { force: true }); }
  }
  // lib 目录级同步（排除测试/源码）
  const libSrc = join(root, 'lib');
  const libDst = join(rt, 'lib');
  mkdirSync(libDst, { recursive: true });
  cpSync(libSrc, libDst, {
    recursive: true,
    force: true,
    filter: (src) => statSync(src).isDirectory() || /\.cjs$/.test(src),
  });
  // v3.2.15（undici 重构·运行时依赖部署）：lib/net-proxy.cjs 依赖 undici（零运行时依赖，
  // 单目录拷贝即可）。DSH 组合树（profiles/<profile>/node_modules/dsh-prompt-enhancer）内
  // require('undici') 沿 node_modules 逐级向上解析——必须把包放进插件自己的 node_modules。
  // 注：发布链路（dsh plugin add tarball → pnpm）会按 package.json dependencies 自动安装，
  // 本处只覆盖本地 sync-runtime 手工部署场景。
  const depSrc = join(root, 'node_modules', 'undici');
  if (existsSync(depSrc)) {
    const depDst = join(rt, 'node_modules', 'undici');
    mkdirSync(depDst, { recursive: true });
    cpSync(depSrc, depDst, { recursive: true, force: true });
    console.log('  已同步运行时依赖 undici → ' + depDst);
  } else {
    console.warn('  警告：未找到 node_modules/undici（先 npm install undici@^7.23），运行时 require 将失败');
  }
  // prompts/assets 若存在
  for (const d of ['prompts', 'assets']) {
    const s = join(root, d);
    if (existsSync(s)) cpSync(s, join(rt, d), { recursive: true, force: true });
  }
}

// 4. md5 校验 + 提示
console.log('== 4/4 校验 ==');
let allOk = true;
for (const rt of targets) {
  console.log('--- ' + rt);
  for (const f of files.concat(['lib/index.cjs', 'lib/client.cjs', 'lib/updater-host.cjs', 'lib/sys.cjs'])) {
    const s = join(root, f);
    if (!existsSync(s)) continue;
    const a = md5(s);
    const b = md5(join(rt, f));
    const ok = a === b;
    if (!ok) allOk = false;
    console.log((ok ? '✓' : '✗') + ' ' + f);
  }
}
if (!allOk) { console.error('同步校验失败，请检查目标目录权限'); process.exit(1); }
console.log('');
console.log('✅ 运行环境已部署（' + targets.length + ' 个 profile）：');
for (const rt of targets) console.log('   - ' + rt);
console.log('   版本：' + require('../package.json').version);
console.log('   生效要求：① 重启对应 DSH 实例（加载新 host/执行器）；② 浏览器 Ctrl+F5 强制刷新页面（加载新 client）。');
