'use strict';

// 增强按钮与错误提示的构建期聚合入口。
const button = require('./button.cjs');
const bar = require('./bar.cjs');

module.exports = {
  createEnhanceButton: button.createEnhanceButton,
  createEnhanceBar: bar.createEnhanceBar,
};
