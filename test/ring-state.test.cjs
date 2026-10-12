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
/** 「未判/跳过」的**强措辞**：明确说"没判上"，无歧义，与计数无关。 */
const UNJUDGED_STRONG = /未判全|退化位/;
/** 语言宽容的「跳过/未判」词干（中英、大小写）。 */
const UNJUDGED_STEM = '(?:SKIP|skip|Skipped|skipped|跳过|未判)';
/** 词干与计数之间允许的**分隔/跨字**成分：分隔符（`:`/`：`/`=`）、量词（项/项数/个）、
 *  以及中文**时态助词**（`了`/`过`）。⚠ 后两者是 2026-10-12 谓词回修补的：旧式只认
 *  `[:：=]|项|项数|个`，于是 `跳过了 2 项`（词干与计数被「了」隔开）**漏咬**（复验 3 · D1）。
 *  ⚠ 该组**刻意不含数字**：故 `跳过 0 项，另跳过 2 项` 的第一处匹配停在 `0`，不会跨子句吞到后面的计数。 */
const UNJUDGED_GAP = '(?:[:：=]|项|项数|个|了|过)?';
/** 词干后紧跟**非零**计数 ⇒ 声明了未判/跳过（源串；求值时**全局扫描**，见下）。
 *  ⚠ 严格锚定在词干之后：`SKIP 0 · 在册未达 3` 取到的是 **0**（不是 3）⇒ 真 PASS 自报不误判。 */
const UNJUDGED_COUNTED_SRC = UNJUDGED_STEM + '\\s*' + UNJUDGED_GAP + '\\s*(\\d+)';
/** 否定式提及：`无 SKIP` / `不含 SKIP` / `零 SKIP` / `无需 SKIP` / `未跳过…` **不是**"声明未判"。
 *  ⚠ 2026-10-12 谓词回修：词表补 **`未` / `无需` / `不用`**（复验 3 · D8「无需 SKIP」误判）。
 *  ⚠ **不误剥正向声明的交互（必须实测自证，见 P5-10d）**：
 *    · `未判全` 由 `UNJUDGED_STRONG` **在剥否定之前**先行命中 ⇒ 不受影响；
 *    · `未判 2 项` 里 `未` 后接的是 `判`（词干为 `跳过|未判|SKIP|…`，`判` 本身不匹配任何词干）
 *      ⇒ **不会被误剥**（实测：仍为 true）。 */
const UNJUDGED_NEGATED = new RegExp('(?:无|不含|零|没有|无需|不用|未|no|without|not)\\s*' + UNJUDGED_STEM, 'gi');
/** 裸英文 `SKIP`（**后面不跟数字**、且未被否定）才算声明未判 —— 只对英文词干启用；
 *  中文裸 `跳过`/`未判` **刻意不纳入**（与 `未跳过任何判据`/`未判明` 一类真 PASS 措辞歧义，见「无法安全纳入」清单）。
 *  ⚠ 负面前瞻 `(?!\s*(?:[-+]\s*)?\d)` 同时排除两类：
 *    · **带符号异常计数**（复验 3 · D7 `SKIP -1`）——`-1`/`+1` 不是合法"跳过 n 项"读数；
 *    · **已被计数式覆盖的 `SKIP 0`** ——这正是「裸 SKIP」的定义（**不带计数**）。
 *      ⇒ 有了它，`SKIP 0 · 在册未达 3` 永远不会被裸英文支重新咬成 true（真 PASS 不误伤），
 *        同时**不遮挡同一句里另一个真正的裸 `SKIP`**（旧式 `exec` 早退做不到）。 */
const UNJUDGED_BARE_EN = /(?:\bSKIP\b|\bskip\b)(?!\s*(?:[-+]\s*)?\d)/;

