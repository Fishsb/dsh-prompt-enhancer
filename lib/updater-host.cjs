'use strict';
/**
 * dsh-prompt-enhancer — independent update executor (v2.6.0).
 *
 * Standalone detached process on 127.0.0.1:DSH_EXECUTOR_PORT (default 3081).
 * Does NOT depend on the dsh-web service: when dsh-web stops, this executor
 * stays alive and finishes install → reliable sleep → start → port health
 * check → auto-retry (5 attempts) entirely on its own.
 *
 * Env:
 *   DSH_EXECUTOR_PORT  listening port (default 3081)
 *   DSH_DSH_BIN        dsh CLI entry (bin.js) for the install command
 *
 * RPC (POST /rpc, JSON {method, args}):
 *   ping    -> {ok, version, pid}
 *   status  -> {ok, phase, attempt, startedAt, message}
 *   apply   -> {repo, tag, profile, serviceName} — download + verify into
 *              staging ONLY; never touches the service/port (phase ends at
 *              'staged'). Install + all port operations belong to `restart`
 *   restart -> {serviceName, profile, tag?} — restart loop only; when a
 *              matching staged tarball exists (tag from one-click update),
 *              stops the service, installs it, then restarts with health
 *              check (rollback to previous version on restart failure)
 *   （v2.7.0：健康检查端口由 readServicePort 自解析，不再接受调用方 port——
 *   旧版 client 误传执行器端口导致健康检查恒通过）
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const sys = require('./sys.cjs');
const platformService = require('./platform-service.cjs');
const { sha256File } = require('./integrity.cjs');

const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
};

const PORT = Number(argValue('port') || process.env.DSH_EXECUTOR_PORT) || sys.EXECUTOR_PORT;
const DSH_BIN = argValue('dsh-bin') || process.env.DSH_DSH_BIN || '';
const TASK_NAME = argValue('task') || process.env.DSH_EXECUTOR_TASK || '';
const CMD_PATH = argValue('cmd') || process.env.DSH_EXECUTOR_CMD || '';
const VERSION = sys.EXECUTOR_VERSION;
const STAGING_DIR = sys.STAGING_DIR;
const BACKUP_DIR = sys.BACKUP_DIR;

// Reliable sleep — node timers do NOT depend on stdin (unlike `timeout`).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// PURE helpers shared with the bundle (single source of truth).
const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');
const pure = sys.extractPure(BODY);
const env = () => sys.mergedEnv(pure);

// ---- probes ----
// 2026-08-18 平台化：Node net 连接探测（跨平台，替代 Windows netstat 语法）。
// 返回 Promise<boolean>——端口可 TCP 连接即视为监听中。
function portListening(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { try { sock.destroy(); } catch { /* ignore */ } resolve(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(2000, () => done(false));
  });
}
// 2026-08-18 平台化：服务是否已停止（win: sc query；linux: systemctl is-active；darwin: launchctl list）
function serviceStopped(svc) {
  const backend = platformService.backendFor(process.platform);
  return backend ? backend.isStopped(svc, env()) : false;
}
// v3.1.6（用户指令·PID 校验）：读取服务当前 PID（平台化：win sc queryex / linux systemctl MainPID /
// darwin launchctl list）。返回 number 或 null（服务未运行/查询失败）。用于「重启成功 = PID 已更新」判定——
// 端口监听可能被旧进程残留占用，只有服务进程 PID 真正变化才证明服务重启过。
function servicePid(svc) {
  const backend = platformService.backendFor(process.platform);
  return backend ? backend.pid(svc, env()) : null;
}

// 2026-08-18 平台化：停止服务（win sc stop / linux systemctl stop / darwin launchctl bootout）
// v3.2（对照成熟实践·sc stop 异步坑 + SCM 30s 停止超时窗口）：停止等待上限 20s——
// sc stop 不等待停止完成就返回，必须轮询；SCM 停止超时默认 30s，10s 判失败偏紧。
async function stopService(svc) {
  const backend = platformService.backendFor(process.platform);
  if (!backend) return false;
  const r = backend.stopService(svc, env());
  if (!r.ok) return false;
  for (let i = 0; i < 20; i++) {
    if (backend.isStopped(svc, env())) return true;
    await sleep(1000);
  }
  return backend.isStopped(svc, env());
}

// 2026-08-18 平台化：启动服务（win sc start / linux systemctl start / darwin launchctl start/bootstrap）
function startService(svc) {
  const backend = platformService.backendFor(process.platform);
  if (!backend) return;
  backend.startService(svc, env());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- staging (download while service is still online) ----
// v3.2.1-p（用户实测·大陆网络）：github releases/download 直连可能被重置（curl 56）——
// 失败后依次尝试镜像前缀（ghproxy 类），全部失败才报错（附网络/代理/手动 staging 提示）。
const TARBALL_MIRRORS = [
  (u) => 'https://ghproxy.net/' + u,
  (u) => 'https://gh-proxy.com/' + u,
  (u) => 'https://ghfast.top/' + u,
];
function stageTarball(tag) {
  return new Promise((resolve) => {
    try {
      ensureDir(STAGING_DIR);
      const fileName = 'dsh-prompt-enhancer-' + tag + '.tgz';
      const dest = path.join(STAGING_DIR, fileName);
      const url = pure.buildTarballUrl(sys.INSTALL_REPO, tag);
      const urls = [url, ...TARBALL_MIRRORS.map((m) => m(url))];
      let idx = 0;
      const attempt = () => {
        if (idx >= urls.length) {
          resolve({
            ok: false,
            code: 'STAGE_DOWNLOAD_FAILED',
            message: '直连与镜像均下载失败（网络被重置 curl 56）。请检查网络/代理后重试，或手动下载 tgz 放入 ' + STAGING_DIR,
          });
          return;
        }
        const u = urls[idx];
        idx += 1;
        log('stage download (' + idx + '/' + urls.length + ') ' + u + ' -> ' + dest);
        const child = spawn('curl', ['-L', '--fail', '-sS', '-o', dest, u], {
          env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += String(d); });
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { child.kill(); } catch { /* ignore */ }
          log('stage download attempt ' + idx + ' timed out, fallback next');
          attempt();
        }, sys.INSTALL_TIMEOUT_MS);
        child.on('error', (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          log('stage download attempt ' + idx + ' error: ' + String(e.message || e));
          attempt();
        });
        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (code !== 0) {
            log('stage download attempt ' + idx + ' failed: ' + stderr.trim().slice(0, 200));
            attempt();
            return;
          }
          if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
            log('stage download attempt ' + idx + ' empty, fallback next');
            attempt();
            return;
          }
          resolve({ ok: true, path: dest, size: fs.statSync(dest).size });
        });
      };
      attempt();
    } catch (e) {
      resolve({ ok: false, code: 'STAGE_EXCEPTION', message: String(e.message || e) });
    }
  });
}

