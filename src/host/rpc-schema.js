'use strict';
/**
 * M3: lightweight RPC argument schemas.
 *
 * These are intentionally simple validators (no dependency). They will be
 * replaced/augmented by Schemastery during full M3 implementation.
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
  'voice/modelList': {
    required: [],
    validate() {
      return true;
    },
  },
  'voice/modelDownload': {
    required: ['id'],
    validate(args) {
      return typeof args.id === 'string' && args.id.length > 0;
    },
  },
  'voice/modelProgress': {
    required: ['id'],
    validate(args) {
      return typeof args.id === 'string' && args.id.length > 0;
    },
  },
  'voice/status': {
    required: [],
    validate() {
      return true;
    },
  },
  'voice/transcribe': {
    required: ['audioBase64'],
    validate(args) {
      return typeof args.audioBase64 === 'string'
        && /^data:audio\/(wav|mp3);base64,/.test(args.audioBase64)
        && (args.engine === undefined || args.engine === 'local' || args.engine === 'cloud');
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
