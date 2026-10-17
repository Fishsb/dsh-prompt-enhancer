// scripts/lib/chunk-decode.mjs —— **chunk 导出契约解码器**的单一事实源
// （契约面收口批 · 2026-10-17 · 第 ② 件：`decodeChunk` 副本收敛）
//
// 病历（为什么要有这个模块）：
//   本仓有 **7 份**「把 `module.exports = "<JSON 转义源码>"` 解回源码原文」的实现
//   （5 份叫 `decodeChunk` + 2 份同契约异名：`decodeStateChunk` / `decodeChunkFile`）。
//   它们**判别力不等**，实测（本批逐处实读，报告 §② 清点表）：
//     · `test/filler.test.cjs:13` —— **无守卫**：`JSON.parse('"' + m[1] + '"')` 在 `m === null`
//       时抛的是 `TypeError: Cannot read properties of null (reading '1')` ⇒ **报错不点名文件**
//       （读者拿不到是哪个 chunk 坏了）；
//     · 其余各份写法互不相同的正则 + `throw` / `assert.ok`。
//   ⇒ **同一契约手工多副本**：任一处被顺手改弱，其余六处照样报绿（判据的面被拆散）。
//
// ⚠ 本模块只做「**一份解码器**」，**不引入新机制**：正则、`JSON.parse('"'+…+'"')` 转义还原、
//   「读文件 → 解出源码」这一套全部照搬既有实现，只是把**唯一那份**搬到这里共享
//   （同 `scripts/lib/lib-manifest.mjs` / `code-only.mjs` / `sync-face.mjs` 的既有收敛先例）。
//
// ⚠ 判别力**只升不降**（本批硬要求）：
//   · 取**行首锚定**形态 —— 它是三份变体里**唯一**能防「chunk 头部注释里含代码样文本」误导的
//     （实测：`loose` 在含 decoy 注释的夹具上直接 JSON 解析失败，`anchored` 正确取回真源码）；
//   · **fail-closed 且点名声** —— 解不出包裹即 `throw new Error('… ' + label)`，
//     不再有「无守卫 ⇒ TypeError 不点名」与「assert.ok 不抛指定信息」两种弱形态；
//   · 真实 29 个 chunk（`src/client` 24 + `src/host` 5）上，本解码器与既有各份**取值逐个相同**
//     （本批实测，报告 §②）。
//
// ⚠ 本模块**不碰** `scripts/dead-code-gate.mjs` 的 R2 与 `scripts/arch-claims.mjs` 的 S-7
//   各自的解码腿：那两处是**门禁环内部**实现（R2 已由收口批改 fail-closed），
//   与本模块面向的 `test/**` 面不是同一消费者面；本批范围是「消除 test 面的多副本」。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根（`scripts/lib/` → 上两级）。相对路径入参按此解析。 */
export const REPO_ROOT = path.join(HERE, '..', '..');

/**
 * chunk 包裹的**行首锚定**正则，捕获组 1 = JSON 转义后的源码字面量内容。
 *
 * ⚠ 三点形态依据（逐条实测，勿顺手改）：
 *   ① `(?:^|\n)` 行首锚定：chunk 头部注释里出现 `module.exports = "…"` 样文本时，
 *      裸 `module\.exports` 会被**第一个**（注释里的）命中误导（实测：`loose` 形态在
 *      decoy 夹具上 JSON 解析直接失败）；
 *   ② `\s*=\s*`：既有副本里 `official-bridge` 写死空格、其余写 `\s*=\s*`；
 *      取宽松一侧 ⇒ **不在既有 29 个 chunk 上收紧覆盖面**（实测两者取值相同），
 *      而锚定腿独立承担防误导；
 *   ③ `;?[ \t\r\n]*$`：源文件可带 CRLF（`\r`）或结尾无换行 —— 实测
 *      `src/client/components/model-main-section.js` 以 `\r\n"` 结束，
 *      旧 `client-enhance-flow` 那份要求 `;\s*\n$` 的变体在它上面**直接 NO-MATCH**。
 */
export const CHUNK_WRAPPER_RE = /(?:^|\n)module\.exports\s*=\s*"([\s\S]*)";?[ \t\r\n]*$/;

/**
 * 从**已读入的 chunk 原文**中取出包裹字面量（未做 JSON 转义还原）。
 * @param {string} raw chunk 文件原文
 * @returns {string|null} 捕获到的 JSON 字面量内容；读不出包裹时为 `null`
 */
export function chunkWrapperLiteral(raw) {
  const m = String(raw).match(CHUNK_WRAPPER_RE);
  return m ? m[1] : null;
}

/**
 * 把**已读入的 chunk 原文**解回源码原文（= `module.exports` 里那个字符串的值）。
 *
 * fail-closed：读不出包裹即**抛错**，错误信息**点名** `label`（文件路径或调用方给的可读标识）。
 * @param {string} raw chunk 文件原文
 * @param {string} label 出错时点名的标识（通常是文件相对/绝对路径）
 * @returns {string} 解出的源码原文
 */
export function decodeChunkText(raw, label) {
  const lit = chunkWrapperLiteral(raw);
  if (lit === null) {
    throw new Error(
      'chunk wrapper mismatch: ' + label
      + ' 未导出 `module.exports = "<JSON 转义源码>"` 包裹形态'
      + '（裸 JS / 包裹缺失 ⇒ 构建期会把对象字符串化成 [object Object] 注入产物）',
    );
  }
  return JSON.parse('"' + lit + '"');
}

/**
 * 读 chunk 文件并解回源码原文。
 *
 * @param {string} file 绝对路径，或相对**仓库根**（可用 `opts.root` 覆盖）的路径
 * @param {{root?: string}} [opts] `root`：相对路径的解析基准，缺省 = 本仓根
 * @returns {string} 解出的源码原文
 */
/**
 * 枚举 chunk 文件（**与 `dead-code-gate` 的 R7 同一口径**：递归、排除 `vendor`、只认 `.js`）。
 *
 * ⚠ 为什么放在这里（本仓 S6 教训）：枚举规则一旦各处各写一份，就会出现「判据扫的面
 *   与门禁扫的面不是同一个面」—— 某处漏掉一个目录，判据照样打 PASS。
 *   ⇒ 本函数是 test 面的**唯一枚举口径**；`dead-code-gate.mjs` 的 R7 环是它的对拍源
 *     （测试侧 CS-13 拿 R7 自报的 chunk 数来核本函数读数，不一致即红）。
 *   ⚠ 本批**不改** `dead-code-gate.mjs`（硬边界：不动环结构）⇒ 两侧仍是各自实现，
 *     但**读数被交叉校验**，漂移不会被静默吞掉。
 *
 * @param {string} root 仓库根
 * @param {string} [relDir] 相对 root 的目录（缺省 = 两面都扫 src/client + src/host）
 * @returns {string[]} 相对 root 的 POSIX 路径，已排序
 */
export function listChunkFiles(root, relDir) {
  const dirs = relDir ? [relDir] : [path.join('src', 'client'), path.join('src', 'host')];
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      // 与 R7 同一排除口径（vendor 不属本仓契约面）
      if (ent.isDirectory()) { if (ent.name !== 'vendor') walk(full); continue; }
      if (ent.name.endsWith('.js')) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  for (const rel of dirs) walk(path.join(root, rel));
  return out.sort();
}
export function decodeChunk(file, opts) {
  const root = (opts && opts.root) || REPO_ROOT;
  const abs = path.isAbsolute(file) ? file : path.resolve(root, file);
  return decodeChunkText(fs.readFileSync(abs, 'utf8'), file);
}

export default decodeChunk;
