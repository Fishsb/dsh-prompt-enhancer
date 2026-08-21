'use strict';
/**
 * dsh-prompt-enhancer — lib/asr.cjs（语音识别模块 host 侧）
 *
 * 职责：voice/transcribe 与 voice/status 的实现——
 *   - cloud 双协议 ASR 引擎（chat: 阿里 Qwen3-ASR input_audio / openai: /audio/transcriptions multipart）
 *   - refine 规整（OpenAI 兼容 chat/completions，粗处理去口水词，失败降级 raw）
 *   - sanitizeVoiceCfg（白名单净化，config/set 对 voice 字段调用）
 *   - 出网走通道 C（node:https 直连，P0.5 探针 #6 已实测通过 2026-08-20）
 *
 * 独立 require 模块（lib/index.cjs 加载），不入 build-host 产物；发布白名单 lib/ 已覆盖。
 * 框架纪律：只经公开 API 调用云端协议，不 fork 不改写。
 */
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const AUDIO_MAX_BYTES = 10 * 1024 * 1024; // data URL 全串 ≤10MB（60s 16k mono ≈ 2.6MB）
const ASR_TIMEOUT_MS = 30000;
const REFINE_TIMEOUT_MS = 15000;
const REFINE_DEFAULT_MAX_TOKENS = 300;
const VOICE_LANGS = ['auto', 'zh', 'en', 'ja', 'ko', 'yue']; // SenseVoice 语言（白名单）
const REFINE_PROMPT = '去除口水词（嗯/啊/然后/那个等），保持原意，不重写、不新增内容、不改语义、不细化标点。只输出清理后的文本。';
// P2（本地引擎）：asr worker 独立进程（$DSH_HOME/dsh-prompt-enhancer-asr/，端口 3082，对齐 updater executor 模式）。
// 2026-08-20（桌面端随机端口·多实例）：worker 支持 3082 被占时动态端口 fallback + 写 worker.port 文件——
// host 优先 3082，仅当 worker.port 存在且 3082 未健康时用文件端口（多 DSH 实例共享/隔离兜底）。
const ASR_WORKER_PORT = 3082;
const ASR_WORKER_TIMEOUT_MS = 15000;
let resolvedWorkerPort = null;
function workerPort() {
  if (resolvedWorkerPort) return resolvedWorkerPort;
  resolvedWorkerPort = ASR_WORKER_PORT;
  try {
    const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    const raw = fs.readFileSync(path.join(dshHome, 'dsh-prompt-enhancer-asr', 'worker.port'), 'utf8');
    const o = JSON.parse(raw);
    if (o && Number.isInteger(o.port) && o.port >= 1024 && o.port <= 65535) resolvedWorkerPort = o.port;
  } catch (e) { /* 无文件用默认 3082 */ }
  return resolvedWorkerPort;
}

function normalizeBaseUrl(u) {
  return typeof u === 'string' ? u.trim().replace(/\/+$/, '') : '';
}

/** 提取 voice 段：兼容两种输入——整配置（{version,voice:{asr,refine},...}，host handler 现状）与 voice 段（{asr,refine}，测试/内部调用）。2026-08-20 实测修复：handler 传整配置致 cfg.asr=undefined → engine 恒回退 cloud → 切 local 不生效 */
function voiceCfgOf(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  if (cfg.asr && typeof cfg.asr === 'object') return cfg;
  if (cfg.voice && typeof cfg.voice === 'object' && cfg.voice.asr && typeof cfg.voice.asr === 'object') return cfg.voice;
  return null;
}

