'use strict';
/**
 * dsh-prompt-enhancer — asr-worker.cjs（本地 ASR 独立进程）
 *
 * 语音识别模块 P2：本地离线引擎（sherpa-onnx + SenseVoice）。
 * - 独立进程（端口 3082），host（lib/asr.cjs）经 HTTP 调用——对齐 updater executor 模式
 * - 部署位置：$DSH_HOME/dsh-prompt-enhancer-asr/（自带 node_modules/sherpa-onnx + models/）
 * - 只经 sherpa-onnx 公开 API 调用（框架纪律：不改框架源码）
 *
 * RPC（POST /rpc, {method, args}）：
 *   status      → {ok, modelReady, loadError}
 *   transcribe  → {audioBase64: dataURL} → {ok, text} / {ok:false, code}
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 3082;
const FIXED_PORT = PORT; // 固定端口（EADDRINUSE → 动态 fallback + worker.port 文件）
// v3.2.7（模型管理框架）：模型目录由 DSH_ASR_MODEL 指定（= 设置页选择的模型 id），
// 默认 sense-voice；模型由用户经 voice/modelDownload 下载到 models/<id>/，安装不默认拉取。
// 模型类型：DSH_ASR_MODEL_TYPE 或 models/<id>/model.json.type 或 null（自动探测依次尝试）。
const MODEL_ID = process.env.DSH_ASR_MODEL || 'sense-voice';
const MODEL_DIR = path.join(__dirname, 'models', MODEL_ID);
let MODEL_TYPE = process.env.DSH_ASR_MODEL_TYPE || null;

let sherpa = null;
let recognizer = null;
let loadError = null;
let curLang = 'auto';

// SenseVoice 支持语言（auto 自动 / zh 中文 / en 英文 / ja 日文 / ko 韩文 / yue 粤语）
const VOICE_LANGS = ['auto', 'zh', 'en', 'ja', 'ko', 'yue'];
function normLang(l) { return VOICE_LANGS.indexOf(l) >= 0 ? l : 'auto'; }

/** 按类型构建 recognizer config（sherpa-onnx 各模型 config 结构不同；tokens 为 modelConfig 顶层字段） */
function createRecognizerFor(type, lang) {
  const dir = MODEL_DIR;
  let onnx = null;
  try { onnx = fs.readdirSync(dir).find((f) => /\.onnx$/i.test(f)); } catch (e) { /* ignore */ }
  if (!onnx) throw new Error('no .onnx model in ' + dir);
  const model = path.join(dir, onnx);
  const tokens = path.join(dir, 'tokens.txt');
  if (!fs.existsSync(tokens)) throw new Error('tokens.txt missing in ' + dir);
  const base = { featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { tokens } };
  if (type === 'paraformer') {
    return sherpa.createOfflineRecognizer(Object.assign({}, base, { modelConfig: Object.assign({}, base.modelConfig, { paraformer: { model } }) }));
  }
  if (type === 'whisper') {
    return sherpa.createOfflineRecognizer(Object.assign({}, base, { modelConfig: Object.assign({}, base.modelConfig, { whisper: { model, language: 'auto' } }) }));
  }
  // 默认 sense-voice
  return sherpa.createOfflineRecognizer(Object.assign({}, base, { modelConfig: Object.assign({}, base.modelConfig, { senseVoice: { model, language: normLang(lang), useInverseTextNormalization: 1 } }) }));
}

function loadModel(lang) {
  try {
    if (!fs.existsSync(MODEL_DIR) || !fs.readdirSync(MODEL_DIR).some((f) => /\.onnx$/i.test(f)) || !fs.existsSync(path.join(MODEL_DIR, 'tokens.txt'))) {
      loadError = 'model-missing: ' + MODEL_DIR + '（需在设置页下载模型或手动放入第三方模型）';
      return;
    }
    sherpa = require('sherpa-onnx');
    // 类型：环境变量 > model.json > 自动探测（依次尝试 sense-voice/paraformer/whisper，首次成功即用）
    if (!MODEL_TYPE) {
      try {
        const mj = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, 'model.json'), 'utf8'));
        if (mj && typeof mj.type === 'string') MODEL_TYPE = mj.type;
      } catch (e) { /* 无 model.json */ }
    }
    const candidates = MODEL_TYPE ? [MODEL_TYPE] : ['sense-voice', 'paraformer', 'whisper'];
    let lastErr = null;
    for (const t of candidates) {
      try {
        recognizer = createRecognizerFor(t, lang);
        MODEL_TYPE = t;
        curLang = normLang(lang);
        loadError = null;
        return;
      } catch (e) { lastErr = e; recognizer = null; }
    }
    recognizer = null;
    loadError = 'load-failed: ' + ((lastErr && lastErr.message) || String(lastErr));
  } catch (e) {
    recognizer = null;
    loadError = 'load-failed: ' + ((e && e.message) || String(e));
  }
}

