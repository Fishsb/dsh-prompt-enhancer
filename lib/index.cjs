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
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const sys = require('./sys.cjs');
const platformService = require('./platform-service.cjs');
const netProxy = require('./net-proxy.cjs');
const { validateRpcArgs } = require('./rpc-schema.cjs');
// v3.2.5（语音识别模块）：ASR host 侧——cloud 双协议 + refine + sanitize + 出网（通道 C）
const asr = require('./asr.cjs');
const asrModels = require('./asr-models.cjs');
const asrDeploy = require('./asr-deploy.cjs');

// 2026-08-18（进程级重启降级·方案 2 修复）：写进程索引从 plugin-host.js（BODY）移到本模块级——
// BODY 经 new Function('harness', BODY) 执行（见下方 256 行），其作用域无 require；原 BODY 内
// require('node:fs') 必然抛错被 try/catch 静默吞掉 → 索引永远写不出 → 非服务化部署（无系统服务，
// 如未装 nssm 的机器）端口重启的进程级降级路径（updater-host 读索引 → kill → spawn 同参数新进程）
// 失效（NO_SERVICE_AND_NO_INDEX）。
// 2026-08-20（P3·索引时机优化）：不再「模块加载时立即写」——改为「确认 3080 由本进程监听后」再写，
// 防 host 初始化中途崩溃前把索引污染为死 pid（v3.2.1-l 已用「杀 3080 实际监听者」兜底，此为深层优化）；
// 20s 内未确认仍兜底写一次（非服务化 spawn 降级依赖索引的 argv/execPath，必须保证可用）。
{
  const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
  let wrote = false;
  const writeIndex = () => {
    if (wrote) return;
    wrote = true;
    try {
      fs.mkdirSync(dshHome, { recursive: true });
      fs.writeFileSync(path.join(dshHome, 'dsh-prompt-enhancer.json'), JSON.stringify({
        pid: process.pid,
        execPath: process.execPath,
        cwd: process.cwd(),
        argv: process.argv.slice(1),
        ts: Date.now(),
      }), 'utf8');
    } catch (e) { /* 尽力而为，失败不影响插件 */ }
  };
  // 探测：DSH 就绪——3080（web 版固定端口）或本进程任意 LISTENING（桌面版随机端口 = 就绪信号）
  const isDshListening = () => {
    try {
      const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 3000 });
      const pid = String(process.pid);
      const lines = String(r.stdout || '').split(/\r?\n/);
      return lines.some((l) => l.indexOf('LISTENING') !== -1 && l.indexOf(pid) !== -1);
    } catch (e) { return false; }
  };
  let tries = 0;
  const idxTimer = setInterval(() => {
    tries++;
    if (isDshListening() || tries >= 40) { // 确认就绪 或 20s 兜底
      writeIndex();
      clearInterval(idxTimer);
    }
  }, 500);
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
  // v3.2.1-t（架构调整·内容哈希重建）：复制后写来源内容哈希标记——executorEnsure 以此
  // 判断副本是否过期（代码变了但 EXECUTOR_VERSION 没 bump 也能触发重建）。
  try {
    fs.writeFileSync(path.join(root, '.executor-hash'), sys.executorContentHash(), 'utf8');
  } catch { /* 写标记失败不阻断（fallback 到版本比较） */ }
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
  // v3.2.1-r（根因修复·版本检测失真）：PLUGIN_VERSION 构建硬编码与 package.json 脱节
  // （发版后未重建产物 → 永远报旧版）。运行时读取运行环境 package.json 作为本地版本
  // 单一事实源；读取失败回退 PLUGIN_VERSION（BODY 内常量）。
  readPluginVersion: () => {
    try {
      const pj = path.join(__dirname, '..', 'package.json');
      const ver = JSON.parse(fs.readFileSync(pj, 'utf8')).version;
      return typeof ver === 'string' && ver !== '' ? ver : '';
    } catch (e) { return ''; }
  },
  // v3.2.1-r（幽灵目录修正）：一键更新走 tgz 安装后，update/check 的 defaultDir
  // （会话工作区/dsh-prompt-enhancer-<tag>/，v2.4.1 逐文件写入遗留）已无实际意义且误导——
  // 返回真实运行环境目录（实际安装目标）。
  pluginRuntimeDir: () => path.join(__dirname, '..'),
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
// v3.2.4 — RPC: config/get · config/set（配置磁盘持久化）
// 修复 Issue #1：DSH Desktop 主进程每次启动动态分配端口（listen port 0），
// Chromium localStorage 按 Origin（协议://域名:端口）隔离 → 新 Origin 下配置「丢失」，
// client 误判 fresh 用默认链覆盖用户配置。磁盘配置跨端口共享（client 双写 + 启动同步）。
// 存储：$DSH_HOME/dsh-prompt-enhancer.config.json（原子写 tmp+rename，失败不阻断插件）
// ============================================================================
const CONFIG_FILE = (() => {
  try {
    const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    fs.mkdirSync(dshHome, { recursive: true });
    return path.join(dshHome, 'dsh-prompt-enhancer.config.json');
  } catch (e) {
    return null;
  }
})();

harness.handle('config/get', async () => {
  try {
    if (!CONFIG_FILE || !fs.existsSync(CONFIG_FILE)) return { ok: true, config: null };
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ok: true, config: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null };
  } catch (e) {
    return { ok: false, code: 'CONFIG_READ_FAILED', message: String((e && e.message) || e) };
  }
});

