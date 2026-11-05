'use strict';

// 目标模式：设置页基础导航组件的普通模块与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const collapsible = require('../src/client/ui/collapsible-section.cjs');
const marquee = require('../src/client/ui/marquee-select.cjs');

test('CNAV-01 旧组件 chunk 退役，两个工厂模块在位', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/collapsible-section.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/marquee-select.js')), false);
  assert.equal(typeof collapsible.createCollapsibleSection, 'function');
  assert.equal(typeof marquee.createMarqueeSelect, 'function');
});

test('CNAV-02 工厂返回原组件同名函数，显式依赖生效', () => {
  const CollapsibleSection = collapsible.createCollapsibleSection({
    React: {}, dshEnhId: (prefix) => prefix + '-stable',
  });
  const MarqueeSelect = marquee.createMarqueeSelect({ React: {}, window: null, document: null });
  assert.equal(typeof CollapsibleSection, 'function');
  assert.equal(CollapsibleSection.name, 'CollapsibleSection');
  assert.equal(typeof MarqueeSelect, 'function');
  assert.equal(MarqueeSelect.name, 'MarqueeSelect');
});

test('CNAV-03 折叠组件默认展开与 ARIA 关联逻辑保留', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/client/ui/collapsible-section.cjs'), 'utf8');
  assert.ok(source.includes('React.useState(true)'));
  assert.ok(source.includes("'aria-controls': ids.body"));
  assert.ok(source.includes("'aria-labelledby': ids.head"));
  assert.ok(source.includes("role: 'region'"));
});

test('CNAV-04 跑马灯组件仍消费 window/document 与键盘导航', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/client/ui/marquee-select.cjs'), 'utf8');
  assert.ok(source.includes('requestAnimationFrame'));
  assert.ok(source.includes('document.addEventListener'));
  assert.ok(source.includes('ArrowDown'));
  assert.ok(source.includes('ArrowUp'));
});

test('CNAV-05 构建产物内联导航运行时，不再装载旧组件 chunk', () => {
  const build = fs.readFileSync(path.join(REPO_ROOT, 'scripts/build-client.mjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(build.includes("entry: 'src/client/app.cjs'"));
  assert.ok(client.includes('src/client/ui/navigation.cjs'));
  assert.ok(client.includes('src/client/ui/collapsible-section.cjs'));
  assert.ok(client.includes('src/client/ui/marquee-select.cjs'));
  assert.equal(client.includes('src/client/components/collapsible-section.js'), false);
  assert.equal(client.includes('src/client/components/marquee-select.js'), false);
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
});
