'use strict';

// 语音配置契约（发布物内自包含的纯数据模块）。
// ⚠ 本文件是 `src/shared/contracts/voice-config.cjs` 的唯一实现来源；
//   发布白名单只含 `lib/`，因此运行时模块必须从 lib/ 取用，不得 require src/。
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
function normalizeVadSilenceMs(v) {
  const n = typeof v === 'number' ? v : NaN;
  if (Number.isInteger(n)) {
    if (n >= 1000 && n <= 5000 && n % 1000 === 0) return n;
    if (n >= 1 && n <= 5) return n * 1000;
  }
  return VOICE_CONFIG_DEFAULTS.vad.silenceMs;
}

module.exports = { VOICE_CONFIG_KEYS, VOICE_CONFIG_DEFAULTS, cloneVoiceConfigDefaults, normalizeVadSilenceMs };
