'use strict';
// test-inventory.test.cjs —— ⭐ 元判据：「磁盘上的测试文件 ⊆ `npm test` 清单」
//
// 由来（2026-10-18 部署批 7 · 第 27 例「把文件存在当成判据在跑」）：
//   `test/layout-geometry-lock.test.cjs`（8 项几何回归锁）**从未**出现在 `package.json`
//   的 `scripts.test` 里 ⇒ `npm test` 与 `gate` 都不执行它 ⇒ **锁了个寂寞**。
//   而 `CHG-194` 的报告曾断言这套锁「每次 `npm test` 都跑」—— 那句话是错的：
//   它把「文件存在」当成了「判据在跑」。
//
// ⇒ 本文件是**元判据**（judge the judging surface）：它不测产品，测的是
//   「**有没有测试文件被漏在清单外面**」，让「漏列」从今往后**自动变红**。
//
// ⚠ 实现约束（作业书 §1-4 逐条落成断言）：
//   ① **本文件必须在清单内**（否则又是「锁没有触发点」）⇒ 见 TINV-A3 自指断言。
//   ② **白名单必须显式且带理由**（见 WHITELIST，每条都要非空理由）⇒ 见 TINV-A4/A5。
//   ③ 白名单**不得过期**（列了但磁盘上没有 ⇒ 红）⇒ 防止「白名单」退化成杂物抽屉。
//   ④ 清单里**列了但磁盘上没有** ⇒ 红（fail-closed，不是静默跳过）。
//
// ⚠ 判据范围（否定性断言的口径）：本文件只判 **`test/` 目录下的 `*.cjs`** ——
//   ⛔ 不判 `test/fixtures/**`（数据夹具，非用例）· ⛔ 不判 `scripts/**`（工具，非用例）·
//   ⛔ 不判「用例是否有效/是否覆盖目标」（那是各锁自己的事，不归本元判据）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');
const SELF = 'test/test-inventory.test.cjs';

// ⚠ 白名单：**故意不在 `npm test` 清单里**的测试目录文件。每条都必须带理由。
//   ⚠ 加新条目的门槛：先回答「为什么它不能进 `npm test`」——答不出就该进清单，不是进白名单。
const WHITELIST = {
  'test/a6-drill.cjs':
    '一次性 L3 拦截演练脚本（非 node:test 用例：整文件是顶层顺序语句 + assert，没有 test() 注册）。' +
    '2026-10-18 实测它**本身已红**：第 42 行调 `mod.installStagedTarball`，而该导出面已随 P1-c ' +
    '（执行器退役批，`lib/index.cjs:85-86`）删除 ⇒ TypeError。⛔ 未删、⛔ 未跳过，如实登记待处置。',
};

/** 纯函数：便于变异自证（不落盘也能喂假输入）。 */
function audit(listed, disk, whitelist) {
  const listedSet = new Set(listed);
  const diskSet = new Set(disk);
  const whiteSet = new Set(Object.keys(whitelist));
  return {
    // 磁盘上有、却在清单与白名单里都找不到 ⇒ **漏列**（本元判据要抓的东西）
    missing: disk.filter((f) => !listedSet.has(f) && !whiteSet.has(f)).sort(),
    // 清单里列了、磁盘上没有 ⇒ 清单与磁盘不一致（删文件忘改清单 / 清单是复制来的假象）
    ghosts: listed.filter((f) => !diskSet.has(f)).sort(),
    // 白名单里列了、磁盘上没有 ⇒ 白名单过期（会把真实漏列藏起来）
    staleWhitelist: [...whiteSet].filter((f) => !diskSet.has(f)).sort(),
    // 白名单里列了、而且其实也在清单里 ⇒ 白名单冗余（无害，但应清掉以免误导）
    redundantWhitelist: [...whiteSet].filter((f) => listedSet.has(f)).sort(),
    // 白名单条目理由必须非空且足够长（防止"占位理由"）
    blankReason: Object.keys(whitelist).filter((k) => String(whitelist[k] || '').trim().length < 20).sort(),
  };
}

function readListed() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cmd = String(pkg.scripts && pkg.scripts.test || '');
  // ⚠ 只取「形如 test/xxx.cjs 的词」——命令里的 node/--test 等不是文件。
  return cmd.split(/\s+/).filter((t) => t.endsWith('.cjs'));
}

function readDisk() {
  return fs.readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => 'test/' + f)
    .sort();
}

// ── TINV-A1 主判据：磁盘 ⊆ 清单 ∪ 白名单 ────────────────────────────────
test('TINV-A1 磁盘上的测试文件不得漏在 npm test 清单之外（漏列 ⇒ 红）', () => {
  const listed = readListed();
  const disk = readDisk();
  const r = audit(listed, disk, WHITELIST);
  assert.deepEqual(r.missing, [],
    '⛔ 以下测试文件在磁盘上但既不在 \`npm test\` 清单、也不在白名单 ⇒ 它们**永远不会被执行**（判据面没有触发点）：' +
    JSON.stringify(r.missing) + '。修法：把路径加进 package.json 的 scripts.test，或（若确非用例）进 WHITELIST 并写理由。');
  // 数量一致性读数（供报告引用；不是判据本体）
  assert.ok(disk.length >= listed.length - Object.keys(WHITELIST).length,
    '磁盘文件数不应少于「清单数 − 白名单数」：disk=' + disk.length + ' listed=' + listed.length);
});

