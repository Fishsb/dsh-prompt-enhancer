'use strict';
// 2026-08-18：平台服务管理后端单测（跨平台更新重启链）。
// 纯解析函数直测 + backendFor 分发 + 后端逻辑（mock probe 输出）。
const test = require('node:test');
const assert = require('node:assert/strict');
const ps = require('../lib/platform-service.cjs');

// ---------- 纯解析函数 ----------
test('parseSystemdActive 解析 systemctl is-active', () => {
  assert.equal(ps.parseSystemdActive('active\n', 0), 'active');
  assert.equal(ps.parseSystemdActive('inactive\n', 0), 'inactive');
  assert.equal(ps.parseSystemdActive('failed\n', 0), 'failed');
  // unit 不存在 → systemctl 返回非 0 + stderr
  assert.equal(ps.parseSystemdActive('', 1), 'missing');
});

test('parseSystemdEnabled 解析 is-enabled', () => {
  assert.equal(ps.parseSystemdEnabled('enabled\n', 0), true);
  assert.equal(ps.parseSystemdEnabled('disabled\n', 0), false);
  assert.equal(ps.parseSystemdEnabled('', 1), false);
});

test('parseSystemdExecStartPort 解析 ExecStart --port / Environment PORT', () => {
  const out = 'ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/dsh/lib/bin.js web --port 3080 ; ignore_errors=no }';
  assert.equal(ps.parseSystemdExecStartPort(out), 3080);
  assert.equal(ps.parseSystemdExecStartPort('ExecStart={ path=/x }'), null);
});

test('parseSystemdMainPid 解析 MainPID（支持 --value 纯数字与 MainPID=N）', () => {
  assert.equal(ps.parseSystemdMainPid('1234\n'), 1234); // --value 纯数字
  assert.equal(ps.parseSystemdMainPid('MainPID=1234\n'), 1234); // 旧格式兼容
  assert.equal(ps.parseSystemdMainPid('MainPID=0\n'), null);
  assert.equal(ps.parseSystemdMainPid(''), null);
});

test('parseLaunchctlList 解析 launchctl list（官方格式 PID Status Label）', () => {
  // 官方输出：`12783 0 com.example.myagent`（第一列 PID、第二列 Status 退出码、第三列 Label）
  assert.deepEqual(ps.parseLaunchctlList('4242 0 com.deepseek.dsh\n', 0), { exists: true, running: true, pid: 4242 });
  // 未运行：PID 列 '-'
  assert.deepEqual(ps.parseLaunchctlList('- 0 com.deepseek.dsh\n', 0), { exists: true, running: false, pid: null });
  // 不存在：exit 非 0
  assert.deepEqual(ps.parseLaunchctlList('', 113), { exists: false, running: false, pid: null });
});

test('parsePortFlag 通用 --port 提取', () => {
  assert.equal(ps.parsePortFlag('node bin.js web --port 8080'), 8080);
  assert.equal(ps.parsePortFlag('--port=9090'), 9090);
  assert.equal(ps.parsePortFlag('no port here'), null);
});

test('parseScState / parseScPid / parseScStartType 解析 sc 输出', () => {
  const running = 'SERVICE_NAME: dsh-web\nSTATE : 4  RUNNING\n';
  assert.equal(ps.parseScState(running, 0), 'RUNNING');
  const stopped = 'STATE : 1  STOPPED\n';
  assert.equal(ps.parseScState(stopped, 0), 'STOPPED');
  assert.equal(ps.parseScState('', 1060), 'missing');
  assert.equal(ps.parseScPid('PID : 1234\n'), 1234);
  assert.equal(ps.parseScStartType('START_TYPE : 2  AUTO_START\n'), 2);
  assert.equal(ps.parseScStartType('START_TYPE : 4  DISABLED\n'), 4);
});

// ---------- backendFor 分发 ----------
test('backendFor 平台分发', () => {
  assert.equal(ps.backendFor('win32').tool, 'sc/reg/nssm');
  assert.equal(ps.backendFor('linux').tool, 'systemctl');
  assert.equal(ps.backendFor('darwin').tool, 'launchctl');
  assert.equal(ps.backendFor('freebsd'), null);
  assert.equal(ps.backendFor('unknown'), null);
});

