// v3.2.7（语音识别·模型管理框架）：本地引擎模型清单 + 流式下载 + 进度。
// 设计（用户需求 2026-08-20）：插件只提供「框架接口 + 模型选择/下载入口（带进度）」——
// 发布物不含模型、安装不默认下载；模型由用户在设置页选择并下载到 $DSH_HOME/dsh-prompt-enhancer-asr/models/<id>/。
// 下载走 node:https 直连（通道 C 已实测）；进度存内存 Map，client 轮询 voice/modelProgress。
'use strict';

const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const netProxy = require('./net-proxy.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// 模型清单（单一事实源：id = worker 模型目录名；新增模型在此追加，UI/下载/worker 自动跟随）
const VOICE_MODELS = [
  {
    id: 'sense-voice',
    type: 'sense-voice',
    name: 'SenseVoice（多语言）',
    sizeMB: 228,
    lang: 'zh/en/ja/ko/yue',
    files: [
      {
        name: 'model.int8.onnx',
        url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx',
      },
      {
        name: 'tokens.txt',
        url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt',
      },
    ],
  },
  {
    id: 'paraformer-zh',
    type: 'paraformer',
    name: 'Paraformer（中文）',
    sizeMB: 137,
    lang: 'zh',
    files: [
      {
        name: 'model.int8.onnx',
        url: 'https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14/resolve/main/model.int8.onnx',
      },
      {
        name: 'tokens.txt',
        url: 'https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14/resolve/main/tokens.txt',
      },
    ],
  },
];

function asrDir() {
  return path.join(process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh', 'dsh-prompt-enhancer-asr');
}
function modelDir(id) {
  return path.join(asrDir(), 'models', String(id || 'sense-voice'));
}

/** 模型是否已安装（全部文件存在；model.int8.onnx 按 sizeMB 校验大小——防 302/错误页假文件误判） */
function modelInstalled(id) {
  const m = VOICE_MODELS.find((x) => x.id === id);
  if (!m) return false;
  const dir = modelDir(id);
  const minBytes = Math.round(m.sizeMB * 0.8 * 1024 * 1024); // ≥ 80% 预期大小才算真装
  return m.files.every((f) => {
    try {
      const st = fs.statSync(path.join(dir, f.name));
      if (st.size <= 0) return false;
      // onnx 主文件必须达到预期大小（tokens.txt 等小文件仅非空）
      if (/\.onnx$/i.test(f.name)) return st.size >= minBytes;
      return true;
    } catch (e) { return false; }
  });
}

/** voice/modelList：内置清单（安装状态）+ 扫描 models/ 自定义模型（onnx+tokens 自动检测） */
function modelList() {
  const builtin = VOICE_MODELS.map((m) => ({
    id: m.id,
    type: m.type,
    name: m.name,
    sizeMB: m.sizeMB,
    lang: m.lang,
    installed: modelInstalled(m.id),
    custom: false,
  }));
  return { ok: true, models: builtin.concat(scanCustomModels()) };
}

/** 扫描 models/ 子目录：含 .onnx + tokens.txt → 自定义模型（用户手放第三方社区模型，自动识别） */
function scanCustomModels() {
  const out = [];
  try {
    const modelsRoot = path.join(asrDir(), 'models');
    if (!fs.existsSync(modelsRoot)) return out;
    for (const sub of fs.readdirSync(modelsRoot)) {
      if (VOICE_MODELS.some((m) => m.id === sub)) continue;
      const subDir = path.join(modelsRoot, sub);
      let st;
      try { st = fs.statSync(subDir); } catch (e) { continue; }
      if (!st.isDirectory()) continue;
      let files = [];
      try { files = fs.readdirSync(subDir); } catch (e) { continue; }
      const onnx = files.find((f) => /\.onnx$/i.test(f));
      if (!onnx || !files.includes('tokens.txt')) continue;
      // 可选 model.json 声明（id/name/type）；无则用目录名
      let name = sub;
      let type = null;
      try {
        const mj = JSON.parse(fs.readFileSync(path.join(subDir, 'model.json'), 'utf8'));
        if (mj && typeof mj === 'object') { if (typeof mj.name === 'string' && mj.name) name = mj.name; if (typeof mj.type === 'string' && mj.type) type = mj.type; }
      } catch (e) { /* 无 model.json */ }
      out.push({ id: sub, type: type || null, name, sizeMB: 0, lang: '', installed: true, custom: true, modelFile: onnx });
    }
  } catch (e) { /* 扫描失败忽略 */ }
  return out;
}

// 下载进度（内存 Map；client 轮询）
const modelDownloads = new Map(); // id -> { state:'downloading'|'done'|'error', downloaded, total, error? }

function modelProgress(id) {
  const d = modelDownloads.get(String(id || ''));
  if (!d) return { ok: true, state: 'idle', step: 'idle', file: '', downloaded: 0, total: 0, pct: 0 };
  const pct = d.total > 0 ? Math.min(100, Math.round((d.downloaded / d.total) * 100)) : 0;
  return { ok: true, state: d.state, step: d.step || d.state, file: d.file || '', downloaded: d.downloaded, total: d.total, pct, error: d.error || null };
}

/** voice/modelDownload：启动后台下载（已安装/下载中幂等返回） */
function modelDownload(id) {
  const m = VOICE_MODELS.find((x) => x.id === String(id || ''));
  if (!m) return { ok: false, code: 'MODEL_UNKNOWN', message: 'unknown model: ' + id };
  if (modelInstalled(m.id)) return { ok: true, started: false, message: 'already installed' };
  const cur = modelDownloads.get(m.id);
  if (cur && cur.state === 'downloading') return { ok: true, started: false, message: 'downloading' };
  modelDownloads.set(m.id, { state: 'downloading', step: 'connecting', file: m.files[0] ? m.files[0].name : '', downloaded: 0, total: 0, error: null });
  // 后台下载（不阻塞 RPC）
  downloadModelAsync(m).catch((e) => {
    modelDownloads.set(m.id, { state: 'error', step: 'error', file: '', downloaded: 0, total: 0, error: String((e && e.message) || e).slice(0, 200) });
  });
  return { ok: true, started: true };
}

async function downloadModelAsync(m) {
  const dir = modelDir(m.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of m.files) {
    const dest = path.join(dir, f.name);
    modelDownloads.set(m.id, { state: 'downloading', step: 'connecting', file: f.name, downloaded: 0, total: 0, error: null });
    // v3.2.12（网络波动容错）：每文件最多重试 3 次（CDN 大文件下载偶发 aborted/连接重置）
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await downloadFile(f.url, dest, (dl, total) => {
          modelDownloads.set(m.id, { state: 'downloading', step: 'downloading', file: f.name, downloaded: dl, total });
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) {
          modelDownloads.set(m.id, { state: 'downloading', step: 'connecting', file: f.name + '（重试 ' + attempt + '/3）', downloaded: 0, total: 0, error: null });
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
    if (lastErr) throw lastErr;
    // v3.2.12（假文件防护）：onnx 主文件下载后校验大小（≥80% 预期）——302 重定向页/
    // 错误页写入后立即识别并删除，避免 modelInstalled 假阳性。
    if (/\.onnx$/i.test(f.name)) {
      const minBytes = Math.round(m.sizeMB * 0.8 * 1024 * 1024);
      const actual = fs.statSync(dest).size;
      if (actual < minBytes) {
        try { fs.unlinkSync(dest); } catch (x) { /* ignore */ }
        throw new Error(f.name + ' 下载不完整（' + Math.round(actual / 1024) + 'KB < 预期 ' + m.sizeMB + 'MB），已删除，请重试');
      }
    }
  }
  modelDownloads.set(m.id, { state: 'done', step: 'done', file: '', downloaded: 1, total: 1 });
  // 下载完成 → 重启 worker（注入模型 id）让模型热就绪
  try { restartWorker(m.id); } catch (e) { /* 重启失败不阻断（用户可手动重启） */ }
}

// v3.2.12（下载可用性增强）：多源 fallback——huggingface.co 大陆网络常不可达，
// 自动依次尝试 [原 URL, hf-mirror.com 同路径]；全部失败才 reject（错误信息含源列表）。
function downloadFile(url, dest, onProgress) {
  const candidates = [url];
  const mirrored = String(url).replace('huggingface.co', 'hf-mirror.com');
  if (mirrored !== String(url)) candidates.push(mirrored);
  // v3.2.13（断点续传）：目标写 .part 临时文件，完成/校验后 rename；中断保留 .part，
  // 下次（或重试/换源）从断点 Range 续传——大文件（232MB）网络中断不再从头下载。
  const destPart = dest + '.part';
  const startByte = (() => { try { return fs.statSync(destPart).size; } catch (e) { return 0; } })();
  // v3.2.13（Range 兼容降级）：实测 /api/resolve-cache 端点对 Range 请求可能挂死（无响应）——
  // 60s 超时触发后标记 rangeBroken，该文件后续尝试放弃 Range 从头下载（防永久挂死）。
  let rangeBroken = false;
  let proxyBroken = false; // v3.2.14：代理 CONNECT 失败 → 后续直连降级
  const tryOne = (u, redirectsLeft, byte) => new Promise((resolve, reject) => {
    const headers = { 'user-agent': 'dsh-prompt-enhancer' };
    if (byte > 0 && !rangeBroken) headers['range'] = 'bytes=' + byte + '-';
    const start = rangeBroken ? 0 : byte;
    let req;
    const armTimeout = (r) => {
      r.setTimeout(60000, () => {
        if (start > 0) rangeBroken = true; // Range 导致挂死 → 降级全量
        try { r.destroy(new Error('下载超时（60s 无数据，' + (start > 0 ? 'Range 被降级为全量' : '重试') + '）')); } catch (e) {}
      });
      return r;
    };
    const handle = (res) => {
      // 手动递归跟随重定向（hf-mirror：302 → AWS CDN；307 → 同域 /api/resolve-cache；最多 5 跳）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, u).href; } catch (err) { reject(new Error('bad redirect: ' + res.headers.location)); return; }
        tryOne(next, redirectsLeft - 1, start).then(resolve, reject);
        return;
      }
      if (res.statusCode === 416) {
        // Range 超出（.part 已完整）→ 视为完成：.part 转正为 dest
        res.resume();
        try { fs.renameSync(destPart, dest); } catch (err) { /* 若 dest 已存在 rename 失败则忽略 */ }
        resolve();
        return;
      }
      if (res.statusCode >= 400) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' ' + u.slice(0, 80)));
        return;
      }
      // 206 = 断点续传追加；200 = 服务器不支持 Range（从头覆盖 .part）
      const append = res.statusCode === 206;
      const segLen = parseInt(String(res.headers['content-length'] || '0'), 10);
      const total = append ? start + segLen : segLen;
      let dl = 0;
      const ws = fs.createWriteStream(destPart, { flags: append ? 'a' : 'w' });
      res.on('data', (c) => { dl += c.length; onProgress(start + dl, total); });
      res.pipe(ws);
      ws.on('finish', () => { try { fs.renameSync(destPart, dest); } catch (err) { reject(err); return; } resolve(); });
      ws.on('error', (e) => reject(e));
      res.on('error', (e) => { try { ws.destroy(); } catch (x) {} reject(e); });
    };
    try {
      // v3.2.14：统一走共享 httpsGetProxied（系统代理 CONNECT 隧道 / 直连）；代理失败降级直连
      if (netProxy.resolveProxy(u) && !proxyBroken) {
        req = armTimeout(netProxy.httpsGetProxied(u, headers, handle));
        req.on('error', (e) => { proxyBroken = true; reject(e); });
      } else {
        const mod = String(u).startsWith('https:') ? https : http;
        req = armTimeout(mod.get(u, { headers }, handle));
        req.on('error', (e) => reject(e));
      }
    } catch (e) { reject(e); }
  });
  // 顺序尝试各源（每源最多 2 次：首次带 Range 续传，Range 挂死触发降级后第二次全量重下）；
  // 失败累计，最后一个源的错误作为最终错误
  const retries = candidates.flatMap((u) => [u, u]);
  return retries.reduce((chain, u) => chain.catch(() => tryOne(u, 5, startByte)), Promise.reject(new Error('init'))).catch((e) => {
    const sources = candidates.map((x) => x.replace(/^https?:\/\//, '').split('/')[0]).join('、');
    throw new Error((e && e.message ? e.message : String(e)) + '（已尝试源：' + sources + '）');
  });
}

// v3.2.14（插件所有网络走系统代理）：代理解析/隧道统一走共享 lib/net-proxy.cjs
// （resolveProxy：HTTPS_PROXY env > Windows 系统代理注册表 > 直连；httpsGetProxied：直连或 CONNECT 隧道）
/** 重启 asr worker（模型目录参数化 DSH_ASR_MODEL + 类型 DSH_ASR_MODEL_TYPE）——host 内 spawn detached，对齐 asr-deploy 模式 */
function restartWorker(modelId, modelType) {
  const dir = asrDir();
  const worker = path.join(dir, 'asr-worker.cjs');
  if (!fs.existsSync(worker)) return;
  const { spawnSync } = require('node:child_process');
  // 杀旧 worker（3082 监听者）
  try {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 3000 });
    const lines = String(r.stdout || '').split(/\r?\n/);
    for (const l of lines) {
      if (l.indexOf(':3082') !== -1 && l.indexOf('LISTENING') !== -1) {
        const pid = (l.match(/(\d+)\s*$/) || [])[1];
        if (pid) { try { process.kill(Number(pid)); } catch (e) { /* ignore */ } }
      }
    }
  } catch (e) { /* ignore */ }
  const env = Object.assign({}, process.env, { DSH_ASR_MODEL: modelId });
  if (modelType) env.DSH_ASR_MODEL_TYPE = modelType;
  const child = spawn(process.execPath, [worker], { detached: true, stdio: 'ignore', env });
  child.unref();
}