/** 白名单净化 voice 配置（非法值回退默认；未知键丢弃——对齐 sanitizeV2 风格） */
function sanitizeVoiceCfg(cfg) {
  const asr = cfg && cfg.asr && typeof cfg.asr === 'object' ? cfg.asr : {};
  const cloud = asr.cloud && typeof asr.cloud === 'object' ? asr.cloud : {};
  const local = asr.local && typeof asr.local === 'object' ? asr.local : {};
  const rf = cfg && cfg.refine && typeof cfg.refine === 'object' ? cfg.refine : {};
  const vd = cfg && cfg.vad && typeof cfg.vad === 'object' ? cfg.vad : {};
  const hk = cfg && cfg.hotkey && typeof cfg.hotkey === 'object' ? cfg.hotkey : {};
  return {
    asr: {
      engine: asr.engine === 'local' ? 'local' : 'cloud',
      local: {
        // v3.2.16（多模型修复）：模型 id 白名单动态化——旧值 sensevoice-q8 映射 sense-voice；
        // '' = 删除最后模型（无当前模型）；其余合法模型 id（内置 sense-voice/paraformer-zh + 自定义目录名）
        // 按 [A-Za-z0-9._-] 校验保留；非法回退默认 sense-voice
        model: local.model === 'sensevoice-q8' ? 'sense-voice' : (local.model === '' ? '' : (typeof local.model === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(local.model) ? local.model : 'sense-voice')),
        language: VOICE_LANGS.indexOf(local.language) >= 0 ? local.language : 'auto',
      },
      cloud: {
        protocol: cloud.protocol === 'openai' ? 'openai' : 'chat',
        baseUrl: normalizeBaseUrl(cloud.baseUrl),
        apiKey: typeof cloud.apiKey === 'string' ? cloud.apiKey : '',
        model: typeof cloud.model === 'string' && cloud.model ? cloud.model : 'qwen3-asr-flash',
      },
    },
    refine: {
      enabled: rf.enabled === true,
      // v3.2.8（用户需求·同增强模块的设置方式）：mode='chain' 用基座模型列表选中的
      // provider/model（走基座 llm，免 key，含本地模型）；mode='custom' 用下方独立配置（高级）。
      mode: rf.mode === 'custom' ? 'custom' : 'chain',
      provider: typeof rf.provider === 'string' ? rf.provider : '',
      model: typeof rf.model === 'string' ? rf.model : '',
      baseUrl: normalizeBaseUrl(rf.baseUrl),
      apiKey: typeof rf.apiKey === 'string' ? rf.apiKey : '',
      maxTokens: Number.isInteger(rf.maxTokens) && rf.maxTokens >= 1 && rf.maxTokens <= 2000 ? rf.maxTokens : REFINE_DEFAULT_MAX_TOKENS,
    },
    vad: { enabled: vd.enabled === false ? false : true },
    // v3.2.9（快捷键唤醒）：hotkey 配置白名单（client 快捷键监听使用）
    hotkey: {
      enabled: hk.enabled === true,
      combo: typeof hk.combo === 'string' && hk.combo ? hk.combo : '',
    },
    // v3.2.17（语音识别完自动触发增强）：autoEnhance 布尔白名单——host 仅透传存储，client 触发链路使用
    autoEnhance: (cfg && cfg.autoEnhance === true) ? true : false,
  };
}

