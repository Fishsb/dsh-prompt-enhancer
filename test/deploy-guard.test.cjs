'use strict';
// 批次B（P0-2 部署账本 + P1-3 一致性自检）契约测试。
// 覆盖：账本读写原子性与注入缝、profileDir 口径统一与 BOM 容错、
// 五项自检 PASS/WARN/FAIL 夹具、自检渲染层接线。
// 2026-09-13（用户指令·移除插件内重启能力）：heal 守卫生成器 buildHealGuardScript 与
// 菜单壳生成器 buildWebMenuCmdBody 已随重启/自愈链一并删除 → 原 DGRD-06~15（守卫决策矩阵
// e2e + 决策比较器漂移锚 + 壳接线契约）的受测对象不存在，整段移除（不复用其夹具）。
// 保留：DGRD-01~05（账本/profileDir/BOM 容错）、DGRD-16~19（五项一致性自检，零重启依赖）。
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
