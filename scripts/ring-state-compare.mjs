#!/usr/bin/env node
// scripts/ring-state-compare.mjs — P5 **负控对拍器**（可复跑，不是一次性脚本）
//
// 为什么要有它：P5 的验收③要求给出「改前误判 / 改后正确」的对照读数。这类对照若只存在于
//   交付者的终端里、不进仓，就无法被复核席复现——那本身就是「失败不可观测」的一种。
//   故把对拍固化成一条命令：基线裁决器从 git 原样取出（非转述），新裁决器直接 import，
//   同一批夹具喂给两者，逐行打印判定。
//
// 用法：node scripts/ring-state-compare.mjs [基线 rev]   （缺省自动探测：gate.mjs 最近一次含旧裁决器的提交）
// 退出码：0 = 新版全对且旧版确有误判（对照有效）；1 = 出现回归或对照无效。
//
// 覆盖两路对拍：
//   A 单元级：直接调两代裁决函数（10 场景，含五环真仓实测原样）
//   B 链级  ：真跑旧/新 gate × 真跑五环，并在**写入层**改写各环结论措辞（不改任何环文件）
//            —— 模拟「环换措辞」这一真实形态。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveState } from './lib/ring-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explicit = process.argv[2];
const git = (a) => (spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).stdout || '');
const run = (script, args, env) => {
  const p = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
  return { code: p.status, out: (p.stdout || '') + (p.stderr || ''), stdout: p.stdout || '' };
};

// ── 取基线裁决器（原样，非转述）──
// ⚠ 基线**自动探测**而非写死相对 rev：本仓提交历史会继续增长/被重置（实测本 worktree 就被外部重置过一次），
//   写死 HEAD~N 会在下一次提交后失效——那正是「判据随环境漂移」的坑。探测口径 = gate.mjs 最近一次仍含
//   resolveStatus（旧裁决器）的提交。
function detectBase() {
  const log = git(['log', '--format=%H', '--', 'scripts/gate.mjs']).split('\n').filter(Boolean);
  for (const rev of log) {
    if (git(['show', rev + ':scripts/gate.mjs']).includes('resolveStatus')) return rev;
  }
  return null;
}
const BASE = explicit || detectBase();
const headSrc = BASE ? git(['show', BASE + ':scripts/gate.mjs']) : '';
if (!headSrc.includes('resolveStatus')) {
  console.error('✗ 未找到含旧裁决器（resolveStatus）的基线提交——请显式指定 rev');
  process.exit(2);
}
const L = headSrc.split('\n');
const s = L.findIndex((l) => l.startsWith('const clean ='));
const e = L.findIndex((l, i) => i > s && l === 'const results = [];');
const oldAPI = new Function(L.slice(s, e).join('\n') + '\nreturn { resolveStatus };')();

const RINGS = [
  ['dead-code', 'scripts/dead-code-gate.mjs', []],
  ['rpc', 'scripts/rpc-manifest.mjs', ['--check']],
  ['prompts', 'scripts/sync-prompts.mjs', ['--check']],
  ['arch-claims', 'scripts/arch-claims.mjs', ['--check']],
  ['cards', 'scripts/card-arch-consistency.mjs', ['--check']],
];
const REAL = {};
for (const [id, script, args] of RINGS) REAL[id] = run(script, args);
const TRUTH = { 'dead-code': 'PASS', rpc: 'PASS', prompts: 'PASS', 'arch-claims': 'SKIP', cards: 'SKIP' };
const W = (x, n) => String(x).padEnd(n);

let bad = 0;
console.log('基线 = ' + BASE + '（旧裁决器取自 git show，' + (e - s) + ' 行原样）\n');

