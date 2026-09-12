'use strict';
// 批次A（optimization-plan-20260824 §A.1/A.2）·更新器熔断防抖契约测试。
// 覆盖：computeBackoff/shouldGateAuto/isDebounceBlocked 决策矩阵、rpc-schema update/install 契约、
// 状态文件原子写与容错读、rollbackToVersion 退避闸两分支、失败回退写、代理降级、诊断日志脱敏。
// 2026-09-13（用户指令·移除插件内重启能力）——受测对象已随重启/自愈链删除，整段移除：
//   UGATE-10/11（index.cjs kill-switch 三态 / autoGateDecision 四态：自动重启链已删）、
//   UGATE-23/24（scheduleServiceRestart 防抖调度）、UGATE-25/26（sweepStaleExecTasks janitor）、
//   UGATE-31（restartService 清空陈旧 diagLog + HTTP restart 入口）、UGATE-32（killConflictingHolders 留痕）。
// 改写（受测对象仍在，仅契约变化）：
//   UGATE-12~14 portRestart schema/handler/client 接线 → 新 RPC update/install + 重启 RPC 不得残留；
//   UGATE-15/16 index.cjs read/writeUpdateStateSafe → 存活的 updater-host read/writeUpdateState
//   （同一「tmp+rename 原子写 / 损坏按空状态 fail-open」不变式）；UGATE-19 → 新 rollbackToVersion
//   契约（只重装旧版本，不再停/启服务）。
// 隔离纪律：EXECUTOR_ROOT/DSH_HOME 指临时目录 + DSH_ENHANCER_NO_INDEX=1，绝不触真实服务/下载（红线②）。
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
const { schemas, validateRpcArgs } = require('../lib/rpc-schema.cjs');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ugate-'));
const todayKey = () => M.localDayKey(Date.now());
// isDebounceBlocked(state, now, windowMs) 的窗口由调用方传入；原 index.cjs 的 RESTART_DEBOUNCE_MS
// 随重启调度链删除，故按 maintain-lib 文档口径（写入时 pendingRestartAt = now + 120s）内联同值。
const RESTART_DEBOUNCE_WINDOW_MS = 120 * 1000;

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
  const W = RESTART_DEBOUNCE_WINDOW_MS;
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now + 120 * 1000 }, now, W), true, '写入后 120s 兜底时刻属未来，负龄期仍在窗口内');
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now - (W + 1000) }, now, W), false, 'now-ts = W+1s ≥ W → 窗外放行');
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now - (W - 1000) }, now, W), true, 'now-ts < W 窗口内阻塞');
  assert.equal(M.isDebounceBlocked({}, now, W), false, 'pendingRestartAt 缺损放行');
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: 0 }, now, W), false, '0 值放行');
  assert.equal(M.isDebounceBlocked(null, now, W), false, 'null 状态放行');
});

test('UGATE-09 isDebounceBlocked 时钟回拨容忍：超前超过一个完整窗口视为立即过期（防死锁）', () => {
  const now = Date.now();
  const W = RESTART_DEBOUNCE_WINDOW_MS;
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now + W + 60000 }, now, W), false, '超前 > windowMs 的脏数据放行');
  assert.equal(M.isDebounceBlocked({ pendingRestartAt: now + W - 60000 }, now, W), true, '正常未来兜底时刻（≤windowMs 内）仍阻塞');
});

/* ---------------- rpc-schema：新安装 RPC 契约 ---------------- */

test('UGATE-12 rpc-schema：update/install 宽松可选 profile 校验（重启 RPC 已移除）', () => {
  assert.ok(schemas['update/install'], 'schema 必须注册');
  assert.equal(schemas['update/portRestart'], undefined, '已移除的重启 RPC 不得残留在 schema 表');
  assert.deepEqual(schemas['update/install'].required, []);
  assert.equal(validateRpcArgs('update/install', {}).ok, true, '不带参数合法（profile 缺省）');
  assert.equal(validateRpcArgs('update/install', { profile: 'web', serviceName: 'dsh-web' }).ok, true);
  assert.equal(validateRpcArgs('update/install', { profile: 123 }).ok, false, 'profile 非字符串拒绝');
});

