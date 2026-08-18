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
const { validateRpcArgs } = require('./rpc-schema.cjs');

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
 */
function ensureExternalExecutor(version) {
  const root = sys.executorDir(version);
  const libDir = path.join(root, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const copies = [
    [path.join(__dirname, 'updater-host.cjs'), path.join(libDir, 'updater-host.cjs')],
    [path.join(__dirname, 'sys.cjs'), path.join(libDir, 'sys.cjs')],
    [path.join(__dirname, 'integrity.cjs'), path.join(libDir, 'integrity.cjs')],
    [path.join(__dirname, '..', 'plugin-host.js'), path.join(root, 'plugin-host.js')],
  ];
  for (const [src, dst] of copies) {
    if (!fs.existsSync(src)) throw new Error('missing executor file: ' + src);
    if (!fs.existsSync(dst) || fs.statSync(src).mtimeMs > fs.statSync(dst).mtimeMs) {
      fs.copyFileSync(src, dst);
    }
  }
  return root;
}

/** Fallback: old direct detached spawn (used only if schtasks is unavailable). */
function spawnExecutorDirect(port, version) {
  const ver = version || sys.EXECUTOR_VERSION;
  const root = ensureExternalExecutor(ver);
  const logPath = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'dsh-updater-host.log');
  const out = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [path.join(root, 'lib', 'updater-host.cjs')], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
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
  fs.closeSync(out);
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
 * standalone SYSTEM process. Unlike a plain detached child, a scheduled task
 * is owned by the Task Scheduler service, so it survives `sc stop dsh-web`
 * (plain detached children of the service are killed with the service tree
 * on this host — see updater-host.log ending at "restart start").
 */
function buildExecutorTaskXml(port, taskName, cmdPath, workingDir) {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:/Windows';
  const cmdExe = path.join(systemRoot, 'System32', 'cmd.exe');
  const args = '/c "' + cmdPath + '"';
  const wd = workingDir || sys.executorDir(sys.EXECUTOR_VERSION);
  return '<?xml version="1.0" encoding="UTF-16"?>' + CRLF +
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' + CRLF +
    '  <RegistrationInfo><Description>dsh-prompt-enhancer updater executor</Description></RegistrationInfo>' + CRLF +
    '  <Triggers><TimeTrigger><StartBoundary>2099-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>' + CRLF +
    '  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>' + CRLF +
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
  const schtasks = path.join(systemRoot, 'System32', 'schtasks.exe');
  const tmp = process.env.TEMP || 'C:/Windows/Temp';
  const taskName = 'dsh-prompt-enhancer-exec-' + process.pid + '-' + Date.now();
  const xmlPath = path.join(tmp, taskName + '.xml');
  const cmdPath = path.join(tmp, taskName + '.cmd');
  const logPath = path.join(tmp, 'dsh-updater-host.log');
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
    const xml = buildExecutorTaskXml(port, taskName, cmdPath, executorRoot);
    fs.writeFileSync(xmlPath, '\ufeff' + xml, 'utf16le');
  } catch (e) {
    try { fs.unlinkSync(cmdPath); } catch { /* ignore */ }
    return spawnExecutorDirect(port);
  }
  const create = spawnSync(schtasks, ['/Create', '/TN', taskName, '/XML', xmlPath, '/F'], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (create.status !== 0) {
    try { fs.unlinkSync(xmlPath); } catch { /* ignore */ }
    try { fs.unlinkSync(cmdPath); } catch { /* ignore */ }
    return spawnExecutorDirect(port);
  }
  const run = spawnSync(schtasks, ['/Run', '/TN', taskName], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  try { fs.unlinkSync(xmlPath); } catch { /* ignore */ }
  if (run.status !== 0) {
    try { fs.unlinkSync(cmdPath); } catch { /* ignore */ }
    try { spawnSync(schtasks, ['/Delete', '/TN', taskName, '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* ignore */ }
    return spawnExecutorDirect(port);
  }
  return null;
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
 * v3.2：Node 直接生成 Windows .lnk（Shell Link Binary Format）。
 * 替代 WScript.Shell——实测 SYSTEM 会话下 WScript.Shell 写 IconLocation 被忽略
 * （TargetPath 等正常，图标字段不落盘），Node 写二进制完全可控、跨环境一致。
 * 结构：Header + LinkInfo(LocalBasePath) + StringData(RelativePath/Arguments/IconLocation) + TerminalBlock。
 */
function buildLnk({ target, args, iconPath }) {
  const HEADER_SIZE = 76;
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(HEADER_SIZE, 0);
  Buffer.from('01140200000000C000000000000046', 'hex').copy(header, 4); // LinkCLSID
  // LinkFlags: HasLinkInfo(0x02)|HasRelativePath(0x08)|HasArguments(0x20)|HasIconLocation(0x40)|IsUnicode(0x80)
  header.writeUInt32LE(0x02 | 0x08 | 0x20 | 0x40 | 0x80, 0x14);
  header.writeUInt32LE(0x20, 0x18); // FILE_ATTRIBUTE_ARCHIVE
  header.writeInt32LE(0, 0x38);     // IconIndex
  header.writeUInt32LE(1, 0x3C);    // ShowCommand SW_SHOWNORMAL
  // LinkInfo（VolumeIDAndLocalBasePath）
  const u16z = (s) => Buffer.from(s + '\u0000', 'utf16le');
  const localBase = u16z(target);
  const volumeId = Buffer.alloc(0x10); volumeId.writeUInt32LE(0x10, 0);
  const localBaseOffset = 0x1C + volumeId.length;
  const commonSuffixOffset = localBaseOffset + localBase.length;
  const linkInfoSize = commonSuffixOffset + 2;
  const linkInfo = Buffer.alloc(linkInfoSize);
  linkInfo.writeUInt32LE(linkInfoSize, 0);
  linkInfo.writeUInt32LE(0x1C, 4);       // LinkInfoHeaderSize
  linkInfo.writeUInt32LE(0x01, 8);       // VolumeIDAndLocalBasePath
  linkInfo.writeUInt32LE(0x1C, 12);      // VolumeIDOffset
  linkInfo.writeUInt32LE(localBaseOffset, 16); // LocalBasePathOffset
  linkInfo.writeUInt32LE(0, 20);         // CommonNetworkRelativeLinkOffset
  linkInfo.writeUInt32LE(commonSuffixOffset, 24); // CommonPathSuffixOffset
  volumeId.copy(linkInfo, 0x1C);
  localBase.copy(linkInfo, localBaseOffset);
  linkInfo.writeUInt16LE(0, commonSuffixOffset); // CommonPathSuffix '\0'
  // StringData（按 Flags 位序：RelativePath → Arguments → IconLocation）
  const strings = [];
  const addS = (s) => {
    const b = Buffer.from(s, 'utf16le');
    const len = Buffer.alloc(2); len.writeUInt16LE(s.length);
    strings.push(len, b, Buffer.from([0, 0]));
  };
  addS('.');      // RelativePath
  addS(args);     // Arguments
  addS(iconPath); // IconLocation
  return Buffer.concat([header, linkInfo, ...strings, Buffer.alloc(4)]); // TerminalBlock
}

harness.handle('update/makeShortcut', async (args) => {
    try {
      const svc = args && typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName)
        ? args.serviceName : 'dsh-web';
      const profile = args && typeof args.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(args.profile)
        ? args.profile : 'web';
      const nodePath = process.execPath;
      const executorEntry = path.join(sys.executorDir(sys.EXECUTOR_VERSION), 'lib', 'updater-host.cjs');
      if (!fs.existsSync(executorEntry)) {
        return { ok: false, code: 'EXECUTOR_MISSING', message: 'executor entry not found: ' + executorEntry };
      }
      // 1. 写 CLI 脚本（.cmd，含 chcp 65001 中文 + pause 窗口不闪退）
      const cliDir = path.join(sys.EXECUTOR_ROOT, 'cli');
      fs.mkdirSync(cliDir, { recursive: true });
      const cmdPath = path.join(cliDir, 'restart-dsh.cmd');
      const esc = (p) => '"' + String(p).replace(/"/g, '\\"') + '"';
      const cmdBody = '@echo off\r\n' +
        'chcp 65001 >nul\r\n' +
        'title DSH 端口重启\r\n' +
        'echo.\r\n' +
        'echo === DSH 端口重启（CLI）===\r\n' +
        'echo.\r\n' +
        esc(nodePath) + ' ' + esc(executorEntry) + ' --cli restart --service ' + svc + ' --profile ' + profile + '\r\n' +
        'echo.\r\n' +
        'pause\r\n';
      fs.writeFileSync(cmdPath, cmdBody, 'utf8');
      // 2. 创建桌面快捷方式（USERPROFILE 由 nssm 设为 C:\Users\lk → 桌面路径正确）。
      //    v3.2（用户需求）：图标 DeepSeek 蓝色鲸鱼——插件包 assets/deepseek.ico 复制到
      //    EXECUTOR_ROOT/icons/ → .lnk IconLocation（复制失败则默认 cmd 图标，不阻断）。
      //    Node 直接生成 .lnk（buildLnk）——WScript.Shell 在 SYSTEM 会话不写 IconLocation。
      const desktop = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop');
      // v3.2（用户需求）：快捷方式名「重启DSH」；旧名「重启DSH服务」删除避免重复
      const lnkPath = path.join(desktop, '重启DSH.lnk');
      try { if (fs.existsSync(path.join(desktop, '重启DSH服务.lnk'))) fs.unlinkSync(path.join(desktop, '重启DSH服务.lnk')); } catch { /* ignore */ }
      const cmdExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
      let iconPath = '';
      try {
        const iconSrc = path.join(__dirname, '..', 'assets', 'deepseek.ico');
        if (fs.existsSync(iconSrc)) {
          const iconDir = path.join(sys.EXECUTOR_ROOT, 'icons');
          fs.mkdirSync(iconDir, { recursive: true });
          iconPath = path.join(iconDir, 'deepseek.ico');
          fs.copyFileSync(iconSrc, iconPath);
        }
      } catch { /* 图标复制失败 → 不设图标（默认 cmd 图标） */ }
      const lnkArgs = '/c "' + cmdPath + '"';
      const lnkBuf = buildLnk({ target: cmdExe, args: lnkArgs, iconPath });
      fs.writeFileSync(lnkPath, lnkBuf);
      if (!fs.existsSync(lnkPath)) {
        return { ok: false, code: 'SHORTCUT_MISSING', message: 'shortcut not created: ' + lnkPath };
      }
      // 读回 .lnk 验证图标是否写入（.lnk 内字符串为 UTF-16LE）
      const iconApplied = iconPath !== '' && fs.readFileSync(lnkPath).toString('utf16le').includes('deepseek.ico');
      return { ok: true, shortcutPath: lnkPath, cmdPath, iconApplied };
    } catch (e) {
      return { ok: false, code: 'SHORTCUT_EXCEPTION', message: String(e && e.message ? e.message : e) };
    }
  });

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
