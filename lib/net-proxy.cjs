// v3.2.15（undici 重构·替换手写隧道）：共享网络代理工具。
// resolveProxy：显式 HTTPS_PROXY 环境变量 > Windows 系统代理（注册表 Internet Settings）> null；
//   代理类型：env socks5://socks5h:// → socks5；env http(s):// → http；系统代理 → socks5（本机 v2rayN/Clash 常见）；
// httpsGetProxied：统一出网入口，改用 undici fetch + ProxyAgent/Socks5ProxyAgent——
//   替换手写 HTTP CONNECT 隧道 / SOCKS5 协议 / HTTP/1.1 流解析（历史边界 bug：双重 TLS 400、
//   connectReq 挂死、setTimeout 兼容）。接口契约不变：返回 EventEmitter 风格 req
//   （.on('error')/.destroy()/.setTimeout()），onResponse(res) 的 res 仍是 Node 风格
//   （.statusCode/.headers[小写]/.on('data')/.pipe()/.resume()/.on('error')/.on('end')）。
// curlProxyArgs：给 curl 类命令拼 -x 参数（环境检查 / nssm 下载等）。
'use strict';

const http = require('node:http');
const tls = require('node:tls');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { fetch, ProxyAgent, Socks5ProxyAgent } = require('undici');

let _sysProxy = null;
let _sysProxyAt = 0;
const TTL = 60000;

/** Windows 系统代理（注册表：ProxyEnable + ProxyServer，支持 "host:port" / "http=..;https=.." 分段） */
function systemProxyWin() {
  const now = Date.now();
  if (_sysProxy && now - _sysProxyAt < TTL) return _sysProxy;
  _sysProxy = null;
  try {
    const en = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'], { encoding: 'utf8', windowsHide: true });
    if (!/0x1\b/.test(String(en.stdout || ''))) { _sysProxyAt = now; return null; }
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'], { encoding: 'utf8', windowsHide: true });
    const m = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(String(r.stdout || ''));
    if (!m) return null;
    const parts = String(m[1]).split(';');
    const sel = parts.find((p) => /^https=/i.test(p)) || parts.find((p) => !p.includes('='));
    const hp = String(sel || '').replace(/^https=/i, '').trim();
    const hm = /^([^:]+):(\d+)$/.exec(hp);
    if (hm) {
      _sysProxy = { host: hm[1], port: Number(hm[2]) || 8080 };
      _sysProxyAt = now;
      return _sysProxy;
    }
  } catch (e) { /* 注册表不可读 → 无系统代理 */ }
  return null;
}

/** 解析代理（仅 https 目标走隧道）→ { host, port, type } | null；type: http|socks5|auto */
function resolveProxy(url) {
  if (!String(url).startsWith('https:')) return null;
  const env = process.env;
  const key = env.HTTPS_PROXY || env.https_proxy;
  if (key) {
    try {
      const raw = String(key).trim();
      if (/^socks5h?:\/\//i.test(raw)) {
        const u = new URL(raw);
        return { host: u.hostname, port: Number(u.port) || 1080, type: 'socks5' };
      }
      const u = new URL(String(key).includes('://') ? raw : 'http://' + raw);
      return { host: u.hostname, port: Number(u.port) || 8080, type: 'http' };
    } catch (e) { /* 环境变量格式错误 → 落系统代理 */ }
  }
  if (process.platform === 'win32') {
    const sp = systemProxyWin();
    // v3.2.14：Windows 系统代理注册表无协议信息；实测 v2rayN/Clash 类工具系统代理
    // 常为 SOCKS 端口（本机 10808=SOCKS，HTTP CONNECT 无响应）。直接按 SOCKS5 处理；
    // 真 HTTP 代理场景用户可用 HTTPS_PROXY 环境变量显式指定（type=http 走 CONNECT 隧道）。
    if (sp) return { host: sp.host, port: sp.port, type: 'socks5' };
  }
  return null;
}

/** curl 用代理参数（无代理返回空数组；socks5 代理 curl 用 --socks5-hostname） */
function curlProxyArgs() {
  const p = resolveProxy('https://placeholder.invalid/');
  if (!p) return [];
  if (p.type === 'socks5') return ['--socks5-hostname', p.host + ':' + p.port];
  return ['-x', 'http://' + p.host + ':' + p.port];
}

/** SOCKS5 连接（RFC 1928：握手 + CONNECT，支持域名/IPv4/IPv6）→ 已连接 socket。
 *  v3.2.15：httpsGetProxied 已改用 undici Socks5ProxyAgent，本函数保留仅为兼容旧调用方，新代码勿用。 */
