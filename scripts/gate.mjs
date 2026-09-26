#!/usr/bin/env node
// scripts/gate.mjs — 门禁链编排器：**全跑 + 汇总退出码**（P4 · 2026-09-26 红队修复波 2 / F1）
//
// 为什么要有它（根因 R2：短路遮蔽）：
//   package.json 的 gate 原为 `a && b && c && d && e` 串行链。`&&` 在前一环保红时
//   **根本不执行后续环** —— 2026-09-26 实测：第 4 环（arch-claims --check，因本地治理档
//   标记区记的是旧一次运行读数）恒红 ⇒ 第 5 环（card-arch-consistency）日志里连一行都没有。
//   那不是"绿"，那是**读数被吃掉**；环越多被吃掉的面越大。
//   CI 只对**步骤级**加了 `if: always()`（.github/workflows/ci.yml），环级仍是 `&&` —— 同一个病在更细的粒度上复发。
//
// 本编排器做什么：
//   按序 spawn 每一环，**不短路**；逐环打印机读行 `RING <id> <PASS|FAIL|SKIP> <摘要>`，
//   并保留各环原始输出（缩进 4 空格，便于定位）；任一环 FAIL ⇒ 汇总 exit 1；全 PASS ⇒ 0。
//
// 判定口径（P5 · 2026-09-26 **终结文本启发式**）：
//   ⚠ 本文件**不再对环的输出做任何文本匹配**——判定只读环自己声明的机读契约行：
//        RING-STATE <id> <PASS|FAIL|SKIP> <reason>        （走 stderr，恰一行）
//   契约与解析器同源在 `scripts/lib/ring-state.mjs`（产出侧与消费侧共用一份，避免两处各写一套）。
//   为什么非改不可：此前四环无机读三态，本编排器只能靠「行首锚定 + 全输出定位」**猜**——连改三次仍没治好
//     （I2 整段子串匹配误判 → N2 末 4 行窗口把 SKIP 读成 PASS → N4 措辞自含反义子串）。
//     根因不是正则写得对不对，而是**环没有状态出口**；环一换措辞，SKIP 就可能被读成 PASS。
//
//   裁决优先级：**结构 > 退出码 > 退化位**。环按契约输出时，退出码只在**与状态矛盾**时才参与（取严）。
//   退化位（穷举，仅当环**完全没有**契约行时适用；不含任何措辞匹配）：
//     D0 多条状态行 / D1 id 不符 / D2 状态与退出码矛盾 -> FAIL
//     D3 有输出但无契约行（旧版环 / 未接线）          -> FAIL（fail-closed，不猜）
//     D4 零输出 + exit 0                             -> SKIP「无读数」（没跑 ≠ 判过，**不是 PASS**）
//     D5 零输出 + exit != 0                          -> FAIL
//   ⚠ 「崩溃」与「判红」过去在 RING 行同形（都是 `FAIL exit 1`，靠摘要里恰好出现的字符区分）——
//     现在由**来源位**区分：环自报 FAIL = 判红；退化位 FAIL = 崩溃/未接线/契约违背（摘要行前缀写明）。
//
// 环清单出处：**原 package.json 命令逐字继承**（含 --check 旗标），不改旗、不改序、不新增依赖。
// 用法：node scripts/gate.mjs [--json] [--quiet]
//   --json   机读汇总（各环 id/状态/退出码/耗时/摘要）
//   --quiet  只打 RING 行与汇总，不打各环原始输出

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// P5 状态出口契约（**产出侧与消费侧同一份实现**）：本文件只调 deriveState()，不做文本匹配。
import { deriveState, summarize, verdictOf } from './lib/ring-state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const RING_TIMEOUT_MS = Number(process.env.GATE_RING_TIMEOUT_MS || 180000);

// ⚠ 各环**必须以 `scripts/<名>.mjs` 字面量**写在这里：arch-claims 的 B234-1 会下探入口脚本，
//    取不到零环即判红（fail-closed）。改链时同步在这里增删，并与 arch-claims 的 GATE_RINGS 点名面对齐。
const RINGS = [
  { id: 'dead-code', script: 'scripts/dead-code-gate.mjs', args: [] },
  { id: 'rpc', script: 'scripts/rpc-manifest.mjs', args: ['--check'] },
  { id: 'prompts', script: 'scripts/sync-prompts.mjs', args: ['--check'] },
  { id: 'arch-claims', script: 'scripts/arch-claims.mjs', args: ['--check'] },
  // ⚠ P5：selfReport 字段已**删除**——各环统一走 RING-STATE 契约行，
  //   不再需要「哪一环该走哪套正则」的登记（那正是补丁史的来源）。
  { id: 'cards', script: 'scripts/card-arch-consistency.mjs', args: ['--check'] },
];

/** 摘要/摘录/裁决全部在 ring-state.mjs —— 本文件**不做任何文本匹配**（P5）。 */

