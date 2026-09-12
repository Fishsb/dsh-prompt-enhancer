'use strict';
/**
 * dsh-prompt-enhancer — independent update executor (v2.6.0).
 *
 * Standalone detached process on 127.0.0.1:DSH_EXECUTOR_PORT (default 3081).
 * 职责（2026-09-13 收窄）：**只做更新引擎**——下载 / 校验 / staging 安装 / 回滚 /
 * 一致性审计。重启能力（杀宿主、服务控制、自动看门狗、CLI 重启、维护救援菜单）已
 * 整段移除；安装就位后一律返回 needsManualRestart，由用户手动重启 DSH 使新版本生效。
 *
 * Env:
 *   DSH_EXECUTOR_PORT  listening port (default 3081)
 *   DSH_DSH_BIN        dsh CLI entry (bin.js) for the install command
 *
 * RPC (POST /rpc, JSON {method, args}):
 *   ping    -> {ok, version, pid}
 *   status  -> {ok, phase, attempt, startedAt, message}
 *   apply   -> {repo, tag, profile, serviceName} — download + verify into
 *              staging ONLY; never touches the service/port (phase ends at
 *              'staged'). 安装与重启不再由本执行器承担（restart RPC 已移除）。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const netProxy = require('./net-proxy.cjs');
const { spawn, spawnSync } = require('node:child_process');
const sys = require('./sys.cjs');
const { sha256File } = require('./integrity.cjs');

const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
};

const PORT = Number(argValue('port') || process.env.DSH_EXECUTOR_PORT) || sys.EXECUTOR_PORT;
const DSH_BIN = argValue('dsh-bin') || process.env.DSH_DSH_BIN || '';
const TASK_NAME = argValue('task') || process.env.DSH_EXECUTOR_TASK || '';
const CMD_PATH = argValue('cmd') || process.env.DSH_EXECUTOR_CMD || '';
const VERSION = sys.EXECUTOR_VERSION;
const STAGING_DIR = sys.STAGING_DIR;

// ---- v4.12 批次A（optimization-plan-20260824 §A.1）·显式下载代理 ----
// 启动时读一次 $DSH_HOME/dsh-prompt-enhancer.config.json 顶层 download.proxy（容错读，
// 读不到=空=走既有系统代理解析），经 net-proxy.cjs httpsGetProxied 第 5 参注入两处下载
// 漏斗——覆盖「代理软件在跑但 SYSTEM 无系统代理注册表」场景（A-1 探针已验证该组合出网可达）。
// 显式代理失败置 DL_PROXY_FAILED 降级直连并留痕（asr-models.cjs proxyFailed 同款语义）。
let DL_PROXY_FAILED = false;
function readDlProxy() {
  try {
    const cf = sys.pluginConfigFile();
    if (cf && fs.existsSync(cf)) {
      const cfg = JSON.parse(fs.readFileSync(cf, 'utf8'));
      if (cfg && cfg.download && typeof cfg.download.proxy === 'string') return cfg.download.proxy.trim();
    }
  } catch { /* 容错=无显式代理 */ }
  return '';
}
const DL_PROXY = readDlProxy();
function effectiveDlProxy() {
  return (DL_PROXY && !DL_PROXY_FAILED) ? DL_PROXY : undefined;
}
function markDlProxyFailed(err) {
  if (!DL_PROXY || DL_PROXY_FAILED) return;
  DL_PROXY_FAILED = true;
  try { console.log('[updater-host] explicit download proxy unreachable (' + String((err && err.message) || err) + ') — degrading to direct/system proxy'); } catch { /* 尽力留痕 */ }
}

