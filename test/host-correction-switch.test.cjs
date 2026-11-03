'use strict';

// 目标模式：纠错开关普通模块的语义锁 + 产物接线锁。
// 线上 RPC 契约不变：跳过仍返回 skipped / skippedBy / switchFrom / code，且不伪造 changed。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const {
  CORRECTION_DISABLED_CODE,
  CORRECTION_ENABLED_REASON,
  correctionEnabledOf,
  resolveCorrectionSwitch,
} = require('../src/host/correction-switch.cjs');

const MODULE_REL = 'src/host/correction-switch.cjs';

test('HCS-01 常量与既有 RPC 契约一致', () => {
  assert.equal(CORRECTION_DISABLED_CODE, 'CORRECTION_DISABLED');
  assert.equal(CORRECTION_ENABLED_REASON, 'correction.enabled');
});

test('HCS-02 取形严格 === true（缺省 / 非法值 fail-closed）', () => {
  assert.equal(correctionEnabledOf({ correction: { enabled: true } }), true);
  assert.equal(correctionEnabledOf({ voice: { correction: { enabled: true } } }), true);
  for (const v of [false, 'true', 1, null, {}, 0, 'yes', undefined]) {
    assert.equal(correctionEnabledOf({ correction: { enabled: v } }), false, '非法值 ' + JSON.stringify(v) + ' 必须按关');
  }
  assert.equal(correctionEnabledOf(null), false);
  assert.equal(correctionEnabledOf({}), false);
});

test('HCS-03 优先读 host 归一化面；缺位才回退请求配置', () => {
  const hostOn = resolveCorrectionSwitch({ correction: { enabled: false } }, {
    readVoiceConfig: () => ({ correction: { enabled: true } }),
  });
  assert.deepEqual(hostOn, { on: true, from: 'host-normalized' });
  const fallback = resolveCorrectionSwitch({ correction: { enabled: true } }, { readVoiceConfig: () => null });
  assert.deepEqual(fallback, { on: true, from: 'request-config' });
  const thrown = resolveCorrectionSwitch({ correction: { enabled: true } }, { readVoiceConfig: () => { throw new Error('disk'); } });
  assert.deepEqual(thrown, { on: true, from: 'request-config' });
});

test('HCS-04 产物内联模块（无外部 require），主链仍保留兼容包装名', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/correction-switch.cjs"'), 'host 产物必须内联纠错开关模块');
  assert.ok(host.includes('"src/host/correction-switch.cjs"'));
  assert.ok(host.includes('function correctionEnabledOf(rawCfg)'), '兼容包装名仍须在位');
  assert.ok(host.includes('function resolveCorrectionSwitch(argsCfg)'), '兼容包装名仍须在位');
  assert.equal((host.match(/require\(/g) || []).length, 0, 'host 产物不得含外部 require');
});
