'use strict';
/**
 * 平台服务管理后端（2026-08-18 新增 · 跨平台更新重启链）。
 *
 * 统一六接口，按 process.platform 分发：
 *   detectService(svc, env) -> { exists, enabled, detail, tool }
 *   readPort(svc, env)      -> { ok, port, detail }
 *   stopService(svc, env)   -> { ok, code, message }
 *   startService(svc, env)  -> { ok, code, message }
 *   isStopped(svc, env)     -> boolean
 *   pid(svc, env)           -> number | null
 *
 * 平台实现：
 *   win32   sc / reg / nssm（原 lib/sys.cjs + updater-host.cjs 逻辑迁入，行为不变）
 *   linux   systemctl（systemd unit）
 *   darwin  launchctl（LaunchDaemon/Agent label）
 *   其他    backendFor 返回 null（不支持自动服务管理）
 *
 * 设计约束（见 docs/internal/方案-跨平台更新重启链-2026-08-18.md）：
 *   - 失败返回明确 code/message（NO_SERVICE / PERMISSION / *_FAIL），绝不假成功
 *   - 无法自动重启的环境由调用方降级提示手动重启
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ================= 纯解析函数（可单测，无命令依赖）=================

/** systemctl is-active 输出 → 'active'|'inactive'|'failed'|'missing' */
function parseSystemdActive(stdout, status) {
  const s = String(stdout || '').trim();
  if (status === 0 && s === 'active') return 'active';
  if (status === 0 && (s === 'inactive' || s === 'failed')) return s;
  return 'missing';
}
/** systemctl is-enabled 输出 → boolean（仅 status 0 且 enabled） */
function parseSystemdEnabled(stdout, status) {
  return status === 0 && String(stdout || '').trim() === 'enabled';
}
/** systemctl show ExecStart 输出 → --port 值 | null */
function parseSystemdExecStartPort(stdout) {
  const m = /--port[ =](\d+)/.exec(String(stdout || ''));
  return m ? Number(m[1]) : null;
}
/** systemctl show MainPID 输出 → PID | null（0 = 未运行）。支持 --value（直接值）与 MainPID=N 格式。 */
function parseSystemdMainPid(stdout) {
  const s = String(stdout || '').trim();
  const v = Number(s);
  if (Number.isInteger(v) && v > 0) return v; // --value 输出纯数字
  const m = /MainPID=(\d+)/.exec(s);
  const pid = m ? Number(m[1]) : 0;
  return pid > 0 ? pid : null;
}
/**
 * launchctl list 输出 → { exists, running, pid }。
 * 官方格式：三列 `PID Status Label`（第一列 PID，'-' = 未运行；第二列 Status = 上次退出码）。
 * 参考：launchctl list | grep myagent → `12783 0 com.example.myagent`。
 */
function parseLaunchctlList(stdout, status) {
  const exists = status === 0;
  const m = /^(\d+|-)\s+(\d+)\s+(\S+)/m.exec(String(stdout || ''));
  const pid = m ? Number(m[1]) : 0;
  return { exists, running: exists && m !== null && m[1] !== '-', pid: pid > 0 ? pid : null };
}
/** 任意文本提取 --port 值 | null（systemd ExecStart / launchctl print / plist 通用） */
function parsePortFlag(text) {
  const m = /--port[ =](\d+)/.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}
/** sc query 输出 → 'RUNNING'|'STOPPED'|'missing' */
function parseScState(stdout, status) {
  const s = String(stdout || '');
  if (status !== 0) return 'missing';
  if (/STATE\s*:\s*\d+\s+STOPPED/i.test(s)) return 'STOPPED';
  if (/STATE\s*:\s*\d+\s+RUNNING/i.test(s)) return 'RUNNING';
  return 'missing';
}
/** sc queryex 输出 → PID | null */
function parseScPid(stdout) {
  const m = /PID\s*:\s*(\d+)/i.exec(String(stdout || ''));
  return m ? Number(m[1]) : null;
}
/** sc qc 输出 → START_TYPE 数值 | null */
function parseScStartType(stdout) {
  const m = /START_TYPE\s*:\s*(\d+)/i.exec(String(stdout || ''));
  return m ? Number(m[1]) : null;
}

/** 统一命令执行（与 sys.runProbe 同构，避免循环依赖）。 */
function defaultProbe(cmd, args, env) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 8000, env });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error || null,
  };
}
let _probe = defaultProbe;
function probe(cmd, args, env) { return _probe(cmd, args, env); }
/** 测试钩子：替换命令执行实现（单测 mock 用；传 null 恢复默认）。 */
function __setProbe(fn) { _probe = fn || defaultProbe; }

