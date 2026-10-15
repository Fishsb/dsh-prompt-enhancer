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

// ── RPCG-06（P2 复核处置批 2026-10-13 · T6；窄复核处置批 2026-10-13 · 处置 F-2）────────
// **入口装载链 L3 冒烟** —— 与 RPCG-05 的**分工**（互补，不重复、不互相遮蔽）：
//   · RPCG-05 = 直接调 `registerRpcRoute(ctx)`（**网关实现**单测）：403/413/405/404。
//   · RPCG-06 = 走 **`apply(ctx)`（真实宿主形态）**：验 RPCG-05 **结构性看不见**的那一层 ——
//     **入口 → 各域模块的 require 图与接线**（P2-3 新增失效面：域模块未接线 / require 路径写错 /
//     handlers 传错实例 ⇒ 该域 handler 在实际入口下**取不到**）。
//
// ⚠ **窄复核 F-2 修复**：原实现**只打 `config/get` 一条** ⇒ 断掉 `rpcVoice.register` 时
//   `voice/*` 返回 404 而本用例**仍绿**（自述覆盖「域模块未接线」这一类，实际只覆盖 1/4 个域）。
//   现改为：**从注册面派生**应被接线的原生方法集（同一事实源 `scripts/lib/lib-manifest.mjs`，
//   与 `rpc-manifest` 同口径枚举 `lib/` 下非生成 `.cjs`），**逐个**断言「经入口注册的 handler
//   不得返回 `UNKNOWN_METHOD`/404」⇒ **新增第 5 个域时自动纳入**，无需改本用例。
//
// ⚠ 隔离（承 F-3）：`lib/rpc-config.cjs` 的 `CONFIG_FILE` **在模块加载期求值**（读 `DSH_HOME`），
//   故本用例改为**子进程**驱动 —— 子进程启动时即带 `DSH_HOME=<临时目录>`，`require('lib/index.cjs')`
//   才发生在环境就位**之后**，隔离**真实成立**（父进程内 require 已在文件顶部发生，改 env 无效）。
//
// ⚠ 本判据**不覆盖什么**（如实声明）：
//   · **不判 handler 的业务正确性**（`voice/status` 在无 speech 服务时合法返回 `ok:false`；
//     若断言 `ok:true` 会造成**环境相关假红**）—— 只判「**是否被接线**」（非 404/UNKNOWN_METHOD）；
//   · **不判真实语音链路**（需真引擎/官方服务）；
//   · 不判 `plugin-host.js` 侧（bundled）的 11 条 ── 它们由 RPC-02 / rpc-manifest 的注册面派生锁覆盖；
//   · 不判各域 handler 在**异常输入**下的行为（那是各域自己的单测面）。
test('RPCG-06 入口装载链 L3 冒烟：apply() 真实注册 + 派生的全部原生方法均被接线（非 404）', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const ROOT = path.join(__dirname, '..');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rpcg06-'));

  // 子进程驱动：DSH_HOME 在**require 之前**就位 ⇒ CONFIG_FILE 求值即指向临时目录（真隔离）
  const DRIVER = `
    (async () => {
      const fs = require('node:fs'); const path = require('node:path');
      const { EventEmitter } = require('node:events');
      const ROOT = process.cwd();
      // 同一事实源派生「应被接线的原生方法集」（与 rpc-manifest 同口径）
      const lm = await import(path.join(ROOT, 'scripts', 'lib', 'lib-manifest.mjs'));
      const targets = lm.libHandwrittenTargets();
      const methods = [];
      for (const f of targets) {
        const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const m of t.matchAll(/harness\\.handle\\(\\s*'([^']+)'/g)) methods.push(m[1]);
      }
      const indexMod = require(path.join(ROOT, 'lib', 'index.cjs'));
      let captured = null;
      const webServer = { register: (r) => { captured = r; } };
      const hostCtx = { effect: (fn) => { if (typeof fn === 'function') fn(); }, get: (k) => (k === 'webServer' ? webServer : undefined) };
      const fakeCtx = { inject: (d, cb) => { cb(hostCtx); }, effect: () => {}, get: () => undefined };
      indexMod.apply(fakeCtx);
      const out = { path: captured && captured.path, hasHandler: !!(captured && typeof captured.handler === 'function'), methods: [...new Set(methods)].sort(), results: {} };
      if (!out.hasHandler) { console.log(JSON.stringify(out)); return; }
      const mkRes = () => ({ code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = String(b); } });
      const mkReq = (body) => { const r = new EventEmitter(); r.method = 'POST'; r.headers = { host: '127.0.0.1:3080' }; r.destroy = () => {}; process.nextTick(() => { r.emit('data', Buffer.from(body)); r.emit('end'); }); return r; };
      for (const m of out.methods) {
        const res = mkRes();
        await captured.handler(mkReq(JSON.stringify({ method: m })), res);
        out.results[m] = { code: res.code, body: res.body.slice(0, 200) };
      }
      // 反向：未注册方法必须 404（证明走的是真实注册表，不是兜底放行）
      const nres = mkRes();
      await captured.handler(mkReq(JSON.stringify({ method: 'no/such-method' })), nres);
      out.unknownCode = nres.code;
      console.log(JSON.stringify(out));
    })().catch((e) => { console.log(JSON.stringify({ error: String(e && e.message || e) })); });
  `;
  let out;
  try {
    const r = spawnSync(process.execPath, ['-e', DRIVER], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, DSH_HOME: home },   // ⚠ 真隔离：子进程 require 前 env 已就位
    });
    const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
    assert.ok(line, '子进程无输出（stderr: ' + String(r.stderr || '').slice(0, 300) + '）');
    out = JSON.parse(line);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  assert.ok(!out.error, '子进程抛错: ' + out.error);

  // ① apply() 真的把路由注册上（且 path = RPC_PATH）
  assert.ok(out.hasHandler, 'apply() 未注册路由（域模块未接线 / require 路径写错？）');
  assert.equal(out.path, '/dsh-prompt-enhancer/rpc', '注册 path 必须是 RPC_PATH');

  // ② 派生的方法集非空（防「派生面归零 ⇒ 循环体不执行 ⇒ 恒绿」）
  // CHG-117（2026-10-16 · 规整改造批）：原生注册面 4 → **3**（删 `voice/transcribe`；自建链退役后无调用方）。
  //   ⚠ 本断言的**意图**是「防派生面归零 ⇒ 循环体不执行 ⇒ 恒绿」，故下界随实测派生数同步为 3；
  //     仍是严格下界（归零或漏域即红），非放宽。
  assert.ok(out.methods.length >= 3, '派生的原生方法集不应为空（实测 ' + out.methods.length + ' 条）');

  // ③ **每个**派生方法都必须被接线（不得 404/UNKNOWN_METHOD）—— 覆盖全部域，自动跟上新增域
  const unwired = out.methods.filter((m) => {
    const r = out.results[m];
    return !r || r.code === 404 || /UNKNOWN_METHOD/.test(r.body || '');
  });
  assert.equal(unwired.length, 0,
    '以下已注册的原生方法在实际入口下取不到（域模块未接线）: ' + unwired.map((m) => m + '→' + ((out.results[m] || {}).code)).join(', '));

  // ④ 反向：未注册方法必须 404（证明走真实注册表，而非兜底放行）
  assert.equal(out.unknownCode, 404, '未注册方法必须 404（注册表真实生效）');

  // ⑤ 一条**确定性**业务断言（保持原用例意图）：fresh DSH_HOME ⇒ config/get 必 200 且含 config 键
  const cg = out.results['config/get'];
  assert.ok(cg && cg.code === 200, 'config/get 必须 200（实际 ' + (cg && cg.code) + '）');
  assert.ok(/"config"/.test(cg.body || ''), 'config/get 返回体必须含 config 字段（域 handler 确实被调用）');
});