async function verifyTarball(tarballPath) {
  try {
    if (!fs.existsSync(tarballPath)) return { ok: false, code: 'STAGE_MISSING', message: 'staged tarball missing' };
    if (fs.statSync(tarballPath).size === 0) return { ok: false, code: 'STAGE_EMPTY', message: 'staged tarball is empty' };
    const r = spawnSync('tar', ['-tf', tarballPath], { encoding: 'utf8', windowsHide: true, timeout: 30000, env: env() });
    if (r.status !== 0) {
      return { ok: false, code: 'STAGE_INVALID', message: 'invalid tarball: ' + String(r.stderr || r.stdout || '').trim().slice(0, 300) };
    }
    if (!/package\.json/.test(String(r.stdout || ''))) {
      return { ok: false, code: 'STAGE_NO_PACKAGE', message: 'tarball missing package.json' };
    }
    const sha256 = await sha256File(tarballPath);
    return { ok: true, sha256 };
  } catch (e) {
    return { ok: false, code: 'STAGE_VERIFY_FAILED', message: String(e.message || e) };
  }
}

// ---- local install (whitelisted staging tarball only) ----
function installLocal(tarballPath, profile) {
  return new Promise((resolve) => {
    if (DSH_BIN === '' || !/^[A-Za-z0-9_-]+$/.test(profile) || !fs.existsSync(tarballPath)) {
      resolve({ ok: false, code: 'BAD_ARGS', message: 'dsh bin or local tarball invalid' });
      return;
    }
    const args = pure.buildLocalInstallArgs(DSH_BIN, profile, tarballPath);
    if (!sys.isLocalTarballInstallArgs(args)) {
      resolve({ ok: false, code: 'BAD_ARGS', message: 'local tarball whitelist rejected' });
      return;
    }
    log('local install: ' + args.join(' '));
    const child = spawn(process.execPath, args, { env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, code: 'TIMEOUT', message: 'local install timed out' });
    }, sys.INSTALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: String(e.code || 'SPAWN_FAILED'), message: String(e.message || '') });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, message: String(stderr || stdout || '').trim().slice(0, 500) });
    });
  });
}

// ---- rollback (best-effort: reinstall the previously installed version) ----
async function rollbackToVersion(svc, profile, oldVersion) {
  if (!oldVersion) return { ok: false, code: 'NO_OLD_VERSION', message: 'no old version to rollback' };
  log('rollback to ' + oldVersion);
  await stopService(svc);
  const r = await install(oldVersion, profile);
  if (!r.ok) return { ok: false, code: 'ROLLBACK_INSTALL_FAILED', message: r.message };
  startService(svc);
  return { ok: true, version: oldVersion };
}


// ---- state ----
const state = { phase: 'idle', attempt: 0, startedAt: 0, message: '', busy: false, applying: false };
const log = (msg) => console.log('[updater-host] ' + msg);

// ---- install (whitelisted template only) ----
function install(tag, profile) {
  return new Promise((resolve) => {
    if (DSH_BIN === '' || !/^v?\d+\.\d+\.\d+$/.test(tag) || !/^[A-Za-z0-9_-]+$/.test(profile)) {
      resolve({ ok: false, code: 'BAD_ARGS', message: 'dsh bin or args invalid' });
      return;
    }
    const args = pure.buildInstallArgs(DSH_BIN, tag, profile);
    if (!sys.isInstallArgs(args)) {
      resolve({ ok: false, code: 'BAD_ARGS', message: 'whitelist rejected' });
      return;
    }
    const child = spawn(process.execPath, args, { env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, code: 'TIMEOUT', message: 'install timed out' });
    }, sys.INSTALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: String(e.code || 'SPAWN_FAILED'), message: String(e.message || '') });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, message: String(stderr || stdout || '').trim().slice(0, 500) });
    });
  });
}

// ---- restart loop (3s settle, up to 5 start attempts) ----
// v2.7.0 修复：健康检查端口自解析（readServicePort 读服务配置 --port，兜底 3080）——
// 旧版依赖 client 传参，而 client 误传执行器端口（3081）→ 健康检查恒查执行器自身
// → 服务未恢复也判 healthy，5 次重试形同虚设。现忽略调用方 port，完全自治。
function resolveHealthPort(svc) {
  const p = sys.readServicePort(svc, env());
  return p.ok ? p.port : 3080;
}

// 2026-08-18（进程级重启降级·参考 dsh-restart）：读 host 写的进程索引
// （$DSH_HOME/dsh-prompt-enhancer.json，DSH 进程内由插件写入；解析在 platform-service）。
// 非服务化部署（无系统服务）时用索引重启：kill 旧进程 → spawn 同参数新进程 → 端口探测。
function readProcessIndex() {
  return platformService.readProcessIndex();
}

