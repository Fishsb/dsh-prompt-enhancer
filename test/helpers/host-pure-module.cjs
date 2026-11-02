'use strict';

// 求值 host 纯函数模块的统一入口（目标模式：普通 CommonJS，不再按 chunk 字符串切片）。
// 冻结基准 `test/fixtures/host-pure/pure-source.txt` 是迁移前 `src/host/pure.js` 的解码文本；
// 新模块必须逐字包含该正文（尾部只允许追加导出语句），否则等价性不成立。
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../../scripts/lib/chunk-decode.mjs');

const PURE_MODULE_REL = 'src/host/pure-module.cjs';
const BASELINE_REL = 'test/fixtures/host-pure/pure-source.txt';

function pureBaselineText() {
  return fs.readFileSync(path.join(REPO_ROOT, BASELINE_REL), 'utf8').replace(/\r\n/g, '\n');
}

function pureModuleText() {
  return fs.readFileSync(path.join(REPO_ROOT, PURE_MODULE_REL), 'utf8').replace(/\r\n/g, '\n');
}

/** 求值 PURE 模块，返回其完整导出面（与旧 chunk 的顶层声明逐项同名）。 */
function loadPureModule() {
  return require(path.join(REPO_ROOT, PURE_MODULE_REL));
}

module.exports = { PURE_MODULE_REL, BASELINE_REL, pureBaselineText, pureModuleText, loadPureModule };