/** 出网（通道 C）：node:http/https 请求（按 URL 协议选择），body 支持 string/Buffer/object；超时/网络错误映射 code */
function httpsRequest(url, opts) {
  const { method = 'POST', headers = {}, body, timeoutMs } = opts || {};
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject({ code: 'NETWORK', message: 'bad url' }); }
    const mod = u.protocol === 'http:' ? http : https;
    let payload = null;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) payload = body;
      else payload = JSON.stringify(body);
    }
    const req = mod.request(u, {
      method,
      headers: Object.assign({}, headers, payload !== null ? { 'content-length': Buffer.byteLength(payload) } : {}),
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const bodyText = buf.toString('utf8');
        let json = null;
        try { json = bodyText ? JSON.parse(bodyText) : null; } catch (e) { /* 纯文本响应 */ }
        resolve({ status: res.statusCode, body: bodyText, json });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => reject({ code: 'NETWORK', message: e && e.message ? e.message : String(e) }));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ---- P2：本地 worker（sherpa-onnx 独立进程）----
async function workerCall(method, args) {
  const r = await httpsRequest('http://127.0.0.1:' + workerPort() + '/rpc', {
    body: { method, args: args || {} },
    timeoutMs: ASR_WORKER_TIMEOUT_MS,
  });
  return r.json || { ok: false, code: 'ASR_LOCAL_BAD_RESPONSE' };
}

/** 本地引擎识别：data URL → worker transcribe（language 可选，SenseVoice 语言提示 auto/zh/en/ja/ko/yue） */
async function transcribeLocal(audioBase64, language) {
  try {
    const r = await workerCall('transcribe', { audioBase64, language });
    if (!r || r.ok !== true) {
      return { ok: false, code: (r && r.code) || 'ASR_LOCAL_FAILED', message: (r && r.message) || '' };
    }
    return { ok: true, text: typeof r.text === 'string' ? r.text : '' };
  } catch (e) {
    return { ok: false, code: 'ASR_LOCAL_WORKER_DOWN', message: (e && e.message) || '' };
  }
}

/** 本地引擎状态探测（installed/modelReady/workerUp + worker 实际加载模型 model） */
async function localStatus() {
  let workerUp = false;
  let modelReady = false;
  let model = null;
  try {
    const r = await httpsRequest('http://127.0.0.1:' + workerPort() + '/health', { method: 'GET', timeoutMs: 2000 });
    workerUp = r.status === 200 && !!(r.json && r.json.ok === true);
    modelReady = !!(r.json && r.json.modelReady === true);
    model = r.json && typeof r.json.model === 'string' ? r.json.model : null;
  } catch (e) { /* worker down */ }
  // #4 修复（2026-08-21）：worker 未就绪时附加运行时缺失诊断（worker 文件 / node 版 sherpa-onnx 包），
  // 供前端精确引导「部署本地引擎运行时」（voice/deployRuntime）。运行时目录 = $DSH_HOME/dsh-prompt-enhancer-asr。
  let runtime = null;
  if (!workerUp) {
    try {
      const dir = path.join(process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh', 'dsh-prompt-enhancer-asr');
      runtime = {
        workerFile: fs.existsSync(path.join(dir, 'asr-worker.cjs')),
        sherpaPkg: fs.existsSync(path.join(dir, 'node_modules', 'sherpa-onnx', 'index.js')),
      };
    } catch (e) { /* ignore */ }
  }
  return { installed: workerUp, modelReady, workerUp, model, runtime };
}

/** chat 响应 content 提取：兼容 string 与 [{type:'text',text}] 多模态形态；缺失返回 null */
function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const t = content.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('').trim();
    return t === '' ? null : t;
  }
  return null;
}

/** cloud chat 协议（阿里 Qwen3-ASR）：POST /chat/completions + input_audio（完整 data URL） */
async function transcribeChat(voice, dataUrl, timeoutMs) {
  const cloud = voice.asr.cloud;
  if (!cloud.baseUrl || !cloud.apiKey || !cloud.model) return { ok: false, code: 'ASR_NO_KEY' };
  const body = {
    model: cloud.model,
    messages: [{ role: 'user', content: [{ type: 'input_audio', audio: { data: dataUrl, format: 'wav' } }] }],
  };
  let r;
  try {
    r = await httpsRequest(cloud.baseUrl + '/chat/completions', {
      headers: { authorization: 'Bearer ' + cloud.apiKey, 'content-type': 'application/json' },
      body,
      timeoutMs,
    });
  } catch (e) {
    return { ok: false, code: e && e.code === 'NETWORK' ? 'ASR_NETWORK' : 'ASR_TIMEOUT', message: e && e.message };
  }
  if (r.status >= 400) {
    return { ok: false, code: r.status === 401 ? 'ASR_NO_KEY' : 'ASR_BAD_RESPONSE', message: r.body.slice(0, 200) };
  }
  const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
  const text = extractText(content);
  if (text === null) return { ok: false, code: 'ASR_BAD_RESPONSE', message: 'empty chat content' };
  return { ok: true, text };
}

