// scripts/lib/split-shared-fns.mjs —— 「两包共享的 7 个 host 函数」**逐字节一致**判据库
//   （拆包前置批 · 2026-10-20 · 依据 CHG-289 §2.3 的实读结论）
//
// 为什么需要（CHG-289 查出的硬事实）：
//   `voice/correct` **复用增强包的模型链** —— `plugin-host.js:4633` `validateConfig(args.config)`、
//   `:4653` `buildTryChain(cfg.fallback)`。这两件都在 `src/host/pure.js` 里
//   ⇒ **`pure.js` 不是纯包1 资产**，拆包后包2 必须自带同一批函数。
//   `N4` 已定：**两包各一份同源副本 + 逐字节相等机检**（⛔ 不建第三包，`UD-0048` §一.3）。
//
//   ⇒ 本模块就是那道机检的**判据实现**。拆包前 = 只有一份（`src/host/pure.js`）⇒ 判绿；
//     拆包后 = 两份（各包一份）⇒ 同一个函数照跑，任一处漂移即红。
//
// ⚠ 三道防线（缺一条就是假绿）：
//   ① **分母 fail-closed**：7 个函数**逐个点名**，扫不到、或解析出的函数体内空、或命中数 < 7 ⇒ 红。
//      ⛔ 不许「扫到的少所以都相等」这种空跑式绿（`N2`/§判据 2 明确要求）。
//   ② **多份之间逐字节**：以**第一份为基准**，其余必须逐字节相等；不等时点名是哪个函数、哪一份。
//   ③ **反向自证**：本模块导出纯函数，测试可喂"只改一个字符"的伪副本 ⇒ 必须红。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeChunkText, chunkWrapperLiteral } from './chunk-decode.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根（`scripts/lib/` → 上两级）。 */
export const REPO_ROOT = path.join(HERE, '..', '..');

/**
 * 拆包后两包都要持有的 **7 个 host 函数**（具名，⛔ 不用通配/正则猜）。
 *
 * 出处：`CHG-289` §2.3 对 `src/host/pure.js` 的实读 —— 这 7 个同时服务于增强管线与 `voice/correct`。
 * ⚠ 加/删本清单 = 改判据面 ⇒ 必须同批改 `test/split-cross-rings.test.cjs` 的分母断言。
 */
export const SHARED_FUNCTIONS = Object.freeze([
  'validateConfig',
  'buildTryChain',
  'collectStream',
  'cleanOutput',
  'friendlyMessage',
  'splitHistoryRounds',
  'extractHistoryConclusions',
]);

/**
 * 从**已解出的 chunk 源码**里截出一个具名顶层函数/常量的完整定义文本。
 *
 * 支持两种形态（本仓 `pure.js` 两种都有）：
 *   · `function name(...) { … }`
 *   · `async function name(...) { … }`
 * ⚠ 用**括号配平**取范围（跳过字符串字面量），⛔ 不用「找下一个 function」这类脆弱切法
 *   （那会把函数之间的注释/常量切成函数体的一部分，制造假漂移）。
 * @param {string} src 源码
 * @param {string} name 具名函数名
 * @returns {string|null} 定义文本（含 `function` 关键字到闭合 `}`）；找不到为 null
 */
export function extractFunction(src, name) {
  const s = String(src);
  const re = new RegExp('(?:^|\\n)\\s*(async\\s+)?function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'g');
  const m = re.exec(s);
  if (!m) return null;
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
  // 从函数头的 `(` 起做括号配平，找参数表闭合，再找函数体 `{}`
  let i = m.index + m[0].length - 1;
  let depth = 0;
  let bodyStart = -1;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { i = skipLineComment(s, i); continue; }
    if (c === '/' && s[i + 1] === '*') { i = skipBlockComment(s, i); continue; }
    if (c === '"' || c === "'" || c === '`') { i = skipString(s, i); continue; }
    if (c === '/') { const r = skipRegex(s, i); if (r >= 0) { i = r; continue; } }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) { bodyStart = i + 1; break; } }
    i += 1;
  }
  if (bodyStart < 0) return null;
  i = bodyStart;
  while (i < s.length && s[i] !== '{') i += 1;
  if (i >= s.length) return null;
  let bd = 0;
  const from = i;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { i = skipLineComment(s, i); continue; }
    if (c === '/' && s[i + 1] === '*') { i = skipBlockComment(s, i); continue; }
    if (c === '"' || c === "'" || c === '`') { i = skipString(s, i); continue; }
    if (c === '/') { const r = skipRegex(s, i); if (r >= 0) { i = r; continue; } }
    if (c === '{') bd += 1;
    else if (c === '}') { bd -= 1; if (bd === 0) return s.slice(start, i + 1); }
    i += 1;
  }
  return null;
}

