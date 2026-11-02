'use strict';

// 目标模式：纠错状态模块在正式 client 产物中的接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');

test('CCSP-01 产物内联纠错状态模块与共享运行时', () => {
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'client.cjs'), 'utf8');
  const modId = '\\"src/client/voice/correction-state-module.cjs\\"';
  assert.ok(client.includes(modId), 'client 产物必须内联纠错状态模块');
  assert.ok(client.includes('const __DSH_CORRECTION_STATE__ = { CORRECTION_PHASES: __DSH_CLIENT_SHARED__.CORRECTION_PHASES'),
    '产物必须把纠错状态模块暴露为构建期符号');
  assert.equal((client.match(/const __DSH_CORRECTION_STATE__ = /g) || []).length, 1,
    '纠错状态注入只能出现一次');
  assert.equal(client.includes("require('./voice/correction-state-module.cjs')"), false,
    '产物不得保留外部 require');
});

test('CCSP-02 correction.js 的相位/票据实现已委托普通模块', () => {
  const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');
  const src = decodeChunk('src/client/voice/correction.js');
  assert.ok(src.includes('__DSH_CORRECTION_STATE__.correctionPhaseOf'),
    '相位推导必须委托普通模块');
  assert.ok(src.includes('__DSH_CORRECTION_STATE__.correctionFailureTicket'),
    '失败票据必须委托普通模块');
  assert.ok(src.includes('__DSH_CORRECTION_STATE__.correctionFailureConsume'),
    '失败消费必须委托普通模块');
});
