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
  // ⚠ 独立复核席反例 R2：只查 .test(/.match(/RegExp 是**代理判据**。
  //   复核席进一步证明：**枚举禁用函数的禁列永远追不上变体**——仅用 split+startsWith（在禁列之外）
  //   插入一个逐字匹配「✓ 结构判据」措辞的启发式，就能把 arch-claims 由 SKIP 翻成 PASS，
  //   而 11 条用例一条都不报红。故本腿**不再加长禁列**，改为**正向判据**（见 P5-11）：
  //   断言「环输出文本只作为 deriveState 的实参出现」——即裁决所需的一切都经由结构化入口，
  //   本文件不保留对 text 的二次解释权。这条能被任何绕行写法触红（比禁列强，但仍非充分——
  //   彻底封闭需把裁决抽成无 text 可见性的纯函数；已如实登记在验收记录）。
  const asArgOnly = /deriveState\(\{[^}]*\btext\b[^}]*\}\)/.test(code);
  assert.ok(asArgOnly, 'gate.mjs 应把 text 作为 deriveState 的实参交给契约模块裁决');
  // 正向判据：text 只允许出现在**四条固定用途**上——① 采集、② 喂 deriveState、
  //   ③ 存进结果对象供明细展示、④ --json 时剔除（避免灌进机读面）。
  // 上限取实测值 7（当前正好用满）；任何**新增**对 text 的引用都会顶破它，
  // 逼迫作者改走 ring-state.mjs 的结构化入口，而不是在编排器里二次解释环输出。
  // ⚠ 本腿是代理判据；真正的行为保障是 P5-11（措辞免疫端到端）。
  const useCount = (code.match(/\btext\b/g) || []).length;
  assert.ok(useCount <= 7, 'gate.mjs 对 text 的引用应限于采集/喂契约/透传/剔除（实测 7 处）；实得 ' + useCount + ' 处');
  // 精确到**判定路径**：局部变量 text（环原始输出）不得被字符串解构/匹配——
  //   所有解释必须发生在 ring-state.mjs。展示面用到的 r.text（结果对象，供人看明细）不在禁止面内，
  //   故先把 r.text 占位掉再判。
  const decisionPath = code.split('r.text').join('__DISPLAY__');
  assert.ok(!/\btext\s*\[/.test(decisionPath) &&
    !/\btext\s*\.(length|slice|substring|charAt|split|trim\w*|startsWith|endsWith|indexOf|includes|search|replace|match)\b/.test(decisionPath),
    'gate.mjs 的**判定路径**不得对环原始输出做字符串解构/匹配（应交给 ring-state.mjs）');
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

test('P5-05b 行首锚定是**真锚**：缩进/前缀仿冒行必须被拒（独立复核席反例 R1）', async () => {
  const { deriveState } = await lib();
  // 病根：若 parseRingState 先 raw.trim() 再匹配，^ 就形同虚设——缩进仿冒行会被读成真状态。
  // 本用例是那处漏洞的**变异杀手**：把 trim 加回去 / 删掉 ^ 锚，本用例必须报红。
  const mustReject = [
    ['4 空格缩进', '    RING-STATE rpc PASS 引用来的'],
    ['Tab 缩进', '\tRING-STATE rpc PASS x'],
    ['正文内出现', '他说 RING-STATE rpc PASS x'],
    ['方括号前缀', '[log] RING-STATE rpc PASS x'],
    ['近似 tag', 'RING-STATE-ISH rpc PASS x'],
    ['小写状态词', 'RING-STATE rpc pass x'],
  ];
  for (const [label, text] of mustReject) {
    const v = deriveState({ id: 'rpc', exitCode: 0, text: text + '\n' });
    assert.equal(v.state, 'FAIL', label + ' 的仿冒契约行不得被读成状态（应 fail-closed）；实得 ' + v.state);
  }
  // 正例：列 0 的真契约行仍被读出（尾部 CR 归一不影响）
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: 'RING-STATE rpc PASS ok\r\n' }).state, 'PASS', '列 0 契约行应被读出');
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