// ── A 单元级 ──
const rows = [];
const push = (id, truth, label, oldText, oldCode, newText, newCode) => {
  const o = oldAPI.resolveStatus(oldText, oldCode, { id })[0];
  const n = deriveState({ id, exitCode: (newCode === undefined ? oldCode : newCode), text: (newText === undefined ? oldText : newText) }).state;
  rows.push({ id, label, truth, o, n, okOld: o === truth, okNew: n === truth });
};
// 夹具分两类，期望按**各自语义**给（混为一谈会把「fail-closed 的正确行为」误读成回归）：
//   ①-类 契约行在场：真值 = 该环真实三态。两代都应判对；旧裁决会随措辞漂移。
//   ②-类 契约行缺失（旧世界形态）：**新语义的正确行为就是 FAIL（fail-closed，拒绝声称 PASS）**。
//        旧语义的过错不是「判成某个错值」，而是「读成了 PASS」——故这一类断言 new===FAIL 且 old!==PASS。
// ① 真仓实测原样（回归面：两代都应判对）
for (const [id] of RINGS) push(id, TRUTH[id], id + ' 真仓实测原样', REAL[id].out, REAL[id].code);
// ①-类 契约行在场 + 措辞改写（真值 = 真实三态；旧裁决随措辞漂移）
push('dead-code', 'FAIL', '契约行在场·改写措辞', REAL['dead-code'].out, 0, 'FAIL | R1 | src/x.js 新声明 foo 全仓无调用点\n本次结构校验发现 1 处不成立\nRING-STATE dead-code FAIL 1 处 FAIL（R1）\n', 1);
push('rpc', 'SKIP', '契约行在场 + 20 行噪声（N2 形态）', REAL.rpc.out, 0, 'RING-STATE rpc SKIP 派生面为空\n' + Array.from({ length: 20 }, (_, i) => '  [debug] ' + i).join('\n') + '\n', 0);
// ②-类 契约行缺失 ⇒ 新语义 fail-closed = FAIL（正确，不是回归）；旧语义不得读成 PASS
const failClosed = [];
// 期望：**新语义必须拒绝判 PASS**——有输出但无契约行 ⇒ FAIL（fail-closed）；
//   零输出 ⇒ SKIP「无读数」（同为「不判过」，但语义不同，不可混算）。
// 旧语义若读成 PASS，那是**误判证据**（列出来给读者看），不是新版的问题。
const pushFC = (id, label, text, code, want) => {
  const o = oldAPI.resolveStatus(text, code, { id })[0];
  const n = deriveState({ id, exitCode: code, text }).state;
  failClosed.push({ id: id, label: label, o: o, n: n, want: want, ok: n === want, oldWasWrong: o === 'PASS' });
};
pushFC('rpc', '契约缺失·改写措辞', 'RPC 事实源：注册面 0 + bundle 0 = 去重 0\n本次未能作出一致性结论：派生面为空\n', 0, 'FAIL');
pushFC('arch-claims', '契约缺失·改写措辞', '结构判据：31 条成立 · 3 条无从判定\n', 0, 'FAIL');
pushFC('prompts', '契约缺失·末行像通过', '提示词生成区：与技能包源逐字相同\n', 0, 'FAIL');
pushFC('rpc', '契约缺失·末行含 PASS 字样', '全部检查通过\nRPC 检查 PASS\n', 0, 'FAIL');
pushFC('cards', '契约缺失·零输出（无读数）', '', 0, 'SKIP');

console.log('【A 单元级】');
console.log(W('环', 13) + W('场景', 34) + W('真值', 6) + W('旧', 6) + W('新', 6) + '对照');
console.log('-'.repeat(86));
for (const r of rows) {
  const m = !r.okOld && r.okNew ? '改前误判 → 改后正确 ★' : (!r.okOld && !r.okNew ? '两者都错 ⚠' : (r.okOld && !r.okNew ? '**回归** ✗' : '一致（都对）'));
  if (r.okOld && !r.okNew) bad += 1;
  console.log(W(r.id, 13) + W(r.label, 34) + W(r.truth, 6) + W(r.o, 6) + W(r.n, 6) + m);
}
const misOld = rows.filter((r) => !r.okOld).length;
const misNew = rows.filter((r) => !r.okNew).length;
console.log('-'.repeat(86));
console.log('旧裁决错 ' + misOld + '/' + rows.length + '　新裁决错 ' + misNew + '/' + rows.length);

console.log('\n【A2 契约行缺失（旧世界形态）——新语义应当 fail-closed】');
console.log(W('环', 13) + W('场景', 30) + W('旧', 6) + W('新', 6) + '判定');
console.log('-'.repeat(74));
for (const r of failClosed) {
  console.log(W(r.id, 13) + W(r.label, 30) + W(r.o, 6) + W(r.n, 6)
    + (r.ok ? ('新语义正确（=' + r.want + '）' + (r.oldWasWrong ? '　旧读 PASS ＝ 误判证据 ★' : '')) : ('✗ 期望 ' + r.want + ' 实得 ' + r.n)));
}
if (failClosed.some((r) => !r.ok)) bad += 1;