/** cloud openai 协议：POST /audio/transcriptions（multipart file+model，剥离 data URL 前缀） */
async function transcribeOpenai(voice, dataUrl, timeoutMs) {
  const cloud = voice.asr.cloud;
  if (!cloud.baseUrl || !cloud.apiKey || !cloud.model) return { ok: false, code: 'ASR_NO_KEY' };
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const boundary = '----dsh-voice-' + Date.now().toString(16);
  const fileBuf = Buffer.from(b64, 'base64');
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n'),
    fileBuf,
    Buffer.from('\r\n'),
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\n' + cloud.model + '\r\n'),
    Buffer.from('--' + boundary + '--\r\n'),
  ]);
  let r;
  try {
    r = await httpsRequest(cloud.baseUrl + '/audio/transcriptions', {
      headers: { authorization: 'Bearer ' + cloud.apiKey, 'content-type': 'multipart/form-data; boundary=' + boundary },
      body,
      timeoutMs,
    });
  } catch (e) {
    return { ok: false, code: e && e.code === 'NETWORK' ? 'ASR_NETWORK' : 'ASR_TIMEOUT', message: e && e.message };
  }
  if (r.status >= 400) {
    return { ok: false, code: r.status === 401 ? 'ASR_NO_KEY' : 'ASR_BAD_RESPONSE', message: r.body.slice(0, 200) };
  }
  // 响应兼容纯文本（默认）与 JSON {text}
  const text = (r.json && typeof r.json.text === 'string' ? r.json.text : r.body).trim();
  if (!text) return { ok: false, code: 'ASR_BAD_RESPONSE', message: 'empty transcription' };
  return { ok: true, text };
}

// 基座 llm 服务（v3.2.8：refine chain 模式用规整区自选的基座模型 provider/model，免填 key）——由 lib/index.cjs 注入
let llmService = null;
function setLlm(llm) {
  llmService = llm && typeof llm.stream === 'function' ? llm : null;
}

/** refine 规整：mode='chain' 走基座 llm（用规整区自选的基座模型 provider/model，含本地模型），
 * mode='custom' 走独立 OpenAI 兼容；小 maxTokens；失败返回 {ok:false, code}（不抛，降级 raw） */
async function refineText(voice, text) {
  const rf = voice.refine;
  if (!rf.enabled) return { skipped: true };
  if (rf.mode === 'chain') {
    // 用规整区从基座 models/list 选中的 provider/model（未选 → 跳过）
    if (!rf.provider || !rf.model) return { skipped: true };
    if (!llmService) return { ok: false, code: 'REFINE_NO_LLM' };
    let stream;
    try {
      stream = llmService.stream({
        provider: rf.provider,
        model: rf.model,
        maxTokens: rf.maxTokens || REFINE_DEFAULT_MAX_TOKENS,
        system: REFINE_PROMPT,
        messages: [{ id: 'voice-refine', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }],
      });
    } catch (e) {
      return { ok: false, code: 'REFINE_NETWORK' };
    }
    let out = '';
    try {
      for await (const chunk of stream) {
        if (chunk && typeof chunk === 'object' && typeof chunk.text === 'string') out += chunk.text;
        if (out.length > (rf.maxTokens || REFINE_DEFAULT_MAX_TOKENS) * 4) break;
      }
    } catch (e) {
      return { ok: false, code: 'REFINE_NETWORK' };
    }
    const t = extractText(out);
    if (t === null || t === '') return { ok: false, code: 'REFINE_BAD_RESPONSE' };
    return { ok: true, text: t };
  }
  // custom 模式：独立 OpenAI 兼容配置
  if (!rf.baseUrl || !rf.apiKey || !rf.model) return { skipped: true };
  const body = {
    model: rf.model,
    max_tokens: rf.maxTokens || REFINE_DEFAULT_MAX_TOKENS,
    messages: [
      { role: 'system', content: REFINE_PROMPT },
      { role: 'user', content: text },
    ],
  };
  let r;
  try {
    r = await httpsRequest(rf.baseUrl + '/chat/completions', {
      headers: { authorization: 'Bearer ' + rf.apiKey, 'content-type': 'application/json' },
      body,
      timeoutMs: REFINE_TIMEOUT_MS,
    });
  } catch (e) {
    return { ok: false, code: e && e.code === 'NETWORK' ? 'REFINE_NETWORK' : 'REFINE_TIMEOUT' };
  }
  if (r.status >= 400) {
    return { ok: false, code: r.status === 401 ? 'REFINE_NO_KEY' : 'REFINE_BAD_RESPONSE' };
  }
  const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
  const t = extractText(content);
  // 空 / 截断（finish_reason length 未细判，空串回退 raw）→ REFINE_BAD_RESPONSE（不阻塞，text=raw）
  if (t === null) return { ok: false, code: 'REFINE_BAD_RESPONSE' };
  return { ok: true, text: t };
}