test('UGATE-13 双侧 schema 同步：src/host/rpc-schema.js 与 lib/rpc-schema.cjs 均含 update/install 规则且无 portRestart', () => {
  for (const f of ['src/host/rpc-schema.js', 'lib/rpc-schema.cjs']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(src.includes("'update/install'"), f + ' 缺 update/install 规则');
    assert.ok(!src.includes('update/portRestart'), f + ' 残留已移除的重启 RPC');
    assert.ok(src.includes("args.profile === undefined || typeof args.profile === 'string'"), f + ' 缺 profile 宽松可选校验');
  }
});

test('UGATE-14 接线断言：host 注册 update/install 且 client 安装链调用它（重启 RPC 全链不复存在）', () => {
  const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.cjs'), 'utf8');
  assert.ok(idxSrc.includes("harness.handle('update/install'"), 'host 未注册 update/install');
  // 只锚「注册」形态：index.cjs 的注释里仍会提到被删的 RPC 名（说明性文字），不构成残留接线
  assert.ok(!/harness\.handle\('update\/portRestart'/.test(idxSrc), 'host 残留已移除的重启 RPC 注册');
  const cardRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'components', 'updater-card.js'), 'utf8');
  const cm = /module\.exports = ("(?:[^"\\]|\\.)*");?\s*$/.exec(cardRaw);
  const card = JSON.parse(cm[1]);
  assert.ok(card.includes("host.call('update/install', { profile, serviceName })"), 'client 安装链未接线 update/install');
  assert.ok(!card.includes('update/portRestart'), 'client 残留已移除的重启 RPC');
});

/* ---------------- ⑥ 状态文件原子写 ---------------- */