// ---- v4.12 批次A ·失败退避状态文件（$DSH_HOME/dsh-prompt-enhancer.update-state.json）----
// 写入方：执行器 bumpUpdateFail/resetUpdateBackoff；读方：host auto 闸门 / rollbackToVersion
// 闸（经 shouldGateAuto）。原子写 tmp+rename（config 先例）；损坏/缺失按空状态放行。
function readUpdateState(stateFileOverride) {
  try {
    const p = stateFileOverride || sys.updateStateFile();
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch { return {}; }
}
function writeUpdateState(next, opts) {
  const o = opts || {};
  const p = o.stateFileOverride || sys.updateStateFile();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
  fs.renameSync(tmp, p);
}
/** 失败回写：连败+1、nextRetryAt=指数退避、dayCount 每日计数（上限判断归 shouldGateAuto）。 */
function bumpUpdateFail(reason) {
  try {
    const cur = readUpdateState();
    const dec = maintainLib.computeBackoff(cur, Date.now());
    writeUpdateState(Object.assign({}, cur, dec, {
      lastFailReason: String(reason || '').slice(0, 200),
      lastFailAt: Date.now(),
    }));
    console.log('[updater-host] backoff armed: failCount=' + dec.failCount + ' dayCount=' + dec.dayCount +
      '/' + maintainLib.AUTO_DAILY_LIMIT + ' nextRetryAt=+' + Math.round((dec.nextRetryAt - Date.now()) / 1000) + 's reason=' + String(reason || '').slice(0, 120));
  } catch (e) {
    try { console.log('[updater-host] bumpUpdateFail non-fatal error: ' + String(e && e.message || e)); } catch { /* ignore */ }
  }
}

// Reliable sleep — node timers do NOT depend on stdin (unlike `timeout`).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// PURE helpers shared with the bundle (single source of truth).
const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');
const pure = sys.extractPure(BODY);
const env = () => sys.mergedEnv(pure);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- staging (download while service is still online) ----
// v3.2.1-p（用户实测·大陆网络）：github releases/download 直连可能被重置（curl 56）——
// 失败后依次尝试镜像前缀（ghproxy 类），全部失败才报错（附网络/代理/手动 staging 提示）。
// v3.2.1-s（用户需求·更新进度反馈）：curl 改为 **Node https 流式下载**——可实时回报
// 下载进度（received/total/percent，经 state.download 由 status 轮询读取），并保留
// 镜像 fallback 链；跟随重定向（GitHub releases → objects.githubusercontent.com）。
const TARBALL_MIRRORS = [
  (u) => 'https://ghproxy.net/' + u,
  (u) => 'https://gh-proxy.com/' + u,
  (u) => 'https://ghfast.top/' + u,
];

// Node 流式 HTTPS 下载：跟随重定向（≤5 次）、Content-Length 总字节、流式写盘、
// 每 ≥400ms 回报一次进度 {received,total,percent}；超时/错误 reject。
function httpDownload(url, dest, onProgress, timeoutMs) {
  return new Promise((resolve, reject) => {
    const limit = timeoutMs || sys.INSTALL_TIMEOUT_MS;
    let redirects = 0;
    const go = (u) => {
      let req;
      try {
        // v3.2.14（插件所有网络走系统代理）：统一共享隧道入口（CONNECT 隧道 / 直连）
        // v4.12 批次A：第 5 参注入显式下载代理（config download.proxy）；代理失败降级直连并留痕
        req = netProxy.httpsGetProxied(u, { 'user-agent': 'dsh-prompt-enhancer-updater', accept: '*/*' }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 5) { reject(new Error('too many redirects')); return; }
            redirects += 1;
            go(new URL(res.headers.location, u).toString());
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error('HTTP ' + res.statusCode));
            return;
          }
          const total = Number(res.headers['content-length']) || 0;
          let received = 0;
          let lastReport = Date.now();
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { req.destroy(); } catch { /* ignore */ }
            try { out.destroy(); } catch { /* ignore */ }
            reject(new Error('download timed out after ' + Math.round(limit / 1000) + 's'));
          }, limit);
          const out = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            received += chunk.length;
            const now = Date.now();
            if (now - lastReport >= 400) {
              lastReport = now;
              if (onProgress) onProgress({ received, total, percent: total > 0 ? Math.min(99, Math.round((received * 100) / total)) : 0 });
            }
          });
          res.on('error', (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { out.destroy(); } catch { /* ignore */ }
            markDlProxyFailed(e);
            reject(e);
          });
          res.pipe(out);
          out.on('error', (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { req.destroy(); } catch { /* ignore */ }
            reject(e);
          });
          out.on('finish', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (onProgress) onProgress({ received, total, percent: 100 });
            out.close(() => resolve({ ok: true, size: received }));
          });
        }, null, effectiveDlProxy());
      } catch (e) {
        markDlProxyFailed(e);
        reject(e);
        return;
      }
      req.on('error', (e) => { markDlProxyFailed(e); reject(e); });
      req.setTimeout(limit, () => {
        try { req.destroy(new Error('download timed out')); } catch { /* ignore */ }
      });
    };
    go(url);
  });
}

// ---- v3.3.2（供应链加固·哈希强校验）----
// 镜像（ghproxy 类）只作下载通道、不作完整性信任锚：期望 sha256 一律取自可信通道——
// ① GitHub Releases API 资产 digest（GitHub 计算，api.github.com TLS，不经镜像）；
// ② 回退直连（不走镜像）下载 <tgz>.sha256 发布资产。两通道均不可得时按下载来源裁决：
// 直连（TLS→GitHub）放行，镜像拒绝（fail closed）。
function parseAssetDigest(releaseJson, fileName) {
  try {
    const assets = releaseJson && Array.isArray(releaseJson.assets) ? releaseJson.assets : [];
    for (const a of assets) {
      if (a && a.name === fileName && typeof a.digest === 'string') {
        const m = /^sha256:([0-9a-fA-F]{64})$/.exec(a.digest);
        if (m) return m[1].toLowerCase();
      }
    }
  } catch { /* 解析失败按无期望哈希处理 */ }
  return '';
}

function parseSha256Text(text) {
  const m = /([0-9a-fA-F]{64})/.exec(String(text || ''));
  return m ? m[1].toLowerCase() : '';
}

function hashGate(expected, actual, viaMirror) {
  if (expected) {
    return actual === expected
      ? { accept: true, verified: true }
      : { accept: false, code: 'STAGE_HASH_MISMATCH', message: 'tgz sha256 与 GitHub 发布值不一致（actual=' + actual.slice(0, 16) + '…/expected=' + expected.slice(0, 16) + '…），下载可能被篡改，已拒绝安装。请重试或手动下载 tgz 放入 ' + STAGING_DIR };
  }
  if (!viaMirror) return { accept: true, verified: false };
  return { accept: false, code: 'STAGE_HASH_UNVERIFIED', message: '镜像下载且无法取得可信期望哈希（GitHub API 与 .sha256 资产均不可达），拒绝安装。可稍后重试（直连优先）或手动下载 tgz 放入 ' + STAGING_DIR };
}

