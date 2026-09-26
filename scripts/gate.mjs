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
// 判定口径（**不改任何环的判定语义**，只做"读出状态"这一件事）：
//   ① 环进程退出码 != 0            -> FAIL（kill/异常亦记 FAIL，并写明）
//   ② 环输出里出现"分母 0 / 空扫 / 扫描面缺位" -> SKIP（自报不判，不记 PASS）
//   ③ 环声明显式三态时以其显式声明为准（card-arch-consistency 的 `[SKIP]` 行、
//      arch-claims 的 `⤫ SKIP 明细` 行）——**退出码不承载 SKIP**（两环 SKIP 时仍 exit 0），
//      故不能只看退出码
//   ④ 其余且退出码 0 -> PASS
//   ⚠ 空输出 + exit 0 -> SKIP 并标"无读数"：本仓已两次踩到"没跑却像绿"
//     （AGENTS.md §6.1 PATH 空输出、本轮"第 5 环根本没跑"，日志里 0 行）。
//
// 环清单出处：**原 package.json 命令逐字继承**（含 --check 旗标），不改旗、不改序、不新增依赖。
// 用法：node scripts/gate.mjs [--json] [--quiet]
//   --json   机读汇总（各环 id/状态/退出码/耗时/摘要）
//   --quiet  只打 RING 行与汇总，不打各环原始输出

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ⚠ 各环**必须以 `scripts/<名>.mjs` 字面量**写在这里：arch-claims 的 B234-1 会下探入口脚本，
//    取不到零环即判红（fail-closed）。改链时同步在这里增删，并与 arch-claims 的 GATE_RINGS 点名面对齐。
const RINGS = [
  { id: 'dead-code', script: 'scripts/dead-code-gate.mjs', args: [] },
  { id: 'rpc', script: 'scripts/rpc-manifest.mjs', args: ['--check'] },
  { id: 'prompts', script: 'scripts/sync-prompts.mjs', args: ['--check'] },
  { id: 'arch-claims', script: 'scripts/arch-claims.mjs', args: ['--check'] },
  // selfReport: 该环有**自己声明的机读三态**（尾行定式），优先采信它，别去猜整段文本
  { id: 'cards', script: 'scripts/card-arch-consistency.mjs', args: ['--check'], selfReport: 'cards' },
];

