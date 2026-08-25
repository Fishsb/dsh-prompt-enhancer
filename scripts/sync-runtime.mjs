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
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, statSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;
// v3.3.x（A5/A6）：快照与语法门原语复用运行时库 sys.cjs（单一事实源，host 侧同款）
const sys = require('../lib/sys.cjs');

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

// v4.9（2026-08-23 事故根治）：部署文本文件自动剥离 UTF-8 BOM——仓库清单若带 BOM，
// 原样进运行时会使 DSH 启动 JSON.parse 直接崩溃（当日"端口重启后起不来"事故根因）。
function stripBomIfPresent(p) {
  const b = readFileSync(p);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    writeFileSync(p, b.subarray(3));
    return true;
  }
  return false;
}
const TEXT_DEPLOY_EXT = /\.(json|cjs|js|mjs|md|ya?ml|cmd)$/;

// 1. 构建（含版本注入）
console.log('== 1/4 构建 host + client ==');
run('build-host.mjs', []);
run('build-client.mjs', []);

// 2. 漂移校验（产物必须等于源码重建）
console.log('== 2/4 漂移校验（源码 ↔ 产物）==');
run('build-host.mjs', ['--check']);
run('build-client.mjs', ['--check']);

// 2.5 产物语法门（A6·第三层）：构建产物零执行 `node --check`——组合/模块两层与本路径
// 无关（sync 不改 bundles/patch），全三层见 scripts/dry-run-lib.mjs（救援流程用）。
console.log('== 2.5/4 产物语法门（A6）==');
{
  const artifacts = ['plugin-host.js', 'plugin-client.js'];
  const libDir = join(root, 'lib');
  for (const f of readdirSync(libDir)) {
    if (/\.cjs$/.test(f)) artifacts.push(join(libDir, f));
  }
  const gate = sys.syntaxCheckFiles(artifacts, NODE);
  if (!gate.ok) {
    for (const f of gate.failures) console.error('✗ ' + f.file + ': ' + String(f.message).split('\n')[0]);
    throw new Error('产物语法门未通过（' + gate.failures.length + ' 个文件），中止部署');
  }
  console.log('✓ 语法门通过（' + artifacts.length + ' 个产物）');
}

// 2.6 安装即快照（A5）：部署覆盖前快照每个目标 profile 的可回退状态
// （配置四文件 + 目标当前运行产物）。尽力而为，失败不阻断部署。
console.log('== 2.6/4 安装即快照（A5）==');

// 3. 同步运行环境（产物 + 运行必需文件）
const targets = runtimeDirs();
// v3.3.x（junction 守卫）：profile 插件目录可能是**指向本开发仓库的 junction**
// （desktop profile 直连开发树加载）——realpath 相同则跳过，cpSync 自拷贝会
// ERR_FS_CP_EINVAL 崩溃；且内容本就是最新，无需部署。
const rootReal = realpathSync(root);
const deployTargets = [];
for (const t of targets) {
  try {
    if (realpathSync(t) === rootReal) { console.log('跳过（junction → 开发仓库，已是最新）：' + t); continue; }
  } catch { /* realpath 失败按普通目录处理 */ }
  deployTargets.push(t);
}
console.log('== 3/4 同步运行环境（' + deployTargets.length + ' 个 profile）==');
// A5 实际快照：逐部署目标，在覆盖前留回退锚点
for (const rt of deployTargets) {
  const profileName = (rt.match(/[\\/]profiles[\\/]([^\\/]+)[\\/]node_modules/) || [])[1] || 'web';
  const snap = sys.rescueSnapshot({ profileName, runtimeDir: rt, reason: 'sync-runtime pre-deploy' });
  console.log((snap.ok ? '✓ 快照 → ' : '⚠ 快照失败（不阻断）: ') + (snap.ok ? snap.dir + '（' + snap.files + ' files）' : snap.message));
}
const files = ['plugin-host.js', 'plugin-client.js', 'package.json', 'README.md', 'README.en.md', 'cordis.patch.yml'];
for (const rt of deployTargets) {
  console.log('--- 目标：' + rt);
  for (const f of files) {
    const s = join(root, f);
    if (existsSync(s)) {
      cpSync(s, join(rt, f), { force: true });
      if (TEXT_DEPLOY_EXT.test(f)) stripBomIfPresent(join(rt, f));
    }
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
  // v4.9：lib 文本产物去 BOM（与仓库侧清理对齐，防再次注入）
  const walkStrip = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walkStrip(p);
      else if (TEXT_DEPLOY_EXT.test(e)) stripBomIfPresent(p);
    }
  };
  walkStrip(libDst);
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
for (const rt of deployTargets) {
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
// v4.13 批次B（P0-2 写入点①）：md5 全过后逐 profile 记部署账本——部署成功事实最硬的时刻。
// source='sync-runtime'，version 取 package.json（构建注入同一事实源）。账本失败不阻断（旁路记录）。
{
  const version = require('../package.json').version;
  for (const rt of deployTargets) {
    const profileName = (rt.match(/[\\/]profiles[\\/]([^\\/]+)[\\/]node_modules/) || [])[1] || 'web';
    const w = sys.writeDeployLedgerEntry(profileName, version, 'sync-runtime');
    console.log((w.ok ? '✓ 部署账本 → ' : '⚠ 账本写入失败（不阻断）: ') + (w.ok ? sys.deployLedgerFile() + ' [' + profileName + '@' + version + ']' : w.message));
  }
}
console.log('');
console.log('✅ 运行环境已部署（' + deployTargets.length + ' 个 profile）：');
for (const rt of deployTargets) console.log('   - ' + rt);
console.log('   版本：' + require('../package.json').version);
console.log('   生效要求：① 重启对应 DSH 实例（加载新 host/执行器）；② 浏览器 Ctrl+F5 强制刷新页面（加载新 client）。');