function socks5Connect(proxy, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxy.host, port: proxy.port });
    let stage = 0; // 0=握手, 1=connect 响应
    let buf = Buffer.alloc(0);
    let timeout = setTimeout(() => { try { sock.destroy(); } catch (e) {} reject(new Error('socks5 timeout')); }, 15000);
    sock.on('connect', () => sock.write(Buffer.from([0x05, 0x01, 0x00])));
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) { try { sock.destroy(); } catch (e) {} clearTimeout(timeout); reject(new Error('socks5 handshake rejected')); return; }
        stage = 1;
        buf = Buffer.alloc(0);
        const hostBuf = Buffer.from(targetHost, 'utf8');
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf,
          Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
        ]);
        sock.write(req);
        return;
      }
      // CONNECT 响应：VER CMD RSV ATYP [地址] PORT
      if (buf.length < 4) return;
      const atyp = buf[3];
      let addrLen;
      if (atyp === 0x01) addrLen = 4;
      else if (atyp === 0x04) addrLen = 16;
      else if (atyp === 0x03) addrLen = 1 + buf[4];
      else { try { sock.destroy(); } catch (e) {} clearTimeout(timeout); reject(new Error('socks5 bad atyp')); return; }
      if (buf.length < 4 + addrLen + 2) return;
      if (buf[1] !== 0x00) { try { sock.destroy(); } catch (e) {} clearTimeout(timeout); reject(new Error('socks5 connect fail code=' + buf[1])); return; }
      clearTimeout(timeout);
      resolve(sock);
    });
    sock.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

/**
 * 经 HTTP 代理 CONNECT 隧道发起 HTTPS GET。
 * v3.2.15：保留（供旧调用方/诊断用）；httpsGetProxied 已不再走本函数。
 * 流程：http.request CONNECT → 200 后 tls.connect(socket) 完成 TLS → 等 secureConnect →
 * https.request({ createConnection: () => tlsSocket }) 复用隧道 socket（标准 IncomingMessage）。
 */
function tunnelRequest(url, headers, onResponse, onError) {
  const u = new URL(url);
  const pr = resolveProxy(url);
  if (!pr || pr.type === 'socks5') { onError(new Error('no http proxy')); return null; }
  const connectReq = http.request({ host: pr.host, port: pr.port, method: 'CONNECT', path: u.host + ':443' });
  connectReq.on('connect', (res, rawSocket) => {
    if (res.statusCode !== 200) { try { rawSocket.destroy(); } catch (e) {} onError(new Error('proxy CONNECT ' + res.statusCode)); return; }
    const tlsSocket = tls.connect({ socket: rawSocket, servername: u.host });
    tlsSocket.on('secureConnect', () => {
      try {
        // 同 httpsGetProxied.startTls：tlsSocket 已 TLS → 用 http.request 写明文 HTTP
        const req = http.request({ hostname: u.host, path: u.pathname + u.search, headers, createConnection: () => tlsSocket }, onResponse);
        req.on('error', onError);
        req.end();
      } catch (e) { onError(e); }
    });
    tlsSocket.on('error', onError);
  });
  connectReq.on('error', onError);
  return connectReq;
}

// 代理 Agent 缓存（同代理复用连接池——大文件下载避免每次新建 CONNECT/SOCKS 隧道）。
// 注意 undici 坑：ProxyAgent 不接受请求 header 里的 proxy-authorization（抛 InvalidArgumentError），
// 凭证只能放构造器（本工具无代理认证场景，故不涉及）。
const _agentCache = new Map(); // key -> ProxyAgent | Socks5ProxyAgent
function agentForProxy(pr) {
  const key = pr.type + '://' + pr.host + ':' + pr.port;
  let a = _agentCache.get(key);
  if (a) return a;
  a = pr.type === 'socks5'
    ? new Socks5ProxyAgent('socks5://' + pr.host + ':' + pr.port)
    : new ProxyAgent('http://' + pr.host + ':' + pr.port);
  _agentCache.set(key, a);
  return a;
}

/**
 * 统一出网入口（undici fetch 实现）：有代理 → ProxyAgent（http CONNECT）/ Socks5ProxyAgent（socks5）；
 * 无 → 直接 fetch。返回 EventEmitter 风格 req（.on('error')/.destroy()/.setTimeout()，调用方契约不变）。
 * onResponse(res)：res 为 Node 风格响应（.statusCode/.headers[小写]/.on('data')/.pipe()/.resume()/.on('error')/.on('end')）。
 * onProgress(dl, total)：可选第 4 参（调用方未传时进度由 res.on('data') 自算，行为与旧版一致）。
 */
