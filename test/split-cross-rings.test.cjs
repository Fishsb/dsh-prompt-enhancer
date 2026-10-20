'use strict';
// ============================================================================
// 拆包前置批（2026-10-20）：**两道跨包机检环**的正反自证
//   `cross: pkg-identity` / `cross: shared-fns`
// ============================================================================
// 为什么要有本文件（而不是只跑两个脚本）：
//   两个脚本在**没有违规的真实仓**上都会打 PASS —— 那只能证明"没红"，
//   **不能证明"撞了会红"**。本仓反复栽在「判据存在 ≠ 判据有牙」上
//   （`test-inventory` 的由来、`gate-chain-attribution` 的由来皆同）。
//   ⇒ 本文件对**纯函数判据**做**反向自证**（构造违规 ⇒ 必红并点名），
//     再对**真实仓**做**正向自证**（必绿，且断言 `observed` 达到分母下限 ⇒ 证明不是空跑）。
//
// ⚠ 分工：判定逻辑全在 `scripts/lib/split-*.mjs`（纯函数，可喂假输入）；
//   本文件**不重写判据**，只驱动它。⛔ 不许把断言降级成"文件存在"。
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

const identity = require('../scripts/lib/split-identity.mjs');
const shared = require('../scripts/lib/split-shared-fns.mjs');

// ══════════════════════════════════════════════════════════════════════════
// 一 · cross: pkg-identity —— 反向自证（撞了必红）
// ══════════════════════════════════════════════════════════════════════════

test('SPLIT-ID-1 反向：两个包用**同一 loader entry id** ⇒ 判红并点名该值', () => {
  const yml = [
    '- insert:',
    '    - id: dsh-prompt-enhancer',
    "      name: 'dsh-prompt-enhancer'",
    '- insert:',
    '    - id: dsh-prompt-enhancer',          // ⚠ 撞车：第二包误用了第一包的 id
    "      name: 'dsh-voice-enhancer'",
  ].join('\n');
  const entries = identity.patchEntryIdentities(yml);
  assert.equal(entries.length, 2, '应解析出两条 insert');
  const r = identity.findCollisions([{ label: 'loader entry id', values: entries.map((e) => e.id) }]);
  assert.equal(r.ok, false, '同 id 两次必须判红（宿主实测不报错 ⇒ 只能这里拦）');
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].value, 'dsh-prompt-enhancer');
  assert.equal(r.duplicates[0].count, 2);
});

test('SPLIT-ID-2 正向：两个包用**不同** id ⇒ 绿，且两条都在（不是空跑）', () => {
  const yml = [
    '- insert:',
    '    - id: dsh-prompt-enhancer',
    "      name: 'dsh-prompt-enhancer'",
    '- insert:',
    '    - id: dsh-voice-enhancer',
    "      name: 'dsh-voice-enhancer'",
  ].join('\n');
  const entries = identity.patchEntryIdentities(yml);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.id), ['dsh-prompt-enhancer', 'dsh-voice-enhancer']);
  const r = identity.findCollisions([{ label: 'loader entry id', values: entries.map((e) => e.id) }]);
  assert.equal(r.ok, true, '不同 id 应判绿');
  assert.equal(r.observed['loader entry id'], 2, 'observed 必须是 2（证明真扫到两条）');
});

test('SPLIT-ID-3 反向：两个包用**同一 client 模块 id** ⇒ 判红', () => {
  const a = 'window.__ModuleLoader__.load({ id: "dsh-prompt-enhancer", factory: (r) => ({}) });';
  const b = 'window.__ModuleLoader__.load({ id: "dsh-prompt-enhancer", factory: (r) => ({}) });';
  assert.deepEqual(identity.clientModuleIds(a), ['dsh-prompt-enhancer']);
  const r = identity.findCollisions([{ label: 'client 模块 id', values: [...identity.clientModuleIds(a), ...identity.clientModuleIds(b)] }]);
  assert.equal(r.ok, false, '同 client id 必须判红（宿主 client-modules 会抛 duplicate factory）');
  assert.equal(r.duplicates[0].value, 'dsh-prompt-enhancer');
});

test('SPLIT-ID-4 反向：两个包**同一 RPC 前缀** ⇒ 判红', () => {
  const one = "const RPC_PATH = '/dsh-prompt-enhancer/rpc';";
  const two = "const RPC_PATH = '/dsh-prompt-enhancer/rpc';";
  assert.deepEqual(identity.rpcRoutePrefixes(one), ['/dsh-prompt-enhancer/rpc']);
  const r = identity.findCollisions([{ label: 'RPC 路由前缀', values: [...identity.rpcRoutePrefixes(one), ...identity.rpcRoutePrefixes(two)] }]);
  assert.equal(r.ok, false, '同前缀必须判红（宿主 webserver 重复 exact 路由会抛）');
});

