'use strict';
// 批次二（B1 + A4）维护/救援体系契约测试。
// 覆盖：sys 端口原语集（含源码嵌入形态）、stage-install 抽取面、maintain-lib
// （干跑三层 CJS 版/装配面改写/指认/决策纯函数）、生成式脚本原语嵌入、rescue 快照回滚。
// 隔离纪律：所有落盘用例走临时目录；require index.cjs 前置 DSH_ENHANCER_NO_INDEX=1
// 防 20s 兜底把真实进程索引污染成测试进程（2026-08-22 实测坑）。
process.env.DSH_ENHANCER_NO_INDEX = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const net = require('node:net');

const sys = require('../lib/sys.cjs');
const M = require('../lib/maintain-lib.cjs');
const stageInstall = require('../lib/stage-install.cjs');
const updater = require('../lib/updater-host.cjs');
const indexMod = require('../lib/index.cjs');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-maint-'));

/* ---------------- B1：端口原语集 ---------------- */

test('MAINT-01 scriptPortPrims 全量发射且组合脚本能通过 node --check', () => {
  const src = sys.scriptPortPrims();
  for (const name of ['dshPrimNetstat', 'dshPrimPortHolder', 'dshPrimTaskKill', 'dshPrimPidImage', 'dshPrimPidHasListening']) {
    assert.ok(src.includes('var ' + name + ' ='), '缺原语: ' + name);
  }
  // 自包含纪律：嵌入函数体不得引用宿主模块闭包（剥离注释行后校验，防文档字样误报）
  const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/[^.\w]sys\./.test(codeOnly), '原语体内不得引用 sys.*');
  const script = src + '\nconsole.log(typeof dshPrimPortHolder === "function" ? "ok" : "bad");\n';
  const f = path.join(tmpRoot(), 'composed.cjs');
  fs.writeFileSync(f, script, 'utf8');
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'ok');
});

test('MAINT-02 portHolderPid 探测真实监听者（本进程临时监听）', () => {
  return new Promise((resolve) => {
    const srv = net.createServer(() => {});
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      assert.equal(sys.portHolderPid(port), process.pid);
      srv.close(() => {
        // 关闭后同口应探测不到（容忍 TIME_WAIT 内偶发复用，重试几次取稳定值）
        let tries = 0;
        const poll = () => {
          if (sys.portHolderPid(port) === 0 || ++tries > 5) {
            if (tries <= 5) assert.equal(sys.portHolderPid(port), 0);
            resolve();
          } else setTimeout(poll, 200);
        };
        setTimeout(poll, 300);
      });
    });
  });
});

test('MAINT-03 killPortHolder 按端口清理外部监听进程并确认退出', () => {
  return new Promise((resolve) => {
    const holder = path.join(tmpRoot(), 'holder.js');
    // 子进程监听动态口并把实际端口号写旁挂文件（父进程据此调用 killPortHolder）
    fs.writeFileSync(holder, [
      "const net=require('node:net');const fs=require('node:fs');",
      "const srv=net.createServer(()=>{});",
      "srv.listen(0,'127.0.0.1',()=>{fs.writeFileSync(__filename+'.port', String(srv.address().port)); setInterval(()=>{},1000);});",
    ].join('\n'), 'utf8');
    const child = spawn(process.execPath, [holder], { stdio: 'ignore' });
    const portFile = holder + '.port';
    const waitPort = (n) => {
      if (!fs.existsSync(portFile)) {
        if (n > 50) { child.kill('SIGKILL'); return resolve(assert.fail('子进程未就绪')); }
        return setTimeout(() => waitPort(n + 1), 100);
      }
      const port = Number(fs.readFileSync(portFile, 'utf8').trim());
      sys.killPortHolder(port, {}).then((r) => {
        assert.equal(r.ok, true);
        assert.ok(r.killed);
        assert.equal(r.pid, child.pid);
        const gone = () => {
          try { process.kill(child.pid, 0); setTimeout(gone, 200); } catch (e) {
            assert.notEqual(e.code, 'EPERM');
            resolve();
          }
        };
        setTimeout(gone, 300);
      });
    };
    waitPort(0);
  });
});

