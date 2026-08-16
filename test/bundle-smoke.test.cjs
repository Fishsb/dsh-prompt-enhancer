'use strict';
// M2: bundle smoke test — evaluate the generated plugin-host.js with a mock
// harness + ctx (same mechanism as lib/index.cjs: new Function('harness', BODY))
// and verify RPC registration plus fast-path behavior. This is the first
// direct test of the generated bundle's runtime surface.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');

function boot() {
  const handlers = new Map();
  const harness = {
    handle(method, fn) {
      if (typeof method === 'string' && typeof fn === 'function') handlers.set(method, fn);
    },
    probeEnv() {
      return null;
    },
  };
  // apply() directly executes: ctx.get('llm'), handler registration, ctx.effect.
  // All deep paths (timer, sessions, sandboxPolicy, web...) are only touched
  // inside handlers, so a minimal mock keeps the fast paths testable.
  const ctx = {
    get: () => undefined,
    effect: () => {},
  };
  const plugin = new Function('harness', BODY)(harness);
  if (typeof plugin.apply !== 'function') throw new Error('plugin.apply missing from bundle');
  plugin.apply(ctx);
  return { handlers };
}

test('SMK-01 bundle registers core RPC handlers', () => {
  const { handlers } = boot();
  const expected = [
    'enhance', 'enhance/progress', 'cancel', 'template/default', 'logs/last',
    'models/list', 'models/test', 'models/autochain', 'plugins/inventory',
  ];
  for (const method of expected) {
    assert.ok(handlers.has(method), 'missing handler: ' + method);
  }
});

test('SMK-02 enhance GUARD fast path (empty / command input)', async () => {
  const { handlers } = boot();
  const empty = await handlers.get('enhance')({ sessionId: 's', seq: 1, text: '' });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'GUARD');
  const command = await handlers.get('enhance')({ sessionId: 's', seq: 2, text: '/help me' });
  assert.equal(command.ok, false);
  assert.equal(command.code, 'GUARD');
});

test('SMK-03 enhance NO_LLM fast path (mock ctx has no llm service)', async () => {
  const { handlers } = boot();
  const out = await handlers.get('enhance')({ sessionId: 's', seq: 1, text: 'hello' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'NO_LLM');
});

test('SMK-04 enhance/progress returns NO_RECORD for unknown request', async () => {
  const { handlers } = boot();
  const out = await handlers.get('enhance/progress')({ sessionId: 'missing', seq: 42 });
  assert.deepEqual(out, { ok: false, code: 'NO_RECORD' });
});