// 状态裁决**只此一处**：读环自报的契约行（scripts/lib/ring-state.mjs）→ 三态。
// 本文件不解释任何自然语言：没有任何对环输出的正则/子串匹配（P5 验收②）。
const results = [];
const t0 = Date.now();
for (const r of RINGS) {
  const started = Date.now();
  let code = null; let text = ''; let note = '';
  if (!fs.existsSync(path.join(ROOT, r.script))) {
    code = null; note = '脚本不在位：' + r.script;
  } else {
    const p = spawnSync(process.execPath, [r.script, ...r.args], {
      cwd: ROOT, encoding: 'utf8', timeout: RING_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
    });
    code = p.status;
    // ⚠ 两流之间**显式补一个换行**：否则若某环 stdout 不以 \n 结尾，契约行会与末行黏成一行而不可解析
    //   （独立复核席反例 R3：实测五环当前均以 \n 结尾，故原实现侥幸可用——这里消除该隐式依赖）。
    text = (p.stdout || '') + '\n' + (p.stderr || '');
    if (p.error) note = String(p.error.message).slice(0, 80);
    if (p.signal) note = '被信号 ' + p.signal + ' 终止';
  }
  // 只读结构：环自报的契约行 → 三态（退化位亦在 ring-state.mjs 内穷举，本文件不猜措辞）。
  const v = deriveState({ id: r.id, exitCode: note ? null : code, text, note });
  // ⚠ **结构性判据**（独立复核席 V2/V3 反例的根治）：条目一构造即冻结。
  //   复核席证明「按变量名/引用数做代理判据」可被绕开——例如在 results 构造完成后回改
  //   `e.status='PASS'`（全文不含标识符 text、零配额操纵），即可把 SKIP 翻成 PASS 而 12 条用例零失败。
  //   冻结把「事后改写」从**静默假绿**变成**硬失败**（ESM 严格模式 ⇒ 赋值抛 TypeError ⇒ 进程非零退出），
  //   且该保护与任何变量名无关：改名、别名、换容器都绕不过「对象已冻结」这一事实。
  results.push(Object.freeze({
    id: r.id, script: r.script, args: r.args,
    status: v.state, source: v.source, exit: code,
    ms: Date.now() - started, summary: summarize(v), text,
  }));
}

// ⚠ 结果集构造完成后**整体冻结**：条目冻结挡住「回改字段」（V3 反例），数组冻结挡住
//   「替换元素」（results[i] = {...}）。两者都是与变量名无关的结构性约束——
//   任何事后改写在此处都是硬失败，而不是静默假绿。
Object.freeze(results);

if (!has('--json')) {
  console.log('门禁链（全跑 · 不短路）· scripts/gate.mjs');
  console.log('环数 ' + RINGS.length + '｜各环以 scripts/<名>.mjs 字面量声明（arch-claims B234-1 会下探）');
  console.log('');
  for (const r of results) {
    console.log('── ' + r.id + ' · node ' + r.script + (r.args.length ? ' ' + r.args.join(' ') : ''));
    if (!has('--quiet') && r.text.trim()) {
      // 纯显示：逐行缩进原文。**这里不做任何匹配/判定**（本文件已无正则）。
      for (const l of r.text.trimEnd().split('\n')) console.log('    | ' + l);
    }
    const codeTxt = r.exit === null ? '(无退出码)' : 'exit ' + r.exit;
    console.log('RING ' + r.id + ' ' + r.status + ' ' + codeTxt + ' · ' + r.ms + 'ms · ' + r.summary);
    console.log('');
  }
  const V = verdictOf(results);
  console.log('汇总：' + V.total + ' 环 -> PASS ' + V.pass + ' · FAIL ' + V.fail + ' · SKIP ' + V.skip + '｜总耗时 ' + (Date.now() - t0) + 'ms');
  console.log('  环状态：' + results.map((r) => r.id + '=' + r.status).join(' '));
  const bad = results.filter((r) => r.status === 'FAIL');
  if (bad.length) console.log('  FAIL 明细：' + bad.map((r) => r.id + '（' + (r.exit === null ? '无退出码' : 'exit ' + r.exit) + '）').join(' · '));
  const sk = results.filter((r) => r.status === 'SKIP');
  if (sk.length) console.log('  SKIP 明细：' + sk.map((r) => r.id).join(', ') + '（不记 PASS，需人判）');
  // ⚠ 措辞三态（b2 · I3）：有 SKIP 就**不得**说「全过」——"没判上"与"判过了"必须在同一行里可区分
  if (bad.length) console.log('✗ 门禁链未通过：' + V.fail + ' 环 FAIL（其余环读数已在上面，未被遮蔽）');
  // ⚠ 措辞不得自含反义子串（b3 · N4）：旧文案 `（…本条**不是**全过）` 自身含「全过」，
  //   `grep -c 全过` 会把它读成本链全过（措辞面假绿）。改为**不含该子串**的否定式表述。
  else if (V.skip) console.log('⏭ 门禁链未判全：PASS ' + V.pass + ' · SKIP ' + V.skip + '（有环未判，本条不记通过）');
  else console.log('✓ 门禁链全过：' + V.pass + ' 环 PASS（无 SKIP）');
} else {
  console.log(JSON.stringify({
    rings: results.map(({ text, ...r }) => r),
    summary: { ...verdictOf(results), ms: Date.now() - t0 },
  }, null, 1));
}

// 退出码与上面的汇总/JSON **同源**（verdictOf 一个裁决点），不另算一遍。
process.exitCode = verdictOf(results).exitCode;