// 2026-08-18（对照成熟实践·PM2 信号流 + systemd EADDRINUSE 经验）：
// kill 分三级：SIGTERM（优雅，win=TerminateProcess）→ 等 PID 消失（kill-timeout，PM2 默认 1.6s 放宽到 5s）
// → 仍未退出则强杀（win taskkill /F /T 进程树；linux/darwin SIGKILL）→ 再等 PID 消失
// → 最后等端口释放（旧进程残留占端口直接 spawn 会 EADDRINUSE——systemd 重启循环根因）。
async function killProcess(idx) {
  if (!idx.pid) return true;
  const alive = () => { try { process.kill(idx.pid, 0); return true; } catch { return false; } };
  // 1. 优雅信号
  try { process.kill(idx.pid, 'SIGTERM'); } catch { /* 已退出/无权限 */ }
  // 2. 等 PID 消失（最多 5s）
  for (let i = 0; i < 5; i++) { if (!alive()) return true; await sleep(1000); }
  // 3. 仍存活 → 强杀
  if (alive()) {
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/F', '/T', '/PID', String(idx.pid)], { windowsHide: true, timeout: 10000 }); } catch { /* 已退出 */ }
    } else {
      try { process.kill(idx.pid, 'SIGKILL'); } catch { /* 已退出 */ }
    }
    for (let i = 0; i < 5; i++) { if (!alive()) break; await sleep(1000); }
  }
  return !alive();
}

async function restartViaProcess(idx, healthPort) {
  // 1. kill 旧进程（三级升级，确保旧进程退出）→ 等端口释放（最多 10s，防 EADDRINUSE）
  await killProcess(idx);
  for (let i = 0; i < 10; i++) {
    if (!(await portListening(healthPort))) break;
    await sleep(1000);
  }
  // 2. spawn 新进程（detached，日志追加；execPath 已验证存在）
  // 2026-08-18（v3.2.1 修复）：EXECUTOR_ROOT 定义在 sys.cjs（模块内 const），非全局——
  // 裸引用抛 ReferenceError（restart error: EXECUTOR_ROOT is not defined），进程级重启
  // 仅无服务环境触发（服务路径不走此函数），故仅无 nssm 机器暴露。改 sys.EXECUTOR_ROOT。
  const outLog = path.join(sys.EXECUTOR_ROOT, 'dsh-relaunch.out.log');
  const errLog = path.join(sys.EXECUTOR_ROOT, 'dsh-relaunch.err.log');
  let o = -1, e = -1;
  try { o = fs.openSync(outLog, 'a'); e = fs.openSync(errLog, 'a'); } catch { /* 日志打开失败仍继续 */ }
  let child;
  try {
    child = spawn(idx.execPath, idx.argv, { cwd: idx.cwd, detached: true, stdio: ['ignore', o >= 0 ? o : 'ignore', e >= 0 ? e : 'ignore'], env: process.env });
  } catch (ex) {
    try { if (o >= 0) fs.closeSync(o); } catch {} try { if (e >= 0) fs.closeSync(e); } catch {}
    return { ok: false, code: 'RELAUNCH_SPAWN_FAIL', message: 'spawn 新进程失败: ' + String(ex && ex.message || ex) };
  }
  child.unref();
  // 3. 等端口监听（最多 30s）
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await portListening(healthPort)) return { ok: true, pid: child.pid, message: 'relaunched pid ' + child.pid + ' on port ' + healthPort };
    await sleep(1000);
  }
  return { ok: false, code: 'RELAUNCH_TIMEOUT', message: '新进程 30s 内未监听端口 ' + healthPort + '（日志 ' + outLog + ' / ' + errLog + '）' };
}

// ============================================================================
// v3.2.1 — watchdog（PM2 God-Daemon 式降级守护，仅非服务化部署启用）
// ============================================================================
// 参考 PM2 守护模型：常驻守护进程 + 监听被守护进程退出 + 自动拉起——不需要系统服务、
// 不需要管理员。无系统服务（无 nssm）时执行器即守护层：周期健康检查（ping DSH 端口）→
// DSH 崩溃按进程索引自动拉起（崩溃自愈；比 nssm 的"服务进程重启"更强——应用级崩溃也管）；
// 防重启风暴（PM2 语义）：restart_delay / min_uptime / max_restarts。
const WATCH_INTERVAL_MS = 10000;      // 健康检查周期（PM2 无此概念，取值与探测成本平衡）
const WATCH_RESTART_DELAY_MS = 3000;  // 拉起延迟（PM2 restart_delay）
const WATCH_MIN_UPTIME_MS = 5000;     // 稳定运行判定（PM2 min_uptime：<此值即闪退，风暴计数不重置）
const WATCH_MAX_RESTARTS = 15;        // 窗口内最大重启次数（PM2 max_restarts）
const WATCH_WINDOW_MS = 60000;        // 计数窗口（PM2 默认单位时间）

const watchdog = {
  enabled: false,
  timer: null,
  lastSpawnAt: 0,
  lastSpawnPid: 0, // v3.2.1-c（2026-08-19）：watchdog 最近一次拉起的 DSH pid——服务出现让位时据此杀进程释放端口
  restartCount: 0,
  windowStart: Date.now(),
  state: 'idle', // idle | watching | restarting | paused
  message: '',
};

/** 守护仅在「非服务化部署 + 存在进程索引」时启用（有服务交给系统服务，无需本守护）。 */
function watchdogShouldRun() {
  try {
    const backend = platformService.backendFor(process.platform);
    if (backend && backend.detectService('dsh-web', env()).exists) return false;
    const idx = readProcessIndex();
    return !!idx;
  } catch { return false; }
}

function watchdogStop() {
  if (watchdog.timer) { clearInterval(watchdog.timer); watchdog.timer = null; }
  watchdog.enabled = false;
  watchdog.state = 'idle';
  watchdog.message = '';
}

