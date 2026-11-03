'use strict';

// 语音配置契约：内部键与默认值。
// 用户可见名称不在此处；本模块只冻结内部标识符，避免 client/host 各自手写。
const VOICE_CONFIG_KEYS = Object.freeze(['filler', 'vad', 'hotkey', 'autoEnhance', 'correction']);
const VOICE_CONFIG_DEFAULTS = Object.freeze({
  filler: Object.freeze({ enabled: true }),
  vad: Object.freeze({ enabled: true, silenceMs: 2000 }),
  hotkey: Object.freeze({ enabled: false, combo: '' }),
  autoEnhance: false,
  correction: Object.freeze({ enabled: false }),
});

function cloneVoiceConfigDefaults() {
  return JSON.parse(JSON.stringify(VOICE_CONFIG_DEFAULTS));
}

// 静音档位归一：1–5 秒整数（毫秒写法 1000–5000 的整千倍）合法，其余回落默认。
// client 语音状态与 host sanitizeVoiceCfg 共用同一入口，避免两套白名单漂移。
function normalizeVadSilenceMs(v) {
  const n = typeof v === 'number' ? v : NaN;
  if (Number.isInteger(n)) {
    if (n >= 1000 && n <= 5000 && n % 1000 === 0) return n;
    if (n >= 1 && n <= 5) return n * 1000;
  }
  return VOICE_CONFIG_DEFAULTS.vad.silenceMs;
}

module.exports = { VOICE_CONFIG_KEYS, VOICE_CONFIG_DEFAULTS, cloneVoiceConfigDefaults, normalizeVadSilenceMs };

