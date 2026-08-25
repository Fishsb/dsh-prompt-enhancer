'use strict';
// 批次B（P0-2 部署账本 + 自愈守卫 + P1-3 一致性自检）契约测试。
// 覆盖：账本读写原子性与注入缝、heal 守卫决策矩阵（含账本陈旧/双空盲区/BOM 拒绝/旁路旋钮）、
// B-5 探针比较器与 compareSemver 行为一致锚、profileDir 口径统一与 BOM 容错、
// 五项自检 PASS/WARN/FAIL 夹具、菜单渲染层接线。
// 隔离纪律：全部落盘走临时目录（DSH_HOME 注入），绝不触真实环境。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.DSH_ENHANCER_NO_INDEX = '1';

const sys = require('../lib/sys.cjs');
const M = require('../lib/maintain-lib.cjs');
const indexMod = require('../lib/index.cjs');
const updater = require('../lib/updater-host.cjs');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dguard-'));

/** 用 System32 tar 造一个真实可解的 tgz（package/package.json 含 name/version）。 */
function makeRealTgz(dest, version, opts) {
  const o = opts || {};
  const stage = tmpRoot();
  const pkgDir = path.join(stage, 'package');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'dsh-prompt-enhancer', version }), 'utf8');
  if (o.extraFile) fs.writeFileSync(path.join(pkgDir, o.extraFile), 'x', 'utf8');
  const tarBin = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tarBin, ['-czf', dest.replace(/\\/g, '/'), '-C', stage, 'package'], { timeout: 30000 });
  return dest;
}

/* ---------------- 账本 API ---------------- */

test('DGRD-01 writeDeployLedgerEntry 建账/合并/profile 维度隔离 + readDeployLedger 往返', () => {
  const home = tmpRoot();
  const w1 = sys.writeDeployLedgerEntry('web', '3.3.2', 'sync-runtime', { dshHome: home });
  assert.equal(w1.ok, true);
  const w2 = sys.writeDeployLedgerEntry('desktop', '3.3.1', 'staged-install', { dshHome: home });
  assert.equal(w2.ok, true);
  const led = sys.readDeployLedger({ dshHome: home });
  assert.equal(led.schema, 1);
  assert.equal(led.profiles.web.version, '3.3.2');
  assert.equal(led.profiles.web.source, 'sync-runtime');
  assert.ok(Number.isInteger(led.profiles.web.ts));
  assert.equal(led.profiles.desktop.version, '3.3.1');
  assert.ok(Number.isInteger(led.profiles.desktop.ts));
  // 同 profile 再写覆盖为最新事实
  sys.writeDeployLedgerEntry('web', '3.4.0', 'local-install', { dshHome: home });
  const led2 = sys.readDeployLedger({ dshHome: home });
  assert.equal(led2.profiles.web.version, '3.4.0');
  assert.equal(led2.profiles.desktop.version, '3.3.1', '其他 profile 不受影响');
});

test('DGRD-02 readDeployLedger 容错：缺失/损坏/数组 → null（守卫按账本缺失语义）', () => {
  const home = tmpRoot();
  assert.equal(sys.readDeployLedger({ dshHome: home }), null, '缺失返回 null');
  fs.writeFileSync(sys.deployLedgerFile(home), '{{{bad', 'utf8');
  assert.equal(sys.readDeployLedger({ dshHome: home }), null);
  fs.writeFileSync(sys.deployLedgerFile(home), '[1,2]', 'utf8');
  assert.equal(sys.readDeployLedger({ dshHome: home }), null);
});

test('DGRD-03 writeDeployLedgerEntry io 缝失败注入：ok=false 非 fatal，目标不留半截 JSON', () => {
  const home = tmpRoot();
  sys.writeDeployLedgerEntry('web', '3.3.2', 'sync-runtime', { dshHome: home });
  const before = fs.readFileSync(sys.deployLedgerFile(home), 'utf8');
  const r = sys.writeDeployLedgerEntry('web', '9.9.9', 'heal', {
    dshHome: home,
    fsImpl: {
      mkdirSync() {},
      writeFileSync() { throw new Error('injected disk full'); },
      renameSync() {},
    },
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /injected disk full/);
  assert.equal(fs.readFileSync(sys.deployLedgerFile(home), 'utf8'), before, '失败不得改写既有账本');
});

/* ---------------- profileDir 统一（B-4）+ BOM 容错（B-7） ---------------- */

test('DGRD-04 profileDir 统一口径：override > DSH_HOME env > USERPROFILE 兜底（SYS-02 尾缀不回退）', () => {
  const home = tmpRoot();
  assert.equal(sys.profileDir('web', home), path.join(home, 'profiles', 'web'));
  const saved = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    assert.equal(sys.profileDir('web'), path.join(home, 'profiles', 'web'));
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved;
  }
  assert.ok(sys.profileDir('web').endsWith(path.join('.dsh', 'profiles', 'web')));
});

