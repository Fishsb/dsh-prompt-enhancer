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
});

test('PROTO-02 rpc schema validates required args', () => {
  // fix(M3)：enhance 契约 = client payload 的 text 字段（draft 为误用字段）
  assert.equal(validateRpcArgs('enhance', { sessionId: 's', text: 'd' }).ok, true);
  assert.equal(validateRpcArgs('enhance', { sessionId: 's' }).ok, false);
  assert.equal(validateRpcArgs('models/test', { provider: 'p', model: 'm' }).ok, true);
  assert.equal(validateRpcArgs('models/test', { provider: 'p' }).ok, false);
  assert.equal(validateRpcArgs('update/envcheck', {}).ok, true);
});