async function watchdogTick() {
  if (!watchdog.enabled) return;
  // v3.2.1-c（2026-08-19 用户实测·插件自洽接管）：服务出现（用户点了 serviceInstall 装好）
  // → 停 watchdog 前先杀掉本 watchdog 之前拉起的 DSH——否则旧进程占着 3080，服务 node
  // EADDRINUSE 崩溃循环，安装后无法自动接管端口（不能依赖用户手动杀进程）
  try {
    const backend = platformService.backendFor(process.platform);
    if (backend && backend.detectService('dsh-web', env()).exists) {
      if (watchdog.lastSpawnPid) {
        try {
          process.kill(watchdog.lastSpawnPid);
          log('watchdog off: killing own-spawned DSH pid ' + watchdog.lastSpawnPid + ' (release port for service)');
        } catch { /* 进程已退出则忽略 */ }
        watchdog.lastSpawnPid = 0;
        await sleep(1500); // 等端口释放（进程退出）
      }
      watchdogStop();
      log('watchdog off: service present (service path takes over)');
      return;
    }
  } catch { /* 检测失败按无服务继续 */ }
  const healthPort = resolveHealthPort('dsh-web');
  if (await portListening(healthPort)) {
    // DSH 活着：稳定运行（≥min_uptime）→ 清零风暴计数（PM2 min_uptime 语义）
    if (watchdog.lastSpawnAt && Date.now() - watchdog.lastSpawnAt >= WATCH_MIN_UPTIME_MS) {
      watchdog.restartCount = 0;
      watchdog.windowStart = Date.now();
    }
    watchdog.state = 'watching';
    watchdog.message = 'healthy';
    return;
  }
  // DSH 挂了 → 拉起（防抖）
  const now = Date.now();
  if (now - watchdog.windowStart > WATCH_WINDOW_MS) { watchdog.windowStart = now; watchdog.restartCount = 0; }
  if (watchdog.restartCount >= WATCH_MAX_RESTARTS) {
    watchdog.state = 'paused';
    watchdog.message = 'paused: ' + watchdog.restartCount + ' restarts in window (crash loop)';
    log('watchdog PAUSED: ' + watchdog.message);
    return; // 风暴停手，等窗口重置
  }
  watchdog.state = 'restarting';
  watchdog.message = 'DSH down, restarting (' + (watchdog.restartCount + 1) + '/' + WATCH_MAX_RESTARTS + ')';
  log('watchdog: DSH down, restarting (' + (watchdog.restartCount + 1) + '/' + WATCH_MAX_RESTARTS + ')');
  await sleep(WATCH_RESTART_DELAY_MS); // PM2 restart_delay
  const idx = readProcessIndex();
  if (!idx) { watchdogStop(); watchdog.message = 'no process index — watchdog off'; log('watchdog OFF: no process index'); return; }
  const rr = await restartViaProcess(idx, healthPort);
  watchdog.restartCount += 1;
  if (rr.ok) {
    watchdog.lastSpawnAt = Date.now();
    watchdog.lastSpawnPid = rr.pid; // v3.2.1-c：记录本次拉起的 DSH，服务出现时让位杀掉
    watchdog.message = 'relaunched pid ' + rr.pid + ' (watchdog)';
    log('watchdog relaunched pid ' + rr.pid);
  } else {
    watchdog.message = 'relaunch failed: ' + rr.message;
    log('watchdog relaunch FAILED: ' + rr.message);
  }
}

/** 在执行器 HTTP 服务就绪后调用（onListen）。--no-watchdog 或 DSH_EXECUTOR_NO_WATCHDOG=1 关闭。 */
function watchdogStart() {
  if (watchdog.timer) return;
  if (argValue('no-watchdog') !== undefined || process.env.DSH_EXECUTOR_NO_WATCHDOG === '1') {
    log('watchdog disabled by flag');
    return;
  }
  watchdog.enabled = watchdogShouldRun();
  if (!watchdog.enabled) {
    log('watchdog disabled (service present or no process index)');
    return;
  }
  watchdog.state = 'watching';
  watchdog.message = 'watching DSH every ' + WATCH_INTERVAL_MS + 'ms';
  log('watchdog enabled: watching DSH every ' + WATCH_INTERVAL_MS + 'ms');
  watchdogTick(); // 立即首查
  watchdog.timer = setInterval(watchdogTick, WATCH_INTERVAL_MS);
}

/**
 * v3.2.1-d（2026-08-19 用户建议·接管交给重启流程）：查找 healthPort 当前监听者 PID。
 * 服务路径重启时用于识别「端口被旧 DSH（前台/watchdog 拉的）占用」——服务 node
 * EADDRINUSE 起不来，必须由重启流程释放端口后才能由服务接管（用户主动点端口重启
 * = 授权接管；不做安装时自动杀，避免不可控副作用）。
 */
async function listenerPid(port) {
  try {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    const re = new RegExp('TCP\\s+[^\\s]+:' + port + '\\s+[^\\s]+\\s+LISTENING\\s+(\\d+)');
    for (const line of String(r.stdout || '').split(/\r?\n/)) {
      const m = line.match(re);
      if (m) return Number(m[1]);
    }
  } catch { /* ignore */ }
  return null;
}

/** 杀掉进程树（/T 含子进程）。 */
function killPidTree(pid) {
  try {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    return true;
  } catch { return false; }
}