/** 环自报文本是否声明了「没判上」（未判全 / 退化位 / 带非零计数的跳过·未判 / 裸 SKIP）。
 *
 *  为什么需要收窄（复验 2 · blocker 1 / V4 实测）：旧谓词 `/未判全|退化位|SKIP\s*[1-9]/` 对
 *  `SKIP`（无数字）/ `跳过 2` / `skip 2` / `未判 2 项` **四种写法全部放行** ⇒ 交叉判据的鉴别力
 *  被绑死在"被守卫方自己写的那几个词"上。现改为**词干 + 非零计数**的语言宽容式，并逐条保住
 *  「不误伤真 PASS 自报」的三条自证（见 P5-10 ③ 与 P5-10c）。
 *
 *  ⚠ 2026-10-12 谓词回修（复验 3 · 31 条对抗性用例挖出 6 处不符），逐条对应三条根因：
 *   · **根因 1（系统性漏咬）**：旧式用 `exec()` **只取首个匹配** ⇒ 复合句里"先出现的 0"
 *     把后面的正向声明整个压掉（D4 `未跳过 0 项，跳过 3 项` / D5 `跳过 0 项，另跳过 2 项` /
 *     D6 `skip 0, then skip 2` 全部漏咬）。**现改为全局扫描、任一非零即真**。
 *     真 PASS 不误伤靠两重保障：① 循环只认**非零**；② 裸英文支带**数字否前瞻**，
 *     故 `SKIP 0` 既不会被计数支认成正向、也不会被裸英文支重新咬住。
 *   · **根因 2（否定词缺失/跨字）**：否定词表补 `未|无需|不用`；词干与计数之间允许
 *     `了|过`（D1 `跳过了 2 项`）。⚠ 关键交互已实测（P5-10d）：`未判全` 由强措辞先命中、
 *     `未判 2 项` 不匹配任何否定式 ⇒ 二者**不被误剥**。
 *   · **根因 3（负计数）**：裸英文支加 `[-+]` 排除（D7）。 */
function selfDeclaresNotPass(s) {
  let t = String(s == null ? '' : s);
  if (UNJUDGED_STRONG.test(t)) return true;
  // 先剥掉「否定式提及」，再判剩下的（否则 `无 SKIP 但有跳过 2` 会被否定前缀整体吞掉）
  t = t.replace(UNJUDGED_NEGATED, ' ');
  // 根因 1 修复：**全局扫描**全部「词干+计数」匹配，任一为正值即真（不再只看首个）。
  const re = new RegExp(UNJUDGED_COUNTED_SRC, 'gi');
  let m;
  while ((m = re.exec(t)) !== null) {
    if (Number(m[1]) > 0) return true;
    if (m.index === re.lastIndex) re.lastIndex += 1;   // 防零宽匹配死循环
  }
  // 计数支无正向 ⇒ 再看**不带计数**的裸 SKIP（数字否前瞻保证 `SKIP 0` 不会落到这里被重咬）
  return UNJUDGED_BARE_EN.test(t);
}

