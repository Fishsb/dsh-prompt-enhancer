'use strict';
/**
 * dsh-prompt-enhancer — host half bundle entry (v2.7.1).
 *
 * Bridges the dynamic-plugin body (plugin-host.js) into the static cordis
 * bundle: evaluates the body once, adapts its `harness` RPC surface
 * (harness.handle) to an HTTP endpoint the bundled client half calls, and
 * registers that endpoint on the profile's web server.
 *
 * v2.6.0: update execution moved OUT of this process into the standalone
 * update executor (lib/updater-host.cjs) — a detached process on its own port
 * (default 3081) that survives dsh-web restarts and performs install + restart
 * with reliable node-timer sleeps and port health-check retries.
 *   - harness.probeEnv stays (envcheck RPC still lives in-host; shared impl in lib/sys.cjs)
 *   - new RPC update/executorEnsure: ping the executor; spawn/kill-and-respawn
 *     when missing or version-stale; return {port, version, pid}
 * The dynamic install (cordis_define) keeps working: there the harness is the
 * official one, so probeEnv is absent (envcheck → UNSUPPORTED) and ensure is
 * not registered (client falls back to a clear "use bundle install" hint).
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const sys = require('./sys.cjs');
const platformService = require('./platform-service.cjs');
const { validateRpcArgs } = require('./rpc-schema.cjs');

// 2026-08-18（进程级重启降级·方案 2 修复）：写进程索引从 plugin-host.js（BODY）移到本模块级——
// BODY 经 new Function('harness', BODY) 执行（见下方 256 行），其作用域无 require；原 BODY 内
// require('node:fs') 必然抛错被 try/catch 静默吞掉 → 索引永远写不出 → 非服务化部署（无系统服务，
// 如未装 nssm 的机器）端口重启的进程级降级路径（updater-host 读索引 → kill → spawn 同参数新进程）
// 失效（NO_SERVICE_AND_NO_INDEX）。host 模块加载时写索引（$DSH_HOME/dsh-prompt-enhancer.json，
// pid/execPath/cwd/argv，尽力而为，失败不影响插件）。
{
  try {
    const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    fs.mkdirSync(dshHome, { recursive: true });
    fs.writeFileSync(path.join(dshHome, 'dsh-prompt-enhancer.json'), JSON.stringify({
      pid: process.pid,
      execPath: process.execPath,
      cwd: process.cwd(),
      argv: process.argv.slice(1),
      ts: Date.now(),
    }), 'utf8');
  } catch (e) { /* 尽力而为，失败不影响插件 */ }
}

const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');
const RPC_PATH = '/dsh-prompt-enhancer/rpc';

/** RPC handlers registered via harness.handle(method, fn). */
const handlers = new Map();

const pure = sys.extractPure(BODY);
const envForProbe = () => sys.mergedEnv(pure);

// ============================================================================
// v2.6.0 — executor lifecycle (ensure / ping / respawn)
// ============================================================================

/** POST {method,args} to the executor; resolves null on any failure. */
function executorCall(port, method, args) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ method, args: args || {} });
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/rpc',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      timeout: 3000,
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(payload);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);

/**
 * Resolve the latest executor version from the on-disk sys.cjs, NOT the
 * process-require cache. A dsh-web process started before an executor bump
 * keeps the old EXECUTOR_VERSION constant in memory; using it as the
 * executorEnsure target would forever match the stale running executor and
 * never upgrade it. Reading the disk value lets a stale host still pull up
 * the new executor (and lets the client-side version guard pass).
 */
function readLatestExecutorVersion() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'sys.cjs'), 'utf8');
    const m = /EXECUTOR_VERSION\s*=\s*'([^']+)'/.exec(src);
    return m && m[1] ? m[1] : sys.EXECUTOR_VERSION;
  } catch (e) {
    return sys.EXECUTOR_VERSION;
  }
}

/**
 * Copy the executor (updater-host.cjs + sys.cjs + plugin-host.js) into an
 * external versioned directory. This is the core fix for the Windows EPERM
 * self-lock: the executor no longer runs from inside node_modules, so it can
 * stop dsh-web and let pnpm replace the plugin directory.
 * 2026-08-18（v3.2.1 修复）：copies 补 platform-service.cjs——sys.cjs:12 / updater-host.cjs:33
 * 均 require('./platform-service.cjs')，此前漏复制 → 执行器启动即 MODULE_NOT_FOUND 崩溃
 * （日志 $TEMP/dsh-updater-host.log：Cannot find module，Node.js v22.23.2），端口重启
 * 恒报「更新执行器未能启动（端口 3081）」。有 nssm 机器若执行器由旧版拉起的旧副本运行
 * 不受影响（磁盘文件未缺失），新拉/版本对齐时同样必崩。
 * 2026-08-19（v3.2.1 加固）：复制清单改为**整个 lib 目录**（fs.cpSync）——手写清单是
 * 漏文件的根源（已漏一次），目录级复制杜绝此类问题再次发生；plugin-host.js 仍按 mtime 单复制。
 */
function ensureExternalExecutor(version) {
  const root = sys.executorDir(version);
  const libDir = path.join(root, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const libSrc = __dirname;
  if (libSrc !== libDir) {
    fs.cpSync(libSrc, libDir, {
      recursive: true,
      force: true,
      filter: (src) => !src.endsWith('.map') && !/types$/.test(src) && !/client\.cjs$/.test(src),
    });
  }
  const hostSrc = path.join(__dirname, '..', 'plugin-host.js');
  const hostDst = path.join(root, 'plugin-host.js');
  if (!fs.existsSync(hostDst) || fs.statSync(hostSrc).mtimeMs > fs.statSync(hostDst).mtimeMs) {
    fs.copyFileSync(hostSrc, hostDst);
  }
  return root;
}

/**
 * v3.2.1-b（2026-08-19 实测）：执行器日志文件可能被运行中的执行器进程持有句柄
 * （Windows 下后开者 openSync 追加会抛 EBUSY——实测两个进程同时 'a' 打开同一文件
 * 时第二个被拒）→ 拉起前探测可写性，被占用时降级带 pid+时间戳后缀的独立日志，
 * 避免 spawnExecutorDirect 的 openSync / cmd 重定向 EBUSY 抛错导致执行器拉起失败。
 * 现象对应：重启电脑后首次端口重启报「更新执行器未能启动（端口 3081）」且日志无记录。
 */
function resolveExecutorLogPath() {
  const base = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'dsh-updater-host.log');
  try {
    const probe = fs.openSync(base, 'a');
    fs.closeSync(probe);
    return base;
  } catch {
    return base + '.' + process.pid + '.' + Date.now() + '.log';
  }
}

/** Fallback: old direct detached spawn (used only if schtasks is unavailable). */
function spawnExecutorDirect(port, version, logPath) {
  const ver = version || sys.EXECUTOR_VERSION;
  const root = ensureExternalExecutor(ver);
  const lp = logPath || resolveExecutorLogPath();
  let out = null;
  try { out = fs.openSync(lp, 'a'); } catch { out = null; }
  const child = spawn(process.execPath, [path.join(root, 'lib', 'updater-host.cjs')], {
    cwd: root,
    detached: true,
    stdio: out ? ['ignore', out, out] : ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
    // v2.7.0 修复：注入 dsh CLI 路径（服务启动命令的 argv[1] = dsh lib/bin.js）——
    // 执行器 install 依赖 DSH_DSH_BIN，此前从未注入 → apply 必然 BAD_ARGS 失败。
    env: {
      ...process.env,
      DSH_EXECUTOR_PORT: String(port),
      DSH_DSH_BIN: process.argv[1] || '',
    },
  });
  child.unref();
  if (out) fs.closeSync(out);
  return child;
}

