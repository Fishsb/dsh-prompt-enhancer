'use strict';
/**
 * dsh-prompt-enhancer — lib/asr.cjs（语音侧 host）
 *
 * 职责：
 *   - voice/status：**委托官方 `ctx.speechToText.snapshot()`** 报引擎就绪态 + filler（清口水词）就绪态
 *   - sanitizeVoiceCfg（白名单净化，config/set 对 voice 字段调用）
 *
 * CHG-117（2026-10-16 · 规整改造批）：原 `refine`（调大模型做规整）**整体删除** ——
 *   改为 **client 半部本地纯规则**（`src/client/voice/filler.js`，不调模型、只清口水词）。
 *   ⇒ 随之删除：`refineText` / `transcribe` / `REFINE_*` / `REFINE_PROMPT` /
 *     `setLlm` + 基座 llm 注入 / `httpsRequest` / `extractText` / `normalizeBaseUrl` /
 *     以及 RPC `voice/transcribe`（该 RPC 自「自建采集链退役」后**已无调用方**，`CHG-115` `I-1`）。
 *   ⚠ 保留：`voice/status`（**live 面**，设置页就绪态用它）与 `speechService` 注入。
 *   ⚠ 已删的旧纪律：原文件头「**REFINE_PROMPT（规整）必须保留**」属旧约束，
 *     与 `UD-0032`（旧的直接删）冲突 ⇒ 本条**随实现一并删除**。
 *
 * P1-a（2026-10-13）退役面：云端双协议、本地 worker 引擎、`asr.cloud.*` / `asr.local.*` 配置面。
 * 识别改由官方 `ctx.speechToText`（`dsh-experimental-speech-to-text`）承担，见 setSpeechToText()。
 *
 * 独立 require 模块（lib/index.cjs 加载），不入 build-host 产物；发布白名单 lib/ 已覆盖。
 * 框架纪律：只经公开 API 调用，不 fork 不改写。
 */

const { URL } = require('node:url');


/**
 * 白名单净化 voice 配置（非法值回退默认；未知键丢弃）。
 * ⚠ P1-a 缩批后：`asr.cloud.*` 与 `asr.local.*` 已退役（识别交官方），故不再保留这两段；
 *   仅保留「四项增值」的配置面：filler（清口水词，CHG-117 由原 `refine` 改造）/ vad（静音监测）/ hotkey（热键）/ autoEnhance（自动增强）。
 */
// PROJECT §7.4：静音判定时长（1–5 秒，默认 2 秒）。非法值（含 `0`/`6`/`1.5`/`'x'`/`null`）一律回落 2000。
const VAD_SILENCE_MS_DEFAULT = 2000;
function normalizeVadSilenceMs(v) {
  const n = typeof v === 'number' ? v : NaN;
  if (Number.isInteger(n)) {
    if (n >= 1000 && n <= 5000 && n % 1000 === 0) return n;
    if (n >= 1 && n <= 5) return n * 1000;
  }
  return VAD_SILENCE_MS_DEFAULT;
}
function voiceCfgOf(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  if (cfg.filler && typeof cfg.filler === 'object') return cfg;
  if (cfg.voice && typeof cfg.voice === 'object') return cfg.voice;
  return null;
}
function sanitizeVoiceCfg(cfg) {
  const rf = cfg && cfg.filler && typeof cfg.filler === 'object' ? cfg.filler : {};
  const vd = cfg && cfg.vad && typeof cfg.vad === 'object' ? cfg.vad : {};
  const hk = cfg && cfg.hotkey && typeof cfg.hotkey === 'object' ? cfg.hotkey : {};
  return {
    // ⚠ S-7（盘点）：本白名单与 client `src/client/voice/state.js` 的 `mergeVoice` 是
    //   **两份独立白名单**，改名/改形必须**同批同形** —— 只改一侧 ⇒ 配置被静默剥掉（`CHG-115` `M-3`）。
    // CHG-117：`refine` 父键 → `filler`；**子键只留 `enabled`**（六子键全删；不调模型 ⇒ 无用途）。
    //   ⚠ 默认 **true**（缺省/非法都视为开）—— 与 client 侧同形。
    filler: { enabled: rf.enabled !== false },
    // P2-补做（2026-10-13 · PROJECT §7.4 / 方案 §4.6.2.7 第 3 项）：静音判定时长白名单——
    // 接受 1–5 秒整数（书写为毫秒 1000–5000 的 1000 整数倍）；**非法值一律回落 2000**。
    // ⚠ 与 client 侧 `normalizeVadSilenceMs`（`src/client/voice/state.js`）**同一口径**：两者均只接受 1–5 秒整数。
    vad: { enabled: vd.enabled === false ? false : true, silenceMs: normalizeVadSilenceMs(vd.silenceMs) },
    hotkey: {
      enabled: hk.enabled === true,
      combo: typeof hk.combo === 'string' && hk.combo ? hk.combo : '',
    },
    // 语音识别完自动触发增强：布尔白名单——host 仅透传存储，client 触发链路使用
    autoEnhance: (cfg && cfg.autoEnhance === true) ? true : false,
    // CHG-143（纠错语音独立步批）：correction=语音识别完成后先纠错（独立一步，可脱离增强独立生效）。
    //   ⚠ **取形逐字对齐 `autoEnhance`**（`=== true`）⇒ **默认关闭**（缺省/非法一律 false，用户已定）。
    //   ⚠ 与 client `mergeVoice` 的 `correction` **同批同形**（`M-3`：漏改一侧 ⇒ 配置被静默剥掉）。
    //   ⚠ host 仅透传存储；触发链路在 client（识别完成后的两开关组合）。
    correction: { enabled: (cfg && cfg.correction && cfg.correction.enabled === true) ? true : false },
  };
}

