'use strict';

// 求值 `src/client/domains/voice/state.cjs` 的统一夹具。
//
// 目标模式下，语音配置默认值的事实源是 `src/shared/contracts/voice-config.cjs`；
// 生产构建把该契约传给 `createVoiceState({ defaults })`。测试沿用同一注入形态。
//
// 这里读取普通模块正文，拼出同一工厂调用并把导出解构为旧测试期待的顶层名字。
const fs = require('node:fs');
const path = require('node:path');
const { VOICE_CONFIG_DEFAULTS, normalizeDictionaryEntries } = require('../../src/shared/contracts/voice-config.cjs');
const { RPC_METHODS } = require('../../src/shared/contracts/rpc.cjs');

function voiceStateChunkWithDefaults() {
  // UD-0055 / UD-0057：生产装配层会把词典归一实现注入 `createVoiceState`；
  //   夹具沿用同一形态 —— 调用方可在 `new Function(..., 'normalizeDictionaryEntries', src)`
  //   里传入契约实现；未传时保持恒等兜底（与「未注入」分支等价，旧测试行为不变）。
  const prelude = 'const __NORMALIZE_DICT__ = (typeof normalizeDictionaryEntries === "undefined") ? null : normalizeDictionaryEntries;\n'
    + 'const __VOICE_CONFIG_DEFAULTS__ = '
    + JSON.stringify(VOICE_CONFIG_DEFAULTS)
    + ';\nconst __RPC_METHODS__ = ' + JSON.stringify(RPC_METHODS) + ';\n';
  const modulePath = path.join(__dirname, '..', '..', 'src', 'client', 'domains', 'voice', 'state.cjs');
  const body = fs.readFileSync(modulePath, 'utf8')
    .replace(/\nmodule\.exports\s*=\s*\{\s*createVoiceState\s*\};\s*$/, '')
    .replace(/^'use strict';\s*/, '');
  const epilogue = '\nconst __VOICE_STATE__ = createVoiceState({\n'
    + '  host,\n'
    + '  storage: localStorage,\n'
    + '  timerSvc: typeof timerSvc !== "undefined" ? timerSvc : null,\n'
    + '  fillerState: typeof fillerState !== "undefined" ? fillerState : null,\n'
    + '  defaults: __VOICE_CONFIG_DEFAULTS__,\n'
    + '  normalizeDictionaryEntries: __NORMALIZE_DICT__,\n'
    + '  rpcMethods: __RPC_METHODS__,\n'
    + '  autoSync: false,\n'
    + '});\n'
    + 'const { VOICE_CFG_KEY, VOICE_CFG_DEFAULTS, normalizeVadSilenceMs, vadSilenceMsOf,\n'
    + '  vadRequiredQuiet, voiceCfgState, mergeVoice, persistVoiceLocal, notifyVoice,\n'
    + '  syncVoiceFromHost, saveVoiceCfg, cleanupLegacyRefine, subscribeVoiceConfig } = __VOICE_STATE__;\n'
    + 'syncVoiceFromHost();\n';
  return prelude + body + epilogue;
}

module.exports = { voiceStateChunkWithDefaults, normalizeDictionaryEntries };
