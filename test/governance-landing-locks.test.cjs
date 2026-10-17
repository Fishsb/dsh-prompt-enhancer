'use strict';
// test/governance-landing-locks.test.cjs —— 治理面落地批（2026-10-17）回归锁
//
// 锁两件（其余两件为纯结论，见报告 §⑤/§⑦）：
//   ① **`S-10` 声明面三面相等**（正本 §12.13.2 甲-1）：接 `scripts/lib/declared-surface.mjs`
//      的**纯函数**做内存变异自证 —— 无需整仓夹具，回归锁才跑得起、留得住。
//      ⚠ 为什么必须单独锁：判据**存在** ≠ 判据**有牙**。若被判据面删除/改浅，本锁必红。
//   ② **`D` 正本可复算对照**（正本 §11.6 · §12.13.2 甲-2）：接 `scripts/lib/claims-vs-source.mjs`
//      的锚点解析 + fail-closed 语义 —— 同样走内存变异（喂正本文本，不读真实账本区）。
//
// ⚠ 夹具策略：**全内存**（不复制整仓、不触碰真实工作区、不读写账本区）
//   —— 变异若留在真仓里会把"自证"变成"破坏"。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const surface = require(path.join(ROOT, 'scripts', 'lib', 'declared-surface.mjs'));
const claims = require(path.join(ROOT, 'scripts', 'lib', 'claims-vs-source.mjs'));

const { compareDeclaredSurface } = surface;
const { compareClaims, FACTS } = claims;

/** 造一份最小可用输入（真实形态：三面一致）。 */
const mkPkg = (peer = ['@deepseek-ai/dsh-client-locale']) => ({
  peerDependencies: Object.fromEntries(peer.map((n) => [n, '>=0.1.0-rc.6'])),
  dsh: { client: { inject: peer.slice(), platform: 'web' } },
});
const mkLock = (peer = ['@deepseek-ai/dsh-client-locale']) => ({
  packages: { '': { peerDependencies: Object.fromEntries(peer.map((n) => [n, '>=0.1.0-rc.6'])) } },
});

// ───────────────────────── ① S-10：声明面三面相等 ─────────────────────────

test('GL-1 基线：三面一致 ⇒ 判过（负控：本锁不得恒红）', () => {
  const r = compareDeclaredSurface(mkPkg(), mkLock());
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.peer, ['@deepseek-ai/dsh-client-locale']);
  assert.deepEqual(r.legs, []);
});

test('GL-2 变异①：`peerDependencies` 侧摘掉包 ⇒ 必红且点名该腿', () => {
  // 真实形态：peer 里删掉、inject/lock 仍留 ⇒ 宿主 compatibility 门可能直接 deny 整个 bundle
  const pkg = mkPkg();
  delete pkg.peerDependencies['@deepseek-ai/dsh-client-locale'];
  pkg.peerDependencies['@deepseek-ai/dsh-client-other'] = '>=0.1.0';
  const r = compareDeclaredSurface(pkg, mkLock());
  assert.equal(r.ok, false);
  assert.match(r.reason, /peer↔inject 差/);
});

test('GL-3 变异②：`dsh.client.inject` 侧多一项 ⇒ 必红（防只审单侧）', () => {
  const pkg = mkPkg();
  pkg.dsh.client.inject.push('@deepseek-ai/dsh-client-extra');
  const r = compareDeclaredSurface(pkg, mkLock());
  assert.equal(r.ok, false);
  assert.match(r.reason, /peer↔inject 差/);
});

test('GL-4 变异③：`package-lock.json` root 镜像漂移 ⇒ 必红（第三面确有牙，非装饰）', () => {
  const lock = mkLock(['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-drift']);
  const r = compareDeclaredSurface(mkPkg(), lock);
  assert.equal(r.ok, false);
  assert.match(r.reason, /peer↔lock-root 差/);
  assert.deepEqual(r.lockPeer, ['@deepseek-ai/dsh-client-drift', '@deepseek-ai/dsh-client-locale']);
});

