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

function runArch(dir) {
  // ⚠ P2-3 夹具口径：先 --write 让投影与**本夹具环境**对齐，再 --check。
  //   否则得到的是与判据无关的读数漂移（投影为本机生成），不是判据失效。
  spawnSync(process.execPath, ['scripts/arch-claims.mjs', '--write'], { cwd: dir, encoding: 'utf8' });
  const r = spawnSync(process.execPath, ['scripts/arch-claims.mjs', '--check'], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

function runRpc(dir) {
  const r = spawnSync(process.execPath, ['scripts/rpc-manifest.mjs', '--check'], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
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

// ── T3（P2-2 余账）：F-1 盲区回归锁 ——「名字被文本提及」不得算作引用 ──────────────
// 病历：R5 旧口径用 \b<name>\b 全文匹配 ⇒ 注释/字符串里的**名字提及**也算"有消费者"。
//   P2-2 的自证装置就踩过它（变异名写进测试文件 ⇒ R5 判定为"仅测试覆盖" ⇒ 假绿）。
// T3 收紧为「引用形态」（调用/成员/解构/键位）+ **剥注释**。
// ⚠ 本锁用**运行时拼接**造变异名（既有教训：不得写回字面量），且**只在注释里提它的名字**。

test('DCG-R5c T3 盲区已收口：仅注释提及的名字不得算作消费者（正向）', () => {
  const v = 't3Only' + 'CommentMention';
  withFixture((dir) => {
    const p = path.join(dir, 'lib', 'asr.cjs');
    const s = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, s.replace('module.exports = {',
      'function ' + v + '() { return 1; }\nmodule.exports = { ' + v + ','), 'utf8');
    // 只在**注释**里提它的名字（模拟 F-1 场景）
    const q = path.join(dir, 'scripts', 'sync-runtime.mjs');
    const t = fs.readFileSync(q, 'utf8');
    fs.writeFileSync(q, '// ' + v + '（纯注释提及，不构成引用）\n' + t, 'utf8');
  }, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, '仅注释提及 ⇒ 必须仍判红（旧口径会假绿）');
    assert.match(r.out, /FAIL \| R5 \|[^\n]*无引用形态/, 'FAIL 行须给"无引用形态"归因');
  });
});

test('DCG-R5d 反向：真调用形态存在时不得误报（负控）', () => {
  withFixture((dir) => {
    // 造一个**真调用点**：函数定义 + 导出 + 另一文件用 `name(` 调用
    const p = path.join(dir, 'lib', 'asr.cjs');
    const s = fs.readFileSync(p, 'utf8');
    const v = 't3Real' + 'Call';
    fs.writeFileSync(p, s.replace('module.exports = {',
      'function ' + v + '() { return 1; }\nmodule.exports = { ' + v + ','), 'utf8');
    const q = path.join(dir, 'scripts', 'sync-runtime.mjs');
    const t = fs.readFileSync(q, 'utf8');
    fs.writeFileSync(q, t + '\nconst _probe = require("../lib/asr.cjs").' + v + '();\n', 'utf8');
  }, (dir) => {
    const r = runGate(dir);
    assert.doesNotMatch(r.out, /t3RealCall/, '真调用形态存在 ⇒ R5 不得报它（防误报）');
  });
});

// ── RPC 文档真值双向判据回归锁（P2 文档真值批 · 2026-10-13）─────────────────────
// 病历：`scripts/rpc-manifest.mjs` 的文档判据**原是单向的**（只判 `missingInDoc` = 线上有而文档无），
//   **不判反向**（文档有、线上无 = 幽灵）⇒ RPC 退役后文档条目**静默留存**，而门禁五环全绿
//   （CHG-029 一类：用户可读处不得描述不存在的能力）。
// ⚠ 难点：文档**合法地**会出现已退役方法名（历史对照 / 「已退役」说明）⇒ 判据只取
//   「`### host RPC` 小节内、行首 `|` 的表格行」的**第一列反引号名**；blockquote 历史注不判。
// ⚠ 变异名一律**运行时拼接 + 合法小写 RPC 名形态**（两条都是 P2-2 得来的教训：字面量会污染语料面、
//   非法形态会被形态过滤器挡下 ⇒ 自证无效）。

test('RPC-DOC-1 双向判据有牙：文档当前清单里加不存在的方法名 ⇒ 必须 FAIL · exit 1', () => {
  const ghost = 'ghost/' + 'mutant-probe';
  withFixture((dir) => {
    const p = path.join(dir, 'docs', 'compatibility-matrix.md');
    const s = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, s.replace('| `enhance` | client → host | 执行增强 | 用户触发 |',
      '| `enhance` | client → host | 执行增强 | 用户触发 |\n| `' + ghost + '` | client → host | 变异体 | 只读 |'), 'utf8');
  }, (dir) => {
    const r = runRpc(dir);
    assert.equal(r.code, 1, '文档当前清单含幽灵必须 exit 1（若为 0 则是单向判据/恒真）');
    assert.match(r.out, /幽灵条目/, 'FAIL 行必须给"幽灵条目"归因');
    assert.match(r.out, /RING-STATE rpc FAIL/, '状态出口须同源报 FAIL');
  });
});