/** voice/modelApply：切换当前模型 → 重启 worker 加载该模型（type 从内置清单或 model.json） */
function modelApply(id) {
  const mid = String(id || '');
  if (!mid) return { ok: false, code: 'BAD_ARGS', message: 'missing model id' };
  if (!modelInstalled(mid) && !isCustomModel(mid)) {
    return { ok: false, code: 'MODEL_NOT_INSTALLED', message: 'model not installed: ' + mid };
  }
  const builtin = VOICE_MODELS.find((m) => m.id === mid);
  let type = builtin ? builtin.type : null;
  if (!type) {
    // 自定义模型：读 model.json type
    try {
      const mj = JSON.parse(fs.readFileSync(path.join(modelDir(mid), 'model.json'), 'utf8'));
      if (mj && typeof mj.type === 'string') type = mj.type;
    } catch (e) { /* 无 type → worker 自动探测 */ }
  }
  restartWorker(mid, type);
  return { ok: true, model: mid, type: type || 'auto' };
}

/** 自定义模型是否存在于 models/<id>（onnx + tokens） */
function isCustomModel(id) {
  try {
    const dir = modelDir(id);
    const files = fs.readdirSync(dir);
    return files.some((f) => /\.onnx$/i.test(f)) && files.includes('tokens.txt');
  } catch (e) { return false; }
}