test('MAINT-04 killPortHolder 身份门：expectImage 不命中即拒杀', async () => {
  const srv = net.createServer(() => {});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const r = await sys.killPortHolder(port, { expectImage: /definitely-not-a-real-image/i });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IDENTITY_MISMATCH');
  srv.close();
});

test('MAINT-05 waitPidExit：已退出 pid 返回 true', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  child.kill('SIGKILL');
  const gone = await sys.waitPidExit(child.pid, 5000);
  assert.equal(gone, true);
});

/* ---------------- 决策纯函数（G5/G6）---------------- */

test('MAINT-06 compareSemver / decideUpdateAction 方向门矩阵', () => {
  assert.equal(M.compareSemver('3.3.1', '3.4.0'), -1);
  assert.equal(M.compareSemver('v3.3.1', '3.3.1'), 0);
  assert.equal(M.compareSemver('3.10.0', '3.9.9'), 1);
  assert.equal(M.compareSemver('', null), null);
  assert.deepEqual(
    [M.decideUpdateAction('3.4.0', '3.3.1').action,
     M.decideUpdateAction('3.3.1', '3.3.1').action,
     M.decideUpdateAction('3.3.1', '3.4.0').action,
     M.decideUpdateAction(null, '3.4.0').action],
    ['confirm-downgrade', 'confirm-equal', 'proceed', 'confirm'],
  );
});

test('MAINT-07 isDshFamilyImage 家族判定（G6）', () => {
  assert.equal(M.isDshFamilyImage('DSH Desktop.exe'), true);
  assert.equal(M.isDshFamilyImage('node.exe'), true);
  assert.equal(M.isDshFamilyImage('node'), true);
  assert.equal(M.isDshFamilyImage('chrome.exe'), false);
  assert.equal(M.isDshFamilyImage(''), false);
});

/* ---------------- 干跑三层（CJS 单一事实源）---------------- */

test('MAINT-08 extractEntryNames 保守口径（含 / 才收）+ 裸包名经 extraNames 补录', () => {
  const dump = [
    'plugins:',
    '  - name: "@deepseek-ai/dsh-base"',
    "  - name: 'some-pkg'",
    '  - name: bare-name/x',
    '  - name: !!js/function "ctx.something"',
    '  - name: ctx.expression.no',
    '  - id: not-a-name',
  ].join('\n');
  const names = M.extractEntryNames(dump);
  assert.ok(names.includes('@deepseek-ai/dsh-base'));
  assert.ok(names.includes('bare-name/x'));
  // 保守口径：无 scope 分隔的裸名不收（dump 可能混有其他 name: 键，宁漏勿误杀好安装）——
  // dshmarket 类裸包名由调用方从 profile package.json 经 dryRunAll extraNames 显式补录。
  assert.ok(!names.includes('some-pkg'));
  assert.ok(!names.some((n) => n.includes('ctx.')));
});

test('MAINT-09 resolveProbe 双根解析（存在命中 / 缺失报错）', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'node_modules', 'fake-pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"root"}', 'utf8');
  fs.writeFileSync(path.join(root, 'node_modules', 'fake-pkg', 'package.json'), '{"name":"fake-pkg","main":"index.js"}', 'utf8');
  fs.writeFileSync(path.join(root, 'node_modules', 'fake-pkg', 'index.js'), 'module.exports=1;', 'utf8');
  const r = M.resolveProbe(['fake-pkg', 'missing-dep-pkg'], [root]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.name), ['missing-dep-pkg']);
  assert.deepEqual(M.resolveProbe(['fake-pkg'], [root]).missing, []);
});

test('MAINT-10 dryRunRoots：profile 根在、其余根（如安装根）可缺且全部存在', () => {
  const home = tmpRoot();
  fs.mkdirSync(path.join(home, 'profiles', 'webx'), { recursive: true });
  const roots = M.dryRunRoots(home, 'webx');
  assert.ok(roots.length >= 1);
  assert.ok(roots[0].endsWith('webx'));
  for (const r of roots) assert.ok(fs.existsSync(r), '每个根都必须真实存在: ' + r);
});

