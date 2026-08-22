'use strict';
/**
 * M4: ExecutorReloader — external updater executor fallback.
 *
 * Implements the Reloader surface by calling the standalone updater-host RPC
 * (`apply`). This is the fallback path until platform-native hot reload is
 * available.
 *
 * v3.3.x（A1·端口发现·红线修复）：旧实现硬编码 3081 且从不读 executor.port——
 * 执行器 EADDRINUSE 时会 listen(0) 漂移动态端口并写端口文件
 * （lib/updater-host.cjs 同款模式），此时本模块恒 EXECUTOR_UNREACHABLE，
 * 违反 devref 端口红线「禁止硬编码连接固定端口而不留 fallback」。
 * 发现顺序：显式 options.port → ping 3081 → 读 executor.port 再 ping 动态口。
 * v3.3.x（G8·缓存失效）：解析结果带 TTL 缓存；RPC 往返失败即失效缓存重探一轮，
 * 防执行器中途崩溃换动态口后缓存失真。portFile 路径可经 options.portFile 注入（测试）。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_EXECUTOR_PORT = 3081;
const PORT_CACHE_TTL_MS = 60000;

/** 与 lib/sys.cjs EXECUTOR_ROOT 同源：外挂目录不在 node_modules 内。 */
function defaultExecutorPortFile() {
  const root = process.env.DSH_ENHANCER_EXECUTOR_ROOT ||
    path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || 'C:\\Users\\Public', 'dsh-prompt-enhancer', 'executor');
  return path.join(root, 'executor.port');
}

/** 读 executor.port {port,pid,ts}，返回合法端口或 0（缺失/损坏/越界一律 0）。 */
function readPortFilePort(filePath) {
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const port = Number(obj && obj.port);
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port;
  } catch (e) { /* 无文件 / 损坏 / 越界 → 视同无动态口 */ }
  return 0;
}

function rpcCall(port, method, args) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ method, args: args || {} });
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/rpc',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({ ok: false, code: 'BAD_RESPONSE' }); }
      });
    });
    req.on('error', () => resolve({ ok: false, code: 'EXECUTOR_UNREACHABLE' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'EXECUTOR_TIMEOUT' }); });
    req.end(payload);
  });
}

function createExecutorReloader(options) {
  // 显式注入端口（测试/特殊部署）仍最优先，但不再是无 fallback 的硬编码
  const fixedPort = options && Number.isInteger(options.port) ? options.port : 0;
  const portFile = (options && options.portFile) || defaultExecutorPortFile();
  const repo = options && options.repo ? options.repo : 'Fishsb/dsh-prompt-enhancer';

  let cachedPort = 0;
  let cachedAt = 0;

  async function ping(port) {
    const pong = await rpcCall(port, 'ping', {});
    return pong && pong.ok === true ? port : 0;
  }

  /**
   * 端口发现（带 TTL 缓存）：fixed → 3081 → executor.port 动态口。
   * 返回 0 = 全部候选不可达。
   */
  async function resolvePort() {
    const now = Date.now();
    if (cachedPort && now - cachedAt < PORT_CACHE_TTL_MS) return cachedPort;
    const candidates = [];
    if (fixedPort) candidates.push(fixedPort);
    candidates.push(DEFAULT_EXECUTOR_PORT);
    for (const c of candidates) {
      const ok = await ping(c);
      if (ok) { cachedPort = ok; cachedAt = Date.now(); return ok; }
    }
    const dyn = readPortFilePort(portFile);
    if (dyn) {
      const ok = await ping(dyn);
      if (ok) { cachedPort = ok; cachedAt = Date.now(); return ok; }
    }
    return 0;
  }

  /** 缓存可能失真（执行器换口）→ 失效后强制重探一轮。 */
  async function resolvePortFresh() {
    cachedPort = 0;
    return resolvePort();
  }

  async function isSupported() {
    return (await resolvePort()) !== 0 || (await resolvePortFresh()) !== 0;
  }

  async function reload(profile, pkg) {
    let port = await resolvePort();
    if (!port) port = await resolvePortFresh();
    if (!port) {
      return { ok: false, code: 'EXECUTOR_UNREACHABLE', message: 'executor 不可达（3081 与 executor.port 均未命中）' };
    }
    const res = await rpcCall(port, 'apply', {
      repo,
      tag: pkg && pkg.tag ? pkg.tag : '',
      profile,
      serviceName: (pkg && pkg.serviceName) || 'dsh-web',
    });
    // RPC 层不可达说明缓存端口已失效 → 作废，下次调用重探
    if (!res || res.code === 'EXECUTOR_UNREACHABLE') cachedPort = 0;
    return res;
  }

  return { isSupported, reload, resolvePort, resolvePortFresh };
}

module.exports = { createExecutorReloader, rpcCall, readPortFilePort, defaultExecutorPortFile };