function httpsGetText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    // v4.12 批次A：第 5 参注入显式下载代理；失败降级直连并留痕（proxyFailed 同款语义）
    const req = netProxy.httpsGetProxied(url, { 'user-agent': 'dsh-prompt-enhancer-updater', accept: 'application/vnd.github+json' }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      // undici 封装响应无 setEncoding——按 Buffer 收集后统一转 utf8（同 httpDownload）
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
      res.on('error', (e) => { if (!settled) { settled = true; markDlProxyFailed(e); reject(e); } });
    }, null, effectiveDlProxy());
    req.on('error', (e) => { if (!settled) { settled = true; markDlProxyFailed(e); reject(e); } });
    req.setTimeout(timeoutMs || 15000, () => { try { req.destroy(new Error('timeout')); } catch { /* ignore */ } });
  });
}

function httpsGetJson(url, timeoutMs) {
  return httpsGetText(url, timeoutMs).then((t) => JSON.parse(t));
}

async function fetchExpectedSha256(repo, tag, fileName) {
  try {
    const j = await httpsGetJson('https://api.github.com/repos/' + repo + '/releases/tags/' + encodeURIComponent(tag), 15000);
    const d = parseAssetDigest(j, fileName);
    if (d) { log('expected sha256 source=api-digest'); return d; }
  } catch (e) { log('expected sha256 api failed: ' + String(e.message || e)); }
  try {
    const tmp = path.join(STAGING_DIR, fileName + '.expected');
    await httpDownload(pure.buildTarballUrl(sys.INSTALL_REPO, tag) + '.sha256', tmp, null, 30000);
    const txt = fs.readFileSync(tmp, 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    const d = parseSha256Text(txt);
    if (d) { log('expected sha256 source=.sha256-asset'); return d; }
  } catch (e) { log('expected sha256 asset failed: ' + String(e.message || e)); }
  return '';
}

function stageTarball(tag) {
  return new Promise((resolve) => {
    try {
      ensureDir(STAGING_DIR);
      const fileName = 'dsh-prompt-enhancer-' + tag + '.tgz';
      const dest = path.join(STAGING_DIR, fileName);
      const url = pure.buildTarballUrl(sys.INSTALL_REPO, tag);
      const urls = [url, ...TARBALL_MIRRORS.map((m) => m(url))];
      let idx = 0;
      const attempt = () => {
        if (idx >= urls.length) {
          state.download = null;
          resolve({
            ok: false,
            code: 'STAGE_DOWNLOAD_FAILED',
            message: '直连与镜像均下载失败（网络被重置 curl 56）。请检查网络/代理后重试，或手动下载 tgz 放入 ' + STAGING_DIR,
          });
          return;
        }
        const u = urls[idx];
        idx += 1;
        log('stage download (' + idx + '/' + urls.length + ') ' + u);
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        state.download = { url: u, received: 0, total: 0, percent: 0, attempt: idx, attempts: urls.length };
        httpDownload(u, dest, (p) => {
          state.download = { url: u, received: p.received, total: p.total, percent: p.percent, attempt: idx, attempts: urls.length };
        }).then(async (r) => {
          if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
            log('stage download attempt ' + idx + ' empty, fallback next');
            state.download = null;
            attempt();
            return;
          }
          // v3.3.2（供应链加固）：下载成功即过哈希门禁——镜像下载无可信哈希 → 拒绝；
          // 校验通过 → 旁挂 .sha256（安装前复验用，见 lib/index.cjs installStagedTarball）
          const viaMirror = idx >= 2;
          const actual = (await sha256File(dest)).toLowerCase();
          let expected = '';
          try { expected = await fetchExpectedSha256(sys.INSTALL_REPO, tag, fileName); } catch (e) { log('expected sha256 fetch error: ' + String(e.message || e)); }
          const gate = hashGate(expected, actual, viaMirror);
          if (!gate.accept) {
            state.download = null;
            log('stage hash gate REJECT (' + gate.code + ') viaMirror=' + viaMirror);
            resolve({ ok: false, code: gate.code, message: gate.message });
            return;
          }
          if (gate.verified) {
            try { fs.writeFileSync(dest + '.sha256', expected + '\n', 'utf8'); } catch { /* 旁挂失败不阻断（安装侧缺失则跳过复验） */ }
          }
          state.download = null;
          resolve({ ok: true, path: dest, size: fs.statSync(dest).size, sha256: actual, hashVerified: gate.verified });
        }).catch((e) => {
          log('stage download attempt ' + idx + ' failed: ' + String(e.message || e));
          state.download = null;
          attempt();
        });
      };
      attempt();
    } catch (e) {
      resolve({ ok: false, code: 'STAGE_EXCEPTION', message: String(e.message || e) });
    }
  });
}

async function verifyTarball(tarballPath) {
  try {
    if (!fs.existsSync(tarballPath)) return { ok: false, code: 'STAGE_MISSING', message: 'staged tarball missing' };
    if (fs.statSync(tarballPath).size === 0) return { ok: false, code: 'STAGE_EMPTY', message: 'staged tarball is empty' };
    const r = spawnSync('tar', ['-tf', tarballPath], { encoding: 'utf8', windowsHide: true, timeout: 30000, env: env() });
    if (r.status !== 0) {
      return { ok: false, code: 'STAGE_INVALID', message: 'invalid tarball: ' + String(r.stderr || r.stdout || '').trim().slice(0, 300) };
    }
    if (!/package\.json/.test(String(r.stdout || ''))) {
      return { ok: false, code: 'STAGE_NO_PACKAGE', message: 'tarball missing package.json' };
    }
    const sha256 = await sha256File(tarballPath);
    return { ok: true, sha256 };
  } catch (e) {
    return { ok: false, code: 'STAGE_VERIFY_FAILED', message: String(e.message || e) };
  }
}

