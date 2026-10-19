'use strict';
// declaration-lock.test.cjs —— ⭐ **声明面**锁：场景必须显式声明 tab，且必须被 PROBE_MINS 覆盖
//
// ─────────────────────────────────────────────────────────────────────────────
// 由来（2026-10-19 · 声明面锁批）
//   上一批（CHG-223）给审计装置加了「逐场景测点下限」自检，但**它只在有人跑
//   scripts/settings-layout-audit.mjs 时才生效** —— 那个装置**需要 Chrome headless**，
//   而 npm test 环境不保证有浏览器 ⇒ 该自检的价值完全依赖「有人记得跑 audit」。
//   本仓已因「靠人记的事」栽过多次（S-8 第 9 次漂移就是靠人记）。⇒ 本文件用**纯 Node**
//   把其中的**声明面**部分变成每次 npm test 都跑的锁（⛔ 不启动任何浏览器）。
//
// ⚠⚠ 本文件的能力边界（主持侧硬要求，⛔ 不得让下一批误以为做了这条就等于堵住了）：
//
//   | ✅ 本批能挡                          | ⛔ 本批挡不住                                    |
//   |--------------------------------------|--------------------------------------------------|
//   | 场景漏声明 tab                        | ⚠ 测点被结构改动清空（那必须真渲染，只有 audit 能发现） |
//   | 场景漏声明测点下限                    | ⚠ 下限值写得偏小                                  |
//   | PROBE_MINS 漏覆盖某场景                | ⚠ 渲染出来但内容错                                |
//   | PROBE_MINS 有孤儿条目（场景不存在）    |                                                  |
//
//   ⇒ ⭐ **这是「声明面」的锁，不是「结果面」的锁** ⇒ 两者**互补**，
//     ⛔ **不得互相替代**：本文件全绿 **不等于** 界面真的测到了语音块；
//     settings-layout-audit.mjs 的 probe-min 全绿 **也不等于** 每个场景都声明了 tab。
//
// ─────────────────────────────────────────────────────────────────────────────
// 实现纪律：**纯只读解析，⛔ 不执行被检查的文件、⛔ 不启浏览器**
//   · 只读 fs.readFileSync + 手写「括号平衡扫描」，从源码文本里取出场景表与 PROBE_MINS；
//   · ⛔ **不 import/require scripts/settings-layout-audit.mjs** —— 它顶层就调 main()
//     会去启动 Chrome（spawnSync(browser, ['--headless=new'...])）⇒ 绝不能执行它；
//   · 解析对象是**代码面**（源码文本），⚠ 注释面里的 push(...) 样文本由「先剥注释」排除
//     （剥注释复用仓内单一事实源 scripts/lib/code-only.mjs，⛔ 不自写第二份）。
//
// ⚠ 解析的**已知边界**（如实声明，与判据范围同框）：
//   · 只认两种声明形态：① push('字面量id', {...}) ② for (const x of [字面量...]) push('前缀' + x, {...})；
//   · ⚠ 若将来有人改用**运行期拼接**（从变量/配置读 id），本解析会**认不出**该场景
//     ⇒ 此时**不是本判据变弱**，而是**声明面被改成了不可静态判定** ⇒
//     本文件会以「场景数不符」变红（fail-closed），⛔ 不得通过放宽解析来「修绿」。
//   · 本文件⛔ **不检查** PROBE_MINS 里各下限**数值是否合理**（那是结果面，须真渲染）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const AUDIT = path.join(ROOT, 'scripts', 'settings-layout-audit.mjs');

let codeOnlyPromise = null;
function codeOnlyOf(src) {
  if (!codeOnlyPromise) codeOnlyPromise = import('../scripts/lib/code-only.mjs');
  return codeOnlyPromise.then((m) => m.codeOnly(src));
}

// ══════════════════════════════════════════════════════════════════════════
// 纯解析原语（**代码面**扫描；不懂 JS 语义，只做括号/字符串平衡）
// ══════════════════════════════════════════════════════════════════════════

function readStringAt(s, i) {
  const q = s[i];
  if (q !== '"' && q !== "'") throw new Error('readStringAt: 非引号起点 @' + i);
  let out = '';
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { out += s[j + 1]; j += 2; continue; }
    if (c === q) return { value: out, end: j + 1 };
    out += c;
    j += 1;
  }
  throw new Error('readStringAt: 字符串未闭合 @' + i);
}

function skipWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i += 1;
  return i;
}

function readBalanced(s, i) {
  const open = s[i];
  const close = open === '{' ? '}' : open === '[' ? ']' : open === '(' ? ')' : null;
  if (!close) throw new Error('readBalanced: 非括号起点 @' + i + ' = ' + JSON.stringify(open));
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '"' || c === "'") { j = readStringAt(s, j).end; continue; }
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return { text: s.slice(i, j + 1), end: j + 1 }; }
    j += 1;
  }
  throw new Error('readBalanced: 括号未闭合 ' + open + ' @' + i);
}

function readStatement(s, i) {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '"' || c === "'") { j = readStringAt(s, j).end; continue; }
    if ('{(['.includes(c)) { depth += 1; j += 1; continue; }
    if ('})]'.includes(c)) { depth -= 1; j += 1; continue; }
    if (c === ';' && depth === 0) return { text: s.slice(i, j), end: j + 1 };
    j += 1;
  }
  throw new Error('readStatement: 语句未终止 @' + i);
}

function functionBody(src, name) {
  const anchor = 'function ' + name + '(';
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error('找不到函数：' + anchor);
  const bodyAt = src.indexOf('{', at + anchor.length);
  if (bodyAt < 0) throw new Error('函数 ' + name + ' 无花括号体');
  return readBalanced(src, bodyAt).text;
}

function constValue(src, name) {
  const re = new RegExp('(?:^|\\n)const ' + name + '\\s*=');
  const m = re.exec(src);
  if (!m) throw new Error('找不到常量：const ' + name);
  const i = skipWs(src, m.index + m[0].length);
  return readBalanced(src, i);
}

function parseForOf(s, at) {
  const m = /^for \(const (\w+) of \[/.exec(s.slice(at));
  if (!m) return null;
  const arrStart = at + m[0].length - 1;
  const arr = readBalanced(s, arrStart);
  const items = [];
  let k = 1;
  while (k < arr.text.length - 1) {
    k = skipWs(arr.text, k);
    if (arr.text[k] === '"' || arr.text[k] === "'") {
      const st = readStringAt(arr.text, k);
      items.push(st.value);
      k = skipWs(arr.text, st.end);
      if (arr.text[k] === ',') k += 1; else break;
    } else break;
  }
  const hdrOpen = s.indexOf('(', at);
  const hdrEnd = readBalanced(s, hdrOpen).end;
  const bStart = skipWs(s, hdrEnd);
  const body = s[bStart] === '{' ? readBalanced(s, bStart).text : readStatement(s, bStart).text;
  return { param: m[1], items, body, bodyStart: bStart };
}

function forOfBlocks(code) {
  const out = [];
  const re = /for \(const \w+ of \[/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const b = parseForOf(code, m.index);
    if (b) out.push(b);
  }
  return out;
}

function parseScenarios(code) {
  const body = functionBody(code, 'scenarios');
  const scenarios = [];
  const loops = forOfBlocks(body);
  const inLoop = (pos) => loops.some((l) => pos >= l.bodyStart && pos < l.bodyStart + l.body.length);
  for (const loop of loops) {
    const pm = /push\('([^']*)' \+ (\w+)/.exec(loop.body);
    if (!pm) continue;
    const tabM = /tab:\s*'([^']+)'/.exec(loop.body);
    for (const item of loop.items) scenarios.push({ id: pm[1] + item, tab: tabM ? tabM[1] : null });
  }
  const pushRe = /(^|[^.\w$])push\(/g;
  let m;
  while ((m = pushRe.exec(body)) !== null) {
    const callAt = m.index + m[0].length - 1;
    if (inLoop(callAt)) continue;
    const args = readBalanced(body, callAt);
    const a = args.text.slice(1, -1).trim();
    if (a[0] !== '"' && a[0] !== "'") { scenarios.push({ id: null, tab: null, dynamic: true }); continue; }
    const st = readStringAt(a, 0);
    const after = skipWs(a, st.end);
    let tab = null;
    if (a[after] === ',') {
      const objAt = skipWs(a, after + 1);
      if (a[objAt] === '{') {
        const obj = readBalanced(a, objAt).text;
        const tm = /tab:\s*'([^']+)'/.exec(obj);
        if (tm) tab = tm[1];
        else if (/tab:\s*[^'\s]/.test(obj)) tab = '<非字面量>';
      }
    }
    scenarios.push({ id: st.value, tab });
  }
  return scenarios;
}

function parseProbeMinKeys(code) {
  const cv = constValue(code, 'PROBE_MINS');
  const keys = [];
  for (const loop of forOfBlocks(cv.text)) {
    if (/m\[\s*id\s*\]\s*=/.test(loop.body)) keys.push(...loop.items);
  }
  const re = /m\[\s*'([^']+)'\s*\]\s*=/g;
  let m;
  while ((m = re.exec(cv.text)) !== null) keys.push(m[1]);
  return keys;
}

