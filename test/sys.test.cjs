'use strict';
// sys.cjs 共享原语单测（M0 基线补充）
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sys = require('../lib/sys.cjs');
const psvc = require('../lib/platform-service.cjs');

test('SYS-01 executorDir 返回外部版本化目录', () => {
  const dir = sys.executorDir('0.1.6');
  assert.ok(dir.includes('dsh-prompt-enhancer'));
  assert.ok(dir.includes('executor'));
  assert.ok(dir.endsWith(path.join('0.1.6')), '版本号作为末级目录');
});

test('SYS-02 profileDir 返回 DSH profile 路径', () => {
  const dir = sys.profileDir('web');
  assert.ok(dir.endsWith(path.join('.dsh', 'profiles', 'web')), 'profile 路径拼接正确');
});

test('SYS-03 isLocalTarballInstallArgs 只允许 staging 内 tarball', () => {
  const good = sys.isLocalTarballInstallArgs([
    'node', 'plugin', '--profile', 'web', 'add', path.join(sys.STAGING_DIR, 'dsh-prompt-enhancer-2.8.3.tgz'),
  ]);
  assert.equal(good, true, 'staging 内 tgz 应放行');

  const badPath = sys.isLocalTarballInstallArgs([
    'node', 'plugin', '--profile', 'web', 'add', 'C:\\Temp\\evil.tgz',
  ]);
  assert.equal(badPath, false, 'staging 外路径应拒绝');

  const badExt = sys.isLocalTarballInstallArgs([
    'node', 'plugin', '--profile', 'web', 'add', path.join(sys.STAGING_DIR, 'evil.zip'),
  ]);
  assert.equal(badExt, false, '非 tgz 应拒绝');

  const badArgs = sys.isLocalTarballInstallArgs(['node', 'plugin', '--profile', 'web', 'install', 'x.tgz']);
  assert.equal(badArgs, false, '非 add 命令应拒绝');
});

test('SYS-04 isEnvcheckBlocked 识别 block 失败项', () => {
  const blocked = [
    { key: 'service', level: 'block', ok: false },
    { key: 'net', level: 'warn', ok: false },
  ];
  assert.equal(sys.isEnvcheckBlocked(blocked), true, '存在 block 失败应 true');

  const warnOnly = [
    { key: 'service', level: 'block', ok: true },
    { key: 'net', level: 'warn', ok: false },
  ];
  assert.equal(sys.isEnvcheckBlocked(warnOnly), false, '仅 warn 失败应 false');
});

test('SYS-05 extractPure 暴露新 PURE 函数', () => {
  const body = `
// ==PURE-BEGIN==
function buildTarballUrl(repo, tag) { return 'https://github.com/' + repo + '/releases/download/' + tag; }
function buildLocalInstallArgs(a, b, c) { return [a, b, c]; }
function mergeEnvPath(a, b) { return a + ';' + b; }
function buildRestartPlan() { return {}; }
function buildInstallArgs() { return []; }
// ==PURE-END==
`;
  const pure = sys.extractPure(body);
  assert.equal(typeof pure.buildTarballUrl, 'function');
  assert.equal(typeof pure.buildLocalInstallArgs, 'function');
  assert.equal(typeof pure.mergeEnvPath, 'function');
});

/* ================= 批次C（P1-4）：probeEnv 异步化 + net 熔断 ================= */

/** promisified-execFile 契约 mock：handlers 按 'cmd arg1 arg2' 匹配（缺省回退 handlers[cmd]）；
 *  值为 resolve 对象 {stdout,stderr}、Error 实例（reject）、或 (args)=>… 工厂。 */
function makeExecMock(handlers) {
  const calls = [];
  const fn = async (cmd, args) => {
    const key = cmd + (args.length ? ' ' + args.join(' ') : '');
    calls.push(key);
    const h = handlers[key] !== undefined ? handlers[key] : handlers[cmd];
    if (h === undefined) throw Object.assign(new Error('unexpected exec: ' + key), { code: 'UNMOCKED' });
    if (typeof h === 'function') return await h(args);
    if (h instanceof Error) throw h;
    return h;
  };
  fn.calls = calls;
  return fn;
}