// ---- local install (whitelisted staging tarball only) ----
function installLocal(tarballPath, profile) {
  return new Promise((resolve) => {
    if (DSH_BIN === '' || !/^[A-Za-z0-9_-]+$/.test(profile) || !fs.existsSync(tarballPath)) {
      resolve({ ok: false, code: 'BAD_ARGS', message: 'dsh bin or local tarball invalid' });
      return;
    }
    const args = pure.buildLocalInstallArgs(DSH_BIN, profile, tarballPath);
    if (!sys.isLocalTarballInstallArgs(args)) {
      resolve({ ok: false, code: 'BAD_ARGS', message: 'local tarball whitelist rejected' });
      return;
    }
    log('local install: ' + args.join(' '));
    const child = spawn(process.execPath, args, { env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, code: 'TIMEOUT', message: 'local install timed out' });
    }, sys.INSTALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: String(e.code || 'SPAWN_FAILED'), message: String(e.message || '') });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // v4.13 批次B（P0-2 写入点③）：pnpm 安装路径成功即记部署账本——否则该路径安装会让
      // 账本陈旧、诱发 heal 守卫误判（方案 B.1 四写入点之 local-install 补偿）。版本从白名单
      // staging 文件名解析（dsh-prompt-enhancer-<ver>.tgz）；解析不出记 ''（守卫基线跳过空值）。
      if (code === 0) {
        try {
          const vm = /dsh-prompt-enhancer-(?:v?(\d+\.\d+\.\d+))\.tgz$/i.exec(path.basename(tarballPath));
          sys.writeDeployLedgerEntry(profile, vm ? vm[1] : '', 'local-install');
        } catch { /* 账本失败不阻断安装结果 */ }
      }
      resolve({ ok: code === 0, code, message: String(stderr || stdout || '').trim().slice(0, 500) });
    });
  });
}

// ---- rollback (best-effort: reinstall the previously installed version) ----
// v4.12 批次A（评审 P0-1①·次级放大器封堵）：重装下载前过退避闸——backoff 命中即放弃回滚、
// 留痕并按既有失败终态返回（回滚失败本就终态 failed，语义无损）；闸关闭时行为与现状一致。
// seam 注入缝供单测隔离（绝不触真实服务/下载）。
// 2026-09-13（重启能力移除）：回滚只负责把旧版本重新装回环境，不再停/启服务——svc 参数
// 保留仅为调用方兼容，装回后返回 needsManualRestart，由用户手动重启 DSH 生效。
async function rollbackToVersion(svc, profile, oldVersion, seam) {
  if (!oldVersion) return { ok: false, code: 'NO_OLD_VERSION', message: 'no old version to rollback' };
  const s2 = seam || {};
  try {
    const gateFn = s2.shouldGateAuto || maintainLib.shouldGateAuto;
    const st = s2.readState ? s2.readState() : readUpdateState();
    if (gateFn(st, Date.now())) {
      log('rollback skipped by backoff: nextRetryAt=' + new Date(Number(st.nextRetryAt) || 0).toISOString() +
        ' dayCount=' + (Number(st.dayCount) || 0) + '/' + maintainLib.AUTO_DAILY_LIMIT);
      return { ok: false, code: 'ROLLBACK_BACKOFF_SKIPPED', message: 'download backoff active — rollback reinstall skipped' };
    }
  } catch { /* 闸自身异常按放行处理（fail-open：宁可重试不可卡死回滚能力） */ }
  log('rollback to ' + oldVersion);
  const r = await (s2.install || install)(oldVersion, profile);
  if (!r.ok) return { ok: false, code: 'ROLLBACK_INSTALL_FAILED', message: r.message };
  return { ok: true, version: oldVersion, needsManualRestart: true };
}


// ---- state ----
const state = { phase: 'idle', attempt: 0, startedAt: 0, message: '', busy: false, applying: false };
const log = (msg) => console.log('[updater-host] ' + msg);

// ---- install (whitelisted template only) ----
function install(tag, profile) {
  return new Promise((resolve) => {
    if (DSH_BIN === '' || !/^v?\d+\.\d+\.\d+$/.test(tag) || !/^[A-Za-z0-9_-]+$/.test(profile)) {
      resolve({ ok: false, code: 'BAD_ARGS', message: 'dsh bin or args invalid' });
      return;
    }
    const args = pure.buildInstallArgs(DSH_BIN, tag, profile);
    if (!sys.isInstallArgs(args)) {
      resolve({ ok: false, code: 'BAD_ARGS', message: 'whitelist rejected' });
      return;
    }
    const child = spawn(process.execPath, args, { env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, code: 'TIMEOUT', message: 'install timed out' });
    }, sys.INSTALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: String(e.code || 'SPAWN_FAILED'), message: String(e.message || '') });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, message: String(stderr || stdout || '').trim().slice(0, 500) });
    });
  });
}

