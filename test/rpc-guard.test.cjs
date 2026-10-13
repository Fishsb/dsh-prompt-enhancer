'use strict';
// RPC 入口安全栅栏 + cmd 值安全化门禁（2026-09-12 只读审查 H1/H2 修复锚定）
// 背景（实测）：本插件 RPC 路由注册在 DSH web 鉴权栅栏之外——无 token 的
// `POST /dsh-prompt-enhancer/rpc`（text/plain，不触发 CORS 预检）返回 200 真实数据，
// 而 `GET /` 是 401 ⇒ 任意网页可借用户浏览器驱动 config/set / update/portRestart 等副作用。
// 本文件锚定修复：来源栅栏（同源/无来源头放行、跨源/跨站拒绝）+ 请求体上限 + cmd 值安全化，
// 并用「假 ctx 挂载真实 handler」做端到端冒烟（L3 口径：模拟 handler 真实传参形态）。
process.env.DSH_ENHANCER_NO_INDEX = '1'; // 单测不写进程索引（与仓库其它 lib 测试同口径）
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const indexMod = require('../lib/index.cjs');

test('RPCG-01 isTrustedRpcRequest：同源放行 / 跨源跨站拒绝 / 无来源头本机放行', () => {
  const req = (h) => ({ headers: h || {} });
  assert.equal(indexMod.isTrustedRpcRequest(req({ host: '127.0.0.1:3080' })), true,
    '无 Origin/Sec-Fetch-Site = 本机非浏览器调用（node/curl/单测），放行');
  assert.equal(indexMod.isTrustedRpcRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' })), true,
    '插件自身 client 的同源 fetch 必须放行');
  assert.equal(indexMod.isTrustedRpcRequest(req({ host: '127.0.0.1:3080', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })), false,
    '跨源网页简单 POST 必须拒绝（H1 主场景）');
  assert.equal(indexMod.isTrustedRpcRequest(req({ host: '127.0.0.1:3080', origin: 'https://evil.example' })), false,
    '仅有跨源 Origin 也拒绝（无 Sec-Fetch-Site 的旧浏览器）');
  assert.equal(indexMod.isTrustedRpcRequest(req({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })), false,
    '仅跨站标记也拒绝（Origin 被剥离的场景）');
  assert.equal(indexMod.isTrustedRpcRequest(req({ origin: 'null' })), false, 'Origin: null 拒绝');
  assert.equal(indexMod.isTrustedRpcRequest(req({ host: '127.0.0.1:3080', origin: 'http://localhost:3080' })), false,
    'Origin host 与 Host 头不一致即拒绝');
});

// RPCG-02（`cmdSafeValue`：剔除双引号与换行、按需转义 %）**随 P2-1 清死簇退役**（2026-10-13）：
//   其判据对象 `cmdSafeValue` 的唯一调用点 = 执行器 `.cmd` / schtasks 任务生成（`buildExecutorTaskXml`
//   / `spawnExecutor` 族），该族已随 P1-c 执行器退役整体消失；P2-1 实测簇外引用只剩注释后，
//   把函数本体与该内部导出面一并删除 ⇒ **无被判对象**。
//   ⚠ 这不是改浅：保留原用例则 `indexMod.cmdSafeValue` 为 undefined ⇒ 首行即抛 TypeError，
//     用例**永远为红**（假红）；改成「无此函数就跳过」则**永远为真**（假绿，同 A201-3 先例）。
//   ⚠ 组级意图未被削弱：本文件的 RPC 安全面仍由 RPCG-01（来源栅栏）/ RPCG-03（1MiB 体积门）/
//     RPCG-04（源码锚定，本轮收窄为栅栏+体积门，见下）/ RPCG-05（端到端 403/413/405 冒烟）覆盖。

test('RPCG-03 readBody：超 1MiB 请求体拒绝缓冲（返回 __tooLarge）', async () => {
  const req = new EventEmitter();
  req.destroy = () => {};
  const p = indexMod.readBody(req);
  req.emit('data', Buffer.alloc(1024 * 1024 + 1));
  const r = await p;
  assert.equal(r.__tooLarge, true, '超上限应短路为 __tooLarge（不再无限 push chunk）');

  const req2 = new EventEmitter();
  const p2 = indexMod.readBody(req2);
  req2.emit('data', Buffer.from('{"method":"config/get"}'));
  req2.emit('end');
  assert.deepEqual(await p2, { method: 'config/get' }, '正常体积照常解析');
});