harness.handle('config/set', async (args) => {
  try {
    const patch = args && typeof args === 'object' ? args.config : null;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, code: 'BAD_ARGS', message: 'config must be an object' };
    }
    if (!CONFIG_FILE) return { ok: false, code: 'NO_DSH_HOME', message: 'cannot resolve DSH_HOME' };
    // v3.2.5（语音模块·多写入方）：config/set 升级为「顶层键级 merge」——enhancer 与 voice
    // 两个模块各写各的顶层键（configState / voice），整体替换会让后写方清空先写方配置。
    // 向后兼容：v3.2.4 唯一写入方（enhancer）传完整 configState → merge 结果与替换等价。
    let merged = {};
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const cur = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (cur && typeof cur === 'object' && !Array.isArray(cur)) merged = cur;
      } catch (e) { /* 损坏文件按空处理（覆盖恢复），不阻断写入 */ }
    }
    for (const k of Object.keys(patch)) merged[k] = patch[k];
    const size = Buffer.byteLength(JSON.stringify(merged), 'utf8');
    if (size > 1024 * 1024) return { ok: false, code: 'CONFIG_TOO_LARGE', message: 'config exceeds 1MB' };
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(merged), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: 'CONFIG_WRITE_FAILED', message: String((e && e.message) || e) };
  }
});

// ============================================================================
// v3.2.5 — RPC: voice/status · voice/transcribe（语音识别模块）
// ============================================================================
// voice/status：读配置组装引擎/规整就绪状态（local 字段实时探测 worker，P2）。
// voice/transcribe：data URL 音频 → cloud 双协议 ASR → refine 规整 → {text,raw,refined}；
// REFINE 失败降级 raw（不阻塞）；配置一律从磁盘读（voice 字段），apiKey 不进 RPC 请求。
// v3.2.7（模型管理框架·用户需求 2026-08-20）：插件只提供框架接口——模型清单/下载/进度
// 三个 RPC；模型由用户选择下载（不进发布物、安装不默认下载），下载完成自动重启 worker。
harness.handle('voice/modelList', async () => {
  try { return asrModels.modelList(); } catch (e) { return { ok: false, code: 'MODEL_LIST_FAILED', message: String((e && e.message) || e) }; }
});
harness.handle('voice/modelDownload', async (args) => {
  try {
    const v = validateRpcArgs('voice/modelDownload', args);
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
    return asrModels.modelDownload(args.id);
  } catch (e) { return { ok: false, code: 'MODEL_DOWNLOAD_FAILED', message: String((e && e.message) || e) }; }
});
harness.handle('voice/modelProgress', async (args) => {
  try {
    const v = validateRpcArgs('voice/modelProgress', args);
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
    return asrModels.modelProgress(args.id);
  } catch (e) { return { ok: false, code: 'MODEL_PROGRESS_FAILED', message: String((e && e.message) || e) }; }
});
// v3.2.7（模型管理框架 v2）：切换当前模型（重启 worker 加载）+ 打开模型文件夹（放第三方模型）
harness.handle('voice/modelApply', async (args) => {
  try {
    const v = validateRpcArgs('voice/modelApply', args);
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
    return asrModels.modelApply(args.id);
  } catch (e) { return { ok: false, code: 'MODEL_APPLY_FAILED', message: String((e && e.message) || e) }; }
});
harness.handle('voice/modelOpenDir', async () => {
  try { return asrModels.modelOpenDir(); } catch (e) { return { ok: false, code: 'MODEL_OPEN_DIR_FAILED', message: String((e && e.message) || e) }; }
});
// v3.2.10：删除模型（用户需求「已下载的模型可删除」；调用方先切走当前模型防 Windows 文件句柄占用）
harness.handle('voice/modelDelete', async (args) => {
  try {
    const v = validateRpcArgs('voice/modelDelete', args);
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
    return asrModels.modelDelete(args.id);
  } catch (e) { return { ok: false, code: 'MODEL_DELETE_FAILED', message: String((e && e.message) || e) }; }
});
// #4 修复（2026-08-21）：本地引擎运行时一键部署——复制 worker + npm install sherpa-onnx（若缺）
// + ensureWorker 启动（异步非阻塞；前端轮询 voice/deployStatus）。普通用户装插件后 asrDir 运行时
// 目录为空 → worker 起不来 → installed=false；此 RPC 提供用户主动触发的完整部署入口。
harness.handle('voice/deployRuntime', async () => {
  try { return asrDeploy.startDeploy(); } catch (e) { return { ok: false, code: 'DEPLOY_RUNTIME_FAILED', message: String((e && e.message) || e) }; }
});
harness.handle('voice/deployStatus', async () => {
  try { return asrDeploy.deployStatus(); } catch (e) { return { ok: false, code: 'DEPLOY_STATUS_FAILED', message: String((e && e.message) || e) }; }
});
harness.handle('voice/status', async () => {
  try {
    let cfg = null;
    if (CONFIG_FILE && fs.existsSync(CONFIG_FILE)) {
      try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { cfg = null; }
    }
    return await asr.status(cfg);
  } catch (e) {
    return { ok: false, code: 'VOICE_STATUS_FAILED', message: String((e && e.message) || e) };
  }
});

