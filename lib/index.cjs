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
// v3.3.2（供应链加固）：staging tgz 安装前 sha256 复验（旁挂 .sha256 由 executor 校验通过后写入）
const { createHash } = require('node:crypto');
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
// v3.3.x 批次二：DSH_ENHANCER_NO_INDEX=1 显式跳过——测试/演练/临时脚本 require 本文件时
// 防止 20s 兜底把进程索引污染成无关进程（2026-08-22 实测：bare require 会以死 pid 覆盖真实索引）。
if (process.env.DSH_ENHANCER_NO_INDEX !== '1') {
  const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
  let wrote = false;
  const writeIndex = () => {
    if (wrote) return;
    wrote = true;
    try {
      fs.mkdirSync(dshHome, { recursive: true });
      fs.writeFileSync(path.join(dshHome, 'dsh-prompt-enhancer.json'), JSON.stringify({
        // v3.3.x（双实例隔离）：kind 标记写入方运行时（web/desktop）——web 与 Desktop 共享
        // 同一 DSH_HOME 时后写覆盖先写，读取方必须校验 kind 一致才可信，否则回退当前进程事实值。
        kind: (process.versions && process.versions.electron) || /DSH[ _-]?Desktop/i.test(String(process.execPath || '')) ? 'desktop' : 'web',
        pid: process.pid,
        execPath: process.execPath,
        cwd: process.cwd(),
        argv: process.argv.slice(1),
        ts: Date.now(),
      }), 'utf8');
    } catch (e) { /* 尽力而为，失败不影响插件 */ }
  };
  // 探测：DSH 就绪——3080（web 版固定端口）或本进程任意 LISTENING（桌面版随机端口 = 就绪信号）
  // B1：netstat 解析委托 sys 原语（单一事实源）
  const isDshListening = () => {
    try { return sys.pidHasListening(process.pid); } catch (e) { return false; }
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
      // v4.9：容错 UTF-8 BOM（2026-08-23 事故——BOM 使 JSON.parse 抛异常→版本回退构建常量）
      const pj = path.join(__dirname, '..', 'package.json');
      const rawPj = fs.readFileSync(pj, 'utf8').replace(/^\uFEFF/, '');
      const ver = JSON.parse(rawPj).version;
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
    // v4.9（A2）：显式下载代理——从持久化配置顶层 download.proxy 读取（设置页可写，空=跟随系统代理）
    let dlProxy = '';
    try {
      if (CONFIG_FILE && fs.existsSync(CONFIG_FILE)) {
        const cfgDl = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (cfgDl && cfgDl.download && typeof cfgDl.download.proxy === 'string') dlProxy = cfgDl.download.proxy.trim();
      }
    } catch (e2) { /* 配置读失败=无显式代理 */ }
    return asrModels.modelDownload(args.id, dlProxy);
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
 * 单快捷方式「DSH Web」的 .cmd 菜单体（返回 **Buffer**——zh 变体是 GBK 字节，不能按字符串写）。
 * 用户规则 2026-08-22：文字与创建时平台语言一致（locale 参数，默认 zh）。
 * 编码纪律（实测教训）：cmd 按系统代码页解析批处理——中文 Windows=cp936。
 *  · zh：固定中文行预转 GBK 字节（离线 GetEncoding(936) 生成，见下 hex）→ 无 chcp、无解析错位；
 *    动态命令行纯 ASCII 与 GBK 无缝拼接。**禁止回退到 UTF-8+chcp 写法**（会把行片段当命令执行）。
 *  · en：纯 ASCII。node 子进程自身输出中文不受影响（经 WriteConsoleW）。
 */
const ZH_GBK_LINES = {
  opt1: '6563686f2020205b315d20c6f4b6af20576562a3a8c8b7b1a3b6cbbfdad4dacfdfb2a2b4f2bfaacdf8d2b3a3a9',
  opt2: '6563686f2020205b325d20b6cbbfdad0deb8b4a3a8d7d4b6afc7e5c0edd5bcd3c3b2a2d6d8d0c2c0adc6f0a3a9',
  opt3: '6563686f2020205b335d20d2bbbcfcb8fcd0c2a3a8b0b2d7b0d0c2b0e6b1beb2a2d7d4b6afd6d8c6f4c9fad0a7a3a9',
  choice: '63686f696365202f6320313233202f742033202f642031202f6e202f6d20225b312f322f335d2033c3ebbaf3c4acc8cfc6f4b6af5b315d3a2022',
  choiceManual: '63686f696365202f6320313233202f6e202f6d20225b312f322f335d20c7ebd1a1d4f13a2022',
  failMsg: '6563686f205b215d20c6f4b6afcaa7b0dca1aaa1aad2d1b7b5bbd8b2cbb5a5a3acbfc9d1a1205b325d20b6cbbfdad0deb8b4a1a3',
  updFailMsg: '5b215d20b8fcd0c2caa7b0dca3a1d2d1b7b5bbd8b2cbb5a5a1a3',
};

function buildWebMenuCmdBody(opts) {
  const o = opts || {};
  // v4.8（审查修正·#B）：引号转义改 cmd 惯例的双写 ""（反斜杠转义 cmd 不解析；受控路径本不含引号，纯防御）
  const esc = (p) => '"' + String(p).replace(/"/g, '""') + '"';
  const base = '--service ' + o.svc + ' --profile ' + o.profile;
  const upLine = esc(o.nodePath) + ' ' + esc(o.target) + ' --cli up ' + base + ' --open';
  const repLine = esc(o.nodePath) + ' ' + esc(o.target) + ' --cli repair ' + base;
  const updLine = esc(o.nodePath) + ' ' + esc(o.target) + ' --cli update ' + base;
  const isZh = o.locale !== 'en';
  const CRLF = Buffer.from('\r\n', 'ascii');
  const A = (s) => Buffer.from(s, 'ascii');
  const G = (hex) => Buffer.from(hex, 'hex');
  // 菜单回显段：locale 决定（zh=GBK 行 / en=ASCII 行）
  const menuEcho = isZh
    ? Buffer.concat([G(ZH_GBK_LINES.opt1), CRLF, G(ZH_GBK_LINES.opt2), CRLF, G(ZH_GBK_LINES.opt3), CRLF])
    : A('echo   [1] Start Web\r\necho   [2] Repair port\r\necho   [3] One-click update\r\n');
  // 失败提示行：同上双编码
  const failMsg = isZh ? G(ZH_GBK_LINES.failMsg) : A('echo [!] Start failed - back to menu, try [2] Repair port.');
  // v4.8：[3] 更新失败提示（同上双编码；成功路径 pause 后直接关窗——服务已在后台重启完毕）
  const updFailMsg = isZh ? G(ZH_GBK_LINES.updFailMsg) : A('echo [!] Update failed - back to menu.');
  // 倒计时/手动两态 choice 行：locale 决定（zh=GBK / en=ASCII）
  const choiceLine = isZh
    ? Buffer.concat([
        A('if defined NOAUTO ('), G(ZH_GBK_LINES.choiceManual),
        A(') else ('), G(ZH_GBK_LINES.choice), A(')\r\n'),
      ])
    : A('if defined NOAUTO (choice /c 123 /n /m "Select [1/2/3]: ") else (choice /c 123 /t 3 /d 1 /n /m "Select [1/2/3], default [1] in 3s: ")\r\n');
  // 菜单循环。NOAUTO 竞态防护：[1] 失败回菜单时置位，choice 关闭倒计时改手动——
  // 否则 3s 后再次默认执行 [1]，失败态下形成「失败→菜单→倒计时→再失败」死循环。
  // v4.8（审查修正·自愈壳）：runtimeRoot 提供时，壳启动先验运行时目标存在——缺失则走 :heal
  // 从持久插件包缓存（profiles/web/plugins/dsh-prompt-enhancer-tgz/ 最新 tgz）解包恢复运行环境。
  // 背景（2026-08-23 实测）：dsh-market 更新触发 profile pnpm 操作，file: 依赖悬空致整包被清、
  // 三功能全灭 MODULE_NOT_FOUND，而壳自身无能为力。无 runtimeRoot（契约测试）保持旧体不破坏断言。
  const rtRoot = String(o.runtimeRoot || '');
  const heal = rtRoot !== '';
  return Buffer.concat([
    A('@echo off\r\ntitle DSH Web\r\n'),
    ...(heal ? [
      A('if not exist ' + esc(o.target) + ' call :heal\r\n'),
      A('if exist ' + esc(o.target) + ' goto menu\r\n'),
      // v4.9（审查修正·裸救援）：heal 失败（无 tgz/解包失败）≠ 放弃——拉起 3080 只需系统命令
      // （清占用 + sc start，nssm 服务跑的是 DSH core 而非插件），插件全灭也能救活网页。
      A('call :minfix\r\n'),
      A('if exist ' + esc(o.target) + ' goto menu\r\n'),
      A('echo [!] Runtime missing and auto-repair failed. Web core rescue attempted - check http://127.0.0.1:3080\r\n'),
      A('echo     (plugin enhance features need reinstall via DSH settings).\r\n'),
      A('pause\r\nexit\r\n'),
    ] : []),
    A(':menu\r\necho === DSH Web ===\r\n'),
    menuEcho,
    choiceLine,
    A('set NOAUTO=\r\n'),
    A('if errorlevel 3 goto upd\r\nif errorlevel 2 goto rep\r\n'),
    A(upLine + '\r\n'),
    A('if errorlevel 1 goto upFail\r\n'),
    A('pause\r\ngoto :eof\r\n'),
    A(':upFail\r\n'), failMsg, CRLF,
    A('set NOAUTO=1\r\ngoto menu\r\n'),
    A(':rep\r\n'), A(repLine + '\r\n'),
    A('set NOAUTO=1\r\ngoto menu\r\n'),
    A(':upd\r\n'), A(updLine + '\r\n'),
    // v4.8（审查修正·#C UX）：成功（exit 0）→ pause 看更新输出后关窗——服务已在后台重启完毕，无需回菜单；
    // 失败（exit ≥1）→ 更新失败提示回菜单。pause 文案由 Windows 本地化生成，无编码负担。
    A('if errorlevel 1 goto updfail\r\n'),
    A('pause\r\ngoto :eof\r\n'),
    A(':updfail\r\n'), updFailMsg, CRLF,
    A('set NOAUTO=1\r\ngoto menu\r\n'),
    ...(heal ? [
      A('\r\n:heal\r\n'),
      A('rem v4.8 self-repair: restore runtime from newest local plugin package (offline)\r\n'),
      A('setlocal enabledelayedexpansion\r\n'),
      A('set "TGZDIR=%USERPROFILE%\\.dsh\\profiles\\web\\plugins\\dsh-prompt-enhancer-tgz"\r\n'),
      A('set "HEAL=%TEMP%\\dsh-heal-%RANDOM%"\r\n'),
      A('mkdir "%HEAL%" 2>nul\r\n'),
      A('set "NEWEST="\r\n'),
      A('for /f "delims=" %%f in (\'dir /b /o-d "%TGZDIR%\\*.tgz" 2^>nul\') do if not defined NEWEST set "NEWEST=%TGZDIR%\\%%f"\r\n'),
      A('if not defined NEWEST (echo [!] no local plugin package found for self-repair.& endlocal& goto :eof)\r\n'),
      A('echo [i] Restoring runtime from %NEWEST% ...\r\n'),
      A('tar -xzf "%NEWEST%" -C "%HEAL%" || (endlocal& goto :eof)\r\n'),
      A('xcopy "%HEAL%\\package\\*" "' + rtRoot + '\\" /e /y /i /q >nul\r\n'),
      A('rd /s /q "%HEAL%" 2>nul\r\n'),
      A('endlocal\r\n'),
      A('exit /b\r\n'),
      // v4.9 裸救援：纯系统命令（不依赖插件任何文件）——杀 3080 占用者（系统关键进程保护名单）
      // + sc start dsh-web + 30s 轮询确认。插件整包被清时仍可救活网页核心。
      A('\r\n:minfix\r\n'),
      A('rem v4.9 minimal port rescue - pure system commands, no plugin runtime needed\r\n'),
      A('setlocal enabledelayedexpansion\r\n'),
      A('echo [i] Minimal port rescue: clearing 3080 holders + starting dsh-web...\r\n'),
      A('for /f "tokens=5" %%p in (\'netstat -ano ^| findstr /r /c:":3080 .*LISTENING"\') do call :killguarded %%p\r\n'),
      A('sc config dsh-web start= auto >nul 2>&1\r\n'),
      A('sc start dsh-web >nul 2>&1\r\n'),
      A('set /a MFT=0\r\n'),
      A(':mwait\r\n'),
      A('ping -n 2 127.0.0.1 >nul\r\n'),
      A('netstat -ano | findstr /r /c:":3080 .*LISTENING" >nul && goto mdone\r\n'),
      A('set /a MFT+=1\r\n'),
      A('if %MFT% lss 30 goto mwait\r\n'),
      A('echo [!] Port 3080 still down after 30s - check nssm/eventlog.\r\n'),
      A('exit /b\r\n'),
      A(':mdone\r\n'),
      A('echo [OK] Web core rescued on http://127.0.0.1:3080 (plugin features need reinstall).\r\n'),
      A('exit /b\r\n'),
      A(':killguarded\r\n'),
      A('rem kill holder pid %1 unless Windows-critical process\r\n'),
      A('set "IMG="\r\n'),
      A('for /f "delims=," %%n in (\'tasklist /fi "PID eq %1" /fo csv /nh 2^>nul\') do if not defined IMG set "IMG=%%~n"\r\n'),
      A('if /i "%IMG%"=="lsass.exe" goto :eof\r\n'),
      A('if /i "%IMG%"=="wininit.exe" goto :eof\r\n'),
      A('if /i "%IMG%"=="csrss.exe" goto :eof\r\n'),
      A('if /i "%IMG%"=="smss.exe" goto :eof\r\n'),
      A('if /i "%IMG%"=="services.exe" goto :eof\r\n'),
      A('if /i "%IMG%"=="svchost.exe" goto :eof\r\n'),
      A('if /i "%IMG%"=="winlogon.exe" goto :eof\r\n'),
      A('taskkill /f /pid %1 >nul 2>&1\r\n'),
      A('goto :eof\r\n'),
    ] : []),
  ]);
}

/**
 * v4.8（审查修正·#A 桌面重定向兼容）：真实桌面路径经 WScript.Shell SpecialFolders 探测——
 * OneDrive 同步/域策略把桌面重定向到别处时，USERPROFILE\Desktop 并非用户所见桌面，
 * .lnk 会写进错误位置（图标"消失"）。探测失败（cscript 异常/结果非法）回退旧路径。
 */
function resolveDesktopDir() {
  const fallback = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop');
  try {
    const probePath = path.join(sys.EXECUTOR_ROOT, 'cli', 'desktop-probe-' + Date.now() + '.js');
    fs.writeFileSync(probePath, 'var sh = new ActiveXObject("WScript.Shell"); WScript.Echo(sh.SpecialFolders("Desktop"));', 'utf8');
    const r = spawnSync('cscript.exe', ['//nologo', probePath], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    try { fs.unlinkSync(probePath); } catch (e) { /* ignore */ }
    const out = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    if (r.status === 0 && /^[A-Za-z]:\\/.test(out)) return out;
  } catch (e) { /* 回退旧路径 */ }
  return fallback;
}

harness.handle('update/makeShortcut', async (args) => {
    try {
      // 用户规则（2026-08-22）：快捷方式全局只有一种语义=管理 Web 端口。
      // 无论从 Web 宿主还是桌面宿主创建，产物相同、行为相同——serviceName/profile
      // 强制钳制 dsh-web/web（桌面端即便传入自己的 profile 也被钳回）。
      const svc = 'dsh-web';
      const profile = 'web';
      // 用户规则（2026-08-22）：菜单文字与创建时平台语言一致——client 传 locale（zh/en，默认 zh）
      const locale = args && typeof args.locale === 'string' && /^(zh|en)$/.test(args.locale) ? args.locale : 'zh';
      // v4.5（用户规则）：移除 DESKTOP_UNSUPPORTED 门——桌面宿主里也能创建这对快捷方式
      // （sync-runtime 已把 updater-host.cjs 部署到所有装了本插件的 profile，静态目标在位）；
      // 桌面端自身的重启仍走其设置页 RPC 自实例语义，与本快捷方式无关。
      const nodePath = process.execPath;
      // v3.3.x 批次二（G4 载体决策定案）：不再生成一次性 restart-dsh.cjs 逻辑脚本。lnk 指静态
      // 常驻子命令 <运行环境 lib>/updater-host.cjs——随插件部署、版本天然一致，不会丢失/漂移；
      // 本 RPC 只生成无逻辑 .cmd 壳。2026-08-22（用户需求·第三次修订）：**只有一个桌面图标**
      // 「DSH Web」，双击进两选项菜单：[1] 启动 Web（--cli up --open）/ [2] 维护菜单（--cli
      // maintain），choice /t 3 /d 1 三秒倒计时默认 [1]。刻意不打 RunAs 标志免日常 UAC；
      // 维护菜单需要管理员时按现有提示右键管理员运行即可。
      const cliDir = path.join(sys.EXECUTOR_ROOT, 'cli');
      fs.mkdirSync(cliDir, { recursive: true });
      // 历史遗留启动器清理（双入口/自启实验时代的残留壳，现行方案只写 dsh-web.cmd 一个）
      for (const stale of ['dsh-maintain.cmd', 'dsh-web-up.cmd', 'dsh-web-autostart.vbs', 'dsh-web-autostart.cmd']) {
        try { if (fs.existsSync(path.join(cliDir, stale))) fs.unlinkSync(path.join(cliDir, stale)); } catch { /* ignore */ }
      }
      const staticTarget = path.join(__dirname, 'updater-host.cjs');
      if (!fs.existsSync(staticTarget)) {
        return { ok: false, code: 'SHORTCUT_TARGET_MISSING', message: '维护入口不存在（运行环境不完整）: ' + staticTarget };
      }
      const lnkName = 'DSH Web.lnk';
      const cmdName = 'dsh-web.cmd';
      // 1. 写无逻辑 .cmd 菜单壳（zh=GBK 字节缓冲 / en=ASCII；locale 决定，见 buildWebMenuCmdBody）
      const cmdPath = path.join(cliDir, cmdName);
      fs.writeFileSync(cmdPath, buildWebMenuCmdBody({ nodePath, target: staticTarget, svc, profile, locale, runtimeRoot: path.join(__dirname, '..') }));
      // 2. 创建桌面快捷方式（v4.8：真实桌面经 Shell SpecialFolders 探测——OneDrive/域策略
      //    重定向桌面时 USERPROFILE\Desktop 并非用户所见；探测失败回退旧路径）。
      //    v3.2（用户需求）：图标 DeepSeek 蓝色鲸鱼——内嵌 base64 → executor/icons/deepseek.ico。
      //    Node 直接生成 .lnk 的历史结论：缺 IDList 白纸 → cscript WScript.Shell 方案（v3.2.2）。
      const desktop = resolveDesktopDir();
      // 按语言命名 + 删除旧名避免重复（含 2026-08-22 双入口时代的 维护/启动 两枚旧名）
      try { if (fs.existsSync(path.join(desktop, '重启DSH服务.lnk'))) fs.unlinkSync(path.join(desktop, '重启DSH服务.lnk')); } catch { /* ignore */ }
      try { if (fs.existsSync(path.join(desktop, 'Restart DSH Service.lnk'))) fs.unlinkSync(path.join(desktop, 'Restart DSH Service.lnk')); } catch { /* ignore */ }
      try { if (fs.existsSync(path.join(desktop, '重启DSH.lnk'))) fs.unlinkSync(path.join(desktop, '重启DSH.lnk')); } catch { /* ignore */ }
      try { if (fs.existsSync(path.join(desktop, 'Restart DSH.lnk'))) fs.unlinkSync(path.join(desktop, 'Restart DSH.lnk')); } catch { /* ignore */ }
      for (const oldName of ['DSH Web 维护.lnk', 'DSH Web Maintenance.lnk', 'DSH Web 启动.lnk', 'DSH Web Start.lnk']) {
        try { if (fs.existsSync(path.join(desktop, oldName))) fs.unlinkSync(path.join(desktop, oldName)); } catch { /* ignore */ }
      }
      // 2026-08-18（用户反馈桌面乱码残留·Shell 锁住脚本删不动的兜底）：旧版 WScript 写过的
      // 「閱嶅惎DSH.lnk」是文件名异体字（GBK→UTF-16 错误转换残留），Shell 锁住时 Node unlink
      // 会 EPERM——try/catch 静默，让用户在桌面手动删；下次 Shell 释放锁后即可清理。
      // 同样 .lnk.tmp 是覆盖重试时的残留。
      try { if (fs.existsSync(path.join(desktop, '閱嶅惎DSH.lnk'))) fs.unlinkSync(path.join(desktop, '閱嶅惎DSH.lnk')); } catch { /* EPERM if Shell locked, ignore */ }
      try { if (fs.existsSync(path.join(desktop, '重启DSH.lnk.tmp'))) fs.unlinkSync(path.join(desktop, '重启DSH.lnk.tmp')); } catch { /* ignore */ }
      try { if (fs.existsSync(path.join(desktop, 'Restart DSH.lnk.tmp'))) fs.unlinkSync(path.join(desktop, 'Restart DSH.lnk.tmp')); } catch { /* ignore */ }
      try { if (fs.existsSync(path.join(desktop, 'Restart DSH Service.lnk.tmp'))) fs.unlinkSync(path.join(desktop, 'Restart DSH Service.lnk.tmp')); } catch { /* ignore */ }
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
      const cmdExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
      const userProfile = process.env.USERPROFILE || process.env.HOME || '';
      const iconPathEnv = iconPath.includes(userProfile) ? iconPath.replace(userProfile, '%USERPROFILE%') : iconPath;
      // v3.2.2 结论：cscript + WScript.Shell 生成完整 .lnk（含 LinkTargetIDList）
      const { makeShortcutWin } = require('./shortcut-win.cjs');
      const lnkPath = path.join(desktop, lnkName);
      const winResult = makeShortcutWin({
        lnkPath,
        target: cmdExe,
        args: '/c "' + cmdPath + '"',
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
      // 刻意不打 RunAs 标志：日常双击免 UAC；[1] 冷启路径无需管理员，[2] 维护菜单需要
      // 管理员时按菜单内提示右键管理员运行（v4.5 起单入口语义，权限降级路径已内建）。
      const runAsApplied = false;
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
/** 服务存在性提示（handler 内联用，避免重复 !! 链）。 */
function serviceExistsHint(svcInfo) { return !!(svcInfo && svcInfo.exists); }

/**
 * 端口重启模式判定（纯函数·v4.7 与快捷方式 v4.6 阶梯同口径）：
 *  · desktop → default（桌面端重启=关掉桌面端进程再重开 Desktop.exe，无服务概念）
 *  · 无 nssm → default（前台脚本：杀 3080 实际监听者 + 原参数拉起）
 *  · nssm 存在但 START_TYPE=4 DISABLED → default（sc start 必败 1058，实测；自动降级）
 *  · 其余 → service（schtasks 脱离 nssm Job 树调度 sc 重启）
 */
function pickRestartMode({ isDesktop, serviceExists, startTypeNum }) {
  if (isDesktop) return 'default';
  if (!serviceExists) return 'default';
  if (startTypeNum === 4) return 'default'; // SC_START_TYPE DISABLED
  return 'service';
}

function buildPortRestartScript({ execPath, argv, cwd, oldPid, outLog, errLog, isDesktop }) {
  const J = (v) => JSON.stringify(v);
  const desktop = !!isDesktop;
  return [
    '// dsh-prompt-enhancer 独立端口重启（v3.2.1-l：杀实际监听者 + 新 PID 防误报；v3.2.10：Desktop 分支）',
    "// B1（批次二）：端口原语经 sys.scriptPortPrims() 单一事实源嵌入——独立 node 进程无法 require sys.cjs",
    "const { spawnSync, spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    sys.scriptPortPrims(),
    'const oldPid = ' + Number(oldPid) + ';',
    'const execPath = ' + J(execPath) + ';',
    'const argv = ' + J(Array.isArray(argv) && argv.length ? argv : ['web']) + ';',
    'const isDesktop = ' + desktop + ';',
    'const cwd = ' + J(cwd || 'C:\\\\') + ';',
    'const outLog = ' + J(outLog) + ';',
    'const errLog = ' + J(errLog) + ';',
    '// 3080 实际监听者——索引 pid 可能滞后/指向死进程（host 崩溃前覆盖索引），杀实际监听者最可靠',
    '// v3.2.10：Desktop 场景不探 3080（端口随机），直接杀索引 pid（Desktop 主进程）',
    'const holderPid = () => dshPrimPortHolder(3080);',
    '// 等 host 返回（脚本由 DSH 内 host detached spawn，杀 DSH 前先让 RPC 响应返回）',
    'setTimeout(() => {',
    '  // v3.2.1-l（实测·索引兜底）：taskkill 目标 = 3080 实际监听者（索引 oldPid 仅兜底）；',
    '  // **不带 /T**——本脚本仍在 DSH 子进程树上，/T 递归杀树会连带杀掉脚本（新 DSH 起不来）。',
    '  // v3.2.10（Desktop）：杀索引 pid（Electron 主进程），子进程随主进程退出；不杀 3080。',
    '  const killTarget = isDesktop ? oldPid : (holderPid() || oldPid);',
    '  // v3.3.x（防误杀·身份校验）：Desktop 杀 pid 前先确认镜像名确实是 DSH Desktop.exe——',
    '  // 索引被另一实例覆盖/指向死进程时，盲杀会误伤 web 实例或空杀后重复拉起第二个实例。',
    '  if (isDesktop && dshPrimPidImage(killTarget).indexOf(\'DSH Desktop\') === -1) { console.log(\'✗ 目标进程 \' + killTarget + \' 不是 DSH Desktop.exe（身份校验失败，可能已被替换/退出），已中止以防误杀\'); try { fs.unlinkSync(__filename); } catch (e) {} process.exit(1); }',
    "  console.log('杀旧进程 ' + killTarget + '（索引 ' + oldPid + '）...');",
    '  dshPrimTaskKill(killTarget, false);',
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
    '          if (dshPrimPidHasListening(childPid)) { try { fs.unlinkSync(__filename); } catch (e) {} console.log(\'✓ DSH Desktop 已恢复（新进程 \' + childPid + \' 端口就绪）\'); process.exit(0); }',
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
 * v3.3.x 批次二（G4 载体决策定案·本函数已删除）：
 * 桌面「重启DSH」一次性生成式脚本（restart-dsh.cjs，含 Desktop 分支 ~50 行）退役——
 * 快捷方式改指静态常驻子命令 `<运行环境 lib>/updater-host.cjs --cli maintain`：
 * · updater-host.cjs 是随插件部署的静态文件（执行器进程不在 ≠ 文件不在），版本与插件天然一致；
 * · 生成物只剩无逻辑的 .cmd 启动器（chcp+pause 体验壳），丢失仅影响回显，重建即恢复；
 * · 维护能力收敛进维护菜单（重启/应用更新/端口修复/环境体检/救援），Desktop 重启走其设置页
 *   RPC 自实例语义（方案 §5.1：Desktop 分支整体删除）。
 */
function scheduleServiceRestart(serviceName) {
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
    "// B1（批次二）：端口原语经 sys.scriptPortPrims() 单一事实源嵌入——独立 node 进程无法 require sys.cjs",
    "const { spawnSync } = require('node:child_process');",
    "const fs = require('node:fs');",
    sys.scriptPortPrims(),
    'const SVC = ' + J(serviceName) + ';',
    'const PORT = ' + Number(port) + ';',
    'const TASK = ' + J(taskName) + ';',
    'const SC = ' + J(scBin) + ';',
    "// v4.8（审查修正）：busy 忙等待（死循环烧 CPU ≤60s）改 Atomics.wait 同步休眠——零 CPU 占用等价语义，不支持环境回退旧实现",
    "const busy = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { const t = Date.now(); while (Date.now() - t < ms) {} } };",
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
    '// v4.8（审查修正·与桌面端防误杀对齐）：残留监听者杀前验镜像名——仅 node.exe 视作旧 DSH 家族予以清理，',
    "  // 第三方程序占用 3080 时跳过不杀并留痕（轮询自然走到超时，绝不误伤无关进程）。",
    "  const killHolderIfOurs = (pid) => {",
    "    const img = String(dshPrimPidImage(pid));",
    "    if (/node\\.exe$/i.test(img)) { dshPrimTaskKill(pid, false); return; }",
    "    console.log('  （3080 占用者 ' + pid + ' 镜像 ' + img + ' 非 node.exe，跳过不杀）');",
    '  };',
    "// 2b. 轮询 3080 真正释放（≤30s）：仍有监听者（前台残留）则单 PID 杀，端口释放即 break",
    'let t = 0;',
    'while (t < 30) {',
    '  const h = dshPrimPortHolder(PORT);',
    '  if (!h) break;',
    '  killHolderIfOurs(h);',
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
/** 查 3080 当前监听者 pid（无则 0）——B1 委托 sys 原语（netstat 按端口找真正占用者，索引 pid 可能过期）。 */
function portHolder() {
  return sys.portHolderPid(3080);
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
      // v3.3.x（P1 修复·profile 路由）：client 无桌面检测、恒传默认 'web'——旧三元
      // 优先信任合法入参，导致 Desktop 下 staging 装进 web profile、重启后版本不变。
      // 现 Desktop 下无条件强制 'desktop'；web 下沿用入参（缺省 'web'）。
      const requestedProfile = args && typeof args.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(args.profile) ? args.profile : '';
      const profile = sys.isDesktop() ? 'desktop' : (requestedProfile || 'web');
      const ins = installStagedTarball(staged, profile);
      if (!ins.ok) {
        return { ok: false, code: 'STAGED_INSTALL_FAILED', message: 'staging 安装失败（' + path.basename(staged) + '）：' + ins.message };
      }
      console.log('[enhance] update/portRestart staged install ok: ' + path.basename(staged) + ' ' + ins.message);
    }
    // v3.3.x（TDZ 修复）：isDesktop 必须在 argv 兜底分支之前声明——原声明在本函数
    // 下方（服务模式判断处），兜底分支先引用 → ReferenceError: Cannot access
    // 'isDesktop' before initialization，桌面端索引 argv 缺失时整个端口重启抛异常。
    const isDesktop = sys.isDesktop();
    // 读进程索引（host 模块加载时写：kind/pid/execPath/cwd/argv）
    const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    const idxPath = path.join(dshHome, 'dsh-prompt-enhancer.json');
    // v3.3.x（P1 修复·双实例隔离）：web 与 Desktop 共享同一 DSH_HOME 时互相覆盖索引，
    // kind 与当前运行时不一致 = 索引属于另一实例 → 整体不信任，回退当前进程事实值
    // （process.pid/execPath/cwd/argv 是第一手真相），防误杀另一实例或拉错应用。
    // 索引缺失也不再硬失败——当前进程值同样可用（原 NO_INDEX 仅因旧实现依赖索引补 argv）。
    const runtimeKind = isDesktop ? 'desktop' : 'web';
    let idx = {};
    let idxTrusted = false;
    if (fs.existsSync(idxPath)) {
      try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch { idx = {}; }
      idxTrusted = !!(idx && idx.kind === runtimeKind);
      if (!idxTrusted) console.log('[enhance] portRestart: 进程索引 kind=' + (idx && idx.kind) + ' ≠ 当前 ' + runtimeKind + '（双实例覆盖），回退当前进程参数');
    } else {
      console.log('[enhance] portRestart: 进程索引缺失，回退当前进程参数');
    }
    const execPath = (idxTrusted && idx.execPath && fs.existsSync(idx.execPath)) ? idx.execPath : process.execPath;
    const oldPid = (idxTrusted && idx.pid && Number.isInteger(idx.pid)) ? idx.pid : process.pid;
    // v3.2.1（审查加固·解耦 npx 缓存依赖）：索引 argv 可能含 npx 缓存路径（含日期目录，
    // 清理后 portRestart 拉起会失败）——argv 缺失或 bin 文件不存在时，兜底用全局 dsh
    // bin（dsh-install 稳定路径，resolveDshBin 优先全局）或纯 'web'
    let launchArgv = (idxTrusted && Array.isArray(idx.argv) && idx.argv.length) ? idx.argv : null;
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
    // （v3.3.x：isDesktop 已提前到索引读取前声明，此处不再重复声明。）
    const backend = platformService.backendFor(process.platform);
    const svcInfo = backend ? backend.detectService(serviceName, envForProbe()) : { exists: false };
    // v4.7（用户规则·与快捷方式 v4.6 阶梯同口径）：nssm 注册存在但 START_TYPE=DISABLED
    // 时 sc start 必败（1058，实测）——服务模式直接降级为默认前台脚本，杜绝「调度成功、
    // 起不来」的挂死窗口。START_TYPE 只在 `sc qc` 里（sc query 无此行）。
    let startTypeNum = null;
    if (!isDesktop && serviceExistsHint(svcInfo) && process.platform === 'win32') {
      try {
        const qc = sys.runProbe('sc', ['qc', serviceName], envForProbe());
        const tm = /START_TYPE\s*:\s*(\d)/.exec(String(qc.stdout || ''));
        if (tm) startTypeNum = Number(tm[1]);
      } catch { /* 配置查询失败 → 视作可尝试服务模式（维持旧行为） */ }
    }
    const restartMode = pickRestartMode({ isDesktop, serviceExists: serviceExistsHint(svcInfo), startTypeNum });

      if (restartMode === 'service') {
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
 * v3.3.x 批次二：实现抽到 lib/stage-install.cjs（零副作用模块）——维护菜单 CLI
 * （updater-host --cli maintain）需要复用同一实现，但不能 require 本文件（模块加载即
 * 写进程索引，会把索引污染成 CLI 的 pid）。此处仅保留委托与导出（测试/救援复用面不变）。
 */
const stageInstall = require('./stage-install.cjs');
const findStagedTarball = stageInstall.findStagedTarball;
const installStagedTarball = stageInstall.installStagedTarball;
module.exports = {
  name: 'dsh-prompt-enhancer',  ...plugin,
  // v3.3.x（A5/A6·测试与救援 CLI 复用导出）：staging 安装内部函数显式导出——
  // 拦截演练（坏包语法门）与批次二维护菜单直接复用同一实现，杜绝逻辑分叉。
  installStagedTarball,
  findStagedTarball,
  // 批次二（B1）：生成式脚本构建器导出——契约单测（原语嵌入标记 + 组合脚本可解析）用
  buildPortRestartScript,
  buildServiceRestartScript,
  // 批次二（用户需求·单快捷方式双选项）：「DSH Web」菜单壳生成器导出——快捷方式契约单测用
  buildWebMenuCmdBody,
  // 端口重启模式判定纯函数（v4.7：DISABLED 服务自动降级前台，与 v4.6 阶梯同口径）
  pickRestartMode,
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