// ---- DSH err 日志尾部诊断（2026-09-08 产品改进，随 status 的 diagLog 字段下发）----
const DIAG_LOG_MAX_LINES = 8;   // 最多回传行数（UI 可折叠展示，不刷屏）
const DIAG_LOG_LINE_MAX = 300;  // 单行截断上限
const DIAG_LOG_BYTES = 8192;    // 只读文件尾部 8KB（日志可能很大）
// 2026-09-12（审查修复·D3）：疑似根因行判定（与下方语义开关共用同一正则源，防两处漂移）
const DIAG_ROOT_RE = /error|exception|fatal|cannot|failed|unhandled|EADDRINUSE|throw/i;
// 噪声行判定：Node 启动警告族（真机实测 8 行窗口被 ExperimentalWarning 刷满，真根因被挤出）
const DIAG_NOISE_RE = /ExperimentalWarning|--trace-warnings|^\(node:\d+\)\s+\[?(?:DEP\d+|Warning)|^\(node:\d+\)\s+\S*[Ww]arning\b|Warning:\s/;
// 安全阀：噪声筛选的候选池上限——纯警告尾时向后最多回看这么多行找回真根因（对齐 8KB 读取量）
const DIAG_TAIL_MAX_LINES = 200;
// 密钥脱敏（红线「不暴露密钥」）：URL token / Bearer / 裸 JWT / Basic 凭据 / 键值式凭据 / sk-
// 2026-09-12（审查修复·D4）：旧版仅三类形态，实测漏网 5 种（裸 JWT、Basic base64、
// apiKey=/password= 等键值、7 字符 sk-）。此处按「替换顺序 = 从最具体到最宽松」排列：
// ①先 Basic/JWT 整体吞掉（避免被后面的键值规则截断成半截），②再 URL token/Bearer，
// ③最后键值规则——占位符 `***` 不再匹配 \S+ 之外的补丁，重复覆盖也无副作用。
function redactDiagLine(line) {
  return String(line)
    .replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, '$1***')                              // Basic dXNlcjpwYXNzd29yZA==
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***')                   // 裸 JWT（header.payload[.sig]）
    .replace(/([?&]token=)[^\s&]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***')
    .replace(/((?:api[_-]?key|password|passwd|secret|access[_-]?token|refresh[_-]?token)\s*[=:]\s*)\S+/gi, '$1***')
    .replace(/(sk-)[A-Za-z0-9._~+/=-]{6,}/g, '$1***');                            // 7 字符短 key 也要脱敏（旧版 {8,} 漏网）
}
// 读 DSH web err 日志尾部：服务模式经 nssm 注册表 AppStderr 定位（REG_SZ/REG_EXPAND_SZ
// 均兼容）；查不到（非 nssm/无服务/桌面）降级执行器前台重启 err 日志；再无则空串，
// client 对空串不渲染诊断块（降级静默，不影响原有错误文案）。
// 2026-09-12（审查修复·D3）：取尾部 N 行之前先做「降噪 + 优先根因」——
// 旧版直接 slice(-n)，真机日志尾部被 Node ExperimentalWarning 刷满 → 8 行窗口全是噪声、
// 真根因（Error: dsh: cannot resolve profile bundle …）被挤在窗口外，UI 只看到警告。
// 契约不变：仍返回字符串（无内容时空串），仍受 maxLines 约束。
function dshErrLogTail(svcName, maxLines) {
  const n = Number.isInteger(maxLines) && maxLines > 0 ? maxLines : DIAG_LOG_MAX_LINES;
  try {
    if (process.platform !== 'win32') return '';
    let p = '';
    try {
      const rq = spawnSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + String(svcName || 'dsh-web') + '\\Parameters', '/v', 'AppStderr'], { timeout: 5000, windowsHide: true });
      const m = /\r?\n\s*AppStderr\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(String((rq.stdout || '') + (rq.stderr || '')));
      if (m) p = m[1].trim();
    } catch { /* 注册表查询失败 → 走降级路径 */ }
    if (!p || !fs.existsSync(p)) {
      p = path.join(sys.EXECUTOR_ROOT, 'port-restart.err.log'); // 前台模式：执行器自有重启日志
      if (!fs.existsSync(p)) return '';
    }
    const fd = fs.openSync(p, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(DIAG_LOG_BYTES, size);
      const buf = Buffer.alloc(len);
      if (len > 0) fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').replace(/\0/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const raw = lines.slice(-n);                 // 原始尾部（回退基准）
      const win = diagTailSelect(lines, n);        // 降噪 + 根因优先
      return (win.length > 0 ? win : raw)
        .map(redactDiagLine)
        .map((s) => (s.length > DIAG_LOG_LINE_MAX ? s.slice(0, DIAG_LOG_LINE_MAX) + '…' : s))
        .join('\n');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

/** 单行噪声判定（D3）：纯 Node 启动警告；同行兼含疑似根因（如 `throw new Error` 带 warning 字样）时保留。 */
function diagNoiseLine(line) {
  return DIAG_NOISE_RE.test(line) && !DIAG_ROOT_RE.test(line);
}

/** 尾部窗口选择（D3）：先丢启动噪声，再以「最后一条疑似根因行」为锚，向后吞 ≤ N 行
 *  （含根因行本身，故栈帧上下文 = N-1 条，UI 一定能看见真正的 Error）。
 *  返回空数组 = 筛选后无可用行 → 调用方回退原始尾部（宁多勿漏，绝不因筛选返回空串）。
 *  自限性（防误报）：
 *  ① 只有池内确实存在疑似根因行才改锚（锚定的是根因行本身，不是拿更早的陈旧 Error 去配栈帧）；
 *  ② 池内无根因 → 一律按旧行为返回原始尾部（含「纯栈帧无 cause」的 promise 链、正常输出）；
 *  ③ 全噪声无根因 → 照样返回非空尾部。 */
function diagTailSelect(lines, n) {
  const pool = lines.slice(-DIAG_TAIL_MAX_LINES).filter((l) => !diagNoiseLine(l)); // 池上限对齐 8KB 读取量
  if (pool.length === 0) return [];                              // 全噪声 → 回退原始尾部
  let anchor = -1;
  for (let i = pool.length - 1; i >= 0; i--) if (DIAG_ROOT_RE.test(pool[i])) { anchor = i; break; }
  if (anchor < 0) return pool.slice(-n);                         // 无根因 → 旧行为（原始尾部语义）
  return pool.slice(anchor, anchor + n).slice(0, n);             // 根因行 + 其后栈帧，≤ N 行
}

// ---- HTTP server ----
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const respond = (obj) => {
      // v2.7.0 修复：补 CORS 预检必需头（allow-methods/allow-headers）——旧版仅有
      // allow-origin，浏览器（3080 页面 fetch 3081，POST+JSON）预检失败 → fetch reject
      // → client 显示「更新执行器不可用」。OPTIONS 预检同样走本 handler 返回带头响应。
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end(JSON.stringify(obj));
    };
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch { /* empty */ }
    const method = parsed.method || '';
    const args = parsed.args || {};
    if (method === 'ping') return respond({ ok: true, version: VERSION, pid: process.pid, port: PORT });
    if (method === 'status') return respond({ ok: true, ...state });
    if (method === 'apply') {
      const tag = typeof args.tag === 'string' ? args.tag.trim() : '';
      const profile = typeof args.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(args.profile) ? args.profile : 'web';
      const svc = typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName) ? args.serviceName : 'dsh-web';
      const repo = typeof args.repo === 'string' ? args.repo : '';
      if (repo !== sys.INSTALL_REPO) return respond({ ok: false, code: 'BAD_REPO', message: 'repo must be ' + sys.INSTALL_REPO });
      if (!/^v?\d+\.\d+\.\d+$/.test(tag)) return respond({ ok: false, code: 'BAD_TAG', message: 'invalid tag' });
      if (state.busy || state.applying) return respond({ ok: false, code: 'BUSY', message: 'an apply/restart is already in progress' });
      (async () => {
        state.applying = true;
        state.phase = 'validating';
        state.message = 'validating ' + tag;
        log('apply start tag=' + tag + ' profile=' + profile + ' svc=' + svc);

        // 1. 在线拉取 staging（服务保持运行）
        state.phase = 'staging';
        state.message = 'downloading ' + tag;
        const staged = await stageTarball(tag);
        if (!staged.ok) {
          state.applying = false;
          state.phase = 'failed';
          state.message = 'stage failed: ' + staged.message;
          log('stage FAILED: ' + staged.message);
          // v4.12 批次A：下载/校验失败回写退避状态（驱动 host auto 闸与 rollback 闸）
          bumpUpdateFail('stage:' + (staged.code || 'STAGE_FAILED') + ':' + String(staged.message || '').slice(0, 80));
          return respond({ ok: false, code: staged.code, message: staged.message });
        }
        const verified = await verifyTarball(staged.path);
        if (!verified.ok) {
          state.applying = false;
          state.phase = 'failed';
          state.message = 'stage verify failed: ' + verified.message;
          log('stage verify FAILED: ' + verified.message);
          bumpUpdateFail('verify:' + (verified.code || 'VERIFY_FAILED'));
          return respond({ ok: false, code: verified.code, message: verified.message });
        }

        // 2. 环境确认（仍在服务在线阶段）——批次C（P1-4）：probeEnv 已异步化，apply 链 await
        state.phase = 'envcheck';
        state.message = 'checking environment';
        const items = await sys.probeEnv(svc, pure, env(), PORT);
        const blocked = items.filter((it) => it.level === 'block' && it.ok === false);
        if (blocked.length > 0) {
          state.applying = false;
          state.phase = 'failed';
          state.message = 'envcheck blocked: ' + blocked.map((it) => it.key).join(', ');
          log('envcheck BLOCKED: ' + blocked.map((it) => it.key).join(', '));
          return respond({ ok: false, code: 'ENVCHECK_FAILED', message: 'blocked envcheck: ' + blocked.map((it) => it.key).join(', ') });
        }

        // v3.1.x（职责划分·用户指令）：一键更新**仅执行更新操作**（下载 + 校验到 staging）——
        // 不停止服务、不安装、不触碰任何端口；安装与全部端口操作（断开/监听/重启）统一由
        // `restart` RPC（端口重启模块）在停服窗口内执行
        state.applying = false;
        state.phase = 'staged';
        state.message = 'staged ' + tag + '; run update/install to apply (then restart DSH manually)';
        log('apply staged (download only) tag=' + tag);
        // v4.12 批次A：下载链路恢复 → 清退避连败计数（nextRetryAt 归零，dayCount 保留当日事实）
        try {
          writeUpdateState(Object.assign({}, readUpdateState(), { schema: 1, failCount: 0, nextRetryAt: 0 }));
        } catch { /* 尽力而为，不阻断 staged 终态 */ }
        return respond({ ok: true, accepted: true, version: tag, message: 'staged' });

      })().catch((e) => {
        state.applying = false;
        state.phase = 'failed';
        state.message = 'apply error: ' + String(e && e.message || e);
        log('apply ERROR: ' + String(e && e.message || e));
        bumpUpdateFail('apply-error:' + String(e && e.message || e).slice(0, 100));
        respond({ ok: false, code: 'APPLY_ERROR', message: state.message });
      });
      return;
    }
    respond({ ok: false, code: 'UNKNOWN_METHOD', method });
  });
});
server.on('error', (e) => {
  // v3.2（动态端口 fallback）：固定端口被占用（EADDRINUSE）→ 改由 OS 动态分配（listen 0），
  // 实际端口写入 executor.port 文件供 executorEnsure 发现——不再因端口冲突直接退出。
  if (e && e.code === 'EADDRINUSE' && PORT !== 0) {
    console.error('[updater-host] port ' + PORT + ' in use, falling back to dynamic port');
    server.listen(0, '127.0.0.1', onListen);
    return;
  }
  console.error('[updater-host] server error: ' + e.message);
  process.exit(1);
});
function onListen() {
  const actual = server.address().port;
  log('listening on 127.0.0.1:' + actual + ' pid=' + process.pid + ' version=' + VERSION + (actual !== PORT ? ' (dynamic, requested ' + PORT + ')' : ''));
  // v3.2（动态端口 fallback）：写实际端口文件——executorEnsure 在固定端口 ping 失败时
  // 读此文件发现真实端口（动态端口场景必须有；固定端口场景也写，幂等无害）。
  try {
    const pf = sys.executorPortFile();
    fs.mkdirSync(path.dirname(pf), { recursive: true });
    fs.writeFileSync(pf, JSON.stringify({ port: actual, pid: process.pid, ts: Date.now() }), 'utf8');
  } catch { /* 尽力而为 */ }
  // This executor was started by a one-shot scheduled task. The task can be
  // removed now: deleting a Task Scheduler task does not stop an already
  // running instance, so the executor process remains alive and independent
  // of the dsh-web service tree.
  // v4.12 批次A（A.1.6-a）：stdio:'ignore' 吞错零痕迹 → pipe 捕获退出码/stderr 写 log()；
  // 失败隔 10s 重试一次（A-4 探针实测：Running 态 /Delete /F 内外均成功——重试仅兜底
  // 瞬态错误；仍失败交给宿主延迟清扫（A.1.6-b）与 janitor 菜单段（A.1.6-c）收尾）。
  if (TASK_NAME) {
    const deleteOwnTask = (attemptNo) => {
      try {
        const systemRoot = process.env.SystemRoot || process.env.windir || 'C:/Windows';
        const r = spawnSync(path.join(systemRoot, 'System32', 'schtasks.exe'), ['/Delete', '/TN', TASK_NAME, '/F'], {
          windowsHide: true,
          encoding: 'utf8',
        });
        if (r.status === 0) {
          log('own task deleted' + (attemptNo > 0 ? ' (retry ' + attemptNo + ')' : '') + ': ' + TASK_NAME);
        } else {
          log('own task delete FAILED (attempt ' + attemptNo + ') exit=' + r.status +
            ' stderr=' + String(r.stderr || '').trim().slice(0, 200) + ' — delayed sweep / janitor will clean up');
        }
      } catch (e) {
        log('own task delete threw (attempt ' + attemptNo + '): ' + String(e && e.message || e));
      }
    };
    deleteOwnTask(0);
    setTimeout(() => deleteOwnTask(1), 10000).unref();
  }
  if (CMD_PATH) {
    try { fs.unlinkSync(CMD_PATH); } catch { /* ignore */ }
  }
}
const maintainLib = require('./maintain-lib.cjs');
const stageInstall = require('./stage-install.cjs');
const readline = require('node:readline');

