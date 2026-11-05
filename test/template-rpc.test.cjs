'use strict';

// 目标模式：template/default 普通模块的返回结构锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createTemplateRpc } = require('../src/host/domains/settings/template.cjs');

const PROMPTS = {
  base: 'B1', incrementBase: 'B2',
  lite: 'L1', incrementLite: 'L2',
  standard: 'S1', incrementStandard: 'S2',
  smart: 'M1', incrementSmart: 'M2',
  publish: 'P1', incrementPublish: 'P2',
};

test('TRPC-01 defaults 保持五模式 T1 映射', async () => {
  const out = await createTemplateRpc(PROMPTS).templateDefault();
  assert.deepEqual(out.defaults, { base: 'B1', lite: 'L1', standard: 'S1', smart: 'M1', publish: 'P1' });
});

test('TRPC-02 catalog 保持五模式 [T1,T2] 顺序', async () => {
  const out = await createTemplateRpc(PROMPTS).templateDefault();
  assert.deepEqual(out.catalog, {
    base: ['B1', 'B2'], lite: ['L1', 'L2'], standard: ['S1', 'S2'],
    smart: ['M1', 'M2'], publish: ['P1', 'P2'],
  });
  assert.equal(out.ok, true);
});

test('TRPC-03 产物内联模板 RPC 模块，方法名不变', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/domains/settings/template.cjs"'));
  assert.ok(host.includes('"src/host/domains/settings/template.cjs"'));
  assert.ok(host.includes('harness.handle(RPC_METHODS.TEMPLATE_DEFAULT, templateRpc.templateDefault)'));
  assert.equal((host.match(/require\(/g) || []).length, 0);
});
