'use strict';
// I4（2026-09-27）：**下探失败被归因成「链 0 环」** 的回归锁。
//
// 病历：\`scripts/arch-claims.mjs\` 的 B234-1 在编排器形态下探失败时取到零环，读数写成
//   「链 0 环（源 package.json）｜未点名 无｜点名却缺席 5 件」——**红是真的，指向是错的**：
//   读者会去 package.json / 点名面找一个并不存在的问题，而真凶在下探面（入口脚本里没有
//   \`scripts/<名>.mjs\` 字面量）。“点名却缺席 5 件”是零环的**算术后果**，不是一条发现。
//
// 本文件把验收三条钉成机检（夹具在临时仓副本里造，绝不碰真实工作区）：
//   ① 入口脚本用**变量拼接**调用各环 → 报错消息指向**入口脚本**，不指向 package.json；
//   ② 正常态仍绿；
//   ③ 删环负控仍红（点名面负控不得被这次改动放跑）。
// 另加两条同族归因的护栏：入口不在位（指向被点名的入口）、命令面认不出入口（如实说「认不出」，不猜路径）。
//
// ⚠ 为什么用**整仓副本**而不是就地造夹具：B234-1 与 S-8（行尾契约）判的是\`package.json\`与\`git ls-files\`，
//   在真仓里改它们等于边验边破坏被测对象。副本 = 临时目录 + \`git init\`（S-8 需要 git 元数据），
//   跑完即删；副本里只读原脚本，故本测试同时验证“换一个仓、同一脚本仍给出同一归因”。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const EXCLUDE = new Set(['.git', 'node_modules', '.dsh-worktrees', 'test-reports']);
const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

/** 整仓副本（排除 .git/node_modules/工作树/报告），并 \`git init\`+提交一次——S-8 的行尾判据需要 git 元数据 */
function mkFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcat-'));
  fs.cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => !EXCLUDE.has(path.basename(src)),
  });
  const git = (...a) => spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'user.email=t@local', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return dir;
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

