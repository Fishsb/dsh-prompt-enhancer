'use strict';
// M2: enhance service built on Pipeline.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pipeline } = require('../src/host/pipeline.js');
const enhance = require('../src/host/enhance.js');

function makeServices() {
  const pipeline = new Pipeline();
  const services = { get: (name) => (name === 'enhance.pipeline' ? pipeline : undefined) };
  return { pipeline, services };
}

test('ENH-01 enhance service runs all stages in order', async () => {
  const { pipeline, services } = makeServices();
  enhance.register(null, services);
  const service = enhance.createService(services);
  const calls = [];
  pipeline.register('analyze', async (v) => { calls.push('analyze'); return { ...v, a: 1 }; }, { priority: 1 });
  pipeline.register('retrieve', async (v) => { calls.push('retrieve'); return { ...v, r: 2 }; }, { priority: 1 });
  pipeline.register('assemble', async (v) => { calls.push('assemble'); return { ...v, s: 3 }; }, { priority: 1 });
  pipeline.register('llm', async (v) => { calls.push('llm'); return { ...v, l: 4 }; }, { priority: 1 });

  const out = await service.run({ input: 'x' }, {});
  assert.deepEqual(calls, ['analyze', 'retrieve', 'assemble', 'llm']);
  assert.deepEqual(out, { input: 'x', a: 1, r: 2, s: 3, l: 4 });
});

test('ENH-02 default no-op handlers keep pipeline runnable', async () => {
  const { services } = makeServices();
  enhance.register(null, services);
  const service = enhance.createService(services);
  const out = await service.run({ input: 'x' }, {});
  assert.deepEqual(out, { input: 'x' });
});
