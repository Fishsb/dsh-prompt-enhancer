'use strict';

// 目标模式：client 样式普通模块的逐字冻结与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { STYLES_MODULE_REL, stylesSource, CSS } = require('./helpers/client-styles.cjs');

test('CSTYLE-01 旧 styles chunk 退役，普通模块导出 CSS 字符串', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/styles.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, STYLES_MODULE_REL)), true);
  assert.equal(typeof CSS, 'string');
  assert.ok(CSS.length > 20000);
});

test('CSTYLE-02 关键布局选择器与属性逐字保留', () => {
  for (const fragment of [
    '.dsh-vi-slider{flex:1 1 auto;min-width:96px',
    '.dsh-plg-select-model{flex:1 1 0;min-width:135px}',
    '.dsh-plg-row > .dsh-plg-muted{flex:none;white-space:nowrap;max-width:40%',
    '.dsh-enh-btn{margin-right:-12px}',
  ]) {
    assert.ok(CSS.includes(fragment), '样式锚点缺失：' + fragment);
  }
});

test('CSTYLE-03 源模块体不含 module.exports，模块导出仅一份', () => {
  const source = stylesSource();
  assert.equal((source.match(/module\.exports\s*=/g) || []).length, 1);
  assert.ok(source.includes('module.exports = { CSS };'));
});

test('CSTYLE-04 共享运行时与产物内联 CSS，不再装载旧 chunk', () => {
  const shared = fs.readFileSync(path.join(REPO_ROOT, 'src/client/shared-runtime.cjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(shared.includes("require('./styles-module.cjs')"));
  assert.ok(shared.includes('CSS: styles.CSS'));
  assert.ok(client.includes('src/client/styles-module.cjs'));
  assert.equal(client.includes('src/client/styles.js'), false);
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
});
