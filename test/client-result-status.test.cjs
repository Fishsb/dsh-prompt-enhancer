'use strict';

// 目标模式：client 结果状态消费共享契约的接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');

test('CRS-01 helpers 在成功分支写入统一 resultStatus', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src/client/common/helpers.cjs'), 'utf8');
  assert.ok(src.includes('resultStatusOf({ ok: result.ok === true'), '必须消费共享状态映射');
  assert.ok(src.includes('session.resultStatus = resultStatus'), '结果态必须保存统一状态');
  assert.ok(src.includes("? 'changed' : 'failed'"), '缺共享面时必须有保守回退');
});

test('CRS-02 产物内联共享 result 契约（无外部 require）', () => {
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'client.cjs'), 'utf8');
  assert.ok(client.includes('"src/shared/contracts/result.cjs"'), '产物必须内联 result 契约');
  assert.ok(client.includes('resultStatusOf'), '产物必须含状态映射函数');
  assert.equal(client.includes("require('../src/shared/contracts/result.cjs')"), false,
    '产物不得保留外部 require');
});