test('UGATE-15 writeUpdateState 原子性：rename 中途失败不留半截 JSON（目标保持上一份完整状态）', () => {
  const dir = tmpRoot();
  const p = path.join(dir, 'state.json');
  updater.writeUpdateState({ schema: 1, failCount: 1 }, { stateFileOverride: p });
  const before = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(before.failCount, 1);
  // 模拟中途崩溃：writeFileSync 成功、renameSync 抛错（fs 为同一核心模块对象，patch 生效）
  const origRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated crash between write and rename'); };
  try {
    assert.throws(() => updater.writeUpdateState({ schema: 1, failCount: 99 }, { stateFileOverride: p }));
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

test('UGATE-16 readUpdateState 容错：缺失/损坏/数组均按空状态（闸门 fail-open 放行）', () => {
  const dir = tmpRoot();
  assert.deepEqual(updater.readUpdateState(path.join(dir, 'nope.json')), {});
  const p = path.join(dir, 'bad.json');
  fs.writeFileSync(p, '{{{', 'utf8');
  assert.deepEqual(updater.readUpdateState(p), {});
  fs.writeFileSync(p, '[1,2]', 'utf8');
  assert.deepEqual(updater.readUpdateState(p), {}, '数组形态按空处理');
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

test('UGATE-19 rollbackToVersion：backoff 未命中 → 只重装旧版本，不再停/启服务（needsManualRestart）', async () => {
  const calls = [];
  const r = await updater.rollbackToVersion('fake-svc', 'web', '3.3.1', {
    readState: () => ({}),
    stopService: async () => { calls.push('stop'); return true; },
    install: async () => { calls.push('install'); return { ok: true }; },
    startService: () => { calls.push('start'); },
  });
  assert.deepEqual(r, { ok: true, version: '3.3.1', needsManualRestart: true }, '装回后必须如实报告需用户手动重启');
  assert.deepEqual(calls, ['install'], '重启能力已移除：安装之外不得触碰 stop/start 服务');
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

/* ---------------- ⑦ 重启失败根因直显（2026-09-08 产品改进·diagLog 链路） ---------------- */

test('UGATE-27 dshErrLogTail/redactDiagLine：脱敏三形态 + 尾部截取 + 降级矩阵', () => {
  // redactDiagLine：URL token / Bearer / sk- 三类脱敏，普通行原样
  assert.equal(updater.redactDiagLine('GET /?token=abc123xyz&x=1 200'), 'GET /?token=***&x=1 200');
  assert.equal(updater.redactDiagLine('Authorization: Bearer eyJhbGciOi.x.y'), 'Authorization: Bearer ***');
  assert.equal(updater.redactDiagLine('api key sk-abcdef1234567890qwer'), 'api key sk-***');
  assert.equal(updater.redactDiagLine('JsonSchemaError: unsupported JSON schema'), 'JsonSchemaError: unsupported JSON schema');
  // 降级矩阵：注册表查不到的服务名 → 回退 EXECUTOR_ROOT/port-restart.err.log
  const fallback = path.join(sys.EXECUTOR_ROOT, 'port-restart.err.log');
  const L = '\r\n';
  const content = [
    'line-1-normal',
    'line-2 leak url http://127.0.0.1:3080/?token=SECRET123 tail',
    'x'.repeat(400), // 超长行 → 截断到 300 + '…'
    'line-4\0with-nul',
    'line-5-final',
  ].join(L);
  fs.writeFileSync(fallback, content, 'utf8');
  try {
    const tail = updater.dshErrLogTail('definitely-no-such-svc-xyz');
    assert.ok(tail.includes('line-5-final'), '应读到降级日志尾部');
    assert.ok(!tail.includes('SECRET123'), 'URL token 必须脱敏');
    assert.ok(tail.includes('token=***'), '脱敏占位符应存在');
    assert.ok(!tail.includes('\0'), 'NUL 字节应被清洗');
    assert.ok(tail.includes('line-4with-nul'), 'NUL 剥离后两侧文本保留（行内拼接）');
    assert.ok(tail.split('\n').length <= 5);
    assert.ok(tail.includes('…'), '超长行应截断');
    // maxLines 语义：只要最后 2 行
    const tail2 = updater.dshErrLogTail('definitely-no-such-svc-xyz', 2);
    assert.equal(tail2.split('\n').length, 2);
    assert.ok(tail2.includes('line-5-final'), '取的是最后 N 行');
    // 同步 fallback 文件不存在 → 空串（清理后再探一次）
  } finally {
    fs.unlinkSync(fallback);
  }
  assert.equal(updater.dshErrLogTail('definitely-no-such-svc-xyz'), '', '降级日志缺失应返回空串');
});

test('UGATE-28 client 接线断言：diagLog 状态/缓存作用域 ref/轮询缓存/failed 分支/终态两处/渲染块 + i18n ZH/EN 成对', () => {
  const cardRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'components', 'updater-card.js'), 'utf8');
  const cm = /module\.exports = ("(?:[^"\\]|\\.)*");?\s*$/.exec(cardRaw);
  const card = JSON.parse(cm[1]);
  assert.ok(card.includes('const [diagLog, setDiagLog] = React.useState(null);'), '缺 diagLog state');
  // 2026-09-12（审查修复·D2 blocker）：缓存必须放组件作用域——原 `let lastDiag = ''` 声明在
  // pollExecutorStatus 内，而 runPullApply(.catch) 与 pollRestored(超时分支) 越作用域引用 ⇒
  // ReferenceError → 其后的 setApplyErr/状态清理整块不执行（失败文案消失、按钮卡死）。
  assert.ok(card.includes("const lastDiagRef = React.useRef('');"), '缺组件级 diagLog 缓存 ref');
  const codeOnly = card.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal((codeOnly.match(/\blastDiag\b(?!Ref)/g) || []).length, 0, '禁止裸 lastDiag（每次渲染同一 ref，跨函数可见）');
  assert.ok(card.includes('lastDiagRef.current = s.diagLog.trim();'), '轮询未写缓存 ref');
  assert.ok(card.includes("typeof s.diagLog === 'string' && s.diagLog.trim()"), '轮询未缓存执行器 diagLog');
  assert.ok(card.includes('setDiagLog(dl || null);'), 'failed 分支未接线 diagLog');
  assert.ok(card.includes(': lastDiagRef.current;'), 'failed 分支未回退读缓存 ref');
  // 2026-09-13（重启能力移除）：原「重启超时/自愈重发」两处终态随重启 UI 一并删除，
  // 存活终态 = ① pollExecutorStatus 执行器不可达 ② runPullApply 前置链失败——两处仍须接线缓存 ref。
  assert.equal(card.split('setDiagLog(lastDiagRef.current || null);').length - 1, 2, 'updApplyExecutorDown 两处存活终态都应接线缓存 ref');
  assert.ok(card.includes("t('updDiagTitle')"), '渲染块未引用 updDiagTitle');
  // i18n：ZH/EN 成对
  const i18nRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'i18n.js'), 'utf8');
  const im = /module\.exports = ("(?:[^"\\]|\\.)*");?\s*$/.exec(i18nRaw);
  const i18n = JSON.parse(im[1]);
  const z = (i18n.match(/updDiagTitle: '([^']*)',/g) || []).length;
  assert.equal(z, 2, 'updDiagTitle 应 ZH/EN 成对出现');
  assert.ok(/updDiagTitle: '[^']*疑似根因/.test(i18n), 'ZH 文案缺失');
  assert.ok(/updDiagTitle: '[^']*root cause/.test(i18n), 'EN 文案缺失');
});

