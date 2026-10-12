'use strict';
/**
 * dsh-prompt-enhancer — lib/asr.cjs（语音侧 host，P1-a 缩批后）
 *
 * 职责（P1-a 缩批后）：
 *   - voice/transcribe：data URL 音频 → **委托官方 `ctx.speechToText`** 识别 → refine 规整 → {text,raw,refined}
 *   - voice/status：**委托官方 `ctx.speechToText.snapshot()`** 报引擎就绪态 + refine 就绪态
 *   - refine 规整（OpenAI 兼容 chat/completions 或基座 llm；粗处理去口水词，失败降级 raw）
 *   - sanitizeVoiceCfg（白名单净化，config/set 对 voice 字段调用）
 *
 * P1-a（2026-10-13）退役面：云端双协议（transcribeChat/transcribeOpenai）、本地 worker 引擎
 * （asr-worker/asr-models/asr-deploy 三件 + 端口发现）、`asr.cloud.*` / `asr.local.*` 配置面。
 * 识别改由官方 `ctx.speechToText`（`dsh-experimental-speech-to-text`）承担，见 setSpeechToText()。
 * ⚠ 判据（方案的 P1 出口条件）：**REFINE_PROMPT（规整）必须保留** —— 它是用户点名的四项增值之一。
 *
 * 独立 require 模块（lib/index.cjs 加载），不入 build-host 产物；发布白名单 lib/ 已覆盖。
 * 框架纪律：只经公开 API 调用，不 fork 不改写。
 */
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const REFINE_TIMEOUT_MS = 15000;
const REFINE_DEFAULT_MAX_TOKENS = 300;
// ⚠ 四项增值之一（规整）：不得删除。
const REFINE_PROMPT = '去除口水词（嗯/啊/然后/那个等），保持原意，不重写、不新增内容、不改语义、不细化标点。只输出清理后的文本。';

function normalizeBaseUrl(u) {
  return typeof u === 'string' ? u.trim().replace(/\/+$/, '') : '';
}

/** 提取 voice 段：兼容两种输入——整配置（{version,voice:{...},...}，host handler 现状）与 voice 段（测试/内部调用）。 */
function voiceCfgOf(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  if (cfg.refine && typeof cfg.refine === 'object') return cfg;
  if (cfg.voice && typeof cfg.voice === 'object') return cfg.voice;
  return null;
}

/**
 * 白名单净化 voice 配置（非法值回退默认；未知键丢弃）。
 * ⚠ P1-a 缩批后：`asr.cloud.*` 与 `asr.local.*` 已退役（识别交官方），故不再保留这两段；
 *   仅保留「四项增值」的配置面：refine（规整）/ vad（静音监测）/ hotkey（热键）/ autoEnhance（自动增强）。
 */
function sanitizeVoiceCfg(cfg) {
  const rf = cfg && cfg.refine && typeof cfg.refine === 'object' ? cfg.refine : {};
  const vd = cfg && cfg.vad && typeof cfg.vad === 'object' ? cfg.vad : {};
  const hk = cfg && cfg.hotkey && typeof cfg.hotkey === 'object' ? cfg.hotkey : {};
  return {
    refine: {
      enabled: rf.enabled === true,
      // mode='chain' 用基座模型列表选中的 provider/model（走基座 llm，免 key，含本地模型）；
      // mode='custom' 用下方独立配置（高级）。
      mode: rf.mode === 'custom' ? 'custom' : 'chain',
      provider: typeof rf.provider === 'string' ? rf.provider : '',
      model: typeof rf.model === 'string' ? rf.model : '',
      baseUrl: normalizeBaseUrl(rf.baseUrl),
      apiKey: typeof rf.apiKey === 'string' ? rf.apiKey : '',
      maxTokens: Number.isInteger(rf.maxTokens) && rf.maxTokens >= 1 && rf.maxTokens <= 2000 ? rf.maxTokens : REFINE_DEFAULT_MAX_TOKENS,
    },
    vad: { enabled: vd.enabled === false ? false : true },
    hotkey: {
      enabled: hk.enabled === true,
      combo: typeof hk.combo === 'string' && hk.combo ? hk.combo : '',
    },
    // 语音识别完自动触发增强：布尔白名单——host 仅透传存储，client 触发链路使用
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

/** chat 响应 content 提取：兼容 string 与 [{type:'text',text}] 多模态形态；缺失返回 null */
function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const t = content.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('').trim();
    return t === '' ? null : t;
  }
  return null;
}

// 基座 llm 服务（refine chain 模式用规整区自选的基座模型 provider/model，免填 key）——由 lib/index.cjs 注入
let llmService = null;
function setLlm(llm) {
  llmService = llm && typeof llm.stream === 'function' ? llm : null;
}

