// v3.2.7（语音识别·模型管理框架）：本地引擎模型清单 + 流式下载 + 进度。
// 设计（用户需求 2026-08-20）：插件只提供「框架接口 + 模型选择/下载入口（带进度）」——
// 发布物不含模型、安装不默认下载；模型由用户在设置页选择并下载到 $DSH_HOME/dsh-prompt-enhancer-asr/models/<id>/。
// 下载走 node:https 直连（通道 C 已实测）；进度存内存 Map，client 轮询 voice/modelProgress。
'use strict';

const https = require('node:https');
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

/** 模型是否已安装（全部文件存在且非空） */
function modelInstalled(id) {
  const m = VOICE_MODELS.find((x) => x.id === id);
  if (!m) return false;
  const dir = modelDir(id);
  return m.files.every((f) => {
    try { return fs.statSync(path.join(dir, f.name)).size > 0; } catch (e) { return false; }
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
  if (!d) return { ok: true, state: 'idle', downloaded: 0, total: 0, pct: 0 };
  const pct = d.total > 0 ? Math.min(100, Math.round((d.downloaded / d.total) * 100)) : 0;
  return { ok: true, state: d.state, downloaded: d.downloaded, total: d.total, pct, error: d.error || null };
}

/** voice/modelDownload：启动后台下载（已安装/下载中幂等返回） */
function modelDownload(id) {
  const m = VOICE_MODELS.find((x) => x.id === String(id || ''));
  if (!m) return { ok: false, code: 'MODEL_UNKNOWN', message: 'unknown model: ' + id };
  if (modelInstalled(m.id)) return { ok: true, started: false, message: 'already installed' };
  const cur = modelDownloads.get(m.id);
  if (cur && cur.state === 'downloading') return { ok: true, started: false, message: 'downloading' };
  modelDownloads.set(m.id, { state: 'downloading', downloaded: 0, total: 0, error: null });
  // 后台下载（不阻塞 RPC）
  downloadModelAsync(m).catch((e) => {
    modelDownloads.set(m.id, { state: 'error', downloaded: 0, total: 0, error: String((e && e.message) || e).slice(0, 200) });
  });
  return { ok: true, started: true };
}

async function downloadModelAsync(m) {
  const dir = modelDir(m.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of m.files) {
    const dest = path.join(dir, f.name);
    await downloadFile(f.url, dest, (dl, total) => {
      modelDownloads.set(m.id, { state: 'downloading', downloaded: dl, total });
    });
  }
  modelDownloads.set(m.id, { state: 'done', downloaded: 1, total: 1 });
  // 下载完成 → 重启 worker（注入模型 id）让模型热就绪
  try { restartWorker(m.id); } catch (e) { /* 重启失败不阻断（用户可手动重启） */ }
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = https.get(url, { headers: { 'user-agent': 'dsh-prompt-enhancer' } }, (res) => {
        if (res.statusCode >= 400) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode + ' ' + url.slice(0, 80)));
          return;
        }
        const total = parseInt(String(res.headers['content-length'] || '0'), 10);
        let dl = 0;
        const ws = fs.createWriteStream(dest);
        res.on('data', (c) => { dl += c.length; onProgress(dl, total); });
        res.pipe(ws);
        ws.on('finish', () => resolve());
        ws.on('error', (e) => { try { fs.unlinkSync(dest); } catch (x) {} reject(e); });
        res.on('error', (e) => { try { ws.destroy(); } catch (x) {} reject(e); });
      });
    } catch (e) { reject(e); return; }
    req.on('error', (e) => { try { fs.unlinkSync(dest); } catch (x) {} reject(e); });
  });
}

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

/** voice/modelOpenDir：打开模型目录（explorer，供用户手动放入第三方模型） */
function modelOpenDir() {
  const dir = path.join(asrDir(), 'models');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  try {
    const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, code: 'OPEN_DIR_FAILED', message: String((e && e.message) || e) };
  }
}

module.exports = { VOICE_MODELS, modelList, modelProgress, modelDownload, modelInstalled, modelDir, modelApply, modelOpenDir, scanCustomModels };