test('P5-10 三态语义【交叉判据】：环自报文本与状态列必须互相印证（SKIP 不得被印成 PASS）', () => {
  const r = run(GATE, ['--json']);
  const j = JSON.parse(r.stdout);
  const selfReport = (x) => String(x.summary || '');
  const declared = j.rings.filter((x) => selfDeclaresNotPass(selfReport(x)));
  const statusSkips = j.rings.filter((x) => x.status === 'SKIP');

  // ── ① 交叉断言（核心·抓原始病最直接形态）────────────────────────────────
  //   环自报里声明了「未判全 / 退化位 / 跳过 n>0」（内容派生），其状态列**不得**为 PASS。
  //   出口把 SKIP 翻成 PASS 时，这条必红（自报不动、状态列被动）。
  const lied = j.rings.filter((x) => x.status === 'PASS' && selfDeclaresNotPass(selfReport(x)));
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
  assert.ok(selfDeclaresNotPass('环自报：未判全：断言 11 · SKIP 2（未判：A-2）'),
    '谓词必须能识别真 SKIP 自报（取自真仓 cards 环形态 B 的真实 summary）');
  assert.ok(!selfDeclaresNotPass('环自报：断言 37 通过 · 冲突 0 · SKIP 0 · 在册未达 3 · 在册缺陷 0'),
    '「SKIP 0」是真 PASS 自报（arch-claims），谓词不得误判其为未判全'
    + '（⚠ 注意「SKIP 0 · 在册未达 3」中含其它非零数字，不得被它们带偏）');
  assert.ok(!selfDeclaresNotPass('环自报：判据全过（无 SKIP、读侧干净）：断言 13 通过 · 冲突 0 · 真判 3/3'),
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

test('P5-10c 【收窄自证】四类漏判写法必须被咬住；其余真 PASS 自报不得被误伤', () => {
  // 复验 2 · blocker 1 / V4 的验收点：这四种写法旧谓词**全部放行**（实测 false），现必须**全部为真**。
  const MUST_CATCH = [
    ['裸 SKIP（不带数字）', '环自报：SKIP（未判：A-2）'],
    ['中文「跳过 2」', '环自报：跳过 2 个判据'],
    ['英文小写「skip 2」', '环自报：skip 2'],
    ['「未判 2 项」', '环自报：未判 2 项'],
  ];
  for (const [label, text] of MUST_CATCH) {
    assert.ok(selfDeclaresNotPass(text), '必须咬住 ' + label + '：' + JSON.stringify(text));
  }
  // 反向：真 PASS 自报（真仓五环的**真实** summary 全文）一律不得误伤
  const MUST_NOT_CATCH = [
    ['dead-code', '环自报：R1–R4 全过'],
    ['rpc', '环自报：34 条线上方法一致 / schema 17 / 具名申报 17 / 0 孤儿 / 文档 100% 覆盖'],
    ['prompts', '环自报：生成区与 skills/enhance 下的 md 源逐字一致（19 个常量，零漂移）'],
    ['arch-claims', '环自报：断言 37 通过 · 冲突 0 · SKIP 0 · 在册未达 3 · 在册缺陷 0'],
    ['cards(形态A)', '环自报：判据全过（无 SKIP、读侧干净）：断言 13 通过 · 冲突 0 · 真判 3/3'],
    ['退化位对照（非 PASS 语义）: 无 SKIP 但有跳过 2', '环自报：无 SKIP 但有跳过 2'],
  ];
  // ⚠ 最后一条是**混合形态**（否定式提及 + 正向声明）：必须先剥否定再判，结果应为 true。
  //    单独列出以免与上面「不得误伤」混为一谈 —— 这里期望 true。
  assert.ok(selfDeclaresNotPass(MUST_NOT_CATCH[5][1]),
    '混合形态（「无 SKIP 但有跳过 2」）必须判为声明未判（剥否定后仍有正向声明）');
  for (const [label, text] of MUST_NOT_CATCH.slice(0, 5)) {
    assert.ok(!selfDeclaresNotPass(text), '真 PASS 自报不得误伤（' + label + '）：' + JSON.stringify(text));
  }
  // 计数边界：0 与 >0
  assert.ok(!selfDeclaresNotPass('环自报：跳过 0 项'), '「跳过 0」= 真 PASS 语义，不得判为未判');
  assert.ok(selfDeclaresNotPass('环自报：skipped 1'), '「skipped 1」应判为未判');
});

test('P5-10d 【对抗性回归】D1–D11 逐条钉住（复验 3 挖出的 6 处不符，含本席与复验席判定不同处）', () => {
  // ── 2026-10-12 谓词回修：把复验 3 的 31 条对抗性用例里点名的 D1–D11 **固化成断言** ──────
  //   目的：这类「措辞覆盖不全」的窟窿今后由自动化抓住，不再靠下一轮人工对抗性测试。
  //   期望值由本席判定并给依据；与复验席不一致的**逐条显式标注**（见 D3 / D7）。
  const table = [
    // [id, 文本, 期望, 依据]
    ['D1', '环自报：跳过了 2 项', true,
      '★复验席挖出的漏咬（「了」把词干与计数隔开）。语义上确实"跳过了 2 项" ⇒ 必须咬。已修：GAP 纳入 了/过。'],
    ['D2', '环自报：已跳过 3 个判据', true,
      '正向声明带非零计数 ⇒ 咬（改前已 true，回归保持）。'],
    ['D3', '环自报：跳过 2 / 未跳过 2', true,
      '⚠ **本席判定与复验席不同**（复验席期望 false）。理由见本用例末尾 D3 专项论证：'
      + '该句含正向子句「跳过 2」= 契约要治的确切形态；为它引入「同句否定撤销正向」会连带把'
      + '「跳过 3 项；未跳过 1 项」（真实跳过了 3）也判 false ⇒ **把 fail-loud 误判换成 fail-silent 漏咬**，'
      + '与本契约要治的假绿同族。真 PASS 保障由 P5-10 ②「SKIP 集合与自报声明集合逐项一致」+ '
      + '强措辞「未判全/退化位」承担（真 SKIP 环的自报里必有其一）。'],
    ['D4', '环自报：未跳过 0 项，跳过 3 项', true,
      '★系统性漏咬（exec 只取首个匹配，「先出现 0」压掉后面的 3）。已修：全局扫描取任一正向。'],
    ['D5', '环自报：跳过 0 项，另跳过 2 项', true,
      '★同上（复合句）。已修：全局扫描。'],
    ['D6', '环自报：skip 0, then skip 2', true,
      '★同上（英文复合句）。已修：全局扫描。'],
    ['D7', '环自报：SKIP -1', false,
      '⚠ **本席判定与复验席一致**（期望不咬）：负计数是**异常输入**，非合法「跳过 n 项」读数。'
      + '已修：裸英文支加 (?!\\s*(?:[-+]\\s*)?\\d)。'],
    ['D8', '环自报：无需 SKIP', false,
      '★否定词表缺「无需」⇒ 误判。已修：否定词表补 未/无需/不用。'],
    ['D9', '环自报：skip', true,
      '裸英文 SKIP = 声明未判（设计如此，本仓里当且仅当表示 SKIP 态）。'],
    ['D10a', '环自报：skipped=3', true, '分隔符/大小写宽容有效（= 号）。'],
    ['D10b', '环自报：SKIP: 2', true, '冒号分隔。'],
    ['D10c', '环自报：Skipped 4 items', true, '大小写 + 量词宽容。'],
    ['D11', '环自报：skip 2.5', true, '小数计数仍取非零真值（2.5 ⇒ 取到 2）。'],
    // 本席补充：真 PASS 侧不得被新增规则误伤（尤其全局扫描 + 裸英文新前瞻）
    ['X1', '环自报：断言 37 通过 · 冲突 0 · SKIP 0 · 在册未达 3 · 在册缺陷 0', false,
      '真 PASS：全句有计数但全为 0，且裸英文支被数字否前瞻挡住 ⇒ 不得被「3」带偏。'],
    ['X2', '环自报：判据全过（无 SKIP、读侧干净）', false, '真 PASS：否定式提及。'],
    ['X3', '环自报：未跳过任何判据', false, '真 PASS：否定前缀 + 裸中文词干不纳入。'],
    ['X4', '环自报：SKIP +2', false, '带符号计数同属异常输入（与 D7 同族，本席补充）。'],
    ['X5', '环自报：SKIP 0 · 另 SKIP', true,
      '本席补充：同一句里「SKIP 0」不得**遮蔽**另一个真正的裸 SKIP（全局扫描 + 数字否前瞻的组合效果）。'],
  ];
  for (const [id, text, expect, why] of table) {
    assert.equal(selfDeclaresNotPass(text), expect,
      '对抗性用例 ' + id + ' 判定不符（期望 ' + expect + '）：' + JSON.stringify(text) + '｜依据：' + why);
  }

  // ── D3 专项论证（本席判定与复验席不同处，写清算式而非只写结论）──────────────────
  //   复验席期望 false 的隐含规则是「同句后出现的否定可撤回前面的正向」。本席实测该规则的代价：
  assert.equal(selfDeclaresNotPass('环自报：跳过 3 项；未跳过 1 项'), true,
    'D3 论证：含正向子句「跳过 3 项」的真实形态必须**咬**（若为 false 即漏咬）'
    + ' ⇒ 可见「同句否定撤销正向」会误伤此形态，故本席不采纳该规则。');
  assert.equal(selfDeclaresNotPass('环自报：未跳过 1 项；跳过 3 项'), true,
    'D3 论证（正向在后同样成立）：否定在前的复合句不得把后面的正向吞掉。');
  //   反向确认：**纯否定**句仍必须不咬（否则否定剥离形同虚设）
  assert.equal(selfDeclaresNotPass('环自报：未跳过任何判据'), false,
    'D3 论证的另一面：纯否定句不得被咬（否则否定剥离失效）。');
});

test('P5-10e 【§2.2 关键交互自证】补「未」进否定词表后，三条正向措辞必须**不被误剥**', () => {
  // ── 为什么单列：2.2 把 `未` 加进否定前缀（为修 D8「无需 SKIP」），带**误剥风险** ──────
  //   风险链：`未` 命中否定前缀 ⇒ 吞掉其后的词干 ⇒ 正向声明被剥掉 ⇒ 漏咬。
  //   本席不能只靠推演（任务书明确要求实测自证）。三条逐一实测：
  //   ① `未判 2 项`：`未` 后接 `判`，而词干是 `跳过|未判|SKIP|…` —— `判` 单独不匹配任何词干
  //      ⇒ 否定式 `(?:…|未)\s*(?:跳过|未判|SKIP…)` 需要 `未` **紧跟**词干才命中；
  //      这里 `未判` 整体就是词干本身 ⇒ 不被误剥。
  //   ② `未判全`：由 `UNJUDGED_STRONG` 在**剥否定之前**先行命中 ⇒ 与否定表无关。
  //   ③ `未跳过任何判据`：`未` + 词干 `跳过` **正确命中**否定 ⇒ 剥掉 ⇒ 判 false（期望如此）。
  assert.equal(selfDeclaresNotPass('环自报：未判 2 项'), true,
    '关键交互①：「未判 2 项」必须**仍被咬**（不得因新增「未」否定词而误剥）');
  assert.equal(selfDeclaresNotPass('环自报：未判全：断言 11 · SKIP 2（未判：A-2）'), true,
    '关键交互②：「未判全」必须**仍被咬**（强措辞在剥否定前先命中）');
  assert.equal(selfDeclaresNotPass('环自报：未跳过任何判据'), false,
    '关键交互③：「未跳过任何判据」必须**仍不被咬**（否定剥离需正常生效）');
  // 补充：否定词新增项各自生效（`无需`/`不用`），避免只修 D8 一处字面
  assert.equal(selfDeclaresNotPass('环自报：无需 SKIP'), false, '「无需 SKIP」不得被咬（D8）');
  assert.equal(selfDeclaresNotPass('环自报：不用 SKIP'), false, '「不用 SKIP」同族，不得被咬');
  assert.equal(selfDeclaresNotPass('环自报：没有 SKIP'), false, '既有否定词「没有」仍生效（回归）');
  // 反向：否定式**只**该剥紧跟的那个词干，不得把同句另一个正向声明一起剥掉
  assert.equal(selfDeclaresNotPass('环自报：无 SKIP 但有跳过 2'), true,
    '回归（既有 MUST_NOT_CATCH 混合形态）：剥否定后仍须咬住另一个正向声明');
});

test('P5-10b 措辞纪律（原 P5-10 第 2 条·等价强度补回）：有环未判时，**非 --json 的给人看的面**不得说「环 PASS/无 SKIP/全过」', (t) => {
  // ── 2026-10-12 收尾批：补回**被真删**的那条断言 ──────────────────────────────
  //   出处（修复前 efb3e8e 的 P5-10，逐字）：
  //     `assert.ok(!/环 PASS/.test(r.stdout) || !/无 SKIP/.test(r.stdout), '有 SKIP 时不得出现「全过」措辞')`
  //   改写 P5-10 为交叉判据时它被真删，且全仓 test/ 无等价物（复验 2 §1.7③ 查实）。
  //   本用例以**等价强度**补回，并修掉原写法的两处弱点：
  //     ① 原来靠 `r.stdout`（P5-10 跑的是 `--json`，那面里 `环 PASS` 根本不会出现）⇒ 原断言
  //        在 `--json` 形态下几乎恒真。**现改为看非 --json 的给人看的面**（`环 PASS`/`无 SKIP`
  //        只在那里出现），断言才对得准目标文案；
  //     ② 原来内联在 P5-10 的 `if (skips.length)` 里 ⇒ 形态 A 下整块不执行。**现独立成条**，
  //        并按「有未判环 ⇒ 必须执行」的口径处置：形态 A 无未判环时**显式 t.skip 并说明**
  //        （而不是静默通过），形态 B 真执行。
  const r = run(GATE, []);              // 非 --json：这才是「给人看的面」
  const j = run(GATE, ['--json']);
  const ju = JSON.parse(j.stdout).summary.unjudged;
  if (!ju.length) {
    // 形态 A：本仓无未判环 ⇒ 该文案纪律**无可适用对象**。诚实记 SKIP（不静默绿），
    // 并同时用夹具证明该断言**不是恒真**（见 P5-10b2）。
    t.skip('本形态无未判环 ⇒ 「有环未判时不得说全过」无可适用对象（该形态下的判别力由 P5-10b2 夹具承担）');
    return;
  }
  // 形态 B：真有未判环 ⇒ 原断言真执行
  assert.equal(ju.length > 0, true, '（前置）本形态确有未判环，断言必须真执行');
  assert.ok(!/环 PASS/.test(r.out) || !/无 SKIP/.test(r.out),
    '有环未判时，给人看的面不得出现「环 PASS」/「无 SKIP」措辞（原 P5-10 第 2 条，等价补回）；实测含环 PASS=' 
    + /环 PASS/.test(r.out) + ' 含无 SKIP=' + /无 SKIP/.test(r.out));
  // 加固：未判全时更不得出现「全过」字样（N4 措辞面假绿同族）
  assert.ok(!/[✓⏭→]{0,2}\s*门禁链全过/.test(r.out),
    '有环未判时不得打印「门禁链全过」（实测 stdout 含该行 ⇒ 措辞面假绿）');
});

test('P5-10b2 【夹具·判别力自证】「有环未判却打印全过」必须报红（证明 P5-10b 不是恒真）', () => {
  // 为什么要夹具：真仓形态 A 下「有未判环」这一前提不存在（P5-10b 走 SKIP），
  // 若只靠真仓，该断言在本机永不执行 ⇒ 又变成「只在某形态才跑」的空转断言（复验席点名的病）。
  // 故用夹具**确定地**造出「有 SKIP」形态，并把 gate.mjs 的文案改成**违规**（含「环 PASS」/「无 SKIP」），
  // 断言该用例的口径**必须报红**。判别力若不成立，本用例自己就会红。
  const tmp = buildFixture();
  try {
    const gatePath = path.join(tmp, 'scripts', 'gate.mjs');
    let g = fs.readFileSync(gatePath, 'utf8');
    // 注入违规文案：把「未判全」那条 else-if 的文案换成「环 PASS（无 SKIP）」——正是被禁措辞
    const before = g;
    g = g.replace(
      "else if (nOf('SKIP')) console.log('⏭ 门禁链未判全：PASS ' + nOf('PASS') + ' · SKIP ' + nOf('SKIP') + '（有环未判，本条不记通过）');",
      "else if (nOf('SKIP')) console.log('✓ 门禁链全过：' + nOf('PASS') + ' 环 PASS（无 SKIP）');",
    );
    assert.notEqual(g, before, '夹具注入点应存在（gate.mjs 的未判全文案行）');
    fs.writeFileSync(gatePath, g, 'utf8');
    // 把五环换成两个哨兵环：一 SKIP 一 PASS ⇒ 确定「有环未判」，且不触发治理根依赖
    let g2 = fs.readFileSync(gatePath, 'utf8');
    const s = g2.indexOf('const RINGS = [');
    const e = g2.indexOf('];', s);
    const ESC_N = String.fromCharCode(92) + 'n';
    fs.writeFileSync(path.join(tmp, 'scripts', '_b2-skip.mjs'),
      'process.stderr.write("RING-STATE b2skip SKIP 夹具：未判全：断言 1 · SKIP 1' + ESC_N + '");' + NL, 'utf8');
    fs.writeFileSync(path.join(tmp, 'scripts', '_b2-pass.mjs'),
      'process.stderr.write("RING-STATE b2pass PASS 夹具：R1–R4 全过' + ESC_N + '");' + NL, 'utf8');
    const synthetic = ['const RINGS = [',
      "  { id: 'b2skip', script: 'scripts/_b2-skip.mjs', args: [] },",
      "  { id: 'b2pass', script: 'scripts/_b2-pass.mjs', args: [] },",
      '];'].join(NL);
    g2 = g2.slice(0, s) + synthetic + g2.slice(e + 2);
    fs.writeFileSync(gatePath, g2, 'utf8');

    const res = spawnSync(process.execPath, ['scripts/gate.mjs'], { cwd: tmp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const out = String(res.stdout || '') + String(res.stderr || '');
    const jsonRes = spawnSync(process.execPath, ['scripts/gate.mjs', '--json'], { cwd: tmp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let jj = null; try { jj = JSON.parse(jsonRes.stdout); } catch { jj = null; }
    assert.ok(jj, '夹具 --json 必须可 parse：\n' + String(jsonRes.stdout).slice(0, 300));
    // 前置：夹具必须是「有环未判」
    assert.ok(jj.summary.unjudged.length > 0, '夹具必须造出未判环，否则判别力自证无效');
    // 核心：违规文案在场 ⇒ 与 P5-10b 同口径的断言**必须为假**（证明它不是恒真）
    const violates = /环 PASS/.test(out) && /无 SKIP/.test(out);
    assert.equal(violates, true,
      '夹具注入的违规文案应同时含「环 PASS」与「无 SKIP」（否则夹具无效）:\n' + out.slice(-400));
    assert.ok(!(/环 PASS/.test(out) && /无 SKIP/.test(out)) === false,
      'P5-10b 的口径必须能判假 ⇒ 判别力成立（该表达式为假即报红）');
    // 直接以 P5-10b 的原式断言一次：在违规形态下它必须是**假**（若为真说明判据恒真）
    const p510bExpr = !/环 PASS/.test(out) || !/无 SKIP/.test(out);
    assert.equal(p510bExpr, false,
      'P5-10b 的原式在该违规形态下必须为 false（若为 true ⇒ 判据恒真、无判别力）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
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
