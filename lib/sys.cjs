'use strict';
/**
 * dsh-prompt-enhancer — shared system primitives (v2.6.0).
 *
 * Single source of truth used by BOTH the bundle entry (lib/index.cjs) and the
 * independent update executor (lib/updater-host.cjs). Everything here must be
 * plain node (child_process/fs) — no DSH services, no harness, no sandbox.
 */
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

const INSTALL_REPO = 'Fishsb/dsh-prompt-enhancer';
const PROBE_TIMEOUT_MS = 15000;
const INSTALL_TIMEOUT_MS = 120000;
// 独立执行器版本（bundle ensure 与执行器自身共用；与插件版本解耦，协议变更时递增）
// v2.7.0：0.1.0 → 0.1.1（健康检查端口自解析 / DSH_DSH_BIN 注入）→ 0.1.2（CORS 头修复）——
// v2.7.2：0.1.2 → 0.1.3（重启循环改「每轮 stop+start」组合，失败轮不再裸 start）——
// 每次行为修复递增，触发 executorEnsure 版本对齐 kill 旧执行器重建（否则旧代码不会上线）
const EXECUTOR_VERSION = '0.1.3';
const EXECUTOR_PORT = 3081;
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
  return new Function(pureText + '\n;return { mergeEnvPath, buildRestartPlan, buildInstallArgs };')();
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

/** Whitelist gate for restart plan args. */
function isRestartPlanArgs(args) {
  return !!args && typeof args === 'object' &&
    typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName) &&
    Number.isInteger(args.port) && args.port > 0 && args.port <= 65535 &&
    Number.isInteger(args.maxAttempts) && args.maxAttempts >= 1 && args.maxAttempts <= 5;
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
 * v2.7.0: executorPort param — exec-port 检查（更新端口独立：≠服务端口且未被占用）；
 * svc-bin 降级链（nssm Application → 原生 ImagePath → 跳过）；tools 重启工具检查；
 * 删除 port 占用检查（标准场景不可达，no-port 语义并入 exec-port）。
 * v2.7.1（通用适用性修复）：① 工具可达性预检——where 解析失败（PATH 失效/系统异常）
 * 时全部检查项降级 warn tool-unreachable（避免把「工具不可达」误报成「服务/配置缺失」block）；
 * ② svc-bin 依赖 service 状态（服务不存在 → no-service 而非误报 ok）；
 * ③ net 网络预检恢复（GitHub 可达性，warn——安装依赖 GitHub，不可达时前置提示）。
 */