/**
 * 跳过 `//` 行注释（到行尾，**不含**换行符本身），返回换行符位置。
 *
 * ⚠ 为什么必须有它（本库二次实测踩到）：`cleanOutput` 体内一行注释写着
 *   `// 模型把发给它的完整指令（「请优化以下提示词：…` —— 注释文本里出现**成对引号**，
 *   只认字符串的扫描器会把注释里的引号当成字符串起点 ⇒ 从这里起整段被吞 ⇒ 括号永远收不满。
 *   ⛔ 这是扫描器的缺陷，不是被检代码的问题（判据必须能读注释密集中文源码）。
 */
function skipLineComment(s, i) {
  let j = i + 2;
  while (j < s.length && s[j] !== '\n') j += 1;
  return j;
}

/** 跳过 `/* … *\/` 块注释，返回闭合符之后的位置（未闭合则到文末）。 */
function skipBlockComment(s, i) {
  const close = s.indexOf('*/', i + 2);
  return close === -1 ? s.length : close + 2;
}

/** 跳过字符串字面量（含转义），返回其后一个位置。 */
function skipString(s, i) {
  const q = s[i];
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '\\') { j += 2; continue; }
    if (s[j] === q) return j + 1;
    j += 1;
  }
  return j;
}

/**
 * 跳过**正则字面量**，返回其后一个位置；若该位置的 `/` 不是正则起点则返回 -1。
 *
 * ⚠ 为什么必须有它（本库首跑实测踩到）：`cleanOutput` 体内有 `/^((?:请优化…)/` 一类正则，
 *   其中含 `'` 与 `"` 字符 —— 只认字符串的扫描器会把正则里的引号当成**字符串起点**，
 *   于是整段被"吞进字符串"⇒ 括号配平永远收不满 ⇒ 函数体截不出来（首跑报 `cleanOutput` 缺失，
 *   而它明明在 `pure.js:319`）。⛔ 这不是 cleanOutput 的问题，是扫描器的缺陷。
 *
 * 判据（保守，宁可判"不是正则"也不误吞）：
 *   · 前一个**非空白**字符 ∈ `(,=:[!&|?{};+-*%~^<>` 或位于行首/`return`/`typeof` 之后 ⇒ 疑似正则起点；
 *   · 必须能在**同一行内**找到未转义的闭合 `/`（正则不能跨行）。
 * @param {string} s 源码
 * @param {number} i `/` 的位置
 * @returns {number} 闭合 `/` 之后的位置；不是正则则 -1
 */
function skipRegex(s, i) {
  let j = i - 1;
  while (j >= 0 && (s[j] === ' ' || s[j] === '\t')) j -= 1;
  const prev = j >= 0 ? s[j] : '';
  const allowed = '(,=:[!&|?{};+-*%~^<>';
  const prevWord = j >= 2 ? s.slice(Math.max(0, j - 6), j + 1) : '';
  const afterKeyword = /(?:return|typeof|case|in|of|delete|void|instanceof|new)$/.test(prevWord.trim());
  if (prev !== '' && !allowed.includes(prev) && !afterKeyword && prev !== '\n') return -1;
  let k = i + 1;
  let inClass = false;
  while (k < s.length) {
    const c = s[k];
    if (c === '\n') return -1;                  // 正则不跨行
    if (c === '\\') { k += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      k += 1;
      while (k < s.length && /[gimsuy]/.test(s[k])) k += 1;   // flags
      return k;
    }
    k += 1;
  }
  return -1;
}

/**
 * 从一份 chunk 文件原文里取出 `SHARED_FUNCTIONS` 的**逐字节定义**。
 *
 * fail-closed：任一函数取不到 ⇒ 该条 `missing`（调用方据此判红），**不静默跳过**。
 * @param {string} raw chunk 文件原文（`module.exports = "…"` 包裹形态）
 * @param {string} label 出错时点名的标识
 * @returns {{label:string, functions:Object<string,string>, missing:string[]}}
 */