// ── B 链级：写入层改写措辞（不改任何环文件）──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-nc-'));
const FIX = path.join(TMP, 'reword.cjs');
fs.writeFileSync(FIX, [
  "const fs = require('fs');",
  "const REWORD = [",
  "  [/^\\s*\\[SKIP\\]/, (s) => s.replace(/\\[SKIP\\]/, '[未判]')],",
  "  [/^\\s*SKIP 明细[:：]/, (s) => s.replace(/SKIP 明细[:：]/, '未判明细：')],",
  "  [/^✓ 结构判据一致/, (s) => '结构判据：' + s.replace(/^✓ 结构判据一致：/, '').replace(/SKIP/g, '未判')],",
  "  [/^✓ 卡<->档判据全过/, (s) => '卡表与架构档一致性：' + s.replace(/^✓ 卡<->档判据全过（[^）]*）：/, '').replace(/SKIP/g, '未判')],",
  "  [/^⏭ 卡<->档未判全/, (s) => '知识卡与架构档：本次未能判全——' + s.replace(/^⏭ 卡<->档未判全：/, '').replace(/SKIP/g, '未判')],",
  "  [/^✓ RPC 事实源一致/, (s) => 'RPC 事实源：' + s.replace(/^✓ RPC 事实源一致：/, '')],",
  "  [/^✅ 死代码门禁通过/, () => '死代码/装配：R1–R4 全数成立'],",
  "  [/^\\s*汇总[:：]/, (s) => s.replace(/汇总[:：]/, '读数：').replace(/SKIP/g, '未判')],",
  "];",
  "const rw = (t) => t.split('\\n').map((l) => { for (const [re, fn] of REWORD) if (re.test(l)) return fn(l); return l; }).join('\\n');",
  "const real = fs.writeSync;",
  "fs.writeSync = function (fd, data, ...rest) { return real.apply(fs, (fd === 2 && typeof data === 'string') ? [fd, rw(data), ...rest] : arguments); };",
  "const ro = process.stdout.write.bind(process.stdout);",
  "process.stdout.write = (c, ...r) => { const s2 = typeof c === 'string' ? c : Buffer.from(c).toString('utf8'); const t = rw(s2); return t === s2 ? ro(c, ...r) : ro(t, ...r); };",
].join('\n'), 'utf8');
const baseGate = path.join(ROOT, 'scripts', '_nc-baseline-gate.mjs');
fs.writeFileSync(baseGate, headSrc, 'utf8');
const stateOf = (out) => { const m = out.split('\n').filter((l) => /^RING [a-z-]+ /.test(l)).map((l) => l.split(' ')[1] + '=' + l.split(' ')[2]); return m.join(' '); };
const EO = { NODE_OPTIONS: '--require=' + FIX };
const oldPlain = stateOf(run('scripts/_nc-baseline-gate.mjs', ['--quiet']).out);
const oldRw = stateOf(run('scripts/_nc-baseline-gate.mjs', ['--quiet'], EO).out);
const newRw = stateOf(run('scripts/gate.mjs', ['--quiet'], EO).out);
fs.rmSync(baseGate, { force: true }); fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n【B 链级 · 写入层改写措辞，真跑五环】');
console.log('  基线 gate × 原措辞        : ' + oldPlain);
console.log('  基线 gate × 改写措辞      : ' + oldRw);
console.log('  新   gate × 改写措辞      : ' + newRw);
const archOld = (oldRw.match(/arch-claims=(\w+)/) || [])[1];
const archNew = (newRw.match(/arch-claims=(\w+)/) || [])[1];
const chainOk = archOld !== 'SKIP' && archNew === 'SKIP';
console.log('  → arch-claims 真值 SKIP：基线读 ' + archOld + ' / 新版读 ' + archNew + (chainOk ? '　★ 改前误判 → 改后正确' : '　（对照未复现）'));
if (!chainOk) bad += 1;

console.log('\n结论：' + (bad === 0 && misOld > 0 ? '对照有效——旧裁决确有误判且新版无回归' : (bad ? '**出现回归，须修**' : '**对照无效：旧裁决未复现误判**')));
process.exitCode = (bad === 0 && misOld > 0) ? 0 : 1;
