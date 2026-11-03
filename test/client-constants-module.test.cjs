'use strict';

// 目标模式：client 常量模块的导出面与共享运行时接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const constants = require('../src/client/constants-module.cjs');

const NAMES = [
  'CONFIG_KEY', 'CONFIG_KEY_V1', 'CONFIG_DEFAULTS', 'DEFAULT_MODEL_CHAIN',
  'MODE_OPTIONS', 'MODE_VALUES', 'MODE_BUDGET_OPTIONS', 'MODE_TIMEOUT_OPTIONS',
  'MODE_MAXTOKENS_OPTIONS', 'MODE_OUTPUTLIMIT_OPTIONS', 'MODE_PARAMS_DEFAULT',
  'MODE_BUDGET_DEFAULT', 'modeShortLabel', 'modeLabel', 'SEEN_KEY_PREFIX',
  'MEMORY_ROUNDS_MAX', 'TEMPLATE_BUILTIN_KEYS', 'TEMPLATE_CUSTOM_MAX',
  'TEMPLATE_TEXT_MAX', 'TEMPLATE_NAME_MAX', 'customPickIndex',
];

test('CCONST-01 旧 constants chunk 退役，21 项导出面完整', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/constants.js')), false);
  assert.deepEqual(Object.keys(constants).sort(), NAMES.slice().sort());
});

test('CCONST-02 配置默认值与五模式顺序不变', () => {
  assert.equal(constants.CONFIG_DEFAULTS.version, 2);
  assert.deepEqual(constants.MODE_VALUES, ['base', 'lite', 'standard', 'smart', 'publish']);
  assert.equal(constants.MODE_OPTIONS[0].label, '基础模式');
  assert.equal(constants.MODE_OPTIONS[4].label, '一键发布');
  assert.deepEqual(constants.DEFAULT_MODEL_CHAIN, [
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
  ]);
});

test('CCONST-03 模式标签/自定义索引辅助边界不变', () => {
  assert.equal(constants.modeShortLabel((k) => k, 'base'), '基础');
  assert.equal(constants.modeLabel((k) => k, 'publish'), '一键发布');
  assert.equal(constants.customPickIndex('custom:0'), 0);
  assert.equal(constants.customPickIndex('default'), -1);
  assert.equal(constants.customPickIndex('custom:x'), -1);
});

test('CCONST-04 共享运行时与构建产物内联常量模块', () => {
  const shared = fs.readFileSync(path.join(REPO_ROOT, 'src/client/shared-runtime.cjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(shared.includes("require('./constants-module.cjs')"));
  assert.ok(shared.includes('...constants'));
  assert.ok(client.includes('src/client/constants-module.cjs'));
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
});
