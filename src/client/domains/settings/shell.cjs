'use strict';

// 设置页容器的构建期聚合入口。
const shell = require('./plugins-section.cjs');

module.exports = {
  createModelPluginsSection: shell.createModelPluginsSection,
};