const WHERE_OK = { stdout: 'C:\\WINDOWS\\System32\\sc.exe\r\n' };
const NETSTAT_3080_4242 = '\r\nTCP    0.0.0.0:3080           0.0.0.0:0              LISTENING       4242\r\n';
const NETSTAT_NONE = '\r\nTCP    0.0.0.0:9999           0.0.0.0:0              LISTENING       99\r\n';
const TASKLIST_SVC0 = '"node.exe","4242","Services","0","8,888 K"\r\n';
const CURL_EXIT7 = Object.assign(new Error('curl exit 7'), { code: 7 });

/** win 全链标准 mock（工具预检过 + 3080 有监听者 + curl 可控）。 */
function winChainMock(curlResult) {
  return makeExecMock({
    'where sc.exe': WHERE_OK,
    'netstat -ano': { stdout: NETSTAT_3080_4242 },
    'tasklist /FO CSV /NH': { stdout: TASKLIST_SVC0 },
    curl: curlResult,
  });
}
/** win 无监听链 mock。 */
function winNoListenerMock(curlResult) {
  return makeExecMock({
    'where sc.exe': WHERE_OK,
    'netstat -ano': { stdout: NETSTAT_NONE },
    curl: curlResult,
  });
}
/** sc query/qc 异步孪生 mock（RUNNING + AUTO_START）。 */
function scRunningAsync() {
  return async (cmd, args) => {
    if (cmd === 'sc' && args[0] === 'query') return { ok: true, status: 0, stdout: 'STATE : 4 RUNNING', stderr: '', error: null };
    if (cmd === 'sc' && args[0] === 'qc') return { ok: true, status: 0, stdout: 'START_TYPE : 2 AUTO_START', stderr: '', error: null };
    throw Object.assign(new Error('unexpected ' + cmd), { code: 'UNMOCKED_PSVC' });
  };
}

function teardownProbeMocks() {
  sys.__setProbeExecutor(null);
  psvc.__setProbeAsync(null);
  sys.__resetNetBreaker();
  delete process.env.DSH_PE_NET_BREAKER;
}

test('SYS-06 runProbe 同步契约回归：白名单拒绝/真实快速探测，且不返回 Promise', () => {
  const r1 = sys.runProbe('not-allowed-cmd', [], undefined);
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'BAD_PROBE_CMD');
  assert.ok(!(r1 instanceof Promise), 'runProbe 必须保持同步形态（重启阶梯链 svcStateRaw 等依赖）');

  const r2 = sys.runProbe('sc', ['query\x01bad'], undefined);
  assert.equal(r2.code, 'BAD_PROBE_ARG');

  const r3 = sys.runProbe('where', ['sc.exe'], undefined);
  assert.equal(r3.ok, true, 'where sc.exe 应成功');
});

test('SYS-07 runProbeAsync：Promise 形状/白名单/非 0 退出映射对齐 spawnSync status 语义', async () => {
  const p = sys.runProbeAsync('not-allowed-cmd', [], undefined);
  assert.ok(p instanceof Promise);
  const r1 = await p;
  assert.deepEqual(r1, { ok: false, code: 'BAD_PROBE_CMD' });

  // 真实执行器：where 不存在的名字 → 非 0 退出 → {ok:false,code:<exit>}（spawnSync status 等价）
  const r2 = await sys.runProbeAsync('where', ['dsh-definitely-not-exist-xyz-9x7'], undefined);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 1, '非 0 退出码必须映射为 number');

  // ENOENT 映射（mock 注入，避免依赖白名单外命令）
  sys.__setProbeExecutor(makeExecMock({
    where: () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); },
  }));
  try {
    const r3 = await sys.runProbeAsync('where', ['sc.exe'], undefined);
    assert.deepEqual({ ok: r3.ok, code: r3.code }, { ok: false, code: 'ENOENT' });
  } finally { teardownProbeMocks(); }
});

