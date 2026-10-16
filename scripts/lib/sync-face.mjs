// scripts/lib/sync-face.mjs —— **部署同步面**的单一事实源（门禁缺口批 2 · 2026-10-16 · F1）
//
// 病历（部署批 §7-F1，**会掩盖问题 · 中**）：
//   `package.json` **在** `sync-runtime.mjs` 的同步面内（会被 `cpSync` 覆盖到运行环境），
//   但「三处同刻一致」与双 `--check` **都只覆盖代码产物**（`plugin-host.js` / `lib/client.cjs` / 提示词生成区）。
//   ⇒ 若某批改了 `exports["./client"]` / `files` 等**清单字段**，这套前置**不会报警**，
//     而运行环境已被**静默改写** —— **失败不可观测**。
//
// 本模块做什么（**只读对照，不碰部署语义**）：
//   ① 从 `scripts/sync-runtime.mjs` 的**实际清单字面量派生**同步面（**不**另写第二份硬编码
//      ——同 `lib-manifest.mjs` 的「从构建脚本派生」先例；硬编码第二份正是那种病历要防的漂移）；
//   ② 按**产物 / 非产物**给同步面分类：产物面已由双 `--check` + 提示词环覆盖，
//      **补的是非产物面**（`package.json` / `README.md` / `README.en.md` / `cordis.patch.yml`）；
//   ③ 给一份**可复算**的前置对照：逐件 md5（**复用既有 md5 对账那一套**，不新造机制），
//      「同步面文件 ↔ 工作树」与「工作树 ↔ 运行环境」的差异**在部署前可见**。
//
// ⚠ 本模块**不改** `sync-runtime.mjs` 的部署语义：同步面清单本身不动、判定逻辑不动、
//   `cpSync`/`stripBomIfPresent` 行为不动。本模块是**旁路对照器**，不参与部署路径。
// ⚠ 本模块**不判**「运行环境缺件」为失败：部署可以合法地尚未跑过（本批明令不部署）。
//   失败判据只有两条：**源缺件**（同步会静默跳过 ⇒ 真缺口）与**两边都在但 md5 不同**（漂移）。

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根（scripts/lib/ → 上两级）。 */
export const REPO_ROOT = path.join(HERE, '..', '..');

/** 同步脚本相对仓库根的位置（派生锚点）。 */
export const SYNC_SCRIPT_REL = 'scripts/sync-runtime.mjs';

/** 判定「非产物文件」时排除的目录级同步面（这些由目录级同步 + 各自判据覆盖）。 */
export const SYNC_DIRS = ['lib', 'prompts', 'assets'];

/**
 * 从 `sync-runtime.mjs` 的**实际字面量**派生同步面。
 *
 * 只认三种形态（与 sync-runtime.mjs 的实际写法一一对应，实测 2026-10-16）：
 *   · `const files = [...]`                → 具名文件清单（:117）
 *   · `for (const d of ['a','b'])`         → 目录级同步面（:152）
 *   · `filter: (src) => ... /\.cjs$/`      → 目录内的扩展名过滤（:134）
 *
 * ⚠ 派生失败（脚本缺位 / 字面量改名）⇒ **抛错**，不静默回退到硬编码清单
 *   ——「解析不到就算过」是假绿（同 arch-claims S-5 退役说明里的反例）。
 *
 * @param {string} [root] 仓库根（默认本仓；测试夹具传副本目录）
 * @returns {{ files: string[], dirs: string[], libExtRe: string, source: string }}
 */
