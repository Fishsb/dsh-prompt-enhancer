'use strict';

// 源码侧契约入口：实现位于发布物内的 lib/contracts.cjs。
// 保留原有字段名（methods/configKeys/status/degraded），供既有调用方直接使用。
const data = require('./rpc.cjs');

module.exports = Object.freeze({
  methods: data.RPC_METHOD_LIST,
  configKeys: data.CONFIG_KEYS,
  status: data.RESULT_STATUSES,
  degraded: data.DEGRADED_REASONS,
  rpcRegistry: data.RPC_REGISTRY,
  errorKeys: data.ERROR_KEYS,
  errorCodes: data.ERROR_CODES,
  configDefaults: data.CONFIG_DEFAULTS,
});