// ================= Windows：sc / reg / nssm =================
const win = {
  tool: 'sc/reg/nssm',
  detectService(svc, env) {
    const q = probe('sc', ['query', svc], env);
    const state = parseScState(q.stdout, q.status);
    if (state === 'missing') return { exists: false, enabled: false, detail: 'missing', tool: this.tool };
    const qc = probe('sc', ['qc', svc], env);
    const st = parseScStartType(qc.stdout);
    const enabled = st !== null && st !== 4;
    return { exists: true, enabled, detail: 'ok', tool: this.tool };
  },
  readPort(svc, env) {
    try {
      const r = probe('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + svc + '\\Parameters', '/v', 'AppParameters'], env);
      if (r.ok) {
        const p = parsePortFlag(r.stdout);
        if (p !== null) return { ok: true, port: p, detail: 'nssm' };
      }
    } catch { /* fallthrough */ }
    const envPort = Number(process.env.PORT);
    if (Number.isInteger(envPort) && envPort > 0) return { ok: true, port: envPort, detail: 'env' };
    return { ok: false, detail: 'no-port' };
  },
  stopService(svc, env) { return runSc(svc, 'stop', env); },
  startService(svc, env) { return runSc(svc, 'start', env); },
  isStopped(svc, env) {
    const r = probe('sc', ['query', svc], env);
    return parseScState(r.stdout, r.status) === 'STOPPED';
  },
  pid(svc, env) {
    const r = probe('sc', ['queryex', svc], env);
    return parseScPid(r.stdout);
  },
};
function runSc(svc, action, env) {
  const r = probe('sc', [action, svc], env);
  if (r.ok) return { ok: true };
  const msg = (r.stderr || r.stdout || '').trim();
  if (/1060|does not exist|指定的服务|Access is denied|拒绝访问|^5\b/i.test(r.stdout + r.stderr)) {
    return { ok: false, code: 'PERMISSION', message: 'sc ' + action + ' ' + svc + ' 失败（服务不存在或权限拒绝）：' + msg.slice(0, 120) };
  }
  return { ok: false, code: 'SC_' + action.toUpperCase() + '_FAIL', message: msg.slice(0, 200) };
}

// ================= Linux：systemctl（systemd）=================
const linux = {
  tool: 'systemctl',
  detectService(svc, env) {
    const a = probe('systemctl', ['is-active', svc], env);
    const st = parseSystemdActive(a.stdout, a.status);
    if (st === 'missing') return { exists: false, enabled: false, detail: 'missing', tool: this.tool };
    const e = probe('systemctl', ['is-enabled', svc], env);
    const enabled = parseSystemdEnabled(e.stdout, e.status);
    return { exists: true, enabled, detail: st, tool: this.tool };
  },
  readPort(svc, env) {
    const r = probe('systemctl', ['show', svc, '-p', 'ExecStart', '-p', 'Environment'], env);
    if (r.ok) {
      // ExecStart 内 --port（显式）优先
      const p = parseSystemdExecStartPort(r.stdout);
      if (p !== null) return { ok: true, port: p, detail: 'systemd' };
      // 社区惯例：Environment=PORT=3000（无 --port 时）
      const ep = /PORT=(\d+)/.exec(r.stdout);
      if (ep) return { ok: true, port: Number(ep[1]), detail: 'systemd-env' };
    }
    const envPort = Number(process.env.PORT);
    if (Number.isInteger(envPort) && envPort > 0) return { ok: true, port: envPort, detail: 'env' };
    return { ok: false, detail: 'no-port' };
  },
  stopService(svc, env) { return runSystemctl(svc, 'stop', env); },
  startService(svc, env) { return runSystemctl(svc, 'start', env); },
  isStopped(svc, env) {
    const r = probe('systemctl', ['is-active', svc], env);
    const st = parseSystemdActive(r.stdout, r.status);
    return st === 'inactive' || st === 'failed';
  },
  pid(svc, env) {
    // 社区惯例：systemctl show -p MainPID --value 直接输出纯数字（无需解析 MainPID=N 格式）
    const r = probe('systemctl', ['show', svc, '-p', 'MainPID', '--value'], env);
    return parseSystemdMainPid(r.stdout);
  },
};
function runSystemctl(svc, action, env) {
  const r = probe('systemctl', [action, svc], env);
  if (r.ok) return { ok: true };
  const msg = (r.stderr || r.stdout || '').trim();
  if (/not (found|loaded)|Unit .* not found/i.test(msg)) {
    return { ok: false, code: 'NO_SERVICE', message: 'systemd unit ' + svc + ' 不存在：' + msg.slice(0, 120) };
  }
  if (/permission|denied|root|not authorized|Interactive authentication/i.test(msg)) {
    return { ok: false, code: 'PERMISSION', message: 'systemctl ' + action + ' 需 root：请 sudo systemctl ' + action + ' ' + svc };
  }
  return { ok: false, code: 'SYSCTL_' + action.toUpperCase() + '_FAIL', message: msg.slice(0, 200) };
}

// ================= macOS：launchctl（launchd）=================
const darwin = {
  tool: 'launchctl',
  detectService(svc, env) {
    const r = probe('launchctl', ['list', svc], env);
    const info = parseLaunchctlList(r.stdout, r.status);
    if (!info.exists) return { exists: false, enabled: false, detail: 'missing', tool: this.tool };
    return { exists: true, enabled: true, detail: info.running ? 'running' : 'stopped', tool: this.tool };
  },
  readPort(svc, env) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const r = probe('launchctl', ['print', 'gui/' + uid + '/' + svc], env);
    if (r.ok) {
      const p = parsePortFlag(r.stdout);
      if (p !== null) return { ok: true, port: p, detail: 'launchctl' };
    }
    // 回退读 plist（ProgramArguments 含 --port）
    for (const p of plistCandidates(svc)) {
      try {
        const s = fs.readFileSync(p, 'utf8');
        const port = parsePortFlag(s);
        if (port !== null) return { ok: true, port, detail: 'plist:' + p };
      } catch { /* next */ }
    }
    const envPort = Number(process.env.PORT);
    if (Number.isInteger(envPort) && envPort > 0) return { ok: true, port: envPort, detail: 'env' };
    return { ok: false, detail: 'no-port' };
  },
  stopService(svc, env) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const r = probe('launchctl', ['bootout', 'gui/' + uid + '/' + svc], env);
    if (r.ok) return { ok: true };
    const l = probe('launchctl', ['stop', svc], env);
    if (l.ok) return { ok: true };
    return { ok: false, code: 'LAUNCHCTL_STOP_FAIL', message: ('launchctl bootout/stop ' + svc + ' 失败：' + (l.stderr || l.stdout || 'unknown')).slice(0, 200) };
  },
  startService(svc, env) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    // 对照成熟实践（openclaw 竞态事故 + launchd 文档）：bootout 后服务已从 launchd 卸载，
    // 必须先 bootstrap 重新注册 → kickstart 启动；kickstart -k 是 macOS 10.11+ 的标准重启动词
    // （launchd 无 restart 动词），但对「未加载的 job」无效——所以 bootstrap 优先。
    for (const p of plistCandidates(svc)) {
      const b = probe('launchctl', ['bootstrap', 'gui/' + uid, p], env);
      if (b.ok) {
        // 新注册 job：kickstart 触发启动（RunAtLoad/KeepAlive 也可能自动拉起，兜底 kickstart）
        probe('launchctl', ['kickstart', 'gui/' + uid + '/' + svc], env);
        return { ok: true, detail: 'bootstrapped + kickstart ' + p };
      }
      // bootstrap 失败（plist 不存在/已注册/语法错）→ 下一个候选；全失败走 kickstart -k 快速重启
    }
    // 已加载：kickstart -k 快速重启（标准重启语义）
    const k = probe('launchctl', ['kickstart', '-k', 'gui/' + uid + '/' + svc], env);
    if (k.ok) return { ok: true, detail: 'kickstart -k' };
    // 兜底：旧式 start
    const l = probe('launchctl', ['start', svc], env);
    if (l.ok) return { ok: true };
    return { ok: false, code: 'LAUNCHCTL_START_FAIL', message: 'launchctl bootstrap/kickstart/start 均失败：请手动重启（launchctl kickstart gui/' + uid + '/' + svc + '）' };
  },
  isStopped(svc, env) {
    const r = probe('launchctl', ['list', svc], env);
    const info = parseLaunchctlList(r.stdout, r.status);
    return !info.exists || !info.running;
  },
  pid(svc, env) {
    const r = probe('launchctl', ['list', svc], env);
    return parseLaunchctlList(r.stdout, r.status).pid;
  },
};
function plistCandidates(svc) {
  return [
    path.join(os.homedir(), 'Library', 'LaunchAgents', svc + '.plist'),
    '/Library/LaunchDaemons/' + svc + '.plist',
    '/Library/LaunchAgents/' + svc + '.plist',
  ];
}