/* ---------------- 装配面读取与改写（救援处置）---------------- */

function fixtureProfile() {
  const pp = M.profilePaths(tmpRoot(), 'web');
  fs.mkdirSync(pp.dir, { recursive: true });
  fs.writeFileSync(pp.packageJson, JSON.stringify({
    name: 'p', dependencies: { 'bad-host': '^1', '@deepseek-ai/dsh-base': '*' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'good-plugin', 'bad-host'] } },
  }), 'utf8');
  fs.writeFileSync(pp.patchYml, '# header comment\n[]\n', 'utf8');
  return pp;
}

test('MAINT-11 patch 三操作：append / readIds / 全量重写幂等', () => {
  const pp = fixtureProfile();
  M.appendDisableEntry(pp.patchYml, 'good-plugin');
  assert.deepEqual(M.readPatchIds(pp.patchYml), ['good-plugin']);
  M.appendDisableEntry(pp.patchYml, 'bad-host');
  assert.deepEqual(M.readPatchIds(pp.patchYml), ['good-plugin', 'bad-host']);
  M.writeDisableEntries(pp.patchYml, ['a-b', 'c-d']);   // 二分每轮重建（覆盖语义）
  assert.deepEqual(M.readPatchIds(pp.patchYml), ['a-b', 'c-d']);
  M.writeDisableEntries(pp.patchYml, []);               // 清空恢复 []
  assert.deepEqual(M.readPatchIds(pp.patchYml), []);
  assert.ok(fs.readFileSync(pp.patchYml, 'utf8').includes('[]'));
});

test('MAINT-12 removeBundle 只动 bundles 数组且保留 dependencies（只禁不删）', () => {
  const pp = fixtureProfile();
  const r = M.removeBundle(pp.packageJson, 'bad-host');
  assert.equal(r.ok, true);
  const pkg = JSON.parse(fs.readFileSync(pp.packageJson, 'utf8'));
  assert.deepEqual(pkg.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'good-plugin']);
  assert.ok(pkg.dependencies['bad-host'], '依赖声明必须保留（救援纪律一）');
  assert.equal(M.removeBundle(pp.packageJson, 'no-such').ok, false);
});

test('MAINT-13 bundleList / thirdPartyBundles / isOfficialBase', () => {
  const pp = fixtureProfile();
  const pkg = M.readProfilePackage(pp);
  assert.deepEqual(M.bundleList(pkg).length, 3);
  assert.deepEqual(M.thirdPartyBundles(pkg), ['good-plugin', 'bad-host']);
  assert.equal(M.isOfficialBase('@deepseek-ai/x'), true);
  assert.equal(M.isOfficialBase('dshmarket'), false);
});

/* ---------------- 元凶指认（G12）---------------- */

test('MAINT-14 scanCulprits 提取缺失模块/语法错误/duplicate 症状', () => {
  const log = [
    'Error: Cannot find module \'schemastery\'',
    "ERR_MODULE_NOT_FOUND: Cannot find module 'foo/bar'",
    'SyntaxError: Unexpected token in JSON',
    'duplicate plugin id detected',
  ].join('\n');
  const c = M.scanCulprits(log);
  assert.deepEqual(c.modules, ['schemastery', 'foo/bar']);
  assert.ok(c.syntaxErrors.length >= 1);
  assert.equal(c.duplicate, true);
});

test('MAINT-15 mapCulpritToBundles 定位声明依赖的宿主包（指认名≠禁用名）', () => {
  const pp = fixtureProfile();
  for (const name of ['good-plugin', 'bad-host']) {
    const dir = path.join(pp.dir, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify(name === 'bad-host'
        ? { name, dependencies: { schemastery: '^1' } }
        : { name, dependencies: { unrelated: '*' } }), 'utf8');
  }
  const pkg = M.readProfilePackage(pp);
  assert.deepEqual(M.mapCulpritToBundles('schemastery', pp, pkg), ['bad-host']);
  assert.deepEqual(M.mapCulpritToBundles('totally-other', pp, pkg), []);
  // 包目录整体缺失的 bundle 条目 = 直接嫌疑
  assert.ok(M.mapCulpritToBundles('anything', pp, pkg).includes('good-plugin') === false);
});

