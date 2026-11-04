'use strict';

// 目标模式：host PURE 区段迁移为普通 CommonJS 模块的等价锁。
//
// 迁移前 `src/host/pure.js` 是 `module.exports = "<源码字符串>"` 的 chunk；
// 迁移后 `src/host/pure-module.cjs` 是普通模块，由 build-host 的打包器内联。
// 本文件只证明两件事：
//   ① 新模块正文与迁移前的冻结基准逐字相同（尾部仅允许追加 module.exports）；
//   ② 导出面与旧 chunk 的顶层声明逐项同名、类型一致。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { pureBaselineText, pureModuleText, loadPureModule, PURE_MODULE_REL, BASELINE_REL } = require('./helpers/host-pure-module.cjs');

test('HPM-01 旧 chunk 已退役，普通模块在位（R4 等值集不允许双份）', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src', 'host', 'pure.js')), false,
    'src/host/pure.js 已退役；不得与 pure-module.cjs 并存');
  assert.equal(fs.existsSync(path.join(REPO_ROOT, PURE_MODULE_REL)), true,
    '普通模块必须存在：' + PURE_MODULE_REL);
});

test('HPM-02 新模块正文与冻结基准逐字相同（仅尾部允许追加导出）', () => {
  const baseline = pureBaselineText();
  const actual = pureModuleText();
  assert.ok(baseline.length > 50000, '冻结基准必须非空（实得 ' + baseline.length + '）');
  const beginMarker = '// ==PURE-BEGIN==  (unit-testable pure functions; keep free of ctx/harness/pending/module-state)\n\n';
  const head = '// 目标模式：原 PURE 区段依赖的三个上游常量由 models 模块注入；\n// 迁移为普通模块后改为显式依赖，不再复制常量、也不再靠构建切片注入。\nconst { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOKENS, DEFAULT_OUTPUT_LIMIT } = require(\'./models-constants.cjs\');\n';
  assert.ok(baseline.startsWith(beginMarker), '冻结基准必须以 PURE 起始标记开头');
  // 契约收敛批（2026-11-04）：预算/模式/模板上限常量改由 lib/contracts.cjs 派生。
  // 判别力不降：① 除该声明块外，正文仍须与冻结基准逐字相同；② 旧基线常量与新契约逐项同值；
  // ③ 尾部只允许迁移说明与导出面。⛔ 不是「去掉基线比对」。
  const contractHead = "const contractData = require('../shared/contracts/contract-data.cjs');\n";
  const CONTRACT_BLOCK_RE = /\/\/ ================= v2\.2 模式体系[\s\S]*?(?=\/\/ 预算 → 扫描上限查表)/;
  const TEMPLATE_LIMITS_RE = /const TEMPLATE_CUSTOM_MAX = [^\n]+;\nconst TEMPLATE_TEXT_MAX = [^\n]+;\nconst TEMPLATE_NAME_MAX = [^\n]+;\n/;
  const baselineBlock = baseline.match(CONTRACT_BLOCK_RE);
  const actualBlock = actual.match(CONTRACT_BLOCK_RE);
  assert.ok(baselineBlock && actualBlock, '冻结基准与新模块都必须包含可识别的常量声明块');
  const normalize = (s) => s.replace(CONTRACT_BLOCK_RE, '__CONTRACT_BLOCK__\n').replace(TEMPLATE_LIMITS_RE, '__TEMPLATE_LIMITS__\n');
  // 基线从 PURE marker 起；新模块在 marker 后多了迁移说明与一行契约转发。
  const baselineBody = baseline.slice(beginMarker.length).replace(/^\n/, '');
  const actualAfterMarker = actual.slice(actual.indexOf(beginMarker) + beginMarker.length);
  assert.ok(actualAfterMarker.startsWith(head + contractHead), 'PURE marker 后必须只有已声明的迁移头部与契约转发');
  const expected = normalize(baselineBody);
  const observed = normalize(actualAfterMarker.slice((head + contractHead).length).replace(/^\n/, ''));
  assert.ok(observed.startsWith(expected), '除契约托管常量块外，正文必须与冻结基准逐字相同');
  const tail = observed.slice(expected.length);
  assert.match(tail, /^\n\n\/\/ 目标模式：PURE 区段以普通 CommonJS 模块承载/, '尾部只允许迁移说明');
  assert.match(tail, /module\.exports = \{/, '尾部必须导出完整声明面');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, BASELINE_REL)), '冻结基准必须在位：' + BASELINE_REL);

  // 旧基线常量 ↔ 新契约逐项同值（测试内显式求值基线常量块，不在生产代码留第二份）。
  const pick = (src) => {
    const names = ['BUDGET_OPTIONS', 'MODE_BUDGET_OPTIONS', 'MODE_BUDGET_DEFAULT', 'MODE_PARAMS_DEFAULT'];
    const out = {};
    for (const name of names) {
      const re = new RegExp('const ' + name + ' = ([\\s\\S]*?);\\n', 'm');
      const m = src.match(re);
      assert.ok(m, '基线缺常量 ' + name);
      out[name] = Function('return (' + m[1] + ');')();
    }
    return out;
  };
  const legacy = pick(baselineBlock[0]);
  const contractData = require(path.join(REPO_ROOT, 'lib', 'contracts.cjs'));
  assert.deepEqual(contractData.BUDGET_OPTIONS, legacy.BUDGET_OPTIONS);
  assert.deepEqual(JSON.parse(JSON.stringify(contractData.MODE_BUDGET_OPTIONS)), legacy.MODE_BUDGET_OPTIONS);
  assert.deepEqual(JSON.parse(JSON.stringify(contractData.MODE_BUDGET_DEFAULT)), legacy.MODE_BUDGET_DEFAULT);
  assert.deepEqual(JSON.parse(JSON.stringify(contractData.MODE_PARAMS_DEFAULT)), legacy.MODE_PARAMS_DEFAULT);
  const legacyLimits = [
    Number(baseline.match(/const TEMPLATE_CUSTOM_MAX = (\d+);/)[1]),
    Number(baseline.match(/const TEMPLATE_TEXT_MAX = (\d+);/)[1]),
    Number(baseline.match(/const TEMPLATE_NAME_MAX = (\d+);/)[1]),
  ];
  assert.deepEqual([contractData.TEMPLATE_CUSTOM_MAX, contractData.TEMPLATE_TEXT_MAX, contractData.TEMPLATE_NAME_MAX], legacyLimits,
    '模板容量/长度上限必须与冻结基线逐项同值');
});

test('HPM-03 导出面与旧 chunk 顶层声明逐项同名、类型一致', () => {
  const baseline = pureBaselineText();
  const fnNames = [...baseline.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const constNames = [...baseline.matchAll(/(?:^|\n)(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const expected = [...new Set([...fnNames, ...constNames])].sort();
  const api = loadPureModule();
  assert.deepEqual(Object.keys(api).sort(), expected, '导出面必须与旧 chunk 顶层声明逐项同名');
  for (const name of fnNames) assert.equal(typeof api[name], 'function', name + ' 必须是函数');
  for (const name of constNames) assert.notEqual(api[name], undefined, name + ' 必须有值');
});

test('HPM-04 产物面：plugin-host.js 由打包器内联纯函数模块（无外部 require）', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('GENERATED by scripts/lib/module-bundler.mjs'),
    'host 产物缺打包器生成标记');
  assert.ok(host.includes('"src/host/pure-module.cjs"'), 'host 产物必须内联纯函数模块 id');
  assert.ok(host.includes('"src/host/pure-module.cjs"'), 'host 产物必须内联纯函数模块 id');
  assert.equal(host.includes("require('../src/host/pure-module.cjs')"), false,
    'host 产物不得保留外部 require');
});
