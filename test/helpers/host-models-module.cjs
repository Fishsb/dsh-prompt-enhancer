'use strict';

// 求值 host 模型域模块的统一入口（目标模式：普通 CommonJS）。
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../../scripts/lib/chunk-decode.mjs');

const MODELS_MODULE_REL = 'src/host/models-module.cjs';
const BASELINE_REL = 'test/fixtures/host-models/models-source.txt';

function modelsBaselineText() {
  return fs.readFileSync(path.join(REPO_ROOT, BASELINE_REL), 'utf8').replace(/\r\n/g, '\n');
}
function modelsModuleText() {
  return fs.readFileSync(path.join(REPO_ROOT, MODELS_MODULE_REL), 'utf8').replace(/\r\n/g, '\n');
}
function loadModelsModule() {
  return require(path.join(REPO_ROOT, MODELS_MODULE_REL));
}

module.exports = { MODELS_MODULE_REL, BASELINE_REL, modelsBaselineText, modelsModuleText, loadModelsModule };