test('SPLIT-ID-5 反向：两个包注册**同名 RPC 方法** ⇒ 判红', () => {
  const a = "harness.handle('enhance', async () => ({}));";
  const b = "harness.handle('enhance', async () => ({}));";
  const r = identity.findCollisions([{ label: 'RPC 方法名', values: [...identity.rpcMethods(a), ...identity.rpcMethods(b)] }]);
  assert.equal(r.ok, false);
  assert.equal(r.duplicates[0].value, 'enhance');
});

test('SPLIT-ID-5b ⭐ 回归锁：RPC 方法名判重**不得先去重再判重**（本批负控 D 实测漏判）', () => {
  // 病历（本段代码自己的实测）：`cross: pkg-identity` 首版写成
  //     values: [...new Set(rpcMethods(allHostText))]
  //   —— `new Set` 把「两处注册同名方法」这一**缺陷本身**先消掉 ⇒ 判据恒绿。
  //   用真实脚本造负控实测：往 lib/ 加一个注册 `enhance` 的第二文件，首版 **EXIT=0 漏判**；
  //   改成用注册点原样列表后 **EXIT=1 并点名 "enhance"**。
  //   ⚠ 本锁判的是**环脚本源码形态**：它必须把 `rpcMethods(...)` 原样传入，
  //     若有人再包一层 Set/去重 ⇒ 立刻红（否则这个 bug 会随重构复活）。
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'split-identity.mjs'), 'utf8');
  const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');  // 只看代码面，不看注释
  assert.doesNotMatch(
    code,
    /new\s+Set\s*\(\s*rpcMethods\s*\(/,
    'RPC 方法名判重不得先去重（那会把"同名两处"这个缺陷先消掉 ⇒ 判据恒绿）',
  );
  // 且必须**原样**传入 rpcMethods(...) 作为 values
  assert.match(
    code,
    /label:\s*'RPC 方法名'\s*,\s*values:\s*rpcMethods\s*\(/,
    "RPC 方法名这一面必须用注册点原样列表作为 values（判撞车）",
  );
  // 反向确认：判重函数本身**确实**能抓到重复（证明上面那条不是空判）
  const r = identity.findCollisions([{ label: 'RPC 方法名', values: ['enhance', 'enhance', 'cancel'] }]);
  assert.equal(r.ok, false);
  assert.equal(r.duplicates[0].value, 'enhance');
});

test('SPLIT-ID-6 正向：真实仓 —— 两道判据绿，且 observed 达分母下限（证明不是空跑）', () => {
  const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'lib', 'client.cjs'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'lib', 'index.cjs'), 'utf8');
  const libFiles = identity.libCjsFiles(ROOT);
  assert.ok(libFiles.length > 0, 'lib/*.cjs 不得为空');
  const hostText = libFiles.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    + '\n' + fs.readFileSync(path.join(ROOT, 'plugin-host.js'), 'utf8');
  const groups = [
    { label: 'loader entry id', values: identity.patchEntryIdentities(patch).map((e) => e.id) },
    { label: 'client 模块 id', values: identity.clientModuleIds(client) },
    { label: 'RPC 路由前缀', values: identity.rpcRoutePrefixes(index) },
    { label: 'RPC 方法名', values: [...new Set(identity.rpcMethods(hostText))] },
  ];
  const r = identity.findCollisions(groups);
  assert.equal(r.ok, true, '真实仓应判绿：\n' + JSON.stringify(r.duplicates));
  // —— 非空跑判据：四项都必须至少取到 1/1/1/15 ——
  assert.equal(r.observed['loader entry id'], 1, '拆包前应恰有 1 条 entry');
  assert.equal(r.observed['client 模块 id'], 1);
  assert.equal(r.observed['RPC 路由前缀'], 1);
  assert.ok(r.observed['RPC 方法名'] >= 15, 'RPC 方法名应 ≥15（实际 ' + r.observed['RPC 方法名'] + '）');
});

// ══════════════════════════════════════════════════════════════════════════
// 二 · cross: shared-fns —— 反向自证（漂移必红）+ 分母 fail-closed
// ══════════════════════════════════════════════════════════════════════════

test('SPLIT-FN-1 反向：两份副本**只差一个字符** ⇒ 判红并点名函数', () => {
  const src = shared.splitSharedSources(ROOT)[0];
  const real = shared.loadCopy(ROOT, src);
  const tampered = {
    label: 'tampered-copy',
    functions: { ...real.functions },
    missing: [],
  };
  // 只改 buildTryChain 里的一个字符（最典型的手改漂移）
  tampered.functions.buildTryChain = tampered.functions.buildTryChain.replace('const chain = []', 'const chain = [ ]');
  assert.notEqual(tampered.functions.buildTryChain, real.functions.buildTryChain, '构造的变异必须真的改了内容');
  const r = shared.compareCopies([real, tampered]);
  assert.equal(r.ok, false, '逐字节不等必须判红');
  assert.equal(r.mismatches.length, 1);
  assert.equal(r.mismatches[0].name, 'buildTryChain');
});

