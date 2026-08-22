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
const netProxy = require('./net-proxy.cjs');

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

/**
 * v3.2.10（用户需求·DSH Desktop 适配）：当前是否运行在桌面客户端（Electron shell）内。
 * 判定信号：Electron 运行时（web 实例 = 纯 node，无 process.versions.electron）或
 * execPath 含 'DSH Desktop'（Electron exe 路径）。桌面端 web 端口随机（listen 0），
 * 无 nssm 服务概念——所有「固定 3080 / 服务模式 / 管理员快捷方式」逻辑须按此分流。
 */
function isDesktop() {
  try {
    if (process.versions && process.versions.electron) return true;
    const ep = String(process.execPath || '');
    return /DSH[ _-]?Desktop/i.test(ep);
  } catch (e) { return false; }
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
  // B1：pid 探测委托 dshPrimPortHolder（单一事实源）；本函数补会话号维度（tasklist CSV 第 4 列）
  const pid = dshPrimPortHolder(port);
  if (!pid) return { pid: 0, session: -1 };
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
      return ['tools', 'net', 'port-mode', 'port-pid'].map((key) => ({
        key, ok: false, warn: true, level: 'warn', detail: 'tool-unreachable',
      }));
    }
  }

  // 平台服务后端（win: sc/reg/nssm；linux: systemctl；darwin: launchctl；其他: null）
  const backend = platformService.backendFor(process.platform);
  const det = backend ? backend.detectService(svc, env)
    : { exists: false, enabled: false, detail: 'unsupported-platform', tool: 'unsupported' };

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
    const r = runProbe('curl', [...netProxy.curlProxyArgs(), '-s', '-m', '6', '-o', 'NUL', '-w', '%{http_code}', 'https://api.github.com/rate_limit'], env);
    const reachable = r.ok && String(r.stdout || '').trim() === '200';
    items.push({ key: 'net', ok: reachable, warn: !reachable, detail: reachable ? 'ok' : 'unreachable' });
  }

    // 3. port-mode + port-pid — 3080 托管模式（v3.2.1-v 用户审核·去重收敛）：
  //    一档状态机覆盖「服务是否存在 + 是否在跑 + 谁托管 3080」（原 service/svc-type/svc-bin 三项冗余删除）：
  //      service           nssm 服务接管（监听者会话 0）——隐含服务存在且 Running
  //      service-stopped   服务存在但未运行（3080 无监听）——端口重启会走服务模式拉起
  //      default           前台默认运行（监听者用户会话）——隐含无服务
  //      no-listener       无监听且无服务——DSH 未运行
  {
    // v3.2.10（DSH Desktop 适配）：桌面客户端端口随机（listen 0）+ 无 nssm 服务概念——
    // port-mode 返回专有 'desktop' 态、port-pid = 本进程（Desktop 主进程），不探测 3080
    // （3080 可能是 web 实例/无关进程的端口，探测会误判——实测 Desktop 上探测到 web 实例 PID）。
    // web 场景（isDesktop()=false）保持原逻辑：3080 监听者会话判定 service/default 等。
    if (isDesktop()) {
      items.push({ key: 'port-mode', ok: true, detail: 'desktop', level: 'warn' });
      items.push({ key: 'port-pid', ok: true, detail: String(process.pid), level: 'warn' });
    } else {
    const holder = probePortHolder(3080, env);
    let mode = 'no-listener';
    if (holder.pid > 0) {
      mode = holder.session === 0 ? 'service' : (holder.session > 0 ? 'default' : 'pid-only');
      items.push({ key: 'port-mode', ok: true, detail: mode, level: 'warn' });
      items.push({ key: 'port-pid', ok: true, detail: String(holder.pid), level: 'warn' });
    } else {
      // 无监听：区分「服务存在但未运行」（Stopped，端口重启可拉起）与「无服务」
      if (det.exists) mode = 'service-stopped';
      items.push({ key: 'port-mode', ok: false, warn: true, detail: mode, level: 'warn' });
      items.push({ key: 'port-pid', ok: false, warn: true, detail: 'no-listener', level: 'warn' });
    }
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

/**
 * v3.3.x（A5·安装即快照）：把「可回退状态」快照到 $DSH_HOME/rescue/<ts>/。
 * 范围：profile 四文件（package.json / pnpm-workspace.yaml / cordis.patch.yml——
 * 官方分层前三层的落盘物）+ home 级 cordis.patch.yml + 指定运行环境的关键产物
 * （plugin-host.js / lib/*.cjs，供坏版本文件级回滚）。
 * 原子性（G16）：先写 <dir>.tmp 再 rename；附 meta.json（时间/reason/清单）。
 * 纪律：尽力而为——任何失败返回 {ok:false}，绝不阻断主安装流程。
 * opts 全部可注入（测试）；缺省按本机 DSH_HOME/web profile 解析。
 */
const RESCUE_KEEP = 10;

function rescueRoot(dshHomeOverride) {
  const home = dshHomeOverride || process.env.DSH_HOME ||
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  return path.join(home, 'rescue');
}

function rescueSnapshot(opts) {
  const o = opts || {};
  try {
    const home = o.dshHome || process.env.DSH_HOME ||
      path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
    const profileName = o.profileName || (isDesktop() ? 'desktop' : 'web');
    const profileDir = o.profileDir || path.join(home, 'profiles', profileName);
    const runtimeDir = o.runtimeDir || path.join(profileDir, 'node_modules', 'dsh-prompt-enhancer');
    const stampBase = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    // 同秒多快照防撞名：已存在则追加 -N 序号（prune 正则同步兼容）
    let suffix = 0;
    while (fs.existsSync(path.join(o.root || rescueRoot(home), stampBase + (suffix ? '-' + suffix : '')))) suffix++;
    const dir = path.join(o.root || rescueRoot(home), stampBase + (suffix ? '-' + suffix : ''));
    const tmp = dir + '.tmp';
    fs.mkdirSync(tmp, { recursive: true });
    const manifest = { ts: new Date().toISOString(), reason: o.reason || 'manual', profile: profileName, files: [] };
    const put = (src, destName) => {
      if (!src || !fs.existsSync(src)) return;
      const dest = path.join(tmp, destName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true, force: true });
      manifest.files.push(destName);
    };
    // 配置层四文件（G13：home 级 patch 同样可被污染）
    put(path.join(profileDir, 'package.json'), 'profile-package.json');
    put(path.join(profileDir, 'pnpm-workspace.yaml'), 'profile-pnpm-workspace.yaml');
    put(path.join(profileDir, 'cordis.patch.yml'), 'profile-cordis.patch.yml');
    put(path.join(home, 'cordis.patch.yml'), 'home-cordis.patch.yml');
    // 运行环境关键产物（坏版本回滚锚点）
    if (runtimeDir && fs.existsSync(runtimeDir)) {
      for (const f of ['plugin-host.js', 'plugin-client.js']) put(path.join(runtimeDir, f), 'runtime/' + f);
      const libDir = path.join(runtimeDir, 'lib');
      if (fs.existsSync(libDir)) {
        for (const f of fs.readdirSync(libDir)) {
          if (/\.cjs$/.test(f)) put(path.join(libDir, f), 'runtime/lib/' + f);
        }
      }
    }
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(tmp, dir); // 原子落位（G16）
    pruneRescueSnapshots({ keep: RESCUE_KEEP, root: path.dirname(dir) });
    return { ok: true, dir, files: manifest.files.length };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

/** 快照保留策略（G10）：仅清理本工具命名格式的时间戳目录，保留最近 keep 份。 */
function pruneRescueSnapshots(opts) {
  const o = opts || {};
  try {
    const root = o.root || rescueRoot();
    const keep = Number.isInteger(o.keep) ? o.keep : RESCUE_KEEP;
    if (!fs.existsSync(root)) return;
    const dirs = fs.readdirSync(root)
      .filter((d) => /^\d{8}-\d{6}(-\d+)?$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs.slice(keep)) {
      try { fs.rmSync(path.join(root, d), { recursive: true, force: true }); } catch { /* 占用则下次再清 */ }
    }
  } catch { /* 清理失败不阻断 */ }
}

/**
 * v3.3.x（A6·干跑第三层·产物语法门）：对文件列表逐个 `node --check`（零执行），
 * 拦「包内部损坏」——组合/模块两层干跑对此盲区（resolve 只验入口可解析不执行）。
 * 返回 { ok, failures:[{file,message}] }。
 */
function syntaxCheckFiles(files, nodeExecPath) {
  const failures = [];
  const node = nodeExecPath || process.execPath;
  for (const f of files || []) {
    if (!f || !fs.existsSync(f)) continue;
    try {
      const r = spawnSync(node, ['--check', f], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      if (r.status !== 0) {
        failures.push({ file: f, message: String(r.stderr || r.stdout || ('exit ' + r.status)).slice(0, 300) });
      }
    } catch (e) {
      failures.push({ file: f, message: String(e && e.message ? e.message : e) });
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * v3.3.x（B1·端口原语集·单一事实源）：netstat/taskkill/tasklist 探测与击杀。
 * 双消费形态（方案 §11 R-b 收编形态修正）：
 *   ① 模块内直调（host index.cjs / 执行器 updater-host.cjs / CLI）——经下方 exports；
 *   ② 字符串生成脚本嵌入——生成脚本是独立 node 进程，**无法 require sys.cjs**，
 *     只能经 scriptPortPrims() 取函数**源码字符串**（Function.prototype.toString）文本嵌入。
 * 自包含纪律：每个 dshPrim* 函数体不得引用模块级闭包（fs/path/spawnSync 一律体内 require），
 * 否则嵌入后 ReferenceError。新增原语必须同步加入 PORT_PRIMS 数组（全量发射保引用闭合）。
 */
function dshPrimNetstat() {
  var cp = require('node:child_process');
  try {
    var r = cp.spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    return String(r.stdout || '');
  } catch (e) { return ''; }
}
function dshPrimPortHolder(port) {
  // 端口实际监听者 pid（无则 0）——进程索引 pid 可能滞后/指向死进程，杀实际监听者最可靠。
  // win: netstat -ano 解析 LISTENING 行；posix: lsof（会话概念不同不适用，pid-only）。
  var cp = require('node:child_process');
  if (process.platform !== 'win32') {
    try {
      var r2 = cp.spawnSync('lsof', ['-i', ':' + port, '-P', '-n'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      var m2 = /LISTEN\s+\S+\s+\d+\s+(\d+)/i.exec(String(r2.stdout || ''));
      return m2 ? Number(m2[1]) : 0;
    } catch (e2) { return 0; }
  }
  var m = new RegExp(':' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)').exec(dshPrimNetstat());
  return m ? Number(m[1]) : 0;
}
function dshPrimTaskKill(pid, tree) {
  // 强杀单 PID（默认不带 /T——脚本常在目标子进程树上，递归杀树会连带自身，历史教训 v3.2.1-l）。
  var cp = require('node:child_process');
  try {
    if (process.platform === 'win32') {
      var args = ['/F', '/PID', String(pid)];
      if (tree) args.splice(1, 0, '/T');
      cp.spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore', timeout: 15000 });
    } else {
      process.kill(Number(pid), 'SIGKILL');
    }
    return true;
  } catch (e) { return false; }
}
function dshPrimPidImage(pid) {
  // 进程镜像名（'' 失败）——杀前身份校验（v3.3.x 防误杀：索引被覆盖/死 pid 时盲杀误伤）。
  var cp = require('node:child_process');
  if (process.platform !== 'win32') return '';
  try {
    var r = cp.spawnSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    var m = /^"([^"]+)"/.exec(String(r.stdout || '').trim());
    return m ? m[1] : '';
  } catch (e) { return ''; }
}
function dshPrimPidHasListening(pid) {
  // 本 pid 是否持有任意 LISTENING（桌面版随机端口 = 就绪信号；web 就绪探测同款语义）
  var tag = String(pid);
  if (process.platform !== 'win32') return false;
  return dshPrimNetstat().split(/\r?\n/).some(function (l) {
    return l.indexOf('LISTENING') !== -1 && l.indexOf(tag) !== -1;
  });
}
const PORT_PRIMS = [dshPrimNetstat, dshPrimPortHolder, dshPrimTaskKill, dshPrimPidImage, dshPrimPidHasListening];

/**
 * 生成脚本用的端口原语源码块（全量发射——原语间存在内部引用，缺一会 ReferenceError）。
 * 生成脚本顶部插入一次即可调用全部 dshPrim*。
 */
function scriptPortPrims() {
  return '// ==dsh-port-prims (B1 single-source: lib/sys.cjs — generated embed, do not edit here)==\n' +
    PORT_PRIMS.map((f) => 'var ' + f.name + ' = ' + f.toString() + ';').join('\n');
}

/** 异步等 pid 退出（模块内直调形态；生成脚本自带轮询控制流不经此）。 */
function waitPidExit(pid, timeoutMs, pollMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + (Number(timeoutMs) || 5000);
    const step = () => {
      let alive = true;
      try { process.kill(Number(pid), 0); } catch (e) { alive = e && e.code === 'EPERM'; }
      if (!alive) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(step, Number(pollMs) || 250);
    };
    step();
  });
}

/**
 * B1 原语：按端口清理监听者并确认退出。
 * opts.expectImage 正则命中才动手（身份校验，防误杀）；仍存活且 opts.tree 时升级树杀一次。
 */
async function killPortHolder(port, opts) {
  const o = opts || {};
  const pid = dshPrimPortHolder(port);
  if (!pid) return { ok: true, killed: false, pid: 0 };
  const image = dshPrimPidImage(pid);
  if (o.expectImage && !(o.expectImage instanceof RegExp ? o.expectImage.test(image) : String(o.expectImage).test(image))) {
    return { ok: false, code: 'IDENTITY_MISMATCH', pid, image };
  }
  dshPrimTaskKill(pid, false);
  let gone = await waitPidExit(pid, 3000);
  if (!gone && o.tree) {
    dshPrimTaskKill(pid, true);
    gone = await waitPidExit(pid, 3000);
  }
  return { ok: gone, killed: true, pid, image, code: gone ? undefined : 'STILL_ALIVE' };
}

/**
 * v3.3.x（批次二·快照回滚底座）：把 rescueSnapshot 产物回写回原位。
 * 映射：profile-* 三件套 → profile 目录；home-cordis.patch.yml → $DSH_HOME；
 * runtime/* → 运行环境目录。opts.exactHomePatch=true 时「快照没有 home patch 而现在有」
 * 视为污染一并删除（忠实恢复；默认仅告警不动手）。
 */
function rescueRestore(dir, opts) {
  const o = opts || {};
  const out = { ok: true, restored: [], warnings: [] };
  try {
    const metaPath = path.join(dir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const files = Array.isArray(meta.files) ? meta.files : [];
    const home = o.home || process.env.DSH_HOME ||
      path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
    const profileName = o.profileName || meta.profile || 'web';
    const profileDir = o.profileDir || path.join(home, 'profiles', profileName);
    const runtimeDir = o.runtimeDir || path.join(profileDir, 'node_modules', 'dsh-prompt-enhancer');
    const copyBack = (snapRel, dest) => {
      const src = path.join(dir, snapRel);
      if (!fs.existsSync(src)) return false;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true, force: true });
      out.restored.push(dest);
      return true;
    };
    copyBack('profile-package.json', path.join(profileDir, 'package.json'));
    copyBack('profile-pnpm-workspace.yaml', path.join(profileDir, 'pnpm-workspace.yaml'));
    copyBack('profile-cordis.patch.yml', path.join(profileDir, 'cordis.patch.yml'));
    if (files.includes('home-cordis.patch.yml')) {
      copyBack('home-cordis.patch.yml', path.join(home, 'cordis.patch.yml'));
    } else if (fs.existsSync(path.join(home, 'cordis.patch.yml'))) {
      if (o.exactHomePatch) {
        fs.unlinkSync(path.join(home, 'cordis.patch.yml'));
        out.restored.push(path.join(home, 'cordis.patch.yml') + '（已删，快照期不存在）');
      } else {
        out.warnings.push('home-cordis.patch.yml 快照期不存在但当前存在（可能为快照后新污染），未动（exactHomePatch 可强制删）');
      }
    }
    for (const rel of files.filter((f) => f.startsWith('runtime/'))) {
      copyBack(rel, path.join(runtimeDir, rel.slice('runtime/'.length)));
    }
    if (out.restored.length === 0) out.warnings.push('快照目录无可回写文件');
  } catch (e) {
    out.ok = false;
    out.warnings.push(String(e && e.message ? e.message : e));
  }
  return out;
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
  isDesktop,
  runProbe,
  readServicePort,
  probeEnv,
  // B1 端口原语集（单一事实源；生成脚本嵌套源码见 scriptPortPrims）
  portHolderPid: dshPrimPortHolder,
  pidHasListening: dshPrimPidHasListening,
  pidImageName: dshPrimPidImage,
  taskKill: dshPrimTaskKill,
  scriptPortPrims,
  waitPidExit,
  killPortHolder,
  rescueSnapshot,
  rescueRestore,
  pruneRescueSnapshots,
  syntaxCheckFiles,
  RESCUE_KEEP,
};
