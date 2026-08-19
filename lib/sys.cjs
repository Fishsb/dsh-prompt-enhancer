'use strict';
/**
 * dsh-prompt-enhancer — shared system primitives (v2.6.0).
 *
 * Single source of truth used by BOTH the bundle entry (lib/index.cjs) and the
 * independent update executor (lib/updater-host.cjs). Everything here must be
 * plain node (child_process/fs) — no DSH services, no harness, no sandbox.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const platformService = require('./platform-service.cjs');

const INSTALL_REPO = 'Fishsb/dsh-prompt-enhancer';
const PROBE_TIMEOUT_MS = 15000;
const INSTALL_TIMEOUT_MS = 120000;
// 独立执行器版本（bundle ensure 与执行器自身共用；与插件版本解耦，协议变更时递增）
// v2.7.0：0.1.0 → 0.1.1（健康检查端口自解析 / DSH_DSH_BIN 注入）→ 0.1.2（CORS 头修复）——
// v2.7.2：0.1.2 → 0.1.3（重启循环改「每轮 stop+start」组合，失败轮不再裸 start）——
// v2.8.1：0.1.3 → 0.1.4（执行器改由 Task Scheduler 拉起，脱离 dsh-web 服务进程树——
//   修复 `sc stop dsh-web` 时旧执行器被连带杀死导致重启链路中断）
// v2.8.3：0.1.4 → 0.1.5（apply 先停服务再安装——修复 Windows 下运行中插件文件被占用，
//   导致 pnpm 替换 node_modules 目录 EPERM / install timed out）
// v2.9.0（未发布）：0.1.5 → 0.1.6（执行器外挂到 node_modules 之外 + staging 预拉取/预校验，
//   停服后本地安装；修复执行器自身 CWD 仍在插件目录导致 EPERM 的根因）
// v3.1.x（用户指令·职责划分）：0.1.7 → 0.1.8（apply 仅下载+校验到 staging（终态 staged，零端口操作）；
//   安装与全部端口操作（断开/监听/重启）统一由 `restart` RPC 承载——带 tag 时在停服窗口内安装后重启）
// v3.1.5（用户实测·重启第一次必然失败）：0.1.8 → 0.1.9（sc start 后健康检查从「固定等 8s 检查一次」
//   改为「最长 20s 每 1s 探测、端口通了立即 healthy」——DSH 冷启动常超 8s，旧窗口 round 1 稳定失败）
// v3.1.5（用户实测·假 healthy）：0.1.9 → 0.1.10（sc stop 后必须确认服务真的 STOPPED 才继续——
//   此前 10s 循环后不检查结果，执行器无权限（sc stop 拒绝访问）时服务没停、旧进程仍占端口，
//   探测立即通过 → 误判 healthy；现未停成直接失败返回 STOP_FAILED，不再假成功）
// v3.1.6（用户指令·PID 校验）：0.1.10 → 0.1.11（重启成功判定从「端口监听」升级为
//   「端口监听 + 服务 PID 已更新（新 PID ≠ 关闭前 PID）」——仅端口监听会被旧进程残留
//   占用误判，PID 变化才证明服务进程真正重启过）
// 每次行为修复递增，触发 executorEnsure 版本对齐 kill 旧执行器重建（否则旧代码不会上线）
const EXECUTOR_VERSION = '0.1.12';
const EXECUTOR_PORT = 3081;
// v2.9.0：执行器外挂目录（不在 node_modules 内），staging 与备份也放这里。
const EXECUTOR_ROOT = process.env.DSH_ENHANCER_EXECUTOR_ROOT ||
  path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || 'C:\\Users\\Public', 'dsh-prompt-enhancer', 'executor');
const STAGING_DIR = path.join(EXECUTOR_ROOT, 'staging');
const BACKUP_DIR = path.join(EXECUTOR_ROOT, 'backups');
const USER_PATH_CACHE = { value: null, at: 0 };
const SYS_PATH_CACHE = { value: null, at: 0 };
const USER_PATH_TTL_MS = 60000;

/** Read a Path value from a registry environment key ('' when absent). */
function readRegPathValue(hiveKey) {
  try {
    const r = spawnSync('reg', ['query', hiveKey, '/v', 'Path'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    if (r.status !== 0 || r.error) return '';
    const lines = String(r.stdout || '').split(/\r?\n/);
    for (const line of lines) {
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line);
      if (m) return m[1].trim();
    }
  } catch { /* fallthrough */ }
  return '';
}

/** Read the user-level PATH (HKCU\Environment\Path), 60s cached. */
function readUserPath() {
  const now = Date.now();
  if (USER_PATH_CACHE.value !== null && now - USER_PATH_CACHE.at < USER_PATH_TTL_MS) {
    return { ok: true, path: USER_PATH_CACHE.value };
  }
  const val = readRegPathValue('HKCU\\Environment');
  if (val === '') return { ok: false };
  USER_PATH_CACHE.value = val;
  USER_PATH_CACHE.at = now;
  return { ok: true, path: val };
}

/** Read the machine-level PATH (HKLM ...\Session Manager\Environment), 60s cached. */
function readSystemPath() {
  const now = Date.now();
  if (SYS_PATH_CACHE.value !== null && now - SYS_PATH_CACHE.at < USER_PATH_TTL_MS) {
    return SYS_PATH_CACHE.value;
  }
  const val = readRegPathValue('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
  SYS_PATH_CACHE.value = val;
  SYS_PATH_CACHE.at = now;
  return val;
}

/** Reuse PURE-section helpers from plugin-host.js (single source of truth). */
function extractPure(body) {
  const begin = body.indexOf('// ==PURE-BEGIN==');
  const end = body.indexOf('// ==PURE-END==');
  if (begin === -1 || end <= begin) throw new Error('PURE markers not found');
  const pureText = body.slice(begin, end);
  return new Function(pureText + '\n;return { mergeEnvPath, buildRestartPlan, buildInstallArgs, buildTarballUrl, buildLocalInstallArgs };')();
}

/**
 * Child env with a complete PATH: registry system PATH + user PATH merged,
 * plus SystemRoot\System32 as a hard guarantee. Do NOT rely on process.env.PATH
 * alone — the service process PATH was observed missing system32 (v2.5.1 debug).
 */
function mergedEnv(pure) {
  const env = { ...process.env };
  const sys = readSystemPath() || (typeof process.env.PATH === 'string' ? process.env.PATH : '');
  const up = readUserPath();
  const user = up.ok ? up.path : '';
  let merged = pure.mergeEnvPath(sys, user);
  const sr = process.env.SystemRoot || process.env.windir || 'C:\\WINDOWS';
  merged = pure.mergeEnvPath(merged, sr + '\\System32');
  env.PATH = merged;
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

/** Whitelist gate: local staged tarball install command (staging dir only). */
function isLocalTarballInstallArgs(args) {
  if (!Array.isArray(args) || args.length !== 6) return false;
  const [bin, cmd, flag, profile, add, tarball] = args;
  if (typeof bin !== 'string' || bin === '' ||
      typeof cmd !== 'string' || cmd !== 'plugin' ||
      flag !== '--profile' || typeof profile !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(profile) ||
      add !== 'add' || typeof tarball !== 'string') return false;
  if (!/\.tgz$|\.tar\.gz$/i.test(tarball)) return false;
  const resolved = path.resolve(tarball);
  const staging = path.resolve(STAGING_DIR);
  return resolved.startsWith(staging + path.sep);
}

/** Whitelist gate for restart plan args. */
function isRestartPlanArgs(args) {
  return !!args && typeof args === 'object' &&
    typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName) &&
    Number.isInteger(args.port) && args.port > 0 && args.port <= 65535 &&
    Number.isInteger(args.maxAttempts) && args.maxAttempts >= 1 && args.maxAttempts <= 5;
}

/** External executor home for a given executor version. */
function executorDir(version) {
  return path.join(EXECUTOR_ROOT, String(version || 'current'));
}

// v3.2.1-t（架构调整·执行器内容哈希重建）：执行器「内容版本」——基于插件包 lib 目录
// 全部 .cjs 文件 + plugin-host.js 的内容哈希。executorEnsure 以此判断执行器副本是否过期：
// 代码一变哈希即变 → 强制重建/重启，**不再依赖手动 bump EXECUTOR_VERSION**
// （历史教训：v3.2.1-p 镜像 fallback 因版本号没变、执行器不重建而一直不生效）。
function executorContentHash() {
  try {
    const crypto = require('node:crypto');
    const names = fs.readdirSync(__dirname).filter((f) => f.endsWith('.cjs')).sort();
    const hostP = path.join(__dirname, '..', 'plugin-host.js');
    const h = crypto.createHash('sha1');
    for (const n of names) {
      const p = path.join(__dirname, n);
      if (fs.statSync(p).isFile()) h.update(fs.readFileSync(p));
    }
    if (fs.existsSync(hostP) && fs.statSync(hostP).isFile()) h.update(fs.readFileSync(hostP));
    return h.digest('hex').slice(0, 12);
  } catch {
    return 'unknown';
  }
}

/** Read the executor content hash marker from a deployed executor dir. */
function readExecutorHash(version) {
  try {
    const p = path.join(executorDir(version), '.executor-hash');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

/** DSH profile directory (used for reading installed plugin version). */
function profileDir(profile) {
  const home = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Public';
  return path.join(home, '.dsh', 'profiles', profile);
}

/** Read the currently installed dsh-prompt-enhancer version from a profile. */
function readInstalledPluginVersion(profile) {
  try {
    const p = path.join(profileDir(profile), 'node_modules', 'dsh-prompt-enhancer', 'package.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return typeof data.version === 'string' && data.version !== '' ? data.version : null;
  } catch {
    return null;
  }
}

/** True when any block-level envcheck item is failing. */
function isEnvcheckBlocked(items) {
  return Array.isArray(items) && items.some((it) => it && it.level === 'block' && it.ok === false);
}

/** Run a whitelisted probe command synchronously (system32 tools; PATH always reachable). */
function runProbe(cmd, args, env) {
  const CMD_ALLOW = new Set(['where', 'sc', 'reg', 'netstat', 'curl', 'tasklist']);
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

/**
 * Read --port from the service config（平台化：Windows nssm AppParameters /
 * Linux systemd ExecStart / macOS launchctl print 或 plist；fallback: process env port）。
 */
function readServicePort(serviceName, env) {
  const backend = platformService.backendFor(process.platform);
  if (backend) {
    const r = backend.readPort(serviceName, env);
    if (r.ok) return { ok: true, port: r.port };
  }
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0) return { ok: true, port: envPort };
  return { ok: false };
}

/**
 * v3.2.1-o（用户需求·环境检测重构）：3080 端口监听者探测——返回 { pid, session }。
 *   win: netstat -ano -p tcp（:PORT LISTENING pid）+ tasklist CSV（会话号，第 4 列）；
 *   无监听 → { pid: 0, session: -1 }；工具失败 → { pid: 0, session: -1 }（调用方不误报）。
 */
function probePortHolder(port, env) {
  if (process.platform !== 'win32') {
    // linux/mac：lsof 拿 pid；会话概念不同——session 恒 0 视为「服务态」不适用，返回 pid-only
    const r = runProbe('lsof', ['-i', ':' + port, '-P', '-n'], env);
    if (!r.ok) return { pid: 0, session: -1 };
    const m = /LISTEN\s+\S+\s+\d+\s+(\d+)/i.exec(r.stdout);
    return m ? { pid: Number(m[1]), session: -1 } : { pid: 0, session: -1 };
  }
  const r = runProbe('netstat', ['-ano', '-p', 'tcp'], env);
  if (!r.ok) return { pid: 0, session: -1 };
  const re = new RegExp(':' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)');
  const m = re.exec(r.stdout);
  if (!m) return { pid: 0, session: -1 };
  const pid = Number(m[1]);
  const tr = runProbe('tasklist', ['/FO', 'CSV', '/NH'], env);
  let session = -1;
  if (tr.ok) {
    const line = String(tr.stdout).split(/\r?\n/).find((l) => l.indexOf('","' + pid + '",') !== -1);
    if (line) {
      const cols = line.match(/"([^"]*)"/g) || [];
      const s = cols.length >= 4 ? Number(cols[3].replace(/"/g, '')) : NaN;
      session = Number.isInteger(s) ? s : -1;
    }
  }
  return { pid, session };
}

/**
 * v2.5.0 environment probes (read-only, no side effects).
 * Keys match ENV_PROBE_KEYS in plugin-host.js PURE section.
 * v2.7.0: executorPort param — exec-port 检查（更新端口独立：≠服务端口且未被占用）；
 * svc-bin 降级链（nssm Application → 原生 ImagePath → 跳过）；tools 重启工具检查；
 * 删除 port 占用检查（标准场景不可达，no-port 语义并入 exec-port）。
 * v2.7.1（通用适用性修复）：① 工具可达性预检——where 解析失败（PATH 失效/系统异常）
 * 时全部检查项降级 warn tool-unreachable（避免把「工具不可达」误报成「服务/配置缺失」block）；
 * ② svc-bin 依赖 service 状态（服务不存在 → no-service 而非误报 ok）；
 * ③ net 网络预检恢复（GitHub 可达性，warn——安装依赖 GitHub，不可达时前置提示）。
 * v3.2.1-o（用户需求）：删除 exec-port（readServicePort 对默认端口必然解析失败 + v3.2
 * 执行器动态端口 fallback 后已无意义），新增 port-mode（3080 托管模式：nssm 服务/前台
 * 默认/无监听）与 port-pid（3080 实际监听者 PID）——用户关心的「端口是谁在托管」。
 */
function probeEnv(serviceName, pure, env, executorPort) {
  const svc = /^[A-Za-z0-9_-]+$/.test(serviceName) ? serviceName : 'dsh-web';
  const items = [];

  // 0. 工具可达性预检（v2.7.1；2026-08-18 平台化）：平台服务工具可解析
  //    （win: where sc.exe；linux: which systemctl；darwin: which launchctl）→
  //    无法解析（PATH 失效/命令缺失）→ 所有命令型检查不可信——统一降级 warn tool-unreachable
  const toolProbe = process.platform === 'win32' ? ['where', ['sc.exe']]
    : process.platform === 'darwin' ? ['which', ['launchctl']]
    : ['which', ['systemctl']];
  {
    const w = runProbe(toolProbe[0], toolProbe[1], env);
    if (!w.ok) {
      return ['service', 'svc-type', 'svc-bin', 'tools', 'net', 'port-mode', 'port-pid'].map((key) => ({
        key, ok: false, warn: true, level: 'warn', detail: 'tool-unreachable',
      }));
    }
  }

  // 平台服务后端（win: sc/reg/nssm；linux: systemctl；darwin: launchctl；其他: null）
  const backend = platformService.backendFor(process.platform);
  const det = backend ? backend.detectService(svc, env)
    : { exists: false, enabled: false, detail: 'unsupported-platform', tool: 'unsupported' };

  // 1. service — 服务存在（平台化）
  {
    items.push({ key: 'service', ok: det.exists, warn: !det.exists, detail: det.detail });
  }

  // 2. svc-type + svc-bin — 启用状态 / 服务工具描述（平台化）
  {
    items.push({
      key: 'svc-type',
      ok: det.exists && det.enabled,
      warn: !(det.exists && det.enabled),
      detail: det.exists ? (det.enabled ? 'ok' : 'disabled') : 'missing',
    });
    // svc-bin：服务存在 → 服务工具可用（detail = 平台服务工具）；服务缺失 → no-service（warn，不重复阻断）
    items.push({
      key: 'svc-bin',
      ok: det.exists,
      warn: !det.exists,
      detail: det.exists ? det.tool : 'no-service',
      ...(!det.exists ? { level: 'warn' } : {}),
    });
  }

  // 3. tools — 重启链系统工具可用（平台化：win sc/netstat/reg 文件；linux systemctl；darwin launchctl）
  {
    let ok = true;
    if (process.platform === 'win32') {
      const sr = process.env.SystemRoot || process.env.windir || 'C:\\WINDOWS';
      const missing = ['sc.exe', 'netstat.exe', 'reg.exe'].filter((f) => !fs.existsSync(sr + '\\System32\\' + f));
      ok = missing.length === 0;
    } else {
      ok = runProbe('which', toolProbe[1], env).ok;
    }
    items.push({ key: 'tools', ok, warn: !ok, detail: ok ? 'ok' : 'tools-missing' });
  }

  // 3.5 net — GitHub 可达性（v2.7.1 恢复，warn）：一键更新安装依赖 GitHub
  //    （dsh plugin add github:...#tag）——不可达时安装必失败，前置提示避免
  //    install 阶段才 INSTALL_FAILED（大陆/受限网络通用场景）
  {
    const r = runProbe('curl', ['-s', '-m', '6', '-o', 'NUL', '-w', '%{http_code}', 'https://api.github.com/rate_limit'], env);
    const reachable = r.ok && String(r.stdout || '').trim() === '200';
    items.push({ key: 'net', ok: reachable, warn: !reachable, detail: reachable ? 'ok' : 'unreachable' });
  }

  // 4. port-mode + port-pid — 3080 托管模式（nssm 服务 / 前台默认）与当前监听者 PID
  //    （v3.2.1-o 用户需求：端口是默认还是 nssm + 当前端口 PID；替代过时的 exec-port）
  {
    const holder = probePortHolder(3080, env);
    if (holder.pid > 0) {
      const mode = holder.session === 0 ? 'service' : (holder.session > 0 ? 'default' : 'pid-only');
      items.push({ key: 'port-mode', ok: true, detail: mode, level: 'warn' });
      items.push({ key: 'port-pid', ok: true, detail: String(holder.pid), level: 'warn' });
    } else {
      items.push({ key: 'port-mode', ok: false, warn: true, detail: 'no-listener', level: 'warn' });
      items.push({ key: 'port-pid', ok: false, warn: true, detail: 'no-listener', level: 'warn' });
    }
  }

  return items;
}

/**
 * v3.2（动态端口 fallback）：执行器实际监听端口文件路径。
 * 执行器在固定端口 EADDRINUSE 时自动 fallback 到 OS 动态端口（listen 0），
 * 监听成功后把实际端口写入此文件——executorEnsure 据此发现真实端口。
 */
function executorPortFile() {
  return path.join(EXECUTOR_ROOT, 'executor.port');
}

/**
 * 读执行器端口文件 → { port, pid, ts } | null。
 * 校验：JSON 可解析、port 为整数且在 1024–65535。
 * filePathOverride 供测试注入（默认 executorPortFile()）。
 */
function readExecutorPortFile(filePathOverride) {
  try {
    const raw = fs.readFileSync(filePathOverride || executorPortFile(), 'utf8');
    const o = JSON.parse(raw);
    if (!o || !Number.isInteger(o.port) || o.port < 1024 || o.port > 65535) return null;
    return {
      port: o.port,
      pid: Number.isInteger(o.pid) ? o.pid : null,
      ts: Number.isInteger(o.ts) ? o.ts : 0,
    };
  } catch { return null; }
}

module.exports = {
  INSTALL_REPO,
  INSTALL_TIMEOUT_MS,
  EXECUTOR_VERSION,
  EXECUTOR_PORT,
  EXECUTOR_ROOT,
  STAGING_DIR,
  BACKUP_DIR,
  readRegPathValue,
  readUserPath,
  readSystemPath,
  extractPure,
  mergedEnv,
  isInstallArgs,
  isLocalTarballInstallArgs,
  isRestartPlanArgs,
  executorDir,
  executorContentHash,
  readExecutorHash,
  executorPortFile,
  readExecutorPortFile,
  profileDir,
  readInstalledPluginVersion,
  isEnvcheckBlocked,
  runProbe,
  readServicePort,
  probeEnv,
};