test('DGRD-05 readInstalledPluginVersion BOM 容错（B-7）：带 BOM 包仍出版本号', () => {
  const home = tmpRoot();
  const runtimeDir = path.join(home, 'profiles', 'web', 'node_modules', 'dsh-prompt-enhancer');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'package.json'), '\uFEFF{"name":"dsh-prompt-enhancer","version":"3.3.2"}', 'utf8');
  assert.equal(sys.readInstalledPluginVersion('web', home), '3.3.2', 'BOM 不得压低守卫基线');
  // 无 BOM / 损坏两态回归
  fs.writeFileSync(path.join(runtimeDir, 'package.json'), '{"version":"3.3.3"}', 'utf8');
  assert.equal(sys.readInstalledPluginVersion('web', home), '3.3.3');
  fs.writeFileSync(path.join(runtimeDir, 'package.json'), 'broken', 'utf8');
  assert.equal(sys.readInstalledPluginVersion('web', home), null);
});

/* ---------------- heal 守卫探针（生成物 e2e + 决策矩阵） ---------------- */

const GUARD_DIR = (() => {
  const d = tmpRoot();
  fs.writeFileSync(path.join(d, 'dsh-heal-guard.cjs'), indexMod.buildHealGuardScript(), 'utf8');
  return d;
})();
function runGuard(homeArgs) {
  const guardPath = path.join(GUARD_DIR, 'dsh-heal-guard.cjs');
  const env = Object.assign({}, process.env, homeArgs.env || {});
  const r = require('node:child_process').spawnSync(
    process.execPath, [guardPath].concat(homeArgs.args),
    { encoding: 'utf8', timeout: 60000, env, windowsHide: true });
  return r;
}

