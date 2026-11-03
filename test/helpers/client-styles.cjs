'use strict';

// 客户端样式模块的测试侧单一入口。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const STYLES_MODULE_REL = 'src/client/styles-module.cjs';
const ABS = path.join(ROOT, STYLES_MODULE_REL);
const SOURCE = fs.readFileSync(ABS, 'utf8').replace(/\r\n/g, '\n');
const { CSS } = require(ABS);

function stylesSource() {
  return SOURCE;
}

function stylesBody() {
  return SOURCE.replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '');
}

module.exports = {
  STYLES_MODULE_REL,
  stylesSource,
  stylesBody,
  CSS,
};