/** voice/modelDelete：删除模型目录（v3.2.10 用户需求「已下载的模型删除」）。
 * 仅允许删除 $ASR/models/<id> 的直接子目录（防路径穿越）；调用方负责先切走当前模型（Windows 文件句柄） */
function modelDelete(id) {
  const mid = String(id || '');
  if (!mid || mid === '.' || mid === '..' || mid.includes('/') || mid.includes('\\') || mid.includes(':')) {
    return { ok: false, code: 'BAD_MODEL_ID', message: 'invalid model id' };
  }
  const modelsRoot = path.join(asrDir(), 'models');
  const dir = path.join(modelsRoot, mid);
  if (path.dirname(dir) !== modelsRoot) {
    return { ok: false, code: 'BAD_MODEL_ID', message: 'invalid model id' };
  }
  if (!fs.existsSync(dir)) {
    return { ok: false, code: 'MODEL_NOT_FOUND', message: 'model not found: ' + mid };
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, id: mid };
  } catch (e) {
    return { ok: false, code: 'MODEL_DELETE_FAILED', message: String((e && e.message) || e) };
  }
}

/** voice/modelOpenDir：打开模型目录（供用户手动放入第三方模型）。
 * 会话探测：host 在 Session 0（nssm 服务模式）时 explorer 打开不可见（跨会话隔离）——
 * 改用 schtasks 交互式任务（/it）在用户会话运行 explorer（项目 restart 任务链同款机制）；
 * 前台模式（Session>0）直接 explorer。 */
