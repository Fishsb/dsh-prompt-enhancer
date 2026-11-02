'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CORRECTION_UI_KEYS, correctionUiKey } = require('../src/shared/contracts/ui-state.cjs');

test('UIST-01 六态各有独立展示键', () => {
  const keys = Object.values(CORRECTION_UI_KEYS);
  assert.equal(new Set(keys).size, 6, '六态键必须互不相同');
});

test('UIST-02 已知相位原样映射', () => {
  assert.equal(correctionUiKey('idle'), 'voiceCorrectionStateIdle');
  assert.equal(correctionUiKey('running'), 'voiceCorrectionStateRunning');
  assert.equal(correctionUiKey('changed'), 'voiceCorrectionStateChanged');
  assert.equal(correctionUiKey('unchanged'), 'voiceCorrectionStateUnchanged');
  assert.equal(correctionUiKey('skipped'), 'voiceCorrectionStateSkipped');
  assert.equal(correctionUiKey('failed'), 'voiceCorrectionStateFailed');
});

test('UIST-03 未知/空值回退 idle，不抛错', () => {
  assert.equal(correctionUiKey('unknown'), 'voiceCorrectionStateIdle');
  assert.equal(correctionUiKey(''), 'voiceCorrectionStateIdle');
  assert.equal(correctionUiKey(null), 'voiceCorrectionStateIdle');
});

test('UIST-04 键表冻结，防止运行期被就地改写', () => {
  assert.equal(Object.isFrozen(CORRECTION_UI_KEYS), true);
});