/** XML-escape a string for Task Scheduler task XML. */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a Task Scheduler XML document that launches updater-host.cjs as a
 * standalone process (SYSTEM 或当前用户). Unlike a plain detached child, a
 * scheduled task is owned by the Task Scheduler service, so it survives
 * `sc stop dsh-web` (plain detached children of the service are killed with
 * the service tree on this host — see updater-host.log ending at "restart start").
 * 2026-08-19（v3.2.1）：asUser=true 生成「当前用户 + InteractiveToken + LeastPrivilege」任务——
 * 普通用户可自建（免管理员；SYSTEM 任务需管理员被拒时降级用）。交互令牌需用户已登录
 * （本场景执行器随 DSH 进程拉起，登录会话必然存在）。
 */
function currentUserSid() {
  // v3.2.1（2026-08-19 实测修复）：whoami 解析失败时**不再兜底返回 S-1-5-18**——
  // 那会让「当前用户任务」的 XML 变成 UserId=SYSTEM + LogonType=InteractiveToken 的
  // 非法组合，schtasks /Create 必失败（白费一轮降级尝试）；改为返回 null，
  // 由调用方决定跳过当前用户任务、直接走 detached 兜底。
  try {
    const r = spawnSync('whoami', ['/user'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const m = /S-1-5-(?:\d+-)+\d+/.exec(String(r.stdout || ''));
    return m ? m[0] : null;
  } catch { return null; }
}
function buildExecutorTaskXml(port, taskName, cmdPath, workingDir, asUser, sid) {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:/Windows';
  const cmdExe = path.join(systemRoot, 'System32', 'cmd.exe');
  const args = '/c "' + cmdPath + '"';
  const wd = workingDir || sys.executorDir(sys.EXECUTOR_VERSION);
  const principal = asUser
    ? '<Principals><Principal id="Author"><UserId>' + xmlEscape(sid || '') + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>'
    : '<Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>';
  return '<?xml version="1.0" encoding="UTF-16"?>' + CRLF +
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' + CRLF +
    '  <RegistrationInfo><Description>dsh-prompt-enhancer updater executor</Description></RegistrationInfo>' + CRLF +
    '  <Triggers><TimeTrigger><StartBoundary>2099-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>' + CRLF +
    '  ' + principal + CRLF +
    '  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>' +
    '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>' +
    '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>' +
    '<AllowHardTerminate>true</AllowHardTerminate>' +
    '<StartWhenAvailable>false</StartWhenAvailable>' +
    '<RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>' +
    '<Enabled>true</Enabled><Hidden>false</Hidden>' +
    '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>' + CRLF +
    '  <Actions Context="Author"><Exec>' +
    '<Command>' + xmlEscape(cmdExe) + '</Command>' +
    '<Arguments>' + xmlEscape(args) + '</Arguments>' +
    '<WorkingDirectory>' + xmlEscape(wd) + '</WorkingDirectory>' +
    '</Exec></Actions>' + CRLF +
    '</Task>' + CRLF;
}

/**
 * Spawn the standalone executor through Task Scheduler so it is NOT a child
 * of the dsh-web service tree. This is the fix for the restart chain dying at
 * `sc stop dsh-web`; the executor stays alive to run the stop→start retry loop.
 *
 * A .cmd wrapper is used because Task Scheduler does not inherit the dsh-web
 * service environment (HOME/APPDATA etc. are needed by pnpm during install).
 */
function spawnExecutor(port, version) {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:/Windows';
  const ver = version || sys.EXECUTOR_VERSION;
  // v3.2.1（审查优化·无服务场景 detached 优先）：普通用户环境（无系统服务）的
  // schtasks 三级降级链（SYSTEM 被拒 → 当前用户任务 → detached）既慢又容易在
  // 冷启动/权限边界出错——无服务时直接 detached（最快最可靠）；仅服务化场景
  // （sc stop 会杀服务树，执行器需任务方式脱离服务树存活）才走 schtasks 任务链。
  try {
    const backend = platformService.backendFor(process.platform);
    if (!(backend && backend.detectService('dsh-web', envForProbe()).exists)) {
      return spawnExecutorDirect(port, ver, resolveExecutorLogPath());
    }
  } catch { /* 检测失败按无服务 → detached */ return spawnExecutorDirect(port, ver, resolveExecutorLogPath()); }
  const schtasks = path.join(systemRoot, 'System32', 'schtasks.exe');
  const tmp = process.env.TEMP || 'C:/Windows/Temp';
  const taskName = 'dsh-prompt-enhancer-exec-' + process.pid + '-' + Date.now();
  const xmlPath = path.join(tmp, taskName + '.xml');
  const cmdPath = path.join(tmp, taskName + '.cmd');
  // v3.2.1-b（2026-08-19）：日志可写性探测——被运行中执行器持句柄时降级后缀日志，
  // 避免 cmd 的 `>> log 2>&1` 重定向 EBUSY 导致任务启动的 cmd 退出、执行器不拉起
  const logPath = resolveExecutorLogPath();
  const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
  const dshBin = process.argv[1] || '';
  const executorRoot = ensureExternalExecutor(ver);
  const executorEntry = path.join(executorRoot, 'lib', 'updater-host.cjs');
  const envNames = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'windir'];
  const envLines = [];
  for (const name of envNames) {
    const val = process.env[name];
    if (val) envLines.push('set "' + name + '=' + String(val).replace(/%/g, '%%') + '"');
  }
  const cmdContent = [
    '@echo off',
    ...envLines,
    'set "DSH_EXECUTOR_PORT=' + port + '"',
    'set "DSH_DSH_BIN=' + String(dshBin).replace(/%/g, '%%') + '"',
    'set "DSH_EXECUTOR_TASK=' + taskName + '"',
    'set "DSH_EXECUTOR_CMD=' + cmdPath + '"',
    '"' + process.execPath + '" "' + executorEntry + '" --port ' + port + ' --dsh-bin "' + dshBin + '" --task "' + taskName + '" --cmd "' + cmdPath + '" >> "' + logPath + '" 2>&1',
  ].join(CRLF);
  try {
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');
  } catch (e) {
    try { fs.unlinkSync(cmdPath); } catch { /* ignore */ }
    return spawnExecutorDirect(port, null, logPath);
  }
  // v3.2.1（三级降级）：SYSTEM 任务（需管理员）→ 当前用户任务（InteractiveToken 免管理员）
  // → detached 直拉。普通用户无管理员时 SYSTEM 创建被拒，自动落到当前用户任务（登录会话
  // 必存在——执行器由 DSH 进程拉起）；两者都失败才用旧 detached fallback。
  // v3.2.1-b（2026-08-19 实测修复）：当前用户任务仅在 whoami 能解析出 SID 时尝试——
  // whoami 失败时 SID 为 null，若强行生成 XML 会得到 UserId 为空 / SYSTEM 兜底的非法组合，
  // schtasks 必失败还拖延 15s 超时；直接跳过该级、更快落到 detached。
  const attempts = [
    { kind: 'system', xml: buildExecutorTaskXml(port, taskName, cmdPath, executorRoot, false) },
  ];
  const userSid = currentUserSid();
  if (userSid) {
    attempts.push({ kind: 'user', xml: buildExecutorTaskXml(port, taskName, cmdPath, executorRoot, true, userSid) });
  }
  for (const att of attempts) {
    try { fs.writeFileSync(xmlPath, '\ufeff' + att.xml, 'utf16le'); } catch { continue; }
    const create = spawnSync(schtasks, ['/Create', '/TN', taskName, '/XML', xmlPath, '/F'], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    try { fs.unlinkSync(xmlPath); } catch { /* ignore */ }
    if (create.status !== 0) continue;
    const run = spawnSync(schtasks, ['/Run', '/TN', taskName], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    if (run.status === 0) {
      console.log('[dsh-prompt-enhancer] executor spawned via ' + att.kind + ' task');
      return null;
    }
    try { spawnSync(schtasks, ['/Delete', '/TN', taskName, '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(cmdPath); } catch { /* ignore */ }
  console.log('[dsh-prompt-enhancer] schtasks unavailable, falling back to detached spawn');
  return spawnExecutorDirect(port, null, logPath);
}


// ============================================================================
// v2.6.0 — harness facade
// ============================================================================

const harness = {
  handle(method, fn) {
    if (typeof method !== 'string' || typeof fn !== 'function') return;
    handlers.set(method, fn);
  },
  // envcheck 仍在 host 内（sys.cjs 共享实现；动态形态无此字段 → UNSUPPORTED）
  probeEnv: (serviceName, executorPort) => sys.probeEnv(serviceName, pure, envForProbe(), executorPort),
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
      const check = validateRpcArgs(method, args || {});
      if (!check.ok) {
        writeJson(response, 400, { ok: false, code: check.code, message: check.message });
        return;
      }
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

// ============================================================================
// v2.7.0 — RPC: update/restartNeeded（更新未重启提醒）
// ============================================================================
// 检测「插件文件已在磁盘更新（dsh plugin add/update 安装新版本），但本服务进程
// 仍在运行旧代码」——模块加载时刻 vs 关键文件 mtime 对比判定；命中则提醒用户
// 重启服务并给出命令（否则安装后页面无感，用户以为更新失败）。
const LOADED_AT = Date.now();
const PLUGIN_DIR = path.join(__dirname, '..');
const RESTART_FILES = ['plugin-host.js', 'plugin-client.js', 'lib/index.cjs', 'lib/client.cjs', 'lib/sys.cjs', 'lib/updater-host.cjs'];

harness.handle('update/restartNeeded', async (args) => {
  try {
    const newer = RESTART_FILES.filter((f) => {
      const p = path.join(PLUGIN_DIR, f);
      return fs.existsSync(p) && fs.statSync(p).mtimeMs > LOADED_AT;
    });
    if (newer.length === 0) return { needed: false, reason: 'none' };
    const svc = args && typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName)
      ? args.serviceName : 'dsh-web';
    return {
      needed: true,
      reason: 'files-newer',
      files: newer,
      command: 'net stop ' + svc + ' && net start ' + svc,
    };
  } catch (e) {
    return { needed: false, reason: 'error' };
  }
});

// ============================================================================
// v2.6.0 — RPC: update/executorEnsure
// ============================================================================

harness.handle('update/executorEnsure', async (args) => {
  const port = args && Number.isInteger(args.port) && args.port > 0 && args.port <= 65535
    ? args.port : sys.EXECUTOR_PORT;
  // v2.9.x（一键更新不重启·修复）：目标版本从磁盘解析而非进程缓存——旧 dsh-web
  // 进程内 EXECUTOR_VERSION 恒定旧值，会与旧执行器恒等匹配、永不升级；磁盘版本
  // 让旧 host 也能 kill 旧执行器并拉起最新版（含 restart:false 支持）
  const targetVersion = readLatestExecutorVersion();
  const ping = await executorCall(port, 'ping');
  if (ping && ping.ok === true) {
    if (ping.version === targetVersion) {
      return { ok: true, port, version: ping.version, pid: ping.pid, spawned: false };
    }
    // 版本落后：kill 旧执行器 → 拉新
    try { process.kill(ping.pid); } catch { /* ignore */ }
    await sleep(500);
  }
  spawnExecutor(port, targetVersion);
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    const p2 = await executorCall(port, 'ping');
    if (p2 && p2.ok === true) {
      return { ok: true, port, version: p2.version, pid: p2.pid, spawned: true };
    }
  }
  // v3.2（动态端口 fallback）：固定端口未起来（被占用 → 执行器自动 listen 0 动态分配）
  // → 读 executor.port 文件发现真实端口并 ping 验证；成功则返回动态端口供 client 使用。
  const pf = sys.readExecutorPortFile();
  if (pf && pf.port !== port) {
    const p3 = await executorCall(pf.port, 'ping');
    if (p3 && p3.ok === true) {
      return { ok: true, port: pf.port, version: p3.version, pid: p3.pid, spawned: true, dynamic: true };
    }
  }
  return { ok: false, code: 'EXECUTOR_START_FAILED', message: 'update executor failed to start on port ' + port };
});

// ============================================================================
// v3.2 — RPC: update/makeShortcut（桌面快捷方式 · 脱离 Web CLI 重启）
// ============================================================================

/**
 * v3.2.1-k（用户确认·管理员快捷方式）：给 .lnk 打「以管理员身份运行」标志——
 * 在 ExtraData 区末尾（TerminalBlock 前）插入 RunAsDataBlock
 * （MS-SHLLINK：BlockSize=0x00000008、BlockSignature=0xA000000A，无附加数据）。
 * 打标后双击快捷方式即触发 UAC 提权，服务模式 sc stop/start 不再被拒。
 */
function markLnkRunAs(lnkPath) {
  try {
    const b = fs.readFileSync(lnkPath);
    const runAs = Buffer.alloc(8);
    runAs.writeUInt32LE(8, 0);          // BlockSize
    runAs.writeUInt32LE(0xA000000A, 4); // BlockSignature = RunAsDataBlock
    let out;
    if (b.length >= 4 && b.readUInt32LE(b.length - 4) === 0) {
      // 末尾 4 字节为 TerminalBlock（全 0）→ 在其前插入
      out = Buffer.concat([b.subarray(0, b.length - 4), runAs, b.subarray(b.length - 4)]);
    } else {
      // 兜底：直接追加（RunAsDataBlock + TerminalBlock）
      out = Buffer.concat([b, runAs, Buffer.alloc(4)]);
    }
    fs.writeFileSync(lnkPath, out);
    return true;
  } catch (e) {
    return false;
  }
}

harness.handle('update/makeShortcut', async (args) => {
    try {
      const svc = args && typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName)
        ? args.serviceName : 'dsh-web';
      const profile = args && typeof args.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(args.profile)
        ? args.profile : 'web';
      // v3.2（用户需求）：快捷方式名跟随当前 UI 语言——client 传 locale（zh/en），
      // 中文「重启DSH」/ 英文「Restart DSH」；旧名（重启DSH服务 / Restart DSH Service）删除避免重复。
      const locale = args && typeof args.locale === 'string' && /^(zh|en)$/.test(args.locale) ? args.locale : 'zh';
      const lnkName = locale === 'en' ? 'Restart DSH.lnk' : '重启DSH.lnk';
      const nodePath = process.execPath;
      // v3.2.1（审查优化·快捷方式独立化）：不再依赖执行器（旧实现调 updater-host --cli
      // restart，执行器不在时快捷方式失效）。改为生成自包含 CLI 重启脚本（restart-dsh.cjs：
      // 读索引 → 杀旧 DSH → 拉起新 DSH → 等待端口恢复），双击即可重启。
      const cliDir = path.join(sys.EXECUTOR_ROOT, 'cli');
      fs.mkdirSync(cliDir, { recursive: true });
      const cliScriptPath = path.join(cliDir, 'restart-dsh.cjs');
      const outLog = path.join(sys.EXECUTOR_ROOT, 'port-restart.out.log');
      const errLog = path.join(sys.EXECUTOR_ROOT, 'port-restart.err.log');
      const cliScript = buildCliRestartScript({ execPath: nodePath, fallbackBin: resolveDshBin(), outLog, errLog, serviceName: svc });
      fs.writeFileSync(cliScriptPath, cliScript, 'utf8');
      // 1. 写 CLI 脚本（.cmd，含 chcp 65001 中文 + pause 窗口不闪退）→ 调 node 跑 restart-dsh.cjs
      const cmdPath = path.join(cliDir, 'restart-dsh.cmd');
      const esc = (p) => '"' + String(p).replace(/"/g, '\\"') + '"';
      const cmdBody = '@echo off\r\n' +
        'chcp 65001 >nul\r\n' +
        'title DSH 端口重启\r\n' +
        'echo.\r\n' +
        'echo === DSH 端口重启（CLI）===\r\n' +
        'echo.\r\n' +
        esc(nodePath) + ' ' + esc(cliScriptPath) + '\r\n' +
        'echo.\r\n' +
        'pause\r\n';
      fs.writeFileSync(cmdPath, cmdBody, 'utf8');
      // 2. 创建桌面快捷方式（USERPROFILE 由 nssm 设为 C:\Users\lk → 桌面路径正确）。
      //    v3.2（用户需求）：图标 DeepSeek 蓝色鲸鱼——插件包 assets/deepseek.ico 复制到
      //    EXECUTOR_ROOT/icons/ → .lnk IconLocation（复制失败则默认 cmd 图标，不阻断）。
      //    Node 直接生成 .lnk（buildLnk）——WScript.Shell 在 SYSTEM 会话不写 IconLocation。
      // 桌面：v3.2 结论——SYSTEM 会话 WScript.Shell CreateShortcut 写任何桌面路径都落
      // session 0 隔离位置（实测用户/Public 桌面均 SHORTCUT_MISSING）。唯一可靠方案：
      // Node 直接 fs 写 .lnk（buildLnk）到用户桌面——真实落盘 + IconLocation 可写。
      const desktop = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop');
      // 按语言命名 + 删除旧名（重启DSH服务 / Restart DSH Service）避免重复
      const lnkPath = path.join(desktop, lnkName);
      try { if (fs.existsSync(path.join(desktop, '重启DSH服务.lnk'))) fs.unlinkSync(path.join(desktop, '重启DSH服务.lnk')); } catch { /* ignore */ }
      try { if (fs.existsSync(path.join(desktop, 'Restart DSH Service.lnk'))) fs.unlinkSync(path.join(desktop, 'Restart DSH Service.lnk')); } catch { /* ignore */ }
      // 2026-08-18（用户反馈桌面乱码残留·Shell 锁住脚本删不动的兜底）：旧版 WScript 写过的
      // 「閱嶅惎DSH.lnk」是文件名异体字（GBK→UTF-16 错误转换残留），Shell 锁住时 Node unlink
      // 会 EPERM——try/catch 静默，让用户在桌面手动删；下次 Shell 释放锁后即可清理。
      // 同样 .lnk.tmp 是覆盖重试时的残留。
      try { if (fs.existsSync(path.join(desktop, '閱嶅惎DSH.lnk'))) fs.unlinkSync(path.join(desktop, '閱嶅惎DSH.lnk')); } catch { /* EPERM if Shell locked, ignore */ }
      try { if (fs.existsSync(path.join(desktop, '重启DSH.lnk.tmp'))) fs.unlinkSync(path.join(desktop, '重启DSH.lnk.tmp')); } catch { /* ignore */ }
      try { if (fs.existsSync(path.join(desktop, 'Restart DSH.lnk.tmp'))) fs.unlinkSync(path.join(desktop, 'Restart DSH.lnk.tmp')); } catch { /* ignore */ }
      try { if (fs.existsSync(path.join(desktop, 'Restart DSH Service.lnk.tmp'))) fs.unlinkSync(path.join(desktop, 'Restart DSH Service.lnk.tmp')); } catch { /* ignore */ }
      const cmdExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
      let iconPath = '';
      try {
        // 2026-08-18（用户需求·图标直接保存在项目里）：内嵌 base64（lib/shortcut-icon.cjs，
        // 由 build-icon.cjs 生成）→ 直接写 executor/icons/deepseek.ico，不依赖 plugin assets 拷贝链路。
        const iconDir = path.join(sys.EXECUTOR_ROOT, 'icons');
        fs.mkdirSync(iconDir, { recursive: true });
        iconPath = path.join(iconDir, 'deepseek.ico');
        const iconBuf = require('./shortcut-icon.cjs').shortcutIconBuffer();
        fs.writeFileSync(iconPath, iconBuf);
      } catch { /* 图标写入失败 → 不设图标（默认 cmd 图标） */ }
      // v3.2.2（2026-08-18 收敛·最可靠跨平台方案）：cscript + WScript.Shell 生成完整 .lnk
      // （含 LinkTargetIDList）。结论：Node 手写 buildLnk 缺 IDList → Shell 显示白纸；
      // WScript.Shell（pywin32/cscript 等价）生成完整 .lnk + IconLocation 直接写对 → 显示鲸鱼。
      // cscript 是 Windows 自带（无 Python/pywin32 依赖）；Linux/macOS 由 shortcut-posix 分支处理。
      const { makeShortcutWin } = require('./shortcut-win.cjs');
      const lnkArgs = '/c "' + cmdPath + '"';
      const userProfile = process.env.USERPROFILE || process.env.HOME || '';
      const iconPathEnv = iconPath.includes(userProfile) ? iconPath.replace(userProfile, '%USERPROFILE%') : iconPath;
      const winResult = makeShortcutWin({
        lnkPath,
        target: cmdExe,
        args: lnkArgs,
        workingDir: userProfile,
        iconPath,
        iconPathEnv,
      });
      if (!winResult.ok) {
        return { ok: false, code: winResult.code || 'SHORTCUT_FAIL', message: winResult.message || 'shortcut creation failed' };
      }
      if (!fs.existsSync(lnkPath)) {
        return { ok: false, code: 'SHORTCUT_MISSING', message: 'shortcut not created: ' + lnkPath };
      }
      // v3.2.1-k（用户确认·管理员快捷方式）：给 .lnk 打 RunAs 标志——双击即以管理员身份运行（弹 UAC），
      // 服务模式 sc stop/start 不再因权限被拒。打标失败不阻断（降级为右键管理员运行）。
      const runAsApplied = markLnkRunAs(lnkPath);
      // 读回 .lnk 验证：图标字符串是否写入（ANSI 或 UTF-16LE 任一命中即可）
      let iconApplied = false;
      let lnkSize = 0;
      try {
        const b = fs.readFileSync(lnkPath);
        iconApplied = iconPath !== '' && (b.toString('latin1').includes('deepseek.ico') || b.indexOf(Buffer.from('deepseek.ico', 'utf16le')) !== -1);
        lnkSize = b.length;
      } catch { /* 读回失败不阻断 */ }
      return { ok: true, shortcutPath: lnkPath, cmdPath, iconApplied, lnkSize, method: 'cscript', runAsApplied };
    } catch (e) {
      return { ok: false, code: 'SHORTCUT_EXCEPTION', message: String(e && e.message ? e.message : e) };
    }
  });

// ============================================================================
// v3.2.1 — RPC: update/serviceInstall（引导式 nssm 服务化 · 一次 UAC 提权）
// ============================================================================
// 无系统服务（无 nssm）时，端口重启前弹窗询问是否一键服务化：本 RPC 负责——
// ① 定位 nssm（PATH → EXECUTOR_ROOT/tools/nssm.exe → 官方 zip 下载解压）
// ② 生成 PowerShell 安装脚本（nssm install <svc> node bin.js web + AppDirectory/
//    AppStdout/AppStderr/Start AUTO_START + nssm start）
// ③ Start-Process -Verb RunAs 提权执行（弹一次 UAC，用户确认后以管理员装服务）
// 装好后 DSH 走服务路径（sc 重启），watchdog 自动让位（detectService 命中即停）。
const NSSM_VERSION = '2.24';
const NSSM_URL = 'https://nssm.cc/release/nssm-' + NSSM_VERSION + '.zip';
function nssmToolsDir() {
  return path.join(sys.EXECUTOR_ROOT, 'tools');
}
function findNssm() {
  try {
    const w = spawnSync('where', ['nssm'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (w.status === 0 && w.stdout) {
      const first = String(w.stdout).split(/\r?\n/).map((s) => s.trim()).find((s) => s !== '' && fs.existsSync(s));
      if (first) return first;
    }
  } catch { /* fallthrough */ }
  const bundled = path.join(nssmToolsDir(), 'nssm.exe');
  return fs.existsSync(bundled) ? bundled : null;
}
function downloadNssm() {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(nssmToolsDir(), { recursive: true });
      const zipPath = path.join(nssmToolsDir(), 'nssm-' + NSSM_VERSION + '.zip');
      const dl = spawnSync('curl', ['-L', '--fail', '-sS', '-o', zipPath, NSSM_URL], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
      if (dl.status !== 0 || !fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
        return resolve({ ok: false, message: 'nssm 下载失败（' + NSSM_URL + '）：' + String(dl.stderr || dl.stdout || '').trim().slice(0, 200) });
      }
      const unzipDir = path.join(nssmToolsDir(), 'nssm-' + NSSM_VERSION);
      fs.mkdirSync(unzipDir, { recursive: true });
      const ex = spawnSync('tar', ['-xf', zipPath, '-C', unzipDir], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
      if (ex.status !== 0) {
        // tar 不支持 zip 的旧系统 → PowerShell Expand-Archive
        const ps = spawnSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath \'' + zipPath + '\' -DestinationPath \'' + unzipDir + '\' -Force'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
        if (ps.status !== 0) return resolve({ ok: false, message: 'nssm 解压失败：' + String(ps.stderr || ps.stdout || '').trim().slice(0, 200) });
      }
      const candidates = [
        path.join(unzipDir, 'nssm-' + NSSM_VERSION, 'win64', 'nssm.exe'),
        path.join(unzipDir, 'win64', 'nssm.exe'),
      ];
      const hit = candidates.find((p) => fs.existsSync(p));
      if (!hit) return resolve({ ok: false, message: '解压后未找到 win64/nssm.exe（检查 ' + unzipDir + '）' });
      const dst = path.join(nssmToolsDir(), 'nssm.exe');
      fs.copyFileSync(hit, dst);
      try { fs.rmSync(unzipDir, { recursive: true, force: true }); } catch { /* ignore */ }
      return resolve({ ok: true, path: dst });
    } catch (e) {
      return resolve({ ok: false, message: String(e && e.message || e) });
    }
  });
}
/** 解析服务化的稳定 dsh bin.js：优先全局安装（dsh-install，路径稳定），回退当前进程 argv[1]
 *（npx 缓存路径含日期目录，可能被清理——服务一旦注册就不能指向会被清掉的路径）。 */
function resolveDshBin() {
  const argv1 = process.argv[1] || '';
  const candidates = [];
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'dsh-install', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  }
  candidates.push(argv1);
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return argv1;
}
function buildNssmInstallScript(nssmPath, serviceName) {
  const nodeExe = process.execPath;
  const dshBin = resolveDshBin();
  const appDir = path.dirname(dshBin);
  const outLog = path.join(sys.EXECUTOR_ROOT, 'dsh-web.out.log');
  const errLog = path.join(sys.EXECUTOR_ROOT, 'dsh-web.err.log');
  const q = (s) => '\'' + String(s).replace(/'/g, "''") + '\'';
  const userHome = process.env.USERPROFILE || process.env.HOME || 'C:////Users////Public';
  const userAppData = process.env.APPDATA || (userHome + '\\AppData\\Roaming');
  const userLocal = process.env.LOCALAPPDATA || (userHome + '\\AppData\\Local');
  const userTemp = process.env.TEMP || (userHome + '\\AppData\\Local\\Temp');
  return [
    '$ErrorActionPreference = \'Stop\'',
    '$nssm = ' + q(nssmPath),
    'if (-not (Test-Path $nssm)) { throw \'nssm not found: \' + $nssm }',
    '& $nssm install ' + serviceName + ' ' + q(nodeExe) + ' ' + q(dshBin) + ' web',
    'if ($LASTEXITCODE -ne 0) { throw \'nssm install failed: \' + $LASTEXITCODE }',
    '& $nssm set ' + serviceName + ' AppDirectory ' + q(appDir),
    '& $nssm set ' + serviceName + ' AppStdout ' + q(outLog),
    '& $nssm set ' + serviceName + ' AppStderr ' + q(errLog),
    // 2026-08-19（实测关键修复）：nssm 服务默认 LocalSystem 运行，HOME/USERPROFILE 是 SYSTEM 的 → DSH_HOME 解析到 SYSTEM 的 .dsh（插件/配置全空、host 半部不加载）。必须注入当前用户环境变量。
    '& $nssm set ' + serviceName + ' AppEnvironmentExtra "HOME=' + userHome + '" "USERPROFILE=' + userHome + '" "APPDATA=' + userAppData + '" "LOCALAPPDATA=' + userLocal + '" "TEMP=' + userTemp + '" "TMP=' + userTemp + '"',
    '& $nssm set ' + serviceName + ' Start SERVICE_AUTO_START',
    '& $nssm set ' + serviceName + ' AppExit Default Restart',
    // v3.2.1-g（用户最新指令·简化接管）：安装脚本**不立即启动服务**——避免与当前前台 DSH
    // 抢 3080（EADDRINUSE）。改为 AUTO_START + 提示用户「重启电脑/注销」接管：重启后 nssm
    // 自动以系统服务拉起并独占总端口。安装即返回，接管交给系统重启流程，不在端口重启里强接。
    'Write-Output \'SERVICE_INSTALLED\'',
  ].join('\r\n');
}
function runElevated(script) {
  const scriptPath = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'dsh-nssm-install-' + Date.now() + '.ps1');
  fs.writeFileSync(scriptPath, '\ufeff' + script, 'utf16le');
  const r = spawnSync('powershell', [
    '-NoProfile', '-Command',
    'Start-Process powershell -Verb RunAs -Wait -ArgumentList \'-NoProfile\',\'-ExecutionPolicy\',\'Bypass\',\'-File\',\'' + scriptPath + '\'',
  ], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  return r;
}
harness.handle('update/serviceInstall', async (args) => {
  try {
    const serviceName = args && typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName) ? args.serviceName : 'dsh-web';
    // 已服务化 → 直接返回（幂等）
    const backend = platformService.backendFor(process.platform);
    if (backend && backend.detectService(serviceName, envForProbe()).exists) {
      return { ok: true, already: true, message: '服务 ' + serviceName + ' 已存在' };
    }
    let nssm = findNssm();
    if (!nssm) {
      const dl = await downloadNssm();
      if (!dl.ok) return { ok: false, code: 'NSSM_DOWNLOAD_FAIL', message: dl.message };
      nssm = dl.path;
    }
    const script = buildNssmInstallScript(nssm, serviceName);
    const r = runElevated(script);
    const out = String(r.stdout || '') + String(r.stderr || '');
    const exists = backend && backend.detectService(serviceName, envForProbe()).exists;
    if (!exists) {
      const cancelled = /0x[0-9A-Fa-f]+/.test(out) && /cancel/i.test(out);
      return { ok: false, code: cancelled ? 'UAC_CANCELLED' : 'SERVICE_INSTALL_FAILED', message: '服务化未完成：' + out.trim().slice(0, 300) || 'UAC 取消或安装失败' };
    }
    return { ok: true, message: '服务 ' + serviceName + ' 已安装（nssm ' + NSSM_VERSION + '）。请重启电脑，让 nssm 以系统服务接管服务。' };
  } catch (e) {
    return { ok: false, code: 'SERVICE_INSTALL_EXCEPTION', message: String(e && e.message ? e.message : e) };
  }
});

// ============================================================================
// v3.2.1 — RPC: update/portRestart（端口重启·独立化）
// ============================================================================
// 用户实测反馈：端口重启走「执行器拉起链」（executorEnsure → cpSync → schtasks 三级
// 降级 → EBUSY/SID/冷启动时序）过于脆弱，多次在重启电脑后首次点端口重启时误报
// 「更新执行器未能启动」。方向调整为**端口重启自包含**：
//   - 不依赖执行器进程（updater-host）
//   - 不依赖 schtasks / 当前用户任务 / cpSync 复制链
//   - host 读进程索引（$DSH_HOME/dsh-prompt-enhancer.json，host 加载时自己写的）→
//     生成一个自包含 **node 辅助脚本（.cjs）**（杀旧 DSH + 用原启动参数 detached 拉起
//     新 DSH）→ detached spawn 脚本（独立于 DSH 进程，DSH 被杀后脚本继续执行）。
// v3.2.1-b（用户实测·无窗口优化）：脚本由 .cmd 改为 .cjs（node 直接执行）——
//   旧 .cmd 方案 host 用 windowsHide 启动 cmd 外壳，但脚本内 `start /B` 启动的
//   node（console 程序）没有可复用的控制台 → Windows 给它新建控制台窗口（黑窗），
//   且 DSH 常驻导致黑窗残留。node 辅助脚本全程 spawnSync/spawn 带 windowsHide:true
//   （CREATE_NO_WINDOW），杀旧起新全程无窗口。零插件模块依赖（仅 node 内置）。
// v3.2.1-g（用户最新指令·端口重启加判断能力）：handler 先判断「当前谁在托管端口」——
//   · nssm 服务接管态（服务 EXISTS 且 RUNNING）→ 走服务重启 scheduleServiceRestart：
//     用 Task Scheduler 注册一次性 `sc start`（在 nssm Job 树之外）→ 再 `sc stop` 当前服务，
//     彻底规避「sc stop 树杀辅助脚本导致 sc start 来不及」的死穴。不依赖 nssm 自检（AppExit）。
//   · 默认态（前台 DSH 托管 / 服务未运行）→ 走下方独立 detached 脚本（杀旧前台 + 拉起新前台）。
// 不在端口重启里做「强制接管」——安装后由系统重启/注销接管（见 update/serviceInstall）。
function buildPortRestartScript({ execPath, argv, cwd, oldPid, outLog, errLog }) {
  const J = (v) => JSON.stringify(v);
  return [
    '// dsh-prompt-enhancer 独立端口重启（v3.2.1-l：杀实际监听者 + 新 PID 防误报）',
    "const { spawnSync, spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    'const oldPid = ' + Number(oldPid) + ';',
    'const execPath = ' + J(execPath) + ';',
    'const argv = ' + J(Array.isArray(argv) && argv.length ? argv : ['web']) + ';',
    'const cwd = ' + J(cwd || 'C:\\\\') + ';',
    'const outLog = ' + J(outLog) + ';',
    'const errLog = ' + J(errLog) + ';',
    '// 3080 实际监听者（netstat 查）——索引 pid 可能滞后/指向死进程（host 崩溃前覆盖索引），杀实际监听者最可靠',
    'const holderPid = () => {',
    "  const nr = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
    "  const nm = String(nr.stdout || '').match(/:3080\\s+\\S+\\s+LISTENING\\s+(\\d+)/);",
    '  return nm ? Number(nm[1]) : 0;',
    '};',
    '// 等 host 返回（脚本由 DSH 内 host detached spawn，杀 DSH 前先让 RPC 响应返回）',
    'setTimeout(() => {',
    '  // v3.2.1-l（实测·索引兜底）：taskkill 目标 = 3080 实际监听者（索引 oldPid 仅兜底）；',
    '  // **不带 /T**——本脚本仍在 DSH 子进程树上，/T 递归杀树会连带杀掉脚本（新 DSH 起不来）。',
    '  const killTarget = holderPid() || oldPid;',
    "  console.log('杀旧进程 ' + killTarget + '（索引 ' + oldPid + '）...');",
    "  try { spawnSync('taskkill', ['/F', '/PID', String(killTarget)], { windowsHide: true, stdio: 'ignore' }); } catch (e) {}",
    '  setTimeout(() => {',
    '    try {',
    "      const out = fs.openSync(outLog, 'a');",
    "      const err = fs.openSync(errLog, 'a');",
    "      const child = spawn(execPath, argv, { cwd, detached: true, stdio: ['ignore', out, err], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } });",
    '      child.unref();',
    '      // v3.2.1-l（防误报）：成功 = 3080 由**新进程**接管（≠ 被杀进程）；旧进程仍监听不算成功',
    '      const poll = (n) => {',
    '        const h = holderPid();',
    '        const fresh = h > 0 && h !== killTarget;',
    "        if (fresh) { try { fs.unlinkSync(__filename); } catch (e) {} console.log('✓ DSH 已恢复：http://127.0.0.1:3080（新进程 ' + h + '）'); process.exit(0); }",
    "        if (h === killTarget) console.log('  （3080 仍由旧进程 ' + h + ' 监听，未杀成功）');",
    "        if (n >= 40) { try { fs.unlinkSync(__filename); } catch (e) {} console.log('✗ 等待超时：3080 未由新进程接管，请检查 ' + errLog); process.exit(1); }",
    '        setTimeout(() => poll(n + 1), 1000);',
    '      };',
    '      poll(0);',
    "      setTimeout(() => { try { fs.closeSync(out); } catch (e) {} try { fs.closeSync(err); } catch (e) {} }, 5000);",
    '    } catch (e) { try { fs.unlinkSync(__filename); } catch (err) {} console.log(\'✗ 启动失败: \' + (e && e.message ? e.message : e)); process.exit(1); }',
    '  }, 1000);',
    '}, 1000);',
    '// v3.2.1-k（清理残留·兜底）：其余退出路径 6s 后自删（成功/超时路径已在 poll 内自删）',
    "setTimeout(() => { try { fs.unlinkSync(__filename); } catch (e) {} }, 6000);",
  ].join('\n');
}

/**
 * v3.2.1（审查优化·桌面快捷方式独立化）：生成自包含 CLI 端口重启脚本（.cjs）。
 * 双击桌面「重启DSH」→ cmd 调 node 跑本脚本：读进程索引 → 杀旧 DSH（taskkill 不带 /T，
 * 防递归杀树连带自己）→ 拉起新 DSH（windowsHide）→ 轮询 3080 恢复 → 打印结果。
 * **不依赖执行器**（旧实现调 updater-host --cli restart，执行器不在时快捷方式失效）。
 *
 * v3.2.1-j（用户明确规则·判断修正）：脚本开头 `sc query` 判断**服务是否存在**——
 *   · **有 nssm 服务**（RUNNING 或 Stopped）→ 服务模式：RUNNING → `sc stop` → 等 STOPPED →
 *     `releasePort`（清理 3080 前台残留）→ **显式 `sc start`** → 等 3080 恢复；
 *     Stopped → 直接 `releasePort`（杀前台占用者，让服务接管）→ `sc start`。
 *     CLI 脚本由用户双击 cmd 运行（交互会话），**不在 nssm 的 Job 树内**，
 *     sc stop 树杀不会波及本脚本，可顺序执行完整重启。
 *   · **无 nssm 服务** → 默认前台模式（原逻辑：杀旧前台 + 拉起新前台）——仅作兜底备用。
 * 杜绝「服务已存在时快捷方式却拉前台 DSH」与「服务接管 3080 时再拉前台抢端口」两类问题。
 */
function buildCliRestartScript({ execPath, fallbackBin, outLog, errLog, serviceName }) {
  const J = (v) => JSON.stringify(v);
  return [
    '// dsh-prompt-enhancer 独立 CLI 端口重启（v3.2.1-m：全模式权限拦截 + 服务/默认双模式）',
    "const { spawnSync, spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');",
    "const idxPath = path.join(home, 'dsh-prompt-enhancer.json');",
    'const execPath = ' + J(execPath) + ';',
    'const fallbackBin = ' + J(fallbackBin || '') + ';',
    'const outLog = ' + J(outLog) + ';',
    'const errLog = ' + J(errLog) + ';',
    'const serviceName = ' + J(serviceName) + ';',
    "console.log('=== DSH 端口重启（CLI）===');",
    '// v3.2.1-m（用户指令·全模式权限拦截）：无论服务/默认模式，非管理员一律拦截——',
    '// 服务模式 sc 操作需要管理员；默认模式 taskkill 也可能命中管理员令牌 DSH',
    '// （管理员快捷方式拉起的 DSH 是管理员进程，普通权限杀不掉）。',
    'let isAdmin = false;',
    "try { isAdmin = spawnSync('net', ['session'], { windowsHide: true, stdio: 'ignore' }).status === 0; } catch (e) { isAdmin = false; }",
    'if (!isAdmin) {',
    "  console.log('✗ 执行失败：本快捷方式需要管理员权限，请以管理员身份运行（右键 → 以管理员身份运行）');",
    '  process.exit(1);',
    '}',
    // 服务存在判断（v3.2.1-j 用户规则）：sc query 有 STATE 行 = 服务存在 → 服务模式；
    // 默认前台模式仅作兜底（服务不存在时）。
    "const scq = spawnSync('sc', ['query', serviceName], { encoding: 'utf8', windowsHide: true });",
    "const scOut = String(scq.stdout || '') + String(scq.stderr || '');",
    'const svcExists = /STATE\\s*:\\s*\\d+\\s+\\S+/.test(scOut);',
    'if (svcExists) {',
    "  console.log('检测到 nssm 服务 ' + serviceName + '，以服务方式重启 ...');",
    '  const svcRunning = /STATE\\s*:\\s*\\d+\\s+(RUNNING|正在运行)/.test(scOut);',
    '  const portHolder = () => {',
    "    const nr = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
    "    const nm = String(nr.stdout || '').match(/:3080\\s+\\S+\\s+LISTENING\\s+(\\d+)/);",
    '    return nm ? Number(nm[1]) : 0;',
    '  };',
    '  const beforePid = portHolder(); // v3.2.1-k 防误报：成功判定必须换新进程接管',
    '  const startSvc = () => {',
    "    console.log('显式拉起服务 sc start ' + serviceName + ' ...');",
    "    const r = spawnSync('sc', ['start', serviceName], { encoding: 'utf8', windowsHide: true });",
    "    if (r.status !== 0) console.log('⚠ sc start 返回 ' + r.status + '（非 0 = 未成功拉起，5 表示拒绝访问）');",
    '    const poll = (n) => {',
    '      const h = portHolder();',
    '      const fresh = h > 0 && h !== beforePid; // 新进程接管才算真正重启成功',
    "      if (fresh) { console.log('✓ DSH 服务已恢复：http://127.0.0.1:3080（新进程 ' + h + '）'); setTimeout(() => process.exit(0), 500); return; }",
    "      if (h > 0 && h === beforePid) console.log('  （3080 仍由旧进程 ' + h + ' 监听，服务尚未重启）');",
    "      if (n >= 40) { console.log('✗ 服务重启超时：3080 未由新进程接管'); process.exit(1); }",
    '      setTimeout(() => poll(n + 1), 1000);',
    '    };',
    '    poll(0);',
    '  };',
    '  // 释放 3080：若被前台 DSH 占（服务存在未运行场景），单 PID 杀；再等端口释放后 sc start',
    '  const releasePort = () => {',
    '    const h = portHolder();',
    "    if (h) { console.log('端口被进程 ' + h + ' 占用，单 PID 杀'); spawnSync('taskkill', ['/F', '/PID', String(h)], { windowsHide: true, stdio: 'ignore' }); }",
    '    let fw = 0;',
    '    const waitFree = () => {',
    "      if (portHolder() === 0 || fw >= 10) { startSvc(); return; }",
    '      fw++; setTimeout(waitFree, 1000);',
    '    };',
    '    waitFree();',
    '  };',
    '  if (svcRunning) {',
    "    spawnSync('sc', ['stop', serviceName], { windowsHide: true, stdio: 'ignore' });",
    '    let sw = 0;',
    '    const waitStopped = () => {',
    "      const q = spawnSync('sc', ['query', serviceName], { encoding: 'utf8', windowsHide: true });",
    "      const st = /STATE\\s*:\\s*\\d+\\s+(\\S+)/.exec(String(q.stdout || ''));",
    "      if ((st && st[1] === 'STOPPED') || sw >= 15) { releasePort(); return; }",
    '      sw++; setTimeout(waitStopped, 1000);',
    '    };',
    '    waitStopped();',
    '  } else {',
    '    releasePort();',
    '  }',
    '} else {',
    "  if (!fs.existsSync(idxPath)) { console.log('✗ 无进程索引，无法自动重启'); process.exit(1); }",
    '  let idx = {};',
    "  try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch (e) { console.log('✗ 索引读取失败'); process.exit(1); }",
    '  const oldPid = (idx.pid && Number.isInteger(idx.pid)) ? idx.pid : 0;',
    "  let argv = Array.isArray(idx.argv) && idx.argv.length ? idx.argv : null;",
    "  if (!argv || !fs.existsSync(String(argv[0]))) argv = fallbackBin ? [fallbackBin, 'web'] : ['web'];",
    '  const cwd = idx.cwd || process.cwd();',
    '  // v3.2.1-l（实测·索引兜底+防误报）：taskkill 目标 = 3080 实际监听者（索引仅兜底）——',
    '  // 索引滞后/指向死进程时仍能杀对；poll 成功条件 = 新进程接管（≠ 被杀进程）。',
    '  const holderPid = () => {',
    "    const nr = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
    "    const nm = String(nr.stdout || '').match(/:3080\\s+\\S+\\s+LISTENING\\s+(\\d+)/);",
    '    return nm ? Number(nm[1]) : 0;',
    '  };',
    '  const killTarget = holderPid() || oldPid;',
    "  console.log('杀旧进程 ' + killTarget + '（索引 ' + oldPid + '）...');",
    "  spawnSync('taskkill', ['/F', '/PID', String(killTarget)], { windowsHide: true, stdio: 'ignore' });",
    '  setTimeout(() => {',
    '    try {',
    "      console.log('启动新 DSH ...');",
    "      const out = fs.openSync(outLog, 'a');",
    "      const err = fs.openSync(errLog, 'a');",
    "      const child = spawn(execPath, argv, { cwd, detached: true, stdio: ['ignore', out, err], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } });",
    '      child.unref();',
    "      console.log('已触发，等待端口恢复（约 10-15 秒）...');",
    '      const poll = (n) => {',
    '        const h = holderPid();',
    '        const fresh = h > 0 && h !== killTarget;',
    "        if (fresh) { console.log('✓ DSH 已恢复：http://127.0.0.1:3080（新进程 ' + h + '）'); setTimeout(() => process.exit(0), 500); return; }",
    "        if (h === killTarget) console.log('  （3080 仍由旧进程 ' + h + ' 监听，未杀成功）');",
    "        if (n >= 30) { console.log('✗ 等待超时：3080 未由新进程接管，请检查 ' + errLog); process.exit(1); }",
    '        setTimeout(() => poll(n + 1), 1000);',
    '      };',
    '      poll(0);',
    "    } catch (e) { console.log('✗ 启动失败: ' + e.message); process.exit(1); }",
    '  }, 1000);',
    '}',
  ].join('\n');
}

// v3.2.1-j（用户明确规则·修复 schtasks 错过触发）：nssm 服务的端口重启。
// 难点（同 v3.2.1-g）：DSH 以 nssm 服务运行时，本进程（host）是 nssm 的子进程、处于 nssm
// 的 Job 树内——若在本进程内直接 `sc stop`，nssm 树杀整个 Job（含本进程）→ 后续 `sc start`
// 来不及执行。v3.2.1-g 用「一次性时间点任务」注册 sc start，**实测任务错过触发**
// （LastTaskResult=267011、NEXT_RUN 空）→ sc start 永不执行 → 服务挂死、3080 空。
// 修复：创建任务后**立即 `schtasks /run` 手动触发**（不依赖时间点调度，任务进程在 session 0
// 以 SYSTEM 运行、完全在 nssm Job 树之外），任务命令内先 `timeout 8s`（等 sc stop 生效 +
// 端口释放）再**显式 sc start** 拉起全新 node，执行后自删。
// 服务 Stopped（存在未运行）场景：sc stop 无效 → 本进程 2s 后检测 3080 若仍被前台 DSH 占
// （端口重启语义=让服务接管），单 PID 杀掉 → 任务 8s 后 sc start 成功绑端口。
function scheduleServiceRestart(serviceName) {
  const taskName = 'DSHPortRestart';
  // 任务命令：延迟 8s → sc start 服务 → 自删任务（& 顺序执行，sc start 失败也走自删）
  const tr = 'cmd /c "timeout /t 8 /nobreak >nul & sc start ' + serviceName + ' & schtasks /delete /tn ' + taskName + ' /f"';
  // 时间仅占位（创建后立即 /run 触发，不依赖时间点；万一 /run 失败，2 分钟后任务仍会触发兜底）
  const when = schtasksOnceTime(120);
  const create = spawnSync('schtasks', ['/create', '/tn', taskName, '/tr', tr, '/sc', 'once', '/st', when, '/ru', 'SYSTEM', '/f'], { windowsHide: true, timeout: 15000 });
  if (create.status !== 0) {
    // 降级：无管理员/无 schtasks → 仅 sc stop（RUNNING 时树杀自身，需用户手动在服务管理器启动）
    spawnSync('sc', ['stop', serviceName], { windowsHide: true, timeout: 15000 });
    return;
  }
  // 立即触发任务（独立进程运行，host 树杀不影响）
  spawnSync('schtasks', ['/run', '/tn', taskName], { windowsHide: true, timeout: 15000 });
  // 停掉当前服务（RUNNING 时）——nssm 树杀只影响自身与服务 node，任务进程不受影响
  spawnSync('sc', ['stop', serviceName], { windowsHide: true, timeout: 15000 });
  // 兜底：服务已停但 3080 仍被前台 DSH 占（服务存在未运行场景）→ 2s 后单 PID 杀，让 8s 后 sc start 绑上端口
  setTimeout(() => {
    const h = portHolder();
    if (h > 0) {
      try { spawnSync('taskkill', ['/F', '/PID', String(h)], { windowsHide: true, timeout: 10000 }); } catch (e) { /* 忽略 */ }
    }
  }, 2000);
}
/** 查 3080 当前监听者 pid（无则 0）——netstat 按端口找真正占用者（索引 pid 可能过期）。 */
function portHolder() {
  try {
    const net = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    const m = String(net.stdout || '').match(/:3080\s+\S+\s+LISTENING\s+(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch (e) { return 0; }
}
/** 计算 schtasks /st 用的一次性触发时刻（HH:MM:SS，当前 + sec 秒，留足余量避免「计划在过去」报错）。 */
function schtasksOnceTime(sec) {
  const d = new Date(Date.now() + sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

harness.handle('update/portRestart', async (args) => {
  try {
    const serviceName = args && typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName) ? args.serviceName : 'dsh-web';
    // 读进程索引（host 模块加载时写：pid/execPath/cwd/argv）
    const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    const idxPath = path.join(dshHome, 'dsh-prompt-enhancer.json');
    if (!fs.existsSync(idxPath)) {
      return { ok: false, code: 'NO_INDEX', message: '无进程索引（' + idxPath + '），无法自动重启' };
    }
    let idx = {};
    try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch { idx = {}; }
    const execPath = (idx.execPath && fs.existsSync(idx.execPath)) ? idx.execPath : process.execPath;
    const oldPid = (idx.pid && Number.isInteger(idx.pid)) ? idx.pid : process.pid;
    // v3.2.1（审查加固·解耦 npx 缓存依赖）：索引 argv 可能含 npx 缓存路径（含日期目录，
    // 清理后 portRestart 拉起会失败）——argv 缺失或 bin 文件不存在时，兜底用全局 dsh
    // bin（dsh-install 稳定路径，resolveDshBin 优先全局）或纯 'web'
    let launchArgv = Array.isArray(idx.argv) && idx.argv.length ? idx.argv : null;
    if (!launchArgv || !fs.existsSync(String(launchArgv[0]))) {
      const globalBin = resolveDshBin();
      launchArgv = globalBin ? [globalBin, 'web'] : ['web'];
    }
    // v3.2.1-j（用户明确规则·判断修正）：按「服务是否存在」决定重启方式——
    //   · **有 nssm 服务**（无论 RUNNING 还是 Stopped）→ 走服务模式（scheduleServiceRestart：
    //     Task Scheduler 创建后立即 /run 触发 sc start（脱离 nssm Job 树）+ sc stop 当前服务；
    //     Stopped 场景自动清理 3080 前台占用后拉起服务）
    //   · **无 nssm 服务** → 默认前台模式（独立 detached 脚本：杀旧前台 + 拉起新前台）——仅兜底
    // 默认前台方式只作兜底备用（用户指令）。
    const backend = platformService.backendFor(process.platform);
    const svcInfo = backend ? backend.detectService(serviceName, envForProbe()) : { exists: false };
    const serviceExists = !!(svcInfo && svcInfo.exists);

    if (serviceExists) {
      // 服务模式：调度 sc start（Task Scheduler 立即触发）+ sc stop 当前服务
      scheduleServiceRestart(serviceName);
      return {
        ok: true,
        message: '端口重启已触发（服务模式·nssm 存在，重启服务 ' + serviceName + '）',
        serviceMode: true,
      };
    }

    // 默认模式：独立 detached 脚本（杀旧前台 DSH + 用原参数拉起新前台 DSH）
    const cliDir = path.join(sys.EXECUTOR_ROOT, 'cli');
    fs.mkdirSync(cliDir, { recursive: true });
    const scriptPath = path.join(cliDir, 'port-restart-' + Date.now() + '.cjs');
    const outLog = path.join(sys.EXECUTOR_ROOT, 'port-restart.out.log');
    const errLog = path.join(sys.EXECUTOR_ROOT, 'port-restart.err.log');
    const script = buildPortRestartScript({ execPath, argv: launchArgv, cwd: idx.cwd, oldPid, outLog, errLog });
    fs.writeFileSync(scriptPath, script, 'utf8');
    // detached 启动 node 辅助脚本（windowsHide=CREATE_NO_WINDOW，全程无窗口）：
    // 脚本仅单 PID 杀旧 DSH 主进程（不树杀），DSH 被杀后脚本继续拉起新前台 DSH
    launchRestartScript(scriptPath);
    return {
      ok: true,
      message: '端口重启已触发（默认模式·独立脚本 ' + path.basename(scriptPath) + '）',
      scriptPath,
      serviceMode: false,
    };
  } catch (e) {
    return { ok: false, code: 'PORT_RESTART_EXCEPTION', message: String(e && e.message ? e.message : e) };
  }
});

/**
 * 启动端口重启辅助脚本（.cjs，默认/前台模式）。
 * detached spawn（windowsHide=CREATE_NO_WINDOW，全程无黑窗）：脚本处于新建进程组，
 * 仅单 PID 杀旧 DSH 主进程（不树杀），脚本在 DSH 被杀后继续拉起新前台 DSH。
 * 服务模式不走此函数（见 scheduleServiceRestart，用 Task Scheduler 脱离 nssm Job 树）。
 */
function launchRestartScript(scriptPath) {
  const child = spawn(process.execPath, [scriptPath], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
}

module.exports = {
  name: 'dsh-prompt-enhancer',  ...plugin,
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
