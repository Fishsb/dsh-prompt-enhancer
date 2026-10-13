// v3.2.15（undici 重构·替换手写隧道）：共享网络代理工具。
// resolveProxy：显式 HTTPS_PROXY 环境变量 > Windows 系统代理（注册表 Internet Settings）> null；
//   代理类型：env socks5://socks5h:// → socks5；env http(s):// → http；系统代理 → socks5（本机 v2rayN/Clash 常见）；
// ⚠ P2 复核处置批（2026-10-13 · F3）：原 `httpsGetProxied` / `httpsGetDirect` / `agentForProxy`
//   三条（undici fetch 出口 + 降级直连 + 代理 Agent 缓存，共 217 行）**已整体退役** ——
//   自 `30fe098`（P2-2）把导出面收为 `{curlProxyArgs}` 起，它们从**唯一活导出**出发即
//   **不可达**（实测可达集 = `curlProxyArgs → resolveProxy → systemProxyWin`），且全仓
//   （含 test/）**零消费者**。其处理的「出网」场景在本插件已无调用方（更新/安装交回官方）。
//   ⇒ 依「判据/对象整体消失 ⇒ 退役正确」删除；**随之一并失活**的是 `undici` 依赖本身
//   （本模块曾是唯一真实引用点）——级联处置见同批 T2。
// curlProxyArgs：给 curl 类命令拼 -x 参数（环境检查 / nssm 下载等）。**仍是本模块唯一活导出。**
'use strict';

const { spawnSync } = require('node:child_process');
// ⚠ P2 复核处置批（2026-10-13）：`tls` / `net` / `EventEmitter` 三个 import 与 undici 惰性加载段
//   均**随上述三条函数一并退役**（它们只被那三条用到）。undici 依赖本身亦已从
//   `package.json` dependencies 移除（本模块曾是全仓唯一真实引用点）。

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




module.exports = {curlProxyArgs};
