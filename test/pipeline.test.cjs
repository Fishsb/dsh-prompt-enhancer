'use strict';
// M2: enhance pipeline registry unit tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pipeline } = require('../src/host/pipeline.js');

test('PIPE-01 register/run handlers in priority order', async () => {
  const p = new Pipeline();
  const calls = [];
  p.register('stage', async (v) => { calls.push('a'); return v + 1; }, { priority: 10 });
  p.register('stage', async (v) => { calls.push('b'); return v * 2; }, { priority: 5 });
  const out = await p.run('stage', 1, {});
  // priority 5 -> v*2 = 2, priority 10 -> +1 = 3
  assert.equal(out, 3, 'low priority number runs first');
  assert.deepEqual(calls, ['b', 'a']);
});

test('PIPE-02 unregister removes handler', async () => {
  const p = new Pipeline();
  const h = async (v) => v + 1;
  p.register('x', h);
  assert.equal(await p.run('x', 1, {}), 2);
  p.unregister('x', h);
  assert.equal(await p.run('x', 1, {}), 1, 'no handler returns input unchanged');
});

test('PIPE-03 error isolation via context.onError', async () => {
  const p = new Pipeline();
  const errors = [];
  p.register('x', async () => { throw new Error('boom'); });
  p.register('x', async (v) => v + 10);
  const out = await p.run('x', 1, { onError: (name, e) => errors.push(e.message) });
  assert.equal(out, 11, 'error handler skipped, next handler runs');
  assert.deepEqual(errors, ['boom']);
});
