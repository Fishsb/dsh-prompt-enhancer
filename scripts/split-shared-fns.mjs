#!/usr/bin/env node
// scripts/split-shared-fns.mjs —— 环 `cross: shared-fns`（拆包前置批 · 2026-10-20）
//
// 判据（一句话）：**两包各自那份「7 个共享 host 函数」必须逐字节相等**。
//
// 为什么它必须存在（CHG-289 §2.3 实读）：
//   `voice/correct` 复用增强包的模型链 —— `plugin-host.js:4633` `validateConfig(args.config)`、
//   `:4653` `buildTryChain(cfg.fallback)`；这两件都在 `src/host/pure.js` 里
//   ⇒ `pure.js` **不是纯包1 资产**，拆包后包2 必须自带同一批函数（`N4`：两包各一份同源副本）。
//   两份副本一旦漂移，同一个纠错/增强请求在两个包里行为不同 —— 那是**最坏的一类缺陷**
//   （同一输入两种结果，且没有任何单一位置能看出差异）。
//
// ⚠ 三道防线（缺一条就是假绿）：
//   ① **分母 fail-closed**：7 个函数逐个点名；任一取不到 / 函数体为空 / 总条目 < 7 ⇒ 红。
//      ⛔ 不许「扫得少所以都相等」这种空跑式绿。
//   ② **逐字节**：以第一份为基准，其余必须逐字节相等；不等时点名函数名与两侧。
//   ③ **可反向自证**：真正的判定在 `scripts/lib/split-shared-fns.mjs`（纯函数），
//      测试可喂「改一个字符」的伪副本 ⇒ 必红。
//
// 用法：node scripts/split-shared-fns.mjs [--check] [--json]

import { emitRingState, installCrashGuard } from './lib/ring-state.mjs';
import { SHARED_FUNCTIONS, splitSharedSources, loadCopy, compareCopies, REPO_ROOT } from './lib/split-shared-fns.mjs';

installCrashGuard('shared-fns');
const args = process.argv.slice(2);

const sources = splitSharedSources(REPO_ROOT);
const fails = [];
let result = { ok: false, reason: '', observed: 0, mismatches: [], missing: [] };

if (sources.length === 0) {
  fails.push('发现面为空：一份 chunk 都没找到（fail-closed；拆包前应命中 src/host/pure.js）');
} else {
  let copies = [];
  try {
    copies = sources.map((rel) => loadCopy(REPO_ROOT, rel));
  } catch (e) {
    fails.push('读取/解码失败：' + String((e && e.message) || e));
  }
  if (copies.length > 0) {
    result = compareCopies(copies);
    if (!result.ok) fails.push(result.reason);
  }
}

if (result.observed < SHARED_FUNCTIONS.length) {
  const msg = '共享函数条目不足（fail-closed）：取到 ' + result.observed + ' 项，下限 ' + SHARED_FUNCTIONS.length;
  if (!fails.includes(msg)) fails.push(msg);
}

if (args.includes('--json')) {
  console.log(JSON.stringify({
    sources,
    sharedFunctions: [...SHARED_FUNCTIONS],
    observed: result.observed,
    mismatches: result.mismatches,
    missing: result.missing,
    fails,
  }, null, 2));
} else {
  console.log('共享函数面（cross: shared-fns）');
  console.log('  发现面: ' + sources.length + ' 份  ' + JSON.stringify(sources));
  console.log('  应有函数: ' + SHARED_FUNCTIONS.length + ' 项  ' + JSON.stringify([...SHARED_FUNCTIONS]));
  console.log('  实取条目: ' + result.observed + ' 项');
}

if (args.includes('--check')) {
  if (fails.length) {
    console.error('\n✗ 共享函数一致性未通过：');
    for (const f of fails) console.error('  · ' + f);
    emitRingState('shared-fns', 'FAIL', fails.length + ' 条：' + fails.slice(0, 2).join(' / '));
    process.exit(1);
  }
  console.log('\n✓ ' + sources.length + ' 份副本 × ' + SHARED_FUNCTIONS.length + ' 函数逐字节相等（条目 ' + result.observed + '）');
  emitRingState('shared-fns', 'PASS',
    sources.length + ' 份副本/' + SHARED_FUNCTIONS.length + ' 函数逐字节相等（条目 ' + result.observed + '，分母下限 ' + SHARED_FUNCTIONS.length + '）');
} else {
  emitRingState('shared-fns', 'SKIP', '未带 --check（报表形态，未判一致性）');
}
