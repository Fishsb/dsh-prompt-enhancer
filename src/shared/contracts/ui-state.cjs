'use strict';

// Client 可见状态映射：纠错相位 → 按钮展示键。
// 文案键名属于用户可见契约，本函数只做选择，不改文案。
const CORRECTION_UI_KEYS = Object.freeze({
  idle: 'voiceCorrectionStateIdle',
  running: 'voiceCorrectionStateRunning',
  changed: 'voiceCorrectionStateChanged',
  unchanged: 'voiceCorrectionStateUnchanged',
  skipped: 'voiceCorrectionStateSkipped',
  failed: 'voiceCorrectionStateFailed',
});

function correctionUiKey(phase) {
  return CORRECTION_UI_KEYS[phase] || CORRECTION_UI_KEYS.idle;
}

module.exports = { CORRECTION_UI_KEYS, correctionUiKey };