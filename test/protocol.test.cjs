'use strict';
// M3: RPC protocol/schema tests.
const test = require('node:test');
const assert = require('node:assert/strict');
// P1b（2026-09-19）：M3 骨架 src/host/protocol.js 已退役 → 其守卫 PROTO-01 随骨架一并退役
//（该表声明 21 条而线上实为 34 条，本就不构成事实源；源头治理见 P2）。
// rpc-schema 的活副本是 lib/rpc-schema.cjs（原 src/host/rpc-schema.js 为死层，已删）→ 守卫改挂活副本。
const { validateRpcArgs } = require('../lib/rpc-schema.cjs');

test('PROTO-02 rpc schema validates required args', () => {
  // fix(M3)：enhance 契约 = client payload 的 text 字段（draft 为误用字段）
  assert.equal(validateRpcArgs('enhance', { sessionId: 's', text: 'd' }).ok, true);
  assert.equal(validateRpcArgs('enhance', { sessionId: 's' }).ok, false);
  assert.equal(validateRpcArgs('models/test', { provider: 'p', model: 'm' }).ok, true);
  assert.equal(validateRpcArgs('models/test', { provider: 'p' }).ok, false);
  assert.equal(validateRpcArgs('update/envcheck', {}).ok, true);
});