/** 平台分发：返回后端对象或 null（不支持自动服务管理）。 */
function backendFor(platform) {
  if (platform === 'win32') return win;
  if (platform === 'linux') return linux;
  if (platform === 'darwin') return darwin;
  return null;
}

/**
 * 读 DSH 进程索引（host 在 DSH 进程内写入，$DSH_HOME/dsh-prompt-enhancer.json）：
 * { pid, execPath, cwd, argv }——供执行器在非服务化部署时进程级重启（参考 dsh-restart）。
 * dshHomeOverride 供测试注入；默认 process.env.DSH_HOME || ~/.dsh。
 */
function readProcessIndex(dshHomeOverride) {
  try {
    const dshHome = dshHomeOverride || process.env.DSH_HOME ||
      String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    const raw = fs.readFileSync(path.join(dshHome, 'dsh-prompt-enhancer.json'), 'utf8');
    const o = JSON.parse(raw);
    if (!o || typeof o.execPath !== 'string' || !fs.existsSync(o.execPath)) return null;
    if (!Array.isArray(o.argv)) return null;
    return { pid: Number(o.pid) || null, execPath: o.execPath, cwd: typeof o.cwd === 'string' ? o.cwd : undefined, argv: o.argv };
  } catch { return null; }
}

module.exports = {
  backendFor, win, linux, darwin, probe, plistCandidates, __setProbe, readProcessIndex,
  // 纯解析函数（单测直用，无命令依赖）
  parseSystemdActive, parseSystemdEnabled, parseSystemdExecStartPort, parseSystemdMainPid,
  parseLaunchctlList, parsePortFlag, parseScState, parseScPid, parseScStartType,
};
