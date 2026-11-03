'use strict';

// 目标模式：client 模型候选模块的等价与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { buildCandidates } = require('../src/client/model-helpers-module.cjs');

test('CMH-01 旧 model-helpers chunk 已退役，普通模块在位', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/model-helpers.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/model-helpers-module.cjs')), true);
});

test('CMH-02 provider/model 映射与名称回退不变', () => {
  const out = buildCandidates([
    { provider: 'p', models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: '' }] },
  ], [], []);
  assert.deepEqual(out, [
    { provider: 'p', model: 'm1', name: 'M1', custom: false },
    { provider: 'p', model: 'm2', name: 'm2', custom: false },
  ]);
});

test('CMH-03 order 优先，未命中项内置优先于自定义', () => {
  const out = buildCandidates(
    [{ provider: 'p', models: [{ id: 'm1' }, { id: 'm2' }] }],
    [{ provider: 'p', model: 'c1', name: 'Custom' }],
    ['p/c1'],
  );
  assert.deepEqual(out.map((x) => x.model), ['c1', 'm1', 'm2']);
  assert.equal(out[0].custom, true);
});

test('CMH-04 client 产物内联候选模块，仍自包含', () => {
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  const shared = fs.readFileSync(path.join(REPO_ROOT, 'src/client/shared-runtime.cjs'), 'utf8');
  assert.ok(shared.includes("require('./model-helpers-module.cjs')"));
  assert.ok(client.includes('src/client/model-helpers-module.cjs'));
  assert.ok(client.includes('buildCandidates: modelHelpers.buildCandidates'));
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0,
    'client 产物不得保留相对 require（React 工厂参数是既有载体契约）');
});
