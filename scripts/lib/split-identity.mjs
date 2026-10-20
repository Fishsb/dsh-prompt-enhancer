// scripts/lib/split-identity.mjs —— 「一仓两包」**identity 面**判据库（拆包前置批 · 2026-10-20）
//
// 为什么需要（CHG-289 §3.3 实测）：两包若用**同一个 loader entry id**，宿主 `composeEntries`
//   **既不报错也不告警** —— 实测输出:
//       same id twice -> [{"id":"dsh-prompt-enhancer",…},{"id":"dsh-prompt-enhancer",…}] warns= []
//   即：撞了也静默产出两条同名 entry ⇒ 装载行为不可预期，而链上零红。
//   ⇒ 只能在**仓内机检**拦（这也是本模块存在的唯一理由）。
//
// 面（四项，任一撞即红）：
//   ① loader entry **id**（`cordis.patch.yml` 里每个 `- insert:` 行的 `- id:`）
//   ② client 产物 **id**（`lib/client.cjs` 里 `window.__ModuleLoader__.load({ id: "…" })`）
//   ③ RPC 路由**前缀**（`lib/*.cjs` 里 `RPC_PATH = '/…/rpc'`）
//   ④ RPC **方法名**（双半部 `harness.handle('…')`）
//
// ⚠ 判据必须**在拆包前后都成立**：拆包前 = 只有一套 identity（1 个包）⇒ 集合去重后仍是 1，
//   不撞 ⇒ 绿（**这不是空跑**：条目数由 `observed` 导出，测试断言其 ≥ 既知下限）。
//   拆包后 = 两套 identity ⇒ 同一个函数照跑，撞了就红。
//
// ⚠ 本模块是**纯读**（不 require 被检文件、不执行业务代码）—— 与 `scripts/lib/code-only.mjs`
//   同一纪律：判据读**代码面**文本，⛔ 不执行。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根（`scripts/lib/` → 上两级）。 */
export const REPO_ROOT = path.join(HERE, '..', '..');

/**
 * 从 `cordis.patch.yml` 文本里取所有 **insert 行** 的 entry id。
 *
 * 口径（与 `CHG-289` 的实测一致）：只看 `- insert:` 块下的 `- id: <x>`；
 * ⚠ 同时把 `name:` 收进返回值的旁路字段，便于负控时把"同 id 不同 name"与"同 id 同 name"区分开。
 * @param {string} text patch yaml 文本
 * @returns {{id:string,name:string|null}[]}
 */
export function patchEntryIdentities(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  let inInsert = false;
  let insertIndent = -1;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const insert = /^-\s*insert:\s*$/.exec(trimmed);
    if (insert) { inInsert = true; insertIndent = indent; continue; }
    if (!inInsert) continue;
    // 离开 insert 块：同/更浅缩进且不是列表项 ⇒ 结束
    if (indent <= insertIndent && /^-\s/.test(trimmed) === false) { inInsert = false; continue; }
    // 两种形态都要认：`- id: x`（列表项）与 `name: x`（同项的兄弟键，**不带 `-`**）
    const kv = /^(?:-\s*)?(id|name):\s*(.+?)\s*$/.exec(trimmed);
    if (kv) {
      const value = kv[2].replace(/^['"]|['"]$/g, '');
      if (kv[1] === 'id') out.push({ id: value, name: null });
      else if (out.length > 0 && out[out.length - 1].name === null) out[out.length - 1].name = value;
    }
  }
  return out;
}

/**
 * 从 client 产物文本里取模块系统 id。
 * 形态：`window.__ModuleLoader__.load({ id: "…", factory: … })`（见 `lib/client.cjs`）。
 * @param {string} text 产物文本
 * @returns {string[]} 命中的 id（正常恰 1 个；多个即本身是缺陷）
 */
export function clientModuleIds(text) {
  return [...String(text).matchAll(/__ModuleLoader__\s*\.\s*load\s*\(\s*\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * 从 host 半部源码文本里取 RPC 路由前缀。
 * 形态：`const RPC_PATH = '/xxx/rpc';`（`lib/index.cjs`）
 * @param {string} text 源码文本
 * @returns {string[]} 命中的前缀（正常恰 1 个）
 */
export function rpcRoutePrefixes(text) {
  return [...String(text).matchAll(/\bRPC_PATH\s*=\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * 从文本里取线上注册的 RPC 方法名（`harness.handle('m', …)`）。
 * @param {string} text 源码文本
 * @returns {string[]} 方法名（可能重复，调用方自行去重）
 */
export function rpcMethods(text) {
  return [...String(text).matchAll(/harness\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * 通用判据：一组 identity 值**不得重复**。
 * @param {{label:string, values:string[]}[]} groups 若干分组
 * @returns {{ok:boolean, duplicates:{label:string,value:string,count:number}[], observed:Object<string,number>}}
 */
export function findCollisions(groups) {
  const duplicates = [];
  const observed = {};
  for (const g of groups) {
    observed[g.label] = g.values.length;
    const seen = new Map();
    for (const v of g.values) seen.set(v, (seen.get(v) || 0) + 1);
    for (const [value, count] of seen) if (count > 1) duplicates.push({ label: g.label, value, count });
  }
  return { ok: duplicates.length === 0, duplicates, observed };
}

/** 读文件（相对仓库根）；缺位返回 null（调用方按 fail-closed 处置）。 */
export function readAt(root, rel) {
  const abs = path.resolve(root || REPO_ROOT, rel);
  try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
}

/** `lib/` 下全部 `.cjs`（相对路径，排序）。 */
export function libCjsFiles(root) {
  const dir = path.join(root || REPO_ROOT, 'lib');
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).sort().map((f) => 'lib/' + f);
  } catch (e) { return []; }
}

export default { patchEntryIdentities, clientModuleIds, rpcRoutePrefixes, rpcMethods, findCollisions, readAt, libCjsFiles, REPO_ROOT };
