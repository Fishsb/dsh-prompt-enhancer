'use strict';
// R5/R6 变异自证回归锁（P2-2 · 2026-10-13）
//
// 病历（本锁要防的形态）：`scripts/dead-code-gate.mjs` 的 R1 只扫 `src/`、R2 只扫 client chunk、
//   R4 只判 `src/host` 与装配清单等值 ⇒ **`lib/**` 曾完全无死代码机检**，`lib/index.cjs` 压着
//   315 行自指死簇（executor 生命周期整段，簇外零调用点）而 **gate 五环全绿**（P2-1 实证）。
//   P2-2 补了 R5（lib 导出面无消费者）+ R6（注入面复长哨兵）。
//
// ⚠ 为什么必须单独锁：判据**存在** ≠ 判据**有牙**。留一个"永远为真"的判据才是改浅
//   （同 A201-3 假绿先例）。本文件把「R5 / R6 必须能真的变红」钉成机检：
//   在**整仓副本**里注入变异 ⇒ 必须 FAIL 且 exit 1；不注入 ⇒ 必须 PASS 且 exit 0。
//
// ⚠ 夹具策略与 `gate-chain-attribution.test.cjs` 同源：整仓副本（临时目录 + git init），
//   绝不碰真实工作区 —— 变异若留在真仓里会把"自证"变成"破坏"。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const EXCLUDE = new Set(['.git', 'node_modules', '.dsh-worktrees', 'test-reports', 'internal']);

/** 整仓副本 + git init（dead-code-gate 默认 range HEAD~1..HEAD，需要 git 元数据） */
function mkFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcg-'));
  fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !EXCLUDE.has(path.basename(src)) });
  const git = (...a) => spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'user.email=t@local', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return dir;
}

function runGate(dir, extra = []) {
  const r = spawnSync(process.execPath, ['scripts/dead-code-gate.mjs', ...extra], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function withFixture(mutate, fn) {
  const dir = mkFixture();
  try {
    if (mutate) mutate(dir);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** R5 的形态：新增一个**零消费者**的导出函数
 *  ⚠ 名字**运行时拼接**，不得写成字面量：本测试文件自身就在 R5 的 `test/**` 语料面内，
 *    若把变异名逐字写进本文件，R5 会把它算成「仅测试覆盖」⇒ **假绿**（实测踩到过：
 *    字面量版 R5 报 PASS / exit 0）。拼接后两个半截都不构成 `\b<name>\b` ⇒ 词界不命中。 */
const R5_MUTANT = 'dcgMut' + 'antProbe';
function injectR5Mutant(dir) {
  const p = path.join(dir, 'lib', 'asr.cjs');
  const s = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, s.replace('module.exports = {',
    'function ' + R5_MUTANT + '() { return 1; }\nmodule.exports = { ' + R5_MUTANT + ','), 'utf8');
}

/** R6 的形态：加回一处**未安全化**的 shell 赋值拼接 */
function injectR6Mutant(dir) {
  const p = path.join(dir, 'lib', 'index.cjs');
  const s = fs.readFileSync(p, 'utf8');
  // ⚠ 变量名同样运行时拼接（同 R5_MUTANT 的理由：防本文件被纳入 R6 扫描面后自证失效）
  const v = 'dcgMut' + 'antR6';
  fs.writeFileSync(p, s.replace('const BODY = fs.readFileSync',
    'const ' + v + ' = \'set "DSH_MUTANT=\' + process.env.X;\nconst BODY = fs.readFileSync'), 'utf8');
}

test('DCG-R5 判据有牙：无消费者的 lib 导出必须变红（正向自证）', () => {
  withFixture(injectR5Mutant, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, 'R5 变异后必须 exit 1（若为 0 则是恒真判据 = 假绿）');
    assert.match(r.out, new RegExp('FAIL \\| R5 \\|[^\\n]*' + R5_MUTANT), 'FAIL 行必须点名变异体');
    assert.match(r.out, /RING-STATE dead-code FAIL/, '状态出口必须同源报 FAIL');
  });
});

test('DCG-R5 负控：不注入变异时 R5 必须 PASS 且环退出 0（防"恒红"）', () => {
  withFixture(null, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 0, '正常态必须 exit 0');
    assert.match(r.out, /PASS \| R5 \|/, 'R5 必须给出 PASS 行');
    assert.match(r.out, /RING-STATE dead-code PASS/, '状态出口必须同源报 PASS');
  });
});

test('DCG-R6 哨兵有牙：未安全化的 shell 赋值拼接必须变红（正向自证）', () => {
  withFixture(injectR6Mutant, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, 'R6 变异后必须 exit 1（若为 0 则哨兵是恒真判据）');
    assert.match(r.out, /FAIL \| R6 \|[^\n]*裸拼 shell 赋值/, 'FAIL 行必须点名裸拼形态');
  });
});

test('DCG-R6 负控：退役态下哨兵必须 PASS（不是"缺席即跳过"）', () => {
  withFixture(null, (dir) => {
    const r = runGate(dir);
    assert.match(r.out, /PASS \| R6 \|/, 'R6 必须给出 PASS 行（哨兵在位，非跳过）');
  });
});

test('DCG-R5b R5 不随 --range 变化（判现状事实，不是判本次 diff）', () => {
  withFixture(null, (dir) => {
    const a = runGate(dir, ['--range', 'HEAD']);
    const b = runGate(dir, []);
    const pickR5 = (o) => (o.match(/R5 \| \d+ 个 lib 导出符号[^\n]*/) || [''])[0];
    assert.ok(pickR5(a.out), '--range HEAD 下必须有 R5 读数');
    assert.equal(pickR5(a.out), pickR5(b.out), 'R5 在两模式下读数必须逐字相同（R1 才是 diff 判据）');
  });
});