let cache = null;
async function load() {
  if (cache) return cache;
  const raw = fs.readFileSync(AUDIT, 'utf8');
  const code = await codeOnlyOf(raw);
  cache = { raw, code, scenarios: parseScenarios(code), probeKeys: parseProbeMinKeys(code) };
  return cache;
}

// ══════════════════════════════════════════════════════════════════════════
// 解析器自证：解析出的场景数须与真值一致（防「解析静默返回空集 ⇒ 断言恒绿」）
// ══════════════════════════════════════════════════════════════════════════
test('DECL-T0 解析器自证：场景数须 ≥ 30 且每个 id 非空（防解析退化后恒绿）', async () => {
  const { scenarios } = await load();
  assert.ok(scenarios.length >= 30,
    '⛔ 解析只得到 ' + scenarios.length + ' 个场景（期望 ≥30）—— 多半是**解析退化了**，不是场景真的变少');
  const nullIds = scenarios.filter((s) => !s.id).length;
  assert.equal(nullIds, 0, '⛔ 有 ' + nullIds + ' 个 push 的 id 不是字面量（静态不可判定）—— 声明面须可静态判定');
});

test('DECL-A 场景表里每个场景都显式声明 tab（漏一个即红，点名漏了哪个）', async () => {
  const { scenarios } = await load();
  assert.ok(scenarios.length > 0, '前置：场景表须解析出至少 1 个场景');
  const missing = scenarios.filter((s) => !s.tab).map((s) => s.id);
  assert.deepEqual(missing, [],
    '⛔ 以下场景**未显式声明 tab**（' + missing.length + '/' + scenarios.length + ' 个）：' +
    JSON.stringify(missing) +
    ' —— 它们会落到驱动的缺省分支；⛔ 不得依赖缺省值，请在 push(...) 的 extra 里写明 tab。');
});

test('DECL-A1 已声明的 tab 必须是字符串字面量（⛔ 不接受运行期表达式）', async () => {
  const { scenarios } = await load();
  const bad = scenarios.filter((s) => s.tab === '<非字面量>').map((s) => s.id);
  assert.deepEqual(bad, [],
    '⛔ 以下场景的 tab 不是字符串字面量（静态不可判定）：' + JSON.stringify(bad));
});

test('DECL-B PROBE_MINS 覆盖全部场景（漏一个即红，点名漏了哪个）', async () => {
  const { scenarios, probeKeys } = await load();
  assert.ok(probeKeys.length > 0, '前置：PROBE_MINS 须解析出至少 1 个键');
  const keySet = new Set(probeKeys);
  const missing = scenarios.filter((s) => !keySet.has(s.id)).map((s) => s.id);
  assert.deepEqual(missing, [],
    '⛔ 以下场景**未在 PROBE_MINS 声明测点下限**（' + missing.length + '/' + scenarios.length + ' 个）：' +
    JSON.stringify(missing) +
    ' —— 缺声明时 audit 的 probe-min 会把该场景判为 undeclared-scenario；' +
    '⚠ 参数 tab 场景须**显式**写成 0（PARAMS_TAB），⛔ 不能靠「不声明」表达「这里不该有语音块」。');
});

test('DECL-C PROBE_MINS 键集与场景表双向一致（孤儿条目 ⇒ 红）', async () => {
  const { scenarios, probeKeys } = await load();
  const scenSet = new Set(scenarios.map((s) => s.id));
  const dupKeys = [...new Set(probeKeys.filter((k, i) => probeKeys.indexOf(k) !== i))];
  assert.deepEqual(dupKeys, [], '⚠ PROBE_MINS 有重复键：' + JSON.stringify(dupKeys));
  const orphans = [...new Set(probeKeys)].filter((k) => !scenSet.has(k));
  assert.deepEqual(orphans, [],
    '⛔ PROBE_MINS 里存在**场景表里不存在的孤儿条目**：' + JSON.stringify(orphans) +
    ' —— 它们永远不会被任何场景消费（多半是场景改名/删除后忘清理），会掩盖「某场景被删」这一事实。');
});

