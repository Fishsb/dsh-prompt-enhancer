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

module.exports = { VOICE_CONFIG_KEYS, VOICE_CONFIG_DEFAULTS, cloneVoiceConfigDefaults };

