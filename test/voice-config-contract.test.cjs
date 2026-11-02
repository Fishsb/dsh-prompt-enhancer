'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');
const { VOICE_CONFIG_KEYS, VOICE_CONFIG_DEFAULTS, cloneVoiceConfigDefaults } = require('../src/shared/contracts/voice-config.cjs');

function loadVoiceState() {
  const src = decodeChunk('src/client/voice/state.js');
  const ls = new Map();
  const localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  const factory = new Function('localStorage', 'host', src + '\n;return { VOICE_CFG_DEFAULTS };');
  return factory(localStorage, { call: () => Promise.resolve({ ok: false }) });
}

test('VCONF-01 键集合与 client voice/state.js 同形', () => {
  const actual = loadVoiceState().VOICE_CFG_DEFAULTS;
  assert.deepEqual([...VOICE_CONFIG_KEYS].sort(), Object.keys(actual).sort());
});

test('VCONF-02 默认值与 client voice/state.js 逐字段相等', () => {
  const actual = loadVoiceState().VOICE_CFG_DEFAULTS;
  assert.deepEqual(JSON.parse(JSON.stringify(VOICE_CONFIG_DEFAULTS)), actual);
});

test('VCONF-03 clone 返回独立副本，修改不污染事实源', () => {
  const a = cloneVoiceConfigDefaults();
  a.filler.enabled = false;
  assert.equal(VOICE_CONFIG_DEFAULTS.filler.enabled, true);
  assert.equal(cloneVoiceConfigDefaults().filler.enabled, true);
});

test('VCONF-04 事实源冻结', () => {
  assert.equal(Object.isFrozen(VOICE_CONFIG_KEYS), true);
  assert.equal(Object.isFrozen(VOICE_CONFIG_DEFAULTS), true);
});