// ---------- 进程索引（进程级重启降级）----------
test('readProcessIndex 解析 host 写的进程索引', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-idx-'));
  try {
    // execPath 用真实存在的 node
    const execPath = process.execPath;
    fs.writeFileSync(path.join(tmp, 'dsh-prompt-enhancer.json'), JSON.stringify({
      pid: 12345, execPath, cwd: '/tmp/work', argv: ['lib/bin.js', 'web', '--port', '3080'], ts: Date.now(),
    }), 'utf8');
    const idx = ps.readProcessIndex(tmp);
    assert.equal(idx.pid, 12345);
    assert.equal(idx.execPath, execPath);
    assert.equal(idx.cwd, '/tmp/work');
    assert.deepEqual(idx.argv, ['lib/bin.js', 'web', '--port', '3080']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readProcessIndex：execPath 不存在 / 缺 argv → null', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-idx2-'));
  try {
    fs.writeFileSync(path.join(tmp, 'dsh-prompt-enhancer.json'), JSON.stringify({ pid: 1, execPath: 'C:/definitely/not/exists/node.exe', argv: [] }), 'utf8');
    assert.equal(ps.readProcessIndex(tmp), null);
    fs.writeFileSync(path.join(tmp, 'dsh-prompt-enhancer.json'), JSON.stringify({ pid: 1, execPath: process.execPath }), 'utf8');
    assert.equal(ps.readProcessIndex(tmp), null);
    // 无文件
    assert.equal(ps.readProcessIndex(tmp + '-nope'), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- 后端逻辑（mock probe）----------
// 用 __setProbe 替换命令执行实现，验证 backend 方法在典型命令输出下的行为。
function withProbe(probeImpl) {
  ps.__setProbe(probeImpl);
  return () => ps.__setProbe(null);
}

test('linux.detectService：active + enabled', () => {
  const calls = [];
  const restore = withProbe((cmd, args) => {
    calls.push(cmd + ' ' + args.join(' '));
    if (args[0] === 'is-active') return { ok: true, status: 0, stdout: 'active\n', stderr: '' };
    if (args[0] === 'is-enabled') return { ok: true, status: 0, stdout: 'enabled\n', stderr: '' };
    return { ok: false, status: 1, stdout: '', stderr: '' };
  });
  try {
    const d = ps.linux.detectService('dsh', {});
    assert.equal(d.exists, true);
    assert.equal(d.enabled, true);
    assert.equal(d.detail, 'active');
    assert.ok(calls.some((c) => c.includes('is-active')));
  } finally { restore(); }
});

test('linux.detectService：unit 不存在 → missing', () => {
  const restore = withProbe(() => ({ ok: false, status: 1, stdout: '', stderr: 'Unit dsh.service could not be found.' }));
  try {
    const d = ps.linux.detectService('dsh', {});
    assert.equal(d.exists, false);
  } finally { restore(); }
});

test('linux.readPort：ExecStart --port', () => {
  const restore = withProbe((cmd, args) => {
    if (args[0] === 'show') return { ok: true, status: 0, stdout: 'ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node ... --port 3080 }', stderr: '' };
    return { ok: false, status: 1, stdout: '', stderr: '' };
  });
  try {
    const r = ps.linux.readPort('dsh', {});
    assert.equal(r.ok, true);
    assert.equal(r.port, 3080);
    assert.equal(r.detail, 'systemd');
  } finally { restore(); }
});

test('linux.readPort：Environment=PORT 回退（无 --port 时）', () => {
  const restore = withProbe((cmd, args) => {
    if (args[0] === 'show') return { ok: true, status: 0, stdout: 'ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node ... }\nEnvironment=PORT=8080\n', stderr: '' };
    return { ok: false, status: 1, stdout: '', stderr: '' };
  });
  try {
    const r = ps.linux.readPort('dsh', {});
    assert.equal(r.ok, true);
    assert.equal(r.port, 8080);
    assert.equal(r.detail, 'systemd-env');
  } finally { restore(); }
});

test('linux.pid / isStopped', () => {
  const restore = withProbe((cmd, args) => {
    if (args[0] === 'show') return { ok: true, status: 0, stdout: 'MainPID=5678\n', stderr: '' };
    if (args[0] === 'is-active') return { ok: true, status: 0, stdout: 'active\n', stderr: '' };
    return { ok: false, status: 1, stdout: '', stderr: '' };
  });
  try {
    assert.equal(ps.linux.pid('dsh', {}), 5678);
    assert.equal(ps.linux.isStopped('dsh', {}), false);
  } finally { restore(); }
});

test('linux.stopService：权限失败 → PERMISSION 提示', () => {
  const restore = withProbe(() => ({ ok: false, status: 1, stdout: '', stderr: 'Failed to stop dsh.service: Interactive authentication required.' }));
  try {
    const r = ps.linux.stopService('dsh', {});
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PERMISSION');
    assert.ok(r.message.includes('sudo'));
  } finally { restore(); }
});

test('darwin.detectService / pid / isStopped', () => {
  const restore = withProbe((cmd, args) => {
    if (args[0] === 'list') return { ok: true, status: 0, stdout: '4321 0 com.deepseek.dsh\n', stderr: '' };
    return { ok: false, status: 1, stdout: '', stderr: '' };
  });
  try {
    const d = ps.darwin.detectService('dsh', {});
    assert.equal(d.exists, true);
    assert.equal(d.detail, 'running');
    assert.equal(ps.darwin.pid('dsh', {}), 4321);
    assert.equal(ps.darwin.isStopped('dsh', {}), false);
  } finally { restore(); }
});

test('darwin.detectService：不存在 → missing', () => {
  const restore = withProbe(() => ({ ok: false, status: 113, stdout: '', stderr: 'Could not find service' }));
  try {
    const d = ps.darwin.detectService('dsh', {});
    assert.equal(d.exists, false);
  } finally { restore(); }
});

test('darwin.readPort：launchctl print --port', () => {
  const restore = withProbe((cmd, args) => {
    if (args[0] === 'print') return { ok: true, status: 0, stdout: 'program = /usr/local/bin/node\narguments = {\n  /usr/local/bin/node\n  bin.js web --port 3080\n}', stderr: '' };
    return { ok: false, status: 1, stdout: '', stderr: '' };
  });
  try {
    const r = ps.darwin.readPort('dsh', {});
    assert.equal(r.ok, true);
    assert.equal(r.port, 3080);
    assert.equal(r.detail, 'launchctl');
  } finally { restore(); }
});

test('win.readPort：nssm AppParameters --port', () => {
  const restore = withProbe((cmd, args) => {
    if (cmd === 'reg') return { ok: true, status: 0, stdout: '    AppParameters    REG_EXPAND_SZ    C:\\...\\bin.js web --port 3080', stderr: '' };
    return { ok: false, status: 1, stdout: '', stderr: '' };
  });
  try {
    const r = ps.win.readPort('dsh-web', {});
    assert.equal(r.ok, true);
    assert.equal(r.port, 3080);
    assert.equal(r.detail, 'nssm');
  } finally { restore(); }
});