test('DGRD-06 守卫决策矩阵·缓存旧于基线 → 拒绝(exit 1) + heal-refused.log 留痕', () => {
  const home = tmpRoot();
  const rtRoot = tmpRoot();
  fs.mkdirSync(path.join(rtRoot, 'profiles'), { recursive: true }); // 占位
  fs.writeFileSync(path.join(rtRoot, 'package.json'), '{"version":"3.3.2"}', 'utf8');
  sys.writeDeployLedgerEntry('web', '3.3.2', 'sync-runtime', { dshHome: home });
  const tgz = makeRealTgz(path.join(tmpRoot(), 'cache-3.3.1.tgz'), '3.3.1');
  const r = runGuard({ args: [tgz, rtRoot], env: { DSH_HOME: home } });
  assert.equal(r.status, 1, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
  assert.match(String(r.stdout), /REFUSED/);
  const logFile = path.join(GUARD_DIR, 'heal-refused.log');
  const logText = fs.readFileSync(logFile, 'utf8');
  assert.match(logText, /refuse DOWNGRADE cache=3\.3\.1 baseline=3\.3\.2/);
});

test('DGRD-07 守卫决策矩阵·缓存==基线放行 / 缓存>基线放行', () => {
  const home = tmpRoot();
  const rtRoot = tmpRoot();
  fs.writeFileSync(path.join(rtRoot, 'package.json'), '{"version":"3.3.2"}', 'utf8');
  sys.writeDeployLedgerEntry('web', '3.3.2', 'sync-runtime', { dshHome: home });
  const eq = runGuard({ args: [makeRealTgz(path.join(tmpRoot(), 'eq.tgz'), '3.3.2'), rtRoot], env: { DSH_HOME: home } });
  assert.equal(eq.status, 0, eq.stdout);
  const gt = runGuard({ args: [makeRealTgz(path.join(tmpRoot(), 'gt.tgz'), '3.4.0'), rtRoot], env: { DSH_HOME: home } });
  assert.equal(gt.status, 0, gt.stdout);
});

test('DGRD-08 守卫决策矩阵·双空盲区放行（首次安装场景不砖机）', () => {
  const home = tmpRoot(); // 无账本
  const rtRoot = tmpRoot(); // 无运行环境 package.json
  const r = runGuard({ args: [makeRealTgz(path.join(tmpRoot(), 'blind.tgz'), '3.3.2'), rtRoot], env: { DSH_HOME: home } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(String(r.stdout), /blind spot/);
});

test('DGRD-09 守卫决策矩阵·账本陈旧时以现读版本抬高基线（评审修正③核心向量）', () => {
  const home = tmpRoot();
  const rtRoot = tmpRoot();
  fs.writeFileSync(path.join(rtRoot, 'package.json'), '{"version":"3.4.0"}', 'utf8'); // 带外装了新版
  sys.writeDeployLedgerEntry('web', '3.3.2', 'sync-runtime', { dshHome: home }); // 账本陈旧
  // 若只比账本，缓存 3.3.3 ≥ 3.3.2 会被放行降级到 3.3.3——基线取 max 后必须拒绝
  const r = runGuard({ args: [makeRealTgz(path.join(tmpRoot(), 'stale.tgz'), '3.3.3'), rtRoot], env: { DSH_HOME: home } });
  assert.equal(r.status, 1, '陈旧账本不构成放行依据 stdout=' + r.stdout);
  assert.match(fs.readFileSync(path.join(GUARD_DIR, 'heal-refused.log'), 'utf8'), /baseline=3\.4\.0/);
});

test('DGRD-10 守卫决策矩阵·缓存版本不可读(损坏 tgz) → 拒绝（空版本分支显性失败）', () => {
  const home = tmpRoot();
  const rtRoot = tmpRoot();
  fs.writeFileSync(path.join(rtRoot, 'package.json'), '{"version":"3.3.2"}', 'utf8');
  sys.writeDeployLedgerEntry('web', '3.3.2', 'sync-runtime', { dshHome: home });
  const bad = path.join(tmpRoot(), 'corrupt.tgz');
  fs.writeFileSync(bad, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]), 'utf8'); // gzip 头+垃圾
  const r = runGuard({ args: [bad, rtRoot], env: { DSH_HOME: home } });
  assert.equal(r.status, 1);
  assert.match(String(r.stdout), /CACHE_VERSION_UNREADABLE|unreadable/i);
});

test('DGRD-11 守卫决策矩阵·缓存不存在 → 放行 exit 0（壳自身 no-package 分支处理）', () => {
  const home = tmpRoot();
  const r = runGuard({ args: [path.join(tmpRoot(), 'nope.tgz'), tmpRoot()], env: { DSH_HOME: home } });
  assert.equal(r.status, 0);
});

test('DGRD-12 紧急旁路旋钮：DSH_PE_HEAL_OVERRIDE=1 对必拒场景放行并留痕 bypass', () => {
  const home = tmpRoot();
  const rtRoot = tmpRoot();
  fs.writeFileSync(path.join(rtRoot, 'package.json'), '{"version":"3.3.2"}', 'utf8');
  sys.writeDeployLedgerEntry('web', '3.3.2', 'sync-runtime', { dshHome: home });
  const tgz = makeRealTgz(path.join(tmpRoot(), 'ovr.tgz'), '3.3.1');
  const r = runGuard({ args: [tgz, rtRoot], env: { DSH_HOME: home, DSH_PE_HEAL_OVERRIDE: '1' } });
  assert.equal(r.status, 0, '旁路必须放行 stdout=' + r.stdout);
  assert.match(String(r.stdout), /bypassed/);
  assert.match(fs.readFileSync(path.join(GUARD_DIR, 'heal-refused.log'), 'utf8'), /\] bypass DSH_PE_HEAL_OVERRIDE=1/);
});

test('DGRD-13 --mark 写入点④：恢复成功后回写账本 source=heal（tmp+rename 幂等覆盖）', () => {
  const home = tmpRoot();
  const rtRoot = tmpRoot();
  fs.writeFileSync(path.join(rtRoot, 'package.json'), '{"version":"3.5.0"}', 'utf8');
  sys.writeDeployLedgerEntry('web', '3.3.2', 'sync-runtime', { dshHome: home });
  const r = runGuard({ args: ['--mark', rtRoot], env: { DSH_HOME: home } });
  assert.equal(r.status, 0, r.stdout);
  const led = sys.readDeployLedger({ dshHome: home });
  assert.equal(led.profiles.web.version, '3.5.0');
  assert.equal(led.profiles.web.source, 'heal');
  assert.ok(Number.isInteger(led.profiles.web.ts));
});

