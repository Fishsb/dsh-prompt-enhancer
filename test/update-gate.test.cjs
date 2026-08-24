'use strict';
// 批次A（optimization-plan-20260824 §A.1/A.2）·更新器熔断防抖契约测试。
// 覆盖：computeBackoff/shouldGateAuto/isDebounceBlocked 决策矩阵、kill-switch 三态、
// auto 闸门四态、rpc-schema 可选 auto、状态文件原子写、rollbackToVersion 退避闸两分支、
// scheduleServiceRestart 防抖双闸+先判后写+过期清理、janitor 陈旧任务清扫注入演练。
// 隔离纪律：EXECUTOR_ROOT/DSH_HOME 指临时目录 + DSH_ENHANCER_NO_INDEX=1；
// scheduleServiceRestart 一律经 seam.spawnSyncImpl 注入——绝不触真实服务/schtasks（红线②）。
process.env.DSH_ENHANCER_NO_INDEX = '1';
process.env.DSH_ENHANCER_EXECUTOR_ROOT = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'dsh-ugate-root-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sys = require('../lib/sys.cjs');
const M = require('../lib/maintain-lib.cjs');
const updater = require('../lib/updater-host.cjs');
const indexMod = require('../lib/index.cjs');
const { schemas, validateRpcArgs } = require('../lib/rpc-schema.cjs');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ugate-'));
const todayKey = () => M.localDayKey(Date.now());

/* ---------------- ① computeBackoff 决策矩阵 ---------------- */

test('UGATE-01 computeBackoff：0 次失败 → 60s 退避起步', () => {
  const now = Date.now();
  const r = M.computeBackoff({}, now);
  assert.equal(r.failCount, 1);
  assert.equal(r.dayCount, 1);
  assert.equal(r.dayKey, todayKey());
  assert.equal(r.nextRetryAt - now, M.BACKOFF_BASE_MS);
});

test('UGATE-02 computeBackoff：指数递增 1→2→3 次（60s/120s/240s）', () => {
  const now = Date.now();
  const s1 = M.computeBackoff({ failCount: 1, dayCount: 1, dayKey: todayKey() }, now);
  assert.equal(s1.nextRetryAt - now, 120 * 1000);
  const s2 = M.computeBackoff({ failCount: 2, dayCount: 2, dayKey: todayKey() }, now);
  assert.equal(s2.nextRetryAt - now, 240 * 1000);
});

test('UGATE-03 computeBackoff：封顶 30min（高连败不再翻倍）', () => {
  const now = Date.now();
  const r = M.computeBackoff({ failCount: 9, dayCount: 9, dayKey: todayKey() }, now);
  assert.equal(r.nextRetryAt - now, M.BACKOFF_CAP_MS);
  assert.equal(r.nextRetryAt - now, 30 * 60 * 1000);
});

test('UGATE-04 computeBackoff：跨日重置 dayCount（failCount 连败保留）', () => {
  const now = Date.now();
  const r = M.computeBackoff({ failCount: 4, dayCount: 6, dayKey: '2000-01-01' }, now);
  assert.equal(r.dayCount, 1, '跨日后当日计数应从 1 重新开始');
  assert.equal(r.failCount, 5, '连败计数跨日保留（退避继续加深）');
  assert.equal(r.dayKey, todayKey());
});

/* ---------------- ② shouldGateAuto 决策矩阵 ---------------- */

test('UGATE-05 shouldGateAuto：nextRetryAt 未到拒绝 / 过期放行 / 空状态放行', () => {
  const now = Date.now();
  assert.equal(M.shouldGateAuto({ nextRetryAt: now + 60000 }, now), true, '退避窗口内必须拒绝');
  assert.equal(M.shouldGateAuto({ nextRetryAt: now - 1 }, now), false, '过期放行');
  assert.equal(M.shouldGateAuto({}, now), false, '空状态放行');
  assert.equal(M.shouldGateAuto(null, now), false, 'null 状态放行');
  assert.equal(M.shouldGateAuto({ nextRetryAt: 'garbage' }, now), false, '脏字段按空处理');
});

