'use strict';
// chunk 契约 · 逐件 fail-closed 锁（2026-10-17 · chunk 加固批）
//
// 本文件要防的形态（本例由 TASK §2 点名，本席实读复核后按实测落地）：
//   ⚠ `R7` 覆盖 29 chunk（**用 require 判导出形态**），`CS-09` 用旧正则做全量取值对拍 ——
//     但**两者都不是**「解码失败必须抛错、不得回落原文」这条契约的**逐件**断言：
//       · `R7` 判的是 `typeof v === 'string'`（对「裸 JS chunk 里恰好 `module.exports` 是字符串」
//         这一形态无感 —— 实测：把 chunk 改成 `module.exports = "…"` 之外但**仍导出 string** 的写法，
//         R7 照绿，而解码器已读不出包裹）；
//       · `CS-09` 断言的是「解码器取值 == 旧正则取值」——两侧**同源同错**时不张口。
//   ⇒ 本文件对**每个** chunk 各写一条：**解码必须解出非空字符串；且该 chunk 若被改成裸 JS
//     （= 本仓事故的真实形态），`decodeChunkText` 必须**抛错**而不是回落原文。
//
// ⚠ 枚举口径：`listChunkFiles()`（`scripts/lib/chunk-decode.mjs`，与 `dead-code-gate` R7 同一规则）
//   —— ⛔ 本文件**不自己 readdir 一套**（那才是「同一事实第二份实现」）。R7 自报读数另做交叉校验。
// ⚠ 解码一律走既有解码器 `decodeChunkText` —— ⛔ 不内联自写包裹正则/JSON 还原（本仓已收敛过一次）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const chunkDecode = require(path.join(ROOT, 'scripts', 'lib', 'chunk-decode.mjs'));
const { decodeChunkText, chunkWrapperLiteral, listChunkFiles } = chunkDecode;

const CHUNKS = listChunkFiles(ROOT);

test('CH-01 枚举面非空且与 R7 自报读数同值（跨实现交叉校验，不是第二份枚举）', () => {
  assert.ok(CHUNKS.length > 0, '枚举必须非空（空清单 ⇒ 后面的逐件断言全部空转）');
  // 与既有门禁**对拍**：R7 的自报行里那个数字是它自己枚出来的面。两侧不一致 ⇒ 有一侧漏了。
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dead-code-gate.mjs')], { cwd: ROOT, encoding: 'utf8' });
  const m = String(r.stdout || '').match(/R7 \| (\d+) 个 chunk/);
  assert.ok(m, 'R7 自报行必须可读（读不到 ⇒ 本交叉校验无被测物，不得静默跳过）：' + String(r.stdout || '').slice(0, 200));
  assert.equal(String(CHUNKS.length), m[1],
    'listChunkFiles 与 R7 枚举面必须逐数同值（两侧各自实现 ⇒ 借此互相咬住）');
});

test('CH-02 逐件 fail-closed：每个 chunk 解码后必须是**非空字符串**，且解出的仍可求值', () => {
  assert.ok(CHUNKS.length > 0, '前置：枚举非空');
  const bad = [];
  for (const rel of CHUNKS) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    let out;
    try { out = decodeChunkText(raw, rel); }
    catch (e) { bad.push(rel + ' 解码抛错：' + String(e.message).slice(0, 100)); continue; }
    if (typeof out !== 'string') { bad.push(rel + ' 解码结果不是字符串（实得 ' + typeof out + '）'); continue; }
    if (out.length === 0) { bad.push(rel + ' 解码为空字符串'); continue; }
    // 解出的源码必须可过语法（chunk 内是 JS 源码文本，不是任意字符串）
    try { new Function(out); } catch (e) { bad.push(rel + ' 解码后不可解析：' + String(e.message).slice(0, 80)); }
  }
  assert.deepEqual(bad, [], '以下 chunk 未满足解码契约：' + bad.join(' / '));
});

test('CH-03 逐件变异：把**任一** chunk 改成裸 JS ⇒ 解码器必须抛错，不得回落原文', () => {
  // 真实形态（本仓事故）：chunk 文件里直接写裸 JS（无 module.exports = "…" 包裹）。
  // 判据：decodeChunkText 必须**抛错**。⚠ 这条正是「静默回落原文」的反面 ——
  //   旧实现（R2 曾用 `mm ? JSON.parse(…) : raw`）在此形态下会把裸 JS 当 chunk 源码继续用 ⇒ 假绿。
  // 抽样：全部 chunk 各跑一遍（纯字符串运算，无 IO 变异，代价可忽略）。
  const leaked = [];
  for (const rel of CHUNKS) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const inner = decodeChunkText(raw, rel);
    // 构造「裸 JS」：把解出的源码原样写回（= 去掉包裹）
    let threw = false;
    try { decodeChunkText(inner, rel + '(bare)'); } catch (e) { threw = true; }
    if (!threw) leaked.push(rel);
  }
  assert.deepEqual(leaked, [],
    '以下 chunk 在裸 JS 形态下**没有抛错** ⇒ 解码器回落了原文（静默假绿）：' + leaked.join(', '));
});

test('CH-04 负控：真实工作区不动 ⇒ 全部 chunk 解码必成功（防「恒抛」）', () => {
  // 与 CH-03 成对：CH-03 证明「坏形态必抛」，本条证明「好形态必不抛」。
  // 缺任一条，判据都可能被写成恒真/恒假。
  const ok = CHUNKS.filter((rel) => {
    try { decodeChunkText(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel); return true; } catch (e) { return false; }
  });
  assert.equal(ok.length, CHUNKS.length, '真实工作区全部 chunk 必须可解（实得 ' + ok.length + '/' + CHUNKS.length + '）');
});