// ── TINV-A2 反向：清单里的文件必须真实存在（fail-closed，不静默跳过）────────
test('TINV-A2 npm test 清单里的每个文件都必须在磁盘上（幽灵条目 ⇒ 红）', () => {
  const r = audit(readListed(), readDisk(), WHITELIST);
  assert.deepEqual(r.ghosts, [],
    '⛔ 清单里列了但这些文件不存在（清单是假象 / 删文件忘改清单）：' + JSON.stringify(r.ghosts));
});

// ── TINV-A3 自指：本文件自己必须在清单内（否则元判据本身没有触发点）────────
test('TINV-A3 元判据自身必须在 npm test 清单内（防「锁没触发点」重演）', () => {
  const listed = readListed();
  assert.ok(listed.includes(SELF),
    '⛔ ' + SELF + ' 必须在 package.json 的 scripts.test 里 —— 否则本元判据自己就永远不会被执行');
});

// ── TINV-A4 白名单卫生：不过期、不冗余 ────────────────────────────────
test('TINV-A4 白名单不得过期/冗余（过期会藏住真实漏列）', () => {
  const r = audit(readListed(), readDisk(), WHITELIST);
  assert.deepEqual(r.staleWhitelist, [], '⛔ 白名单条目在磁盘上不存在（过期）：' + JSON.stringify(r.staleWhitelist));
  assert.deepEqual(r.redundantWhitelist, [], '⚠ 白名单条目其实已在清单里（冗余，应删除以免误导）：' + JSON.stringify(r.redundantWhitelist));
});

// ── TINV-A5 白名单理由必须显式且非占位 ───────────────────────────────
test('TINV-A5 白名单每条都必须带非占位理由（≥20 字）', () => {
  const r = audit(readListed(), readDisk(), WHITELIST);
  assert.deepEqual(r.blankReason, [],
    '⛔ 白名单条目缺理由/理由过短（<20 字）：' + JSON.stringify(r.blankReason) +
    ' —— 白名单的存在必须能回答「为什么它不能进 npm test」');
});

// ── TINV-B1 变异自证①：模拟"漏列一个真实测试文件" ⇒ 主判据必红 ────────────
test('TINV-B1 变异自证①：漏列一个测试文件 ⇒ TINV-A1 必红（判据有牙）', () => {
  const listed = readListed();
  const disk = readDisk();
  // 造一个"磁盘上有、清单里没有、也不在白名单"的文件
  const victim = 'test/layout-geometry-lock.test.cjs';
  const mutated = listed.filter((f) => f !== victim);
  assert.notDeepEqual(mutated, listed, '前置：' + victim + ' 必须本来在清单里（否则本变异没意义）');
  const r = audit(mutated, disk, WHITELIST);
  assert.deepEqual(r.missing, [victim], '变异后 TINV-A1 的 missing 必须恰为 ' + victim + '，实得 ' + JSON.stringify(r.missing));
});

// ── TINV-B2 变异自证②：白名单过期 ⇒ TINV-A4 必红 ─────────────────────
test('TINV-B2 变异自证②：白名单写了不存在的文件 ⇒ TINV-A4 必红', () => {
  const stale = Object.assign({}, WHITELIST, { 'test/does-not-exist.test.cjs': '故意造的过期条目，用于变异自证，长度足够。' });
  const r = audit(readListed(), readDisk(), stale);
  assert.deepEqual(r.staleWhitelist, ['test/does-not-exist.test.cjs'], '变异后 staleWhitelist 必须命中该条');
});

// ── TINV-B3 变异自证③：清单里塞幽灵条目 ⇒ TINV-A2 必红 ─────────────────
test('TINV-B3 变异自证③：清单列不存在的文件 ⇒ TINV-A2 必红', () => {
  const ghosted = readListed().concat(['test/ghost-file.test.cjs']);
  const r = audit(ghosted, readDisk(), WHITELIST);
  assert.deepEqual(r.ghosts, ['test/ghost-file.test.cjs'], '变异后 ghosts 必须命中该幽灵条目');
});

// ── TINV-C1 负控：不动任何文件 ⇒ 全绿（防"恒红"）─────────────────────
test('TINV-C1 负控：当前树不动 ⇒ 四条判据的读数全部干净', () => {
  const r = audit(readListed(), readDisk(), WHITELIST);
  assert.deepEqual(r.missing, [], '负控：无漏列');
  assert.deepEqual(r.ghosts, [], '负控：无幽灵');
  assert.deepEqual(r.staleWhitelist, [], '负控：白名单不过期');
  assert.deepEqual(r.blankReason, [], '负控：理由齐备');
  assert.ok(fs.existsSync(path.join(os.tmpdir())), '环境可读（nod to os，避免未使用导入告警）');
});