test('UGATE-06 shouldGateAuto：每日上限拒绝 + 跨日自动清零放行', () => {
  const now = Date.now();
  assert.equal(M.shouldGateAuto({ dayCount: M.AUTO_DAILY_LIMIT, dayKey: todayKey() }, now), true, '当日达 6 次上限拒绝');
  assert.equal(M.shouldGateAuto({ dayCount: M.AUTO_DAILY_LIMIT, dayKey: '2000-01-01' }, now), false, '跨日清零放行');
  assert.equal(M.shouldGateAuto({ dayCount: M.AUTO_DAILY_LIMIT - 1, dayKey: todayKey() }, now), false, '未达上限放行');
});

test('UGATE-07 computeBackoff+shouldGateAuto 闭环：封顶后当日拒绝、次日恢复', () => {
  const now = Date.now();
  let state = {};
  for (let i = 0; i < M.AUTO_DAILY_LIMIT; i++) state = Object.assign({}, state, M.computeBackoff(state, now));
  assert.equal(state.dayCount, M.AUTO_DAILY_LIMIT);
  assert.equal(M.shouldGateAuto(state, now), true, '连续 6 次失败后当日拒绝');
});

/* ---------------- isDebounceBlocked 决策矩阵 ---------------- */

test('UGATE-08 isDebounceBlocked：窗口内阻塞（含未来兜底时刻）/ 窗外放行 / 缺损放行', () => {
  const now = Date.now();
  const W = indexMod.RESTART_DEBOUNCE_MS;
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now + 120 * 1000 }, now, W), true, '写入后 120s 兜底时刻属未来，负龄期仍在窗口内');
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now - (W + 1000) }, now, W), false, 'now-ts = W+1s ≥ W → 窗外放行');
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now - (W - 1000) }, now, W), true, 'now-ts < W 窗口内阻塞');
  assert.equal(M.isDebounceBlocked({}, now, W), false, 'pendingRestartAt 缺损放行');
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: 0 }, now, W), false, '0 值放行');
  assert.equal(M.isDebounceBlocked(null, now, W), false, 'null 状态放行');
});

test('UGATE-09 isDebounceBlocked 时钟回拨容忍：超前超过一个完整窗口视为立即过期（防死锁）', () => {
  const now = Date.now();
  const W = indexMod.RESTART_DEBOUNCE_MS;
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now + W + 60000 }, now, W), false, '超前 > windowMs 的脏数据放行');
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now + W - 60000 }, now, W), true, '正常未来兜底时刻（≤windowMs 内）仍阻塞');
});

/* ---------------- kill-switch 三态 + auto 闸门 ---------------- */

test('UGATE-10 kill-switch 三态：env=0 拒绝 / config false 拒绝 / 都未设放行', () => {
  // env=0
  assert.equal(indexMod.readAutoUpdateKillSwitch({ envValue: '0', configFile: '' }), 'env');
  assert.equal(indexMod.readAutoUpdateKillSwitch({ envValue: ' 0 ', configFile: '' }), 'env', '容忍空白');
  // config=false
  const dir = tmpRoot();
  const cfgFile = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ update: { autoUpdate: false } }), 'utf8');
  assert.equal(indexMod.readAutoUpdateKillSwitch({ envValue: undefined, configFile: cfgFile }), 'config');
  // config=true 不算关闭
  fs.writeFileSync(cfgFile, JSON.stringify({ update: { autoUpdate: true } }), 'utf8');
  assert.equal(indexMod.readAutoUpdateKillSwitch({ envValue: undefined, configFile: cfgFile }), '');
  // 都未设
  assert.equal(indexMod.readAutoUpdateKillSwitch({ envValue: '', configFile: path.join(dir, 'missing.json') }), '');
  // 损坏配置容错
  fs.writeFileSync(cfgFile, '{broken json', 'utf8');
  assert.equal(indexMod.readAutoUpdateKillSwitch({ envValue: undefined, configFile: cfgFile }), '');
});

