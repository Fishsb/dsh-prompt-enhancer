'use strict';
/**
 * dsh-prompt-enhancer — host half bundle entry.
 *
 * Bridges the dynamic-plugin body (plugin-host.js) into the static cordis
 * bundle: evaluates the body once, adapts its `harness` RPC surface
 * (harness.handle) to an HTTP endpoint the bundled client half calls, and
 * registers that endpoint on the profile's web server.
 *
 * v2.5.0: additionally injects system-level primitives the sandboxed body
 * cannot provide (no require/fs inside `new Function`):
 *   - harness.sysInfo        { dshBin, execPath } (from process.argv[1])
 *   - harness.execCommand    whitelisted install command (user PATH merged in)
 *   - harness.execDetached   detached restart chain (survives own termination)
 *   - harness.probeEnv       read-only environment probes for update/envcheck
 * The dynamic install (cordis_define) keeps working unchanged: there the
 * harness is the official one, so these fields are absent and the body
 * degrades gracefully (UNSUPPORTED).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');
const RPC_PATH = '/dsh-prompt-enhancer/rpc';

/** RPC handlers registered via harness.handle(method, fn). */
const handlers = new Map();

// ============================================================================
// v2.5.0 — system primitives (bundle-only)
// ============================================================================

const INSTALL_REPO = 'Fishsb/dsh-prompt-enhancer';
const PROBE_TIMEOUT_MS = 15000;
const INSTALL_TIMEOUT_MS = 120000;
const USER_PATH_CACHE = { value: null, at: 0 };
const USER_PATH_TTL_MS = 60000;
const NPMRC_CACHE = { value: null, at: 0 };
const NPMRC_TTL_MS = 60000;

/** Read the user-level PATH (HKCU\Environment\Path), 60s cached. */
function readUserPath() {
  const now = Date.now();
  if (USER_PATH_CACHE.value !== null && now - USER_PATH_CACHE.at < USER_PATH_TTL_MS) {
    return { ok: true, path: USER_PATH_CACHE.value };
  }
  try {
    const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    if (r.status !== 0 || r.error) return { ok: false };
    const lines = String(r.stdout || '').split(/\r?\n/);
    let val = '';
    for (const line of lines) {
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line);
      if (m) { val = m[1].trim(); break; }
    }
    if (!val) return { ok: false };
    USER_PATH_CACHE.value = val;
    USER_PATH_CACHE.at = now;
    return { ok: true, path: val };
  } catch {
    return { ok: false };
  }
}

/** Read proxy keys from $HOME/.npmrc (existence only — never expose values). */
function readNpmrcProxy() {
  const now = Date.now();
  if (NPMRC_CACHE.value !== null && now - NPMRC_CACHE.at < NPMRC_TTL_MS) {
    return NPMRC_CACHE.value;
  }
  const out = { proxy: '', httpsProxy: '' };
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const p = path.join(home, '.npmrc');
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf8');
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const m = /^\s*(proxy|https-proxy)\s*=\s*(\S+)\s*$/.exec(line);
        if (!m) continue;
        if (m[1] === 'proxy') out.proxy = m[2];
        if (m[1] === 'https-proxy') out.httpsProxy = m[2];
      }
    }
  } catch { /* 读取失败按无代理处理 */ }
  NPMRC_CACHE.value = out;
  NPMRC_CACHE.at = now;
  return out;
}

/** Reuse PURE-section helpers from plugin-host.js (single source of truth). */
function extractPure() {
  const begin = BODY.indexOf('// ==PURE-BEGIN==');
  const end = BODY.indexOf('// ==PURE-END==');
  if (begin === -1 || end <= begin) throw new Error('PURE markers not found');
  const pureText = BODY.slice(begin, end);
  return new Function(pureText + '\n;return { mergeEnvPath };')();
}
const pure = extractPure();

/** Child env = process.env with the user PATH merged in (dedup, case-insensitive). */
function mergedEnv() {
  const env = { ...process.env };
  const up = readUserPath();
  if (up.ok && up.path) {
    const sys = typeof env.PATH === 'string' ? env.PATH : '';
    env.PATH = pure.mergeEnvPath(sys, up.path);
  }
  return env;
}

/** Whitelist gate: only the exact install command template may run. */
function isInstallArgs(args) {
  if (!Array.isArray(args) || args.length !== 6) return false;
  const [bin, cmd, flag, profile, add, spec] = args;
  if (typeof bin !== 'string' || bin === '' ||
      typeof cmd !== 'string' || cmd !== 'plugin' ||
      flag !== '--profile' || typeof profile !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(profile) ||
      add !== 'add' || typeof spec !== 'string') return false;
  const prefix = 'github:' + INSTALL_REPO + '#';
  if (!spec.startsWith(prefix)) return false;
  return /^v?\d+\.\d+\.\d+$/.test(spec.slice(prefix.length));
}