test('RPC-DOC-2 负控：不注入时双向判据必须 PASS · exit 0（防"恒红"）', () => {
  withFixture(null, (dir) => {
    const r = runRpc(dir);
    assert.equal(r.code, 0, '正常态必须 exit 0');
    assert.match(r.out, /双向/, '须打印双向判据读数');
    assert.match(r.out, /RING-STATE rpc PASS/, '状态出口须同源报 PASS');
  });
});

test('RPC-DOC-3 历史条目不误报：幽灵名只出现在 blockquote 历史注 ⇒ 不得报错', () => {
  const ghost = 'ghost/' + 'historic-only';
  withFixture((dir) => {
    const p = path.join(dir, 'docs', 'compatibility-matrix.md');
    const s = fs.readFileSync(p, 'utf8');
    // 放进 blockquote 历史注（行首 `>`）—— 合法历史对照形态
    fs.writeFileSync(p, s.replace('> ⚠ **历史**（**已退役，不再注册**）：',
      '> ⚠ **历史**（**已退役，不再注册**）：\n> · `' + ghost + '`（变异体，仅历史说明）·'), 'utf8');
  }, (dir) => {
    const r = runRpc(dir);
    assert.equal(r.code, 0, '历史注里的旧方法名不得被误报为幽灵（否则历史对照与判据直接冲突）');
    assert.doesNotMatch(r.out, /幽灵条目/, '不得出现幽灵归因');
  });
});

// ── A230-1/A230-5 拆分判据回归锁（P2-3 拆分批 · 2026-10-13）──────────────────────
// 病历：A230-1 原判「**单文件内**域行区间之和 == lines('lib/index.cjs') 且连续无缝」。
//   P2-3 拆域后该判据对象**整体消失**（域不再共享一个文件的行空间）⇒ 改判为
//   **文件级等值集**（`lib/` 磁盘 .cjs == 声明的域清单，多一件即 FAIL）+ **拆分产物无孤儿**
//   （A230-5：每个域模块必须被入口 require 接线）。牙齿**同等或更强**（多出"文件级孤儿"面）。
// ⚠ 变异名一律**运行时拼接 + 合法 `.cjs` 名形态**（判据的合法输入）——两条都是 P2-2/P2-2余账
//   得来的教训：字面量会污染被测语料面（假绿），非法形态会被形态过滤器挡下（自证失效）。
// ⚠ 夹具须 `git init`（S-8 行尾契约需要 git 元数据）且先 `--write` 对齐本环境的投影，
//   否则得到的是**与判据无关的读数漂移**（实测踩到过），不是判据失效。

test('A230-1 等值集有牙：lib/ 出现未声明的域文件 ⇒ 必须 FAIL · exit 1', () => {
  const mut = 'z' + 'zmutant.cjs';
  withFixture((dir) => {
    fs.writeFileSync(path.join(dir, 'lib', mut), "'use strict';\nmodule.exports = {};\n");
  }, (dir) => {
    const r = runArch(dir);
    assert.equal(r.code, 1, '未声明的 lib/*.cjs 必须 exit 1（若为 0 则等值集判据失效）');
    assert.match(r.out, /A230-1/, 'FAIL 必须点名 A230-1');
    assert.match(r.out, /未声明（多一件）/, 'FAIL 必须给"未声明"归因');
  });
});

test('A230-5 孤儿有牙：域模块声明了却未被入口 require ⇒ 必须 FAIL · exit 1', () => {
  withFixture((dir) => {
    // 文件在磁盘 + 两处清单都声明 + 入口**不** require ⇒ 必须报"未接线"
    fs.writeFileSync(path.join(dir, 'lib', 'zzwire.cjs'), "'use strict';\nmodule.exports = {};\n");
    const ac = path.join(dir, 'scripts', 'arch-claims.mjs');
    const t = fs.readFileSync(ac, 'utf8')
      .replace("  'client.cjs':", "  'zzwire.cjs': '变异：声明但未接线',\n  'client.cjs':")
      .replace("'rpc-voice.cjs'];", "'rpc-voice.cjs', 'zzwire.cjs'];");
    fs.writeFileSync(ac, t, 'utf8');
  }, (dir) => {
    const r = runArch(dir);
    assert.equal(r.code, 1, '声明却未接线必须 exit 1（孤儿模块）');
    assert.match(r.out, /A230-5/, 'FAIL 必须点名 A230-5');
    assert.match(r.out, /未接线/, 'FAIL 必须给"未接线"归因');
  });
});

test('A230-1/A230-5 负控：不注入时两判据必须 PASS · exit 0（防"恒红"）', () => {
  withFixture(null, (dir) => {
    const r = runArch(dir);
    assert.equal(r.code, 0, '正常态必须 exit 0');
    assert.doesNotMatch(r.out, /✗ A230-1/, 'A230-1 不得为红');
    assert.doesNotMatch(r.out, /✗ A230-5/, 'A230-5 不得为红');
  });
});
