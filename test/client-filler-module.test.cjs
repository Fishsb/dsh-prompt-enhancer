'use strict';

// 目标模式：client 清口水词模块的等价锁（迁移自 `src/client/voice/filler.js` chunk）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { FILLER_MODULE_REL, BASELINE_REL, fillerBaselineText, fillerModuleText, loadFillerModule } = require('./helpers/client-filler-module.cjs');

test('CFM-01 旧 chunk 已退役，普通模块在位（不得双份）', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/voice/filler.js')), false,
    'src/client/domains/voice/filler.js 已退役；不得与 filler.cjs 并存');
  assert.equal(fs.existsSync(path.join(REPO_ROOT, FILLER_MODULE_REL)), true, '普通模块必须存在：' + FILLER_MODULE_REL);
});

test('CFM-02 新模块正文与冻结基线逐字相同（仅尾部追加导出）', () => {
  const baseline = fillerBaselineText();
  const actual = fillerModuleText();
  assert.ok(baseline.length > 5000, '冻结基准必须非空（实得 ' + baseline.length + '）');
  assert.ok(actual.startsWith(baseline), '新模块正文必须逐字包含迁移前基线；差异应仅为尾部导出语句');
  const tail = actual.slice(baseline.length);
  assert.match(tail, /^\n\n\/\/ 目标模式：清口水词以普通 CommonJS 模块承载/, '尾部只允许迁移说明');
  assert.match(tail, /module\.exports = \{/, '尾部必须导出完整声明面');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, BASELINE_REL)), '冻结基准必须在位：' + BASELINE_REL);
});

test('CFM-03 导出面与旧 chunk 顶层声明逐项同名、类型一致', () => {
  const baseline = fillerBaselineText();
  const fnNames = [...baseline.matchAll(/(?:^|\n)\s*function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const varNames = [...baseline.matchAll(/(?:^|\n)(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const expected = [...new Set([...fnNames, ...varNames])].sort();
  const api = loadFillerModule();
  assert.deepEqual(Object.keys(api).sort(), expected, '导出面必须与旧 chunk 顶层声明逐项同名');
  for (const name of fnNames) assert.equal(typeof api[name], 'function', name + ' 必须是函数');
  for (const name of varNames) assert.notEqual(api[name], undefined, name + ' 必须有值');
});

test('CFM-04 产物面：lib/client.cjs 由打包器内联清口水词模块（无外部 require）', () => {
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'client.cjs'), 'utf8');
  assert.ok(client.includes('"src/client/domains/voice/filler.cjs"'), '产物必须内联清口水词模块 id');
  assert.ok(client.includes('createClientHelpers'), '产物必须含客户端共享运行时入口');
  assert.ok(client.includes('function stripFillers'), '产物必须含清理器定义');
  assert.equal(client.includes("require('../src/client/domains/voice/filler.cjs')"), false,
    '产物不得保留外部 require');
});
