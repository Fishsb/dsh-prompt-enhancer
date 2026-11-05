'use strict';

// 语音运行时聚合入口（构建期由打包器内联）。
const correction = require('./correction.cjs');
const bridge = require('./official-bridge.cjs');
const hotkey = require('./hotkey.cjs');
const section = require('./section.cjs');
const state = require('./state.cjs');

module.exports = {
  createVoiceState: state.createVoiceState,
  createCorrectionState: correction.createCorrectionState,
  createOfficialVoiceBridge: bridge.createOfficialVoiceBridge,
  createVoiceHotkey: hotkey.createVoiceHotkey,
  createVoiceSection: section.createVoiceSection,
};
