'use strict';

// 客户端中英文文案的测试侧单一入口。
// 旧 chunk 需要 JSON 解码；普通模块迁移后直接提供源码与已求值字典，避免测试各自复制读取逻辑。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const I18N_MODULE_REL = 'src/client/i18n-module.cjs';
const ABS = path.join(ROOT, I18N_MODULE_REL);
const SOURCE = fs.readFileSync(ABS, 'utf8');
const DICTS = require(ABS);

function i18nSource() {
  return SOURCE;
}

function i18nBody() {
  return SOURCE.replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '');
}

module.exports = {
  I18N_MODULE_REL,
  i18nSource,
  i18nBody,
  ZH: DICTS.ZH,
  EN: DICTS.EN,
};