/* ---------------- ⑧ 2026-09-12 审查修复：D3 尾部降噪+根因优先 / D4 脱敏漏网 ----------------
   （原 D5「陈旧 diagLog 清空」随 restartService 移除，已无受测对象） ---------------- */

test('UGATE-29 redactDiagLine 补漏：JWT/Basic/键值凭据/7 字符 sk- 逐条脱敏，且原有三类与不误伤用例不变', () => {
  // 新增漏网形态（D4 实测确认原样输出）
  assert.equal(updater.redactDiagLine('payload eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'),
    'payload ***', '裸 JWT 必须脱敏');
  assert.equal(updater.redactDiagLine('Authorization: Basic dXNlcjpwYXNzd29yZA=='),
    'Authorization: Basic ***', 'Basic 凭据必须脱敏');
  assert.equal(updater.redactDiagLine('apiKey=AIzaSyD-1234567890abcdefghij'), 'apiKey=***', '驼峰 apiKey 必须脱敏');
  assert.equal(updater.redactDiagLine('password=hunter2secret'), 'password=***', 'password= 必须脱敏');
  assert.equal(updater.redactDiagLine('api sk-abcdefg'), 'api sk-***', '7 字符 sk- 必须脱敏（门槛 {8,} → {6,}）');
  assert.equal(updater.redactDiagLine('refresh_token: abcdefghijklmnop'), 'refresh_token: ***');
  assert.equal(updater.redactDiagLine('Passwd: hunter2secret'), 'Passwd: ***', '大小写不敏感');
  // 已知正常（不得改坏）
  assert.equal(updater.redactDiagLine('Authorization: BEARER xxx'), 'Authorization: BEARER ***');
  assert.equal(updater.redactDiagLine('?TOKEN=SECRET'), '?TOKEN=***');
  assert.equal(updater.redactDiagLine('authorization: bEaReR zzz'), 'authorization: bEaReR ***');
  assert.equal(updater.redactDiagLine('X-Api-Key: sk-live-abcdefghijklmnop'), 'X-Api-Key: ***');
  assert.equal(updater.redactDiagLine('OPENAI key sk-proj-abcdefghijklmnop'), 'OPENAI key sk-***');
  // UGATE-27 断言的精确输出必须保持
  assert.equal(updater.redactDiagLine('GET /?token=abc123xyz&x=1 200'), 'GET /?token=***&x=1 200');
  assert.equal(updater.redactDiagLine('JsonSchemaError: unsupported JSON schema'), 'JsonSchemaError: unsupported JSON schema');
  // 不误伤：普通文本不得被「secret/at」等词误脱敏
  assert.equal(updater.redactDiagLine('no secret here at all'), 'no secret here at all');
});

/* 尾部筛选隔离探针：临时把 sys.EXECUTOR_ROOT 指到临时目录 + 不存在的服务名（跳过注册表路径），
   绝不触碰真实日志/服务（红线②）。 */
function withFakeErrLog(content, fn) {
  const savedRoot = sys.EXECUTOR_ROOT;
  const dir = tmpRoot();
  fs.writeFileSync(path.join(dir, 'port-restart.err.log'), content, 'utf8');
  sys.EXECUTOR_ROOT = dir;
  try { return fn(dir); } finally { sys.EXECUTOR_ROOT = savedRoot; }
}