function httpsGetProxied(url, headers, onResponse, onProgress) {
  const u = new URL(url); // 非法 URL 同步抛错（调用方 try/catch 接住，与旧版一致）
  const emitter = new EventEmitter();
  const controller = new AbortController();
  let destroyed = false;
  let settled = false; // error 已 emit（防重复）
  let timer = null;
  let timeoutMs = 0;
  let timeoutFn = null;

  const fail = (e) => {
    if (settled || destroyed) return;
    settled = true;
    if (timer) { clearTimeout(timer); timer = null; }
    process.nextTick(() => emitter.emit('error', e));
  };

  // 空闲超时（与旧 tlsSocket.setTimeout 语义一致：有数据即重置；连接/重定向阶段无数据则到期触发）
  const armTimer = () => {
    if (!timeoutMs) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (destroyed || settled) return;
      if (typeof timeoutFn === 'function') timeoutFn();
      else emitter.emit('timeout');
    }, timeoutMs);
  };

  emitter.destroy = (err) => {
    if (destroyed) return;
    destroyed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    try { controller.abort(); } catch (e) {}
    // 与原生 ClientRequest 语义一致：destroy(err) 将 err 作为 'error' 冒泡（调用方据此 reject/降级）
    if (err && !settled) { settled = true; process.nextTick(() => emitter.emit('error', err)); }
  };
  emitter.setTimeout = (ms, fn) => {
    timeoutMs = ms;
    timeoutFn = fn;
    armTimer();
    return emitter;
  };

  const pr = resolveProxy(u.href);
  const dispatcher = pr ? agentForProxy(pr) : undefined;

  // 异步执行（错误经 emitter.emit('error') 冒泡；onResponse 在响应头到达后调用）
  (async () => {
    let currentUrl = u.href;
    const reqHeaders = Object.assign({}, headers || {});
    let res = null;
    try {
      // 手动跟随重定向（≤5 跳）：fetch 自动跟随会按 fetch 规范剥离跨域 CORS-unsafe 头
      // （Range 属之——HF LFS 302 → cdn-lfs.huggingface.co 跨域续传会丢 Range），
      // 必须 redirect:'manual' 自跟，每跳重带原 headers（含 Range）。
      for (let hop = 0; ; hop++) {
        if (destroyed) return;
        const opts = { redirect: 'manual', headers: reqHeaders, signal: controller.signal };
        if (dispatcher) opts.dispatcher = dispatcher;
        res = await fetch(currentUrl, opts);
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          try { await res.body.cancel(); } catch (e) {} // 必须消费/取消 body 释放连接（undici 防泄漏）
          if (loc && hop < 5) { currentUrl = new URL(loc, currentUrl).href; continue; }
          fail(new Error(loc ? 'too many redirects: ' + currentUrl.slice(0, 80) : 'HTTP ' + res.status + ' redirect no location: ' + currentUrl.slice(0, 80)));
          return;
        }
        break;
      }
      if (destroyed) return;

      // 组装 Node 风格响应对象（headers 小写；泵自动进行，调用方同步挂好监听后开始 emit data）
      const msg = new EventEmitter();
      const headersObj = {};
      for (const [k, v] of res.headers.entries()) headersObj[k] = v;
      msg.statusCode = res.status;
      msg.statusMessage = res.statusText;
      msg.headers = headersObj;
      msg.complete = false;
      msg.resume = () => {}; // 泵已自动进行（body 必须消费否则连接泄漏）
      msg.destroy = () => { try { res.body.cancel(); } catch (e) {} };
      msg.pipe = (ws) => {
        msg.on('data', (c) => ws.write(c));
        msg.on('end', () => { try { ws.end(); } catch (e) {} });
        msg.on('error', (e) => { try { ws.destroy(e); } catch (x) {} });
        return ws;
      };

      onResponse(msg);

      // 泵：逐块 emit data；调用方在 data 里自行算进度；onProgress 为可选第 4 参
      const total = Number(headersObj['content-length'] || 0);
      let dl = 0;
      try {
        for await (const chunk of res.body) {
          if (destroyed) { try { await res.body.cancel(); } catch (e) {} return; }
          dl += chunk.length;
          armTimer(); // 空闲超时重置（有数据即续期）
          msg.emit('data', chunk);
          if (onProgress) onProgress(dl, total);
        }
        msg.complete = true;
        msg.emit('end');
      } catch (e) {
        if (destroyed) return; // destroy(err) 已自行冒泡
        msg.emit('error', e);
      }
    } catch (e) {
      if (destroyed) return; // destroy() 触发的 AbortError 由 destroy(err) 自行冒泡
      fail(e);
    }
  })();

  return emitter;
}

module.exports = { resolveProxy, systemProxyWin, curlProxyArgs, tunnelRequest, httpsGetProxied, socks5Connect };