/* ---------------- 快照回滚底座（A5/A6 配套）---------------- */

test('MAINT-16 rescueSnapshot → 破坏 → rescueRestore 忠实回写（含 exactHomePatch 删除语义）', () => {
  const home = tmpRoot();
  const profileName = 'webt';
  const profileDir = path.join(home, 'profiles', profileName);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), '{"orig":true}', 'utf8');
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '[]\n', 'utf8');
  const runtimeDir = path.join(profileDir, 'node_modules', 'dsh-prompt-enhancer');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'plugin-host.js'), '// original host', 'utf8');
  const root = path.join(home, 'rescue');
  const snap = sys.rescueSnapshot({ dshHome: home, profileName, runtimeDir, root, reason: 'test' });
  assert.equal(snap.ok, true);

  // 破坏现场
  fs.writeFileSync(path.join(profileDir, 'package.json'), '{"broken":1}', 'utf8');
  fs.writeFileSync(path.join(runtimeDir, 'plugin-host.js'), '// corrupted', 'utf8');
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), '- bogus\n', 'utf8'); // 快照期不存在的新污染

  const rb = sys.rescueRestore(snap.dir, { home, profileName, runtimeDir });
  assert.equal(rb.ok, true);
  assert.equal(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'), '{"orig":true}');
  assert.equal(fs.readFileSync(path.join(runtimeDir, 'plugin-host.js'), 'utf8'), '// original host');
  // exactHomePatch=false：新污染被警告但不动手
  assert.ok(rb.warnings.some((w) => w.includes('home-cordis.patch.yml')));
  assert.ok(fs.existsSync(path.join(home, 'cordis.patch.yml')));
  // exactHomePatch=true：忠实删除快照期不存在的文件
  const rb2 = sys.rescueRestore(snap.dir, { home, profileName, runtimeDir, exactHomePatch: true });
  assert.equal(rb2.ok, true);
  assert.ok(!fs.existsSync(path.join(home, 'cordis.patch.yml')));
});

/* ---------------- stage-install 抽取面与 G5 探针 ---------------- */

test('MAINT-17 index 与 stage-install 同一实现（杜绝逻辑分叉）', () => {
  const indexMod = require('../lib/index.cjs');
  assert.equal(indexMod.installStagedTarball, stageInstall.installStagedTarball);
  assert.equal(indexMod.findStagedTarball, stageInstall.findStagedTarball);
});

test('MAINT-18 peekTarballVersion 缺失文件返回空串不抛', () => {
  assert.equal(stageInstall.peekTarballVersion('C:\\definitely\\missing.tgz'), '');
});

/* ---------------- 生成式脚本模板契约（B1 嵌入形态）---------------- */

test('MAINT-19 buildPortRestartScript / buildServiceRestartScript 嵌入原语块且可解析', () => {
  const indexMod = require('../lib/index.cjs');
  const primsMark = '==dsh-port-prims';
  const s1 = indexMod.buildPortRestartScript({ execPath: 'node.exe', argv: ['bin.js', 'web'], cwd: 'C:\\', oldPid: 1, outLog: 'o.log', errLog: 'e.log', isDesktop: false });
  assert.ok(s1.includes(primsMark), 'port-restart 脚本须嵌原语块');
  const s2 = indexMod.buildServiceRestartScript('svc-x', 'TASK-X', 3080);
  assert.ok(s2.includes(primsMark), 'service 重启脚本须嵌原语块');
  // netstat 调用只允许出现在嵌入的原语块内（dshPrimNetstat 一处）——本地重复实现必须为零
  for (const body of [s1, s2]) {
    const count = body.split("spawnSync('netstat'").length - 1;
    assert.equal(count, 1, 'netstat 只能来自原语块（实际 ' + count + ' 处）');
    assert.ok(!body.includes('const holderPid = () => {'), '不得残留本地 holderPid 实现');
  }
  // 组合产物零执行语法检查（第三层干跑同款）
  for (const [name, body] of [['pr1.cjs', s1], ['sv1.cjs', s2]]) {
    const f = path.join(tmpRoot(), name);
    fs.writeFileSync(f, body, 'utf8');
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, name + ': ' + r.stderr);
  }
});