test('SYS-08 C-3 超时硬杀：挂起子进程被击杀 → ETIMEDOUT 且远短于命令自然时长', { timeout: 20000 }, async () => {
  // 黑洞地址 connect 挂起（curl -m 20 自然时长 ≥15s）；探针 700ms 硬超时应 SIGTERM 击杀
  // （execFile timeout 语义：超时杀子进程并 reject——对齐 spawnSync error.code='ETIMEDOUT'）。
  const t0 = Date.now();
  const r = await sys.runProbeAsync('curl', ['-s', '-m', '20', 'http://10.255.255.1/'], undefined, { timeoutMs: 700 });
  const elapsed = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ETIMEDOUT', '超时必须归一化为 ETIMEDOUT');
  assert.ok(elapsed < 5000, '子进程必须在超时窗内被杀死（实际 ' + elapsed + 'ms；未击杀将 ≥15s）');
});

test('SYS-09 probeEnv golden 契约：mock 全链下 items 序/key 集/字段与同步版逐字段一致', async () => {
  sys.__setProbeExecutor(winChainMock({ stdout: '200' }));
  psvc.__setProbeAsync(scRunningAsync());
  try {
    const items = await sys.probeEnv('dsh-web', {}, {});
    assert.deepEqual(items.map((i) => i.key), ['tools', 'net', 'port-mode', 'port-pid'], '数组序契约');

    const [tools, net, portMode, portPid] = items;
    // tools/net：无 level 字段（同步版形状）
    assert.deepEqual(Object.keys(tools).sort(), ['detail', 'key', 'ok', 'warn']);
    assert.deepEqual({ ok: tools.ok, warn: tools.warn, detail: tools.detail }, { ok: true, warn: false, detail: 'ok' });
    assert.deepEqual(Object.keys(net).sort(), ['detail', 'key', 'ok', 'warn']);
    assert.deepEqual({ ok: net.ok, warn: net.warn, detail: net.detail }, { ok: true, warn: false, detail: 'ok' });
    // port 两项：带 level:'warn'
    assert.deepEqual(Object.keys(portMode).sort(), ['detail', 'key', 'level', 'ok']);
    assert.deepEqual({ ok: portMode.ok, level: portMode.level, detail: portMode.detail }, { ok: true, level: 'warn', detail: 'service' });
    assert.deepEqual({ ok: portPid.ok, level: portPid.level, detail: portPid.detail }, { ok: true, level: 'warn', detail: '4242' });
  } finally { teardownProbeMocks(); }
});

test('SYS-10 probeEnv 无监听→service-stopped；工具不可达早退形状逐字一致；单项异常不拖垮整表', async () => {
  // 分支①：3080 无监听 + 服务存在（STOPPED）
  sys.__setProbeExecutor(winNoListenerMock({ stdout: '200' }));
  psvc.__setProbeAsync(async () => ({ ok: true, status: 0, stdout: 'STATE : 1 STOPPED', stderr: '', error: null }));
  try {
    const items = await sys.probeEnv('dsh-web', {}, {});
    const pm = items.find((i) => i.key === 'port-mode');
    const pp = items.find((i) => i.key === 'port-pid');
    assert.deepEqual(pm, { key: 'port-mode', ok: false, warn: true, detail: 'service-stopped', level: 'warn' });
    assert.deepEqual(pp, { key: 'port-pid', ok: false, warn: true, detail: 'no-listener', level: 'warn' });
  } finally { teardownProbeMocks(); }

  // 分支②：where 非 0 退出 → 早退四项 tool-unreachable（含 level 字段）
  sys.__setProbeExecutor(makeExecMock({
    where: () => { throw Object.assign(new Error('exit 1'), { code: 1 }); },
  }));
  psvc.__setProbeAsync(async () => { throw new Error('must not be called'); });
  try {
    const items = await sys.probeEnv('dsh-web', {}, {});
    assert.deepEqual(items.map((i) => i.key), ['tools', 'net', 'port-mode', 'port-pid']);
    for (const it of items) {
      assert.deepEqual(it, { key: it.key, ok: false, warn: true, level: 'warn', detail: 'tool-unreachable' }, '早退项形状逐字一致');
    }
  } finally { teardownProbeMocks(); }

  // 分支③：单项执行器抛异常 → 该项降级 warn，其余项照常
  sys.__setProbeExecutor(makeExecMock({
    'where sc.exe': () => { throw new Error('boom'); },
  }));
  try {
    const items = await sys.probeEnv('dsh-web', {}, {});
    assert.deepEqual(items.map((i) => i.key), ['tools', 'net', 'port-mode', 'port-pid'], '异常不拖垮整表');
  } finally { teardownProbeMocks(); }
});

