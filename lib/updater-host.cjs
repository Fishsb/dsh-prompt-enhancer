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
const https = require('node:https');
const netProxy = require('./net-proxy.cjs');
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
// v3.2.1-s（用户需求·更新进度反馈）：curl 改为 **Node https 流式下载**——可实时回报
// 下载进度（received/total/percent，经 state.download 由 status 轮询读取），并保留
// 镜像 fallback 链；跟随重定向（GitHub releases → objects.githubusercontent.com）。
const TARBALL_MIRRORS = [
  (u) => 'https://ghproxy.net/' + u,
  (u) => 'https://gh-proxy.com/' + u,
  (u) => 'https://ghfast.top/' + u,
];

// Node 流式 HTTPS 下载：跟随重定向（≤5 次）、Content-Length 总字节、流式写盘、
// 每 ≥400ms 回报一次进度 {received,total,percent}；超时/错误 reject。
function httpDownload(url, dest, onProgress, timeoutMs) {
  return new Promise((resolve, reject) => {
    const limit = timeoutMs || sys.INSTALL_TIMEOUT_MS;
    let redirects = 0;
    const go = (u) => {
      let req;
      try {
        // v3.2.14（插件所有网络走系统代理）：统一共享隧道入口（CONNECT 隧道 / 直连）
        req = netProxy.httpsGetProxied(u, { 'user-agent': 'dsh-prompt-enhancer-updater', accept: '*/*' }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 5) { reject(new Error('too many redirects')); return; }
            redirects += 1;
            go(new URL(res.headers.location, u).toString());
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error('HTTP ' + res.statusCode));
            return;
          }
          const total = Number(res.headers['content-length']) || 0;
          let received = 0;
          let lastReport = Date.now();
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { req.destroy(); } catch { /* ignore */ }
            try { out.destroy(); } catch { /* ignore */ }
            reject(new Error('download timed out after ' + Math.round(limit / 1000) + 's'));
          }, limit);
          const out = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            received += chunk.length;
            const now = Date.now();
            if (now - lastReport >= 400) {
              lastReport = now;
              if (onProgress) onProgress({ received, total, percent: total > 0 ? Math.min(99, Math.round((received * 100) / total)) : 0 });
            }
          });
          res.on('error', (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { out.destroy(); } catch { /* ignore */ }
            reject(e);
          });
          res.pipe(out);
          out.on('error', (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { req.destroy(); } catch { /* ignore */ }
            reject(e);
          });
          out.on('finish', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (onProgress) onProgress({ received, total, percent: 100 });
            out.close(() => resolve({ ok: true, size: received }));
          });
        });
      } catch (e) {
        reject(e);
        return;
      }
      req.on('error', (e) => reject(e));
      req.setTimeout(limit, () => {
        try { req.destroy(new Error('download timed out')); } catch { /* ignore */ }
      });
    };
    go(url);
  });
}

// ---- v3.3.2（供应链加固·哈希强校验）----
// 镜像（ghproxy 类）只作下载通道、不作完整性信任锚：期望 sha256 一律取自可信通道——
// ① GitHub Releases API 资产 digest（GitHub 计算，api.github.com TLS，不经镜像）；
// ② 回退直连（不走镜像）下载 <tgz>.sha256 发布资产。两通道均不可得时按下载来源裁决：
// 直连（TLS→GitHub）放行，镜像拒绝（fail closed）。
function parseAssetDigest(releaseJson, fileName) {
  try {
    const assets = releaseJson && Array.isArray(releaseJson.assets) ? releaseJson.assets : [];
    for (const a of assets) {
      if (a && a.name === fileName && typeof a.digest === 'string') {
        const m = /^sha256:([0-9a-fA-F]{64})$/.exec(a.digest);
        if (m) return m[1].toLowerCase();
      }
    }
  } catch { /* 解析失败按无期望哈希处理 */ }
  return '';
}

function parseSha256Text(text) {
  const m = /([0-9a-fA-F]{64})/.exec(String(text || ''));
  return m ? m[1].toLowerCase() : '';
}

function hashGate(expected, actual, viaMirror) {
  if (expected) {
    return actual === expected
      ? { accept: true, verified: true }
      : { accept: false, code: 'STAGE_HASH_MISMATCH', message: 'tgz sha256 与 GitHub 发布值不一致（actual=' + actual.slice(0, 16) + '…/expected=' + expected.slice(0, 16) + '…），下载可能被篡改，已拒绝安装。请重试或手动下载 tgz 放入 ' + STAGING_DIR };
  }
  if (!viaMirror) return { accept: true, verified: false };
  return { accept: false, code: 'STAGE_HASH_UNVERIFIED', message: '镜像下载且无法取得可信期望哈希（GitHub API 与 .sha256 资产均不可达），拒绝安装。可稍后重试（直连优先）或手动下载 tgz 放入 ' + STAGING_DIR };
}

function httpsGetText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = netProxy.httpsGetProxied(url, { 'user-agent': 'dsh-prompt-enhancer-updater', accept: 'application/vnd.github+json' }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      // undici 封装响应无 setEncoding——按 Buffer 收集后统一转 utf8（同 httpDownload）
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
      res.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    req.setTimeout(timeoutMs || 15000, () => { try { req.destroy(new Error('timeout')); } catch { /* ignore */ } });
  });
}

function httpsGetJson(url, timeoutMs) {
  return httpsGetText(url, timeoutMs).then((t) => JSON.parse(t));
}