const clean = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '');
/** 一行摘要：取最后一个非空行；无输出则显式写"（无输出）"——空读数不得静默 */
const NOISE = /^\(node:\d+\)|EnvHttpProxyAgent|to show where the warning|^\s*Use `node --trace-warnings|^\s*$/;
function digest(text) {
  const ls = clean(text).split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.test(l));      // 过滤 node 警告等噪声：摘要必须是**本环的结论行**
  if (!ls.length) return '（无输出）';
  const tail = ls[ls.length - 1].replace(/\s+/g, ' ');
  return tail.length > 160 ? tail.slice(0, 157) + '...' : tail;
}

/** 结构性定位结论行：**行首锚定**的模式 + 扫描**全输出**，取最后一条命中。
 *  两条教训必须同时满足（都是本会实测出来的）：
 *   · b2 · I2：不得对整段做**宽松子串**匹配——各环输出天然含自己的判据名与期望行
 *     （cards 的 `A-3 空扫护栏`、期望行里的「扫描面缺位」）⇒ 只认**行首锚定**的模式，不认"任意位置出现词"。
 *   · b3 · N2：也不得只在**小窗口**里找——结论行后多打 ≥4 行（日志/明细/调试）就滑出窗口，
 *     "没判"于是被读成"判过了"（假绿，比 I2 更危险）⇒ 全输出定位，判定不依赖结论行的位置。 */
function scanLines(text) {
  return clean(text).split('\n').map((l) => l.trim()).filter((l) => l && !NOISE.test(l));
}
function locateConclusion(lines, ring) {
  const rules = (SELF_REPORTS[ring && ring.selfReport] || []).concat(GENERIC_CONCLUSIONS);
  let hit = null;
  for (const l of lines) {
    for (const [re, st] of rules) if (re.test(l)) hit = { line: l, st };
  }
  return hit;
}

/** 通用结论行（**行首锚定**，故意很窄：只在"本环自己声明状态"的行上匹配） */
const GENERIC_CONCLUSIONS = [
  [/^\[SKIP\]/, 'SKIP'],
  [/^SKIP\s+明细[:：]/, 'SKIP'],
];

/** 环自报三态（**优先采信**；退出码不承载 SKIP，故不能只看退出码） */
const SELF_REPORTS = {
  cards: [
    [/^✓\s*卡<->档判据全过/, 'PASS'],
    [/^⏭\s*卡<->档未判全/, 'SKIP'],
    [/^✗\s*卡<->档/, 'FAIL'],
  ],
};

function resolveStatus(text, code, ring) {
  const t = clean(text);
  const lines = scanLines(t);
  const last = lines[lines.length - 1] || '';
  const empty = lines.length === 0;         // 只有 node 警告不算"有读数"
  if (empty) return code === 0
    ? ['SKIP', '本环零输出且 exit 0——**无读数**（不是 PASS）']
    : ['FAIL', '本环零输出且退出码 ' + code + '（异常/kill）'];
  if (code !== 0) return ['FAIL', 'exit ' + code + ' · ' + digest(t)];
  // ① 结构性定位环自报结论行（全输出扫描，不依赖位置）
  const rules = SELF_REPORTS[ring && ring.selfReport] || [];
  const hit = locateConclusion(lines, ring);
  if (hit) return [hit.st, '本环自报结论行「' + hit.line.replace(/\s+/g, ' ').slice(0, 110) + '」'];
  if (rules.length) {
    // ② 尾行三态词未识别时的**同一行计数回退**：只读该环自己尾行上的 `冲突 N` / `SKIP M`。
    //   ⚠ 存在的真实形状（实测）：未与卡环新尾行同批落地的旧版尾行是
    //     「✓ 卡<->档一致性判据一致：断言 3 通过 · 冲突 0 · SKIP 3」——前缀 ✓ 而 SKIP 3。
    //     若照抄前缀就会把"没判全"读成 PASS（正是本会根因）；按计数判则正确落 SKIP。
    // 计数回退同样**全输出定位**：取最后一条"卡<->档"结论行的计数（不限定窗口）
    const anchor = [...lines].reverse().find((l) => /^[✓⏭✗]\s*卡<->档/.test(l)) || last;
    const num = (re) => { const m = anchor.match(re); return m ? Number(m[1]) : null; };
    const cf = num(/冲突\s*(\d+)/);
    const sk = num(/SKIP\s*(\d+)/);
    if (cf !== null || sk !== null) {
      const C = cf === null ? 0 : cf; const S = sk === null ? 0 : sk;
      const why = '三态词未识别，按其自报计数判（冲突 ' + C + ' / SKIP ' + S + '）';
      if (C > 0) return ['FAIL', why + '：' + anchor.replace(/\s+/g, ' ').slice(0, 90)];
      if (S > 0) return ['SKIP', why + '：未判全 · ' + anchor.replace(/\s+/g, ' ').slice(0, 90)];
      return ['PASS', why + '：' + anchor.replace(/\s+/g, ' ').slice(0, 90)];
    }
    return ['SKIP', '⚠ 本环有自报三态但全文既无三态词也无计数（末行 ' + last.slice(0, 60) + '）——**不判绿** · ' + digest(t)];
  }
  // ② 退化路径（无机读三态的环）。全部**行首锚定 + 全输出定位**，位置无关：
  //   ⚠ 位置无关是硬要求（b3 · N2）：结论行后多打几行日志就滑出窗口 ⇒ 假绿。宁可多扫几行，不可默认 PASS。
  //   ⚠ 行首锚定是硬要求（b2 · I2）：不得对整段做宽松子串匹配——各环输出天然含自己的判据名
  //     （如 cards 的 `A-3 空扫护栏`、期望行里的「扫描面缺位」）。
  const sumLine = [...lines].reverse().find((l) => /^(汇总|摘要)[:：]/.test(l));   // 本环自己的汇总行
  if (sumLine && /分母\s*0|空扫|扫描面缺位/.test(sumLine)) return ['SKIP', '本环汇总行报「分母 0 / 扫描面缺位」——不判 · ' + sumLine.slice(0, 90)];
  if ([...lines].some((l) => /未提供 --check|未实装 --check/.test(l))) return ['SKIP', '本环未提供 --check：退出码不反映判定 · ' + digest(t)];
  return ['PASS', digest(t)];
}

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
    text = (p.stdout || '') + (p.stderr || '');
    if (p.error) note = String(p.error.message).slice(0, 80);
    if (p.signal) note = '被信号 ' + p.signal + ' 终止';
  }
  const [status, summary] = note ? ['FAIL', note] : resolveStatus(text, code, r);
  results.push({ id: r.id, script: r.script, args: r.args, status, exit: code, ms: Date.now() - started, summary, text });
}

if (!has('--json')) {
  console.log('门禁链（全跑 · 不短路）· scripts/gate.mjs');
  console.log('环数 ' + RINGS.length + '｜各环以 scripts/<名>.mjs 字面量声明（arch-claims B234-1 会下探）');
  console.log('');
  for (const r of results) {
    console.log('── ' + r.id + ' · node ' + r.script + (r.args.length ? ' ' + r.args.join(' ') : ''));
    if (!has('--quiet') && r.text.trim()) {
      for (const l of r.text.replace(/\s+$/, '').split('\n')) console.log('    | ' + l);
    }
    const codeTxt = r.exit === null ? '(无退出码)' : 'exit ' + r.exit;
    console.log('RING ' + r.id + ' ' + r.status + ' ' + codeTxt + ' · ' + r.ms + 'ms · ' + r.summary);
    console.log('');
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log('汇总：' + results.length + ' 环 -> PASS ' + n('PASS') + ' · FAIL ' + n('FAIL') + ' · SKIP ' + n('SKIP') + '｜总耗时 ' + (Date.now() - t0) + 'ms');
  console.log('  环状态：' + results.map((r) => r.id + '=' + r.status).join(' '));
  const bad = results.filter((r) => r.status === 'FAIL');
  if (bad.length) console.log('  FAIL 明细：' + bad.map((r) => r.id + '（' + (r.exit === null ? '无退出码' : 'exit ' + r.exit) + '）').join(' · '));
  const sk = results.filter((r) => r.status === 'SKIP');
  if (sk.length) console.log('  SKIP 明细：' + sk.map((r) => r.id).join(', ') + '（不记 PASS，需人判）');
  // ⚠ 措辞三态（b2 · I3）：有 SKIP 就**不得**说「全过」——"没判上"与"判过了"必须在同一行里可区分
  if (bad.length) console.log('✗ 门禁链未通过：' + bad.length + ' 环 FAIL（其余环读数已在上面，未被遮蔽）');
  // ⚠ 措辞不得自含反义子串（b3 · N4）：旧文案 `（…本条**不是**全过）` 自身含「全过」，
  //   `grep -c 全过` 会把它读成本链全过（措辞面假绿）。改为**不含该子串**的否定式表述。
  else if (n('SKIP')) console.log('⏭ 门禁链未判全：PASS ' + n('PASS') + ' · SKIP ' + n('SKIP') + '（有环未判，本条不记通过）');
  else console.log('✓ 门禁链全过：' + n('PASS') + ' 环 PASS（无 SKIP）');
} else {
  console.log(JSON.stringify({
    rings: results.map(({ text, ...r }) => r),
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === 'PASS').length,
      fail: results.filter((r) => r.status === 'FAIL').length,
      skip: results.filter((r) => r.status === 'SKIP').length,
      unjudged: results.filter((r) => r.status === 'SKIP').map((r) => r.id),
      verdict: results.some((r) => r.status === 'FAIL') ? 'FAIL'
        : results.some((r) => r.status === 'SKIP') ? 'NOT_FULLY_JUDGED' : 'ALL_PASS',
      ms: Date.now() - t0,
    },
  }, null, 1));
}

process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0;