async function restartService(svc) {
  if (state.busy) return { ok: false, code: 'BUSY', message: 'restart already in progress' };
  state.busy = true;
  state.phase = 'restarting';
  state.attempt = 0;
  state.startedAt = Date.now();
  state.message = 'stopping';
  const healthPort = resolveHealthPort(svc);
  // v3.1.6（用户指令·PID 校验）：关闭前记录服务 PID——重启成功 = 新 PID ≠ 旧 PID。
  // 仅端口监听不足以证明「真的重启了」（旧进程残留/假 healthy 根因），PID 变化才是硬证据。
  const oldPid = servicePid(svc);
  log('restart start svc=' + svc + ' healthPort=' + healthPort + ' oldPid=' + (oldPid === null ? 'none' : oldPid));
  // 2026-08-18 平台化：服务停止/启动走 platform-service 后端（win sc / linux systemctl / darwin launchctl）
  const backend = platformService.backendFor(process.platform);
  // 非服务化部署（平台不支持服务管理 或 服务不存在）→ 进程级重启降级（参考 dsh-restart）
  // 2026-08-19（v3.2.1 修复）：本分支在函数体 try/finally 之外（finally 只包服务路径），
  // return 不释放 state.busy → 成功后 busy 恒 true → 后续 restart 请求全部被 484 行
  // BUSY 拒绝（执行器 status 恒 busy:true，端口重启"点了没反应"）。三个 return 前显式释放。
  if (!backend || !backend.detectService(svc, env()).exists) {
    state.message = 'no managed service — process-level restart';
    log('NO SERVICE for svc=' + svc + ' — falling back to process-level restart');
    const idx = readProcessIndex();
    if (!idx) {
      state.phase = 'failed';
      state.message = 'no managed service and no process index — 无法自动重启，请手动重启 DSH';
      log('NO SERVICE AND NO PROCESS INDEX');
      state.busy = false;
      return { ok: false, code: 'NO_SERVICE_AND_NO_INDEX', message: 'no managed service and no dsh process index' };
    }
    const rr = await restartViaProcess(idx, healthPort);
    if (rr.ok) {
      state.phase = 'healthy';
      state.message = rr.message;
      log('process-level restart OK: ' + rr.message);
      state.busy = false;
      return { ok: true, ...rr };
    }
    state.phase = 'failed';
    state.message = rr.message;
    log('process-level restart FAILED: ' + rr.message);
    state.busy = false;
    return rr;
  }
  try {
    backend.stopService(svc, env());
    let stopped = false;
    for (let i = 0; i < 20; i++) {
      if (serviceStopped(svc)) { stopped = true; break; }
      await sleep(1000);
    }
    // v3.1.5（用户实测·假 healthy）：sc stop 后必须确认服务真的 STOPPED 才继续——
    // 此前 10 秒循环后不检查结果，直接假装已停止；执行器无权限（sc stop 拒绝访问）
    // 时服务根本没停，round 1 探测到旧进程仍占端口 → 误判 healthy。现在未停成直接
    // 失败返回，明确暴露「服务未停止（权限/其他）」而非假成功。（v3.2：等待上限 20s）
    if (!stopped) {
      state.phase = 'failed';
      state.message = 'stop failed: service did not reach STOPPED within 20s (check executor runs as SYSTEM)';
      log('STOP FAILED svc=' + svc + ' (still not STOPPED after 20s)');
      return { ok: false, code: 'STOP_FAILED', message: 'service did not stop within 20s' };
    }
    state.message = 'stopped, settling 3s';
    await sleep(3000);

    // v2.7.2 修复：每轮重试 = 完整「stop → start」组合（此前 stop 仅一次，失败轮只重复
    // start——进程残留/端口未释放时裸 start 无效，端口可能一直拉不起，需手动 stop+start
    // 两次才成功）。现每轮先 stop 幂等清理（已停止则 sc 立即返回），等 STOPPED/端口释放，
    // 再 start + 端口健康检查；成功即返回，失败进入下一轮完整组合，直至 maxAttempts 轮。
    const plan = pure.buildRestartPlan(svc, healthPort, 5);
    // v3.1.5（用户实测·重启第一次必然失败）：sc start 后从「固定等 8s 检查一次」改为
    // 「最长 20s 健康探测循环，每 1s 探测，端口通了立即 healthy」——DSH 冷启动（加载
    // 插件/执行器/数据库）常超过 8s，固定 8s 窗口导致 round 1 稳定判失败、round 2 才成功；
    // 探测循环让慢启动的服务在首次尝试内即可成功，且快了立即返回、不空等。
    const HEALTH_PROBE_MAX_MS = 20000;
    const HEALTH_PROBE_INTERVAL_MS = 1000;
    for (let attempt = 1; attempt <= plan.maxAttempts; attempt++) {
      state.attempt = attempt;
      state.message = 'round ' + attempt + ': stop+start';
      log('round ' + attempt + ' of ' + plan.maxAttempts + ': stop+start');
      backend.stopService(svc, env());
      let roundStopped = false;
      for (let i = 0; i < 20; i++) {
        if (serviceStopped(svc)) { roundStopped = true; break; }
        await sleep(1000);
      }
      if (!roundStopped) {
        // v3.1.5：轮内 stop 未成（权限/拒绝）→ 直接失败，不假装已停止后误判 healthy
        state.phase = 'failed';
        state.message = 'stop failed on round ' + attempt + ': service did not STOPPED (check executor SYSTEM)';
        log('STOP FAILED round ' + attempt + ' svc=' + svc);
        return { ok: false, code: 'STOP_FAILED', attempt, message: 'service did not stop on round ' + attempt };
      }
      backend.startService(svc, env());
      let healthy = false;
      // v3.2.1-d（接管校验）：记录本轮 start 前 healthPort 的监听者（旧 DSH / 残留进程）。
      // 服务 node 真正接管的证据 = 端口监听者已变化（不再是旧进程）。仅「端口有监听 +
      // 服务 PID 变化」不够——旧进程占着端口时服务 node 起不来，却会假 healthy。
      const preListener = await listenerPid(healthPort);
      let foreignKilled = false;
      const probeStart = Date.now();
      while (Date.now() - probeStart < HEALTH_PROBE_MAX_MS) {
        state.message = 'round ' + attempt + ': waiting for service (' + Math.round((Date.now() - probeStart) / 1000) + 's)';
        // v3.1.6（用户指令·PID 校验）：重启成功 = 端口监听 **且** 服务 PID 已更新
        // （新 PID 有效且 ≠ 关闭前 PID）。仅端口监听不可靠——旧进程残留也占端口，
        // 会误判 healthy（假 healthy 根因）；PID 变化才证明服务进程真正重启过。
        const newPid = servicePid(svc);
        const lp = await listenerPid(healthPort);
        if (lp !== null && lp !== preListener && newPid !== null && newPid !== oldPid) { healthy = true; break; }
        // v3.2.1-d（接管释放）：端口仍被本轮 start 前的旧监听者占着（服务 node 因
        // EADDRINUSE 起不来）→ 杀掉该进程释放端口，nssm 的重启循环会让服务 node
        // 重新监听并接管。只杀一次（foreignKilled 防重复/防误杀新进程）。
        if (!foreignKilled && lp !== null && preListener !== null && lp === preListener) {
          log('round ' + attempt + ': port ' + healthPort + ' held by stale pid ' + lp + ' — killing to let service node take over');
          killPidTree(lp);
          foreignKilled = true;
          await sleep(2000);
        }
        await sleep(HEALTH_PROBE_INTERVAL_MS);
      }
      if (healthy) {
        state.phase = 'healthy';
        state.message = 'healthy on round ' + attempt + ' (pid ' + oldPid + ' -> ' + servicePid(svc) + ')';
        log('healthy on round ' + attempt + ' (pid ' + oldPid + ' -> ' + servicePid(svc) + ')');
        return { ok: true, attempt, message: 'healthy' };
      }
      state.message = 'round ' + attempt + ' not ready (listening or pid unchanged), retrying stop+start';
      log('round ' + attempt + ' NOT ready: listening=' + (await portListening(healthPort)) + ' pid=' + servicePid(svc) + ' oldPid=' + oldPid);
      await sleep(5000);
    }
    state.phase = 'failed';
    state.message = 'failed after ' + plan.maxAttempts + ' rounds';
    log('FAILED after ' + plan.maxAttempts + ' rounds');
    return { ok: false, code: 'FAILED', attempts: plan.maxAttempts, message: 'service not listening after ' + plan.maxAttempts + ' rounds' };
  } finally {
    state.busy = false;
  }
}

