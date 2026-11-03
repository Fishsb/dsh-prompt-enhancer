'use strict';

// 设置页模型配置组件的构建期运行时聚合入口。
// 依赖由构建器显式注入；组件正文、用户可见文案与类名保持不变。
const fallback = require('./fallback-row-module.cjs');
const main = require('./model-main-section-module.cjs');

module.exports = {
  createFallbackRow: fallback.createFallbackRow,
  createModelMainSection: main.createModelMainSection,
};