/** Whitelist gate for detached restart chains: `net stop <svc> & ... & net start <svc>`. */
function isRestartChain(cmdline) {
  if (typeof cmdline !== 'string') return false;
  const m = /^net stop ([A-Za-z0-9_-]+) & timeout \/t \d+ \/nobreak >nul & net start \1$/.exec(cmdline.trim());
  return !!m;
}

/** Run a whitelisted probe command synchronously (system32 tools; PATH always reachable). */
function runProbe(cmd, args, env) {
  const CMD_ALLOW = new Set(['where', 'sc', 'reg', 'netstat', 'curl']);
  if (!CMD_ALLOW.has(cmd)) return { ok: false, code: 'BAD_PROBE_CMD' };
  for (const a of args) {
    if (typeof a !== 'string' || !/^[A-Za-z0-9_./:\\\-=%{}:]+$/.test(a)) {
      return { ok: false, code: 'BAD_PROBE_ARG' };
    }
  }
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: PROBE_TIMEOUT_MS, env });
    if (r.error) return { ok: false, code: String(r.error.code || 'SPAWN_FAILED') };
    return { ok: r.status === 0, code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
  } catch (e) {
    return { ok: false, code: 'PROBE_FAILED' };
  }
}

/** Read --port from the service's nssm AppParameters (fallback: process env port). */
function readServicePort(serviceName, env) {
  try {
    const r = runProbe('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + serviceName + '\\Parameters', '/v', 'AppParameters'], env);
    if (r.ok) {
      const m = /--port[ =](\d+)/.exec(r.stdout);
      if (m) return { ok: true, port: Number(m[1]) };
    }
  } catch { /* fallthrough */ }
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0) return { ok: true, port: envPort };
  return { ok: false };
}

/**
 * v2.5.0 environment probes (read-only, no side effects).
 * Keys match ENV_PROBE_KEYS in plugin-host.js PURE section.
 * @param {string} serviceName config.updater.serviceName (default 'dsh-web')
 */