// 语言切换时懒重建 recognizer（单实例，切换约 1-2s；同一语言复用）
function ensureRecognizer(lang) {
  const l = normLang(lang || curLang);
  if (recognizer && l === curLang) return true;
  loadModel(l);
  return !!recognizer;
}
loadModel('auto');

function transcribe(dataUrl, lang) {
  if (!sherpa) {
    return { ok: false, code: 'ASR_LOCAL_MODEL_NOT_READY', message: loadError || 'recognizer not ready' };
  }
  if (!ensureRecognizer(lang)) {
    return { ok: false, code: 'ASR_LOCAL_MODEL_NOT_READY', message: loadError || 'recognizer not ready' };
  }
  if (typeof dataUrl !== 'string' || !/^data:audio\/(wav|mp3);base64,/.test(dataUrl)) {
    return { ok: false, code: 'BAD_AUDIO' };
  }
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(b64, 'base64');
    // readWaveFromBinaryData：免临时文件（Uint8Array 入参）
    const wave = sherpa.readWaveFromBinaryData(new Uint8Array(buf));
    const stream = recognizer.createStream();
    // acceptWaveform(sampleRate, samples) —— 两个参数（Number, Float32Array），非对象
    stream.acceptWaveform(wave.sampleRate, wave.samples);
    recognizer.decode(stream);
    const text = (recognizer.getResult(stream).text || '').trim();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, code: 'ASR_LOCAL_FAILED', message: ((e && e.message) || String(e)).slice(0, 200) };
  }
}

function status() {
  let onnxFile = null;
  try { onnxFile = fs.readdirSync(MODEL_DIR).find((f) => /\.onnx$/i.test(f)) || null; } catch (e) { /* ignore */ }
  return {
    ok: true,
    modelReady: !!recognizer,
    model: MODEL_ID,
    modelFile: onnxFile ? fs.existsSync(path.join(MODEL_DIR, onnxFile)) : false,
    tokensFile: fs.existsSync(path.join(MODEL_DIR, 'tokens.txt')),
    loadError: loadError || null,
  };
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && (req.url === '/rpc' || req.url === '/rpc/')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { /* 非法 body */ }
      const method = parsed && parsed.method;
      const args = parsed && parsed.args && typeof parsed.args === 'object' ? parsed.args : {};
      let result;
      try {
        if (method === 'status') result = status();
        else if (method === 'transcribe') result = transcribe(args.audioBase64, args.language);
        else result = { ok: false, code: 'UNKNOWN_METHOD' };
      } catch (e) {
        result = { ok: false, code: 'ASR_LOCAL_FAILED', message: ((e && e.message) || String(e)).slice(0, 200) };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }
  // 健康检查（host 探测 worker 是否存活）
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, modelReady: !!recognizer, model: MODEL_ID }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND' }));
});

server.listen(FIXED_PORT, '127.0.0.1', onListening);
// 固定端口被占（多 DSH 实例并发部署）→ 动态端口 fallback（对齐 executor.port 先例），
// 实际端口写 worker.port 文件供 host 发现（host 优先 3082，文件仅作 fallback）。
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.warn('[asr-worker] port ' + FIXED_PORT + ' in use, fallback to dynamic port');
    server.removeAllListeners('error');
    server.listen(0, '127.0.0.1', onListening);
  }
});

function onListening() {
  const actualPort = server.address().port;
  try {
    fs.writeFileSync(path.join(__dirname, 'worker.port'),
      JSON.stringify({ port: actualPort, pid: process.pid, ts: Date.now() }), 'utf8');
  } catch (e) { /* 尽力而为 */ }
  console.log('[asr-worker] listening on 127.0.0.1:' + actualPort + ' | modelReady=' + !!recognizer + (loadError ? ' | ' + loadError : ''));
}

process.on('uncaughtException', (e) => {
  console.error('[asr-worker] uncaught:', (e && e.message) || e);
});
