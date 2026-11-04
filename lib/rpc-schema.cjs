'use strict';
/**
 * RPC argument validation derived from lib/contracts.cjs.
 *
 * The contract registry is the single source for method names and required argument
 * shapes. This module keeps the existing `schemas` surface for compatibility and
 * preserves the historical behavior: methods without a declared schema remain
 * permissive (`ok: true`), which is intentional for the published contract.
 */
const { RPC_REGISTRY, RPC_SCHEMA_METHOD_LIST } = require('./contracts.cjs');

function typeMatches(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return true;
}

const schemas = {};
for (const method of RPC_SCHEMA_METHOD_LIST) {
  const row = RPC_REGISTRY[method];
  schemas[method] = {
    required: row.required.slice(),
    validate(args) {
      for (const key of Object.keys(row.types || {})) {
        if (!typeMatches(args[key], row.types[key])) return false;
      }
      return true;
    },
  };
}

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