function probeEnv(serviceName) {
  const svc = /^[A-Za-z0-9_-]+$/.test(serviceName) ? serviceName : 'dsh-web';
  const env = mergedEnv();
  const items = [];
  // TEMP-DEBUG: diagnostic breadcrumb for probeEnv troubleshooting
  const dbg = { userPath: readUserPath(), pathLen: typeof env.PATH === 'string' ? env.PATH.length : -1, pid: process.pid, argv1: process.argv[1] };

  // 1. net — codeload connectivity via curl (proxy first, then direct)
  {
    const npmrc = readNpmrcProxy();
    const proxy = npmrc.httpsProxy || npmrc.proxy || '';
    const target = 'https://codeload.github.com/' + INSTALL_REPO + '/tar.gz/HEAD';
    const curlArgs = ['-sI', '-m', '12', '-o', 'NUL', '-w', '%{http_code}'];
    let detail = 'unreachable';
    let ok = false;
    let raw = null;
    if (proxy) {
      const r = runProbe('curl', [...curlArgs, '-x', proxy, target], env);
      raw = { proxy: true, code: r.code, ok: r.ok, out: String(r.stdout || '').trim().slice(0, 40) };
      if (r.ok && r.stdout.trim() === '200') { ok = true; detail = 'ok'; }
      else detail = 'proxy-unreachable';
    }
    if (!ok) {
      const r2 = runProbe('curl', [...curlArgs, target], env);
      raw = { proxy: !!proxy, code: r2.code, ok: r2.ok, out: String(r2.stdout || '').trim().slice(0, 40) };
      if (r2.ok && r2.stdout.trim() === '200') { ok = true; detail = 'ok-direct'; }
      else detail = proxy ? 'proxy-unreachable' : 'unreachable';
    }
    items.push({ key: 'net', ok, warn: !ok, detail, raw });
  }

  // 2. service — sc query finds the service
  {
    const r = runProbe('sc', ['query', svc], env);
    const ok = r.ok && /STATE\s*:\s*\d+\s+(RUNNING|STOPPED)/i.test(r.stdout);
    items.push({ key: 'service', ok, warn: !ok, detail: ok ? 'ok' : 'missing', raw: { code: r.code, ok: r.ok, out: String(r.stdout || '').slice(0, 120) } });
  }

  // 3. account — SERVICE_START_NAME == LocalSystem
  {
    const r = runProbe('sc', ['qc', svc], env);
    const ok = r.ok && /SERVICE_START_NAME\s*:\s*LocalSystem/i.test(r.stdout);
    items.push({ key: 'account', ok, warn: !ok, detail: ok ? 'ok' : 'not-system', raw: { code: r.code, ok: r.ok, out: String(r.stdout || '').slice(0, 120) } });
  }

  // 4. restart — nssm kill-tree not enabled (native sc services are fine)
  {
    const r = runProbe('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + svc + '\\Parameters', '/v', 'AppKillProcessTree'], env);
    const ok = !r.ok || !/AppKillProcessTree\s+REG_DWORD\s+0x1/i.test(r.stdout);
    items.push({ key: 'restart', ok, warn: !ok, detail: ok ? 'ok' : 'killtree' });
  }

  // 5. port — occupied by this very process (or free)
  {
    const portInfo = readServicePort(svc, env);
    let ok = true;
    let detail = 'ok';
    if (portInfo.ok) {
      const r = runProbe('netstat', ['-ano', '-p', 'tcp'], env);
      if (r.ok) {
        const re = new RegExp(':' + portInfo.port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)');
        const m = re.exec(r.stdout);
        if (m) {
          ok = Number(m[1]) === process.pid;
          detail = ok ? 'ok' : 'occupied';
        }
      }
    }
    items.push({ key: 'port', ok, warn: !ok, detail });
  }

  // 6. mode — this probe exists only in the bundle form
  items.push({ key: 'mode', ok: true, warn: false, detail: 'ok' });

  // 7. pnpmInfo — after PATH injection pnpm is reachable (informational)
  {
    const r = runProbe('where', ['pnpm'], env);
    items.push({ key: 'pnpmInfo', ok: r.ok, warn: false, detail: r.ok ? 'injected' : 'missing', raw: { code: r.code, ok: r.ok, out: String(r.stdout || '').slice(0, 80) } });
  }

  items.debug = dbg;
  return items;
}

/** harness facade the dynamic body closes over. */
const harness = {
  handle(method, fn) {
    if (typeof method !== 'string' || typeof fn !== 'function') return;
    handlers.set(method, fn);
  },
  // v2.5.0: bundle-only primitives (absent under dynamic install)
  sysInfo: {
    dshBin: process.argv[1] && String(process.argv[1]).toLowerCase().endsWith('bin.js') ? process.argv[1] : '',
    execPath: process.execPath,
  },
  execCommand(args, opts) {
    return new Promise((resolve) => {
      if (!isInstallArgs(args)) {
        resolve({ ok: false, code: 'BAD_ARGS', stdout: '', stderr: 'whitelist rejected' });
        return;
      }
      const timeoutMs = opts && Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : INSTALL_TIMEOUT_MS;
      const child = spawn(process.execPath, args, {
        env: mergedEnv(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch { /* ignore */ }
        resolve({ ok: false, code: 'TIMEOUT', stdout, stderr });
      }, timeoutMs);
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, code: String(e.code || 'SPAWN_FAILED'), stdout, stderr });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, code, stdout, stderr });
      });
    });
  },
  execDetached(cmdline) {
    if (!isRestartChain(cmdline)) {
      throw new Error('whitelist rejected');
    }
    const child = spawn('cmd.exe', ['/c', cmdline], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: mergedEnv(),
    });
    child.unref();
  },
  probeEnv,
};

/** Evaluate the body: a top-level-return plugin object. */
const plugin = new Function('harness', BODY)(harness);

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(parsed);
      } catch {
        resolve({});
      }
    });
    request.on('error', () => resolve({}));
  });
}

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function registerRpcRoute(ctx) {
  const webServer = ctx.get('webServer');
  if (!webServer || typeof webServer.register !== 'function') return;
  webServer.register({
    kind: 'exact',
    path: RPC_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        writeJson(response, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      const { method, args } = await readBody(request);
      const fn = handlers.get(method);
      if (!fn) {
        writeJson(response, 404, { ok: false, code: 'UNKNOWN_METHOD', method });
        return;
      }
      try {
        const result = await fn(args || {});
        writeJson(response, 200, result || { ok: true });
      } catch (error) {
        writeJson(response, 500, {
          ok: false,
          code: 'HANDLER_FAILED',
          message: String((error && error.message) || error),
        });
      }
    },
  });
}

module.exports = {
  name: 'dsh-prompt-enhancer',
  ...plugin,
  apply(ctx) {
    // webServer is provided asynchronously after the profile composes the
    // web app — inject, don't get (same pattern as dsh-market).
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (hostCtx) => {
        hostCtx.effect(() => registerRpcRoute(hostCtx), 'dsh-prompt-enhancer: rpc route');
      });
    } else {
      registerRpcRoute(ctx);
    }
    return plugin.apply.call(this, ctx);
  },
};
