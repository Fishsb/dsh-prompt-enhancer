'use strict';

// 设置页基础导航组件的构建期运行时聚合入口。
// 组件工厂保持显式依赖注入；构建器把本模块及其依赖打成自包含表达式。
const collapsible = require('./collapsible-section-module.cjs');
const marquee = require('./marquee-select-module.cjs');

module.exports = {
  createCollapsibleSection: collapsible.createCollapsibleSection,
  createMarqueeSelect: marquee.createMarqueeSelect,
};