async function fetchExpectedSha256(repo, tag, fileName) {
  try {
    const j = await httpsGetJson('https://api.github.com/repos/' + repo + '/releases/tags/' + encodeURIComponent(tag), 15000);
    const d = parseAssetDigest(j, fileName);
    if (d) { log('expected sha256 source=api-digest'); return d; }
  } catch (e) { log('expected sha256 api failed: ' + String(e.message || e)); }
  try {
    const tmp = path.join(STAGING_DIR, fileName + '.expected');
    await httpDownload(pure.buildTarballUrl(sys.INSTALL_REPO, tag) + '.sha256', tmp, null, 30000);
    const txt = fs.readFileSync(tmp, 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    const d = parseSha256Text(txt);
    if (d) { log('expected sha256 source=.sha256-asset'); return d; }
  } catch (e) { log('expected sha256 asset failed: ' + String(e.message || e)); }
  return '';
}

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
          state.download = null;
          resolve({
            ok: false,
            code: 'STAGE_DOWNLOAD_FAILED',
            message: '直连与镜像均下载失败（网络被重置 curl 56）。请检查网络/代理后重试，或手动下载 tgz 放入 ' + STAGING_DIR,
          });
          return;
        }
        const u = urls[idx];
        idx += 1;
        log('stage download (' + idx + '/' + urls.length + ') ' + u);
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        state.download = { url: u, received: 0, total: 0, percent: 0, attempt: idx, attempts: urls.length };
        httpDownload(u, dest, (p) => {
          state.download = { url: u, received: p.received, total: p.total, percent: p.percent, attempt: idx, attempts: urls.length };
        }).then(async (r) => {
          if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
            log('stage download attempt ' + idx + ' empty, fallback next');
            state.download = null;
            attempt();
            return;
          }
          // v3.3.2（供应链加固）：下载成功即过哈希门禁——镜像下载无可信哈希 → 拒绝；
          // 校验通过 → 旁挂 .sha256（安装前复验用，见 lib/index.cjs installStagedTarball）
          const viaMirror = idx >= 2;
          const actual = (await sha256File(dest)).toLowerCase();
          let expected = '';
          try { expected = await fetchExpectedSha256(sys.INSTALL_REPO, tag, fileName); } catch (e) { log('expected sha256 fetch error: ' + String(e.message || e)); }
          const gate = hashGate(expected, actual, viaMirror);
          if (!gate.accept) {
            state.download = null;
            log('stage hash gate REJECT (' + gate.code + ') viaMirror=' + viaMirror);
            resolve({ ok: false, code: gate.code, message: gate.message });
            return;
          }
          if (gate.verified) {
            try { fs.writeFileSync(dest + '.sha256', expected + '\n', 'utf8'); } catch { /* 旁挂失败不阻断（安装侧缺失则跳过复验） */ }
          }
          state.download = null;
          resolve({ ok: true, path: dest, size: fs.statSync(dest).size, sha256: actual, hashVerified: gate.verified });
        }).catch((e) => {
          log('stage download attempt ' + idx + ' failed: ' + String(e.message || e));
          state.download = null;
          attempt();
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
function httpPostJson(port, bodyObj, rpcPath) {
  return new Promise((resolve) => {
    let req;
    try {
      const data = JSON.stringify(bodyObj);
      req = http.request({
        host: '127.0.0.1', port, path: rpcPath || '/', method: 'POST',
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

/**
 * 重启核心（批次二 A4 抽取）：优先调用运行中的执行器（SYSTEM 权限有权 sc 控制）；
 * 执行器未运行则本进程直接重启。**不带 tag = 纯重启不装 staging**（executor restart
 * 语义 v3.1.x：仅 tag 匹配时才在停服窗口内安装）——维护菜单1「保持当前版本」依赖此语义。
 * 返回 { ok, message, via }；onLine 进度回调供 CLI 打印。
 */
async function restartCore(svc, profile, onLine) {
  const say = onLine || (() => {});
  const exPort = Number(argValue('executor-port')) || sys.EXECUTOR_PORT;
  // ① 探测运行中的执行器（SYSTEM 权限，有权 sc 控制服务）
  const ping = await httpPostJson(exPort, { method: 'ping' });
  if (ping && ping.ok === true) {
    say('检测到运行中的执行器 (SYSTEM pid=' + ping.pid + ')，调用其重启服务…');
    const start = await httpPostJson(exPort, { method: 'restart', args: { serviceName: svc, profile } });
    if (!start || start.ok !== true) {
      return { ok: false, via: 'executor', message: ((start && (start.message || start.code)) || 'executor unreachable') };
    }
    // 轮询 status 打印进度（1s；最长 180s）
    const startedAt = Date.now();
    const MAX_MS = 180000;
    let lastLine = '';
    while (Date.now() - startedAt < MAX_MS) {
      await sleep(1000);
      const st = await httpPostJson(exPort, { method: 'status' });
      if (!st) { say('⚠ 执行器暂时不可达，继续等待…'); continue; }
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const line = '[' + elapsed + 's] ' + (st.phase || '?') + (st.attempt ? ' round ' + st.attempt : '') + ' — ' + (st.message || '');
      if (line !== lastLine) { say(line); lastLine = line; }
      if (st.phase === 'healthy') return { ok: true, via: 'executor', message: '服务已重启完成（healthy）' };
      if (st.phase === 'failed') return { ok: false, via: 'executor', message: (st.message || 'failed') };
    }
    return { ok: false, via: 'executor', message: '超时（' + Math.round(MAX_MS / 1000) + 's 内未完成）' };
  }
  // ② 执行器未运行 → 本进程直接重启（可能需要管理员权限）
  say('执行器未运行——本进程直接重启服务（如提示无权限，请以管理员身份运行）…');
  const result = await restartService(svc);
  if (result.ok === true) return { ok: true, via: 'local', message: result.message };
  return { ok: false, via: 'local', code: result.code, message: (result.code || '') + ' ' + (result.message || '') };
}

async function runCliRestart() {
  const svc = argValue('service') || 'dsh-web';
  const profile = argValue('profile') || 'web';
  console.log('');
  console.log('=== DSH 端口重启（CLI · 兼容入口，维护菜单见 --cli maintain）===');
  console.log('  服务: ' + svc);
  console.log('');
  const r = await restartCore(svc, profile, (line) => console.log(line));
  if (r.ok) {
    console.log(''); console.log('✅ 重启成功: ' + r.message);
  } else {
    console.log(''); console.log('❌ 失败: ' + (r.code ? r.code + ' ' : '') + r.message);
    if (/PERMISSION|拒绝访问|Access is denied|STOP_FAILED/i.test(r.message)) {
      console.log('提示：请以管理员身份运行（右键快捷方式 → 以管理员身份运行）');
    }
  }
}

// ============================================================================
// 维护菜单（批次二 A4 · G4 载体决策定案：常驻子命令形态）
// ============================================================================
// 用法：node updater-host.cjs --cli maintain [--service dsh-web] [--profile web]
//                          [--run 1|2|3]       （非交互：执行单项后退出——冒烟/演练用）
// 三功能全自动（v4.7 收敛·v4.9 全程计时提醒）：1=一键拉起（ensureWebUp 阶梯）；
// 2=端口修复（清占用者后拉起）；3=一键更新（staging 安装→闸门→重启生效→G11）。
// Desktop 无此菜单（客户端重启走其设置页 RPC 自实例语义，§5.1）。
const maintainLib = require('./maintain-lib.cjs');
const stageInstall = require('./stage-install.cjs');
const readline = require('node:readline');

/**
 * 当前「仍被组合」的第三方包名（bundles − patch 已禁用）——干跑 resolve 层 extraNames 用。
 * 必须在每次干跑调用点现算：已禁用条目不进组合，拿处置前的快照集去探必然假阴性
 * （2026-08-22 救援演练实锤：精准禁用后闸门恒红的根因）。
 */
function composedThirdParties(profileName) {
  const pp = maintainLib.profilePaths(null, profileName);
  const disabled = new Set(maintainLib.readPatchIds(pp.patchYml));
  return maintainLib.thirdPartyBundles(maintainLib.readProfilePackage(pp)).filter((n) => !disabled.has(n));
}

/** io 抽象：交互默认走 console/readline；测试/演练注入脚本化实现。 */
function defaultIo() {
  return {
    out: (s) => console.log(s === undefined ? '' : s),
    ask: (q) => new Promise((res) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(q, (a) => { rl.close(); res(String(a || '').trim()); });
    }),
    // v4.9 过程计时：等待期原地刷新倒计时（仅 TTY；非 TTY/注入 io 静默跳过）
    tick: (line) => { try { if (process.stdout && process.stdout.isTTY) process.stdout.write('\r\x1b[K' + String(line)); } catch { /* ignore */ } },
    clearTick: () => { try { if (process.stdout && process.stdout.isTTY) process.stdout.write('\r\x1b[K'); } catch { /* ignore */ } },
  };
}

/** v4.9 过程计时 io 包装：每行输出自动带总耗时戳 [+Xs]（自包装时刻起计）；ask/tick/clearTick 透传。 */
function createTimedIo(io) {
  const t0 = Date.now();
  const sec = () => Math.round((Date.now() - t0) / 1000);
  return {
    out: (s) => io.out('[' + sec() + 's] ' + (s === undefined ? '' : s)),
    ask: typeof io.ask === 'function' ? (q) => io.ask(q) : undefined,
    tick: (line) => { if (typeof io.tick === 'function') io.tick('[' + sec() + 's] ' + line); },
    clearTick: () => { if (typeof io.clearTick === 'function') io.clearTick(); },
    t0,
    sec,
  };
}

/** v4.9 命令级计时壳：整条命令共享一个时钟，任何一行都可见全局进度；结束打印总耗时。 */
async function runWithTiming(io, label, fn) {
  const tio = createTimedIo(io);
  tio.out('▶ 开始：' + label);
  let r;
  try { r = await fn(tio); }
  finally { tio.out('■ 结束：' + label + '（总耗时 ' + tio.sec() + 's）'); }
  return r;
}

function mIsAdmin() {
  try { return spawnSync('net', ['session'], { windowsHide: true, stdio: 'ignore' }).status === 0; }
  catch (e) { return false; }
}

/** sc 状态+配置解析：STATE 取自 `sc query`；START_TYPE 只在 `sc qc`（配置查询）里
 *  （实测 sc query 无此行，2026-08-22 MAINT-24 抓获）。不存在 → {exists:false}。 */
const SC_START_TYPE_NAMES = { 2: 'AUTO_START', 3: 'DEMAND_START', 4: 'DISABLED' };
function svcStateRaw(svc) {
  const r = sys.runProbe('sc', ['query', svc], env());
  const text = String(r.stdout || '') + String(r.stderr || '');
  if (!/STATE\s*:\s*\d+\s+\S+/.test(text) && /1060|does not exist|指定的服务/.test(text)) return { exists: false, state: 'MISSING' };
  const m = /STATE\s*:\s*\d+\s+(\S+)/.exec(text);
  if (!m) return { exists: false, state: 'MISSING' };
  const out = { exists: true, state: m[1].toUpperCase() };
  try {
    const qc = sys.runProbe('sc', ['qc', svc], env());
    const qtext = String(qc.stdout || '') + String(qc.stderr || '');
    const tm = /START_TYPE\s*:\s*(\d)\s*\S*/.exec(qtext);
    if (tm) out.startType = SC_START_TYPE_NAMES[Number(tm[1])] || ('TYPE_' + tm[1]);
  } catch { /* 配置查询失败不阻断（startType 缺省 undefined → 服务路径保守尝试） */ }
  return out;
}

async function webReadyOnce(port) {
  return portListening(Number(port) || 3080);
}

async function waitWebReady(io, timeoutMs, port, label) {
  const totalS = Math.round((timeoutMs || 60000) / 1000);
  const startAt = Date.now();
  const deadline = startAt + (timeoutMs || 60000);
  let ticked = false;
  const clear = () => { if (ticked && io && typeof io.clearTick === 'function') io.clearTick(); };
  try {
    while (Date.now() < deadline) {
      if (await webReadyOnce(port)) { clear(); return true; }
      if (label && io && typeof io.tick === 'function') {
        ticked = true;
        io.tick(label + '… ' + Math.round((Date.now() - startAt) / 1000) + 's/' + totalS + 's');
      }
      await sleep(1000);
    }
    clear();
    return false;
  } catch (e) { clear(); throw e; }
}

/**
 * G11 版本生效自检：重启成功后经插件 RPC update/restartNeeded 比对
 * 「磁盘关键文件 mtime vs 运行中进程 LOADED_AT」——needed=false 才证明新代码真的被加载。
 */
async function consistencyCheckAfterRestart(io, svc, webPort) {
  const g11Start = Date.now();
  const deadline = g11Start + 30000;
  let rpc = null;
  while (Date.now() < deadline && !rpc) {
    rpc = await httpPostJson(Number(webPort) || 3080, { method: 'update/restartNeeded', args: { serviceName: svc } }, '/dsh-prompt-enhancer/rpc');
    if (!rpc) {
      if (io && typeof io.tick === 'function') io.tick('版本自检等待插件 RPC ' + Math.round((Date.now() - g11Start) / 1000) + 's/30s');
      await sleep(2000);
    }
  }
  if (io && typeof io.clearTick === 'function') io.clearTick();
  if (!rpc) { io.out('⚠ 版本自检不可达（插件 RPC 未响应）——无法确认新代码已加载'); return; }
  if (rpc.needed === false) io.out('✓ 版本自检通过：运行中代码与磁盘一致（restartNeeded=false）');
  else {
    io.out('\x1b[33m⚠ 版本自检警告：磁盘文件比运行中进程新（可能仍在跑旧代码）\x1b[0m');
    io.out('  新近文件: ' + (Array.isArray(rpc.files) ? rpc.files.join(', ') : '?'));
  }
}

/** 探测头（方案 §5.1）：服务态 · 3080 监听者+镜像 · staging · 管理员。 */
function printMaintainHeader(io, svc, profile) {
  const det = platformService.backendFor(process.platform);
  const svcInfo = svcStateRaw(svc);
  const holderPid = sys.portHolderPid(3080);
  const image = holderPid ? sys.pidImageName(holderPid) : '';
  const staged = stageInstall.findStagedTarball();
  const admin = mIsAdmin();
  io.out('=== DSH Web 维护 ===');
  io.out('探测：服务 ' + svc + ' [' + (svcInfo.exists ? svcInfo.state : '不存在') + ']'
    + ' · 3080 监听者 [' + (holderPid ? holderPid + (image ? ' ' + image : '') : '无') + ']'
    + ' · staging [' + (staged ? path.basename(staged) : '无') + ']'
    + ' · 管理员 [' + (admin ? '是' : '否') + ']');
  io.out('profile: ' + profile + ' · 当前已装版本: v' + (sys.readInstalledPluginVersion(profile) || '?'));
  io.out('');
  return { svcInfo, holderPid, image, staged, admin, backend: det };
}

/* ---- 冷启动解析链（G2）：nssm 参数 > 进程索引(kind=web) > 放弃给指引 ---- */
function resolveColdStartCommand(profile) {
  // ① nssm 注册表参数（服务化机器的第一手真相）
  if (process.platform === 'win32') {
    try {
      const q = spawnSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\dsh-web\\Parameters'], {
        encoding: 'utf8', windowsHide: true, timeout: 5000,
      });
      const text = String(q.stdout || '');
      const appM = /Application\s+REG_(?:EXPAND_)?SZ\s+(\S+)/.exec(text);
      const argM = /AppParameters\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(text);
      const dirM = /AppDirectory\s+REG_(?:EXPAND_)?SZ\s+(\S+)/.exec(text);
      if (appM && fs.existsSync(maintainLib.expandEnvVars(appM[1]))) {
        const rawArgs = maintainLib.expandEnvVars(argM ? argM[1].trim() : '');
        const tokens = rawArgs.match(/"[^"]*"|\S+/g) || [];
        return { execPath: maintainLib.expandEnvVars(appM[1]), argv: tokens.map((t) => t.replace(/^"|"$/g, '')), cwd: dirM ? maintainLib.expandEnvVars(dirM[1]) : process.env.USERPROFILE || 'C:\\' };
      }
    } catch { /* fallthrough */ }
  }
  // ② 进程索引（kind 校验：web 实例写的才可信）
  const idx = readProcessIndex();
  if (idx && idx.execPath && fs.existsSync(idx.execPath) && Array.isArray(idx.argv) && idx.argv.length && idx.kind !== 'desktop') {
    return { execPath: idx.execPath, argv: idx.argv.slice(), cwd: idx.cwd || process.env.USERPROFILE || 'C:\\' };
  }
  void profile;
  return null;
}

function spawnForegroundDsh(cmd) {
  const outLog = path.join(sys.EXECUTOR_ROOT, 'port-restart.out.log');
  const errLog = path.join(sys.EXECUTOR_ROOT, 'port-restart.err.log');
  let o = -1; let e = -1;
  try { o = fs.openSync(outLog, 'a'); e = fs.openSync(errLog, 'a'); } catch { /* 忽略 */ }
  try {
    const child = spawn(cmd.execPath, cmd.argv, {
      cwd: cmd.cwd, detached: true,
      stdio: ['ignore', o >= 0 ? o : 'ignore', e >= 0 ? e : 'ignore'],
      windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' },
    });
    child.unref();
    return { ok: true, pid: child.pid || 0 };
  } catch (ex) {
    return { ok: false, message: String(ex && ex.message || ex) };
  }
}

// ============================================================================
// 救援模式（方案 §5.3 五步流程 · v4.2 修订版全接线）
// ============================================================================
const RESCUE_LOCK_NAME = 'rescue.lock';
const RESCUE_LOCK_MAX_AGE_MS = 10 * 60 * 1000;

function rescueLockPath() {
  return path.join(sys.EXECUTOR_ROOT, RESCUE_LOCK_NAME);
}

/* ---- 通用 PID 锁（rescue/up 共用单一实现，杜绝双实现漂移）----
 * 规则：锁存在且 fresh 且（pid 活着 或 是本进程）→ 拒绝；损坏/死 pid/超龄 → 接管。
 * 同进程重入同样视为占用（ensureWebUp/runRescue 均非可重入）。 */
function acquirePidLock(lockPath, opts) {
  const o = opts || {};
  const staleMs = o.staleMs || 10 * 60 * 1000;
  try {
    if (fs.existsSync(lockPath)) {
      let info = null;
      try { info = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* 损坏锁按陈旧处理 */ }
      let alive = false;
      if (info && Number.isInteger(info.pid)) {
        if (info.pid === process.pid) alive = true;
        else {
          try { process.kill(info.pid, 0); alive = true; } catch (e) { alive = e && e.code === 'EPERM'; }
        }
      }
      const fresh = info && Number.isInteger(info.ts) && (Date.now() - info.ts < staleMs);
      if (alive && fresh) {
        return { ok: false, message: (o.busyMsg || '另一实例正在执行') + '（pid=' + info.pid + '）——请等它结束。' };
      }
    }
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: '锁创建失败: ' + String(e && e.message || e) };
  }
}
function releasePidLock(lockPath) {
  try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch { /* 尽力而为 */ }
}

/** Step-1 前置整备①：救援互斥锁（G17） */
function acquireRescueLock() {
  return acquirePidLock(rescueLockPath(), {
    staleMs: RESCUE_LOCK_MAX_AGE_MS,
    busyMsg: '另一救援实例运行中，防并发改配置而中止',
  });
}

function releaseRescueLock() {
  releasePidLock(rescueLockPath());
}

/** Step-1 前置整备②：僵尸服务强制停止（G15：RUNNING-but-port-dead / START_PENDING 循环）。 */
async function forceStopZombieService(io, svc, state) {
  const backend = platformService.backendFor(process.platform);
  if (!backend) return;
  io.out('⚠ 服务态异常（' + state + ' 但 3080 无监听）——强制停止僵尸服务…');
  backend.stopService(svc, env());
  for (let i = 0; i < 15; i++) {
    const st = svcStateRaw(svc);
    if (!st.exists || st.state === 'STOPPED') { io.out('✓ 服务已停止'); return; }
    await sleep(1000);
  }
  const pid = backend.pid(svc, env());
  if (pid) { io.out('15s 未停净，taskkill /T 强制（pid=' + pid + '）'); sys.taskKill(pid, true); }
}

/**
 * Step3 验证拉起：服务存在 → sc start；否则前台 spawn（nssm 参数 > kind=web 索引）。
 * 假阳性论证（方案 §5.3）：外部插件严格加载下一坏全崩 ⇒ 能监听 3080 = 全部插件加载成功。
 */
async function rescueBringUp(io, svc) {
  const st = svcStateRaw(svc);
  const backend = platformService.backendFor(process.platform);
  if (st.exists && backend) {
    const sr = backend.startService(svc, env());
    if (sr && sr.ok === false) io.out('⚠ sc start 失败: ' + (sr.message || '') + '（转前台拉起兜底）');
  }
  if (await waitWebReady(io, 30000)) return { ok: true, via: 'service-or-running' };
  io.out('服务路径未就绪，尝试前台拉起…');
  const cmd = resolveColdStartCommand();
  if (!cmd) return { ok: false, via: 'none', message: '无法定位启动命令' };
  const sp = spawnForegroundDsh(cmd);
  if (!sp.ok) return { ok: false, via: 'spawn', message: sp.message };
  const up = await waitWebReady(io, 60000);
  return up ? { ok: true, via: 'foreground', pid: sp.pid } : { ok: false, via: 'foreground', message: '90s 内未监听 3080（sc start 30s + 前台 60s）' };
}

/** 浏览器打开 Web（一键拉起的日常 UX 收尾；失败静默——起端口是主目标）。 */
function openBrowser(port) {
  try {
    spawn('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:' + port], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 尽力而为 */ }
}

/* ---- 一键拉起（v4.6 状态机 · 方案 §十三）：up.lock 并发闸 → 健康即报 →
   恢复阶梯 P0–P3（卸载仅兜底）→ 前台冷启 #5。全程 await 串行，零并行分支。---- */

const UP_LOCK_STALE_MS = 10 * 60 * 1000;
function upLockPath() { return path.join(sys.EXECUTOR_ROOT, 'cli', 'up.lock'); }
/** up 动词互斥锁（R3：双击两次=双前台实例抢 3080+索引双写）。 */
function acquireUpLock(lockPathOverride) {
  return acquirePidLock(lockPathOverride || upLockPath(), {
    staleMs: UP_LOCK_STALE_MS,
    busyMsg: '另一个「一键拉起」正在执行',
  });
}
function releaseUpLock(lockPathOverride) {
  releasePidLock(lockPathOverride || upLockPath());
}

/** P0 配置体检：nssm Parameters 注册表在但 Application 二进制缺失 = 配置性死亡（跳级证据）。 */
function nssmConfigState(svc) {
  if (process.platform !== 'win32') return null;
  try {
    const q = spawnSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + svc + '\\Parameters'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    const text = String(q.stdout || '');
    const appM = /Application\s+REG_(?:EXPAND_)?SZ\s+(\S+)/.exec(text);
    if (!appM) return { present: false };
    const app = maintainLib.expandEnvVars(appM[1]);
    return { present: true, alive: fs.existsSync(app), app };
  } catch { return null; }
}

/** v3.3.1-u1 卸载服务确认门：seam.confirmImpl（测试缝）> DSH_MAINT_ALLOW_UNINSTALL=1（自动化显式放行）
 *  > 非交互（stdin 非 TTY）默认拒绝 > 交互控制台 y/N 定时提问（30s 无响应=保留）。 */
function confirmNssmUninstall(io, svc, reason, seam) {
  const s2 = seam || {};
  if (s2.confirmImpl) return Promise.resolve(s2.confirmImpl(svc, reason)).then(Boolean);
  if (String(process.env.DSH_MAINT_ALLOW_UNINSTALL || '') === '1') {
    io.out('· DSH_MAINT_ALLOW_UNINSTALL=1 —— 自动确认卸载');
    return Promise.resolve(true);
  }
  const tty = s2.isTtyImpl ? !!s2.isTtyImpl() : !!(process.stdin && process.stdin.isTTY);
  if (!tty) {
    io.out('⚠ 非交互环境——默认保留服务、跳过卸载（自动化场景请设 DSH_MAINT_ALLOW_UNINSTALL=1 显式放行）');
    return Promise.resolve(false);
  }
  io.out('  即将执行唯一破坏性动作：sc stop + sc delete 卸载服务 "' + svc + '"（判定依据：' + reason + '）');
  io.out('  可逆性说明：设置页「服务化安装」随时可重装；本次及历史处置均留痕 web-port-recovery.log');
  return askYesNoTimed(io, '确认卸载该服务？输入 y 确认；回车/其他/超时 = 保留：', 30000, '（30s 未响应——默认保留服务）');
}

/** v4.10 通用定时 y/N 提问（TTY readline；超时/回车/其他 = 否）。 */
function askYesNoTimed(io, question, timeoutMs, onTimeoutMsg) {
  return new Promise((resolve) => {
    let settled = false;
    let rl = null;
    let timer = null;
    const done = (v) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { if (rl) rl.close(); } catch { /* ignore */ }
      resolve(v);
    };
    timer = setTimeout(() => { if (onTimeoutMsg) io.out(onTimeoutMsg); done(false); }, timeoutMs || 30000);
    try {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (a) => {
        clearTimeout(timer);
        done(/^\s*(?:y|yes)\s*$/i.test(String(a || '')));
      });
    } catch { done(false); }
  });
}

/** v4.10 运行中重启确认门（[1] 新语义）：端口已在监听时询问是否原地重启。
 *  seam.restartConfirmImpl（单测缝）> stdin 非 TTY 默认保持现状 > TTY y/N 定时提问
 *  （30s 无响应 = 保持现状并打开网页）。 */
function confirmRestartRunning(io, seam) {
  const s2 = seam || {};
  if (s2.restartConfirmImpl) return Promise.resolve(s2.restartConfirmImpl()).then(Boolean);
  const tty = s2.isTtyImpl ? !!s2.isTtyImpl() : !!(process.stdin && process.stdin.isTTY);
  if (!tty) return Promise.resolve(false);
  return askYesNoTimed(io,
    '端口已在运行——是否原地重启？输入 y 重启；回车/其他/超时 = 保持现状：',
    30000,
    '（30s 未响应——保持现状）');
}
/** P5 兜底降级（唯一破坏性动作）：stop 尽力 → sc delete → 轮询确认（MARK_DELETE 排队可接受）
 *  → 留痕 web-port-recovery.log。调用方必须已满足三重门：管理员+异常证据+阶梯穷尽/配置性死亡。
 *  v3.3.1-u1：执行前增加用户确认门（confirmNssmUninstall）——拒绝/超时/非交互均保留服务并留痕。 */
async function degradeNssmService(io, svc, reason, seam) {
  const s = seam || {};
  io.out('\x1b[33m⚠ 服务恢复阶梯穷尽（' + reason + '）——降级：卸载 nssm 服务，回归默认前台拉起\x1b[0m');
  const proceed = await confirmNssmUninstall(io, svc, reason, s);
  if (!proceed) {
    try {
      fs.appendFileSync(path.join(sys.EXECUTOR_ROOT, 'web-port-recovery.log'),
        '[' + new Date().toISOString() + '] uninstall declined by user reason=' + reason + '\n', 'utf8');
    } catch { /* 留痕尽力 */ }
    io.out('✗ 已保留 nssm 服务（未卸载）——继续前台冷启兜底；服务可稍后经设置页「服务化安装」重装或手动处置');
    return { ok: false, declined: true };
  }
  try {
    if (s.deleteImpl) { await s.deleteImpl(svc); }
    else if (process.platform === 'win32') {
      try { sys.runProbe('sc', ['stop', svc], env()); } catch { /* 已停则忽略 */ }
      sys.runProbe('sc', ['delete', svc], env());
      for (let i = 0; i < 5; i++) { // 轮询确认 ≤5s：消失(1060/MISSING)即收；MARK_DELETE 排队也放行
        const st = svcStateRaw(svc);
        if (!st.exists) break;
        if (io && typeof io.tick === 'function') io.tick('确认服务已删除 ' + (i + 1) + 's/5s');
        await sleep(1000);
      }
      if (io && typeof io.clearTick === 'function') io.clearTick();
    }
    const logLine = '[' + new Date().toISOString() + '] degraded nssm service "' + svc + '" reason=' + reason + '\n';
    try { fs.appendFileSync(path.join(sys.EXECUTOR_ROOT, 'web-port-recovery.log'), logLine, 'utf8'); } catch { /* 留痕尽力 */ }
    io.out('✓ 服务已卸载（可用设置页「服务化安装」随时重装）；已留痕 web-port-recovery.log');
    return { ok: true };
  } catch (e) {
    io.out('⚠ 卸载失败（不阻断——继续前台冷启）: ' + String(e && e.message || e));
    return { ok: false };
  }
}

/** nssmConfigState/degradeNssmService 的测试缝随 opts 传入 ensureWebUp：
 *  cfgStateImpl/deleteImpl/graceProbeImpl/resolveCmdImpl/cycleStopImpl 等。 */

/**
 * 一键拉起 Web（任何状态 · 桌面「DSH Web 启动」快捷方式后端 / 菜单 6 · v4.6 状态机）。
 * 决策表见方案 §13.1；恢复阶梯 P0–P3 见 §13.6（卸载仅兜底）；竞态缓解 R1–R10。
 * 安全 stance：异族占用绝不自动击杀（菜单 3 经人工确认的职责）。opts 注入缝供单测隔离。
 */
async function ensureWebUp(io, svc, profile, opts) {
  const o = opts || {};
  const webPort = Number(o.webPort) || 3080;
  // ⓪ 并发闸（R3）：持锁期间第二实例直接退出
  if (!o.noLock) {
    const lk = acquireUpLock(o.lockPathOverride);
    if (!lk.ok) { io.out('✗ ' + lk.message); return { ok: false, code: 'LOCK_BUSY' }; }
  }
  try {
    // ① 健康即报：有监听者即视为可用（假阳性论证 §5.3）
    const holderPid = o.holderPidOverride !== undefined ? o.holderPidOverride : sys.portHolderPid(webPort);
    if (holderPid) {
      const image = o.imageOverride !== undefined ? o.imageOverride : (sys.pidImageName(holderPid) || '');
      if (!maintainLib.isDshFamilyImage(image)) {
        io.out('\x1b[31m✗ ' + webPort + ' 已被非 DSH 家族进程占用（pid=' + holderPid + ' ' + image + '）\x1b[0m');
        io.out('  一键拉起不自动击杀异族进程——请打开「DSH Web 维护」→ 3 端口修复，人工确认后处理。');
        return { ok: false, code: 'FOREIGN_HOLDER', pid: holderPid, image };
      }
      io.out('✓ Web 已在监听 ' + webPort + '（pid=' + holderPid + (image ? ' ' + image : '') + '）');
      // v4.10（用户需求）：运行中不再直接返回——询问是否原地重启；否则视为「确保在线」完成
      const wantRestart = await confirmRestartRunning(io, o);
      if (!wantRestart) {
        io.out('已保持现状（未重启）。如需重启可再次运行 [1] 并答 y。');
        if (o.open) { if (o.openImpl) o.openImpl(webPort); else openBrowser(webPort); }
        return { ok: true, code: 'ALREADY_UP', pid: holderPid };
      }
      io.out('已确认——原地重启中（优先 SYSTEM 执行器，自动选择服务/本地路径）…');
      const rc = await (o.restartCoreImpl ? o.restartCoreImpl(io) : restartCore(svc, profile, (line) => io.out(line)));
      if (!rc || rc.ok !== true) {
        io.out('\x1b[31m✗ 原地重启失败: ' + ((rc && rc.message) || '未知') + '——可改用 [2] 端口修复\x1b[0m');
        return { ok: false, code: 'RESTART_FAILED', detail: rc && rc.message };
      }
      io.out('✅ 原地重启完成: ' + rc.message);
      if (o.open) { if (o.openImpl) o.openImpl(webPort); else openBrowser(webPort); }
      return { ok: true, code: 'RESTARTED', pid: holderPid };
    }

    // R8 顺序约束：任何服务动作之前先解析并缓存冷启命令
    const cmd = o.coldStartCmd !== undefined ? o.coldStartCmd
      : (o.resolveCmdImpl ? await o.resolveCmdImpl(profile) : resolveColdStartCommand(profile));

    /** #5 前台冷启兜底（config-dead 跳级与主链共用）。先于一切分支定义（防 TDZ）。 */
    const startForeground = async (cmd2) => {
      if (!cmd2) {
        io.out('✗ 无法定位启动命令（无服务参数、无 web 进程索引）——请先正常启动过一次 DSH Web');
        return { ok: false, code: 'NO_COLD_START' };
      }
      io.out('前台冷启: ' + [cmd2.execPath].concat(cmd2.argv || []).join(' '));
      const sp = o.spawnImpl ? o.spawnImpl(cmd2) : spawnForegroundDsh(cmd2);
      if (!sp || sp.ok === false) {
        io.out('✗ 前台拉起失败: ' + ((sp && sp.message) || '未知'));
        return { ok: false, code: 'SPAWN_FAILED' };
      }
      const upOk = o.waitFgImpl ? await o.waitFgImpl() : await waitWebReady(io, 45000, webPort, '前台冷启等待监听');
      if (upOk) {
        io.out('✅ Web 已前台拉起并监听 ' + webPort + (sp.pid ? '（pid=' + sp.pid + '）' : '') + '；日志见 EXECUTOR_ROOT/port-restart.*.log');
        if (o.open) { if (o.openImpl) o.openImpl(webPort); else openBrowser(webPort); }
        return { ok: true, code: 'FOREGROUND_STARTED', pid: sp.pid };
      }
      io.out('\x1b[31m✗ 45s 内未监听 ' + webPort + '——查日志: ' + path.join(sys.EXECUTOR_ROOT, 'port-restart.err.log') + '\x1b[0m');
      return { ok: false, code: 'START_TIMEOUT' };
    };

    let st = o.svcInfoOverride || svcStateRaw(svc);
    const admin = o.isAdminOverride !== undefined ? o.isAdminOverride : mIsAdmin();
    const backend = platformService.backendFor(process.platform);
    const trace = [];

    // P0 配置体检（§13.6）：Parameters 在但 Application 二进制缺失 = 配置性死亡
    // → 恢复周期无意义，取证跳级直奔降级（仍受管理员门；非管理员走前台+提示）
    const cfg = o.cfgStateImpl ? o.cfgStateImpl() : nssmConfigState(svc);
    if (admin && st.exists && cfg && cfg.present === true && cfg.alive === false) {
      io.out('P0 配置体检：nssm Application 二进制缺失（' + cfg.app + '）——配置性死亡，跳过恢复阶梯');
      await degradeNssmService(io, svc, 'config-dead:binary-missing', o);
      return await startForeground(cmd); // 直奔 #5 前台冷启
    }

    /** 恢复阶梯 P1–P3（§13.6）。返回 true=服务路径救活。每阶段打进度行+留痕轨迹。 */
    const runRecoveryLadder = async () => {
      const startOnce = async () => {
        trace.push('start');
        if (o.startServiceImpl) await o.startServiceImpl(svc);
        else if (backend) backend.startService(svc, env());
      };
      const waitReady = (queueKey, ms, label) => (
        o[queueKey] ? o[queueKey]() : waitWebReady(io, ms, webPort, label)
      );
      // P1 软重启 ≤20s
      io.out('P1 软重启服务…');
      trace.push('P1.stop');
      if (o.cycleStopImpl) await o.cycleStopImpl(svc);
      else if (backend) backend.stopService(svc, env());
      for (let i = 0; i < 5; i++) { // ≤5s 等 STOPPED；不停净转 P2 强制
        st = o.svcInfoOverride || svcStateRaw(svc);
        if (!st.exists || st.state === 'STOPPED') break;
        if (io && typeof io.tick === 'function') io.tick('P1 等待服务停止 ' + (i + 1) + 's/5s');
        await sleep(1000);
      }
      if (io && typeof io.clearTick === 'function') io.clearTick();
      await startOnce();
      if (await waitReady('waitServiceImpl', 15000, 'P1 等待服务拉起')) return true;
      // P2 借力监督者 ≤23s：强停树 → nssm AppExit=Restart 自动拉起 → 只管等
      io.out('P2 强停僵尸树，借力 nssm 自动重启…');
      trace.push('P2.forceStop');
      if (o.forceStopImpl) await o.forceStopImpl(io, svc, st.state);
      else await forceStopZombieService(io, svc, st.state);
      if (await waitReady('waitServiceImpl2', 15000, 'P2 等待 nssm 自动拉起')) return true;
      // P3 末次一发 ≤28s
      io.out('P3 末次重启尝试…');
      st = o.svcInfoOverride || svcStateRaw(svc);
      if (st.exists && st.state === 'RUNNING') {
        trace.push('P3.stop');
        if (o.cycleStopImpl) await o.cycleStopImpl(svc);
        else if (backend) backend.stopService(svc, env());
        await sleep(1000);
      }
      await startOnce();
      if (await waitReady('waitServiceImpl3', 15000, 'P3 等待服务拉起')) return true;
      return false;
    };

    // ② 僵尸（RUNNING 无监听）
    if (st.exists && st.state === 'RUNNING') {
      if (!admin) {
        io.out('⚠ 服务 RUNNING 但端口无监听（僵尸态）且非管理员——跳过服务处置，直接前台冷启');
      } else {
        // R1 防误删：degrade 只发生在阶梯穷尽之后
        const healed = await runRecoveryLadder();
        if (healed) {
          io.out('✅ 服务路径恢复监听 ' + webPort);
          if (o.open) { if (o.openImpl) o.openImpl(webPort); else openBrowser(webPort); }
          return { ok: true, code: 'SERVICE_STARTED', recovered: true };
        }
        await degradeNssmService(io, svc, 'zombie-unrecoverable:' + trace.join('>'), o);
      }
    } else if (st.exists && st.state === 'STOPPED') {
      // ③ DISABLED：机器显式配置，永不卸载、不浪费 sc start
      if (st.startType === 'DISABLED') {
        io.out('服务存在但为 DISABLED——直接前台冷启（不浪费时间在必败的 sc start 上）');
      } else if (backend || o.startServiceImpl) {
        // ④ 正常停止态：sc start → 等15s → 宽限3s 二次探测（R1 防误杀慢启）
        io.out('尝试服务启动（' + svc + ' [' + (st.startType || '?') + ']）…');
        await (o.startServiceImpl ? o.startServiceImpl(svc) : Promise.resolve(backend && backend.startService(svc, env())));
        let ready = o.waitServiceImpl ? await o.waitServiceImpl() : await waitWebReady(io, 15000, webPort, '等待服务启动');
        if (!ready) {
          io.out('宽限二次探测（3s 后再探一次）…');
          ready = o.graceProbeImpl ? await o.graceProbeImpl() : await (async () => {
            for (let i = 3; i >= 1; i--) {
              if (io && typeof io.tick === 'function') io.tick('宽限等待 ' + i + 's…');
              await sleep(1000);
            }
            if (io && typeof io.clearTick === 'function') io.clearTick();
            return webReadyOnce(webPort);
          })();
        }
        if (ready) {
          io.out('✅ 服务已拉起并监听 ' + webPort);
          if (o.open) { if (o.openImpl) o.openImpl(webPort); else openBrowser(webPort); }
          return { ok: true, code: 'SERVICE_STARTED' };
        }
        // ④' 启动失败分类：权限类绝不卸载；破坏类/超时且管理员 → degrade
        const permLike = o.permLike === true; // 测试缝显式声明权限类失败
        if (admin && !permLike) {
          await degradeNssmService(io, svc, 'start-no-listen-after-grace', o);
        } else {
          io.out(permLike
            ? '⚠ 启动被拒（权限类）——不动服务配置，直接前台冷启'
            : '⚠ 非管理员无法卸载异常服务——直接前台冷启（以管理员运行可获得完整自愈）');
        }
      }
    }

    // ⑤ 前台冷启兜底（命令已在 R8 处提前缓存；config-dead 跳级与主链共用同一实现）
    return await startForeground(cmd);
  } finally {
    if (!o.noLock) releaseUpLock(o.lockPathOverride);
  }
}

/** 快照候选预检（G16b）：快照的配置文本不含嫌疑名才算干净候选。 */
function snapshotCleanCandidates(root, suspectNames, limit) {
  const out = [];
  try {
    if (!fs.existsSync(root)) return out;
    const dirs = fs.readdirSync(root)
      .filter((d) => /^\d{8}-\d{6}(-\d+)?$/.test(d))
      .sort().reverse().slice(0, limit || 10);
    for (const d of dirs) {
      const dir = path.join(root, d);
      let text = '';
      for (const f of ['profile-package.json', 'profile-cordis.patch.yml', 'home-cordis.patch.yml']) {
        try { text += '\n' + fs.readFileSync(path.join(dir, f), 'utf8'); } catch { /* 缺文件不算脏 */ }
      }
      const dirty = (suspectNames || []).some((s) => s && text.includes(s));
      let reason = '';
      try { reason = String(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).reason || ''); } catch { /* ignore */ }
      out.push({ dir, dirty, reason });
    }
  } catch { /* ignore */ }
  return out;
}

/**
 * 救援主流程（io 注入可测）。返回摘要对象供演练断言：
 * { diagnosis, action, gateOk, broughtUp, reportPath|null }
 * opts 演练缝：{ logPathsOverride?: string[], bringUpImpl?: async(io,svc)=>{ok,...} }——
 * 隔离演练用（绝不触碰真实服务/真实 nssm 日志）；生产缺省走真实路径。
 */
async function runRescue(io, svc, profile, opts) {
  const o = opts || {};
  const summary = { diagnosis: null, action: null, gateOk: null, broughtUp: null, reportPath: null };
  const pp = maintainLib.profilePaths(null, profile);
  io.out('── Step-1 前置整备 ──');
  const lock = acquireRescueLock(); // G17
  if (!lock.ok) { io.out('✗ ' + lock.message); summary.action = { mode: 'aborted-lock' }; return summary; }
  try {
    if (!mIsAdmin()) io.out('⚠ 非管理员：诊断/禁用可用；涉及服务的停止/拉起会失败（失败时转前台拉起兜底）。');
    const st = svcStateRaw(svc);
    const holderNow = sys.portHolderPid(3080);
    if (st.exists && ((st.state === 'RUNNING' && !holderNow) || st.state.startsWith('START_PENDING'))) {
      await forceStopZombieService(io, svc, st.state); // G15
    }

    io.out('── Step0 只读诊断 ──');
    const pkg = maintainLib.readProfilePackage(pp);
    const third = maintainLib.thirdPartyBundles(pkg);
    const disabledAlready = maintainLib.readPatchIds(pp.patchYml);
    io.out('第三方 bundles（处置候选，基座 @deepseek-ai/* 永不禁）: '
      + (third.length ? third.join(', ') : '（无）')
      + (disabledAlready.length ? '；patch 已禁用: ' + disabledAlready.join(', ') : ''));
    const logPaths = Array.isArray(o.logPathsOverride) ? o.logPathsOverride : maintainLib.serviceLogPaths(svc); // G7① 不写死（演练可注入隔离源）
    let logText = '';
    if (logPaths.length) {
      for (const lp of logPaths) {
        const tail = maintainLib.tailLines(lp, 200);
        if (tail) { logText += '\n' + tail; io.out('日志: ' + lp + '（尾部 200 行已抓取）'); }
      }
    } else {
      io.out('未发现 nssm 日志注册表项（服务未装或参数缺失）——指认退化为人选。');
    }
    const culprits = maintainLib.scanCulprits(logText);
    let suspects = [];
    for (const mod of culprits.modules) suspects.push(...maintainLib.mapCulpritToBundles(mod, pp, pkg)); // G12 指认名≠禁用名
    suspects = [...new Set(suspects)].filter((s) => !disabledAlready.includes(s));
    if (culprits.syntaxErrors.length) io.out('语法错误证据: ' + culprits.syntaxErrors[0]);
    if (culprits.duplicate) io.out('检测到重复注册症状（B1/B2 类冲突特征）');
    io.out('指认嫌疑宿主包: ' + (suspects.length ? suspects.join(', ') : '（日志映射不上——退化为人选/快照回退/二分）'));
    summary.diagnosis = { culprits, suspects, thirdParties: third, logPaths };

    io.out('── Step1 无条件快照 ──');
    const snap = sys.rescueSnapshot({ profileName: profile, reason: 'rescue manual' });
    if (!snap.ok) { io.out('✗ 快照失败（纪律：无快照不处置）——中止: ' + snap.message); summary.action = { mode: 'aborted-snapshot' }; return summary; }
    io.out('✓ 快照 → ' + snap.dir);
    try { fs.writeFileSync(path.join(snap.dir, 'dump-config.txt'), maintainLib.dumpCompose({ profile }).output, 'utf8'); } catch { /* 留档尽力而为 */ }
    summary.snapshotDir = snap.dir;

    // Step2 三档处置循环（不过干跑闸门就换档重来；轮次上限防交互输入耗尽空转）
    let done = false;
    let step2Rounds = 0;
    let disabledSet = [...new Set([...suspects])];
    while (!done) {
      if (++step2Rounds > 8) {
        io.out('\x1b[31m✗ 处置轮次超限（8）——中止救援（快照与诊断已留底，可重进换档）\x1b[0m');
        summary.action = { mode: 'aborted-rounds', disabled: disabledSet };
        summary.broughtUp = { ok: false, via: 'aborted-rounds' };
        writeRescueReport(snap.dir, summary, profile);
        summary.reportPath = path.join(snap.dir, 'rescue-report.json');
        return summary;
      }
      io.out('── Step2 三档处置 ──');
      io.out('  a) 精准禁用' + (suspects.length ? '（指认: ' + suspects.join(', ') + '）' : '（无指认，可手选）'));
      io.out('  b) 快照回退（整份恢复到历史干净态）');
      io.out('  c) 二分定位（自动逐半禁用第三方，秒级干跑判定）');
      io.out('  s) 跳过处置（仅诊断+快照，直接验证拉起）');
      const mode = (await io.ask('选择处置档位 (a/b/c/s)：')).toLowerCase();

      if (mode === 'a') {
        let targets = suspects;
        if (!targets.length) {
          const pick = await io.ask('输入要禁用的 bundle 名（多个逗号分隔，空=放弃）：');
          targets = pick.split(',').map((s) => s.trim()).filter(Boolean);
          if (!targets.length) { io.out('未选择。'); continue; }
        }
        for (const t of targets) {
          maintainLib.appendDisableEntry(pp.patchYml, t);           // 静态 disabled:true（防 !!js 恒 truthy 陷阱）
          maintainLib.removeBundle(pp.packageJson, t);              // bundles 移除宿主包（Step2a 双保险）
          io.out('已禁用: ' + t + '（patch disabled + bundles 移除；依赖声明保留——只禁用不删除）');
        }
        disabledSet = [...new Set([...disabledSet, ...targets])];
        summary.action = { mode: 'precise', disabled: disabledSet };
        done = true;
      } else if (mode === 'b') {
        const cands = snapshotCleanCandidates(path.dirname(snap.dir), [...suspects, ...culprits.modules], 10); // G16 脏候选预检
        const clean = cands.filter((c) => !c.dirty);
        if (!clean.length) { io.out('✗ 无干净候选（最近份可能本身是脏的）。换档重来。'); continue; }
        io.out('干净候选（新→旧）:');
        clean.forEach((c, i) => io.out('  ' + (i + 1) + ') ' + path.basename(c.dir) + '  ' + c.reason));
        const pickRaw = await io.ask('选择回退到第几份（回车=从最新开始；闸门不过自动退更旧一份）：');
        let startIdx = (Number(pickRaw) || 1) - 1;
        startIdx = Math.min(Math.max(startIdx, 0), clean.length - 1);
        const ok = /^y(es)?$/i.test(await io.ask('将依次恢复候选并干跑验证（会改写当前配置；Step1 快照已留底）。继续? (y/N)：'));
        if (!ok) { io.out('已取消。'); continue; }
        // G16 动态防护：「最近份可能是装坏包后才做的」——逐候选恢复+闸门验证，
        // 不过则自动回退更旧一份（≤3 份），全部失败才如实报告。
        let rbOk = false;
        let lastRb = null;
        // 候选数组新→旧排列：「退更旧一份」= 索引递增；最多连试 3 份
        for (let i = startIdx, tried = 0; i < clean.length && tried < 3; i++, tried++) {
          const cand = clean[i];
          io.out('尝试回退 → ' + path.basename(cand.dir) + ' …');
          const rb = sys.rescueRestore(cand.dir, { profileName: profile, exactHomePatch: true }); // G13 home patch 忠实恢复
          lastRb = rb;
          if (!rb.ok) { io.out('✗ 恢复失败: ' + rb.warnings.join('; ')); break; }
          const swept = maintainLib.sweepDanglingLinks(pp.dir); // F1 联动悬空 junction 清理
          if (swept.length) io.out('清理悬空链接: ' + swept.join(', '));
          const gTry = maintainLib.dryRunAll({ profile, roots: maintainLib.dryRunRoots(null, profile), extraNames: composedThirdParties(profile) });
          if (gTry.ok) {
            io.out('✓ 该份通过干跑闸门——已回退 ' + rb.restored.length + ' 文件');
            summary.action = { mode: 'rollback', from: cand.dir, restored: rb.restored.length };
            rbOk = true;
            break;
          }
          io.out('⚠ 该份干跑仍败（layer=' + gTry.layer + '）——继续试更旧一份');
        }
        if (!rbOk) {
          io.out(lastRb && !lastRb.ok ? '' : '\x1b[31m✗ 候选份均未过闸门（多凶或全脏）——建议改走 a/c 档\x1b[0m');
          continue; // 未达效 → 重回处置菜单
        }
        io.out('ℹ 如需 pnpm 重建依赖：仅在服务停止态执行（硬约束 §1.3），命令见 rescue-report。');
        done = true;
      } else if (mode === 'c') {
        const result = await rescueBisect(io, pp, third, profile);
        summary.action = { mode: 'bisect', ...result };
        disabledSet = result.disabled || [];
        done = true;
      } else if (mode === 's') {
        summary.action = { mode: 'skip' };
        done = true;
      } else {
        io.out('无效输入。');
      }
    }

    // 干跑闸门（G14：处置→拉起之间必过；跳过处置也过一遍留证）
    io.out('── 干跑冒烟闸门（复用 A6 双层）──');
    const gate = maintainLib.dryRunAll({ profile, roots: maintainLib.dryRunRoots(null, profile), extraNames: composedThirdParties(profile) });
    summary.gateOk = gate.ok;
    if (!gate.ok) {
      io.out('\x1b[31m✗ 闸门未过（layer=' + gate.layer + '）：' + String(gate.detail).split('\n')[0] + '\x1b[0m');
      io.out('处置未达效——请重进救援换档（当前禁用集: ' + disabledSet.join(', ') + '）。');
      summary.broughtUp = { ok: false, via: 'gate-blocked' };
      writeRescueReport(snap.dir, summary, profile); // 绝不吞错
      summary.reportPath = path.join(snap.dir, 'rescue-report.json');
      return summary;
    }
    io.out('✓ 干跑通过（entries=' + (gate.detail.entries ?? '?') + '）');

    io.out('── Step3 验证拉起 ──');
    const bringUp = o.bringUpImpl || rescueBringUp;
    const up = await bringUp(io, svc);
    summary.broughtUp = up;
    if (up.ok) {
      io.out('✅ DSH 已恢复监听（via=' + up.via + (up.pid ? ' pid=' + up.pid : '') + '）——能监听 = 全部插件加载成功（假阳性论证见方案 §5.3）');
      const cc = o.consistencyCheckImpl || consistencyCheckAfterRestart;
      await cc(io, svc, 3080);
    } else {
      io.out('\x1b[31m✗ 拉起失败: ' + (up.message || up.via) + '\x1b[0m');
      io.out('保留当前禁用态（绝不吞错）；日志: ' + logPaths.join(', '));
    }
    writeRescueReport(snap.dir, summary, profile);
    summary.reportPath = path.join(snap.dir, 'rescue-report.json');
    io.out('报告: ' + summary.reportPath);
    return summary;
  } finally {
    releaseRescueLock();
  }
}

/**
 * 二分定位（c 档 · G18 判定信号优先秒级干跑，全程不真拉起；轮次上限 6）。
 * 判定代数：配置被嫌疑集 C 搞坏；禁用集 S 后干跑通过 ⟺ C ⊆ S。
 * 单凶假设下：只多禁 A 半 → 通过 ⇒ 嫌疑收敛进 A；失败 ⇒ A 无辜、转另一半。
 * 多凶场景退化：终态禁用「未证无辜者」全集再验一次闸门，不过则明示建议快照回退。
 */
async function rescueBisect(io, pp, thirdParties, profile) {
  const already = maintainLib.readPatchIds(pp.patchYml);
  const pool = thirdParties.filter((n) => !already.includes(n));
  const innocent = [];
  let rounds = 0;
  io.out('二分开始（候选 ' + pool.length + ' 个；每轮写 patch 后秒级干跑判定）');
  let p = pool.slice();
  while (p.length > 1 && rounds < 6) {
    rounds++;
    const a = p.slice(0, Math.ceil(p.length / 2));
    maintainLib.writeDisableEntries(pp.patchYml, [...already, ...a]); // 只多禁 A 半
    const g = maintainLib.dryRunAll({ profile, roots: maintainLib.dryRunRoots(null, profile), extraNames: composedThirdParties(profile) });
    if (!g.ok) {
      io.out('round ' + rounds + ': 多禁 [' + a.join(', ') + '] → 干跑**仍败** → 这半无辜，转另一半');
      innocent.push(...a);
      p = p.slice(a.length);
    } else {
      io.out('round ' + rounds + ': 多禁 [' + a.join(', ') + '] → 干跑通过 → 嫌疑收敛进这半');
      p = a;
    }
  }
  // 收敛落盘：终态禁用 = 已禁 + 未证无辜者（单凶场景即元凶）
  const suspects = p.slice();
  maintainLib.writeDisableEntries(pp.patchYml, [...already, ...suspects]);
  for (const name of suspects) maintainLib.removeBundle(pp.packageJson, name);
  const finalGate = maintainLib.dryRunAll({ profile, roots: maintainLib.dryRunRoots(null, profile), extraNames: composedThirdParties(profile) });
  io.out('二分结束（' + rounds + ' 轮）：嫌疑 = [' + suspects.join(', ') + ']'
    + (finalGate.ok ? '；终态干跑通过' : '；终态干跑**仍败**（多凶场景——建议改走快照回退）'));
  return { disabled: [...already, ...suspects], suspects, innocent, rounds, finalGateOk: finalGate.ok };
}

/** rescue-report.json（G7③：附「如何恢复该插件」指引；与快照同目录配对）。 */
function writeRescueReport(snapshotDir, summary, profile) {
  try {
    const report = {
      ts: new Date().toISOString(),
      profile,
      diagnosis: summary.diagnosis,
      action: summary.action,
      gate: { ok: summary.gateOk },
      bringUp: summary.broughtUp,
      restoreGuide: [
        '每个被禁用的 bundle：修复其依赖/损坏问题，或确认不再需要后：',
        '1) 编辑 profiles/' + profile + '/cordis.patch.yml，删除对应 `- id: X` + `disabled: true` 条目;',
        '2) 若 bundles 数组被移除了该包且仍需要：`dsh plugin add <包名>` 重装;',
        '3) 重启服务（维护菜单 1）或整机重启。',
        '整份回退场景：如需重建依赖树，先停服务再 `pnpm install --dir profiles/' + profile + '`（红线：禁止对运行中 profile 跑 pnpm）。',
      ],
    };
    fs.writeFileSync(path.join(snapshotDir, 'rescue-report.json'), JSON.stringify(report, null, 2), 'utf8');
  } catch { /* 报告尽力而为 */ }
}

/* ---- v4.7 三动词（全自动·零用户决策）：repair / update ---- */

/** 系统关键进程保护名单：端口修复绝不击杀这些镜像（误杀=蓝屏/掉会话）。 */
const PROTECTED_IMAGES = new Set([
  'system', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe',
  'lsass.exe', 'svchost.exe', 'explorer.exe', 'dwm.exe', 'conhost.exe',
  'runtimebroker.exe', 'searchapp.exe', 'startmenuexperiencehost.exe', 'sihost.exe',
  'taskhostw.exe', 'registry.exe',
]);

/** 清理 3080 占用者（自动模式）：异族但非系统关键 → 击杀（树杀升级）；系统关键 → 跳过报障。 */
async function killConflictingHolders(io, opts) {
  const o = opts || {};
  const pid = o.holderPidOverride !== undefined ? o.holderPidOverride : sys.portHolderPid(3080);
  if (!pid) return { killed: false, reason: 'no-holder' };
  const image = (o.imageOverride !== undefined ? o.imageOverride : (sys.pidImageName(pid) || '')).toLowerCase();
  if (PROTECTED_IMAGES.has(image)) {
    io.out('⚠ 占用者 ' + pid + ' ' + image + ' 为系统关键进程——不击杀，仅尝试前台冷启（多半仍失败，请人工处理）');
    return { killed: false, reason: 'protected', pid, image };
  }
  io.out('清理占用者: pid=' + pid + ' ' + image);
  tracePush('kill:' + pid + ':' + image);
  if (o.killImpl) { await o.killImpl(pid); }
  else { sys.taskKill(pid, false); try { await sys.waitPidExit(pid, 4000); } catch { sys.taskKill(pid, true); } }
  const gone = o.killImpl ? true : await sys.waitPidExit(pid, 6000).catch(() => false);
  if (!gone) io.out('⚠ 占用者未能退出——继续尝试拉起');
  return { killed: Boolean(gone || o.killImpl), pid, image };
}
function tracePush() { /* 占位：留痕由调用方 summary 承担 */ }

/**
 * [2] 端口修复（自动兜底）：清占用者 → ensureWebUp 恢复阶梯。唯一提问 = 「卸载 nssm 服务」
 *     确认门（v3.3.1-u1：y/N 默认保留，非交互默认拒绝，DSH_MAINT_ALLOW_UNINSTALL=1 放行）。
 * 与 [1] 的关系：[1] 是无冲突拉起；[2] 在 [1] 失败或确认有异常占用时用。
 */
async function repairWebPort(io, svc, profile, opts) {
  const o = opts || {};
  const k = await killConflictingHolders(io, o);
  const inner = await ensureWebUp(io, svc, profile, { ...o, holderPidOverride: 0 });
  return { ...inner, repair: k };
}

/**
 * [3] 一键更新（全自动）：staging 安装 → 干跑闸门（失败自动快照回滚）→ 杀旧监听者 →
 * ensureWebUp 重启生效 → G11 一致性自检。版本方向（升级/同版本/降级）全部自动继续并打印决策行。
 */
async function runOneClickUpdate(io, profile, opts) {
  const o = opts || {};
  const svc = 'dsh-web';
  const tgz = o.findTgzImpl ? o.findTgzImpl() : stageInstall.findStagedTarball();
  if (!tgz) {
    io.out('✗ 无待装更新包——先在 DSH Web 设置页「一键更新」下载新版本。');
    return { ok: false, code: 'NO_STAGED' };
  }
  const newVer = o.peekVerImpl ? o.peekVerImpl(tgz) : stageInstall.peekTarballVersion(tgz);
  const curVer = o.curVerImpl ? o.curVerImpl() : sys.readInstalledPluginVersion(profile);
  const dec = maintainLib.decideUpdateAction(curVer, newVer);
  io.out('更新决策: ' + dec.action + ' · ' + dec.detail + '（一键模式自动继续）');
  io.out('安装 staging 包…');
  const inst = o.installImpl ? await o.installImpl(tgz, profile) : stageInstall.installStagedTarball(tgz, profile);
  if (!inst || inst.ok === false) {
    io.out('✗ 安装失败: ' + ((inst && inst.message) || '未知') + '（运行环境未动）');
    return { ok: false, code: 'INSTALL_FAILED', detail: inst && inst.message };
  }
  // 干跑闸门（组合+模块层；语法层已在安装内过闸）。失败 → 自动快照回滚
  let gate = o.gateImpl ? await o.gateImpl(profile) : maintainLib.dryRunAll({ profile, roots: maintainLib.dryRunRoots(null, profile), extraNames: composedThirdParties(profile) });
  if (!gate.ok) {
    io.out('\x1b[31m✗ 干跑闸门未过（layer=' + gate.layer + '）——自动回滚快照\x1b[0m');
    if (inst.snapshotDir) {
      const rb = sys.rescueRestore(inst.snapshotDir, { profileName: profile, exactHomePatch: true });
      io.out(rb.ok ? '✓ 已回滚 ' + rb.restored.length + ' 文件（旧版本原样恢复）' : '✗ 回滚失败！请立即使用救援模式: ' + rb.warnings.join('; '));
    }
    return { ok: false, code: 'GATE_FAILED_ROLLED_BACK', detail: gate.detail };
  }
  // 重启生效：旧监听者（家族内）击杀后走 ensureWebUp 阶梯拉起新代码
  const oldPid = o.oldPidOverride !== undefined ? o.oldPidOverride : sys.portHolderPid(3080);
  if (oldPid) {
    const img = (o.oldImageOverride !== undefined ? o.oldImageOverride : (sys.pidImageName(oldPid) || '')).toLowerCase();
    if (maintainLib.isDshFamilyImage(img)) {
      io.out('停止旧实例（pid=' + oldPid + '）以加载新版本…');
      if (o.killOldImpl) await o.killOldImpl(oldPid);
      else { sys.taskKill(oldPid, false); await sys.waitPidExit(oldPid, 10000).catch(() => {}); }
    }
  }
  const up = o.ensureUpImpl ? await o.ensureUpImpl(io, svc, profile) : await ensureWebUp(io, svc, profile, {});
  if (!up.ok) {
    io.out('\x1b[31m✗ 新版本文件已就位但拉起失败（' + up.code + '）——重启电脑或将使用救援模式\x1b[0m');
    return { ok: false, code: 'RESTART_FAILED', from: curVer, to: newVer };
  }
  if (!o.consistencyImpl) await consistencyCheckAfterRestart(io, svc, 3080);
  else await o.consistencyImpl();
  io.out('✅ 一键更新完成: v' + (curVer || '?') + ' → v' + (newVer || '?'));
  return { ok: true, code: 'UPDATED', from: curVer, to: newVer };
}

/** 维护主循环（v4.7 三功能全自动：每个动词内部自判断，零用户决策）。opts.run=1|2|3 单发。 */
async function runMaintainMenu(opts) {
  const io = (opts && opts.io) || defaultIo();
  const svc = argValue('service') || 'dsh-web';
  const profile = argValue('profile') || 'web';
  const onceItem = opts && opts.run !== undefined ? String(opts.run) : (argValue('run') !== undefined ? argValue('run') : null);

  const dispatch = async (choice) => {
    printMaintainHeader(io, svc, profile);
    // v4.9：每项功能全程逐步提醒 + 计时（每行 [+Xs] 戳、等待倒计时、结束打印总耗时）
    if (choice === '1') await runWithTiming(io, '一键拉起', (tio) => ensureWebUp(tio, svc, profile, {}));
    else if (choice === '2') await runWithTiming(io, '端口修复', (tio) => repairWebPort(tio, svc, profile, {}));
    else if (choice === '3') await runWithTiming(io, '一键更新', (tio) => runOneClickUpdate(tio, profile, {}));
    else if (choice === '0') return false;
    else io.out('无效选择。');
    return true;
  };

  if (onceItem) { await dispatch(onceItem); return; }

  for (;;) {
    printMaintainHeader(io, svc, profile);
    io.out('  1) 启动 Web   —— 未运行则拉起在线；已在运行则询问是否原地重启（y/N，默认保持）；nssm 异常自动自愈');
    io.out('  2) 端口修复   —— [1] 拉不起来时的兜底：自动清理占用者后重新拉起');
    io.out('  3) 一键更新   —— 安装 staging 待装新版本并自动重启生效（失败自动回滚）');
    io.out('  0) 退出');
    const c = await io.ask('选择: ');
    io.out('');
    if (!(await dispatch(c))) return;
    io.out('');
    const again = await io.ask('回车返回菜单（q 退出）：');
    if (again.toLowerCase() === 'q') return;
  }
}

if (require.main === module) {
  if (argValue('cli') === 'restart') {
    runCliRestart().then(() => process.exit(0)).catch((e) => { console.error('CLI 异常: ' + (e && e.message || e)); process.exit(1); });
  } else if (argValue('cli') === 'maintain') {
    runMaintainMenu().then(() => process.exit(0)).catch((e) => { console.error('维护 CLI 异常: ' + (e && e.stack || e)); process.exit(1); });
  } else if (argValue('cli') === 'up') {
    // [1] 一键拉起（快捷方式默认项）：--open 拉起成功后开浏览器
    const ioUp = defaultIo();
    runWithTiming(ioUp, '一键拉起', (tio) => ensureWebUp(tio, argValue('service') || 'dsh-web', argValue('profile') || 'web', { open: argValue('open') !== undefined }))
      .then((r) => process.exit(r.ok ? 0 : 2))
      .catch((e) => { console.error('一键拉起异常: ' + (e && e.stack || e)); process.exit(1); });
  } else if (argValue('cli') === 'repair') {
    const ioRp = defaultIo();
    runWithTiming(ioRp, '端口修复', (tio) => repairWebPort(tio, argValue('service') || 'dsh-web', argValue('profile') || 'web', {}))
      .then((r) => process.exit(r.ok ? 0 : 2))
      .catch((e) => { console.error('端口修复异常: ' + (e && e.stack || e)); process.exit(1); });
  } else if (argValue('cli') === 'update') {
    const ioUd = defaultIo();
    runWithTiming(ioUd, '一键更新', (tio) => runOneClickUpdate(tio, argValue('profile') || 'web', {}))
      .then((r) => process.exit(r.ok ? 0 : 2))
      .catch((e) => { console.error('一键更新异常: ' + (e && e.stack || e)); process.exit(1); });
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
  // 批次二 A4：重启核心与维护菜单导出——演练/单测注入 io 复用同一实现，杜绝逻辑分叉
  restartCore,
  runRescue,
  rescueBisect,
  ensureWebUp,
  // v4.9 过程计时层导出——单测复用同一实现
  createTimedIo,
  runWithTiming,
  waitWebReady,
  openBrowser,
  repairWebPort,
  runOneClickUpdate,
  killConflictingHolders,
  acquireRescueLock,
  releaseRescueLock,
  resolveColdStartCommand,
  svcStateRaw,
  parseAssetDigest,
  parseSha256Text,
  hashGate,
  fetchExpectedSha256,
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