test('GL-5 fail-closed：任一面读不到 ⇒ 判红（⛔ 不得"读不到就算过"）', () => {
  const noPeer = mkPkg(); delete noPeer.peerDependencies;
  assert.match(compareDeclaredSurface(noPeer, mkLock()).reason, /无 peerDependencies/);

  const noInject = mkPkg(); delete noInject.dsh.client.inject;
  assert.match(compareDeclaredSurface(noInject, mkLock()).reason, /inject 不是数组/);

  const noRoot = { packages: {} };
  assert.match(compareDeclaredSurface(mkPkg(), noRoot).reason, /无 root 条目/);

  const noLockPeer = { packages: { '': {} } };
  assert.match(compareDeclaredSurface(mkPkg(), noLockPeer).reason, /root 条目无 peerDependencies/);

  // 空面：peer 为空 ⇒ 三面"相等"但无意义 ⇒ 仍须判红（空扫不得判绿）
  const empty = { peerDependencies: {}, dsh: { client: { inject: [] } } };
  const rEmpty = compareDeclaredSurface(empty, { packages: { '': { peerDependencies: {} } } });
  assert.equal(rEmpty.ok, false);
  assert.match(rEmpty.reason, /某面为空/);

  // 非对象 / null 一律 fail-closed
  assert.equal(compareDeclaredSurface(null, mkLock()).ok, false);
  assert.equal(compareDeclaredSurface(mkPkg(), null).ok, false);
});

test('GL-6 边界可见化：命名空间外的项被如实报出（⛔ 不得让判据看起来比实际更强）', () => {
  // 宿主 compatibility 门只审 `@deepseek-ai/dsh*`；第三方 peer 名"相等"不代表宿主认可可解析
  const third = ['@deepseek-ai/dsh-client-locale', 'some-third-party-pkg'];
  const r = compareDeclaredSurface(mkPkg(third), mkLock(third));
  assert.equal(r.ok, true, '集合相等这一层仍应判过（判据范围就是集合相等）');
  assert.deepEqual(r.outsideNamespace, ['some-third-party-pkg'], '须显式暴露命名空间外项，防读者高估覆盖面');
});

test('GL-7 真数据对账：真实 package.json / package-lock.json 三面相等（S-10 的磁盘面）', () => {
  const fs = require('node:fs');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const r = compareDeclaredSurface(pkg, lock);
  assert.equal(r.ok, true, r.reason + '｜' + r.legs.join('；'));
  assert.ok(r.peer.length > 0);
});

test('GL-8 接线：`arch-claims` 的 S-10 仍在位且消费单一事实源（防判据被静默删除）', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'arch-claims.mjs'), 'utf8');
  assert.ok(src.includes("A('S-10'"), 'S-10 断言须在 arch-claims 内');
  assert.ok(src.includes('compareDeclaredSurface'), 'S-10 须消费 declared-surface 单一事实源');
});

// ───────────────────────── ② D：正本可复算对照 ─────────────────────────

/** 从真实正本锚点取的**骨架文本**：只保留各事实的锚点句，值可注入（不读账本区）。 */
function skeletonValues(v) {
  return [
    '| Host 入口 | `lib/index.cjs`（**' + v.indexLines + ' 行**，`split(\'\\n\')` 物理行口径',
    '`src/host/` 现为 **' + v.hostFiles + ' 件 / ' + v.hostLines + ' 物理行**',
    'RPC 面（现行）**：**合计 ' + v.rpcLive + ' 条**（`plugin-host.js` ' + v.rpcBundled + ' 条 + `lib/` 侧真 CommonJS 模块 ' + v.rpcNative + ' 条',
    '`lib/` 下全部**非生成** `.cjs`（现行 **' + v.libFiles + ' 件**）',
    '⇒ **共 ' + v.templates + ' 个模板正文**',
    'PASS \\| R7 \\| ' + v.chunks + ' 个 chunk',
    'PASS \\| R3 \\| ' + v.whitelist + ' 条白名单全部在位',
  ].join('\n');
}

const TRUTH = { indexLines: 114, hostFiles: 5, hostLines: 24, rpcLive: 15, rpcBundled: 12, rpcNative: 3, libFiles: 12, templates: 10, chunks: 29, whitelist: 5 };