export function extractShared(raw, label) {
  const src = decodeChunkText(raw, label);
  const functions = {};
  const missing = [];
  for (const name of SHARED_FUNCTIONS) {
    const def = extractFunction(src, name);
    if (def === null || def.trim() === '') missing.push(name);
    else functions[name] = def;
  }
  return { label, functions, missing, srcLength: src.length };
}

/**
 * 判据：多份副本之间，**每个共享函数逐字节相等**。
 *
 * @param {{label:string, functions:Object<string,string>, missing:string[]}[]} copies 至少 1 份
 * @returns {{ok:boolean, reason:string, observed:number, mismatches:Object[], missing:Object[]}}
 */
export function compareCopies(copies) {
  const list = Array.isArray(copies) ? copies : [];
  const observed = list.reduce((n, c) => n + Object.keys(c.functions || {}).length, 0);
  // ① 分母 fail-closed：份数 ≥ 1，且**每一份**都必须 7/7 齐
  if (list.length === 0) {
    return { ok: false, reason: '扫描面为空：一份 chunk 都没取到（fail-closed）', observed: 0, mismatches: [], missing: [] };
  }
  const missing = list
    .filter((c) => (c.missing || []).length > 0)
    .map((c) => ({ label: c.label, names: c.missing }));
  if (missing.length > 0) {
    const names = [...new Set(missing.flatMap((m) => m.names))];
    return {
      ok: false,
      reason: '共享函数扫不到（⛔ 不许因"扫得少"而判绿）：' + names.join(', ') + '；缺在 ' + missing.map((m) => m.label).join(', '),
      observed, mismatches: [], missing,
    };
  }
  // ② 逐字节：以第一份为基准
  const base = list[0];
  const mismatches = [];
  for (const name of SHARED_FUNCTIONS) {
    const b = base.functions[name];
    for (const c of list.slice(1)) {
      if (c.functions[name] !== b) {
        mismatches.push({ name, left: base.label, right: c.label, leftLen: b.length, rightLen: (c.functions[name] || '').length });
      }
    }
  }
  const ok = mismatches.length === 0;
  return {
    ok,
    reason: ok
      ? list.length + ' 份副本 × ' + SHARED_FUNCTIONS.length + ' 函数逐字节相等（条目 ' + observed + '）'
      : '共享函数漂移：' + mismatches.map((m) => m.name + '(' + m.left + ' vs ' + m.right + ')').join('; '),
    observed, mismatches, missing: [],
  };
}

/**
 * 默认扫描面：**当前（未拆包）** 只有 `src/host/pure.js` 一份；
 * **拆包后** 由 `splitSharedSources()` 自动发现各包目录下的 `pure.js` 等多份。
 *
 * ⚠ 自动发现规则（拆包后无需改本文件）：
 *   ① 若存在 `src/host/pure.js` ⇒ 纳入（拆包前形态）
 *   ② 若存在 `packages/<pkg>/…` 形态的 `src/host/pure.js` ⇒ 全部纳入（拆包后形态）
 * 这样「同一判据拆包前后都能跑」这条硬要求就落在**发现面**上，而不是靠人改清单。
 * @param {string} [root] 仓库根
 * @returns {string[]} 相对路径（已排序）
 */
export function splitSharedSources(root) {
  const base = root || REPO_ROOT;
  const out = [];
  const rel = 'src/host/pure.js';
  if (fs.existsSync(path.join(base, rel))) out.push(rel);
  const pkgDir = path.join(base, 'packages');
  if (fs.existsSync(pkgDir)) {
    for (const pkg of fs.readdirSync(pkgDir).sort()) {
      const candidate = path.join('packages', pkg, rel);
      if (fs.existsSync(path.join(base, candidate))) out.push(candidate.split(path.sep).join('/'));
    }
  }
  return out;
}

/** 读一份 chunk 并抽取（便捷入口，供环脚本与测试共用）。 */
export function loadCopy(root, rel) {
  const abs = path.resolve(root || REPO_ROOT, rel);
  const raw = fs.readFileSync(abs, 'utf8');
  if (chunkWrapperLiteral(raw) === null) throw new Error('chunk wrapper mismatch: ' + rel);
  return extractShared(raw, rel);
}

export default { SHARED_FUNCTIONS, extractFunction, extractShared, compareCopies, splitSharedSources, loadCopy, REPO_ROOT };
