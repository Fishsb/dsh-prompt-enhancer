'use strict';
// M3: RPC protocol/schema tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PROTOCOL_VERSION, RPC_METHODS, isKnownMethod } = require('../src/host/protocol.js');
const { validateRpcArgs } = require('../src/host/rpc-schema.js');

test('PROTO-01 protocol version and method registry', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.ok(RPC_METHODS.includes('enhance'));
  assert.ok(RPC_METHODS.includes('update/check'));
  assert.equal(isKnownMethod('enhance'), true);
  assert.equal(isKnownMethod('unknown/method'), false);
  // 2026-09-13（用户指令·移除插件内重启能力）：方法表 21 项，安装侧 RPC 为 update/install，
  // 重启 RPC update/portRestart 已删除——注册表不得残留或漂移。
  assert.equal(RPC_METHODS.length, 21);
  assert.ok(RPC_METHODS.includes('update/install'));
  assert.ok(!RPC_METHODS.includes('update/portRestart'));
  assert.equal(isKnownMethod('update/portRestart'), false);
});

test('PROTO-02 rpc schema validates required args', () => {
  // fix(M3)：enhance 契约 = client payload 的 text 字段（draft 为误用字段）
  assert.equal(validateRpcArgs('enhance', { sessionId: 's', text: 'd' }).ok, true);
  assert.equal(validateRpcArgs('enhance', { sessionId: 's' }).ok, false);
  assert.equal(validateRpcArgs('models/test', { provider: 'p', model: 'm' }).ok, true);
  assert.equal(validateRpcArgs('models/test', { provider: 'p' }).ok, false);
  assert.equal(validateRpcArgs('update/envcheck', {}).ok, true);
});
