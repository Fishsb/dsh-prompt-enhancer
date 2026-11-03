'use strict';

// 增强按钮与错误提示的构建期聚合入口。
const button = require('./enhance-button-module.cjs');
const bar = require('./enhance-bar-module.cjs');

module.exports = {
  createEnhanceButton: button.createEnhanceButton,
  createEnhanceBar: bar.createEnhanceBar,
};
