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
//   并保留各环原始输出（缩进 4 空格，便于定位）。
//
// 链级退出码（T3 / N3 · 2026-09-27 · **用户裁定 A**；语义唯一出处 = scripts/lib/gate-exit.mjs）：
//   0 = 全过（全环真判过且通过）／ 1 = 有环 FAIL ／ 2 = **未判全**（有环 SKIP·没读数，且无 FAIL）
//   ⚠ 本次之前 0 与 2 **同形**：文案已区分（`⏭ 未判全` vs `✓ 全过`），但机器面只靠 --json，
//     而全仓无消费者 ⇒ CI 只看退出码时「有环没判」与「全判通过」给出**完全相同的绿信号**（N3 根因）。
//   ⚠ 未判全**不得**被读成大失败：CI 侧按裁定是**显式接纳**已知构造性缺位（见下方 --accept-unjudged），
//     凭据是"哪些环没判"这份可枚举清单，而不是把 2 当成 1 处理。
//   ⚠ 本文件正被另一席（T1：环统一结构化状态出口）同批改写，其稿把链级语义写作「SKIP 亦 0」——
//     与本裁定冲突。此处按**用户裁定**实现；冲突须在合并时以裁定为准（交接里已如实登记）。
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
// 用法：node scripts/gate.mjs [--json] [--quiet] [--accept-unjudged=id1,id2]
//   --json   机读汇总（各环 id/状态/退出码/耗时/摘要；summary 另含 unjudged/accepted/exit/exitText）
//   --quiet  只打 RING 行与汇总，不打各环原始输出
//   --accept-unjudged=<环id 逗号表>  **消费者显式声明**的「构造性缺位」基线：仅当未判集合 ⊆ 该集合时，
//     链级 2 降为 0 并打印接纳行；给出集合与其外的未判环 ⇒ 仍为 2（新缺位不被静默吞掉）。
//     缺省**不给**该旗标 ⇒ 一律不接纳（本地裸跑因此诚实地报 2）。CI 侧由 `.github/workflows/ci.yml`
//     显式传值，值的位置是 CI 文件而不是本文件（不静默替消费者做放行决定）。

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 环级状态出口契约（T1/P5）：产出侧与消费侧同一份实现，本文件只调 deriveState()，不做文本匹配。
// 链级三态退出码（T3/N3 · 用户裁定 A）：契约与纯函数唯一出处，本文件只做接线，不自带第二份语义。
import { deriveState, summarize } from './lib/ring-state.mjs';
import { GATE_EXIT, verdictOf as chainVerdict, exitCodeOf, parseAcceptBaseline, applyBaseline } from './lib/gate-exit.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
// ── 环上限与三档硬顶（2026-09-26）────────────────────────────────────────────
// 环上限 120s ⇒ 五环串行最坏 5×120 = **600s**，须**严格小于** CI 的两侧硬顶：
//   环之和 600s  <  步上限 720s（.github/workflows/ci.yml gate 步 timeout-minutes: 12）  <  作业上限 900s（job timeout-minutes: 15）
// ⚠ 旧值 180000 的病灶：5×180 = 900s **正好等于作业硬顶**（三档取等 ⇒ 零余量）——任一环挂死到上限，
//   作业级 cancelled 先吃掉其后所有步骤（Run tests / 产物一致性）与唯一 artifact（test-report.txt）
//   ⇒ 门禁与测试一起失去读数（本仓核心纪律：判据之间不得互相遮蔽）。
// 取 120s 的依据（**本机实测，非估计**）：2026-09-26 五环全跑合计 580ms
//   （dead-code 104ms · rpc 58ms · prompts 65ms · arch-claims 300ms · cards 52ms）⇒ 单环 120s 仍有 ~400× 头寸。
// 步上限 720s 只做**兜底**：环之和留 120s 余量，正常路径下本编排器会先打印完 5 行 RING + 汇总退出码
//   再退出，不被作业拦腰杀掉（被杀时未打印的 RING 行即丢失读数）。
// 环境变量 GATE_RING_TIMEOUT_MS 仍可覆盖（排障用）；改它或改 CI 两侧时，须复核上面三档仍严格递增。
const RING_TIMEOUT_MS = Number(process.env.GATE_RING_TIMEOUT_MS || 120000);
/** 接纳基线：null = 未声明（不接纳任何未判）；[] = 声明为空（同样不接纳，fail-closed） */
const ACCEPT_BASELINE = parseAcceptBaseline(ARGS);

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

