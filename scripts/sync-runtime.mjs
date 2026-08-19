// sync-runtime.mjs — v3.2.1-t（架构调整·同步自动化）
// 一条命令完成：build（host+client，含版本注入）→ --check 漂移校验 → 同步运行环境
// → md5 校验 → 提示重启 DSH + 刷新页面。
//
// 用法：
//   node scripts/sync-runtime.mjs                 # 部署到默认运行环境（$HOME/.dsh/profiles/web）
//   DSH_RUNTIME_DIR=<path> node scripts/sync-runtime.mjs
//
// 运行环境目录优先级：环境变量 DSH_RUNTIME_DIR > $DSH_HOME/profiles/web/node_modules/… > 默认。
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

function runtimeDir() {
  if (process.env.DSH_RUNTIME_DIR) return resolve(process.env.DSH_RUNTIME_DIR);
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  const p = join(home, 'profiles', 'web', 'node_modules', 'dsh-prompt-enhancer');
  if (!existsSync(p)) {
    // 自动探测：遍历 profiles/* 找到安装了本插件的 profile
    const profiles = join(home, 'profiles');
    if (existsSync(profiles)) {
      const dirs = require('node:fs').readdirSync(profiles);
      for (const d of dirs) {
        const cand = join(profiles, d, 'node_modules', 'dsh-prompt-enhancer');
        if (existsSync(cand)) return cand;
      }
    }
    throw new Error('未找到运行环境目录：' + p + '（可用 DSH_RUNTIME_DIR 指定）');
  }
  return p;
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
console.log('== 3/4 同步运行环境 ==');
const rt = runtimeDir();
console.log('目标：' + rt);
const files = ['plugin-host.js', 'plugin-client.js', 'package.json', 'README.md', 'README.en.md', 'cordis.patch.yml'];
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
// prompts/assets 若存在
for (const d of ['prompts', 'assets']) {
  const s = join(root, d);
  if (existsSync(s)) cpSync(s, join(rt, d), { recursive: true, force: true });
}

// 4. md5 校验 + 提示
console.log('== 4/4 校验 ==');
let allOk = true;
for (const f of files.concat(['lib/index.cjs', 'lib/client.cjs', 'lib/updater-host.cjs', 'lib/sys.cjs'])) {
  const s = join(root, f);
  if (!existsSync(s)) continue;
  const a = md5(s);
  const b = md5(join(rt, f));
  const ok = a === b;
  if (!ok) allOk = false;
  console.log((ok ? '✓' : '✗') + ' ' + f);
}
if (!allOk) { console.error('同步校验失败，请检查目标目录权限'); process.exit(1); }
console.log('');
console.log('✅ 运行环境已部署：' + rt);
console.log('   版本：' + require('../package.json').version);
console.log('   生效要求：① 重启 DSH（加载新 host/执行器）；② 浏览器 Ctrl+F5 强制刷新页面（加载新 client）。');
