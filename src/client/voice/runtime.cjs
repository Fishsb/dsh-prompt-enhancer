'use strict';

// 语音运行时聚合入口（构建期由打包器内联）。
const correction = require('./correction-module.cjs');
const bridge = require('./official-bridge-module.cjs');
const hotkey = require('./hotkey-module.cjs');
const section = require('./voice-section-module.cjs');
const state = require('./state-module.cjs');

module.exports = {
  createVoiceState: state.createVoiceState,
  createCorrectionState: correction.createCorrectionState,
  createOfficialVoiceBridge: bridge.createOfficialVoiceBridge,
  createVoiceHotkey: hotkey.createVoiceHotkey,
  createVoiceSection: section.createVoiceSection,
};
