'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VOICE_CONFIG_KEYS, VOICE_CONFIG_DEFAULTS, cloneVoiceConfigDefaults } = require('../src/shared/contracts/voice-config.cjs');
const { voiceStateChunkWithDefaults } = require('./helpers/voice-state-chunk.cjs');

function loadVoiceState() {
  const src = voiceStateChunkWithDefaults();
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

test('VCONF-05 产物面：共享默认值已注入且只注入一次（state.js 不再自带第二份）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const client = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.cjs'), 'utf8');
  assert.ok(client.includes('const __VOICE_CONFIG_DEFAULTS__ = Object.freeze('),
    '产物缺共享默认值注入（state.js 会读不到该全局）');
  assert.equal((client.match(/const __VOICE_CONFIG_DEFAULTS__ = Object\.freeze\(/g) || []).length, 1,
    '共享默认值只应注入一次');
  assert.equal(client.includes('const VOICE_CFG_DEFAULTS = {\n'), false,
    'state.js 不得再内联第二份默认值对象（单一事实源）');
  assert.equal(client.includes("require('../src/shared/contracts/voice-config.cjs')"), false,
    '产物不得保留外部 require');
});