test('DGRD-14 B-5 漂移锚：守卫内联 cmpVersions 与 maintain-lib.compareSemver 向量行为一致', () => {
  const src = indexMod.buildHealGuardScript();
  const m = /function cmpVersions\(a, b\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(m, '守卫脚本缺 cmpVersions 函数文本');
  const cmp = new Function(m[0] + '\nreturn cmpVersions;')();
  const vectors = [
    ['3.3.1', '3.3.2'], ['3.3.2', '3.3.2'], ['3.4.0', '3.3.99'],
    ['v3.0.0', '2.9.9'], ['0.1.0', '0.1.0'], ['10.0.0', '9.99.99'],
  ];
  for (const [a, b] of vectors) {
    assert.equal(cmp(a, b), M.compareSemver(a, b), '向量不一致: ' + a + ' vs ' + b);
  }
  for (const bad of ['', 'abc', '1.2']) {
    assert.equal(cmp(bad, '3.3.2'), null, '非法输入应 null: ' + JSON.stringify(bad));
    assert.equal(M.compareSemver(bad, '3.3.2') === null || typeof M.compareSemver(bad, '3.3.2') === 'number', true);
  }
});

test('DGRD-15 壳接线契约：buildWebMenuCmdBody :heal 段含守卫前置/拒绝跳转/--mark 回写', () => {
  const buf = indexMod.buildWebMenuCmdBody({
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    target: 'C:\\rt\\lib\\updater-host.cjs',
    svc: 'dsh-web', profile: 'web', locale: 'en',
    runtimeRoot: 'C:\\rt',
  });
  const body = buf.toString('ascii');
  assert.ok(body.includes('dsh-heal-guard.cjs'), '壳未引用守卫脚本');
  assert.ok(body.includes('"GUARD=%~dp0dsh-heal-guard.cjs"'), '守卫路径变量缺失');
  assert.ok(/if exist "%GUARD%" .* "%NEWEST%" "C:\\rt"/.test(body), '判定调用缺失');
  assert.ok(body.includes('goto minfix'), '拒绝路径未跳转裸救援');
  assert.ok(/--mark "C:\\rt"/.test(body), '恢复成功后未回写账本');
  assert.ok(!/[^\x00-\x7F]/.test(body.toString('latin1')), '壳必须纯 ASCII');
});

/* ---------------- 五项一致性自检 ---------------- */

function buildAuditFixture(opts) {
  const o = opts || {};
  const home = tmpRoot();
  const cacheDir = path.join(home, 'profiles', 'web', 'plugins', 'dsh-prompt-enhancer-tgz');
  const runtimeDir = path.join(home, 'profiles', 'web', 'node_modules', 'dsh-prompt-enhancer');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const pj = { dependencies: o.deps || {} };
  fs.writeFileSync(path.join(home, 'profiles', 'web', 'package.json'), JSON.stringify(pj), 'utf8');
  fs.writeFileSync(path.join(runtimeDir, 'package.json'), JSON.stringify({ version: o.runtimeVer || '' }), 'utf8');
  let cachedFile = null;
  if (o.cacheVer !== undefined) {
    cachedFile = makeRealTgz(path.join(cacheDir, 'dsh-prompt-enhancer-' + o.cacheVer + '.tgz'), o.cacheVer);
    if (o.sidecar) fs.writeFileSync(cachedFile + '.sha256', o.sidecar + '\n', 'utf8');
  }
  if (o.ledger) sys.writeDeployLedgerEntry('web', o.ledger.version, o.ledger.source || 'sync-runtime', { dshHome: home });
  return { home, cacheDir, runtimeDir, cachedFile };
}

test('DGRD-16 自检五项全 PASS 形态（缓存+sidecar 匹配+无 file: 依赖+账本一致）', () => {
  const fx = buildAuditFixture({ cacheVer: '3.3.2', sidecar: null, runtimeVer: '3.3.2', ledger: { version: '3.3.2' } });
  // 补真实 sha256 sidecar
  const crypto = require('node:crypto');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(fx.cachedFile)).digest('hex');
  fs.writeFileSync(fx.cachedFile + '.sha256', hash + '\n', 'utf8');
  const r = M.auditInstallConsistency({ dshHome: fx.home, profileName: 'web' });
  const byKey = Object.fromEntries(r.findings.map((f) => [f.key, f]));
  assert.equal(byKey['cache-tgz'].level, 'PASS');
  assert.equal(byKey['profile-file-deps'].level, 'PASS');
  assert.equal(byKey['cache-version'].level, 'PASS');
  assert.equal(byKey['deploy-ledger'].level, 'PASS');
  assert.equal(byKey['volatile-file-deps'].level, 'PASS');
  assert.equal(r.ok, true);
});