let hostSessionId = null;
function detectSessionId() {
  if (hostSessionId !== null) return hostSessionId;
  try {
    const { spawnSync } = require('node:child_process');
    // tasklist CSV 解析本进程会话号（第 4 列）——不依赖 powershell（服务模式/策略环境更稳）
    const r = spawnSync('tasklist', ['/FI', 'PID eq ' + process.pid, '/FO', 'CSV', '/V'], { encoding: 'utf8', timeout: 5000 });
    const lines = String(r.stdout || '').split(/\r?\n/);
    for (const l of lines) {
      const m = l.match(/"node\.exe","\d+","[^"]*","(\d+)"/);
      if (m) { hostSessionId = parseInt(m[1], 10); return hostSessionId; }
    }
    hostSessionId = 1; // 解析失败按前台处理（explorer 直接打开，最坏不可见但不静默失败）
  } catch (e) { hostSessionId = 1; }
  return hostSessionId;
}

// 探测已登录交互用户（explorer 进程所有者）——服务模式 schtasks /ru 用。
// 缓存（host 进程生命周期内登录用户不常变）——省每次点击的 tasklist 开销（~0.5s，2026-08-20 计时优化）
let interactiveUserCache = null;
function detectInteractiveUser() {
  if (interactiveUserCache) return interactiveUserCache;
  try {
    const { spawnSync } = require('node:child_process');
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq explorer.exe', '/FO', 'CSV', '/V'], { encoding: 'utf8', timeout: 5000 });
    const lines = String(r.stdout || '').split(/\r?\n/);
    for (const l of lines) {
      // "explorer.exe","PID","Console","1",...,"DOMAIN\USER",...
      const m = l.match(/"explorer\.exe","\d+","[^"]*","(\d+)","[^"]*","[^"]*","([^"]*)"/);
      if (m) {
        const session = parseInt(m[1], 10);
        const user = (m[2] || '').trim();
        if (session > 0 && user) {
          // 用户名形如 DOMAIN\USER 或 USER（本地）；含反斜杠取后半，不含则原样
          const u = user.indexOf('\\') >= 0 ? user.split('\\').pop() : user;
          if (u) { interactiveUserCache = { session, user: u }; return interactiveUserCache; }
        }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}
function modelOpenDir() {
  const dir = path.join(asrDir(), 'models');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  try {
    const { spawnSync } = require('node:child_process');
    if (detectSessionId() <= 0) {
      // 服务模式（Session 0）：schtasks /it /ru <登录用户> 运行 PowerShell 脚本——
      // explorer 打开 + SetForegroundWindow 强制置顶（新进程可抢前台）。
      // 必须 /ru <登录用户>（不带 /ru 任务以 SYSTEM 运行，仍落 Session 0 不可见）；
      // 仅 explorer.exe 打开不置顶（前台锁定），须脚本内激活（2026-08-20 二次踩坑）。
      const iu = detectInteractiveUser();
      const tn = 'dsh-open-models';
      const psFile = path.join(asrDir(), '.tmp-open-models.ps1');
      const vbsFile = path.join(asrDir(), '.tmp-open-models.vbs');
      let wrote = false;
      try {
        fs.writeFileSync(psFile, buildOpenModelsPs(dir), 'utf8');
        // 黑窗教训（2026-08-20 五次踩坑）：powershell.exe 是控制台程序，schtasks 启动瞬间
        // 会闪命令窗口（-WindowStyle Hidden 压不住启动闪现）。任务改跑 wscript.exe（GUI 子系统，
        // 本身无控制台）→ VBS 用 sh.Run(..., 0) 以隐藏窗口状态拉起 powershell，全程无黑窗。
        fs.writeFileSync(vbsFile, buildOpenModelsVbs(psFile), 'utf8');
        wrote = true;
        // 竞态教训（2026-08-20 三次踩坑）：schtasks /run 是异步触发，任务启动读文件需要时间——
        // host 立即删脚本会致任务找不到（窗口打不开）。ps1 末尾自删 + host 延迟 6s 兜底删。
        // 引号教训（2026-08-20 四次踩坑）：tr 不能显式加外层引号——node 序列化会变成
        // 双层引号嵌套，schtasks 存储的命令损坏 → 任务启动失败。不带外层引号，node 自动引用。
        const tr = 'wscript.exe ' + vbsFile;
        const args = ['/create', '/tn', tn, '/tr', tr, '/sc', 'once', '/st', '00:00', '/it', '/f'];
        if (iu) { args.push('/ru', iu.user); }
        spawnSync('schtasks', args, { timeout: 5000 });
        spawnSync('schtasks', ['/run', '/tn', tn], { timeout: 5000 });
        // delete 异步延迟（计时优化 2026-08-20）：任务已 /run 触发，删除不阻塞返回（省 ~0.5s）
        setTimeout(() => { try { spawnSync('schtasks', ['/delete', '/tn', tn, '/f'], { timeout: 5000 }); } catch (e) { /* ignore */ } }, 2000);
      } finally {
        // 兜底延迟删（ps1/vbs 通常已被脚本自身删除；任务失败时 6s 后清理）
        if (wrote) {
          setTimeout(() => {
            try { fs.unlinkSync(psFile); } catch (e) { /* ignore */ }
            try { fs.unlinkSync(vbsFile); } catch (e) { /* ignore */ }
          }, 6000);
        }
      }
      if (!iu) console.warn('[asr-models] 未探测到登录用户，explorer 可能落在 Session 0（不可见）');
    } else {
      const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return { ok: true, dir, session: detectSessionId() };
  } catch (e) {
    return { ok: false, code: 'OPEN_DIR_FAILED', message: String((e && e.message) || e) };
  }
}

// 生成打开模型文件夹的 PowerShell 脚本（全 ASCII——PS5.1 按 ANSI 读 UTF-8 文件，中文注释会乱码破坏解析）
function buildOpenModelsPs(dir) {
  return [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class W32Fg {',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
    '}',
    '"@',
    "$dir = '" + dir + "'",
    'Start-Process -FilePath explorer.exe -ArgumentList "`"$dir`""',
    // 轮询置顶（计时优化 2026-08-20）：窗口一出现立即置顶，替代固定 sleep 1200ms（通常 300-600ms 即完成）
    '$deadline = (Get-Date).AddMilliseconds(3000)',
    'do {',
    '  $e = Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -Last 1',
    '  if ($e) {',
    '    if ([W32Fg]::IsIconic($e.MainWindowHandle)) { [W32Fg]::ShowWindow($e.MainWindowHandle, 9) | Out-Null }',
    '    [W32Fg]::SetForegroundWindow($e.MainWindowHandle) | Out-Null',
    '    break',
    '  }',
    '  Start-Sleep -Milliseconds 200',
    '} while ((Get-Date) -lt $deadline)',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
    '',
  ].join('\r\n');
}

// 生成 VBS 隐藏启动器（全 ASCII）：wscript.exe（GUI 子系统无控制台）以隐藏窗口状态拉起 powershell——
// 解决 schtasks 运行 powershell 时命令黑窗闪烁（-WindowStyle Hidden 压不住启动瞬间闪现）
function buildOpenModelsVbs(psFile) {
  return [
    'Set sh = CreateObject("WScript.Shell")',
    // sh.Run 参数2=0（隐藏窗口）参数3=False（不等待）；psFile 路径用 "" 内嵌引号包裹
    'sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + psFile + '""", 0, False',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'fso.DeleteFile WScript.ScriptFullName',
    '',
  ].join('\r\n');
}

module.exports = { VOICE_MODELS, modelList, modelProgress, modelDownload, modelInstalled, modelDir, modelApply, modelDelete, modelOpenDir, scanCustomModels, downloadFile };
