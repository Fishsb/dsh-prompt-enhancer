'use strict';

// 目标模式：host 模型域普通模块的等价锁（迁移自 `src/host/models.js` chunk）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { MODELS_MODULE_REL, BASELINE_REL, modelsBaselineText, modelsModuleText, loadModelsModule } = require('./helpers/host-models-module.cjs');

test('HMM-01 旧 chunk 已退役，普通模块在位（不得双份）', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/host/models.js')), false,
    'src/host/models.js 已退役；不得与 models-module.cjs 并存');
  assert.equal(fs.existsSync(path.join(REPO_ROOT, MODELS_MODULE_REL)), true, '普通模块必须存在：' + MODELS_MODULE_REL);
});

test('HMM-02 新模块正文与冻结基线逐字相同（仅尾部追加导出）', () => {
  const baseline = modelsBaselineText();
  const actual = modelsModuleText();
  assert.ok(baseline.length > 2000, '冻结基准必须非空（实得 ' + baseline.length + '）');
  assert.ok(actual.includes(baseline), '新模块正文必须逐字包含迁移前基线');
  const tail = actual.slice(actual.indexOf(baseline) + baseline.length);
  assert.match(tail, /module\.exports = \{/, '正文后必须导出完整声明面');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, BASELINE_REL)), '冻结基准必须在位：' + BASELINE_REL);
});

test('HMM-03 导出面与旧 chunk 顶层声明逐项同名、类型一致', () => {
  const baseline = modelsBaselineText();
  const fnNames = [...baseline.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const constNames = [...baseline.matchAll(/(?:^|\n)(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const expected = [...new Set([...fnNames, ...constNames])].sort();
  const api = loadModelsModule();
  assert.deepEqual(Object.keys(api).sort(), expected, '导出面必须与旧 chunk 顶层声明逐项同名');
  for (const name of fnNames) assert.equal(typeof api[name], 'function', name + ' 必须是函数');
  for (const name of constNames) assert.notEqual(api[name], undefined, name + ' 必须有值');
});

test('HMM-04 产物面：plugin-host.js 由打包器内联模型域模块（无外部 require）', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/domains/models/chain.cjs"'), 'host 产物必须内联模型域模块 id');
  assert.ok(host.includes('"src/host/domains/models/chain.cjs"'), 'host 产物必须内联模型域模块 id');
  assert.equal((host.match(/require\(/g) || []).length, 0, 'host 产物不得含外部 require');
});
