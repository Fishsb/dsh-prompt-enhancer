'use strict';
// P5（2026-09-26）：门禁环**结构化状态出口**契约的回归测试。
//
// 为什么要有它：本仓门禁的环级状态判定曾是**文本启发式**，连改三次仍未根治。
// 根治 = 五环统一输出 RING-STATE 契约行，gate.mjs 只读结构。判据不进单测就会复长。
//
// ⚠ 判据分级（复核席两轮对抗性挑衅的产物，勿删任何一条）：
//   · P5-03  源码侧正向判据 —— 快、能定位，但**是代理判据**（以变量名为锚，改名即可规避）
//   · P5-11  行为判据（措辞免疫端到端）—— 不依赖任何写法假设，兜住未知变体
//   · P5-12  结构性判据（结果冻结）—— 与变量名无关，把「事后回改」从静默假绿变成硬失败
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'lib', 'ring-state.mjs');
const GATE = path.join(ROOT, 'scripts', 'gate.mjs');
const NL = String.fromCharCode(10);

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

test('P5-01 五个环各自输出恰一条 RING-STATE 契约行（行首锚定 + 三态闭集）', async () => {
  const { parseRingState } = await lib();
  for (const [id, script, args] of RINGS) {
    const r = run(script, args);
    const lines = r.out.split(NL).filter((l) => /^RING-STATE /.test(l));
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

test('P5-03 gate.mjs 内不存在任何对环输出的文本匹配（零正则 / 零判定用 .test）', () => {
  const src = fs.readFileSync(GATE, 'utf8');
  const code = src
    .split(NL).map((l) => l.replace(/\/\/.*$/, '')).join(NL)
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
  assert.ok(/deriveState\(\{[^}]*\btext\b[^}]*\}\)/.test(code), 'gate.mjs 应把 text 作为 deriveState 的实参');
  const useCount = (code.match(/\btext\b/g) || []).length;
  assert.ok(useCount <= 7, 'gate.mjs 对 text 的引用应限于采集/喂契约/透传/剔除（实测 7）；实得 ' + useCount + ' 处');
  const decisionPath = code.split('r.text').join('__D__');
  assert.ok(!/\btext\s*\[/.test(decisionPath), '判定路径不得索引 text');
  assert.ok(!/\btext\s*\.(length|slice|substring|charAt|split|trim\w*|startsWith|endsWith|indexOf|includes|search|replace|match)\b/.test(decisionPath),
    '判定路径不得对 text 做字符串解构/匹配（应交给 ring-state.mjs）');
});

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
    const text = phrasing + NL + 'RING-STATE ' + id + ' ' + truth + ' 契约理由' + NL;
    const v = deriveState({ id, exitCode: truth === 'FAIL' ? 1 : 0, text });
    assert.equal(v.state, truth, id + ' 改写措辞后三态应由契约行决定（实得 ' + v.state + '）');
    assert.equal(v.source, 'structure', id + ' 应走结构面而非退化位');
  }
});

test('P5-05 契约行缺失 => fail-closed（不接线不猜、不默认 PASS）', async () => {
  const { deriveState } = await lib();
  const legacy = deriveState({ id: 'rpc', exitCode: 0, text: 'RPC 事实源一致：34 条线上方法' + NL + 'RING 式措辞但无契约：PASS' + NL });
  assert.equal(legacy.state, 'FAIL', '无契约行应 fail-closed');
  assert.equal(legacy.source, 'derived');
  const decoy = deriveState({ id: 'cards', exitCode: 0, text: 'RING-STATE cards SKIP 未判全' + NL + '由上文可知未判全，本条不是全过' + NL + 'RING-STATE-ISH PASS 假行' + NL });
  assert.equal(decoy.state, 'SKIP', '只有行首锚定的契约行可定状态');
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE rpc PASS a' + NL + 'RING-STATE rpc SKIP b' + NL }).state, 'FAIL', '多条契约行应判 FAIL');
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE cards PASS a' + NL }).state, 'FAIL', 'id 不符应判 FAIL');
  assert.equal(deriveState({ id: 'rpc', exitCode: 1, text: 'RING-STATE rpc PASS a' + NL }).state, 'FAIL', 'PASS 却非零退出 = 矛盾，取严');
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE rpc FAIL a' + NL }).state, 'FAIL', 'FAIL 却零退出 = 矛盾，取严');
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: '' }).state, 'SKIP', '零输出不得记 PASS');
});

