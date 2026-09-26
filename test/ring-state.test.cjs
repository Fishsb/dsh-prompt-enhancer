'use strict';
// P5（2026-09-26）：门禁环**结构化状态出口**契约的回归测试。
//
// 为什么要有它：本仓门禁的环级状态判定曾是**文本启发式**，连改三次（I2 整段子串匹配 → N2 末 4 行窗口
// 把 SKIP 读成 PASS → N4 措辞自含反义子串）仍没根治。根治 = 五环统一输出 RING-STATE 契约行，
// gate.mjs 只读结构。**判据不进单测就会复长**——本文件把这条契约钉进 npm test。
//
// 覆盖四条验收：① 每环可结构性读取 ② gate.mjs 无文本匹配 ③ 换措辞不误判 ④ 既有负控不回归。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'lib', 'ring-state.mjs');
const GATE = path.join(ROOT, 'scripts', 'gate.mjs');

let mod = null;
const lib = async () => {
  if (!mod) mod = await import('file://' + LIB.split(path.sep).join('/'));
  return mod;
};

const run = (script, args = [], env = {}) => {
  const p = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: p.status, out: (p.stdout || '') + (p.stderr || ''), stdout: p.stdout || '', stderr: p.stderr || '' };
};

const RINGS = [
  ['dead-code', 'scripts/dead-code-gate.mjs', []],
  ['rpc', 'scripts/rpc-manifest.mjs', ['--check']],
  ['prompts', 'scripts/sync-prompts.mjs', ['--check']],
  ['arch-claims', 'scripts/arch-claims.mjs', ['--check']],
  ['cards', 'scripts/card-arch-consistency.mjs', ['--check']],
];

// ───────────── 验收① 每环都能被结构性读取 ─────────────
test('P5-01 五个环各自输出恰一条 RING-STATE 契约行（行首锚定 + 三态闭集）', async () => {
  const { parseRingState } = await lib();
  for (const [id, script, args] of RINGS) {
    const r = run(script, args);
    const lines = r.out.split('\n').filter((l) => /^RING-STATE /.test(l));
    assert.equal(lines.length, 1, id + ' 应输出恰 1 条契约行，实得 ' + lines.length + '：' + JSON.stringify(lines));
    const parsed = parseRingState(r.out);
    assert.equal(parsed.length, 1, id + ' 契约行应可被解析器读出');
    assert.equal(parsed[0].id, id, id + ' 契约行 id 应自报本环 id');
    assert.ok(['PASS', 'FAIL', 'SKIP'].includes(parsed[0].state), id + ' 状态应在三态闭集内');
    assert.ok(parsed[0].reason && parsed[0].reason.length > 0, id + ' 契约行应带非空 reason');
  }
});

test('P5-02 契约行走 stderr，机读数据面（stdout）保持纯净：rpc/cards 的 --json 仍可 parse', () => {
  for (const script of ['scripts/rpc-manifest.mjs', 'scripts/card-arch-consistency.mjs']) {
    const r = run(script, ['--json']);
    assert.equal(r.code, 0, script + ' --json 应 exit 0');
    assert.ok(/^RING-STATE /m.test(r.stderr), script + ' 契约行应在 stderr');
    assert.ok(!/^RING-STATE /m.test(r.stdout), script + ' stdout 不得混入契约行（机读数据面）');
    JSON.parse(r.stdout);
  }
});

