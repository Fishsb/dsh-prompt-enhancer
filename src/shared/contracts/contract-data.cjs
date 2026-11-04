'use strict';

// 源码侧契约转发：实现位于发布物内的 lib/contracts.cjs。
// 构建器会把本文件与 lib/contracts.cjs 一并内联；运行期不会留下外部 require。
module.exports = require('../../../lib/contracts.cjs');
