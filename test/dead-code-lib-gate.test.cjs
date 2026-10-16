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
// ⚠ 契约面收口批（2026-10-17 · 第 ② 件）：本文件两处 chunk 解码副本收敛到共享单一事实源。
//   ⚠ 取具名成员解构（`require()` 一个 ESM 模块拿到命名空间对象，不可直接调用 —— 实测）。
const { decodeChunkText } = require('../scripts/lib/chunk-decode.mjs');

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

// ── P2 复核处置批回归锁（2026-10-13）────────────────────────────────────────────
// 病历（复核 F1/F2/F8）：R5 的 `TARGETS` 与 R6 的 `INJECTION_FILES` 曾是**硬编码清单**，
//   与 A230-1 的声明清单三份互不相等且无锁 ⇒ 新建 `lib/<新文件>.cjs` 后**两张网都不覆盖它**
//   （死码 / 注入面复长全链不可观测）。S-6 同形（只读 `lib/index.cjs`，引回别的文件不报）。
// ⇒ 三条均已改为 `lib/` 全枚举派生；以下锁把"新文件必须入网"固化成机检。
// ⚠ 变异名一律**运行时拼接 + 合法 `.cjs` 名形态**（P2-2 / P2-2余账 / P2-3 三度教训）。

test('R5/R6 派生面有牙：新建 lib/<新文件>.cjs 后，R5 与 R6 都必须覆盖到它', () => {
  const mut = 'zz' + 'probe-lock.cjs';          // 运行时拼接
  const fn = 'zzLock' + 'Export';                // 运行时拼接
  withFixture((dir) => {
    fs.writeFileSync(path.join(dir, 'lib', mut),
      `'use strict';\nfunction ${fn}() { return 1; }\nmodule.exports = { ${fn} };\nconst c = 'schtasks /create';\n`);
  }, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, '新 lib 文件必须被门禁覆盖（否则 R5/R6 有硬编码盲区）');
    assert.match(r.out, new RegExp('R5 \\| lib/' + mut.replace('.', '\\.')), 'R5 必须扫到新文件');
    assert.match(r.out, new RegExp('R6 \\| lib/' + mut.replace('.', '\\.')), 'R6 必须扫到新文件');
  });
});

test('S-6 牙齿已扩到 lib/** ：在非 index.cjs 的文件里引回 RESTART_FILES 必须被判', () => {
  withFixture((dir) => {
    const p = path.join(dir, 'lib', 'sys.cjs');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + "\nconst RESTART_FILES = ['zz-nonexistent-lock.js'];\n", 'utf8');
  }, (dir) => {
    const r = runArch(dir);
    assert.equal(r.code, 1, 'lib/sys.cjs 里的不自洽 RESTART_FILES 必须被判红（原只读 index.cjs ⇒ 假绿）');
    assert.match(r.out, /S-6/, 'FAIL 必须点名 S-6');
  });
});

// ── S-9 / 排除集回归锁（P2 窄复核处置批 2026-10-13 · F-1）────────────────────────────
// 病历：`libTargets()` 的**排除集**曾是单点可漂移 —— 多排除一个真实手改模块 ⇒
//   R5 覆盖 83→65 符号、R6 12→11，而 `gate` 绿、`A230-1` 绿、上一批两条回归锁也绿 ⇒ 全链零红。
//   上一批的锁只验「**新文件是否入网**」，**恰恰漏了「排除集被偷偷扩大」**这一形态。
// ⇒ 本条补上：**被排除件必须件件有构建脚本写盘点**（无写盘点 = 偷排除）。
// ⚠ 同时保留「新文件自动入网」的验证（两形态都锁住）。
test('S-9 排除集不可漂移：偷排除一个真实手改模块 ⇒ arch-claims 必红并点名 S-9', () => {
  const victim = 'platform-' + 'service.cjs';   // 运行时拼接（合法模块名）
  withFixture((dir) => {
    const p = path.join(dir, 'scripts', 'lib', 'lib-manifest.mjs');
    const s = fs.readFileSync(p, 'utf8');
    const before = s;
    const after = s.replace('  if (derived.size > 0) return [...derived].sort();',
      "  derived.add('" + victim + "');\n  if (derived.size > 0) return [...derived].sort();");
    if (after === before) throw new Error('S-9 变异未生效（锚点漂移）');
    fs.writeFileSync(p, after, 'utf8');
  }, (dir) => {
    const r = runArch(dir);
    assert.equal(r.code, 1, '偷排除手改模块必须 exit 1（原：全链零红）');
    assert.match(r.out, /S-9/, 'FAIL 必须点名 S-9');
    assert.match(r.out, new RegExp('偷排除: ' + victim.replace('.', '\\.')), 'FAIL 必须点出被偷排除的文件');
  });
});

