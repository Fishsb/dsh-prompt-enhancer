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
  'update/install': {
    // 2026-09-13（用户指令·插件内不再有重启能力）：安装已下载到 staging 的新版本。
    // 安装不重启宿主，返回 restartNeeded，由用户手动重启 DSH 生效。
    required: [],
    validate(args) {
      return args.profile === undefined || typeof args.profile === 'string';
    },
  },
  'update/diagTail': {
    // 2026-09-12（D1）：只读返回 DSH err 日志尾部（端口重启失败/超时后 client 补取根因）
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
  'voice/modelOpenDir': {
    required: [],
    validate() {
      return true;
    },
  },
  'voice/modelApply': {
    required: ['id'],
    validate(args) {
      return typeof args.id === 'string' && args.id.length > 0;
    },
  },
  'voice/modelDelete': {
    required: ['id'],
    validate(args) {
      return typeof args.id === 'string' && args.id.length > 0;
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