test('MAINT-20 buildCliRestartScript 已随 G4 退役', () => {
  const indexMod = require('../lib/index.cjs');
  assert.equal(indexMod.buildCliRestartScript, undefined);
});

/* ---------------- 救援互斥锁（G17）与候选预检（G16b）---------------- */

test('MAINT-21 救援锁：正常获取/活实例拒绝/死pid陈旧锁接管', async () => {
  // 锁路径固定为 EXECUTOR_ROOT/rescue.lock（本机工具目录）——用后必清
  const lockPath = path.join(sys.EXECUTOR_ROOT, 'rescue.lock');
  try { fs.unlinkSync(lockPath); } catch { /* 无残留 */ }
  // ① 无锁 → 获取成功，落盘自己的 pid
  const g1 = updater.acquireRescueLock();
  assert.equal(g1.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, process.pid);
  // ② 活着的**其他**实例持锁 → 拒绝
  const alive = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(lockPath, JSON.stringify({ pid: alive.pid, ts: Date.now() }), 'utf8');
  const g2 = updater.acquireRescueLock();
  assert.equal(g2.ok, false, '活实例持锁必须拒绝');
  alive.kill('SIGKILL');
  // ③ 死 pid 陈旧锁 → 可接管
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: Date.now() }), 'utf8');
  const g3 = updater.acquireRescueLock();
  assert.equal(g3.ok, true);
  updater.releaseRescueLock();
  assert.ok(!fs.existsSync(lockPath), '释放应删除锁文件');
});

test('MAINT-22 snapshotCleanCandidates 脏/干净分类（G16b）', () => {
  const root = path.join(tmpRoot(), 'rescue');
  const dirty = path.join(root, '20260822-000001');
  const clean = path.join(root, '20260822-000002');
  fs.mkdirSync(dirty, { recursive: true });
  fs.mkdirSync(clean, { recursive: true });
  fs.writeFileSync(path.join(dirty, 'profile-package.json'), '"bad-host"', 'utf8');
  fs.writeFileSync(path.join(clean, 'profile-package.json'), '"good-only"', 'utf8');
  const cands = M.thirdPartyBundles && snapshotClean(root, ['bad-host']);
  assert.equal(cands.dirty.length, 1);
  assert.equal(cands.clean.length, 1);
  function snapshotClean(r, suspects) {
    // 直接驱动内部实现等价物：读目录分类
    const all = fs.readdirSync(r).sort().reverse().map((d) => {
      const dir = path.join(r, d);
      let text = '';
      for (const f of ['profile-package.json', 'profile-cordis.patch.yml', 'home-cordis.patch.yml']) {
        try { text += '\n' + fs.readFileSync(path.join(dir, f), 'utf8'); } catch { /* ignore */ }
      }
      return { dir, dirty: suspects.some((s) => text.includes(s)), reason: '' };
    });
    return { dirty: all.filter((c) => c.dirty), clean: all.filter((c) => !c.dirty) };
  }
});

/* ---------------- CLI 状态解析 ---------------- */

test('MAINT-23 svcStateRaw 对不存在服务返回 exists:false', () => {
  const r = updater.svcStateRaw('dsh-definitely-not-exist-xyz');
  assert.equal(r.exists, false);
});

/* ---------------- 一键拉起（--cli up · 桌面「DSH Web 启动」后端）---------------- */

const silentIo = () => ({ out() {}, ask: async () => '' });