test('S-9 负控：不动任何东西 ⇒ S-9 PASS 且 R5/R6 覆盖面为基线（76/12）', () => {
  withFixture(null, (dir) => {
    const r = runArch(dir);
    assert.equal(r.code, 0, '基线必须 exit 0');
    assert.doesNotMatch(r.out, /✗ S-9/, 'S-9 不得为红');
    const g = runGate(dir);
    // P3-2c（2026-10-14）：基线 83 → **81**（逐项可归因：`lib/sys.cjs` 的 `mergedEnv` 与
    //   `mergeEnvPath` 随 env 合并肢体退役 ⇒ 各减 1；R6 仍 12，未变）。
    //   ⚠ 本断言锁的是「**基线不被静默扩大/缩小**」，故数值须随**合法退役**同步（并在此写明来历）；
    //     它**不是**判据阈值，改它与「把判据改浅」无关。
    // P3-2d（2026-10-14）：基线 81 → **79**（逐项可归因：`lib/sys.cjs` 的
    //   `isEnvcheckBlocked` 与 `runProbe` 随探针肢体收口退役 ⇒ 各减 1；生产在用 29→29 不变，
    //   仅测试覆盖 52→50；R6 仍 12，未变）。
    //   ⚠ 本断言锁的是「**基线不被静默扩大/缩小**」，故数值须随**合法退役**同步（来历写明于此）；
    //     它**不是**判据阈值，改它与「把判据改浅」无关。
    // CHG-117（2026-10-16 · 规整改造批）：基线 79 → **76**（逐项可归因：`lib/asr.cjs` 的
    //   `transcribe` / `refineText` / `setLlm` 三个导出**随旧规整 LLM 链整体退役** ⇒ 各减 1；
    //   生产在用 27 / 仅测试覆盖 49 **均未变**（退役的 3 个本就只在测试面有引用形态）。
    //   ⚠ 本断言锁的是「**基线不被静默扩大/缩小**」，故数值须随**合法退役**同步（来历写明于此）；
    //     它**不是**判据阈值，改它与「把判据改浅」无关。
    assert.match(g.out, /R5 \| 76 个 lib 导出符号/, 'R5 覆盖面须为基线 76 符号（CHG-117 后）');
    assert.match(g.out, /R6 \| 12 个系统面文件/, 'R6 覆盖面须为基线 12 文件');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D-10 修正批（2026-10-14）：剥注释器不得吞掉真实代码
//
// 病历：`arch-claims.mjs` 与 `dead-code-gate.mjs` 曾各自内联同一行「先剥块注释、再剥行注释」的
//   朴素剥离器。任何「块注释起点符号」都被当作块注释起点 ⇒ **行注释里出现的该符号**
//   （`update/*` / `src/host/**` / `lib/*.cjs` 等极常见形态）会被误当块注释**开头**，
//   于是从该处起、直到后面某个「块注释结束符」为止的整段（**含真实代码**）被整体剥掉。
//   实测：`lib/sys.cjs` 一条注释曾吞掉 **453 字符**，其中含 `return new Function(pureText + …)`
//   这一**真实代码行** ⇒ `A197-3` / `R5` / `R6` 对该区段**失明**（「让失败不可观测」类缺陷）。
//   ⚠ 上文刻意**不写出**那两个字面符号 —— 否则本注释自身会被同一缺陷吃掉（自指陷阱）。
//
// 本组用例锁「修好之后不再吞」以及「修的是实现、不是判据」。
// ══════════════════════════════════════════════════════════════════════════════

test('D-10(a)：行注释里的块注释起点符号不得吞掉其后真实代码（三处消费者同源）', async () => {
  const { codeOnly } = await import(path.join(ROOT, 'scripts', 'lib', 'code-only.mjs'));
  // ⚠ 夹具的**判别力**来自「其后存在一个真的块注释结束符」——
  //   旧实现会把「行注释里的起点符号」当作块注释开头，一路吞到那个结束符（含中间真实代码）；
  //   若夹具里没有结束符，旧实现同样不吞 ⇒ 用例无牙（本批首版即此坑，见报告 §④）。
  const S = String.fromCharCode(47);       // '/'
  const STAR = '*';
  const src = [
    '// 见 update' + S + STAR + ' RPC 说明',
    'const REAL_BETWEEN = 1;',
    'function alsoReal() { return REAL_BETWEEN; }',
    '/* 后续真块注释 */',
    'const AFTER_BLOCK = 2;',
  ].join('\n');
  const out = codeOnly(src);
  assert.ok(out.includes('const REAL_BETWEEN = 1;'),
    'D-10 本体：行注释含起点符号时，其后（直到下一个块结束符为止）的真实代码必须仍被计入');
  assert.ok(out.includes('function alsoReal()'),
    'D-10 本体：被误吞区间内的后续真实代码同样必须保留');
  assert.ok(out.includes('const AFTER_BLOCK = 2;'),
    '块注释之后的真实代码不受影响');
  assert.ok(!out.includes('update'),
    '该行注释本身仍应被剥掉（不是「整行保留」蒙混）');
  assert.ok(!out.includes('后续真块注释'),
    '那个真块注释仍应被剥掉');
});

test('R-1(d1)：单行内闭合的块注释（含其中含 //）不得吞掉其后真实代码', async () => {
  const { codeOnly } = await import(path.join(ROOT, 'scripts', 'lib', 'code-only.mjs'));
  // ⚠ 夹具的**判别力**来自 R-1 的失效机制，须同时具备四个要素（D-14 病历：缺一即假锁）：
  //   ① 一个**单行内闭合**的块注释；② 其中含 `//`；③ 其后**紧跟真实代码**；
  //   ④ 再后面**另有一个真块注释**（提供后续块结束符 —— 缺它则"先逐行后块"顺序同样不吞 ⇒ 用例无牙）。
  const S = String.fromCharCode(47);  // '/'
  const src = [
    S + '*' + ' note ' + S + S + ' more *' + S + ' const REAL_SAME_LINE = 1;',
    'const ALSO_REAL = 2;',
    S + '*' + ' 后续真块注释 *' + S,
    'const AFTER_BLOCK = 3;',
  ].join('\n');
  const out = codeOnly(src);
  assert.ok(out.includes('const REAL_SAME_LINE = 1;'),
    'R-1 本体：单行闭合块注释（内含行注释符）之后的**同行**真实代码必须保留');
  assert.ok(out.includes('const ALSO_REAL = 2;'),
    'R-1 本体：其后**下一行**的真实代码必须保留（现行顺序会从残留的未闭合起点一路吞到这里）');
  assert.ok(out.includes('const AFTER_BLOCK = 3;'),
    '真块注释之后的真实代码不受影响');
  assert.ok(!out.includes('note'),
    '该块注释本身仍应被剥掉（不是「整块保留」蒙混）');
  assert.ok(!out.includes('后续真块注释'),
    '那个真块注释仍应被剥掉');
});

test('R-1(b2)：跨行块注释的“行注释符与闭合符同行”不得吞掉其后真实代码', async () => {
  const { codeOnly } = await import(path.join(ROOT, 'scripts', 'lib', 'code-only.mjs'));
  // ⚠ 本形态是选用「单趟扫描」而非「先同行块 → 再行注释 → 再跨行块」三步顺序的**依据**：
  //   三步顺序在第一步「同行闭合块」匹配不到本形态（块**跨行**），随后第二步把 `// */ const REAL`
  //   连同**闭合符**一起剥掉 ⇒ 留下未闭合 `/*` ⇒ 第三步一路吞到下一个结束符。
  //   ⇒ 本用例把「单趟扫描严格优于建议的三步顺序」钉成机检（否则该优势只存在于实现者的偏好里）。
  const S = String.fromCharCode(47);  // '/'
  const src = [
    S + '*' + ' start',
    ' ' + S + S + ' *' + S + ' const REAL_AFTER_INLINE_CLOSE = 1;',
    'const NEXT_LINE_REAL = 2;',
    S + '*' + ' 尾部真块 *' + S,
    'const TAIL = 3;',
  ].join('\n');
  const out = codeOnly(src);
  assert.ok(out.includes('const REAL_AFTER_INLINE_CLOSE = 1;'),
    '跨行块注释的闭合符与行注释符同行时，闭合符**之后**的真实代码必须保留');
  assert.ok(out.includes('const NEXT_LINE_REAL = 2;'),
    '其后下一行的真实代码必须保留');
  assert.ok(out.includes('const TAIL = 3;'),
    '尾部真块注释之后的真实代码不受影响');
  assert.ok(!out.includes('start'), '该跨行块注释本身仍应被剥掉');
});

test('D-10(b)：真正的跨行 /* … */ 块注释仍须被剥离（防修 (a) 时漏剥块注释）', async () => {
  const { codeOnly } = await import(path.join(ROOT, 'scripts', 'lib', 'code-only.mjs'));
  const src = [
    '/*',
    ' 多行块注释',
    ' const FAKE = 1;',
    ' */',
    'const REAL = 2;',
  ].join('\n');
  const out = codeOnly(src);
  assert.ok(!out.includes('FAKE'), '跨行块注释内容必须被剥（含其中的代码样文本）');
  assert.ok(out.includes('const REAL = 2;'), '块注释之后的真实代码必须保留');
});

test('D-10 回归锁：被吞形态若复现，判据读数会立刻变化（端到端有牙）', () => {
  // 端到端：在整仓副本的 lib/sys.cjs 注入「行注释含起点符号 + 其后真实代码 + 一个真块注释」，
  // 断言 A197-5 能**如实**数到该真实代码（旧剥离器会因吞噬而漏计 ⇒ 读数不可信）。
  withFixture((dir) => {
    const p = path.join(dir, 'lib', 'sys.cjs');
    const S = String.fromCharCode(47);
    const marker = '\n// D-10 注入：见 update' + S + '*' + ' RPC\n'
      + 'const __d10_probe = new Function("return 1");\n'
      + '/* 尾部真块注释（提供块结束符，使旧实现真的吞掉上面那行） */\n';
    fs.appendFileSync(p, marker, 'utf8');
  }, (dir) => {
    const r = runArch(dir);
    assert.equal(r.code, 1, '注入入口外第二处 new Function 必须 exit 1');
    assert.match(r.out, /A197-5/, 'FAIL 必须点名 A197-5');
    assert.match(r.out, /lib\/sys\.cjs/, 'A197-5 必须数到 lib/sys.cjs 那一处（旧剥离器会吞掉它）');
  });
});

// ── R7 client chunk 导出契约（源码层）+ 产物可求值性（产物层）回归锁 ──────────────
// 病历（2026-10-17 · 线上事故收口批 · 承 CHG-143）：`src/client/voice/correction.js`
//   以**裸 JS** 提交（其余 23 个 client chunk 写 `module.exports = "…"`）⇒ build-client 把对象
//   字符串化成 `[object Object]` 注进 `lib/client.cjs` ⇒ 浏览器求值抛
//   `Unexpected identifier 'Object'` ⇒ **整个 client 半部装载失败**，而 npm test 467 /
//   gate 5 环 / 三 --check **一条都没盖住**。
// ⚠ 本锁把「R7 必须能真的变红（两层）+ 不动时必须绿 + fail-closed」钉成机检。

/** 把 chunk 文件解码回**其源码原文**。
 *  ⚠ 契约面收口批（2026-10-17 · 第 ② 件）：原为第 7 份**同契约异名副本**
 *  （`/module\.exports\s*=\s*"([\s\S]*)";?\s*$/` + `assert.ok` + `JSON.parse`），
 *  已改为委托共享单一事实源（`scripts/lib/chunk-decode.mjs`）—— 取值不变、点名声更强。 */
function decodeChunkFile(abs) {
  return decodeChunkText(fs.readFileSync(abs, 'utf8'), abs);
}
/** 把 chunk 文件**改回裸 JS**（本次事故的真实形态）。⚠ 只在整仓副本内调用。 */
function unwrapChunkToBareJs(dir, rel) {
  const abs = path.join(dir, rel);
  fs.writeFileSync(abs, decodeChunkFile(abs), 'utf8');
}

test('R7 变异自证（源码层）：任一 chunk 改回裸 JS ⇒ R7 必红且点名该文件', () => {
  // ⚠ **任取一个** chunk（不是只有 correction.js）⇒ 证明覆盖面是「每个 chunk」而非「某文件」
  const rel = 'src/client/voice/' + 'recorder' + '.js'; // 运行时拼接，避免本文件被误当成实现点位
  withFixture((dir) => unwrapChunkToBareJs(dir, rel), (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, '源码层契约违反必须 exit 1（若为 0 则 R7 是恒真判据 = 假绿）');
    assert.match(r.out, /FAIL \| R7 \|[^\n]*recorder\.js/, 'R7 必须点名违规 chunk');
    assert.match(r.out, /导出形态违反/, 'R7 必须说明是导出形态（不是别的理由）');
  });
});

test('R7 变异自证（产物层）：源码全对、仅产物被对象字符串化 ⇒ R7 必红且点名产物', () => {
  withFixture((dir) => {
    // 只在**产物**里注入 [object Object]，源码一个字节不动 ⇒ 隔离产物层
    const p = path.join(dir, 'lib', 'client.cjs');
    const s = fs.readFileSync(p, 'utf8');
    const anchor = 'var correctionState = {';
    assert.equal(s.split(anchor).length - 1, 1, '夹具前置：产物内应恰有 1 处该锚点');
    fs.writeFileSync(p, s.replace(anchor, 'var correctionState = [object Object];'), 'utf8');
  }, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, '产物层污染必须 exit 1（R2 只看源码 ⇒ 只能由 R7 咬住）');
    assert.match(r.out, /FAIL \| R7 \|[^\n]*\[object Object\]/, 'R7 必须点名污染计数（不是只报"求值失败"）');
  });
});

test('R7 负控：不动任何文件 ⇒ R2/R7 均 PASS 且 exit 0（防"恒红"）', () => {
  withFixture(null, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 0, '正常态必须 exit 0');
    assert.match(r.out, /PASS \| R7 \|/, 'R7 必须给出 PASS 行（不是"缺席即跳过"）');
    assert.match(r.out, /PASS \| R2 \|/, 'R2 必须给出 PASS 行');
  });
});