/**
 * 当前「仍被组合」的第三方包名（bundles − patch 已禁用）——干跑 resolve 层 extraNames 用。
 * 必须在每次干跑调用点现算：已禁用条目不进组合，拿处置前的快照集去探必然假阴性
 * （2026-08-22 救援演练实锤：精准禁用后闸门恒红的根因）。
 */
function composedThirdParties(profileName) {
  const pp = maintainLib.profilePaths(null, profileName);
  const disabled = new Set(maintainLib.readPatchIds(pp.patchYml));
  return maintainLib.thirdPartyBundles(maintainLib.readProfilePackage(pp)).filter((n) => !disabled.has(n));
}

/** io 抽象：交互默认走 console/readline；测试/演练注入脚本化实现。 */

/** v4.9 过程计时 io 包装：每行输出自动带总耗时戳 [+Xs]（自包装时刻起计）；ask/tick/clearTick 透传。 */
function createTimedIo(io) {
  const t0 = Date.now();
  const sec = () => Math.round((Date.now() - t0) / 1000);
  return {
    out: (s) => io.out('[' + sec() + 's] ' + (s === undefined ? '' : s)),
    ask: typeof io.ask === 'function' ? (q) => io.ask(q) : undefined,
    tick: (line) => { if (typeof io.tick === 'function') io.tick('[' + sec() + 's] ' + line); },
    clearTick: () => { if (typeof io.clearTick === 'function') io.clearTick(); },
    t0,
    sec,
  };
}

