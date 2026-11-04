'use strict';

// 源码侧错误码契约转发（用户可见映射仍在既有 i18n 字典中）。
const contracts = require('../../../lib/contracts.cjs');

module.exports = {
  ERROR_KEYS: contracts.ERROR_KEYS,
  ERROR_CODES: contracts.ERROR_CODES,
  RPC_ERROR_CODES: contracts.RPC_ERROR_CODES,
  errorKeyOf: contracts.errorKeyOf,
};