// ⚠ 服务取不到时**不 park 插件**（本模块是普通 require 模块，非 cordis 插件面）⇒ 降级返回明确 code。
let speechService = null;
function setSpeechToText(svc) {
  speechService = svc && typeof svc.transcribe === 'function' && typeof svc.resolve === 'function' ? svc : null;
}

/** 报「识别引擎就绪态」+「filler（清口水词）就绪态」。⚠ 不再探测本地 worker（该引擎已退役）。 */
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
  // CHG-117：`filler` 无需"配置齐备"判定（纯本地、无模型/凭据）—— 就绪态 = 开关是否开。
  //   ⚠ 保留字段名 `configured` 以免动 client 侧读取；语义收窄为「开关是否开」。
  const fillerConfigured = voice.filler.enabled === true;
  const providers = speech && Array.isArray(speech.providers) ? speech.providers : [];
  return {
    ok: true,
    speech: {
      available: !!speech,
      providers,
      selection: speech && speech.selection ? speech.selection : null,
      ...(speechError ? { error: speechError } : {}),
    },
    filler: { configured: fillerConfigured },
  };
}

/**
 * 读**已归一化**的 voice 配置（纠错服务端守卫批 · 2026-10-17 · 第 ① 件）。
 *
 * 为什么要有这个导出（**不是**新造解析，见报告 §④）：
 *   `sanitizeVoiceCfg` 的白名单**只认顶层键**（`cfg.correction` / `cfg.filler` / `cfg.vad`），
 *   而磁盘配置的 voice 段是在 **`cfg.voice`** 下（`dsh-prompt-enhancer.config.json` 实测：
 *   `voice.correction.enabled`）。⇒ 直接 `sanitizeVoiceCfg(diskConfig)` 会把 `correction`
 *   **静默归一成 false**（本批实测踩到：开关打开时也被判成关 ⇒ 功能被永久关死 = 拆东墙）。
 *   本文件内 `status()` 早已用 **`sanitizeVoiceCfg(voiceCfgOf(cfg))`** 处理同一件事
 *   （`voiceCfgOf` 负责"顶层平铺 / `voice` 下钻"两种形态的收敛）。本函数**就是那同一条路径**，
 *   只是把它开放给 `lib/index.cjs` 的接线面复用 ⇒ **没有第二份解析**（`M-3`）。
 *
 * ⚠ fail-closed：入参非对象 ⇒ 返回 `null`（调用方按"关"处理且**必须可见**）。
 * @param {object} cfg 磁盘配置（或其 voice 段）
 * @returns {object|null} `sanitizeVoiceCfg` 的归一化产物（`correction.enabled` 已是布尔）
 */
function readNormalizedVoiceCfg(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  try {
    const v = sanitizeVoiceCfg(voiceCfgOf(cfg));
    return v && typeof v === 'object' ? v : null;
  } catch (e) { return null; }
}

module.exports = { sanitizeVoiceCfg, readNormalizedVoiceCfg, status, setSpeechToText };