export function deriveSyncFace(root = REPO_ROOT) {
  const p = path.join(root, SYNC_SCRIPT_REL);
  if (!fs.existsSync(p)) throw new Error('同步脚本不在位（同步面无锚点）：' + SYNC_SCRIPT_REL);
  const src = fs.readFileSync(p, 'utf8');

  const mFiles = src.match(/const\s+files\s*=\s*\[([^\]]*)\]/);
  if (!mFiles) throw new Error('未能从 ' + SYNC_SCRIPT_REL + ' 解析出 `const files = [...]`（同步面清单）');
  const files = [...mFiles[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] || m[2]);
  if (files.length === 0) throw new Error('同步面清单解析为空（不得据此判绿）：' + SYNC_SCRIPT_REL);

  const mDirs = src.match(/for\s*\(\s*const\s+d\s+of\s*\[([^\]]*)\]\s*\)/);
  const dirs = mDirs ? [...mDirs[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] || m[2]) : [];

  // lib 目录级同步的扩展名过滤（`/\.cjs$/`）；取不到则记空（分类时按「目录内全部文件」处理）
  const mExt = src.match(/\/\\\.([a-z0-9]+)\$\/\.test\(src\)/i);
  const libExtRe = mExt ? '.' + mExt[1] : '';

  return { files, dirs, libExtRe, source: SYNC_SCRIPT_REL };
}

/**
 * 同步面内的**非产物文件**（= 本批补齐的覆盖面）。
 *
 * 分类口径（逐条，不是"其余都算"）：
 *   · 具名清单里，落在已知产物名单（`plugin-host.js` + `lib/*.cjs`）之外的 → **纳入**
 *   · 目录级同步面（`lib` / `prompts` / `assets`）→ **有意不纳入**：`lib/**` 由双 `--check`
 *     + `lib-manifest` 判据覆盖；`prompts/**` 由 gate 的 prompts 环 + 产物面判据覆盖；
 *     `assets/**` 为静态资源（无生成器 ⇒ 无"源码↔产物"可比对面）。
 *
 * @param {string} [root]
 * @returns {{ included: string[], excludedDirs: string[], artifacts: string[], source: string }}
 */
export function syncFaceNonArtifact(root = REPO_ROOT) {
  const face = deriveSyncFace(root);
  const artifactNames = new Set(['plugin-host.js']);
  const included = face.files.filter((f) => !artifactNames.has(f) && !/^lib[\\/]/.test(f));
  const artifacts = face.files.filter((f) => !included.includes(f));
  return { included, excludedDirs: face.dirs, artifacts, source: face.source };
}