function probeEnv(serviceName, pure, env, executorPort) {
  const svc = /^[A-Za-z0-9_-]+$/.test(serviceName) ? serviceName : 'dsh-web';
  const items = [];

  // 0. 工具可达性预检（v2.7.1）：where 无法解析 sc.exe（PATH 失效/命令缺失）→
  //    所有命令型检查不可信——统一降级为 warn tool-unreachable，不误报对象缺失
  {
    const w = runProbe('where', ['sc.exe'], env);
    if (!w.ok) {
      return ['service', 'svc-type', 'svc-bin', 'tools', 'net', 'exec-port'].map((key) => ({
        key, ok: false, warn: true, level: 'warn', detail: 'tool-unreachable',
      }));
    }
  }

  // 服务端口（exec-port 使用）
  const portInfo = readServicePort(svc, env);

  // 1. service — sc query finds the service
  let serviceExists = false;
  {
    const r = runProbe('sc', ['query', svc], env);
    const ok = r.ok && /STATE\s*:\s*\d+\s+(RUNNING|STOPPED)/i.test(r.stdout);
    serviceExists = ok;
    items.push({ key: 'service', ok, warn: !ok, detail: ok ? 'ok' : 'missing' });
  }

  // 2. svc-type + svc-bin — 重启阶段直接依赖（启用状态 / 可执行文件存在）
  {
    const r = runProbe('sc', ['qc', svc], env);
    const qcOut = r.ok ? r.stdout : '';
    // svc-type：START_TYPE != DISABLED(4)（禁用则 net start 直接失败）
    const st = /START_TYPE\s*:\s*(\d+)/i.exec(qcOut);
    const enabled = r.ok && st !== null && Number(st[1]) !== 4;
    items.push({ key: 'svc-type', ok: enabled, warn: !enabled, detail: enabled ? 'ok' : 'disabled' });
    // svc-bin（v2.7.0 降级链）：nssm Parameters\Application → SCM 原生 ImagePath 首段 → 均无则跳过。
    // 覆盖两种安装形态：nssm（本机）与原生 sc create（未装 nssm、ImagePath 直指启动程序）。
    // 可执行文件解析：去引号取首段（"C:\a b\app.exe" --arg 或 C:\no\space\app.exe --arg）+ 展开环境变量。
    const resolveExe = (raw) => {
      let exe = String(raw || '').trim();
      if (exe.startsWith('"')) {
        const end = exe.indexOf('"', 1);
        exe = end === -1 ? exe.slice(1) : exe.slice(1, end);
      } else {
        exe = exe.split(/\s+/)[0];
      }
      const sr = process.env.SystemRoot || 'C:\\WINDOWS';
      exe = exe.replace(/%SystemRoot%/gi, sr).replace(/%WINDIR%/gi, sr)
        .replace(/%ProgramFiles%/gi, process.env.ProgramFiles || 'C:\\Program Files')
        .replace(/%ProgramFiles\(x86\)%/gi, process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
      if (exe === '') return null;
      return fs.existsSync(exe);
    };
    let binOk = true;
    let binDetail = 'ok';
    let binLevel = null;
    // v2.7.1（通用适用性修复）：服务不存在 → 服务程序检查无对象可查，报 no-service（warn）
    // 而非误报 ok——服务缺失已由 service 项（block）拦截，本项不重复阻断
    if (!serviceExists) {
      binOk = false;
      binDetail = 'no-service';
      binLevel = 'warn';
    } else {
      const ar = runProbe('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + svc + '\\Parameters', '/v', 'Application'], env);
      if (ar.ok) {
        const m = /Application\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(ar.stdout);
        if (m) {
          const chk = resolveExe(m[1]);
          if (chk === false) { binOk = false; binDetail = 'bin-missing'; }
        }
      } else {
        // 非 nssm：SCM 原生 ImagePath（首段可执行文件）
        const ir = runProbe('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + svc, '/v', 'ImagePath'], env);
        if (ir.ok) {
          const im = /ImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(ir.stdout);
          if (im) {
            const chk = resolveExe(im[1]);
            if (chk === false) { binOk = false; binDetail = 'image-missing'; }
          }
        }
        // 两项注册表项都读不到 → 默认通过（不误报）
      }
    }
    items.push({ key: 'svc-bin', ok: binOk, warn: !binOk, detail: binDetail, ...(binLevel ? { level: binLevel } : {}) });
  }

  // 3. tools — 重启链系统工具可用（sc/netstat/reg，SystemRoot\System32）
  //    （执行器重启链 sc stop/start/query + netstat 健康检查 + reg 端口解析全部依赖；
  //    mergedEnv 已兜底 System32，此处验证兜底目标的文件真实存在）
  {
    const sr = process.env.SystemRoot || process.env.windir || 'C:\\WINDOWS';
    const missing = ['sc.exe', 'netstat.exe', 'reg.exe'].filter((f) => !fs.existsSync(sr + '\\System32\\' + f));
    const ok = missing.length === 0;
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

  // 4. exec-port — 更新端口独立：≠ 服务端口且未被占用
  //    （执行器监听失败 → listen EADDRINUSE → 进程退出，一键更新直接不可用）
  {
    const exPort = Number.isInteger(executorPort) && executorPort > 0 && executorPort <= 65535
      ? executorPort : EXECUTOR_PORT;
    let ok = true;
    let detail = 'ok';
    if (!portInfo.ok) {
      // 服务端口解析失败（无 --port）→ 无法确认独立（承接原 port 检查的 no-port 语义）
      ok = false;
      detail = 'no-port';
    } else if (portInfo.port === exPort) {
      ok = false;
      detail = 'same-as-service';
    } else {
      const r = runProbe('netstat', ['-ano', '-p', 'tcp'], env);
      if (r.ok) {
        const re = new RegExp(':' + exPort + '\\s+\\S+\\s+LISTENING\\s+(\\d+)');
        const m = re.exec(r.stdout);
        if (m && Number(m[1]) !== process.pid) {
          // 端口被监听：占用者若是 node.exe（执行器形态——当前执行器或旧执行器残留，
          // executorEnsure 会版本对齐 kill 重建）→ 正常；否则 → 被无关进程占用 → warn。
          const tr = runProbe('tasklist', ['/FO', 'CSV', '/NH'], env);
          if (tr.ok) {
            const line = String(tr.stdout).split(/\r?\n/)
              .find((l) => l.indexOf('","' + m[1] + '",') !== -1);
            const name = line ? /^"([^"]+)"/.exec(line.trim()) : null;
            if (!name || !/node(\.exe)?$/i.test(name[1])) {
              ok = false;
              detail = 'exec-occupied';
            }
            // node.exe → 疑似执行器（正常；若实为无关 node 进程，executorEnsure ping
            // 失败 → spawn EADDRINUSE → EXECUTOR_START_FAILED 报错兜底）
          }
        }
      }
    }
    items.push({ key: 'exec-port', ok, warn: !ok, detail });
  }

  return items;
}

module.exports = {
  INSTALL_REPO,
  INSTALL_TIMEOUT_MS,
  EXECUTOR_VERSION,
  EXECUTOR_PORT,
  readRegPathValue,
  readUserPath,
  readSystemPath,
  extractPure,
  mergedEnv,
  isInstallArgs,
  isRestartPlanArgs,
  runProbe,
  readServicePort,
  probeEnv,
};