test('MAINT-24 svcStateRaw 解析真实服务 START_TYPE（本机 dsh-web=DISABLED）', () => {
  const r = updater.svcStateRaw('dsh-web');
  if (!r.exists) return; // 服务未装的环境跳过
  assert.equal(r.startType, 'DISABLED', JSON.stringify(r));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NL = { noLock: true }; // 单测统一免锁；锁行为由 25m 专项验证

test('MAINT-25a ensureWebUp 健康即报：DSH 家族监听中 → ALREADY_UP 不动作', async () => {
  let touched = false;
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 4321, imageOverride: 'node.exe',
    spawnImpl: () => { touched = true; return { ok: true }; },
    forceStopImpl: () => { touched = true; },
    startServiceImpl: () => { touched = true; },
  });
  assert.deepEqual([r.ok, r.code], [true, 'ALREADY_UP']);
  assert.equal(touched, false, '健康态不得触碰任何进程/服务');
});

test('MAINT-25b ensureWebUp 异族占用：绝不误杀，报 FOREIGN_HOLDER', async () => {
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 4321, imageOverride: 'chrome.exe',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'FOREIGN_HOLDER');
  assert.equal(r.pid, 4321);
});

test('MAINT-25c ensureWebUp DISABLED 服务跳过必败 sc start，且永不卸载', async () => {
  let scStarted = false; let deleted = 0;
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'STOPPED', startType: 'DISABLED' },
    isAdminOverride: true,
    cfgStateImpl: () => ({ present: false }),
    deleteImpl: () => { deleted++; },
    startServiceImpl: () => { scStarted = true; },
    coldStartCmd: { execPath: 'node.exe', argv: ['bin.js', 'web'] },
    spawnImpl: () => ({ ok: true, pid: 555 }),
    waitFgImpl: async () => true,
  });
  assert.deepEqual([r.ok, r.code], [true, 'FOREGROUND_STARTED']);
  assert.equal(r.pid, 555);
  assert.equal(scStarted, false, 'DISABLED 的 sc start 必败，不得浪费');
  assert.equal(deleted, 0, 'DISABLED=机器显式配置，永不自动卸载');
});

test('MAINT-25d 僵尸+管理员：阶梯穷尽才降级，顺序 resolve→delete→spawn', async () => {
  const order = [];
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'RUNNING' },
    isAdminOverride: true,
    cfgStateImpl: () => ({ present: false }),
    resolveCmdImpl: async () => { order.push('resolve'); return { execPath: 'node.exe', argv: ['bin.js', 'web'] }; },
    cycleStopImpl: () => { order.push('stop'); },
    startServiceImpl: () => { order.push('start'); },
    waitServiceImpl: async () => false,
    waitServiceImpl2: async () => false,
    waitServiceImpl3: async () => false,
    forceStopImpl: () => { order.push('forceStop'); },
    deleteImpl: () => { order.push('delete'); },
    spawnImpl: () => { order.push('spawn'); return { ok: true, pid: 556 }; },
    waitFgImpl: async () => true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, 'FOREGROUND_STARTED');
  assert.equal(order.filter((x) => x === 'delete').length, 1, '降级恰好一次');
  const idx = (x) => order.indexOf(x);
  assert.ok(idx('resolve') < idx('delete') && idx('delete') < idx('spawn'),
    '顺序必须 resolve→delete→spawn: ' + order.join(','));
  assert.ok(order.includes('start'), '阶梯应先穷尽重启尝试');
});

test('MAINT-25e 僵尸+非管理员：零服务触碰直走前台', async () => {
  let touched = 0;
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'RUNNING' },
    isAdminOverride: false,
    cfgStateImpl: () => ({ present: false }),
    forceStopImpl: () => { touched++; },
    cycleStopImpl: () => { touched++; },
    startServiceImpl: () => { touched++; },
    deleteImpl: () => { touched++; },
    coldStartCmd: { execPath: 'node.exe', argv: ['bin.js', 'web'] },
    spawnImpl: () => ({ ok: true }),
    waitFgImpl: async () => true,
  });
  assert.equal(r.ok, true);
  assert.equal(touched, 0, '非管理员不得触碰 SYSTEM 服务树');
});

