'use strict';
/**
 * M3: lightweight RPC argument schemas (runtime copy used by lib/index.cjs).
 * Source of truth in src/host/rpc-schema.js; this file is the bundle-safe
 * CommonJS version shipped inside lib/.
 */
const schemas = {
  'enhance': {
    required: ['sessionId', 'draft'],
    validate(args) {
      return typeof args.sessionId === 'string' && typeof args.draft === 'string';
    },
  },
  'models/test': {
    required: ['provider', 'model'],
    validate(args) {
      return typeof args.provider === 'string' && typeof args.model === 'string';
    },
  },
  'update/check': {
    required: ['repo', 'tagsPayload'],
    validate(args) {
      return typeof args.repo === 'string' && typeof args.tagsPayload === 'string';
    },
  },
  'update/envcheck': {
    required: [],
    validate() {
      return true;
    },
  },
  'plugins/run': {
    required: ['sessionId', 'pluginId'],
    validate(args) {
      return typeof args.sessionId === 'string' && typeof args.pluginId === 'string';
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