harness.handle('voice/transcribe', async (args) => {
  try {
    const v = validateRpcArgs('voice/transcribe', args);
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
    let cfg = null;
    if (CONFIG_FILE && fs.existsSync(CONFIG_FILE)) {
      try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { cfg = null; }
    }
    const engine = args && typeof args === 'object' ? args.engine : undefined;
    return await asr.transcribe(cfg, args.audioBase64, engine);
  } catch (e) {
    return { ok: false, code: 'VOICE_TRANSCRIBE_FAILED', message: String((e && e.message) || e) };
  }
});

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
      // v3.2.10（DSH Desktop 适配）：桌面客户端无服务——命令改为提示重启客户端
      // （web 场景保持 net stop/start 服务命令）。
      command: sys.isDesktop() ? '请重启 DSH Desktop 客户端以加载新版本' : 'net stop ' + svc + ' && net start ' + svc,
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
  // v3.2.1-t（架构调整·内容哈希重建）：执行器代码一变（哈希变化）即使版本号没 bump
  // 也强制重建——历史教训：v3.2.1-p 镜像 fallback 因版本号不变、执行器副本不重建而
  // 一直不生效。哈希与版本号任一不匹配 → kill 旧进程拉新。
  const contentHash = sys.executorContentHash();
  const ping = await executorCall(port, 'ping');
  if (ping && ping.ok === true) {
    const dirHash = sys.readExecutorHash(targetVersion);
    const stale = ping.version !== targetVersion || (dirHash !== '' && dirHash !== contentHash);
    if (!stale) {
      return { ok: true, port, version: ping.version, pid: ping.pid, spawned: false };
    }
    // 版本或内容过期：kill 旧执行器 → 拉新
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
      // v3.2.10（DSH Desktop 适配）：Desktop 场景脚本 execPath 传 Desktop.exe（Electron exe，
      // spawn 即启动 GUI）；isDesktop 标记让脚本走桌面分支（杀索引 pid + 拉 exe + 进程就绪判定）。
      const cliScript = buildCliRestartScript({ execPath: nodePath, fallbackBin: resolveDshBin(), outLog, errLog, serviceName: svc, isDesktop: sys.isDesktop() });
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
      // 2. 创建桌面快捷方式（USERPROFILE 由 nssm 注入为当前用户主目录 → 桌面路径正确）。
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
      // v3.2.10（DSH Desktop 适配）：桌面客户端重启 GUI 无需管理员——跳过打标（打标反让
      // Desktop 以管理员运行，文件权限/体验异常）；web 服务模式保留。
      const runAsApplied = sys.isDesktop() ? false : markLnkRunAs(lnkPath);
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
      const dl = spawnSync('curl', [...netProxy.curlProxyArgs(), '-L', '--fail', '-sS', '-o', zipPath, NSSM_URL], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
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
  const userHome = process.env.USERPROFILE || process.env.HOME || path.join('C:', 'Users', 'Public');
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
    // v3.2.10（DSH Desktop 适配·守卫）：桌面客户端为 Electron GUI——无 nssm 服务化概念，
    // 直接返回明确错误（客户端 UI 已按 port-mode='desktop' 不触发服务化引导，此为兜底）。
    if (sys.isDesktop()) {
      return { ok: false, code: 'DESKTOP_UNSUPPORTED', message: '桌面版客户端无需服务化（GUI 应用由客户端自管理）' };
    }
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
function buildPortRestartScript({ execPath, argv, cwd, oldPid, outLog, errLog, isDesktop }) {
  const J = (v) => JSON.stringify(v);
  const desktop = !!isDesktop;
  return [
    '// dsh-prompt-enhancer 独立端口重启（v3.2.1-l：杀实际监听者 + 新 PID 防误报；v3.2.10：Desktop 分支）',
    "const { spawnSync, spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    'const oldPid = ' + Number(oldPid) + ';',
    'const execPath = ' + J(execPath) + ';',
    'const argv = ' + J(Array.isArray(argv) && argv.length ? argv : ['web']) + ';',
    'const isDesktop = ' + desktop + ';',
    'const cwd = ' + J(cwd || 'C:\\\\') + ';',
    'const outLog = ' + J(outLog) + ';',
    'const errLog = ' + J(errLog) + ';',
    '// 3080 实际监听者（netstat 查）——索引 pid 可能滞后/指向死进程（host 崩溃前覆盖索引），杀实际监听者最可靠',
    '// v3.2.10：Desktop 场景不探 3080（端口随机），直接杀索引 pid（Desktop 主进程）',
    'const holderPid = () => {',
    "  const nr = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
    "  const nm = String(nr.stdout || '').match(/:3080\\s+\\S+\\s+LISTENING\\s+(\\d+)/);",
    '  return nm ? Number(nm[1]) : 0;',
    '};',
    '// 等 host 返回（脚本由 DSH 内 host detached spawn，杀 DSH 前先让 RPC 响应返回）',
    'setTimeout(() => {',
    '  // v3.2.1-l（实测·索引兜底）：taskkill 目标 = 3080 实际监听者（索引 oldPid 仅兜底）；',
    '  // **不带 /T**——本脚本仍在 DSH 子进程树上，/T 递归杀树会连带杀掉脚本（新 DSH 起不来）。',
    '  // v3.2.10（Desktop）：杀索引 pid（Electron 主进程），子进程随主进程退出；不杀 3080。',
    '  const killTarget = isDesktop ? oldPid : (holderPid() || oldPid);',
    "  console.log('杀旧进程 ' + killTarget + '（索引 ' + oldPid + '）...');",
    "  try { spawnSync('taskkill', ['/F', '/PID', String(killTarget)], { windowsHide: true, stdio: 'ignore' }); } catch (e) {}",
    '  setTimeout(() => {',
    '    try {',
    "      const out = fs.openSync(outLog, 'a');",
    "      const err = fs.openSync(errLog, 'a');",
    '      // v3.2.10（Desktop）：spawn(execPath) 无 argv——直接拉起 DSH Desktop.exe；',
    '      // web 场景保持原逻辑 spawn(execPath, argv)。',
    "      const child = spawn(execPath, isDesktop ? [] : argv, { cwd, detached: true, stdio: ['ignore', out, err], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } });",
    '      const childPid = child.pid || 0;',
    '      child.unref();',
    '      // v3.2.1-l（防误报）：成功 = 3080 由**新进程**接管（≠ 被杀进程）；旧进程仍监听不算成功',
    '      // v3.2.10（Desktop）：成功 = 新 Desktop 主进程（childPid）出现 LISTENING（端口就绪），',
    '      // 桌面端端口随机——探测「本进程任意 LISTENING」而非固定 3080。',
    '      const poll = (n) => {',
    '        if (isDesktop) {',
    '          let listening = false;',
    '          try {',
    "            const lr = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
    '            listening = String(lr.stdout || \'\').split(/\\r?\\n/).some((l) => l.indexOf(\'LISTENING\') !== -1 && l.indexOf(String(childPid)) !== -1);',
    '          } catch (e) {}',
    "          if (listening) { try { fs.unlinkSync(__filename); } catch (e) {} console.log('✓ DSH Desktop 已恢复（新进程 ' + childPid + ' 端口就绪）'); process.exit(0); }",
    "          if (n >= 60) { try { fs.unlinkSync(__filename); } catch (e) {} console.log('✗ 等待超时：DSH Desktop 未就绪，请检查 ' + errLog); process.exit(1); }",
    '          setTimeout(() => poll(n + 1), 1000);',
    '          return;',
    '        }',
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
 *
 * v3.2.10（DSH Desktop 适配）：isDesktop 时脚本走**桌面客户端分支**——跳过管理员检查
 * 与 nssm 服务判断（GUI 无需服务化、端口随机）：杀索引 pid（Desktop 主进程）+ 直接拉起
 * execPath（DSH Desktop.exe，无 argv）+ 成功判定 = 新 Desktop 主进程端口就绪（netstat 查
 * 本进程 LISTENING，不 poll 固定 3080）。
 */
function buildCliRestartScript({ execPath, fallbackBin, outLog, errLog, serviceName, isDesktop }) {
  const J = (v) => JSON.stringify(v);
  const desktop = !!isDesktop;
  return [
'// dsh-prompt-enhancer 独立 CLI 端口重启（v3.2.11：运行时探测 + 双实例选择路由）',
"const { spawnSync, spawn } = require('node:child_process');",
"const fs = require('node:fs');",
"const path = require('node:path');",
"const readline = require('node:readline');",
"const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');",
"const idxPath = path.join(home, 'dsh-prompt-enhancer.json');",
    'const execPath = ' + J(execPath) + ';',
    'const fallbackBin = ' + J(fallbackBin || '') + ';',
    'const outLog = ' + J(outLog) + ';',
    'const errLog = ' + J(errLog) + ';',
    'const serviceName = ' + J(serviceName) + ';',
'// v3.2.11（用户需求·双实例选择路由）：isDesktop 仅作「生成时环境」参考，不再固定路由；',
'// 脚本运行时探测 Desktop 客户端 / Web 服务谁在跑，双实例并存时由用户选择。',
    'const isDesktop = ' + desktop + ';',
"const askChoice = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(String(a || '').trim()); }); });",
"const desktopRunning = () => { const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DSH Desktop.exe', '/NH'], { encoding: 'utf8', windowsHide: true }); return /DSH Desktop\\.exe/i.test(String(r.stdout || '')); };",
"const desktopPid = () => { const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DSH Desktop.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }); const m = /\\\"DSH Desktop\\.exe\\\",\\\"(\\d+)/.exec(String(r.stdout || '')); return m ? Number(m[1]) : 0; };",
"const webRunning = () => { const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true }); return /:3080\\s+\\S+\\s+LISTENING\\s+\\d+/.test(String(r.stdout || '')); };",
"console.log('=== DSH 端口重启（CLI）===');",
'// 服务存在判断（web 分支用）：sc query 有 STATE 行 = 服务存在 → 服务模式',
"const scq = spawnSync('sc', ['query', serviceName], { encoding: 'utf8', windowsHide: true });",
"const scOut = String(scq.stdout || '') + String(scq.stderr || '');",
"const svcExists = /STATE\\s*:\\s*\\d+\\s+\\S+/.test(scOut);",
"(async () => {",
"  // 运行时探测：谁在跑",
"  const dRun = desktopRunning();",
"  const wRun = webRunning();",
"  let target = '';",
"  if (dRun && wRun) {",
"    const ans = await askChoice('检测到两个 DSH 实例：\\n  1) DSH Desktop 客户端\\n  2) DSH Web 服务 (3080)\\n请选择要重启的实例 (1/2)：');",
"    target = ans === '2' ? 'web' : 'desktop';",
"  } else if (dRun) { target = 'desktop'; }",
"  else if (wRun) { target = 'web'; }",
"  else { console.log('✗ 未检测到运行中的 DSH（Desktop 客户端 / Web 服务均未运行）'); process.exit(1); }",
"  console.log(target === 'desktop' ? '→ 重启 DSH Desktop 客户端' : '→ 重启 DSH Web 服务');",
"  if (target === 'desktop') {",
'    // ---- Desktop 分支（v3.2.10）：杀 Desktop 主进程 + 拉起 Desktop.exe + 端口就绪判定 ----',
"    const oldPid = desktopPid();",
"    if (!oldPid) { console.log('✗ 未找到 DSH Desktop 进程'); process.exit(1); }",
"    console.log('杀旧 Desktop 进程 ' + oldPid + ' ...');",
"    spawnSync('taskkill', ['/F', '/PID', String(oldPid)], { windowsHide: true, stdio: 'ignore' });",
"    setTimeout(() => {",
"      try {",
"        console.log('启动 DSH Desktop ...');",
"        const out = fs.openSync(outLog, 'a');",
"        const err = fs.openSync(errLog, 'a');",
"        const child = spawn(execPath, [], { cwd: process.env.USERPROFILE || 'C:\\\\', detached: true, stdio: ['ignore', out, err], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } });",
"        const childPid = child.pid || 0;",
"        child.unref();",
"        const poll = (n) => {",
"          let listening = false;",
"          try {",
"            const lr = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
"            listening = String(lr.stdout || '').split(/\\r?\\n/).some((l) => l.indexOf('LISTENING') !== -1 && l.indexOf(String(childPid)) !== -1);",
"          } catch (e) {}",
"          if (listening) { console.log('✓ DSH Desktop 已恢复（新进程 ' + childPid + ' 端口就绪）'); setTimeout(() => process.exit(0), 500); return; }",
"          if (n >= 60) { console.log('✗ 等待超时：DSH Desktop 未就绪，请检查 ' + errLog); process.exit(1); }",
"          setTimeout(() => poll(n + 1), 1000);",
"        };",
"        poll(0);",
"      } catch (e) { console.log('✗ 启动失败: ' + (e && e.message ? e.message : e)); process.exit(1); }",
"    }, 1000);",
"  } else {",
'    // ---- Web 分支（v3.2.1-j/m）：管理员检查 → 服务模式 / 默认前台模式 ----',
"    let isAdmin = false;",
"    try { isAdmin = spawnSync('net', ['session'], { windowsHide: true, stdio: 'ignore' }).status === 0; } catch (e) { isAdmin = false; }",
"    if (!isAdmin) {",
"      console.log('✗ 执行失败：本快捷方式需要管理员权限，请以管理员身份运行（右键 → 以管理员身份运行）');",
"      process.exit(1);",
"    }",
"    if (svcExists) {",
"      console.log('检测到 nssm 服务 ' + serviceName + '，以服务方式重启 ...');",
"      const svcRunning = /STATE\\s*:\\s*\\d+\\s+(RUNNING|正在运行)/.test(scOut);",
"      const portHolder = () => {",
"        const nr = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
"        const nm = String(nr.stdout || '').match(/:3080\\s+\\S+\\s+LISTENING\\s+(\\d+)/);",
"        return nm ? Number(nm[1]) : 0;",
"      };",
"      const beforePid = portHolder();",
"      const startSvc = () => {",
"        console.log('显式拉起服务 sc start ' + serviceName + ' ...');",
"        const r = spawnSync('sc', ['start', serviceName], { encoding: 'utf8', windowsHide: true });",
"        if (r.status !== 0) console.log('⚠ sc start 返回 ' + r.status + '（非 0 = 未成功拉起，5 表示拒绝访问）');",
"        const poll = (n) => {",
"          const h = portHolder();",
"          const fresh = h > 0 && h !== beforePid;",
"          if (fresh) { console.log('✓ DSH 服务已恢复：http://127.0.0.1:3080（新进程 ' + h + '）'); setTimeout(() => process.exit(0), 500); return; }",
"          if (h > 0 && h === beforePid) console.log('  （3080 仍由旧进程 ' + h + ' 监听，服务尚未重启）');",
"          if (n >= 40) { console.log('✗ 服务重启超时：3080 未由新进程接管'); process.exit(1); }",
"          setTimeout(() => poll(n + 1), 1000);",
"        };",
"        poll(0);",
"      };",
"      const releasePort = () => {",
"        const h = portHolder();",
"        if (h) { console.log('端口被进程 ' + h + ' 占用，单 PID 杀'); spawnSync('taskkill', ['/F', '/PID', String(h)], { windowsHide: true, stdio: 'ignore' }); }",
"        let fw = 0;",
"        const waitFree = () => {",
"          if (portHolder() === 0 || fw >= 10) { startSvc(); return; }",
"          fw++; setTimeout(waitFree, 1000);",
"        };",
"        waitFree();",
"      };",
"      if (svcRunning) {",
"        spawnSync('sc', ['stop', serviceName], { windowsHide: true, stdio: 'ignore' });",
"        let sw = 0;",
"        const waitStopped = () => {",
"          const q = spawnSync('sc', ['query', serviceName], { encoding: 'utf8', windowsHide: true });",
"          const st = /STATE\\s*:\\s*\\d+\\s+(\\S+)/.exec(String(q.stdout || ''));",
"          if ((st && st[1] === 'STOPPED') || sw >= 15) { releasePort(); return; }",
"          sw++; setTimeout(waitStopped, 1000);",
"        };",
"        waitStopped();",
"      } else {",
"        releasePort();",
"      }",
"    } else {",
"      if (!fs.existsSync(idxPath)) { console.log('✗ 无进程索引，无法自动重启'); process.exit(1); }",
"      let idx = {};",
"      try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch (e) { console.log('✗ 索引读取失败'); process.exit(1); }",
"      const oldPid = (idx.pid && Number.isInteger(idx.pid)) ? idx.pid : 0;",
"      let argv = Array.isArray(idx.argv) && idx.argv.length ? idx.argv : null;",
"      if (!argv || !fs.existsSync(String(argv[0]))) argv = fallbackBin ? [fallbackBin, 'web'] : ['web'];",
"      const cwd = idx.cwd || process.cwd();",
"      const holderPid = () => {",
"        const nr = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
"        const nm = String(nr.stdout || '').match(/:3080\\s+\\S+\\s+LISTENING\\s+(\\d+)/);",
"        return nm ? Number(nm[1]) : 0;",
"      };",
"      const killTarget = holderPid() || oldPid;",
"      console.log('杀旧进程 ' + killTarget + '（索引 ' + oldPid + '）...');",
"      spawnSync('taskkill', ['/F', '/PID', String(killTarget)], { windowsHide: true, stdio: 'ignore' });",
"      setTimeout(() => {",
"        try {",
"          console.log('启动新 DSH ...');",
"          const out = fs.openSync(outLog, 'a');",
"          const err = fs.openSync(errLog, 'a');",
"          const child = spawn(execPath, argv, { cwd, detached: true, stdio: ['ignore', out, err], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } });",
"          child.unref();",
"          console.log('已触发，等待端口恢复（约 10-15 秒）...');",
"          const poll = (n) => {",
"            const h = holderPid();",
"            const fresh = h > 0 && h !== killTarget;",
"            if (fresh) { console.log('✓ DSH 已恢复：http://127.0.0.1:3080（新进程 ' + h + '）'); setTimeout(() => process.exit(0), 500); return; }",
"            if (h === killTarget) console.log('  （3080 仍由旧进程 ' + h + ' 监听，未杀成功）');",
"            if (n >= 30) { console.log('✗ 等待超时：3080 未由新进程接管，请检查 ' + errLog); process.exit(1); }",
"            setTimeout(() => poll(n + 1), 1000);",
"          };",
"          poll(0);",
"        } catch (e) { console.log('✗ 启动失败: ' + e.message); process.exit(1); }",
"      }, 1000);",
"    }",
"  }",
"})();",
  ].join('\n');
}function scheduleServiceRestart(serviceName) {
  const taskName = 'DSHPortRestart';
  // v3.2.1-t（架构修复 B·host 不自己杀自己）：sc stop 也移进调度任务——host 只
  // 创建 + 触发任务 + 立即返回响应。旧实现 host 进程内 spawnSync('sc stop') 会被
  // nssm 树杀（host 就是服务进程）→ RPC 响应丢失 → client 永远等不到恢复轮询启动
  // （实测根因：「端口重启成功但 UI 一直卡「正在重启」」）。
  // v3.2.1-u（端口重启服务模式定案·修复 /tr 261 字符限制）：实测 schtasks /create
  // 报「'/tr' 选项的值不能超过 261 字符」（status=2147500037）——把完整 PowerShell
  // 任务链塞进 /tr 超长 → create 失败 → 旧降级分支 sc stop（只停不启）→ 服务挂死
  // （08-19 18:32 实测：create FAILED → 服务 Stopped、3080 空、页面全报错）。
  // 根治：任务链改为【独立 node 脚本】——host 生成 restart-service-<ts>.cjs 到
  // executor/cli，/tr 只指 "node.exe <script>"（短命令，远小于 261 字符）；
  // 脚本内（SYSTEM 运行、脱离 nssm Job 树）：sc.exe stop → 轮询 3080 真正释放
  // （≤30s，残留单 PID 杀）→ sc.exe start → 删任务 + 自删脚本。
  // 降级分支安全化：create 失败【不再 sc stop】（杜绝只停不启），返回明确错误。
  const cliDir = path.join(sys.EXECUTOR_ROOT, 'cli');
  fs.mkdirSync(cliDir, { recursive: true });
  const scriptPath = path.join(cliDir, 'restart-service-' + Date.now() + '.cjs');
  fs.writeFileSync(scriptPath, buildServiceRestartScript(serviceName, taskName, 3080), 'utf8');
  // tr 必须短（schtasks /tr ≤261 字符）：node.exe <script>
  const tr = '"' + process.execPath + '" "' + scriptPath + '"';
  // 时间仅占位（创建后立即 /run 触发，不依赖时间点；万一 /run 失败，2 分钟后任务仍会触发兜底）
  const when = schtasksOnceTime(120);
  const create = spawnSync('schtasks', ['/create', '/tn', taskName, '/tr', tr, '/sc', 'once', '/st', when, '/ru', 'SYSTEM', '/f'], { windowsHide: true, timeout: 15000 });
  console.log('[enhance] scheduleServiceRestart create status=' + create.status + ' stderr=' + String(create.stderr || '').slice(0, 200));
  if (create.status !== 0) {
    // v3.2.1-u：不再降级 sc stop（实测 create 失败会只停不启、服务挂死）——明确失败返回，服务不动
    const err = (String(create.stderr || '') + String(create.stdout || '')).trim();
    try { fs.unlinkSync(scriptPath); } catch (e) { /* 忽略 */ }
    return { ok: false, message: '调度任务创建失败（' + (err.slice(0, 150) || ('exit ' + create.status)) + '）' };
  }
  // 立即触发任务（独立进程运行，host 树杀不影响）；host 不再自行 sc stop——立即返回响应
  const run = spawnSync('schtasks', ['/run', '/tn', taskName], { windowsHide: true, timeout: 15000 });
  console.log('[enhance] scheduleServiceRestart run status=' + run.status + ' stderr=' + String(run.stderr || '').slice(0, 200));
  if (run.status !== 0) {
    // /run 失败：任务仍在（120s 后自动触发兜底）——告知已排队，不阻断
    return { ok: true, message: '任务已创建但立即触发失败（exit ' + run.status + '），约 2 分钟后自动执行' };
  }
  return { ok: true, message: '服务重启任务已触发' };
}
/** 生成服务模式重启脚本（SYSTEM 任务运行，脱离 nssm Job 树；执行后删任务 + 自删）。 */
function buildServiceRestartScript(serviceName, taskName, port) {
  const J = (v) => JSON.stringify(v);
  const scBin = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'sc.exe');
  return [
    '// dsh-prompt-enhancer 服务模式重启脚本（v3.2.1-u：schtasks /tr 261 字符限制修复）',
    "const { spawnSync } = require('node:child_process');",
    "const fs = require('node:fs');",
    'const SVC = ' + J(serviceName) + ';',
    'const PORT = ' + Number(port) + ';',
    'const TASK = ' + J(taskName) + ';',
    'const SC = ' + J(scBin) + ';',
    'const RE = new RegExp(' + J(':' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)') + ');',
    'const busy = (ms) => { const t = Date.now(); while (Date.now() - t < ms) {} };',
    "// 1. 停旧服务（sc stop 树杀 nssm Job；本脚本由 Task Scheduler 运行，不在 Job 树内，不受影响）",
    "spawnSync(SC, ['stop', SVC], { windowsHide: true, stdio: 'ignore' });",
    "// 2a. 轮询服务 SCM 状态 = STOPPED（≤30s）——nssm 服务 stop 后 SCM 可能仍 STOP_PENDING，",
    "//     此时立即 sc.exe start 会被拒（服务正在停止）。必须等 SCM 确认 STOPPED。",
    'let t2 = 0;',
    'while (t2 < 30) {',
    "  const q = spawnSync(SC, ['query', SVC], { encoding: 'utf8', windowsHide: true });",
    "  if (/STOPPED/.test(String(q.stdout || ''))) break;",
    '  busy(1000); t2++;',
    '}',
    "// 2b. 轮询 3080 真正释放（≤30s）：仍有监听者（前台残留）则单 PID 杀，端口释放即 break",
    'let t = 0;',
    'while (t < 30) {',
    "  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });",
    '  const m = RE.exec(String(r.stdout || \'\'));',
    '  if (!m) break;',
    "  try { spawnSync('taskkill', ['/F', '/PID', m[1]], { windowsHide: true, stdio: 'ignore' }); } catch (e) {}",
    '  busy(1000); t++;',
    '}',
    "// 3. 显式拉起服务（全新 node 接管 3080）——sc.exe start 可能因时序被拒，重试 3 次",
    'for (let a = 0; a < 3; a++) {',
    "  const s = spawnSync(SC, ['start', SVC], { encoding: 'utf8', windowsHide: true });",
    "  if (s.status === 0 || /already|running|正在运行/i.test(String(s.stdout || ''))) break;",
    '  busy(3000);',
    '}',
    "// 4. 删任务 + 自删脚本（防残留）",
    "try { spawnSync('schtasks', ['/delete', '/tn', TASK, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch (e) {}",
    'try { fs.unlinkSync(__filename); } catch (e) {}',
  ].join('\n');
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
    // v3.2.1-q/r（安装链路·根因修复）：重启前安装 staging 待装 tarball（若有）——
    // 一键更新（staged）→ 端口重启（安装+重启）链路；v3.2.1-r 起安装 = 解包复制
    // （秒级、无 pnpm/无锁，不再卡 host），安装失败仍阻断并返回明确错误
    const staged = findStagedTarball();
    if (staged) {
      // v3.2.10（DSH Desktop 适配）：Desktop 加载 desktop profile——staging 安装目标
      // 在 Desktop 下强制 'desktop'（否则装到 web profile，Desktop 不生效）。
      const profile = args && typeof args.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(args.profile) ? args.profile : (sys.isDesktop() ? 'desktop' : 'web');
      const ins = installStagedTarball(staged, profile);
      if (!ins.ok) {
        return { ok: false, code: 'STAGED_INSTALL_FAILED', message: 'staging 安装失败（' + path.basename(staged) + '）：' + ins.message };
      }
      console.log('[enhance] update/portRestart staged install ok: ' + path.basename(staged) + ' ' + ins.message);
    }
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
      if (isDesktop) {
        // v3.2.10（DSH Desktop 适配）：Desktop 索引 argv 为空（Electron 主进程无 argv）——
        // 直接拉起 execPath（DSH Desktop.exe），Electron 自行恢复全部子进程；不再兜底
        // resolveDshBin → [node,'web']（否则杀 Desktop 后拉起的是 bin.js web，GUI 不回来）。
        launchArgv = [execPath];
      } else {
        const globalBin = resolveDshBin();
        launchArgv = globalBin ? [globalBin, 'web'] : ['web'];
      }
    }
    // v3.2.1-j（用户明确规则·判断修正）：按「服务是否存在」决定重启方式——
    //   · **有 nssm 服务**（无论 RUNNING 还是 Stopped）→ 走服务模式（scheduleServiceRestart：
    //     Task Scheduler 创建后立即 /run 触发 sc start（脱离 nssm Job 树）+ sc stop 当前服务；
    //     Stopped 场景自动清理 3080 前台占用后拉起服务）
    //   · **无 nssm 服务** → 默认前台模式（独立 detached 脚本：杀旧前台 + 拉起新前台）——仅兜底
    // 默认前台方式只作兜底备用（用户指令）。
    // v3.2.10（DSH Desktop 适配）：桌面客户端端口随机、无 nssm 服务概念——
    // 一律走默认模式（杀 Desktop 主进程 + 拉起 Desktop.exe），跳过服务模式检测。
    const isDesktop = sys.isDesktop();
    const backend = platformService.backendFor(process.platform);
    const svcInfo = backend ? backend.detectService(serviceName, envForProbe()) : { exists: false };
    const serviceExists = !isDesktop && !!(svcInfo && svcInfo.exists);

      if (serviceExists) {
        // 服务模式：调度 sc start（Task Scheduler 立即触发）+ sc stop 当前服务
        const sched = scheduleServiceRestart(serviceName);
        if (sched && sched.ok === false) {
          // v3.2.1-u：调度任务创建失败 → 明确失败返回（服务不动，杜绝「只停不启」挂死）
          return { ok: false, code: 'SCHEDULE_FAILED', message: sched.message };
        }
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
    const script = buildPortRestartScript({ execPath, argv: launchArgv, cwd: idx.cwd, oldPid, outLog, errLog, isDesktop });
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

/**
 * v3.2.1-q（用户实测·一键更新安装未生效）：端口重启前安装 staging 待装 tarball。
 * 背景：v3.1.x「一键更新仅下载 staged，安装+重启由端口重启完成」依赖执行器 restart 的
 * staging 检查；但 v3.2.1 端口重启独立化后（服务模式 schtasks / 默认模式独立脚本）
 * 两条路径都不经过执行器 → staging 安装从未执行 → 重启后仍是旧版。
 * 修复：portRestart 触发前先 findStagedTarball + installStagedTarball（dsh plugin add 本地 tgz），
 * 安装成功删除 tgz（避免重复安装），失败阻断并返回明确错误。
 */
function findStagedTarball() {
  try {
    const dir = path.join(sys.EXECUTOR_ROOT, 'staging');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter((f) => /^dsh-prompt-enhancer-.*\.tgz$/.test(f))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files.length ? path.join(dir, files[0].f) : null;
  } catch (e) { return null; }
}
// v3.2.1-r（根因修复·安装与 host 解耦）：staging tgz 安装 = 直接解包覆盖运行环境目录，
// 不再用 `dsh plugin add`（= pnpm add）——pnpm 操作**正在运行的 profile** 会卡死/超时
// （host 事件循环冻结 → client 90s 端口重启超时，2026-08-19 实测根因）。
// npm pack tgz 是标准 tar 格式（顶层 package/），解包 + 文件级覆盖复制，秒级完成、无网络、
// 无依赖树、无锁；插件加载走 cordis include（node_modules 下的包），不依赖 pnpm 依赖登记
// （历史一直手动 cp 覆盖运行环境 + 重启即生效，已验证）。
function installStagedTarball(tgzPath, profile) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(String(profile || ''))) {
      return { ok: false, message: 'profile 非法: ' + profile };
    }
    if (!fs.existsSync(tgzPath)) return { ok: false, message: 'tgz 不存在: ' + tgzPath };
    const dshHome = process.env.DSH_HOME || path.join(String(process.env.HOME || process.env.USERPROFILE || ''), '.dsh');
    const runtimeDir = path.join(dshHome, 'profiles', profile, 'node_modules', 'dsh-prompt-enhancer');
    if (!fs.existsSync(runtimeDir)) {
      return { ok: false, message: '运行环境目录不存在: ' + runtimeDir };
    }
    // 解包到临时目录（v3.2.1-r：用 Windows 自带 bsdtar 绝对路径——PATH 里若先命中 Git Bash
    // 的 GNU tar，`-C C:\...` 会被解析成远程主机导致失败；bsdtar 认 Windows 路径）
    const tarBin = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-install-'));
    const r = spawnSync(tarBin, ['-xzf', String(tgzPath).replace(/\\/g, '/'), '-C', tmp], { windowsHide: true, timeout: 30000 });
    if (r.status !== 0) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: false, message: 'tgz 解包失败: ' + String(r.stderr || r.stdout || '').slice(0, 200) };
    }
    const pkgDir = path.join(tmp, 'package');
    if (!fs.existsSync(pkgDir)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: false, message: 'tgz 缺少顶层 package/ 目录（非 npm pack 产物）' };
    }
    // 校验 tgz 内包名与版本（防止装错包/目录污染）
    let newVer = '';
    let pkgName = '';
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
      newVer = typeof pj.version === 'string' ? pj.version : '';
      pkgName = typeof pj.name === 'string' ? pj.name : '';
    } catch { /* 解析失败不阻断 */ }
    if (pkgName !== '' && pkgName !== 'dsh-prompt-enhancer') {
      fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: false, message: 'tgz 包名不匹配: ' + pkgName };
    }
    // 文件级覆盖复制（不删目录——运行中的 host 正从该目录加载，删目录可能触发 Windows 句柄/路径锁）
    fs.cpSync(pkgDir, runtimeDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    try { fs.unlinkSync(tgzPath); } catch (e) { /* 已安装，删除失败不阻断 */ }
    return { ok: true, message: '已解包安装 v' + (newVer || '?') + ' → ' + runtimeDir };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
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
    // v3.2.8（用户需求·规整同增强设置方式）：注入基座 llm 服务到 asr.cjs——
    // refine chain 模式用规整区自选的基座模型（provider/model 由基座解析，免填 key，含本地模型）
    if (typeof ctx.get === 'function' && ctx.get('llm')) asr.setLlm(ctx.get('llm'));
    // v3.2.36（防重启后"本地引擎未就绪"）：host 启动延迟 5s 自动拉起本地 ASR worker
    // （engine=local 且模型已装才拉；worker detached 异步加载，不阻塞 host 启动）
    setTimeout(() => { try { asrModels.ensureWorker(); } catch (e) { /* 不阻断 host 启动 */ } }, 5000);
    return plugin.apply.call(this, ctx);
  },
};