test('DECL-C1 场景 id 不得重复（重复 ⇒ 后者的下限静默覆盖前者）', async () => {
  const { scenarios } = await load();
  const ids = scenarios.map((s) => s.id);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  assert.deepEqual(dup, [], '⛔ 场景 id 重复：' + JSON.stringify(dup));
});

test('DECL-V1 变异①：删某场景的 tab ⇒ 断言 A 必红（判据有牙）', async () => {
  const { scenarios } = await load();
  assert.ok(scenarios.length >= 2, '前置：至少 2 个场景');
  const victim = scenarios[0];
  assert.ok(victim.tab, '前置：首个场景本来声明了 tab（否则本变异没意义）');
  const mutated = scenarios.map((s, i) => (i === 0 ? { ...s, tab: null } : s));
  const missing = mutated.filter((s) => !s.tab).map((s) => s.id);
  assert.deepEqual(missing, [victim.id],
    '变异后断言 A 的 missing 必须恰为 ' + victim.id + '，实得 ' + JSON.stringify(missing));
});

test('DECL-V2 变异②：删某场景在 PROBE_MINS 的条目 ⇒ 断言 B 必红', async () => {
  const { scenarios, probeKeys } = await load();
  const victim = scenarios[0].id;
  const mutatedKeys = probeKeys.filter((k) => k !== victim);
  assert.notEqual(mutatedKeys.length, probeKeys.length, '前置：该场景本来在 PROBE_MINS 里');
  const keySet = new Set(mutatedKeys);
  const missing = scenarios.filter((s) => !keySet.has(s.id)).map((s) => s.id);
  assert.deepEqual(missing, [victim],
    '变异后断言 B 的 missing 必须恰为 ' + victim + '，实得 ' + JSON.stringify(missing));
});

test('DECL-V3 变异③：往 PROBE_MINS 加不存在的场景 id ⇒ 断言 C 必红', async () => {
  const { scenarios, probeKeys } = await load();
  const ghost = 'ghost-scenario-not-in-table';
  const scenSet = new Set(scenarios.map((s) => s.id));
  assert.ok(!scenSet.has(ghost), '前置：该 id 本来不在场景表里');
  assert.ok(!probeKeys.includes(ghost), '前置：该 id 本来不在 PROBE_MINS 里');
  const orphans = [...new Set(probeKeys.concat([ghost]))].filter((k) => !scenSet.has(k));
  assert.deepEqual(orphans, [ghost],
    '变异后断言 C 的孤儿条目必须恰为 ' + ghost + '，实得 ' + JSON.stringify(orphans));
});

test('DECL-N1 负控：当前树不动 ⇒ 三条断言读数全部干净', async () => {
  const { scenarios, probeKeys } = await load();
  const keySet = new Set(probeKeys);
  const scenSet = new Set(scenarios.map((s) => s.id));
  const noTab = scenarios.filter((s) => !s.tab).map((s) => s.id);
  const noMin = scenarios.filter((s) => !keySet.has(s.id)).map((s) => s.id);
  const orphans = [...new Set(probeKeys)].filter((k) => !scenSet.has(k));
  assert.deepEqual(noTab, [], '负控 A：无漏声明 tab');
  assert.deepEqual(noMin, [], '负控 B：无漏声明下限');
  assert.deepEqual(orphans, [], '负控 C：无孤儿条目');
  assert.ok(scenarios.length >= 20, '场景数读数应在 20 以上，实得 ' + scenarios.length);
});

test('DECL-M1 本文件必须在 package.json 的 scripts.test 清单里', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cmd = String((pkg.scripts && pkg.scripts.test) || '');
  const self = 'test/declaration-lock.test.cjs';
  assert.ok(cmd.split(/\s+/).includes(self),
    '⛔ ' + self + ' 不在 npm test 清单里 ⇒ 本锁永远不会被执行（CHG-198 同族缺陷）');
});
