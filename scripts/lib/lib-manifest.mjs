// scripts/lib/lib-manifest.mjs —— `lib/` 手改模块清单的**单一事实源**（P2 窄复核处置批 2026-10-13 · 处置 F-1）
//
// 病历（窄复核 F-1）：此前「`lib/` 有哪些手改模块」有**四处副本**且无判据锁它们一致 ——
//   ① `dead-code-gate.mjs` 的 `GENERATED_LIB` + `libTargets()`
//   ② `rpc-manifest.mjs` 内的 `generated` 集合 + 枚举
//   ③ `arch-claims.mjs` 的 `PE_F01_LIB_MANIFEST`（声明面 13 件）
//   ④ `arch-claims.mjs` 的 `S-6` 内联 `f !== 'client.cjs'`
//   ⇒ 实测：把 `GENERATED_LIB` 多排除一个真实手改模块，**R5 覆盖面 83→65 符号、R6 12→11**，
//   而 `gate` 绿、`A230-1` 绿、两条回归锁也绿 —— **全链零红**（判据变看不见而无人报警）。
// ⇒ 现收敛到本模块：**排除集 = 构建产物清单**，由 `scripts/build-client.mjs` 的写盘点派生并**锁死**。
//
// ⚠ 本模块**只声明"哪些不算手改面"**；"磁盘上实际有哪些 `.cjs`"由各消费方 `readdirSync` 现取
//   （这样新增手改文件**自动入网**，无需改本文件 —— 这正是要保住的第二形态）。
// ⚠ 本模块**不覆盖什么**：不判各文件**内容**是否真为手改（那需比对生成器，属 build --check 面）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 构建产物清单（**具名声明**，非通配）。
 *
 * ⚠ 单一事实源的**锚**：由 `scripts/build-client.mjs` 的 `writeFileSync(join(root, 'lib', X))`
 *   写盘点**派生**（下方 `deriveGeneratedFromBuilders()` 现取），而非另写一份字面量 ——
 *   若将来构建脚本改输出名/增产物，这里自动跟随；反之若有人手改本文件多排除一个真实手改模块，
 *   则与真实写盘点不符 ⇒ `ARCH-C1` 判据必红（见 `arch-claims.mjs`）。
 */
function deriveGeneratedFromBuilders() {
  const scripts = ['build-client.mjs'];   // host 产物在仓库根（plugin-host.js），不落 lib/
  const found = new Set();
  for (const s of scripts) {
    const p = path.join(ROOT, 'scripts', s);
    if (!fs.existsSync(p)) continue;
    // 只认「写 lib/ 下的文件」这一形态，避免把读盘点也算进去
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/writeFileSync\(\s*join\(root,\s*'lib',\s*'([^']+)'/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

/** 构建产物清单（构建脚本派生；派生失败时回退到具名基线并**标记**，由判据处置）。 */
export function generatedLibFiles() {
  const derived = deriveGeneratedFromBuilders();
  if (derived.size > 0) return [...derived].sort();
  return ['client.cjs'];   // 基线兜底（build-client.mjs 缺席时）
}

/** `lib/` 下全部 **手改** `.cjs`（relPath 形如 `lib/asr.cjs`）——「磁盘 ∩ 非生成」。 */
export function libHandwrittenTargets() {
  const dir = path.join(ROOT, 'lib');
  if (!fs.existsSync(dir)) return [];
  const gen = new Set(generatedLibFiles());
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.cjs') && !gen.has(f))
    .sort()
    .map((f) => 'lib/' + f);
}

/** `lib/` 下全部 `.cjs` 文件名（含生成物）——供「声明面等值集」类判据使用。 */
export function libAllCjsNames() {
  const dir = path.join(ROOT, 'lib');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).sort();
}