test('SYS-11 net 熔断状态机：3 连败入冷却→窗内零实测回缓存+degraded 标注；成功清零；旋钮关闭', async () => {
  // 阶段①：3 次连败全部实测，第 4 次起进冷却窗
  const execFail = winChainMock(CURL_EXIT7);
  sys.__setProbeExecutor(execFail);
  psvc.__setProbeAsync(scRunningAsync());
  try {
    for (let i = 1; i <= 3; i++) {
      const items = await sys.probeEnv('dsh-web', {}, {});
      const net = items.find((x) => x.key === 'net');
      assert.equal(net.detail, 'unreachable', '第 ' + i + ' 次连败仍实测');
      assert.deepEqual(Object.keys(net).sort(), ['detail', 'key', 'ok', 'warn'], '失败态字段契约不变');
    }
    const curlCallsAfter3 = execFail.calls.filter((c) => c.startsWith('curl')).length;
    assert.equal(curlCallsAfter3, 3);

    // 第 4/5 次：冷却窗内不再实测（curl 计数冻结）、回缓存判定并标注 degraded
    const r4 = await sys.probeEnv('dsh-web', {}, {});
    const net4 = r4.find((x) => x.key === 'net');
    assert.deepEqual({ ok: net4.ok, warn: net4.warn, detail: net4.detail }, { ok: false, warn: true, detail: 'unreachable+cooldown' });
    assert.deepEqual(Object.keys(net4).sort(), ['detail', 'key', 'ok', 'warn'], '冷却项字段契约不变');
    await sys.probeEnv('dsh-web', {}, {});
    const curlCallsAfter5 = execFail.calls.filter((c) => c.startsWith('curl')).length;
    assert.equal(curlCallsAfter5, 3, '冷却窗内零实测');
  } finally { teardownProbeMocks(); }

  // 阶段②：成功清零（在未入冷却的连败中途成功）——清零后再次两连败仍全部实测（fail 计数从 0 重计）
  let succeedNext = false;
  const execMix = winChainMock(() => (succeedNext ? { stdout: '200' } : CURL_EXIT7));
  sys.__setProbeExecutor(execMix);
  psvc.__setProbeAsync(scRunningAsync());
  try {
    await sys.probeEnv('dsh-web', {}, {}); // fail=1（实测）
    succeedNext = true;
    const okNet = (await sys.probeEnv('dsh-web', {}, {})).find((x) => x.key === 'net'); // 实测成功 → 清零
    assert.deepEqual({ ok: okNet.ok, warn: okNet.warn, detail: okNet.detail }, { ok: true, warn: false, detail: 'ok' }, '成功即清零且回正常判定');
    const curlAtOk = execMix.calls.filter((c) => c.startsWith('curl')).length;
    assert.equal(curlAtOk, 2);
    succeedNext = false;
    // 清零后两次连败必须仍是实测（若未清零，这两次会是 fail=2、3——第二次就进冷却）
    for (let i = 0; i < 2; i++) {
      const items = await sys.probeEnv('dsh-web', {}, {});
      assert.equal(items.find((x) => x.key === 'net').detail, 'unreachable', '清零后重计连败仍实测');
    }
    assert.equal(execMix.calls.filter((c) => c.startsWith('curl')).length, 4, '每次均为实测');
  } finally { teardownProbeMocks(); }

  // 阶段③：旋钮 DSH_PE_NET_BREAKER=0 —— 连败 5 次全部实测、永不标注 cooldown
  process.env.DSH_PE_NET_BREAKER = '0';
  const execKnob = winChainMock(CURL_EXIT7);
  sys.__setProbeExecutor(execKnob);
  psvc.__setProbeAsync(scRunningAsync());
  try {
    for (let i = 0; i < 5; i++) {
      const items = await sys.probeEnv('dsh-web', {}, {});
      assert.equal(items.find((x) => x.key === 'net').detail, 'unreachable', '旋钮关闭时每次都实测');
    }
    assert.equal(execKnob.calls.filter((c) => c.startsWith('curl')).length, 5, '旋钮关闭时无熔断计数');
  } finally { teardownProbeMocks(); }
}, { timeout: 30000 });