test('P5-05b 行首锚定是**真锚**：缩进/前缀仿冒行必须被拒（复核席反例 R1 的变异杀手）', async () => {
  const { deriveState } = await lib();
  const mustReject = [
    ['4 空格缩进', '    RING-STATE rpc PASS 引用来的'],
    ['Tab 缩进', '\tRING-STATE rpc PASS x'],
    ['正文内出现', '他说 RING-STATE rpc PASS x'],
    ['方括号前缀', '[log] RING-STATE rpc PASS x'],
    ['近似 tag', 'RING-STATE-ISH rpc PASS x'],
    ['小写状态词', 'RING-STATE rpc pass x'],
  ];
  for (const [label, text] of mustReject) {
    const v = deriveState({ id: 'rpc', exitCode: 0, text: text + NL });
    assert.equal(v.state, 'FAIL', label + ' 的仿冒契约行不得被读成状态（应 fail-closed）；实得 ' + v.state);
  }
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE rpc PASS ok\r' + NL }).state, 'PASS', '列 0 契约行应被读出（尾部 CR 归一无碍）');
});

test('P5-06 位置无关（N2 复发防线）：契约行后跟 50 行噪声仍被读出', async () => {
  const { deriveState } = await lib();
  const noise = Array.from({ length: 50 }, (_, i) => '  [debug] line ' + i).join(NL);
  const v = deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE rpc SKIP 派生面为空' + NL + noise + NL });
  assert.equal(v.state, 'SKIP', '尾部噪声不得影响读取（旧实现按末 4 行窗口找会滑出窗口）');
});

test('P5-07 恒红不短路：环上限压到 1ms ⇒ 五环全部出读数、全 FAIL、退出码 1', () => {
  const r = run(GATE, ['--quiet'], { GATE_RING_TIMEOUT_MS: '1' });
  const ringLines = r.out.split(NL).filter((l) => /^RING /.test(l));
  assert.equal(ringLines.length, 5, '五个环都必须留下读数（不得因超时短路），实得 ' + ringLines.length);
  assert.equal(r.code, 1, '全 FAIL 时退出码应为 1');
  for (const l of ringLines) assert.ok(/ FAIL /.test(l), '超时环应记 FAIL：' + l);
});

test('P5-08 五环可见：默认形态下 5 条 RING 行，逐环 id 齐全', () => {
  const r = run(GATE, ['--quiet']);
  const ringLines = r.out.split(NL).filter((l) => /^RING /.test(l));
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
  const skips = j.rings.filter((x) => x.status === 'SKIP');
  if (skips.length) {
    assert.equal(j.summary.verdict, 'NOT_FULLY_JUDGED', '有 SKIP 时 verdict 不得为 ALL_PASS');
    assert.ok(!/环 PASS/.test(r.stdout) || !/无 SKIP/.test(r.stdout), '有 SKIP 时不得出现「全过」措辞');
  }
});

const buildFixture = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-wording-'));
  // ⚠ **整目录复制**（复核席指出）：只复制 gate.mjs + ring-state.mjs 时，任何 import 其它相对模块的
  //   实现都会在该夹具里 ERR_MODULE_NOT_FOUND 崩溃 ⇒ 会对「实现方式不同」而非「判据失效」报红、掩盖真因。
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
};