/** v4.9 命令级计时壳：整条命令共享一个时钟，任何一行都可见全局进度；结束打印总耗时。 */
async function runWithTiming(io, label, fn) {
  const tio = createTimedIo(io);
  tio.out('▶ 开始：' + label);
  let r;
  try { r = await fn(tio); }
  finally { tio.out('■ 结束：' + label + '（总耗时 ' + tio.sec() + 's）'); }
  return r;
}

/**
 * [3] 一键更新（安装侧）：staging 安装 → 干跑闸门（失败自动快照回滚）。
 * 不再做任何重启动作：安装就位后返回 needsManualRestart，由用户手动重启 DSH 生效。
 * 版本方向（升级/同版本/降级）全部自动继续并打印决策行。
 */
async function runOneClickUpdate(io, profile, opts) {
  const o = opts || {};
  const tgz = o.findTgzImpl ? o.findTgzImpl() : stageInstall.findStagedTarball();
  if (!tgz) {
    io.out('✗ 无待装更新包——先在 DSH Web 设置页「一键更新」下载新版本。');
    return { ok: false, code: 'NO_STAGED' };
  }
  const newVer = o.peekVerImpl ? o.peekVerImpl(tgz) : stageInstall.peekTarballVersion(tgz);
  const curVer = o.curVerImpl ? o.curVerImpl() : sys.readInstalledPluginVersion(profile);
  const dec = maintainLib.decideUpdateAction(curVer, newVer);
  io.out('更新决策: ' + dec.action + ' · ' + dec.detail + '（一键模式自动继续）');
  io.out('安装 staging 包…');
  const inst = o.installImpl ? await o.installImpl(tgz, profile) : stageInstall.installStagedTarball(tgz, profile);
  if (!inst || inst.ok === false) {
    io.out('✗ 安装失败: ' + ((inst && inst.message) || '未知') + '（运行环境未动）');
    return { ok: false, code: 'INSTALL_FAILED', detail: inst && inst.message };
  }
  // 干跑闸门（组合+模块层；语法层已在安装内过闸）。失败 → 自动快照回滚
  let gate = o.gateImpl ? await o.gateImpl(profile) : maintainLib.dryRunAll({ profile, roots: maintainLib.dryRunRoots(null, profile), extraNames: composedThirdParties(profile) });
  if (!gate.ok) {
    io.out('\x1b[31m✗ 干跑闸门未过（layer=' + gate.layer + '）——自动回滚快照\x1b[0m');
    if (inst.snapshotDir) {
      const rb = sys.rescueRestore(inst.snapshotDir, { profileName: profile, exactHomePatch: true });
      io.out(rb.ok ? '✓ 已回滚 ' + rb.restored.length + ' 文件（旧版本原样恢复）' : '✗ 回滚失败！请立即使用救援模式: ' + rb.warnings.join('; '));
    }
    return { ok: false, code: 'GATE_FAILED_ROLLED_BACK', detail: gate.detail };
  }

  io.out('✓ 新版本已安装并就位: v' + (curVer || '?') + ' → v' + (newVer || '?'));
  io.out('⚠ 更新执行器不具备重启能力——请手动重启 DSH 使新版本生效。');
  return { ok: true, code: 'INSTALLED_NEEDS_MANUAL_RESTART', from: curVer, to: newVer, needsManualRestart: true };
}

