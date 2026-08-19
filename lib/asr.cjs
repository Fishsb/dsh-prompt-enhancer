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
const { URL } = require('node:url');

const AUDIO_MAX_BYTES = 10 * 1024 * 1024; // data URL 全串 ≤10MB（60s 16k mono ≈ 2.6MB）
const ASR_TIMEOUT_MS = 30000;
const REFINE_TIMEOUT_MS = 15000;
const REFINE_DEFAULT_MAX_TOKENS = 300;
const REFINE_PROMPT = '去除口水词（嗯/啊/然后/那个等），保持原意，不重写、不新增内容、不改语义、不细化标点。只输出清理后的文本。';

function normalizeBaseUrl(u) {
  return typeof u === 'string' ? u.trim().replace(/\/+$/, '') : '';
}

/** 白名单净化 voice 配置（非法值回退默认；未知键丢弃——对齐 sanitizeV2 风格） */
function sanitizeVoiceCfg(cfg) {
  const asr = cfg && cfg.asr && typeof cfg.asr === 'object' ? cfg.asr : {};
  const cloud = asr.cloud && typeof asr.cloud === 'object' ? asr.cloud : {};
  const local = asr.local && typeof asr.local === 'object' ? asr.local : {};
  const rf = cfg && cfg.refine && typeof cfg.refine === 'object' ? cfg.refine : {};
  return {
    asr: {
      engine: asr.engine === 'local' ? 'local' : 'cloud',
      local: { model: typeof local.model === 'string' && local.model ? local.model : 'sensevoice-q8' },
      cloud: {
        protocol: cloud.protocol === 'openai' ? 'openai' : 'chat',
        baseUrl: normalizeBaseUrl(cloud.baseUrl),
        apiKey: typeof cloud.apiKey === 'string' ? cloud.apiKey : '',
        model: typeof cloud.model === 'string' && cloud.model ? cloud.model : 'qwen3-asr-flash',
      },
    },
    refine: {
      enabled: rf.enabled === true,
      provider: typeof rf.provider === 'string' ? rf.provider : '',
      model: typeof rf.model === 'string' ? rf.model : '',
      baseUrl: normalizeBaseUrl(rf.baseUrl),
      apiKey: typeof rf.apiKey === 'string' ? rf.apiKey : '',
      maxTokens: Number.isInteger(rf.maxTokens) && rf.maxTokens >= 1 && rf.maxTokens <= 2000 ? rf.maxTokens : REFINE_DEFAULT_MAX_TOKENS,
    },
  };
}

/** 出网（通道 C）：node:https 请求，body 支持 string/Buffer/object；超时/网络错误映射 code */
function httpsRequest(url, opts) {
  const { method = 'POST', headers = {}, body, timeoutMs } = opts || {};
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject({ code: 'NETWORK', message: 'bad url' }); }
    let payload = null;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) payload = body;
      else payload = JSON.stringify(body);
    }
    const req = https.request(u, {
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

/** refine 规整：OpenAI 兼容 chat/completions，小 maxTokens；失败返回 {ok:false, code}（不抛） */
async function refineText(voice, text) {
  const rf = voice.refine;
  if (!rf.enabled || !rf.baseUrl || !rf.apiKey || !rf.model) return { skipped: true };
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

/** voice/status：读配置组装状态（P1 local 恒 false 占位） */
function status(cfg) {
  const voice = sanitizeVoiceCfg(cfg && cfg.asr ? cfg : {});
  return {
    ok: true,
    asr: {
      engine: voice.asr.engine,
      local: { installed: false, modelReady: false, workerUp: false }, // P2 实现后置真
      cloud: { configured: !!(voice.asr.cloud.baseUrl && voice.asr.cloud.apiKey && voice.asr.cloud.model) },
    },
    refine: { configured: voice.refine.enabled === true && !!(voice.refine.baseUrl && voice.refine.apiKey && voice.refine.model) },
  };
}

/** voice/transcribe 主入口：audioBase64 = data URL；返回 {ok, text, raw, refined, warn?} */
async function transcribe(cfg, audioBase64, engineOverride) {
  const voice = sanitizeVoiceCfg(cfg && cfg.asr ? cfg : {});
  const engine = engineOverride === 'local' ? 'local' : voice.asr.engine;
  if (engine === 'local') return { ok: false, code: 'ASR_LOCAL_NOT_READY', message: '本地引擎 P2 提供' }; // P2
  if (typeof audioBase64 !== 'string' || !/^data:audio\/(wav|mp3);base64,/.test(audioBase64)) {
    return { ok: false, code: 'BAD_AUDIO' };
  }
  if (Buffer.byteLength(audioBase64, 'utf8') > AUDIO_MAX_BYTES) return { ok: false, code: 'AUDIO_TOO_LARGE' };

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

module.exports = { sanitizeVoiceCfg, status, transcribe };