/** voice/status：读配置组装状态（local 字段实时探测 worker，P2） */
async function status(cfg) {
  const voice = sanitizeVoiceCfg(voiceCfgOf(cfg));
  const local = await localStatus();
  // refine.configured：chain 模式（基座模型）→ provider/model 已选即就绪；custom 模式 → 独立三项完整
  const refineConfigured = voice.refine.enabled === true && (
    voice.refine.mode === 'chain'
      ? !!(voice.refine.provider && voice.refine.model)
      : !!(voice.refine.baseUrl && voice.refine.apiKey && voice.refine.model)
  );
  return {
    ok: true,
    asr: {
      engine: voice.asr.engine,
      local,
      cloud: { configured: !!(voice.asr.cloud.baseUrl && voice.asr.cloud.apiKey && voice.asr.cloud.model) },
    },
    refine: { configured: refineConfigured },
  };
}

/** voice/transcribe 主入口：audioBase64 = data URL；返回 {ok, text, raw, refined, warn?} */
async function transcribe(cfg, audioBase64, engineOverride) {
  const voice = sanitizeVoiceCfg(voiceCfgOf(cfg));
  const engine = engineOverride === 'local' ? 'local' : voice.asr.engine;
  if (typeof audioBase64 !== 'string' || !/^data:audio\/(wav|mp3);base64,/.test(audioBase64)) {
    return { ok: false, code: 'BAD_AUDIO' };
  }
  if (Buffer.byteLength(audioBase64, 'utf8') > AUDIO_MAX_BYTES) return { ok: false, code: 'AUDIO_TOO_LARGE' };

  // P2：本地引擎（sherpa-onnx worker）——离线识别，无 refine（识别即规整源，规整仍可走 refine 配置）
  if (engine === 'local') {
    const lr = await transcribeLocal(audioBase64, voice.asr.local.language);
    if (!lr.ok) return lr;
    const raw = lr.text;
    if (!raw) return { ok: true, text: '', raw: '', refined: null };
    let refined = null;
    let warn = null;
    const rf = await refineText(voice, raw);
    if (rf && rf.ok) refined = rf.text;
    else if (rf && !rf.skipped) warn = rf.code;
    return { ok: true, text: refined !== null ? refined : raw, raw, refined, ...(warn ? { warn } : {}) };
  }

  let asrRes;
  if (voice.asr.cloud.protocol === 'openai') {
    asrRes = await transcribeOpenai(voice, audioBase64, ASR_TIMEOUT_MS);
  } else {
    asrRes = await transcribeChat(voice, audioBase64, ASR_TIMEOUT_MS);
  }
  if (!asrRes.ok) return asrRes;
  const raw = asrRes.text;
  if (!raw) return { ok: true, text: '', raw: '', refined: null }; // 空结果 → client voiceErrEmpty

  let refined = null;
  let warn = null;
  const rf = await refineText(voice, raw);
  if (rf && rf.ok) refined = rf.text;
  else if (rf && !rf.skipped) warn = rf.code; // REFINE 失败不阻塞（降级 raw）

  return { ok: true, text: refined !== null ? refined : raw, raw, refined, ...(warn ? { warn } : {}) };
}

module.exports = { sanitizeVoiceCfg, status, transcribe, setLlm, refineText };
