'use strict';
// mutation-ref-lock.test.cjs —— `甲-7` 静态锁：变异自证的基准不得是浮动的 `HEAD`
//
// 由来（`CHG-272` 实测 → `CHG-273` 治定 → `CHG-275` 判定「B5 可关、甲-7 不可关」→ 本文件）：
//   `test/correction-status.test.cjs` 的三条「真实文件级回退变异自证」曾用
//   `git show HEAD:<path>` 取「缺陷原形」当基准。而 `HEAD` 是**浮动**的 —— 那次修复一提交，
//   `HEAD` 就变成修复本身 ⇒ 取到修好形态 ⇒ 前置断言先破 ⇒ 判据**恒红**。
//   现象：提交前全绿、提交后红，**而五环门禁全绿、`FIX-SRC` 也不红**（它只比对夹具字节）。
//   `CHG-273` 把**当次**治好了（改读冻结夹具），但**新写一条自证若再用浮动 HEAD，无人拦**
//   —— 这就是 `甲-7`（`PROJECT.md §12.13.2`）登记的那个「复发面」。
//
// 本文件 = 那道锁的**触发点**。它挂在 `npm test` 上（⛔ 未加第六环，见 `PROJECT.md C-33`）。
//
// ⚠ 覆盖边界（**与脚本头注、`PROJECT.md C-41` 三处同源，改一处须三处同改**）：
//   **抓得住**：① 直接传 `'HEAD'` 字面量 ② 函数默认值浮动 + 调用未传 ref ③ 单层常量间接
//   **抓不住**：④ 多层间接 ⑤ 拼接构造（`'HE'+'AD'`）⑥ 跨文件默认值
//              ⑦ 非 `HEAD` 的浮动 ref（`main`/`origin/main`/`@{u}`）
//              ⑧ 从 git 之外取「当前提交」 ⑨ `HEAD~N`（合法用途在用，拦了即假阳性）
//   ⇒ ⛔ **不得称"这一类问题从此不会再有"**；它挡的是「把浮动 HEAD 当不动基准」这个**具体姿势**。

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');

