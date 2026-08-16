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
const { spawn, spawnSync } = require('node:child_process');
const sys = require('./sys.cjs');
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
function portListening(port) {
  const r = sys.runProbe('netstat', ['-ano', '-p', 'tcp'], env());
  if (!r.ok) return false;
  return new RegExp(':' + port + '\\s+\\S+\\s+LISTENING').test(r.stdout);
}
function serviceStopped(svc) {
  const r = sys.runProbe('sc', ['query', svc], env());
  return r.ok && /STATE\s*:\s*\d+\s+STOPPED/i.test(r.stdout);
}

async function stopService(svc) {
  spawnSync('sc', ['stop', svc], { encoding: 'utf8', windowsHide: true, timeout: 60000, env: env() });
  for (let i = 0; i < 10; i++) {
    if (serviceStopped(svc)) return true;
    await sleep(1000);
  }
  return serviceStopped(svc);
}

function startService(svc) {
  spawnSync('sc', ['start', svc], { encoding: 'utf8', windowsHide: true, timeout: 60000, env: env() });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- staging (download while service is still online) ----
function stageTarball(tag) {
  return new Promise((resolve) => {
    try {
      ensureDir(STAGING_DIR);
      const fileName = 'dsh-prompt-enhancer-' + tag + '.tgz';
      const dest = path.join(STAGING_DIR, fileName);
      const url = pure.buildTarballUrl(sys.INSTALL_REPO, tag);
      log('stage download ' + url + ' -> ' + dest);
      const child = spawn('curl', ['-L', '--fail', '-sS', '-o', dest, url], {
        env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += String(d); });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch { /* ignore */ }
        resolve({ ok: false, code: 'STAGE_TIMEOUT', message: 'download timed out' });
      }, sys.INSTALL_TIMEOUT_MS);
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, code: 'STAGE_FAILED', message: String(e.message || e) });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          resolve({ ok: false, code: 'STAGE_DOWNLOAD_FAILED', message: stderr.trim().slice(0, 500) });
          return;
        }
        if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
          resolve({ ok: false, code: 'STAGE_EMPTY', message: 'downloaded file is empty' });
          return;
        }
        resolve({ ok: true, path: dest, size: fs.statSync(dest).size });
      });
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

async function restartService(svc) {
  if (state.busy) return { ok: false, code: 'BUSY', message: 'restart already in progress' };
  state.busy = true;
  state.phase = 'restarting';
  state.attempt = 0;
  state.startedAt = Date.now();
  state.message = 'stopping';
  const healthPort = resolveHealthPort(svc);
  log('restart start svc=' + svc + ' healthPort=' + healthPort);
  try {
    spawnSync('sc', ['stop', svc], { encoding: 'utf8', windowsHide: true, timeout: 60000, env: env() });
    for (let i = 0; i < 10; i++) {
      if (serviceStopped(svc)) break;
      await sleep(1000);
    }
    state.message = 'stopped, settling 3s';
    await sleep(3000);

    // v2.7.2 修复：每轮重试 = 完整「stop → start」组合（此前 stop 仅一次，失败轮只重复
    // start——进程残留/端口未释放时裸 start 无效，端口可能一直拉不起，需手动 stop+start
    // 两次才成功）。现每轮先 stop 幂等清理（已停止则 sc 立即返回），等 STOPPED/端口释放，
    // 再 start + 端口健康检查；成功即返回，失败进入下一轮完整组合，直至 maxAttempts 轮。
    const plan = pure.buildRestartPlan(svc, healthPort, 5);
    for (let attempt = 1; attempt <= plan.maxAttempts; attempt++) {
      state.attempt = attempt;
      state.message = 'round ' + attempt + ': stop+start';
      log('round ' + attempt + ' of ' + plan.maxAttempts + ': stop+start');
      spawnSync('sc', ['stop', svc], { encoding: 'utf8', windowsHide: true, timeout: 60000, env: env() });
      for (let i = 0; i < 10; i++) {
        if (serviceStopped(svc)) break;
        await sleep(1000);
      }
      spawnSync('sc', ['start', svc], { encoding: 'utf8', windowsHide: true, timeout: 60000, env: env() });
      await sleep(8000); // startup + stability window
      if (portListening(healthPort)) {
        state.phase = 'healthy';
        state.message = 'healthy on round ' + attempt;
        log('healthy on round ' + attempt);
        return { ok: true, attempt, message: 'healthy' };
      }
      state.message = 'round ' + attempt + ' not listening, retrying stop+start';
      log('round ' + attempt + ' NOT listening');
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
    if (method === 'status') return respond({ ok: true, ...state });
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
  console.error('[updater-host] server error: ' + e.message);
  process.exit(1);
});
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    log('listening on 127.0.0.1:' + PORT + ' pid=' + process.pid + ' version=' + VERSION);
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
  });
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
};