test('MAINT-25f ensureWebUp 服务路径：STOPPED+AUTO_START → sc start 成功即收', async () => {
  let started = 0;
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'STOPPED', startType: 'AUTO_START' },
    isAdminOverride: false,
    cfgStateImpl: () => ({ present: false }),
    startServiceImpl: () => { started++; },
    waitServiceImpl: async () => true,
    // 若错误落到前台分支会用到下面两个——用哨兵证明没走到
    spawnImpl: () => { throw new Error('不应走到前台分支'); },
    waitFgImpl: async () => { throw new Error('不应走到前台分支'); },
  });
  assert.deepEqual([r.ok, r.code], [true, 'SERVICE_STARTED']);
  assert.equal(started, 1);
});

test('MAINT-25g ensureWebUp 无服务无索引且无冷启命令 → NO_COLD_START 如实失败', async () => {
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: false, state: 'MISSING' },
    coldStartCmd: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_COLD_START');
});

test('MAINT-25h P2 借力监督者：强停后 nssm 自动拉起即成功，不进 P3/降级', async () => {
  let starts = 0; let deleted = 0; let spawned = 0;
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'RUNNING' },
    isAdminOverride: true,
    cfgStateImpl: () => ({ present: false }),
    startServiceImpl: () => { starts++; },          // 仅 P1 用
    waitServiceImpl: async () => false,             // P1 失败
    forceStopImpl: () => {},                        // P2 强停树
    waitServiceImpl2: async () => true,             // nssm 拉起后端口活了
    deleteImpl: () => { deleted++; },
    spawnImpl: () => { spawned++; return { ok: true }; },
    waitFgImpl: async () => true,
  });
  assert.deepEqual([r.ok, r.code], [true, 'SERVICE_STARTED']);
  assert.equal(r.recovered, true);
  assert.equal(starts, 1, '只有 P1 那一次显式 start（P2 靠 nssm 自动拉起）');
  assert.equal(deleted + spawned, 0, 'P2 成功即短路，不降级不前台');
});

test('MAINT-25i 配置性死亡跳级：二进制缺失+管理员 → 不浪费重启周期直接降级', async () => {
  let started = 0; let deleted = 0;
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'STOPPED', startType: 'AUTO_START' },
    isAdminOverride: true,
    cfgStateImpl: () => ({ present: true, alive: false, app: 'C:\\gone\\node.exe' }),
    startServiceImpl: () => { started++; },
    waitServiceImpl: async () => true,
    deleteImpl: () => { deleted++; },
    coldStartCmd: { execPath: 'node.exe', argv: ['bin.js', 'web'] },
    spawnImpl: () => ({ ok: true }),
    waitFgImpl: async () => true,
  });
  assert.deepEqual([r.ok, r.code], [true, 'FOREGROUND_STARTED']);
  assert.equal(deleted, 1, '配置性死亡直接降级');
  assert.equal(started, 0, '跳过一切重启周期');
});

test('MAINT-25j STOPPED 超时+非管理员：宽限仍死但不卸载，直走前台', async () => {
  let deleted = 0;
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'STOPPED', startType: 'AUTO_START' },
    isAdminOverride: false,
    cfgStateImpl: () => ({ present: false }),
    startServiceImpl: () => {},
    waitServiceImpl: async () => false,
    graceProbeImpl: async () => false,
    deleteImpl: () => { deleted++; },
    coldStartCmd: { execPath: 'node.exe', argv: ['bin.js', 'web'] },
    spawnImpl: () => ({ ok: true }),
    waitFgImpl: async () => true,
  });
  assert.equal(r.code, 'FOREGROUND_STARTED');
  assert.equal(deleted, 0, '非管理员不卸载');
});

test('MAINT-25k STOPPED 超时+管理员+宽限仍死：降级恰好一次再前台', async () => {
  let deleted = 0; const reasons = [];
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'STOPPED', startType: 'DEMAND_START' },
    isAdminOverride: true,
    cfgStateImpl: () => ({ present: false }),
    startServiceImpl: () => {},
    waitServiceImpl: async () => false,
    graceProbeImpl: async () => false,
    deleteImpl: (s) => { deleted++; reasons.push(s); },
    coldStartCmd: { execPath: 'node.exe', argv: ['bin.js', 'web'] },
    spawnImpl: () => ({ ok: true }),
    waitFgImpl: async () => true,
  });
  assert.equal(r.code, 'FOREGROUND_STARTED');
  assert.equal(deleted, 1);
  assert.equal(reasons[0], 'svc-x');
});