/** 跑被测脚本（副本为 cwd；脚本本身逐字节就是仓里那份） */
function runClaims(dir) {
  const r = spawnSync(process.execPath, ['scripts/arch-claims.mjs', '--check'], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

/** B234-1 的「实测」行——归因面的唯一取证点（不断言整段输出，避免别的判据的文本串进来） */
function readingRow(out) {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => /B234-1\s+\S+\s+门禁链收敛为一条命令/.test(l));
  assert.ok(i >= 0, 'B234-1 未出现在输出里（格式变了？本测试的取证点需同步）');
  const row = lines.slice(i).find((l) => l.trimStart().startsWith('实测 '));
  assert.ok(row, 'B234-1 没有「实测」行（判据格式变了？）');
  return row.trim();
}

function editJson(file, fn) {
  const o = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(o);
  fs.writeFileSync(file, JSON.stringify(o, null, 2) + '\n');
}

/** 夹具：入口脚本**用变量拼接**调用各环——即 I4 说的「下探解析失败」形态。
 *  各环名仍出现在文件里，但**不是** \`scripts/<名>.mjs\` 字面量（拼接后才成形），故下探取不到环。 */
function makeVariableConcatEntry(dir) {
  const entry = path.join(dir, 'scripts', 'gate.mjs');
  fs.writeFileSync(entry, [
    '#!/usr/bin/env node',
    '// 夹具（I4）：入口**用变量拼接**调用各环 —— 下探面取不到 \`scripts/<名>.mjs\` 字面量。',
    "import { spawnSync } from 'node:child_process';",
    "const DIR = 'scripts/';",
    "const RINGS = ['dead-code-gate', 'rpc-manifest', 'sync-prompts', 'arch-claims', 'card-arch-consistency'];",
    'for (const name of RINGS) {',
    "  const file = DIR + name + '.mjs';",
    "  const r = spawnSync(process.execPath, [file, '--check'], { stdio: 'inherit' });",
    '  if (r.status !== 0) process.exitCode = r.status;',
    '}',
    '',
  ].join('\n'));
  const pkg = path.join(dir, 'package.json');
  editJson(pkg, (o) => { o.scripts.gate = 'node scripts/gate.mjs'; });
  return entry;
}

test('GCAT-1 正常态仍绿：编排器形态下探成功 → 5 环、exit 0、读数不含「0 环」', { skip: !hasGit && 'git 不可用' }, () => {
  const { code, out } = withFixture(null, runClaims);
  const row = readingRow(out);
  assert.equal(code, 0, '正常态应 exit 0（冲突 0）：\n' + out);
  assert.match(row, /链 5 环/, '正常态读数应是 5 环');
  assert.doesNotMatch(row, /链 0 环/, '正常态不得出现零环措辞');
});

test('GCAT-2 夹具 I4：入口用变量拼接调用各环 → 红，且归因指向入口脚本而非 package.json', { skip: !hasGit && 'git 不可用' }, () => {
  const { code, out } = withFixture(makeVariableConcatEntry, runClaims);
  const row = readingRow(out);
  assert.equal(code, 1, '夹具必须判红（fail-closed）——零环不得静默取空集：\n' + out);
  assert.match(row, /编排器入口解析到 0 环/, '应给出区分性的零环归因');
  assert.ok(row.includes('scripts/gate.mjs'), '归因必须点名入口脚本：' + row);
  assert.ok(!row.includes('package.json'), '归因不得把读者引向 package.json（I4 的原始错误）：' + row);
  assert.ok(!row.includes('点名却缺席'), '零环时不得把算术后果写成点名面结论：' + row);
});

test('GCAT-3 归因面判别力自证（负控）：I4 的旧读数形状必须被 bad 形状判据抓住', { skip: !hasGit && 'git 不可用' }, () => {
  // 形状判据（即本次修复要关掉的那句话）：零环 + 源指向 package.json
  const BAD = /链 0 环[\s\S]{0,60}源 package\.json/;
  const oldShape = '实测 链 0 环（源 package.json）｜未点名 无｜点名却缺席 5 件｜重复 无｜链序单调 true｜实装 --check 却未带旗 无';
  assert.match(oldShape, BAD, '负控失败：形状判据连旧读数都抓不住 ⇒ 这条判据是空转的');
  const { code, out } = withFixture(makeVariableConcatEntry, runClaims);
  assert.equal(code, 1);
  assert.doesNotMatch(readingRow(out), BAD, '新读数仍在用旧形状（红给对了、话说错了）');
});

test('GCAT-4 入口不在位：归因指向被点名的入口脚本（而非点名面）', { skip: !hasGit && 'git 不可用' }, () => {
  const { code, out } = withFixture((dir) => {
    editJson(path.join(dir, 'package.json'), (o) => { o.scripts.gate = 'node scripts/gate.mjs'; });
    fs.rmSync(path.join(dir, 'scripts', 'gate.mjs'));           // 入口未落地（F1 波次未落）
  }, runClaims);
  const row = readingRow(out);
  assert.equal(code, 1, '入口缺位必须判红：\n' + out);
  assert.match(row, /编排器入口不在位/, '应区分「入口不在位」与「入口取不到环」');
  assert.ok(row.includes('scripts/gate.mjs'), '归因必须点名缺失的入口：' + row);
  assert.ok(!row.includes('点名却缺席'), '入口缺位不得报成点名面结论：' + row);
});

test('GCAT-5 删环负控仍红：链上删一环 → 红，且「点名却缺席」点名该环（带下探面提示）', { skip: !hasGit && 'git 不可用' }, () => {
  const { code, out } = withFixture((dir) => {
    const entry = path.join(dir, 'scripts', 'gate.mjs');
    const src = fs.readFileSync(entry, 'utf8').replace(/\n\s*\{[^\n]*card-arch-consistency[^\n]*\},?/, '\n');
    assert.ok(src !== fs.readFileSync(entry, 'utf8'), '夹具失败：没删掉 cards 环');
    fs.writeFileSync(entry, src);
  }, runClaims);
  const row = readingRow(out);
  assert.equal(code, 1, '删环负控必须仍红（点名面判据的原始负控）：\n' + out);
  assert.match(row, /点名却缺席 scripts\/card-arch-consistency/, '应点名消失的环：' + row);
  // 部分缺席同样要能指向下探面：该环的字面量在入口里已不存在 ⇒ 可能是被变量拼接调用，而非被删
  assert.ok(row.includes('scripts/gate.mjs'), '部分缺席也应给出下探面提示：' + row);
});

test('GCAT-6 命令面认不出入口：如实判红并说「认不出」，不猜一个入口路径', { skip: !hasGit && 'git 不可用' }, () => {
  const { code, out } = withFixture((dir) => {
    editJson(path.join(dir, 'package.json'), (o) => { o.scripts.gate = 'node "$ENTRY"'; });
  }, runClaims);
  const row = readingRow(out);
  assert.equal(code, 1, '认不出入口仍须判红：\n' + out);
  assert.match(row, /认不出编排器入口/, '应如实说认不出（不给假指向）：' + row);
  // 只禁**可解析的具体路径**（`scripts/<名>.mjs` 这种占位形态不算——它是在说明取环规则，不是在指认入口）
  const concrete = row.match(/scripts\/[\w.\-]+\.mjs/g) || [];
  assert.equal(concrete.length, 0, '不得猜一个入口路径糊弄读者（出现 ' + concrete.join(',') + '）：' + row);
});
