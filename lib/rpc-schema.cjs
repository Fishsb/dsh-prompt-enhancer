'use strict';
/**
 * M3: lightweight RPC argument schemas (runtime copy used by lib/index.cjs).
 * P1b（2026-09-19）：源/副本关系反转修正——原注「source of truth in src/host/rpc-schema.js」
 * 所指文件是从未接线的**死层**且已删除；**本文件即唯一事实源**（lib/ 内运行时副本）。
 */
const schemas = {
  'enhance': {
    // fix(M3)：契约 = client payload（helpers.js 传 {sessionId, seq, text, config, mode}）
    // 与 host handler（读 args.text）——此前误用 draft 字段导致全部 enhance 请求被 400 拦截。
    required: ['sessionId', 'text'],
    validate(args) {
      return typeof args.sessionId === 'string' && typeof args.text === 'string';
    },
  },
  'models/test': {
    required: ['provider', 'model'],
    validate(args) {
      return typeof args.provider === 'string' && typeof args.model === 'string';
    },
  },
  'config/get': {
    required: [],
    validate() {
      return true;
    },
  },
  'config/set': {
    required: ['config'],
    validate(args) {
      return !!args.config && typeof args.config === 'object' && !Array.isArray(args.config);
    },
  },
  'voice/status': {
    required: [],
    validate() {
      return true;
    },
  },
};

function validateRpcArgs(method, args) {
  const schema = schemas[method];
  if (!schema) return { ok: true };
  if (!args || typeof args !== 'object') return { ok: false, code: 'BAD_ARGS', message: 'args must be an object' };
  for (const key of schema.required) {
    if (args[key] === undefined) return { ok: false, code: 'MISSING_ARG', message: 'missing required arg: ' + key };
  }
  if (schema.validate && !schema.validate(args)) {
    return { ok: false, code: 'INVALID_ARG', message: 'invalid args for ' + method };
  }
  return { ok: true };
}

module.exports = { schemas, validateRpcArgs };