test('DGRD-17 自检 FAIL 形态×3：sha256 失配 / 悬空 file: 依赖 / 缓存<基线', () => {
  // ① sha256 失配
  {
    const fx = buildAuditFixture({ cacheVer: '3.3.2', sidecar: 'f'.repeat(64), runtimeVer: '3.3.2', ledger: { version: '3.3.2' } });
    const r = M.auditInstallConsistency({ dshHome: fx.home, profileName: 'web' });
    const f1 = r.findings.find((x) => x.key === 'cache-tgz');
    assert.equal(f1.level, 'FAIL');
    assert.equal(r.ok, false);
  }
  // ② 悬空 file: 依赖
  {
    const fx = buildAuditFixture({
      cacheVer: '3.3.2', runtimeVer: '3.3.2',
      deps: { 'dsh-prompt-enhancer': 'file:C:/definitely/not/exist/pkg.tgz' },
      ledger: { version: '3.3.2' },
    });
    const r = M.auditInstallConsistency({ dshHome: fx.home, profileName: 'web' });
    const f2 = r.findings.find((x) => x.key === 'profile-file-deps');
    assert.equal(f2.level, 'FAIL');
    assert.match(f2.detail, /悬空/);
    assert.equal(r.ok, false);
  }
  // ③ 缓存 < 基线（守卫同款 max 判定）
  {
    const fx = buildAuditFixture({ cacheVer: '3.3.1', runtimeVer: '3.3.2', ledger: { version: '3.3.2' } });
    const r = M.auditInstallConsistency({ dshHome: fx.home, profileName: 'web' });
    const f3 = r.findings.find((x) => x.key === 'cache-version');
    assert.equal(f3.level, 'FAIL');
    assert.match(f3.detail, /3\.3\.1 < 部署基线 3\.3\.2/);
    assert.equal(r.ok, false);
  }
});

test('DGRD-18 自检 WARN 形态：无缓存 / 账本缺失 / staging 易失引用（B-6 结论落地）', () => {
  // 无缓存 + 无账本
  {
    const fx = buildAuditFixture({ runtimeVer: '3.3.2' });
    const r = M.auditInstallConsistency({ dshHome: fx.home, profileName: 'web' });
    assert.equal(r.findings.find((x) => x.key === 'cache-tgz').level, 'WARN');
    assert.equal(r.findings.find((x) => x.key === 'cache-version').level, 'WARN');
    assert.equal(r.findings.find((x) => x.key === 'deploy-ledger').level, 'WARN');
    assert.equal(r.ok, true, 'WARN 不算 FAIL');
  }
  // 存在但指向 executor staging 的 file: 依赖 → 易失 WARN（⑤判定细则直接验证）
  {
    const root = tmpRoot();
    const stagingSim = path.join(root, 'staging');
    fs.mkdirSync(stagingSim, { recursive: true });
    fs.writeFileSync(path.join(stagingSim, 'pkg.tgz'), 'x', 'utf8');
    const home = tmpRoot();
    const dirWeb = path.join(home, 'profiles', 'web');
    fs.mkdirSync(dirWeb, { recursive: true });
    fs.writeFileSync(path.join(dirWeb, 'package.json'),
      JSON.stringify({ dependencies: { 'some-plugin': 'file:' + path.join(stagingSim, 'pkg.tgz') } }), 'utf8');
    // inStaging 判定经 scanFileDeps 注入 executorRootOverride 验证（B-6：rename 搬迁后原路径悬空）
    const deps = M.scanFileDeps(path.join(dirWeb, 'package.json'), root);
    assert.equal(deps.length, 1);
    assert.equal(deps[0].exists, true);
    assert.equal(deps[0].inStaging, true, '指向 <root>/staging 的依赖必须判易失');
    fs.rmSync(path.join(stagingSim, 'pkg.tgz'), { force: true });
    const depsAfter = M.scanFileDeps(path.join(dirWeb, 'package.json'), root);
    assert.equal(depsAfter[0].exists, false, '文件消失后必须判悬空');
  }
});

test('DGRD-19 菜单渲染层：runInstallConsistencyAudit 输出五项与结论行（io 注入）', async () => {
  const lines = [];
  const io = { out: (s) => lines.push(String(s)) };
  const fx = buildAuditFixture({ cacheVer: '3.3.1', runtimeVer: '3.3.2', ledger: { version: '3.3.2' } });
  await updater.runInstallConsistencyAudit(io, 'web', { auditOpts: { dshHome: fx.home, profileName: 'web' } });
  const text = lines.join('\n');
  for (const key of ['cache-tgz', 'profile-file-deps', 'cache-version', 'deploy-ledger', 'volatile-file-deps']) {
    assert.ok(text.includes(key), '缺少检查项输出: ' + key);
  }
  assert.match(text, /\[x\] cache-version/);
  assert.match(text, /存在 FAIL 项/);
});