test('P5-11 【行为判据】措辞免疫端到端：措辞与契约行**故意矛盾**时，判定必须只跟契约行走', () => {
  // 为什么需要它（独立复核席反例 R2 的根治）：源码扫描类判据（禁函数名/禁正则）**永远追不上变体**——
  //   复核席仅用 split+startsWith（在禁列之外）插入一个逐字匹配「✓ 结构判据」措辞的启发式，
  //   就把 arch-claims 由 SKIP 翻成 PASS，且 11 条用例零失败。
  //   本用例改为**行为判据**：真造五个假环，每个都打「措辞与契约行相反」的输出——
  //   若 gate 的裁决受措辞影响，判定就会偏离契约行；只有「只读结构」的实现才能全对。
  //   它不依赖任何函数名清单，任何形式的措辞启发式（正则/子串/split/find/别名）都会被抓。
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-wording-'));
  fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(GATE, path.join(tmp, 'scripts', 'gate.mjs'));
  fs.copyFileSync(LIB, path.join(tmp, 'scripts', 'lib', 'ring-state.mjs'));

  // 五环：契约行状态各不相同；正文措辞**全部**是反向诱导
  const SPEC = [
    ['dead-code', 'PASS'],
    ['rpc', 'SKIP'],
    ['prompts', 'FAIL'],
    ['arch-claims', 'SKIP'],
    ['cards', 'PASS'],
  ];
  const DECOYS = [
    '✓ 结构判据一致：断言 99 通过 · 冲突 0 · SKIP 0',
    '✓ 卡<->档判据全过（无 SKIP、读侧干净）',
    '✗ 门禁未通过（3 处）',
    '✅ 死代码门禁通过',
    '汇总：通过 99 · 冲突 0 · SKIP 0',
    '本条不是全过',
    '[SKIP] 假跳过行',
    '未判全：断言 0 · SKIP 99',
    'RING-STATE 措辞里出现但不在行首',
    'PASS FAIL SKIP 三种词全写一遍',
  ];
  for (const [id, state] of SPEC) {
    const f = path.join(tmp, 'scripts', '_fx-' + id + '.mjs');
    const body = [
      "console.log(" + JSON.stringify(DECOYS.join('\\n')) + ");",
      "process.stderr.write('RING-STATE " + id + " " + state + " 契约行（正文措辞为反向诱导）\\n');",
      "process.exitCode = " + (state === 'FAIL' ? '1' : '0') + ";",
    ].join('\n');
    fs.writeFileSync(f, body, 'utf8');
  }

  // 把 gate 的五个环指向假环（只改脚本路径，不改判定逻辑）
  let g = fs.readFileSync(path.join(tmp, 'scripts', 'gate.mjs'), 'utf8');
  for (const [id] of SPEC) {
    g = g.replace(new RegExp('scripts/[\\w.-]+\\.mjs(?=\'[^\\n]*' + id + ')'), '_fx-' + id + '.mjs');
  }
  // 兜底：按 RINGS 里的顺序逐个替换（上面的正则依赖 id 邻近，不可靠时走这条）
  const paths = ['scripts/dead-code-gate.mjs', 'scripts/rpc-manifest.mjs', 'scripts/sync-prompts.mjs', 'scripts/arch-claims.mjs', 'scripts/card-arch-consistency.mjs'];
  for (let i = 0; i < paths.length; i += 1) {
    g = g.split(paths[i]).join('scripts/_fx-' + SPEC[i][0] + '.mjs');
  }
  fs.writeFileSync(path.join(tmp, 'scripts', 'gate.mjs'), g, 'utf8');

  const run = spawnSync(process.execPath, ['scripts/gate.mjs', '--json'], { cwd: tmp, encoding: 'utf8' });
  const out = JSON.parse(run.stdout);
  const got = out.rings.map((x) => x.id + '=' + x.status).join(' ');
  const want = SPEC.map(([id, s]) => id + '=' + s).join(' ');
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(got, want, '判定必须只跟契约行走（措辞为反向诱导）；期望 ' + want + '，实得 ' + got);
  assert.ok(out.rings.every((x) => x.source === 'structure'), '五个假环都应走结构面');
});