// RPCG-04 **P2-1 收窄**（2026-10-13）：原名「…cmd 生成点全走 cmdSafeValue」，其末两条断言
//   （`DSH_DSH_BIN` 裸拼检测 + `cmdSafeValue` 走过检测）的判据对象（.cmd 生成点）已随执行器退役删除
//   ⇒ 两条一并移除。**保留四条 HTTP 栅栏 / 体积门源码锚定**（`isTrustedRpcRequest` / `FORBIDDEN_ORIGIN`
//   / `BODY_TOO_LARGE` / `RPC_BODY_LIMIT`）—— 它们是 RPC 入口安全面的**源码级**锚定，且对象仍在。
//   ⚠ 不是改浅：收窄的是**对象已消失的那两条**；留在册的四条**强度逐字不变**，且删掉的两条若保留，
//     其 `src.includes('…cmdSafeValue(dshBin, true)')` 将**永远为红**（假红）。
// P2-3（2026-10-13 拆分批）：源码锚**重锚**到 `lib/rpc-http.cjs`（HTTP 栅栏与体积门随域移动），
//   **四条断言原样保留、逐字不变**（强度未改），另加 1 条「入口接线」断言。
test('RPCG-04 源码锚定：RPC 入口带来源栅栏与体积门（P2-3：实现域 = lib/rpc-http.cjs）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rpc-http.cjs'), 'utf8');
  assert.ok(src.includes('if (!isTrustedRpcRequest(request)) {'), '缺少来源栅栏调用');
  assert.ok(src.includes("code: 'FORBIDDEN_ORIGIN'"), '缺少 403 契约码');
  assert.ok(src.includes("code: 'BODY_TOO_LARGE'"), '缺少 413 契约码');
  assert.ok(src.includes('const RPC_BODY_LIMIT = 1024 * 1024;'), '缺少体积上限常量');
  const entry = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.cjs'), 'utf8');
  assert.ok(entry.includes("require('./rpc-http.cjs')"), '入口未接线 rpc-http.cjs（拆分后成为孤儿模块）');
});

test('RPCG-05 registerRpcRoute 端到端冒烟：跨站 403 / 同源放行分发 / 超大体积 413 / 非 POST 405', async () => {
  let captured = null;
  indexMod.registerRpcRoute({ get: (k) => (k === 'webServer' ? { register: (route) => { captured = route; } } : undefined) });
  assert.ok(captured && captured.path === '/dsh-prompt-enhancer/rpc' && typeof captured.handler === 'function',
    'handler 必须注册到 /dsh-prompt-enhancer/rpc');
  const mkRes = () => ({ code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = String(b); } });
  const mkReq = (headers, body) => {
    const r = new EventEmitter();
    r.method = 'POST';
    r.headers = headers;
    r.destroy = () => {};
    process.nextTick(() => { if (body !== undefined) r.emit('data', Buffer.from(body)); r.emit('end'); });
    return r;
  };
  // ① 跨站网页简单 POST → 403（H1 修复核心断言）
  let res = mkRes();
  await captured.handler(mkReq({ host: '127.0.0.1:3080', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, '{"method":"config/get"}'), res);
  assert.equal(res.code, 403, '跨站必须 403');
  assert.match(res.body, /FORBIDDEN_ORIGIN/);
  // ② 同源 → 栅栏放行并进入正常分发（未知方法 = 404，证明不是被 403 拦下）
  res = mkRes();
  await captured.handler(mkReq({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }, '{"method":"no/such-method"}'), res);
  assert.equal(res.code, 404, '同源应进入分发（404 UNKNOWN_METHOD）');
  assert.match(res.body, /UNKNOWN_METHOD/);
  // ③ 无来源头本机调用 → 放行（本机工具链不受影响）
  res = mkRes();
  await captured.handler(mkReq({ host: '127.0.0.1:3080' }, '{"method":"no/such-method"}'), res);
  assert.equal(res.code, 404, '本机无来源头调用照常放行');
  // ④ 超大体积 → 413
  res = mkRes();
  await captured.handler(mkReq({ host: '127.0.0.1:3080' }, 'x'.repeat(1024 * 1024 + 16)), res);
  assert.equal(res.code, 413, '超 1MiB 必须 413');
  assert.match(res.body, /BODY_TOO_LARGE/);
  // ⑤ 非 POST → 405（原有契约不被破坏）
  res = mkRes();
  const getReq = new EventEmitter();
  getReq.method = 'GET';
  getReq.headers = { host: '127.0.0.1:3080' };
  getReq.destroy = () => {};
  await captured.handler(getReq, res);
  assert.equal(res.code, 405, '非 POST 仍 405');
});