// ───────────── 验收② gate.mjs 无文本匹配 ─────────────
test('P5-03 gate.mjs 内不存在任何对环输出的文本匹配（零正则 / 零判定用 .test）', () => {
  const src = fs.readFileSync(GATE, 'utf8');
  const code = src
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/\x60(?:[^\x60\\]|\\.)*\x60/g, '``');
  assert.ok(!/\.test\s*\(/.test(code), 'gate.mjs 不得有 .test(');
  assert.ok(!/\.match\s*\(/.test(code), 'gate.mjs 不得有 .match(');
  assert.ok(!/RegExp/.test(code), 'gate.mjs 不得构造正则');
  assert.ok(!/u001b/.test(src), 'gate.mjs 不得自带 ANSI 剥离（应复用 lib）');
  assert.ok(/deriveState/.test(code), 'gate.mjs 应通过 deriveState 裁决');
  for (const gone of ['resolveStatus', 'locateConclusion', 'scanLines', 'SELF_REPORTS', 'GENERIC_CONCLUSIONS']) {
    assert.ok(!new RegExp('\\b' + gone + '\\b').test(code), '旧启发式 ' + gone + ' 不得回流');
  }
});

// ───────────── 验收③ 换措辞不误判 ─────────────
test('P5-04 「环换措辞」不误判：等义改写 + 契约行 => 三态由契约行决定', async () => {
  const { deriveState } = await lib();
  const cases = [
    ['rpc', 'SKIP', '本次未能作出一致性结论：派生面为空，读数不可得'],
    ['arch-claims', 'SKIP', '31 条成立 · 3 条因本地治理面不在位而无从判定'],
    ['dead-code', 'FAIL', '本次结构校验发现 1 处不成立'],
    ['prompts', 'PASS', '生成区与技能包源逐字相同（19 个常量）'],
    ['cards', 'FAIL', '卡表与架构档：存在冲突——A-5'],
  ];
  for (const [id, truth, phrasing] of cases) {
    const text = phrasing + '\nRING-STATE ' + id + ' ' + truth + ' 契约理由\n';
    const v = deriveState({ id, exitCode: truth === 'FAIL' ? 1 : 0, text });
    assert.equal(v.state, truth, id + ' 改写措辞后三态应由契约行决定（实得 ' + v.state + '）');
    assert.equal(v.source, 'structure', id + ' 应走结构面而非退化位');
  }
});

test('P5-05 契约行缺失 => fail-closed（不接线不猜、不默认 PASS）', async () => {
  const { deriveState } = await lib();
  const legacy = deriveState({ id: 'rpc', exitCode: 0, text: 'RPC 事实源一致：34 条线上方法\nRING 式措辞但无契约：PASS\n' });
  assert.equal(legacy.state, 'FAIL', '无契约行应 fail-closed');
  assert.equal(legacy.source, 'derived');
  const decoy = deriveState({ id: 'cards', exitCode: 0, text: 'RING-STATE cards SKIP 未判全\n由上文可知卡<->档未判全，本条不是全过\nRING-STATE-ISH PASS 假行\n' });
  assert.equal(decoy.state, 'SKIP', '只有行首锚定的契约行可定状态');
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE rpc PASS a\nRING-STATE rpc SKIP b\n' }).state, 'FAIL', '多条契约行应判 FAIL');
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE cards PASS a\n' }).state, 'FAIL', 'id 不符应判 FAIL');
  assert.equal(deriveState({ id: 'rpc', exitCode: 1, text: 'RING-STATE rpc PASS a\n' }).state, 'FAIL', 'PASS 却非零退出 = 矛盾，取严');
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE rpc FAIL a\n' }).state, 'FAIL', 'FAIL 却零退出 = 矛盾，取严');
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: '' }).state, 'SKIP', '零输出不得记 PASS');
});

test('P5-06 位置无关（N2 复发防线）：契约行后跟 50 行噪声仍被读出', async () => {
  const { deriveState } = await lib();
  const noise = Array.from({ length: 50 }, (_, i) => '  [debug] line ' + i).join('\n');
  const v = deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE rpc SKIP 派生面为空\n' + noise + '\n' });
  assert.equal(v.state, 'SKIP', '尾部噪声不得影响读取（旧实现按末 4 行窗口找会滑出窗口）');
});

// ───────────── 验收④ 既有负控不回归 ─────────────
test('P5-07 恒红不短路：环上限压到 1ms ⇒ 五环全部出读数、全 FAIL、退出码 1', () => {
  const r = run(GATE, ['--quiet'], { GATE_RING_TIMEOUT_MS: '1' });
  const ringLines = r.out.split('\n').filter((l) => /^RING /.test(l));
  assert.equal(ringLines.length, 5, '五个环都必须留下读数（不得因超时短路），实得 ' + ringLines.length);
  assert.equal(r.code, 1, '全 FAIL 时退出码应为 1');
  for (const l of ringLines) assert.ok(/ FAIL /.test(l), '超时环应记 FAIL：' + l);
});

test('P5-08 五环可见：默认形态下 5 条 RING 行，逐环 id 齐全', () => {
  const r = run(GATE, ['--quiet']);
  const ringLines = r.out.split('\n').filter((l) => /^RING /.test(l));
  assert.equal(ringLines.length, 5, 'RING 行应恰 5 条');
  for (const [id] of RINGS) assert.ok(ringLines.some((l) => l.startsWith('RING ' + id + ' ')), id + ' 应有自己的 RING 行');
  assert.equal(r.code, 0, '无 FAIL 时退出码应为 0');
});

test('P5-09 gate --json 的 summary 与 RING 行同源（计数不得与行面不一致）', () => {
  const r = run(GATE, ['--json']);
  const j = JSON.parse(r.stdout);
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const ring of j.rings) counts[ring.status] += 1;
  assert.equal(j.summary.pass, counts.PASS, 'summary.pass 应与 rings[] 一致');
  assert.equal(j.summary.fail, counts.FAIL, 'summary.fail 应与 rings[] 一致');
  assert.equal(j.summary.skip, counts.SKIP, 'summary.skip 应与 rings[] 一致');
  assert.equal(j.summary.total, j.rings.length, 'total 应为环数');
  assert.ok(j.rings.every((x) => x.source === 'structure'), '真仓各环都应走结构面（不留退化位）');
});

test('P5-10 三态语义：SKIP 不得被读成 PASS（本契约要治的原始病）', () => {
  const r = run(GATE, ['--json']);
  const j = JSON.parse(r.stdout);
  const skips = j.rings.filter((x) => x.status === 'SKIP').map((x) => x.id);
  if (skips.length) {
    assert.equal(j.summary.verdict, 'NOT_FULLY_JUDGED', '有 SKIP 时 verdict 不得为 ALL_PASS');
    assert.ok(!/环 PASS/.test(r.stdout) || !/无 SKIP/.test(r.stdout), '有 SKIP 时不得出现「全过」措辞');
  }
});