/** 与真实派生同形的替身 —— **不触碰真实工作区**，值由调用方给定。 */
const depsFrom = (v) => ({
  rpcManifest: () => ({ counts: { live: v.rpcLive, bundled: v.rpcBundled, native: v.rpcNative } }),
  gateReading: (_root, id) => ({ n: id === 'R7' ? v.chunks : v.whitelist }),
});
/** ctx.deps 由 compareClaims 传入 derive；替身须按 id 分发。 */
function runWith(text, v) {
  const base = depsFrom(v);
  return compareClaims({
    projectText: text,
    deps: {
      rpcManifest: base.rpcManifest,
      gateReading: base.gateReading,
      // 其余 derive 直接读 root 磁盘（真实文件）——本锁只注入计数面
    },
    root: ROOT,
  });
}

test('GL-9 D 基线：正本骨架 == 真实工作区 ⇒ 判绿（负控：不得恒红）', () => {
  const r = runWith(skeletonValues(TRUTH), TRUTH);
  const bad = r.rows.filter((x) => x.verdict === 'differ');
  assert.deepEqual(bad, [], '不应有 differ：' + JSON.stringify(bad));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test('GL-10 D 变异①：正本所述行数被改 ⇒ 必红（`differ`，不静默）', () => {
  const v = { ...TRUTH, indexLines: 113 };
  const r = runWith(skeletonValues(v), TRUTH);
  assert.equal(r.ok, false);
  const d1 = r.rows.find((x) => x.id === 'D-1');
  assert.equal(d1.verdict, 'differ');
  assert.deepEqual(d1.said, ['113']);
  assert.deepEqual(d1.got, ['114']);
});

test('GL-11 D 变异②：工作区件数变化 ⇒ 必红（判据对**事实源**变化敏感，不是只比文本）', () => {
  const v = { ...TRUTH, hostFiles: 6, hostLines: 27 };
  const r = runWith(skeletonValues(v), TRUTH);           // 正本说 6/27，实算 5/24
  assert.equal(r.ok, false);
  const d2 = r.rows.find((x) => x.id === 'D-2');
  assert.equal(d2.verdict, 'differ');
  assert.deepEqual(d2.said, ['6', '27']);
  assert.deepEqual(d2.got, ['5', '24']);
});

test('GL-12 D fail-closed：正本读不到 / 为空 / 不给路径 ⇒ 一律判红（⛔ 不得判绿）', () => {
  // 不给路径且无 env
  const noPath = compareClaims({ projectText: undefined, projectPath: undefined, root: ROOT });
  assert.equal(noPath.ok, false);
  assert.equal(noPath.problems[0].kind, 'unjudged');

  // 路径不存在
  const bad = compareClaims({ projectPath: '/tmp/definitely-not-here-' + Date.now() + '.md', root: ROOT });
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0].msg, /正本不存在/);

  // 文本为空
  const empty = compareClaims({ projectText: '   ', root: ROOT });
  assert.equal(empty.ok, false);
  assert.match(empty.problems[0].msg, /正本为空/);

  // 锚点全失配 ⇒ 每条都是 unjudged（**不得**因为"解析不到"而记绿）
  const unmatched = compareClaims({ projectText: '完全无关的文本', root: ROOT });
  assert.equal(unmatched.ok, false);
  assert.equal(unmatched.problems.length, FACTS.length);
  assert.ok(unmatched.problems.every((p) => p.kind === 'unjudged'));
});

test('GL-13 D 派生源不可用 ⇒ unjudged（fail-closed：派生源失配不折成判过）', () => {
  const r = compareClaims({
    projectText: skeletonValues(TRUTH),
    root: ROOT,
    deps: {
      rpcManifest: () => { throw new Error('rpc-manifest 不可用（夹具）'); },
      gateReading: () => { throw new Error('dead-code-gate 不可用（夹具）'); },
    },
  });
  assert.equal(r.ok, false);
  const ids = r.problems.map((p) => p.id).sort();
  assert.deepEqual(ids, ['D-3', 'D-6', 'D-7'], '只有依赖派生的三条应为 unjudged');
  assert.ok(r.problems.every((p) => p.kind === 'unjudged'));
});