test('SPLIT-FN-2 正向：两份副本完全一致 ⇒ 绿', () => {
  const src = shared.splitSharedSources(ROOT)[0];
  const a = shared.loadCopy(ROOT, src);
  const b = JSON.parse(JSON.stringify(a));
  b.label = 'copy-2';
  const r = shared.compareCopies([a, b]);
  assert.equal(r.ok, true);
  assert.equal(r.observed, shared.SHARED_FUNCTIONS.length * 2, 'observed = 函数数 × 份数');
});

test('SPLIT-FN-3 fail-closed：少一个函数 ⇒ 必红（⛔ 不许"扫得少所以过"）', () => {
  const src = shared.splitSharedSources(ROOT)[0];
  const real = shared.loadCopy(ROOT, src);
  const crippled = { label: 'crippled', functions: { ...real.functions }, missing: [] };
  delete crippled.functions.cleanOutput;
  crippled.missing = ['cleanOutput'];
  const r = shared.compareCopies([crippled]);
  assert.equal(r.ok, false, '缺函数必须判红');
  assert.match(r.reason, /cleanOutput/, '必须点名缺的是哪个函数');
});

test('SPLIT-FN-4 fail-closed：一份副本都没有 ⇒ 必红（不是"无冲突所以绿"）', () => {
  const r = shared.compareCopies([]);
  assert.equal(r.ok, false);
  assert.equal(r.observed, 0);
});

test('SPLIT-FN-5 提取粒度：7 个函数都取到，且不是"吞整份文件"', () => {
  const src = shared.splitSharedSources(ROOT)[0];
  const c = shared.loadCopy(ROOT, src);
  assert.deepEqual(c.missing, [], '7 个函数都必须取到');
  assert.equal(Object.keys(c.functions).length, shared.SHARED_FUNCTIONS.length);
  for (const name of shared.SHARED_FUNCTIONS) {
    const def = c.functions[name];
    assert.match(def, /function\s+/, name + ' 的定义必须含 function 关键字');
    assert.ok(def.length < c.srcLength, name + ' 的定义不得等于整份源码（那是吞文件）');
  }
  const total = shared.SHARED_FUNCTIONS.reduce((s, n) => s + c.functions[n].length, 0);
  assert.ok(total < c.srcLength * 0.6, '7 函数合计应远小于整份源码（实测约 25%），实际 ' + (total / c.srcLength * 100).toFixed(1) + '%');
});

test('SPLIT-FN-6 正向：真实仓 —— 判定绿、条目 7、发现面非空', () => {
  const sources = shared.splitSharedSources(ROOT);
  assert.ok(sources.length >= 1, '发现面不得为空（拆包前应命中 src/host/pure.js）');
  const copies = sources.map((s) => shared.loadCopy(ROOT, s));
  const r = shared.compareCopies(copies);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.observed, sources.length * shared.SHARED_FUNCTIONS.length);
  assert.ok(r.observed >= shared.SHARED_FUNCTIONS.length, 'observed 必须 ≥ 7（非空跑）');
});

// ══════════════════════════════════════════════════════════════════════════
// 三 · 端到端：两个环脚本自己也要有牙（跑真脚本，喂 --check / 无旗）
// ══════════════════════════════════════════════════════════════════════════

function runRing(script, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

test('SPLIT-RING-1 端到端正向：两个环 --check 均 exit 0 且各打一行 PASS 契约行', () => {
  for (const [script, id] of [['split-identity.mjs', 'pkg-identity'], ['split-shared-fns.mjs', 'shared-fns']]) {
    const { code, out } = runRing(script, ['--check']);
    assert.equal(code, 0, script + ' 应 exit 0：\n' + out);
    const lines = out.split('\n').filter((l) => l.startsWith('RING-STATE ' + id + ' '));
    assert.equal(lines.length, 1, script + ' 应恰打一行契约行，实际 ' + lines.length + '：\n' + out);
    assert.match(lines[0], new RegExp('^RING-STATE ' + id + ' PASS '), '必须是 PASS：' + lines[0]);
  }
});

test('SPLIT-RING-2 端到端：不带 --check 时**只报 SKIP**，⛔ 不得冒充 PASS', () => {
  for (const [script, id] of [['split-identity.mjs', 'pkg-identity'], ['split-shared-fns.mjs', 'shared-fns']]) {
    const { code, out } = runRing(script, []);
    assert.equal(code, 0, '不带 --check 时退出码不承载判定（应 0）：\n' + out);
    assert.match(out, new RegExp('^RING-STATE ' + id + ' SKIP ', 'm'), '不带 --check 必须报 SKIP：\n' + out);
  }
});