// ---- HTTP server ----
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const respond = (obj) => {
      // v2.7.0 修复：补 CORS 预检必需头（allow-methods/allow-headers）——旧版仅有
      // allow-origin，浏览器（3080 页面 fetch 3081，POST+JSON）预检失败 → fetch reject
      // → client 显示「更新执行器不可用」。OPTIONS 预检同样走本 handler 返回带头响应。
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end(JSON.stringify(obj));
    };
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch { /* empty */ }
    const method = parsed.method || '';
    const args = parsed.args || {};
    if (method === 'ping') return respond({ ok: true, version: VERSION, pid: process.pid, port: PORT });
    if (method === 'status') return respond({ ok: true, ...state, watchdog: { enabled: watchdog.enabled, state: watchdog.state, message: watchdog.message, restartCount: watchdog.restartCount } });
    if (method === 'restart') {
      const svc = typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName) ? args.serviceName : 'dsh-web';
      const profile = typeof args.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(args.profile) ? args.profile : 'web';
      const tag = typeof args.tag === 'string' ? args.tag.trim() : '';
      if (state.busy || state.applying) return respond({ ok: false, code: 'BUSY', message: 'an apply/restart is already in progress' });
      (async () => {
        state.applying = true;
        state.phase = 'restarting';
        state.message = 'stopping';
        log('restart start svc=' + svc + (tag !== '' ? ' installTag=' + tag : ''));
        // v3.1.x（职责划分·用户指令）：端口重启模块负责全部端口操作（断开/监听/重启）；
        // 若一键更新已下载 staging tarball（tag 匹配）→ 在停服窗口内完成安装后重启
        let oldVersion = null;
        if (tag !== '') {
          if (!/^v?\d+\.\d+\.\d+$/.test(tag)) {
            state.applying = false; state.phase = 'failed'; state.message = 'invalid tag';
            return respond({ ok: false, code: 'BAD_TAG', message: 'invalid tag' });
          }
          oldVersion = sys.readInstalledPluginVersion(profile);
          const tarball = path.join(STAGING_DIR, 'dsh-prompt-enhancer-' + tag + '.tgz');
          if (fs.existsSync(tarball)) {
            const wasRunning = !serviceStopped(svc);
            const stopped = await stopService(svc);
            if (!stopped && wasRunning) {
              state.applying = false; state.phase = 'failed'; state.message = 'stop service failed';
              log('stop FAILED before install');
              return respond({ ok: false, code: 'STOP_FAILED', message: 'failed to stop service before install' });
            }
            state.phase = 'installing';
            state.message = 'installing local ' + tag;
            const r = await installLocal(tarball, profile);
            if (!r.ok) {
              state.applying = false; state.phase = 'failed'; state.message = 'install failed: ' + r.message;
              log('install FAILED: ' + r.message);
              if (wasRunning) { log('restoring service after failed install'); startService(svc); }
              return respond({ ok: false, code: r.code === 'TIMEOUT' ? 'TIMEOUT' : 'INSTALL_FAILED', message: r.message });
            }
            state.message = 'installed, restarting';
          } else {
            // 未找到 staging tarball（未先执行一键更新）→ 仅重启，不做安装
            log('no staged tarball for ' + tag + ' — restart only');
          }
        }
        // 重启循环（stop 幂等；带 tag 安装后服务已停，restartService 再 stop 无副作用）→ 启动 → 健康检查
        restartService(svc).then((rr) => {
          if (rr.ok) { state.applying = false; return; }
          if (tag !== '' && oldVersion) {
            state.phase = 'rollback';
            state.message = 'restart failed, rolling back to ' + oldVersion;
            log('restart FAILED, rolling back to ' + oldVersion);
            rollbackToVersion(svc, profile, oldVersion).then((rb) => {
              state.applying = false;
              if (!rb.ok) { state.phase = 'failed'; state.message = 'rollback failed: ' + rb.message; log('rollback FAILED: ' + rb.message); }
              else { state.phase = 'healthy'; state.message = 'rolled back to ' + rb.version; log('rolled back to ' + rb.version); }
            }).catch((e) => {
              state.applying = false; state.phase = 'failed'; state.message = 'rollback error: ' + String(e && e.message || e); log('rollback ERROR: ' + String(e && e.message || e));
            });
          } else {
            state.applying = false;
            state.phase = 'failed';
            state.message = 'restart failed after attempts';
            log('restart FAILED (no rollback): ' + (rr.message || ''));
          }
        }).catch((e) => {
          state.applying = false; state.phase = 'failed'; state.message = 'restart error: ' + String(e && e.message || e); log('restart ERROR: ' + String(e && e.message || e));
        });
        respond({ ok: true, accepted: true, version: tag || '', message: 'restart started' });
      })().catch((e) => {
        state.applying = false; state.phase = 'failed'; state.message = 'restart error: ' + String(e && e.message || e); log('restart ERROR: ' + String(e && e.message || e));
        respond({ ok: false, code: 'RESTART_ERROR', message: state.message });
      });
      return;
    }
    if (method === 'apply') {
      const tag = typeof args.tag === 'string' ? args.tag.trim() : '';
      const profile = typeof args.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(args.profile) ? args.profile : 'web';
      const svc = typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName) ? args.serviceName : 'dsh-web';
      const repo = typeof args.repo === 'string' ? args.repo : '';
      if (repo !== sys.INSTALL_REPO) return respond({ ok: false, code: 'BAD_REPO', message: 'repo must be ' + sys.INSTALL_REPO });
      if (!/^v?\d+\.\d+\.\d+$/.test(tag)) return respond({ ok: false, code: 'BAD_TAG', message: 'invalid tag' });
      if (state.busy || state.applying) return respond({ ok: false, code: 'BUSY', message: 'an apply/restart is already in progress' });
      (async () => {
        state.applying = true;
        state.phase = 'validating';
        state.message = 'validating ' + tag;
        log('apply start tag=' + tag + ' profile=' + profile + ' svc=' + svc);

        // 1. 在线拉取 staging（服务保持运行）
        state.phase = 'staging';
        state.message = 'downloading ' + tag;
        const staged = await stageTarball(tag);
        if (!staged.ok) {
          state.applying = false;
          state.phase = 'failed';
          state.message = 'stage failed: ' + staged.message;
          log('stage FAILED: ' + staged.message);
          return respond({ ok: false, code: staged.code, message: staged.message });
        }
        const verified = await verifyTarball(staged.path);
        if (!verified.ok) {
          state.applying = false;
          state.phase = 'failed';
          state.message = 'stage verify failed: ' + verified.message;
          log('stage verify FAILED: ' + verified.message);
          return respond({ ok: false, code: verified.code, message: verified.message });
        }

        // 2. 环境确认（仍在服务在线阶段）
        state.phase = 'envcheck';
        state.message = 'checking environment';
        const items = sys.probeEnv(svc, pure, env(), PORT);
        const blocked = items.filter((it) => it.level === 'block' && it.ok === false);
        if (blocked.length > 0) {
          state.applying = false;
          state.phase = 'failed';
          state.message = 'envcheck blocked: ' + blocked.map((it) => it.key).join(', ');
          log('envcheck BLOCKED: ' + blocked.map((it) => it.key).join(', '));
          return respond({ ok: false, code: 'ENVCHECK_FAILED', message: 'blocked envcheck: ' + blocked.map((it) => it.key).join(', ') });
        }

        // v3.1.x（职责划分·用户指令）：一键更新**仅执行更新操作**（下载 + 校验到 staging）——
        // 不停止服务、不安装、不触碰任何端口；安装与全部端口操作（断开/监听/重启）统一由
        // `restart` RPC（端口重启模块）在停服窗口内执行
        state.applying = false;
        state.phase = 'staged';
        state.message = 'staged ' + tag + '; use restart to install';
        log('apply staged (download only) tag=' + tag);
        return respond({ ok: true, accepted: true, version: tag, message: 'staged' });

      })().catch((e) => {
        state.applying = false;
        state.phase = 'failed';
        state.message = 'apply error: ' + String(e && e.message || e);
        log('apply ERROR: ' + String(e && e.message || e));
        respond({ ok: false, code: 'APPLY_ERROR', message: state.message });
      });
      return;
    }
    respond({ ok: false, code: 'UNKNOWN_METHOD', method });
  });
});
server.on('error', (e) => {
  // v3.2（动态端口 fallback）：固定端口被占用（EADDRINUSE）→ 改由 OS 动态分配（listen 0），
  // 实际端口写入 executor.port 文件供 executorEnsure 发现——不再因端口冲突直接退出。
  if (e && e.code === 'EADDRINUSE' && PORT !== 0) {
    console.error('[updater-host] port ' + PORT + ' in use, falling back to dynamic port');
    server.listen(0, '127.0.0.1', onListen);
    return;
  }
  console.error('[updater-host] server error: ' + e.message);
  process.exit(1);
});
function onListen() {
  const actual = server.address().port;
  log('listening on 127.0.0.1:' + actual + ' pid=' + process.pid + ' version=' + VERSION + (actual !== PORT ? ' (dynamic, requested ' + PORT + ')' : ''));
  // v3.2（动态端口 fallback）：写实际端口文件——executorEnsure 在固定端口 ping 失败时
  // 读此文件发现真实端口（动态端口场景必须有；固定端口场景也写，幂等无害）。
  try {
    const pf = sys.executorPortFile();
    fs.mkdirSync(path.dirname(pf), { recursive: true });
    fs.writeFileSync(pf, JSON.stringify({ port: actual, pid: process.pid, ts: Date.now() }), 'utf8');
  } catch { /* 尽力而为 */ }
  // This executor was started by a one-shot scheduled task. The task can be
  // removed now: deleting a Task Scheduler task does not stop an already
  // running instance, so the executor process remains alive and independent
  // of the dsh-web service tree.
  if (TASK_NAME) {
    try {
      const systemRoot = process.env.SystemRoot || process.env.windir || 'C:/Windows';
      spawnSync(path.join(systemRoot, 'System32', 'schtasks.exe'), ['/Delete', '/TN', TASK_NAME, '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch { /* ignore */ }
  }
  if (CMD_PATH) {
    try { fs.unlinkSync(CMD_PATH); } catch { /* ignore */ }
  }
  // v3.2.1：无服务化部署时启动降级守护（PM2 式 watchdog）——DSH 崩溃自动拉起
  watchdogStart();
}
// ================= CLI 模式（v3.2 · 桌面快捷方式 · 脱离 Web 重启）=================
// 用法：node updater-host.cjs --cli restart --service dsh-web [--profile web] [--executor-port 3081]
// 优先调用运行中的执行器（3081，SYSTEM 权限有权 sc 控制）重启；执行器未运行则本进程直接重启。
// CLI 不 listen 端口（避免与运行中的执行器冲突），进度打到 stdout（快捷方式 cmd 窗口展示）。
function httpPostJson(port, bodyObj) {
  return new Promise((resolve) => {
    let req;
    try {
      const data = JSON.stringify(bodyObj);
      req = http.request({
        host: '127.0.0.1', port, path: '/', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      }, (res) => {
        let b = '';
        res.on('data', (d) => { b += d; });
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(3000, () => { try { req.destroy(); } catch { /* ignore */ } });
      req.end(data);
    } catch { if (req) { try { req.destroy(); } catch { /* ignore */ } } resolve(null); }
  });
}

async function runCliRestart() {
  const svc = argValue('service') || 'dsh-web';
  const profile = argValue('profile') || 'web';
  const exPort = Number(argValue('executor-port')) || sys.EXECUTOR_PORT;
  console.log('');
  console.log('=== DSH 端口重启（CLI）===');
  console.log('  服务: ' + svc + '  执行器端口: ' + exPort);
  console.log('');
  // ① 探测运行中的执行器（SYSTEM 权限，有权 sc 控制服务）
  const ping = await httpPostJson(exPort, { method: 'ping' });
  if (ping && ping.ok === true) {
    console.log('检测到运行中的执行器 (SYSTEM pid=' + ping.pid + ')，调用其重启服务…');
    console.log('');
    const start = await httpPostJson(exPort, { method: 'restart', args: { serviceName: svc, profile } });
    if (!start || start.ok !== true) {
      console.log('❌ 无法启动重启: ' + ((start && (start.message || start.code)) || 'executor unreachable'));
      return;
    }
    // 轮询 status 打印进度（1s；最长 180s）
    const startedAt = Date.now();
    const MAX_MS = 180000;
    let lastLine = '';
    while (Date.now() - startedAt < MAX_MS) {
      await sleep(1000);
      const st = await httpPostJson(exPort, { method: 'status' });
      if (!st) { console.log('⚠ 执行器暂时不可达，继续等待…'); continue; }
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const line = '[' + elapsed + 's] ' + (st.phase || '?') + (st.attempt ? ' round ' + st.attempt : '') + ' — ' + (st.message || '');
      if (line !== lastLine) { console.log(line); lastLine = line; }
      if (st.phase === 'healthy') { console.log(''); console.log('✅ 服务已重启完成（healthy）'); return; }
      if (st.phase === 'failed') { console.log(''); console.log('❌ 重启失败: ' + (st.message || 'failed')); return; }
    }
    console.log('❌ 超时（' + Math.round(MAX_MS / 1000) + 's 内未完成）');
    return;
  }
  // ② 执行器未运行 → 本进程直接重启（可能需要管理员权限）
  console.log('执行器未运行——本进程直接重启服务（如提示无权限，请以管理员身份运行本快捷方式）…');
  console.log('');
  const result = await restartService(svc);
  if (result.ok === true) {
    console.log('✅ 重启成功: ' + result.message);
  } else {
    console.log('❌ 失败: ' + (result.code || '') + ' ' + (result.message || ''));
    if (/PERMISSION|拒绝访问|Access is denied|STOP_FAILED/i.test(result.message + ' ' + (result.code || ''))) {
      console.log('提示：请以管理员身份运行（右键快捷方式 → 以管理员身份运行）');
    }
  }
}

if (require.main === module) {
  if (argValue('cli') === 'restart') {
    runCliRestart().then(() => process.exit(0)).catch((e) => { console.error('CLI 异常: ' + (e && e.message || e)); process.exit(1); });
  } else {
    server.listen(PORT, '127.0.0.1', onListen);
  }
}

module.exports = {
  stopService,
  startService,
  stageTarball,
  verifyTarball,
  installLocal,
  rollbackToVersion,
  restartService,
  state,
  PORT,
  VERSION,
  STAGING_DIR,
  BACKUP_DIR,
  // v3.2.1：watchdog（降级守护）导出——单测用；运行时仅 watchdogStart 在 onListen 调用
  watchdog,
  watchdogShouldRun,
  watchdogStart,
  watchdogStop,
  watchdogTick,
  WATCH_INTERVAL_MS,
  WATCH_RESTART_DELAY_MS,
  WATCH_MIN_UPTIME_MS,
  WATCH_MAX_RESTARTS,
  WATCH_WINDOW_MS,
};