/** md5（十六进制）——**与 `sync-runtime.mjs` 第 4 步同口径**（同一算法、同一读法）。 */
export function md5File(p) {
  return createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

/**
 * 可复算的前置对照：逐件比「工作树 md5 ↔ 运行环境 md5」。
 *
 * ⚠ 只在**两边都在**且 md5 不同时报 drift；运行环境缺件单列 `absent`（部署可合法未跑，
 *   本批明令不部署 ⇒ 缺件不构成失败）。源缺件单列 `missingSource`（同步会 `existsSync` 静默跳过）。
 *
 * @param {string} [root]        仓库根
 * @param {string} [runtimeRoot] 运行环境根（如 `$DSH_HOME/profiles/web/node_modules/dsh-prompt-enhancer`）
 * @returns {{ ok: boolean, rows: Array<{file:string,treeMd5:string|null,runtimeMd5:string|null,state:string}>, missingSource: string[], absent: string[] }}
 */
export function compareSyncFace(root = REPO_ROOT, runtimeRoot) {
  const { included } = syncFaceNonArtifact(root);
  const rows = [];
  const missingSource = [];
  const absent = [];
  for (const rel of included) {
    const treePath = path.join(root, rel);
    if (!fs.existsSync(treePath)) { missingSource.push(rel); rows.push({ file: rel, treeMd5: null, runtimeMd5: null, state: 'missing-source' }); continue; }
    const treeMd5 = md5File(treePath);
    const rtPath = runtimeRoot ? path.join(runtimeRoot, rel) : null;
    if (!rtPath || !fs.existsSync(rtPath)) { absent.push(rel); rows.push({ file: rel, treeMd5, runtimeMd5: null, state: 'absent' }); continue; }
    const runtimeMd5 = md5File(rtPath);
    rows.push({ file: rel, treeMd5, runtimeMd5, state: treeMd5 === runtimeMd5 ? 'match' : 'drift' });
  }
  const drift = rows.filter((r) => r.state === 'drift');
  return { ok: missingSource.length === 0 && drift.length === 0, rows, missingSource, absent };
}

/** 人读一行摘要（供 CLI / 报告引用）。 */
export function summarizeSyncFace(root = REPO_ROOT, runtimeRoot) {
  const c = compareSyncFace(root, runtimeRoot);
  const drift = c.rows.filter((r) => r.state === 'drift').map((r) => r.file);
  return (c.ok ? 'OK' : 'DRIFT')
    + '｜同步面非产物 ' + c.rows.length + ' 件'
    + '｜漂移 ' + drift.length + (drift.length ? '：' + drift.join(',') : '')
    + '｜源缺件 ' + c.missingSource.length + (c.missingSource.length ? '：' + c.missingSource.join(',') : '')
    + '｜运行环境缺件 ' + c.absent.length + (c.absent.length ? '（不判失败）' : '');
}

/**
 * 运行环境目录发现——**与 `sync-runtime.mjs` 同一条规则**（不另立优先级）：
 *   ① `DSH_RUNTIME_DIR`（显式）> ② `$DSH_HOME|$USERPROFILE|$HOME` 下 `profiles/<p>/node_modules/dsh-prompt-enhancer`。
 * ⚠ 本函数**只读发现**：不创建、不写、不部署。找不到返回 `[]`（调用方据此报「无从对照」，**不判绿也不判红**）。
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function resolveRuntimeDirs(env = process.env) {
  if (env.DSH_RUNTIME_DIR) return [path.resolve(env.DSH_RUNTIME_DIR)];
  const home = env.DSH_HOME || path.join(env.USERPROFILE || env.HOME || '', '.dsh');
  const profilesDir = path.join(home, 'profiles');
  const out = [];
  if (!fs.existsSync(profilesDir)) return out;
  for (const d of fs.readdirSync(profilesDir)) {
    const cand = path.join(profilesDir, d, 'node_modules', 'dsh-prompt-enhancer');
    if (fs.existsSync(cand)) out.push(cand);
  }
  return out;
}

// ───────────────────────────────── CLI（**部署前置对照面**，非 gate 环）─────────────────────────────────
// 用法：node scripts/lib/sync-face.mjs [--json]
// 退出码：0 = 无漂移（含「无运行环境可对照」——如实说明，不记通过）；1 = 有漂移 / 源缺件。
// ⚠ 本 CLI **不接** gate 链（RINGS 不动）、**不进** sync-runtime（部署语义逐字不动）：
//   它是「部署前跑一下、把差异看见」的旁路对照面，与 md5 对账同一套算法。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json');
  const face = syncFaceNonArtifact();
  const nonArtifact = face.included;
  const roots = resolveRuntimeDirs();
  const report = { source: face.source, included: nonArtifact, artifacts: face.artifacts, excludedDirs: face.excludedDirs, runtimes: [] };
  let bad = false;
  if (roots.length === 0) {
    report.note = '未发现运行环境目录（DSH_RUNTIME_DIR / $DSH_HOME/profiles/*）⇒ 无对照面；本步不判绿也不判红';
  } else {
    for (const rt of roots) {
      const c = compareSyncFace(REPO_ROOT, rt);
      report.runtimes.push({ runtime: rt, ok: c.ok, rows: c.rows, missingSource: c.missingSource, absent: c.absent });
      if (!c.ok) bad = true;
    }
  }
  if (json) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    console.log('部署同步面前置对照（非 gate 环）· 锚点 = ' + face.source);
    console.log('  纳入（非产物）：' + nonArtifact.join(', '));
    console.log('  产物（由双 --check / prompts 环覆盖）：' + face.artifacts.join(', '));
    console.log('  有意不纳入（目录级，各有判据）：' + face.excludedDirs.join(', '));
    if (roots.length === 0) console.log('  ⚠ ' + report.note);
    for (const r of report.runtimes) {
      console.log('  --- ' + r.runtime);
      for (const row of r.rows) console.log('    ' + (row.state === 'match' ? '✓' : '✗') + ' ' + row.file + ' [' + row.state + ']');
      if (r.missingSource.length) console.log('    ✗ 源缺件（同步会静默跳过）：' + r.missingSource.join(', '));
      if (r.absent.length) console.log('    · 运行环境缺件（不判失败）：' + r.absent.join(', '));
    }
  }
  process.exitCode = bad ? 1 : 0;
}