// P1-a（2026-10-13）：官方识别服务（dsh-experimental-speech-to-text）——由 lib/index.cjs 注入。
// ⚠ 服务取不到时**不 park 插件**（本模块是普通 require 模块，非 cordis 插件面）⇒ 降级返回明确 code。
let speechService = null;
function setSpeechToText(svc) {
  speechService = svc && typeof svc.transcribe === 'function' && typeof svc.resolve === 'function' ? svc : null;
}
function hasSpeechService() { return !!speechService; }

/** refine 规整：mode='chain' 走基座 llm；mode='custom' 走独立 OpenAI 兼容；失败返回 {ok:false,code}（不抛，降级 raw） */
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
  if (t === null) return { ok: false, code: 'REFINE_BAD_RESPONSE' };
  return { ok: true, text: t };
}

/**
 * voice/status（P1-a 缩批后）：**委托官方 `ctx.speechToText.snapshot()`** —
 * 报「识别引擎就绪态」+「规整就绪态」。⚠ 不再探测本地 worker（该引擎已退役）。
 */
async function status(cfg) {
  const voice = sanitizeVoiceCfg(voiceCfgOf(cfg));
  let speech = null;
  let speechError = null;
  if (!speechService) {
    speechError = 'SPEECH_SERVICE_UNAVAILABLE';
  } else {
    try {
      const snap = speechService.snapshot();
      speech = snap && typeof snap === 'object' ? snap : null;
      if (!speech) speechError = 'SPEECH_SNAPSHOT_EMPTY';
    } catch (e) {
      speechError = String((e && e.message) || e);
    }
  }
  const refineConfigured = voice.refine.enabled === true && (
    voice.refine.mode === 'chain'
      ? !!(voice.refine.provider && voice.refine.model)
      : !!(voice.refine.baseUrl && voice.refine.apiKey && voice.refine.model)
  );
  const providers = speech && Array.isArray(speech.providers) ? speech.providers : [];
  return {
    ok: true,
    speech: {
      available: !!speech,
      providers,
      selection: speech && speech.selection ? speech.selection : null,
      ...(speechError ? { error: speechError } : {}),
    },
    refine: { configured: refineConfigured },
  };
}

/** 从 data URL 取 base64（P1-a：官方 `speech/transcribe` 收 canonical base64） */
function base64OfDataUrl(dataUrl) {
  const i = typeof dataUrl === 'string' ? dataUrl.indexOf(',') : -1;
  return i >= 0 ? dataUrl.slice(i + 1) : '';
}

/**
 * voice/transcribe（P1-a 缩批后）：data URL 音频 → **委托官方 `ctx.speechToText`** → refine 规整。
 * 返回 {ok, text, raw, refined, warn?}（形态与改前一致，client 侧消费方式不变）。
 */
async function transcribe(cfg, audioBase64, engineOverride) {
  const voice = sanitizeVoiceCfg(voiceCfgOf(cfg));
  if (typeof audioBase64 !== 'string' || !/^data:audio\/(wav|mp3|webm|ogg);base64,/.test(audioBase64)) {
    return { ok: false, code: 'BAD_AUDIO' };
  }
  if (!speechService) {
    return { ok: false, code: 'ASR_LOCAL_WORKER_DOWN', message: 'speechToText service unavailable' };
  }
  const b64 = base64OfDataUrl(audioBase64);
  let raw = '';
  try {
    const spec = speechService.resolve({ audio: Buffer.from(b64, 'base64') });
    const res = await speechService.transcribe(spec, undefined);
    // 官方 transcribe 返回 transcript 对象（含 text）；兼容纯字符串形态。
    raw = typeof res === 'string' ? res
      : (res && typeof res.text === 'string' ? res.text
        : (res && res.transcript && typeof res.transcript.text === 'string' ? res.transcript.text : ''));
  } catch (e) {
    return { ok: false, code: 'ASR_LOCAL_FAILED', message: String((e && e.message) || e) };
  }
  if (!raw) return { ok: true, text: '', raw: '', refined: null }; // 空结果 → client voiceErrEmpty

  let refined = null;
  let warn = null;
  const rf = await refineText(voice, raw);
  if (rf && rf.ok) refined = rf.text;
  else if (rf && !rf.skipped) warn = rf.code; // REFINE 失败不阻塞（降级 raw）
  return { ok: true, text: refined !== null ? refined : raw, raw, refined, ...(warn ? { warn } : {}) };
}

module.exports = { sanitizeVoiceCfg, status, transcribe, setLlm, setSpeechToText, hasSpeechService, refineText, REFINE_PROMPT };
