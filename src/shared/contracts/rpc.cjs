'use strict';

// 源码侧 RPC 契约转发。构建器会把 lib/contracts.cjs 内联进两半部产物。
const contracts = require('../../../lib/contracts.cjs');

module.exports = contracts;