/** 动态 import（本仓 scripts/lib/*.mjs 是 ESM；测试文件是 CJS）。 */
async function loadLib() {
  return import('../scripts/lib/mutation-ref-lock.mjs');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MRL-1 ⭐ 违规样本 ⇒ 必须红（**这一条就是"锁有没有牙"**）
// ═══════════════════════════════════════════════════════════════════════════════
test('MRL-1 ⭐ 违规样本必须判违规（锁有牙 · 5 种形态）', async () => {
  const lib = await loadLib();
  const st = lib.selfTest();
  const bad = st.results.filter((r) => r.expect === 'violate');
  assert.ok(bad.length >= 5, '自证里至少要有 5 个违规样本（实测 ' + bad.length + '）');
  for (const r of bad) {
    assert.equal(r.got, 'violate',
      '⭐ 违规样本「' + r.name + '」必须判违规，实测=' + r.got + (r.err ? ' err=' + r.err : ''));
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MRL-2 ⭐ 合法样本 ⇒ 必须绿（**防假阳性 —— 与漏报一样糟**）
// ═══════════════════════════════════════════════════════════════════════════════
test('MRL-2 ⭐ 合法样本必须判合法（防假阳性 · 5 种形态）', async () => {
  const lib = await loadLib();
  const st = lib.selfTest();
  const good = st.results.filter((r) => r.expect === 'ok');
  assert.ok(good.length >= 5, '自证里至少要有 5 个合法样本（实测 ' + good.length + '）');
  for (const r of good) {
    assert.equal(r.got, 'ok',
      '⭐ 合法样本「' + r.name + '」必须判合法（假阳性），实测=' + r.got + (r.err ? ' err=' + r.err : ''));
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MRL-3 ⭐ 真实仓扫描：零违规 + 允许清单全部命中（防"清单过期"与"漏报"）
// ═══════════════════════════════════════════════════════════════════════════════
test('MRL-3 ⭐ 真实仓扫描面零违规，且允许清单逐项命中（清单未过期）', async () => {
  const lib = await loadLib();
  const r = lib.scanRepo(ROOT);
  assert.deepEqual(r.violations, [],
    '⭐ 真实仓出现浮动 HEAD 基准（这是真缺陷，须报出而非塞进允许清单）：'
    + JSON.stringify(r.violations, null, 1));
  assert.equal(r.allAllowUsed, true,
    '⭐ 允许清单有未命中项 ⇒ 该条已过期（行号漂移 / 代码被删）⇒ 必须清理，不得留着当杂物抽屉。'
    + '已命中：' + JSON.stringify([...r.usedAllow]));
});

// ═══════════════════════════════════════════════════════════════════════════════
// MRL-4 fail-closed：扫描面不健康 ⇒ 必须抛错（⛔ 不许"扫不到就算过"）
// ═══════════════════════════════════════════════════════════════════════════════
test('MRL-4 fail-closed：扫描面为空 / 异常少 / 解析退化 ⇒ 必须红（5 个反向样本）', async () => {
  const lib = await loadLib();

  // (a) 空扫描面
  assert.throws(() => lib.assertScanSurfaceHealthy({ files: [] }),
    /扫描面为空/, '(a) 0 个文件必须抛错（不得判绿）');

  // (b) 文件数异常少
  assert.throws(() => lib.assertScanSurfaceHealthy({ files: ['a.cjs', 'b.cjs'] }),
    /扫描面异常少/, '(b) 文件数低于下限必须抛错');

  // (c) 总字节异常少（解析退化 / 文件被截断）
  assert.throws(() => lib.assertScanSurfaceHealthy({ files: new Array(20).fill('x'), totalBytes: 1000 }),
    /总字节异常少/, '(c) 总字节低于下限必须抛错');

  // (d) 扫描面缺失（未给 files）
  assert.throws(() => lib.assertScanSurfaceHealthy({}),
    /扫描面缺失/, '(d) 未提供 files 必须抛错');

  // (e) null
  assert.throws(() => lib.assertScanSurfaceHealthy(null),
    /扫描面缺失/, '(e) null 必须抛错');

  // 正控：真实扫描面必须通过（否则就是恒红）
  const r = lib.scanRepo(ROOT);
  assert.equal(lib.assertScanSurfaceHealthy(r), true, '真实扫描面必须通过健康度检查');
});

// ═══════════════════════════════════════════════════════════════════════════════
// MRL-5 扫描面覆盖：真的是 33+ 个测试文件、且**确实扫到了** correction-status
//   （防"扫描面搬走了却仍判绿"—— 那是假绿的一种）
// ═══════════════════════════════════════════════════════════════════════════════
test('MRL-5 扫描面覆盖真实测试面（含 correction-status），非空跑', async () => {
  const lib = await loadLib();
  const r = lib.scanRepo(ROOT);
  assert.ok(r.files.length >= 17, '扫描面文件数应 >= 下限 17，实测 ' + r.files.length);
  const hasCorrection = r.files.some((f) => f === 'test/correction-status.test.cjs');
  assert.equal(hasCorrection, true,
    '⭐ 扫描面**必须**含 `test/correction-status.test.cjs`（三次恒红就出在这个文件）'
    + '——扫不到它 = 扫描面搬走了 = 假绿。实测文件数=' + r.files.length);
  // 该文件确实被扫过：它的允许项之外没有违规（MRL-3 已保证），此处只证"它在面内"
  assert.ok(r.totalBytes > 0, '扫描面总字节应 > 0');
});

// ═══════════════════════════════════════════════════════════════════════════════
// MRL-6 ⚠ 覆盖边界的**正向登记**：已知绕得过去的写法，本锁**故意不拦**
//   这一条不是"测功能"，是**把边界钉在测试面里** —— 防止将来有人以为它全包。
// ═══════════════════════════════════════════════════════════════════════════════
test('MRL-6 ⚠ 覆盖边界登记：已知绕得过的写法，本锁故意不拦（不得据此以为全包）', async () => {
  const lib = await loadLib();

  // ④ 多层间接：A='HEAD'; B=A; f(B) —— 只解析单层，故此处判"不违规"
  // ⚠ 本文件自身也在扫描面内 ⇒ 上面这些样本**不能**把裸 `'HEAD'` 字面量写在代码里
  //   （否则锁会把"描述样本的字符串"当成真违规 —— 那是假阳性）。
  //   ⇒ 用 H 变量拼出 ref 名，既保留样本语义，又不让本文件自己踩锁。
  const H = 'HE' + 'AD';
  const multi = 'const A = ' + JSON.stringify(H) + ';\nconst B = A;\nconst s = gitShow("x.js", B);\n';
  const rMulti = lib.scanSource('__boundary__/multi.cjs', multi);
  // ⚠ 如实登记：多层间接**不会被拦**（这是已知边界，不是 bug）
  assert.ok(Array.isArray(rMulti.violations), '多层间接的扫描结果必须可读（不崩）');

  // ⑤ 拼接构造：'HE'+'AD' —— 字面量匹配看不到
  const concat = 'const s = gitShow("x.js", "HE" + "AD");\n';
  const rConcat = lib.scanSource('__boundary__/concat.cjs', concat);
  assert.equal(rConcat.violations.length, 0,
    '⚠ 如实登记：字符串拼接构造本锁抓不到（覆盖边界的既定形态，⛔ 不是回归）');

  // ⑨ HEAD~N：合法用途在用（dead-code-gate 默认区间），⛔ 不得拦
  const homeN = 'const R = ' + JSON.stringify(H + '~1..' + H) + ';\nconst out = git([\'diff\', \'--unified=0\', R]);\n';
  const rHomeN = lib.scanSource('__boundary__/homeN.cjs', homeN);
  assert.equal(rHomeN.violations.length, 0,
    '⛔ `HEAD~N` 必须放行（dead-code-gate 默认区间就是它，拦了即假阳性）');
});

// ═══════════════════════════════════════════════════════════════════════════════
// MRL-7 允许清单**双重约束**：must 子串不命中 ⇒ 不放行（防行号漂移误放行）
// ═══════════════════════════════════════════════════════════════════════════════
test('MRL-7 允许清单双重约束：行号对但 must 不命中 ⇒ 不放行（安全方向失败）', async () => {
  const lib = await loadLib();
  const H = 'HE' + 'AD';
  const allow = lib.ALLOW.find((a) => a.file === 'test/dead-code-lib-gate.test.cjs');
  assert.ok(allow, '允许清单里必须有 dead-code-lib-gate 那条');

  // 构造：把 must 那一行改成不含 must 的内容，但**行号不变**（模拟行内容漂移）
  const real = fs.readFileSync(path.join(ROOT, allow.file), 'utf8').split('\n');
  const mutated = real.slice();
  mutated[allow.line - 1] = "    const a = runGate(dir, ['--range', 'something-else']);";
  const r = lib.scanSource(allow.file, mutated.join('\n'));
  // 该行已不含 must，但也不含纯 HEAD 字面量 ⇒ 0 违规是可以的；
  // 关键是**不能因为行号对上就放行别的违规**。下面这条才是判据：
  const injected = real.slice();
  injected[allow.line - 1] = '    const a = runGate(dir, ["--range", ' + JSON.stringify(H) + ']); // must 丢失';
  // 去掉 must 子串但保留纯 HEAD 字面量 ⇒ 应判违规（因为放行不生效）
  const r2 = lib.scanSource(allow.file, injected.join('\n'));
  assert.equal(r2.violations.length >= 1, true,
    '⭐ 行号命中但 must 子串不命中 ⇒ 必须**不放行**（否则行号漂移会误放行真违规）。实测违规数=' + r2.violations.length);
});
