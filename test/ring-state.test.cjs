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
  // ⚠ T3/N3 裁定（2026-09-27 用户裁定 A）：零输出 = UNKNOWN（**缺陷**，不可被接纳基线吸收），
  //   不是 SKIP —— SKIP 是判据自己声明「扫描面缺位」（可枚举可基线化）。两者若同码，
  //   把环换成空脚本即可让链级报 0，与本次要堵的假绿同形（独立复核席 D2 实证）。
  assert.equal(deriveState({ id: 'rpc', exitCode: 0, text: '' }).state, 'UNKNOWN', '零输出不得记 PASS，且须为 UNKNOWN（不可接纳）');
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
  // ⚠ 对齐 T3/N3 三态裁定（2026-09-27 用户裁定 A）：无 FAIL 但有 SKIP ⇒ 退出码 2（未判全）。
  //   但**「有没有 SKIP」本身是环境的函数**，不是判据（2026-10-12 本批发现并修正）：
  //   arch-claims/cards 两环的扫描面（治理档 + 治理根）在仓外，只有**治理根可被解析**时才走实判；
  //   不可读时它们按契约报 SKIP。修 `scripts/lib/gov-root.mjs` 之前，本机（WSL）治理根解析不到
  //   ⇒ 恒有 2 个 SKIP ⇒ 退出码恒 2；修好之后解析得到 ⇒ 全判 ⇒ 退出码 0。**两种都是合法读数。**
  //   故此处**不得**在 0 / 2 之间取一个假定的「环境正确值」（那正是把环境当判据）——改为断言
  //   三态**自洽**：退出码必须由 RING 行面实算推出，且 SKIP 与退出码同向。
  // ⚠ 计状态必须取**字段位**（第 3 列），不得全文 grep「SKIP」字样：环自报的理由里本来就会出现
  //   「SKIP 0」「全过」这类词（如 arch-claims 的「冲突 0 · SKIP 0」）——按字样计会把 PASS 行
  //   误数成 SKIP（2026-10-12 实测：真 SKIP 0 却数出 1，退出码期望被算成 2）。这与 ring-state
  //   契约「状态只在字段位置」是同一纪律，旧写法在此处恰好被真 SKIP 掩盖。
  const statusOf = (l) => l.split(/\s+/)[2];
  const skipN = ringLines.filter((l) => statusOf(l) === 'SKIP').length;
  const failN = ringLines.filter((l) => statusOf(l) === 'FAIL').length;
  // 反向：**无 FAIL 时**只要有 SKIP 就必须取 2（防「有未判却说 0」——P5 要治的原始病不得在这个口径下溜过）。
  //   ⚠ 必须加 failN === 0 这个前提：三态裁定里「失败优先于未判全」，有 FAIL 时是 1 而非 2。
  const expected = failN > 0 ? 1 : (skipN > 0 ? 2 : 0);
  assert.equal(r.code, expected,
    '三态退出码（T3 裁定）：有 FAIL ⇒ 1，否则有 SKIP ⇒ 2（未判全），否则 0；'
    + `实测 FAIL ${failN} / SKIP ${skipN} / exit ${r.code}`);
  if (skipN > 0 && failN === 0) assert.equal(r.code, 2, '无 FAIL 且有 SKIP 时退出码必须为 2（不得读成 0）');
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

/** 环**自报文本**里声明「没判上」的措辞（内容派生）。
 *
 *  ⚠ 为什么必须靠它、不能只靠 `rings[].status`（2026-10-12 回修·独立复验 §4.4 实测）：
 *    `scripts/lib/ring-state.mjs` 的 `emitRingState` 出口若把 SKIP 印成 PASS（= 本契约要治的
 *    原始病最直接形态），`status` 列被污染 ⇒ `status/verdict/summary.skip` 全部同谋变绿，
 *    旧 P5-10 的 `if (skips.length)` 整块被跳过 ⇒ **13/13 全绿而病在**。
 *    但**出口翻转只改状态字段、不改环自报的 reason 文本**（reason 由环内容派生）——
 *    于是「状态列」与「自报文本」会互相矛盾，这就是不依赖被污染通道的那条腿。
 *  `SKIP\s*[1-9]` 刻意只认 **非零** 计数：真仓 PASS 环的自报里就带「SKIP 0」（arch-claims）
 *  与「无 SKIP」（cards），按字样全局 grep 会把 PASS 误判为未判全（P5-08 已栽过一次）。 */
