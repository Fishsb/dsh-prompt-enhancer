'use strict';
// P2-3（2026-10-13 拆分批）：**RPC 网关与 HTTP 栅栏域** —— 原 `lib/index.cjs` D2 段整体移入。
// 职责：本插件 RPC 路由的传输面——来源栅栏（同源/跨站）、请求体上限、JSON 读写、路由注册。
//
// ⚠ 载体说明：本模块是**真 CommonJS**（非 src/host chunk）。它处理 `request`/`response` 需要
// Node 原生能力，而 `plugin-host.js`（BODY）经 `new Function` 求值、作用域无 require ⇒
// 该域**物理上只能留在 lib/ 侧**（ADR-230 ③）。本批拆分**未触碰载体**（`new Function` 仍在
// `lib/index.cjs`，三选一待用户拍板）。
//
// ⚠ 本文件是**仓库提交物**，不是构建产物（不得由任何 build 脚本生成；`sync-runtime` 的 md5
// 清单经 `lib/*.cjs` 动态枚举自动纳入）。

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

/**
 * 注册 RPC 路由。依赖全部**显式注入**（模块间只经显式接口，P-M3；不共享全局可变状态）：
 *   deps = { RPC_PATH, handlers:Map, validateRpcArgs }
 * ⚠ 对外签名（`lib/index.cjs` 导出的 `registerRpcRoute(ctx)`）保持**单参**不变 —— 由 index.cjs
 * 做一层薄包装注入 deps，故既有单测 `RPCG-05`（单参调用）**无需改动**。
 */
function registerRpcRoute(ctx, deps) {
  const { RPC_PATH, handlers, validateRpcArgs } = deps;
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

// ⚠ `writeJson` 是**模块内私有**辅助（仅本文件的 handler 用）⇒ **不进导出面**：
//   R5 判「导出面无消费者 = 死码」，把它导出会制造一个假死码项（P2-3 首跑实测命中）。
module.exports = { RPC_BODY_LIMIT, isTrustedRpcRequest, readBody, registerRpcRoute };