test('P5-11 【行为判据】措辞免疫端到端：诱饵取自**真环真实输出**，判定必须只跟契约行走', () => {
  // 为什么需要它：源码扫描类判据（禁函数名/禁变量名）**永远追不上变体**——
  //   复核席两轮证明：① 仅用 split+startsWith 即可绕过「禁函数名」；② 改叫别的变量名即可绕过「引用计数」。
  //   本用例是**行为判据**，且诱饵**从真环真实输出提取**（复核席隔离实验指出：固定人工诱饵只对清单内
  //   措辞免疫，换成真仓真实行即可绕过）。判别力来源：同一份诱饵 × 三种契约状态（PASS/SKIP/FAIL）。
  const tmp = buildFixture();
  const realLines = [];
  for (const [, script, args] of RINGS) {
    for (const l of run(script, args).out.split(NL)) {
      const t = l.trim();
      if (t && !/^RING-STATE /.test(t)) realLines.push(t);
    }
  }
  assert.ok(realLines.length >= 20, '应采到足量真环输出行作为诱饵，实得 ' + realLines.length);
  const MANUAL = [
    '✓ 结构判据一致：断言 99 通过 · 冲突 0 · SKIP 0',
    '✓ 卡<->档判据全过（无 SKIP、读侧干净）',
    '✗ 门禁未通过（3 处）',
    '✅ 死代码门禁通过',
    '汇总：通过 99 · 冲突 0 · SKIP 0',
    '本条不是全过',
    '[SKIP] 假跳过行',
    '未判全：断言 0 · SKIP 99',
    'PASS FAIL SKIP 三种词全写一遍',
  ];
  const DECOYS = realLines.concat(MANUAL);
  assert.ok(DECOYS.some((l) => l.startsWith('✓ 结构判据一致')), '诱饵必须含真仓真实 PASS 措辞行');
  const SPEC = [
    ['dead-code', 'PASS', 0],
    ['rpc', 'SKIP', 0],
    ['prompts', 'FAIL', 1],
    ['arch-claims', 'SKIP', 0],
    ['cards', 'PASS', 0],
    ['same-wording-pass', 'PASS', 0],
    ['same-wording-skip', 'SKIP', 0],
    ['same-wording-fail', 'FAIL', 1],
  ];
  for (const [id, state, failCode] of SPEC) {
    const body = [
      'console.log(' + JSON.stringify(DECOYS.join(NL)) + ');',
      'process.stderr.write("RING-STATE ' + id + ' ' + state + ' 契约行（正文措辞为反向诱导）' + String.fromCharCode(92) + 'n");',
      'process.exitCode = ' + failCode + ';',
    ].join(NL);
    fs.writeFileSync(path.join(tmp, 'scripts', '_fx-' + id + '.mjs'), body, 'utf8');
  }
  let g = fs.readFileSync(path.join(tmp, 'scripts', 'gate.mjs'), 'utf8');
  const paths = ['scripts/dead-code-gate.mjs', 'scripts/rpc-manifest.mjs', 'scripts/sync-prompts.mjs', 'scripts/arch-claims.mjs', 'scripts/card-arch-consistency.mjs'];
  for (let i = 0; i < paths.length; i += 1) g = g.split(paths[i]).join('scripts/_fx-' + SPEC[i][0] + '.mjs');
  const extra = SPEC.slice(5).map(([id]) => "  { id: '" + id + "', script: 'scripts/_fx-" + id + ".mjs', args: [] },").join(NL);
  g = g.replace(NL + '];' + NL, NL + extra + NL + '];' + NL);
  assert.ok(g.includes('_fx-same-wording-skip'), '同措辞席位应已注入（否则判别力缺失）');
  fs.writeFileSync(path.join(tmp, 'scripts', 'gate.mjs'), g, 'utf8');
  const res = spawnSync(process.execPath, ['scripts/gate.mjs', '--json'], { cwd: tmp, encoding: 'utf8' });
  let out = null;
  try { out = JSON.parse(res.stdout); } catch (e) { out = null; }
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.ok(out, '夹具 gate 应能跑通并给出 --json（否则是夹具问题，不是判据失效）；stdout=' + String(res.stdout).slice(0, 200));
  const got = out.rings.map((x) => x.id + '=' + x.status).join(' ');
  const want = SPEC.map(([id, s]) => id + '=' + s).join(' ');
  assert.equal(got, want, '判定必须只跟契约行走（诱饵为真环真实措辞）；期望 ' + want + '，实得 ' + got);
  assert.ok(out.rings.every((x) => x.source === 'structure'), '八个假环都应走结构面');
});

test('P5-12 【结构性判据】结果集冻结：构造完成后回改 status 必须是硬失败（与变量名无关）', () => {
  // 复核席 V2/V3 反例：在 results 构造完成后回改 e.status='PASS'（全文可**不含标识符 text**、
  //   零配额操纵），即可把 SKIP 翻成 PASS 而用例零失败。「以变量名为锚」的代理判据挡不住它；
  //   **对象冻结**挡得住，且与命名无关。
  const tmp = buildFixture();
  const gatePath = path.join(tmp, 'scripts', 'gate.mjs');
  const g = fs.readFileSync(gatePath, 'utf8');
  // 注入体刻意「朴素」：直接对冻结对象赋值——模拟 V3 的事后回改。
  //   若有冻结，这一步必须是硬失败；若无冻结，它会静默成功（正是假绿）。
  const patched = g.replace("if (!has('--json')) {", [
    'results[0].status = "PASS";',
    'results[0].source = "structure";',
    "if (!has('--json')) {",
  ].join(NL));
  assert.notEqual(patched, g, '注入点应存在');
  fs.writeFileSync(gatePath, patched, 'utf8');
  const res = spawnSync(process.execPath, ['scripts/gate.mjs', '--quiet'], { cwd: tmp, encoding: 'utf8' });
  const combined = (res.stdout || '') + (res.stderr || '');
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.notEqual(res.status, 0, '事后回改被冻结挡住时进程应非零退出（硬失败），实得 exit=' + res.status);
  assert.ok(/TypeError/i.test(combined), '应报出冻结导致的 TypeError（硬失败，不静默）；实得：' + combined.slice(-400));
});