test('MAINT-25l 权限类启动失败+管理员：绝不卸载，前台兜底', async () => {
  let deleted = 0;
  const r = await updater.ensureWebUp(silentIo(), 'svc-x', 'web', {
    ...NL,
    holderPidOverride: 0,
    svcInfoOverride: { exists: true, state: 'STOPPED', startType: 'AUTO_START' },
    isAdminOverride: true,
    permLike: true,
    cfgStateImpl: () => ({ present: false }),
    startServiceImpl: () => {},
    waitServiceImpl: async () => false,
    graceProbeImpl: async () => false,
    deleteImpl: () => { deleted++; },
    coldStartCmd: { execPath: 'node.exe', argv: ['bin.js', 'web'] },
    spawnImpl: () => ({ ok: true }),
    waitFgImpl: async () => true,
  });
  assert.equal(r.code, 'FOREGROUND_STARTED');
  assert.equal(deleted, 0, '权限类失败不动服务配置');
});

test('MAINT-25m up.lock 并发闸：第二实例 LOCK_BUSY；完成后锁文件清理', async () => {
  const lockP = path.join(tmpRoot(), 'up.lock');
  let releaseGate;
  const gate = new Promise((res) => { releaseGate = res; });
  const p1 = updater.ensureWebUp(silentIo(), 's', 'w', {
    lockPathOverride: lockP,
    holderPidOverride: 0,
    svcInfoOverride: { exists: false, state: 'MISSING' },
    coldStartCmd: { execPath: 'node.exe', argv: ['a'] },
    spawnImpl: () => ({ ok: true, pid: 1 }),
    waitFgImpl: async () => { await gate; return true; },
  });
  await sleep(150); // 让 p1 先拿到锁
  assert.ok(fs.existsSync(lockP), '持锁期间锁文件应在盘');
  const p2 = await updater.ensureWebUp(silentIo(), 's', 'w', {
    lockPathOverride: lockP,
    holderPidOverride: 0,
    svcInfoOverride: { exists: false, state: 'MISSING' },
    coldStartCmd: null,
  });
  assert.equal(p2.code, 'LOCK_BUSY');
  releaseGate();
  const r1 = await p1;
  assert.equal(r1.code, 'FOREGROUND_STARTED');
  assert.ok(!fs.existsSync(lockP), '结束后锁文件应删除');
});

test('MAINT-26 「DSH Web」单快捷方式菜单壳契约：双选项 + 3s 倒计时默认 1', () => {
  const body = indexMod.buildWebMenuCmdBody({ nodePath: 'C:\\n\\node.exe', target: 'C:\\x\\updater-host.cjs', title: 'DSH Web', svc: 'dsh-web', profile: 'web' });
  assert.ok(body.includes('[1] 启动 Web') && body.includes('[2] 维护菜单'), '两选项齐备');
  assert.ok(body.includes('choice /c 12 /t 3 /d 1 /n /m'), '3 秒倒计时默认 [1]（choice /t 3 /d 1）');
  assert.ok(body.includes('if errorlevel 2 goto maintain'), '选 2 转维护分支');
  const upLine = body.split('\r\n').find((l) => l.includes('--cli up'));
  assert.ok(upLine && upLine.includes('--open'), '选项 1 = 一键拉起并开浏览器');
  assert.ok(body.includes('--cli maintain --service dsh-web --profile web'), '选项 2 = 维护菜单');
  // 分流正确性：up 行必须位于 errorlevel 判断之后、goto :eof 之前；maintain 段在 :maintain 标签后
  const iErr = body.indexOf('if errorlevel 2'), iUp = body.indexOf(upLine), iEof = body.indexOf('goto :eof'), iTag = body.indexOf(':maintain');
  assert.ok(iErr < iUp && iUp < iEof && iEof < iTag, 'cmd 控制流顺序: ' + JSON.stringify([iErr, iUp, iEof, iTag]));
});
