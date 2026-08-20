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
    name: 'SenseVoice-zh-en-ja-ko-yue',
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

/** voice/modelList：模型清单 + 安装状态 */
function modelList() {
  return {
    ok: true,
    models: VOICE_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      sizeMB: m.sizeMB,
      lang: m.lang,
      installed: modelInstalled(m.id),
    })),
  };
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

/** 重启 asr worker（模型目录参数化 DSH_ASR_MODEL）——host 内 spawn detached，对齐 asr-deploy 模式 */
function restartWorker(modelId) {
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
  const child = spawn(process.execPath, [worker], {
    detached: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { DSH_ASR_MODEL: modelId }),
  });
  child.unref();
}

module.exports = { VOICE_MODELS, modelList, modelProgress, modelDownload, modelInstalled, modelDir };