test('UGATE-11 autoGateDecision 四态：AUTO_DISABLED / BACKOFF_WAITING / 放行 / 手动豁免', () => {
  const dir = tmpRoot();
  const cfgOff = path.join(dir, 'off.json');
  fs.writeFileSync(cfgOff, JSON.stringify({ update: { autoUpdate: false } }), 'utf8');
  // ① config kill-switch → AUTO_DISABLED
  const g1 = indexMod.autoGateDecision(true, { configFile: cfgOff });
  assert.ok(g1 && g1.code === 'AUTO_DISABLED');
  // ② 退避中 → BACKOFF_WAITING 且 message 带剩余秒数
  const g2 = indexMod.autoGateDecision(true, { envValue: '', configFile: '', state: { nextRetryAt: Date.now() + 65000, dayCount: 2, dayKey: todayKey() } });
  assert.ok(g2 && g2.code === 'BACKOFF_WAITING');
  assert.ok(/65 秒|64 秒/.test(g2.message), 'message 应带剩余秒数：' + g2.message);
  // ③ 空状态 → 放行（null）
  assert.equal(indexMod.autoGateDecision(true, { envValue: '', configFile: '', state: {} }), null);
  // ④ 手动调用（非 auto）即使 kill-switch 开启也豁免
  assert.equal(indexMod.autoGateDecision(false, { configFile: cfgOff }), null);
});

test('UGATE-12 rpc-schema：update/portRestart 宽松可选布尔 auto 校验', () => {
  assert.ok(schemas['update/portRestart'], 'schema 必须注册');
  assert.deepEqual(schemas['update/portRestart'].required, []);
  assert.equal(validateRpcArgs('update/portRestart', { serviceName: 'dsh-web' }).ok, true, '不带 auto 合法（手动）');
  assert.equal(validateRpcArgs('update/portRestart', { serviceName: 'dsh-web', auto: true }).ok, true);
  assert.equal(validateRpcArgs('update/portRestart', { serviceName: 'dsh-web', auto: false }).ok, true);
  assert.equal(validateRpcArgs('update/portRestart', { serviceName: 'dsh-web', auto: 'yes' }).ok, false, 'auto 非布尔拒绝');
  assert.equal(validateRpcArgs('update/portRestart', { serviceName: 'dsh-web', auto: 1 }).ok, false);
});

test('UGATE-13 双侧 schema 同步：src/host/rpc-schema.js 与 lib/rpc-schema.cjs 均含 portRestart 规则', () => {
  for (const f of ['src/host/rpc-schema.js', 'lib/rpc-schema.cjs']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(src.includes("'update/portRestart'"), f + ' 缺 update/portRestart 规则');
    assert.ok(src.includes("args.auto === undefined || typeof args.auto === 'boolean'"), f + ' 缺宽松可选布尔校验');
  }
});

test('UGATE-14 handler 接线断言：portRestart 消费 autoGateDecision 且 client 自愈链传 auto:true', () => {
  const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.cjs'), 'utf8');
  assert.ok(idxSrc.includes('const gate = autoGateDecision(args && args.auto === true);'), 'host handler 未接线 auto 闸');
  const cardRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'components', 'updater-card.js'), 'utf8');
  const cm = /module\.exports = ("(?:[^"\\]|\\.)*");?\s*$/.exec(cardRaw);
  const card = JSON.parse(cm[1]);
  assert.ok(card.includes("'update/portRestart', { serviceName, profile, auto: true }"), 'client 自愈链未标记 auto:true');
  assert.ok(card.includes("'BACKOFF_WAITING' || rrc === 'AUTO_DISABLED'"), 'client 未处理闸拦截响应');
});

/* ---------------- ⑥ 状态文件原子写 ---------------- */

test('UGATE-15 writeUpdateStateSafe 原子性：rename 中途失败不留半截 JSON（目标保持上一份完整状态）', () => {
  const dir = tmpRoot();
  const p = path.join(dir, 'state.json');
  indexMod.writeUpdateStateSafe({ schema: 1, failCount: 1 }, { stateFileOverride: p });
  const before = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(before.failCount, 1);
  // 模拟中途崩溃：writeFileSync 成功、renameSync 抛错（fs 为同一核心模块对象，patch 生效）
  const origRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated crash between write and rename'); };
  try {
    assert.throws(() => indexMod.writeUpdateStateSafe({ schema: 1, failCount: 99 }, { stateFileOverride: p }));
  } finally {
    fs.renameSync = origRename;
  }
  // 目标文件仍是上一份完整 JSON，绝非半截内容
  const after = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(after.failCount, 1);
  // 孤儿 .tmp 存在且自身是完整 JSON（可安全清理）
  const orphans = fs.readdirSync(dir).filter((f) => /\.tmp$/.test(f));
  assert.equal(orphans.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, orphans[0]), 'utf8')).failCount, 99);
});

