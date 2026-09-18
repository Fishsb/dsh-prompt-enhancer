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
// v4.12 批次A：自动链熔断/防抖决策纯函数（computeBackoff/shouldGateAuto/isDebounceBlocked）
const maintainLib = require('./maintain-lib.cjs');
const { validateRpcArgs } = require('./rpc-schema.cjs');
// v3.3.2（供应链加固）：staging tgz 安装前 sha256 复验（旁挂 .sha256 由 executor 校验通过后写入）
const { createHash } = require('node:crypto');
// v3.2.5（语音识别模块）：ASR host 侧——cloud 双协议 + refine + sanitize + 出网（通道 C）
const asr = require('./asr.cjs');
const asrModels = require('./asr-models.cjs');
// t7 回归修复（89577aa 批次D logT 包装插入误删，git show 3a0dad8 对照原位恢复）——
// voice/deployRuntime 与 voice/deployStatus 两 handler 消费此绑定。
const asrDeploy = require('./asr-deploy.cjs');

// 批次D（P2-5·optimization-plan-20260824 §D.1）：本模块直写 console 的行统一 ISO 时间戳前缀
// （与 src/host/diagnostics.js hlog/herr 前缀同格式；out.log 每行可取证）。局部包装不抽
// 公共模块——跨文件抽 util 会扩大 executor 内容哈希面，收益不成比例。生成脚本字符串内嵌
// 的 console.log 不经此（独立进程自有重定向日志，方案范围外）。
const logT = (...a) => console.log('[' + new Date().toISOString() + ']', ...a);


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
  // v3.3.4（executor 依赖自包含·P1）：独立 executor 目录必须自带 undici（net-proxy.cjs require）——
  // 仅复制 lib/ 时独立进程沿目录链找不到 undici → MODULE_NOT_FOUND 启动即崩（批次A 引入 undici
  // 依赖后，任何 executor 重建（ensure 触发）都会把带 require 的 lib 同步过去、而依赖缺失——
  // 2026-09-01 用户一键更新 EXECUTOR_START_FAILED 实锤，%TEMP%\dsh-updater-host.log 报
  // Cannot find module 'undici'）。undici 零传递依赖，单目录复制即可；失败仅留痕不阻断
  //（net-proxy 已做缺失降级：直连可用、代理关闭，进程永不因依赖缺失崩溃）。
  try {
    const undiciSrc = path.dirname(require.resolve('undici'));
    fs.cpSync(undiciSrc, path.join(root, 'node_modules', 'undici'), { recursive: true, force: true });
  } catch (e) {
    console.error('[executor] undici sync failed: ' + (e && e.message ? e.message : e));
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

/**
 * 2026-09-12（安全修复·审查 H2）：cmd.exe 批处理值注入防护——生成的任务 .cmd 由 Task Scheduler
 * 以 SYSTEM 运行，值里出现 `"` 会闭合 `set "NAME=VALUE"` 或 `--dsh-bin "…"` 的引号，从而注入 `& …`。
 * 合法路径/用户名不含 CR/LF 与双引号：直接剔除；`%` 在 set 行与命令行内都会展开 → 转义为 `%%`。
 */
function cmdSafeValue(v, escapePercent) {
  const s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/"/g, '');
  return escapePercent ? s.replace(/%/g, '%%') : s;
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
  // v4.12 批次A（A-2·读码实证）：envNames 补 DSH_HOME——自定义 DSH_HOME 用户机上执行器
  // 才能解析到正确配置/状态目录（download.proxy / update-state.json），不再依赖 nssm
  // AppEnvironmentExtra 恰好含 DSH_HOME 的巧合。
  const envNames = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'windir', 'DSH_HOME'];
  const envLines = [];
  for (const name of envNames) {
    const val = process.env[name];
    if (val) envLines.push('set "' + name + '=' + cmdSafeValue(val, true) + '"');
  }
  const cmdContent = [
    '@echo off',
    ...envLines,
    'set "DSH_EXECUTOR_PORT=' + port + '"',
    'set "DSH_DSH_BIN=' + cmdSafeValue(dshBin, true) + '"',
    'set "DSH_EXECUTOR_TASK=' + cmdSafeValue(taskName) + '"',
    'set "DSH_EXECUTOR_CMD=' + cmdSafeValue(cmdPath, true) + '"',
    '"' + process.execPath + '" "' + executorEntry + '" --port ' + port + ' --dsh-bin "' + cmdSafeValue(dshBin, true) + '" --task "' + cmdSafeValue(taskName) + '" --cmd "' + cmdSafeValue(cmdPath, true) + '" >> "' + cmdSafeValue(logPath, true) + '" 2>&1',
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
      logT('[dsh-prompt-enhancer] executor spawned via ' + att.kind + ' task');
      // v4.12 批次A（A.1.6-b）：宿主侧延迟清扫——60s 后 /Query 仍存在则 /Delete /F。
      // A-4 探针实测：/Delete 对 Running 态实例成功（删除不停已运行进程），且宿主活得比
      // 任务实例久，时机天然安全。pipe 捕获留痕（旧 stdio:'ignore' 吞错零痕迹）。
      setTimeout(() => {
        try {
          const q = spawnSync(schtasks, ['/Query', '/TN', taskName], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
          if (q.status !== 0) return; // 已被执行器 onListen 自删——零残留
          const d = spawnSync(schtasks, ['/Delete', '/TN', taskName, '/F'], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
          if (d.status === 0) {
            logT('[dsh-prompt-enhancer] delayed sweep: exec task deleted (' + taskName + ')');
          } else {
            logT('[dsh-prompt-enhancer] delayed sweep delete FAILED exit=' + d.status +
              ' stderr=' + String(d.stderr || '').trim().slice(0, 150) + ' — janitor menu will clean up');
          }
        } catch (e) {
          logT('[dsh-prompt-enhancer] delayed sweep error: ' + String(e && e.message || e));
        }
      }, 60000).unref();
      return null;
    }
    try { spawnSync(schtasks, ['/Delete', '/TN', taskName, '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(cmdPath); } catch { /* ignore */ }
  logT('[dsh-prompt-enhancer] schtasks unavailable, falling back to detached spawn');
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
  // envcheck 仍在 host 内（sys.cjs 共享实现；动态形态无此字段 → UNSUPPORTED）。
  // 批次C（P1-4）：sys.probeEnv 已全异步化——本 facade 直接返回 Promise（返回值即
  // Promise，facade 形态零改动）；消费方均 await：plugin-host envcheck handler、
  // 执行器 apply envcheck 段。
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

/** RPC 请求体上限（1MiB）——原实现无上限，本机任意进程 POST 超大 body 可直接吃内存。 */
const RPC_BODY_LIMIT = 1024 * 1024;

/**
 * 2026-09-12（安全修复·审查 H1 实测驱动）：本 RPC 路由注册在 DSH web 鉴权栅栏**之外**——
 * 实测无 token 的 `POST /dsh-prompt-enhancer/rpc`（text/plain，不触发 CORS 预检）返回 200 真实数据，
 * 而 `GET /` 是 401：任意网页可借用户浏览器驱动 config/set、update/portRestart 等副作用。
 * 加来源栅栏：带 Origin 的浏览器请求必须与 Host 同源；Sec-Fetch-Site 为跨站即拒。
 * 无来源头的本机调用（node/curl/插件自身 client 走同源 fetch）不受影响。
 */
function isTrustedRpcRequest(request) {
  const headers = (request && request.headers) || {};
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = String(headers.origin || '');
  if (origin) {
    try {
      if (new URL(origin).host !== String(headers.host || '')) return false;
    } catch { return false; }
  }
  return true;
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    request.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > RPC_BODY_LIMIT) {
        aborted = true;
        chunks.length = 0;
        try { request.destroy(); } catch { /* ignore */ }
        resolve({ __tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (aborted) return;
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
      if (!isTrustedRpcRequest(request)) {
        writeJson(response, 403, { ok: false, code: 'FORBIDDEN_ORIGIN' });
        return;
      }
      const { method, args, __tooLarge } = await readBody(request);
      if (__tooLarge) {
        writeJson(response, 413, { ok: false, code: 'BODY_TOO_LARGE' });
        return;
      }
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
// P1a（2026-09-19·圆桌决策 A）：孤儿 plugin-client.js 已退役——它「生成 + 进发布物 + 从不被装载」，
// 正文已被 lib/client.cjs 逐字内嵌；此处移除其重启探测项（少一个永不更新的 mtime 信号，无功能损失）。
const RESTART_FILES = ['plugin-host.js', 'lib/index.cjs', 'lib/client.cjs', 'lib/sys.cjs', 'lib/updater-host.cjs'];

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
  // v3.3.4（C1·陈旧端口文件陷阱）：executor.port 内容可能恰好等于请求口（3081）但 pid/内容过期
  //（旧 executor 残留写入 / 第三方占住同口）——原「pf.port !== port」前提会跳过动态口验证 → 误报
  // EXECUTOR_START_FAILED（2026-09-01 实锤：DSH 主进程占用 3081 时 executor.port 恰为陈旧的
  // {3081, 旧pid}）。改为 pf 存在且端口合法即无条件 ping 验证——spawn 后 executor 已重写端口文件
  //（onListen 幂等写），读到的即最新事实；命中即返回（dynamic 仅用于客户端展示语义）。
  const pf = sys.readExecutorPortFile();
  if (pf && Number.isInteger(pf.port) && pf.port > 0 && pf.port <= 65535) {
    const p3 = await executorCall(pf.port, 'ping');
    if (p3 && p3.ok === true) {
      return { ok: true, port: pf.port, version: p3.version, pid: p3.pid, spawned: true, dynamic: pf.port !== port };
    }
  }
  return { ok: false, code: 'EXECUTOR_START_FAILED', message: 'update executor failed to start on port ' + port };
});


// ============================================================================
// 2026-09-13 — RPC: update/install（安装已 staged 的新版本 · 不重启）
// ============================================================================
// 背景：原「安装」动作物理上嵌在 update/portRestart（安装 + 杀宿主重启）之内。用户指令：
// **更新功能保留，插件内部不再有重启能力**——更新负责把新版本装上，然后提示用户手动重启。
// 故把安装单独提成非重启 RPC，复用 lib/stage-install.cjs 的 findStagedTarball /
// installStagedTarball（解包 + sha256 复验 + 语法门）；装完只报 restartNeeded，不杀/拉宿主。
harness.handle('update/install', async (args) => {
  const serviceName = args && typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName)
    ? args.serviceName : 'dsh-web';
  try {
    const staged = findStagedTarball();
    if (!staged) {
      return { ok: false, code: 'NO_STAGED_TARBALL', message: '没有待安装的包：请先执行「一键更新」完成下载' };
    }
    // v3.3.x（P1 修复·profile 路由）：Desktop 下无条件强制 'desktop'（client 无桌面检测、恒传 'web'）。
    const requestedProfile = args && typeof args.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(args.profile) ? args.profile : '';
    const profile = sys.isDesktop() ? 'desktop' : (requestedProfile || 'web');
    const ins = installStagedTarball(staged, profile);
    if (!ins.ok) {
      return withDiagLog({ ok: false, code: 'STAGED_INSTALL_FAILED', message: 'staging 安装失败（' + path.basename(staged) + '）：' + ins.message }, serviceName);
    }
    const m = path.basename(staged).match(/-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.tgz$/);
    logT('[enhance] update/install ok: ' + path.basename(staged) + ' ' + ins.message);
    return { ok: true, installed: true, version: m ? m[1] : '', restartNeeded: true, message: ins.message || '' };
  } catch (e) {
    return withDiagLog({ ok: false, code: 'INSTALL_FAILED', message: String(e && e.message ? e.message : e) }, serviceName);
  }
});

// ============================================================================
// 2026-09-12（D1 修复）— RPC: update/diagTail（只读·端口重启超时后的根因补取）
// ============================================================================
// 背景：端口重启超时/失败时页面曾整段断开，client 拿不到任何 host 应答（原 diagLog 只挂在
// 执行器 update 路径）→ 该场景恒无根因。本 RPC 让 client 在失败/超时后主动补取一次 DSH err
// 日志尾部（经 redactDiagLine 脱敏），只读、无副作用。
harness.handle('update/diagTail', async (args) => {
  const serviceName = args && typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName) ? args.serviceName : 'dsh-web';
  return { ok: true, diagLog: diagTailSafe(serviceName) };
});

function diagTailSafe(serviceName) {
  try {
    const mod = require('./updater-host.cjs');
    return typeof mod.dshErrLogTail === 'function' ? (mod.dshErrLogTail(serviceName) || '') : '';
  } catch { return ''; }
}

/** 失败结果附加 err 日志尾部（空串则不加字段，保持响应形状最小）。 */
function withDiagLog(result, serviceName) {
  const dt = diagTailSafe(serviceName);
  return dt ? Object.assign({}, result, { diagLog: dt }) : result;
}
const stageInstall = require('./stage-install.cjs');
const findStagedTarball = stageInstall.findStagedTarball;
const installStagedTarball = stageInstall.installStagedTarball;
module.exports = {
  name: 'dsh-prompt-enhancer',  ...plugin,
  // v3.3.x（A5/A6·测试与救援 CLI 复用导出）：staging 安装内部函数显式导出——
  // 拦截演练（坏包语法门）与批次二维护菜单直接复用同一实现，杜绝逻辑分叉。
  installStagedTarball,
  findStagedTarball,
  // 2026-09-12（安全修复 H1/H2·单测锚定）：RPC 来源栅栏 / cmd 值安全化 / 请求体读取——内部导出供单测复用同一实现
  isTrustedRpcRequest,
  cmdSafeValue,
  readBody,
  registerRpcRoute,
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