test('R7 fail-closed：产物缺位 / chunk 目录缺位 ⇒ FAIL，不得静默回退判绿', () => {
  // ① 产物缺位
  withFixture((dir) => { fs.rmSync(path.join(dir, 'lib', 'client.cjs')); }, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, '产物缺位必须 exit 1（不得"没有就不判"）');
    assert.match(r.out, /FAIL \| R7 \|[^\n]*产物缺位/, 'R7 必须报产物缺位');
  });
  // ② chunk 目录缺位（解析不出清单）
  withFixture((dir) => { fs.renameSync(path.join(dir, 'src', 'client'), path.join(dir, 'src', 'client-moved')); }, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, '扫描面缺位必须 exit 1（不得判绿）');
    assert.match(r.out, /FAIL \| R2 \|[^\n]*目录缺位/, 'R2 必须报目录缺位');
  });
});

test('R2 fail-closed（H2 活例修复）：读不出包裹的 chunk 不得再静默回退到原文而报 PASS', () => {
  // 病历：原实现 `strip(mm ? JSON.parse(…) : raw)` ⇒ 裸 JS chunk 被当成 chunk 源码正常扫描
  //   ⇒ 照常打 `PASS | 24 个 client chunk …`（读者 grep PASS 得到假读数）。
  const rel = 'src/client/voice/' + 'filler' + '.js';
  withFixture((dir) => unwrapChunkToBareJs(dir, rel), (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, '契约违反必须 exit 1');
    assert.match(r.out, /FAIL \| R2 \|[^\n]*读不出 chunk 导出契约/, 'R2 必须显式报契约读取失败');
    // ⚠ 关键：不得同时出现同一规则的 PASS 行（那正是本次事故的"读数看起来是绿的"）
    assert.doesNotMatch(r.out, /PASS \| R2 \|/, 'R2 有契约违反时不得再打 PASS 行（防假读数）');
  });
});

test('R7 覆盖面（host 面同族）：src/host 的 chunk 也在契约门内 ⇒ 改回裸 JS 必红', () => {
  // ⚠ host 面**实读为同族**：5 个 chunk 全部写 `module.exports = "…"` 同一契约，
  //   且 build-host.mjs 用同一 `body.replace(marker, chunk)` 注入 ⇒ 一并纳入。
  const rel = 'src/host/' + 'diagnostics' + '.js'; // 运行时拼接（同既有纪律）
  withFixture((dir) => {
    const abs = path.join(dir, rel);
    // ⚠ 第 8 处同契约副本（本批收敛）：改用共享解码器，取值不变（本批实测 29 chunk 上
    //   loose/anchored 两形态逐字同值）、点名声更强。
    fs.writeFileSync(abs, "'use strict';\n" + decodeChunkText(fs.readFileSync(abs, 'utf8'), rel), 'utf8');
  }, (dir) => {
    const r = runGate(dir);
    assert.equal(r.code, 1, 'host chunk 契约违反必须 exit 1（不得只盯 client）');
    assert.match(r.out, /FAIL \| R7 \|[^\n]*src\/host\/diagnostics\.js/, 'R7 必须点名 host 违规 chunk');
  });
});