test('GL-14 D 范围边界：事实清单只含可派生类，语义类不在其列（防范围被悄悄扩大）', () => {
  assert.ok(FACTS.length > 0);
  for (const f of FACTS) {
    assert.match(f.unit, /^(行|件|条|个)$/, f.id + ' 的单位须是可派生量（行/件/条/个）');
    assert.ok(f.anchor instanceof RegExp, f.id + ' 须以锚点正则从正本读取，⛔ 不得硬编数字');
    // ⛔ 锚点里不得出现裸数字字面量（否则就是"把值抄进判据"= 第三种副本）
    assert.doesNotMatch(String(f.anchor), /\\d\s*\)\s*\^\s*\$/, f.id);
  }
});

test('GL-15 接线：`claims-vs-source` CLI 在位且声明触发点归属（防工具被删而无人知）', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'claims-vs-source.mjs'), 'utf8');
  assert.ok(src.includes('人工收口显式调用'), '触发点归属须在文件内声明（人载）');
  assert.ok(src.includes('fail-closed'));
  // ⛔ 不得把正本路径硬编成"工作区内缺省"（正本在账本区、工作区之外）
  assert.ok(!/PROJECT\.md['"\s]*\)\s*;?\s*$/.test(src.split('\n').find((l) => l.includes('projectPath =')) || ''),
    '不得把正本路径硬编为缺省');
});

// ───────────────────── ③ 断言级强度读数（作业书 ⑤）─────────────────────
// 为什么要锁它：本读数存在的**唯一理由**是堵住「一条 test 内删掉 N 个 assert」的零信号
// （实测发生过：布局批改写 `VADSL-P14` 时误删 3 条断言，而 `npm test` 的 tests 数反而上升）。
// 若本读数被改浅（例如退化成"数 test 条数"），该盲区会静默复原 ⇒ 必须用变异锁住它对
// **断言调用点**的敏感性。

test('GL-16 断言级读数：删掉 3 个 assert 调用点 ⇒ 读数**必降 3**（既有 tests 数对此零信号）', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const { countAssertSites } = claims;
  // 只造最小 test/ 面（不复制整仓）：两个文件、其中一个含 3 条"可被误删"的断言。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-assert-'));
  try {
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(path.join(dir, 'test', 'a.test.cjs'), [
      "test('x', () => {",
      "  assert.equal(1, 1);",
      "  assert.equal(2, 2);",
      "  assert.ok(true);",
      "  assert.deepEqual([], []);",
      "});",
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'test', 'b.test.cjs'), "test('y', () => { assert.equal(1, 1); });\n");
    const before = countAssertSites(dir);
    assert.equal(before.total, 5, '基线：a 4 条 + b 1 条');
    assert.equal(before.files, 2);

    // 变异：a 里删掉 3 条（= 布局批那次的真实形态）
    fs.writeFileSync(path.join(dir, 'test', 'a.test.cjs'), [
      "test('x', () => {",
      "  assert.equal(1, 1);",
      "});",
    ].join('\n'));
    const after = countAssertSites(dir);
    assert.equal(after.total, 2, '删 3 条 ⇒ 读数必降 3（5→2）—— 这正是 tests 条数读不出的量');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GL-17 断言级读数的边界：注释里的 assert 不计入（防"写注释骗读数"），且不设阈值/不判红', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const { countAssertSites } = claims;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-assert2-'));
  try {
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(path.join(dir, 'test', 'c.test.cjs'), [
      "// assert.equal(1,1)   ← 行注释里的不算",
      "/* assert.ok(true) */  ← 块注释里的不算",
      "test('z', () => { assert.equal(1, 1); });",
    ].join('\n'));
    assert.equal(countAssertSites(dir).total, 1, '只数真调用点；注释里的不得计入');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // 边界声明锁：本读数**不是门禁**，源码里必须显式写着"不设阈值/不自动判红"
  // （否则下一个人会把它接成阈值门 ⇒ 激励"为凑读数加空断言" = 把断言写松）。
  const src = require('node:fs').readFileSync(path.join(ROOT, 'scripts', 'lib', 'claims-vs-source.mjs'), 'utf8');
  assert.ok(/不设阈值/.test(src), '须显式声明不设阈值');
  assert.ok(/不是门禁/.test(src), '须显式声明它不是门禁');
});