test('UGATE-30 dshErrLogTail 降噪+根因优先：噪声尾不再挤掉真根因；全噪声尾仍回退非空', () => {
  const L = '\r\n';
  // ① 噪声 + Error：真机形态——Error 在前，其后是启动警告（旧版 slice(-8) 全是噪声）
  const noiseBlock = [
    '(node:22300) ExperimentalWarning: SQLite is an experimental feature and might change at any time',
    '(Use `node --trace-warnings ...` to show where the warning was created)',
  ];
  const withError = [
    'Node.js v22.22.0',
    'throw new Error(`${binName}: cannot resolve profile bundle ${JSON.stringify(packageName)}`)',
    '^',
    'Error: dsh: cannot resolve profile bundle "dsh-web-search-pro" from the dsh installation',
    '    at resolveBundleDir (file:///C:/x/dsh-app-boot/lib/index.js:523:8)',
    '    at loadProfile (file:///C:/x/dsh-app-boot/lib/index.js:546:117)',
  ].concat(noiseBlock, noiseBlock, noiseBlock).join(L);
  const r1 = withFakeErrLog(withError, () => updater.dshErrLogTail('definitely-no-such-svc-d3a'));
  assert.ok(r1.includes('Error: dsh: cannot resolve profile bundle'), '必须看见真根因（旧版被噪声挤出窗口）\n实际：' + r1);
  assert.ok(!r1.includes('ExperimentalWarning'), '噪声行不得回传');
  assert.ok(!r1.includes('--trace-warnings'), 'trace-warnings 提示行不得回传');
  assert.ok(r1.split('\n').length <= 8, '仍受 maxLines 约束，实际 ' + r1.split('\n').length);
  // 根因优先但不得吃掉更宽窗口内的较早根因（回看池内最后一条根因行）
  const withOldError = [
    'Error: OLD-NOISE-BLOCK from a previous boot',
    '    at oldFrame (file:///C:/old.js:1:1)',
  ].concat(noiseBlock, noiseBlock, noiseBlock, noiseBlock, noiseBlock, noiseBlock, noiseBlock).join(L);
  const r2 = withFakeErrLog(withOldError, () => updater.dshErrLogTail('definitely-no-such-svc-d3b'));
  assert.ok(r2.includes('Error: OLD-NOISE-BLOCK'), '噪声尾后面的较早 Error 仍在 8KB 读区内，应被找回\n实际：' + r2);
  assert.ok(!r2.includes('ExperimentalWarning'));
  // ② 全噪声无 Error：必须回退原始尾部（非空，宁多勿漏）
  const allNoise = [].concat(noiseBlock, noiseBlock, noiseBlock, noiseBlock).join(L);
  const r3 = withFakeErrLog(allNoise, () => updater.dshErrLogTail('definitely-no-such-svc-d3c'));
  assert.notEqual(r3, '', '全噪声也必须返回非空尾部（绝不因筛选返回空串）');
  assert.ok(r3.includes('ExperimentalWarning'), '回退路径就是原始尾部（保留噪声原文）');
  assert.equal(r3.split('\n').length, 8, '回退时仍按 maxLines 取尾');
  // ③ 无根因（纯噪声外还有普通行）：保持原始尾部语义，不因猜测改写
  const plain = ['plain-a', 'plain-b', 'plain-c'].concat(noiseBlock, noiseBlock).join(L);
  const r4 = withFakeErrLog(plain, () => updater.dshErrLogTail('definitely-no-such-svc-d3d'));
  assert.ok(r4.includes('plain-a') && r4.includes('plain-b') && r4.includes('plain-c'), '普通行应原样保留');
  // ④ maxLines 语义不变：显式 2 行
  const r5 = withFakeErrLog(withError, () => updater.dshErrLogTail('definitely-no-such-svc-d3e', 2));
  assert.ok(r5.split('\n').length <= 2, 'maxLines=2 时不得超过 2 行');
  assert.ok(r5.includes('Error:'), 'maxLines 收窄后仍以根因行起头');
});
