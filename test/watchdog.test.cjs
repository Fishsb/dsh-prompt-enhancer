'use strict';
// v3.2.1 watchdog（降级守护）+ 无服务分支 busy 释放 + 执行器复制完整性 单测。
// 覆盖已发生的两类回归：① 无服务分支 return 不释放 busy；② ensureExternalExecutor 复制清单漏文件。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const updater = require('../lib/updater-host.cjs');
const sys = require('../lib/sys.cjs');
const psvc = require('../lib/platform-service.cjs');

// ---- 平台命令 mock（platform-service 的 __setProbe 钩子）----
function mockService(mode) {
  // mode: 'missing' | 'exists'
  psvc.__setProbe((cmd, args) => {
    if (cmd === 'sc' && args[0] === 'query') {
      return mode === 'exists'
        ? { status: 0, stdout: 'SERVICE_NAME: dsh-web\n        STATE : 4  RUNNING', stderr: '' }
        : { status: 1, stdout: '', stderr: '指定的服务未安装' };
    }
    if (cmd === 'sc' && args[0] === 'qc') return { status: 0, stdout: 'START_TYPE : 2   AUTO_START', stderr: '' };
    if (cmd === 'reg') return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
}
function restoreProbe() { psvc.__setProbe(null); }

function tmpDshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-watchdog-test-'));
  return dir;
}

test('WDG-01 watchdog 初始状态与常量', () => {
  assert.equal(updater.watchdog.enabled, false);
  assert.equal(updater.watchdog.state, 'idle');
  assert.equal(updater.watchdog.restartCount, 0);
  assert.ok(updater.WATCH_MAX_RESTARTS > 0);
  assert.ok(updater.WATCH_RESTART_DELAY_MS >= 0);
  assert.ok(updater.WATCH_MIN_UPTIME_MS > 0);
  assert.equal(updater.WATCH_INTERVAL_MS > 0, true);
});

test('WDG-02 watchdogShouldRun：无服务 + 有进程索引 → 启用', () => {
  const home = tmpDshHome();
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    fs.writeFileSync(path.join(home, 'dsh-prompt-enhancer.json'), JSON.stringify({ pid: 1, execPath: process.execPath, cwd: home, argv: [], ts: Date.now() }));
    mockService('missing');
    assert.equal(updater.watchdogShouldRun(), true);
  } finally {
    restoreProbe();
    if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('WDG-03 watchdogShouldRun：有系统服务 → 不启用（交给系统服务）', () => {
  const home = tmpDshHome();
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    fs.writeFileSync(path.join(home, 'dsh-prompt-enhancer.json'), JSON.stringify({ pid: 1, execPath: process.execPath, cwd: home, argv: [], ts: Date.now() }));
    mockService('exists');
    assert.equal(updater.watchdogShouldRun(), false);
  } finally {
    restoreProbe();
    if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('WDG-04 watchdogShouldRun：无服务 + 无索引 → 不启用', () => {
  const home = tmpDshHome();
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    mockService('missing');
    assert.equal(updater.watchdogShouldRun(), false);
  } finally {
    restoreProbe();
    if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('WDG-05 restartService 无服务分支（无索引）返回后 busy 必须释放（回归固化）', async () => {
  const home = tmpDshHome();
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    mockService('missing'); // 无 dsh-web 服务 → 进程级降级分支
    updater.state.busy = false;
    updater.state.applying = false;
    const r = await updater.restartService('dsh-web');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NO_SERVICE_AND_NO_INDEX');
    // 关键断言：busy 必须已释放（此前 finally 不覆盖进程级分支 → busy 恒 true → 后续重启全被拒）
    assert.equal(updater.state.busy, false, 'busy 必须释放，否则后续 restart 全被 BUSY 拒绝');
    assert.equal(updater.state.applying, false);
  } finally {
    restoreProbe();
    if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('WDG-06 ensureExternalExecutor 复制完整性：执行器依赖链文件齐全（回归固化）', (t) => {
  const execRoot = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '', 'dsh-prompt-enhancer', 'executor');
  const verDir = path.join(execRoot, sys.EXECUTOR_VERSION, 'lib');
  if (!fs.existsSync(verDir)) {
    t.skip('执行器副本目录不存在（本机未跑过 executorEnsure）——跳过');
    return;
  }
  // 执行器运行必需依赖链（updater-host → sys/platform-service/integrity → node 内置）
  // 回归固化：曾漏 platform-service.cjs → 执行器启动即 MODULE_NOT_FOUND 崩溃
  const required = ['updater-host.cjs', 'sys.cjs', 'platform-service.cjs', 'integrity.cjs'];
  for (const f of required) {
    assert.ok(fs.existsSync(path.join(verDir, f)), '执行器副本缺失: ' + f + '（复制清单/整目录复制必须覆盖）');
  }
  assert.ok(fs.existsSync(path.join(execRoot, sys.EXECUTOR_VERSION, 'plugin-host.js')), '执行器副本缺失 plugin-host.js');
});