/** v4.13 批次B（P1-3）：安装一致性自检渲染层——auditInstallConsistency 五项 findings 打印。 */
async function runInstallConsistencyAudit(io, profile, opts) {
  const o = opts || {};
  const r = maintainLib.auditInstallConsistency(Object.assign({ profileName: profile }, o.auditOpts || {}));
  io.out('安装一致性自检（只读五项 · ' + profile + '）——' + (r.ok ? '无 FAIL 项' : '存在 FAIL 项，请按指引处置') + '：');
  for (const f of r.findings) {
    const tag = f.level === 'PASS' ? '[OK]' : (f.level === 'WARN' ? '[!]' : '[x]');
    io.out('  ' + tag + ' ' + f.key + ': ' + f.detail);
  }
  io.out(r.ok
    ? '结论：安装一致性自检通过（WARN 项为提示，不阻断 heal）。'
    : '结论：存在 FAIL 项——heal 守卫将拒绝旧缓存恢复；修复指引：①重跑一键更新刷新缓存 ②重跑一次部署写入点补录账本 ③悬空 file: 依赖经设置页重装插件消除。');
  return r;
}

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', onListen);
}

module.exports = {
  // 更新引擎：下载 / 校验 / staging 本地安装 / 回滚
  stageTarball,
  verifyTarball,
  installLocal,
  rollbackToVersion,
  parseAssetDigest,
  parseSha256Text,
  hashGate,
  fetchExpectedSha256,
  // 一键更新（安装侧）：staging 安装 → 干跑闸门 → 失败回滚；不再重启（needsManualRestart）
  runOneClickUpdate,
  // v4.12 批次A：熔断/防抖导出——单测注入复用同一实现
  readUpdateState,
  writeUpdateState,
  bumpUpdateFail,
  effectiveDlProxy,
  markDlProxyFailed,
  // v4.9 过程计时层导出——单测复用同一实现
  createTimedIo,
  runWithTiming,
  // v4.13 批次B：一致性自检渲染导出——单测注入复用同一实现
  runInstallConsistencyAudit,
  state,
  VERSION,
  // PORT 保留导出：常量仍被 server.listen / ping 响应使用，且 UPD-01 断言 updater.PORT === 3081
  PORT,
  STAGING_DIR,
  // 2026-09-08 产品改进：err 日志尾诊断导出（lib/index.cjs update/diagTail 依赖 dshErrLogTail）
  dshErrLogTail,
  redactDiagLine,
};