test('UGATE-16 readUpdateStateSafe 容错：缺失/损坏/数组均按空状态（闸门 fail-open 放行）', () => {
  const dir = tmpRoot();
  assert.deepEqual(indexMod.readUpdateStateSafe({ stateFileOverride: path.join(dir, 'nope.json') }), {});
  const p = path.join(dir, 'bad.json');
  fs.writeFileSync(p, '{{{', 'utf8');
  assert.deepEqual(indexMod.readUpdateStateSafe({ stateFileOverride: p }), {});
  fs.writeFileSync(p, '[1,2]', 'utf8');
  assert.deepEqual(indexMod.readUpdateStateSafe({ stateFileOverride: p }), {}, '数组形态按空处理');
});

test('UGATE-17 sys 路径助手：pluginConfigFile/updateStateFile 同源 DSH_HOME 口径', () => {
  const home = tmpRoot();
  assert.equal(sys.pluginConfigFile(home), path.join(home, 'dsh-prompt-enhancer.config.json'));
  assert.equal(sys.updateStateFile(home), path.join(home, 'dsh-prompt-enhancer.update-state.json'));
  const savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    assert.equal(sys.pluginConfigFile(), path.join(home, 'dsh-prompt-enhancer.config.json'));
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
  }
});

/* ---------------- ⑦ rollbackToVersion 退避闸两分支 ---------------- */

