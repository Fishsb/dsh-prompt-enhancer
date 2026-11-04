'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(ROOT, 'lib', 'client.cjs'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'src', 'client', 'app-module.cjs'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'src', 'client', 'components', 'model-plugins-section-module.cjs'), 'utf8');

test('CDS-01 已退役 dynamicCordisRunner 查询不得复活', () => {
  assert.equal(app.includes('dynamicCordisRunner'), false);
  assert.equal(client.includes('dynamicCordisRunner'), false);
});

test('CDS-02 空占位槽位服务端注册不得复活', () => {
  assert.equal(app.includes("id: 'cordis-panel-enh'"), false);
  assert.equal(client.includes("id: 'cordis-panel-enh'"), false);
});

test('CDS-03 空占位组件不得保留为死符号', () => {
  assert.equal(app.includes('CordisBadgePlaceholder'), false);
  assert.equal(shell.includes('CordisBadgePlaceholder'), false);
  assert.equal(client.includes('CordisBadgePlaceholder'), false);
});

test('CDS-04 正式产物仍保持自包含与官方加载契约', () => {
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(client, /id: "dsh-prompt-enhancer"/);
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
  assert.equal(client.includes('require("node:'), false);
});