const SELF_DECLARES_NOT_PASS = /未判全|退化位|SKIP\s*[1-9]/;

test('P5-10 三态语义【交叉判据】：环自报文本与状态列必须互相印证（SKIP 不得被印成 PASS）', () => {
  const r = run(GATE, ['--json']);
  const j = JSON.parse(r.stdout);
  const selfReport = (x) => String(x.summary || '');
  const declared = j.rings.filter((x) => SELF_DECLARES_NOT_PASS.test(selfReport(x)));
  const statusSkips = j.rings.filter((x) => x.status === 'SKIP');

  // ── ① 交叉断言（核心·抓原始病最直接形态）────────────────────────────────
  //   环自报里声明了「未判全 / 退化位 / SKIP n>0」（内容派生），其状态列**不得**为 PASS。
  //   出口把 SKIP 翻成 PASS 时，这条必红（自报不动、状态列被动）。
  const lied = j.rings.filter((x) => x.status === 'PASS' && SELF_DECLARES_NOT_PASS.test(selfReport(x)));
  assert.deepEqual(lied.map((x) => x.id), [],
    '环自报里声明了「未判全/SKIP」，状态列却印成 PASS ⇒ 契约出口把 SKIP 翻成了 PASS（原始病）：'
    + JSON.stringify(lied.map((x) => x.id + ' → ' + selfReport(x))));

  // ── ② 空集必须由**文本面**证明，不得由已被污染的 status 字段自证 ──────────
  //   「没有 SKIP」不能只说「status 里数不到 SKIP」（那正是被污染的通道），而必须由
  //   各环**自报文本**佐证：状态列声称零 SKIP 时，自报里也不得出现任何「没判上」声明。
  //   该断言在**两种形态下都真执行**（形态 A：两侧皆空 ⇒ 2 个空集必须相等；形态 B：两侧皆有）。
  if (statusSkips.length === 0) {
    assert.deepEqual(declared.map((x) => x.id), [],
      '状态列声称无 SKIP，但环自报文本里却有「未判全/SKIP」⇒ 空集不是由文本证明的（状态列可疑）：'
      + JSON.stringify(declared.map((x) => x.id + ' → ' + selfReport(x))));
  } else {
    // 形态 B：状态列的 SKIP 集合必须恰是自报里声明未判全的那些（互相印证，不多不少）
    assert.deepEqual(statusSkips.map((x) => x.id).sort(), declared.map((x) => x.id).sort(),
      '状态列的 SKIP 集合与自报文本声明的未判全集合必须逐项一致');
  }

  // ── ③ 判别力自证：本判据的谓词必须真能咬住真 SKIP 自报、且不误伤 PASS 自报 ──
  //   （没有这一条，② 的「空集」可能是谓词恒假的产物 —— 那与本契约要治的假绿同族。）
  assert.ok(SELF_DECLARES_NOT_PASS.test('环自报：未判全：断言 11 · SKIP 2（未判：A-2）'),
    '谓词必须能识别真 SKIP 自报（取自真仓 cards 环形态 B 的真实 summary）');
  assert.ok(!SELF_DECLARES_NOT_PASS.test('环自报：断言 37 通过 · 冲突 0 · SKIP 0 · 在册未达 3 · 在册缺陷 0'),
    '「SKIP 0」是真 PASS 自报（arch-claims），谓词不得误判其为未判全');
  assert.ok(!SELF_DECLARES_NOT_PASS.test('环自报：判据全过（无 SKIP、读侧干净）：断言 13 通过 · 冲突 0 · 真判 3/3'),
    '「无 SKIP」是真 PASS 自报（cards 形态 A），谓词不得误判');

  // ── ④ 保留原覆盖：verdict 与状态列自洽（不是核心，但不得丢）──────────────
  const blocking = j.rings.filter((x) => x.status === 'FAIL' || x.status === 'UNKNOWN');
  if (blocking.length) {
    assert.equal(j.summary.verdict, 'FAIL', '有 FAIL/UNKNOWN 时失败优先，verdict 必须是 FAIL');
  } else if (statusSkips.length) {
    assert.equal(j.summary.verdict, 'NOT_FULLY_JUDGED', '有 SKIP 且无 FAIL 时 verdict 必须是 NOT_FULLY_JUDGED');
  } else {
    assert.equal(j.summary.verdict, 'ALL_PASS', '无 FAIL 无 SKIP 时 verdict 必须是 ALL_PASS');
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