// ── 链级三态（T3 / N3 · 用户裁定 A）──────────────────────────────────────────────
// 先判后打：verdict 只由**各环状态**派生（失败优先 ⇒ 任一 FAIL 即 1，不再看 SKIP）；
// 未判全（SKIP / 空环表）→ 2，除非消费者**显式**声明接纳基线且未判集合 ⊆ 基线（降 0 并留痕）。
const unjudged = results.filter((r) => r.status !== 'PASS').map((r) => r.id);
const verdict = chainVerdict(results.map((r) => r.status));
// 可接纳面 = SKIP（构造性缺位，可枚举可基线化）；不可接纳面 = 其余一切非 PASS（FAIL 已由 verdict 压住，
// UNKNOWN / 未来新增态一律进 blocking ⇒ 不得被基线吸收，见 gate-exit.mjs 的 D2 说明）。
const acceptable = results.filter((r) => r.status === 'SKIP').map((r) => r.id);
const blocking = results.filter((r) => r.status !== 'PASS' && r.status !== 'SKIP').map((r) => r.id);
const applied = applyBaseline(verdict, [...acceptable, ...blocking], ACCEPT_BASELINE, blocking);
const EXIT = applied.code;
// ⚠ 措辞纪律（b2·I3 / b3·N4）：**有环未判就不得说「全过」**——即便已按基线接纳（那时退出码是 0，
//   但"哪些环没判上"是事实，不得被 0 洗掉）。SELF_REPORT 式反义子串同理：接纳态文案不得含「全过」。
const EXIT_TEXT = verdict === 'FAIL' ? '未通过'
  : verdict === 'ALL_PASS' ? '全过'
    : (applied.accepted ? '未判全（已按基线接纳）' : '未判全');
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
  // 计数来自环级结构（T1）；链级三态来自唯一出处 gate-exit（T3 · 用户裁定 A）——不互相借语义。
  const nOf = (st) => results.filter((r) => r.status === st).length;
  const V = { total: results.length, pass: nOf('PASS'), fail: nOf('FAIL'), skip: nOf('SKIP') };
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
  else if (applied.accepted) {
    // 接纳 ≠ 判过：先把"哪些环没判上"原样打出来（可枚举），再说这属于**已声明**的构造性缺位。
    console.log('⏭→✓ 链级未判全，但落在消费者声明的接纳基线内：' + applied.unjudged.join(', ')
      + '（基线 ' + applied.baseline.join(', ') + ' —— 扫描面在仓外+gitignore，干净 clone/CI 必然缺位）');
  }
  else if (nOf('SKIP')) console.log('⏭ 门禁链未判全：PASS ' + nOf('PASS') + ' · SKIP ' + nOf('SKIP') + '（有环未判，本条不记通过）');
  else console.log('✓ 门禁链全过：' + nOf('PASS') + ' 环 PASS（无 SKIP）');
  // 退出码与文案同一处落（**不得**在别处再算一次退出码——两份判定必然漂移）
  console.log('退出码：' + EXIT + '（' + EXIT_TEXT + '）'
    + (verdict === 'NOT_FULLY_JUDGED' ? (applied.accepted
      ? '｜⏭ 本轮有环未判（' + applied.unjudged.join(',') + '）——退出码 0 来自**基线接纳**，不是"全判通过"'
      : '｜⏭ 未判全 — 有环没判上，与 0（全过）**不同码**（N3）') : '')
    + (verdict === 'FAIL' && results.some((r) => r.status === 'SKIP') ? '｜⚠ 本轮同时存在未判环（失败优先，先修 FAIL）' : ''));
} else {
  console.log(JSON.stringify({
    rings: results.map(({ text, ...r }) => r),
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === 'PASS').length,
      fail: results.filter((r) => r.status === 'FAIL').length,
      skip: results.filter((r) => r.status === 'SKIP').length,
      unjudged: unjudged,                    // 非 PASS 的全部（含 SKIP / 未来可能新增的非 PASS 态）
      unjudgedSkip: results.filter((r) => r.status === 'SKIP').map((r) => r.id),
      baseline: applied.baseline,            // 消费者声明的接纳基线（未声明 = null）
      accepted: applied.accepted,            // true ⇔ 已按基线把 2 降为 0（仅此一种情形）
      unexpected: applied.unexpected,        // 基线**之外**的未判环（非空 ⇒ 不接纳）
      verdict: verdict,
      exit: EXIT,                            // 链级三态退出码（与 process.exitCode 同值，单一出处）
      exitText: EXIT_TEXT,
      ms: Date.now() - t0,
    },
  }, null, 1));
}

// 链级退出码（三态）：0 全过 · 1 有 FAIL · 2 未判全（除消费者显式接纳的基线内缺位）。
// ⚠ 语义唯一出处 = scripts/lib/gate-exit.mjs；本行只落值，不再自带第二套判断。
process.exitCode = EXIT;