test('SYS-12 形状防御断言（C-2 兜底）：probeEnv 返回 Promise、runProbe/runProbeAsync 双形态锁定', async () => {
  sys.__setProbeExecutor(makeExecMock({
    'where sc.exe': WHERE_OK,
    'netstat -ano': { stdout: NETSTAT_NONE },
    'tasklist /FO CSV /NH': { stdout: '' },
    curl: { stdout: '000' },
  }));
  psvc.__setProbeAsync(async () => ({ ok: true, status: 0, stdout: 'STATE : 1 STOPPED', stderr: '', error: null }));
  try {
    const p = sys.probeEnv('dsh-web', {}, {});
    assert.ok(p instanceof Promise, '漏网消费方拿到的是 Promise 而非数组——防御断言兜底');
    const items = await p;
    assert.ok(Array.isArray(items));

    const syncR = sys.runProbe('nope', [], undefined);
    assert.ok(!(syncR instanceof Promise) && typeof syncR === 'object', 'runProbe 保持普通对象返回');
    const asyncR = sys.runProbeAsync('nope', [], undefined);
    assert.ok(asyncR instanceof Promise, 'runProbeAsync 必须 Promise 化');
    await asyncR;

    // B1 扩展原语发射闭合：解析原语随 PORT_PRIMS 全量发射（生成脚本自包含纪律）
    const prims = sys.scriptPortPrims();
    assert.ok(prims.includes('var dshPrimParsePortHolder ='), '解析原语必须进入发射块');
    assert.equal(typeof sys.portHolderPid, 'function');
  } finally { teardownProbeMocks(); }
});

test('SYS-13 detectService 孪生 parity：同 mock 下 sync 与 async 结果逐字段一致', async () => {
  if (process.platform !== 'win32') {
    // 孪生分发按平台路由；跨平台孪生共享 parse* 纯函数（另有平台测试覆盖），此处仅验分发存在
    assert.equal(typeof psvc.detectServiceAsync, 'function');
    assert.ok(psvc.detectServiceAsync('svc-x', {}) instanceof Promise);
    return;
  }
  // 场景①：RUNNING + AUTO_START → exists/enabled/detail 一致
  let step = 0;
  const outsRunning = [
    { ok: true, status: 0, stdout: 'STATE : 4 RUNNING', stderr: '', error: null },
    { ok: true, status: 0, stdout: 'START_TYPE : 2 AUTO_START', stderr: '', error: null },
  ];
  psvc.__setProbe(() => outsRunning[Math.min(step++, outsRunning.length - 1)]);
  const syncRunning = psvc.win.detectService('svc-x', {});
  step = 0;
  psvc.__setProbeAsync(async () => outsRunning[Math.min(step++, outsRunning.length - 1)]);
  const asyncRunning = await psvc.detectServiceAsync('svc-x', {});
  assert.deepEqual(syncRunning, asyncRunning);
  assert.deepEqual(syncRunning, { exists: true, enabled: true, detail: 'ok', tool: 'sc/reg/nssm' });

  // 场景②：服务缺失 → missing 形状一致
  step = 0;
  const outsMissing = [{ ok: false, status: 1060, stdout: 'OPENSC FAILED 1060', stderr: '', error: null }];
  psvc.__setProbe(() => outsMissing[Math.min(step++, outsMissing.length - 1)]);
  const syncMissing = psvc.win.detectService('svc-x', {});
  step = 0;
  psvc.__setProbeAsync(async () => outsMissing[Math.min(step++, outsMissing.length - 1)]);
  const asyncMissing = await psvc.detectServiceAsync('svc-x', {});
  assert.deepEqual(syncMissing, asyncMissing);
  assert.deepEqual(syncMissing, { exists: false, enabled: false, detail: 'missing', tool: 'sc/reg/nssm' });

  psvc.__setProbe(null);
  psvc.__setProbeAsync(null);
});
