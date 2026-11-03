'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VOICE_CONFIG_KEYS, VOICE_CONFIG_DEFAULTS, cloneVoiceConfigDefaults, normalizeVadSilenceMs } = require('../src/shared/contracts/voice-config.cjs');
const { voiceStateChunkWithDefaults } = require('./helpers/voice-state-chunk.cjs');

function loadVoiceState() {
  const src = voiceStateChunkWithDefaults();
  const ls = new Map();
  const localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  const factory = new Function('localStorage', 'host', src + '\n;return { VOICE_CFG_DEFAULTS };');
  return factory(localStorage, { call: () => Promise.resolve({ ok: false }) });
}

test('VCONF-01 键集合与 client voice/state-module.cjs 同形', () => {
  const actual = loadVoiceState().VOICE_CFG_DEFAULTS;
  assert.deepEqual([...VOICE_CONFIG_KEYS].sort(), Object.keys(actual).sort());
});

test('VCONF-02 默认值与 client voice/state-module.cjs 逐字段相等', () => {
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

test('VCONF-05 产物面：共享运行时已由打包器注入且只注入一次（状态模块不再自带第二份）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const client = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.cjs'), 'utf8');
  for (const mod of ['src/shared/contracts/voice-config.cjs', 'src/shared/voice/postprocess-plan.cjs', 'src/shared/contracts/client-runtime.cjs']) {
    assert.ok(client.includes('"' + mod + '"'), '共享运行时模块 id 未内联：' + mod);
  }
  assert.ok(client.includes('defaults: contracts.VOICE_CONFIG_DEFAULTS'), '状态模块的默认值必须来自共享契约');
  assert.ok(client.includes('src/client/voice/state-module.cjs'), '产物须内联语音状态普通模块');
  assert.equal(client.includes("require('../src/shared/contracts/"), false, '产物不得保留外部 require');
  assert.equal(client.includes("require('../src/shared/voice/"), false, '产物不得保留外部 require');
});

test('VCONF-06 VAD 档位归一为契约单一入口：client 与 host 同值', () => {
  const asr = require('../lib/asr.cjs');
  for (const input of [1, 2, 3, 4, 5, 1000, 3000, 5000]) {
    assert.equal(normalizeVadSilenceMs(input), input <= 5 ? input * 1000 : input, '契约合法值：' + input);
  }
  for (const input of [0, 6, 1.5, '3000', null, undefined, NaN, -1000]) {
    assert.equal(normalizeVadSilenceMs(input), VOICE_CONFIG_DEFAULTS.vad.silenceMs, '契约非法值回落：' + String(input));
    assert.equal(asr.sanitizeVoiceCfg({ vad: { silenceMs: input } }).vad.silenceMs,
      VOICE_CONFIG_DEFAULTS.vad.silenceMs, 'host 必须与契约同值：' + String(input));
  }
  assert.equal(asr.sanitizeVoiceCfg({ vad: { silenceMs: 5000 } }).vad.silenceMs, 5000);
});
