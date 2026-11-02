'use strict';

// 求值 client 清口水词模块的统一入口（目标模式：普通 CommonJS）。
// 冻结基线 `test/fixtures/client-filler/filler-source.txt` 是迁移前 `src/client/voice/filler.js` 的解码文本。
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../../scripts/lib/chunk-decode.mjs');

const FILLER_MODULE_REL = 'src/client/voice/filler-module.cjs';
const BASELINE_REL = 'test/fixtures/client-filler/filler-source.txt';

function fillerBaselineText() {
  return fs.readFileSync(path.join(REPO_ROOT, BASELINE_REL), 'utf8').replace(/\r\n/g, '\n');
}

function fillerModuleText() {
  return fs.readFileSync(path.join(REPO_ROOT, FILLER_MODULE_REL), 'utf8').replace(/\r\n/g, '\n');
}

function loadFillerModule() {
  return require(path.join(REPO_ROOT, FILLER_MODULE_REL));
}

module.exports = { FILLER_MODULE_REL, BASELINE_REL, fillerBaselineText, fillerModuleText, loadFillerModule };