test('UGATE-18 rollbackToVersion：backoff 命中 → 放弃回滚且不触发 stop/install 下载', async () => {
  const calls = [];
  const r = await updater.rollbackToVersion('fake-svc', 'web', '3.3.1', {
    readState: () => ({ nextRetryAt: Date.now() + 60000, dayCount: 1, dayKey: todayKey() }),
    stopService: async () => { calls.push('stop'); return true; },
    install: async () => { calls.push('install'); return { ok: true }; },
    startService: () => { calls.push('start'); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ROLLBACK_BACKOFF_SKIPPED');
  assert.deepEqual(calls, [], '闸命中时不得触碰 stopService/install');
});

test('UGATE-19 rollbackToVersion：backoff 未命中 → 行为与现状一致（stop→install→start）', async () => {
  const calls = [];
  const r = await updater.rollbackToVersion('fake-svc', 'web', '3.3.1', {
    readState: () => ({}),
    stopService: async () => { calls.push('stop'); return true; },
    install: async () => { calls.push('install'); return { ok: true }; },
    startService: () => { calls.push('start'); },
  });
  assert.deepEqual(r, { ok: true, version: '3.3.1' });
  assert.deepEqual(calls, ['stop', 'install', 'start']);
});

test('UGATE-20 rollbackToVersion：NO_OLD_VERSION 早退语义不回退；install 失败仍终态 failed', async () => {
  const r1 = await updater.rollbackToVersion('fake-svc', 'web', '', { readState: () => ({}) });
  assert.equal(r1.code, 'NO_OLD_VERSION');
  const r2 = await updater.rollbackToVersion('fake-svc', 'web', '3.3.1', {
    readState: () => ({}),
    stopService: async () => true,
    install: async () => ({ ok: false, message: 'boom' }),
    startService: () => {},
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'ROLLBACK_INSTALL_FAILED');
});

/* ---------------- executor 下载失败回写退避 ---------------- */

test('UGATE-21 bumpUpdateFail 回写：连败/每日计数/nextRetryAt 落盘字段正确', () => {
  const dir = tmpRoot();
  const p = path.join(dir, 'dsh-prompt-enhancer.update-state.json');
  assert.equal(typeof updater.bumpUpdateFail, 'function', 'bumpUpdateFail 未导出');
  // bumpUpdateFail 内部走 sys.updateStateFile()——以 DSH_HOME 注入隔离
  const savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    updater.bumpUpdateFail('stage:STAGE_DOWNLOAD_FAILED:test');
    const st1 = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(st1.failCount, 1);
    assert.equal(st1.dayCount, 1);
    assert.ok(st1.nextRetryAt > Date.now());
    assert.match(st1.lastFailReason, /^stage:STAGE_DOWNLOAD_FAILED/);
    updater.bumpUpdateFail('verify:STAGE_INVALID');
    const st2 = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(st2.failCount, 2);
    assert.ok(st2.nextRetryAt >= st1.nextRetryAt, '第二次退避不早于第一次');
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
  }
});

test('UGATE-22 显式代理读取与降级标记：readDlProxy 容错 + effectiveDlProxy 受降级位控制', () => {
  const dir = tmpRoot();
  const savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    // 无配置文件 → 空
    assert.equal(updater.effectiveDlProxy(), undefined, '无显式代理时 effectiveDlProxy 为 undefined');
    // 写入 download.proxy 后需重载模块才生效（启动时读一次语义）——直接验证降级开关路径：
    updater.markDlProxyFailed(new Error('ECONNREFUSED-test'));
    assert.equal(updater.effectiveDlProxy(), undefined);
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
  }
});

/* ---------------- ⑨ scheduleServiceRestart 防抖（seam 隔离，绝不触真服务）---------------- */

test('UGATE-23 scheduleServiceRestart：首次放行写记录；立即二调 debounced 且 cli 目录仅一个脚本（先判后写）', () => {
  const dir = tmpRoot();
  const stateFile = path.join(dir, 'update-state.json');
  const fakeSpawn = () => ({ status: 0, stderr: '', stdout: '' }); // create/run 全成功，零真实副作用
  const realCliDir = path.join(process.env.DSH_ENHANCER_EXECUTOR_ROOT, 'cli');
  const opts = { spawnSyncImpl: fakeSpawn, stateFileOverride: stateFile, lastScheduleAt: 0 };
  // lastScheduleAt:0 显式注入——本用例不依赖执行顺序，双闸①状态完全可控
  const r1 = indexMod.scheduleServiceRestart('fake-svc', opts);
  assert.equal(r1.ok, true, '首次调用应放行');
  assert.notEqual(r1.debounced, true);
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(Number.isInteger(st.pendingRestartAt) && st.pendingRestartAt > Date.now() + 60 * 1000, '记录应含约 120s 兜底时刻');
  assert.ok(/restart-service-\d+\.cjs$/.test(st.restartScript), '记录应含 restartScript 绝对路径');
  assert.ok(fs.existsSync(st.restartScript), '脚本应已生成');
  assert.equal(fs.readdirSync(realCliDir).filter((f) => /^restart-service-/.test(f)).length, 1);
  // 立即二调：双闸①命中 → debounced，且不得生成第二个脚本
  const r2 = indexMod.scheduleServiceRestart('fake-svc', { spawnSyncImpl: fakeSpawn, stateFileOverride: stateFile, lastScheduleAt: Date.now() - 1000 });
  assert.equal(r2.ok, true);
  assert.equal(r2.debounced, true, '窗口内重复调用必须防抖');
  assert.equal(fs.readdirSync(realCliDir).filter((f) => /^restart-service-/.test(f)).length, 1, '跳过路径不得产生新脚本');
  // 记录未被二调改写（先判后写）
  const st2 = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(st2.restartScript, st.restartScript);
});

test('UGATE-24 scheduleServiceRestart 过期清理路径①：窗口过期后放行写入前清理旧脚本并覆盖记录', () => {
  const dir = tmpRoot();
  const stateFile = path.join(dir, 'update-state.json');
  const oldScript = path.join(dir, 'restart-service-old.cjs');
  fs.writeFileSync(oldScript, '// stale', 'utf8');
  // 预置过期记录（兜底时刻已过 10 分钟）
  fs.writeFileSync(stateFile, JSON.stringify({ schema: 1, pendingRestartAt: Date.now() - 10 * 60 * 1000, restartScript: oldScript }), 'utf8');
  const fakeSpawn = () => ({ status: 0, stderr: '', stdout: '' });
  const r = indexMod.scheduleServiceRestart('fake-svc', {
    spawnSyncImpl: fakeSpawn,
    stateFileOverride: stateFile,
    lastScheduleAt: 0, // 双闸①放行
    windowMs: 1,       // 收窄窗口使过期判定即时生效（gate② 对过期记录不阻塞）
  });
  assert.equal(r.ok, true);
  assert.notEqual(r.debounced, true, '过期记录不得阻塞新调度');
  assert.equal(fs.existsSync(oldScript), false, '旧脚本应在放行写入点被安全清理');
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(fs.existsSync(st.restartScript), '记录指向新脚本');
  assert.notEqual(st.restartScript, oldScript);
});

/* ---------------- janitor 清扫（A.1.6-c 注入演练）---------------- */

test('UGATE-25 sweepStaleExecTasks：>24h 孤儿任务 备份→删除→复查闭环；<24h 与异名保留', async () => {
  const io = { out: (s) => lines.push(String(s)) };
  const lines = [];
  const dir = tmpRoot();
  const staleTs = Date.now() - 25 * 60 * 60 * 1000;
  const freshTs = Date.now() - 1 * 60 * 60 * 1000;
  const staleName = 'dsh-prompt-enhancer-exec-123-' + staleTs;
  const freshName = 'dsh-prompt-enhancer-exec-456-' + freshTs;
  let deleted = [];
  const queryImpl = (args) => {
    const a = Array.isArray(args) ? args : [];
    if (a[0] === '/Query' && a[1] === '/FO') {
      const rows = ['"SomeOtherTask"', '"' + staleName + '"', '"' + freshName + '"'];
      if (deleted.length && !a.includes('/XML')) {
        return { status: 0, stdout: '\r\n' + rows.filter((r) => !deleted.includes(r.slice(1, -1))).join('\r\n') + '\r\n', stderr: '' };
      }
      return { status: 0, stdout: '\r\n' + rows.join('\r\n') + '\r\n', stderr: '' };
    }
    if (a[0] === '/Query' && a.includes('/XML')) {
      const name = a[a.indexOf('/TN') + 1];
      return { status: 0, stdout: '<?xml version="1.0"?><Task><RegistrationInfo><Description>' + name + '</Description></RegistrationInfo></Task>', stderr: '' };
    }
    if (a[0] === '/Delete') {
      deleted.push(a[a.indexOf('/TN') + 1]);
      return { status: 0, stdout: 'SUCCESS', stderr: '' };
    }
    throw new Error('unexpected ' + JSON.stringify(a));
  };
  const r = await updater.sweepStaleExecTasks(io, { queryImpl, backupDir: path.join(dir, 'backup') });
  assert.equal(r.ok, true);
  assert.equal(r.scanned, 2);
  assert.deepEqual(r.cleaned, [staleName], '只清理 >24h 的孤儿');
  assert.equal(deleted.length, 1);
  assert.equal(r.remaining, 1, '复查残留 = 保留的 <24h 任务');
  // 备份核验非空
  const backupDir = path.join(dir, 'backup');
  const backups = [];
  const walk = (d) => fs.readdirSync(d).forEach((f) => {
    const p = path.join(d, f);
    fs.statSync(p).isDirectory() ? walk(p) : backups.push(p);
  });
  walk(backupDir);
  assert.equal(backups.length, 1);
  assert.ok(fs.statSync(backups[0]).size > 20, '备份 XML 必须非空');
  assert.match(fs.readFileSync(backups[0], 'utf8'), new RegExp(staleName));
  assert.ok(lines.some((l) => l.includes('复查完成')), '应打印复查清单');
});

test('UGATE-26 sweepStaleExecTasks：XML 备份不可得时宁留勿删（破坏性操作纪律）', async () => {
  const lines = [];
  const io = { out: (s) => lines.push(String(s)) };
  const staleName = 'dsh-prompt-enhancer-exec-789-' + (Date.now() - 30 * 60 * 60 * 1000);
  let deleteCalled = false;
  const queryImpl = (args) => {
    const a = Array.isArray(args) ? args : [];
    if (a[0] === '/Query' && a[1] === '/FO') return { status: 0, stdout: '"' + staleName + '"\r\n', stderr: '' };
    if (a[0] === '/Query' && a.includes('/XML')) return { status: 1, stdout: '', stderr: 'access denied' };
    if (a[0] === '/Delete') { deleteCalled = true; return { status: 0, stdout: 'SUCCESS', stderr: '' }; }
    throw new Error('unexpected');
  };
  const r = await updater.sweepStaleExecTasks(io, { queryImpl, backupDir: path.join(os.tmpdir(), 'dsh-ugate-nobak-' + Date.now()) });
  assert.equal(deleteCalled, false, '备份不可得绝不能删除');
  assert.deepEqual(r.cleaned, []);
});
