'use strict';

// 求值 `src/client/voice/state.js` 的统一夹具。
//
// 目标模式下，语音配置默认值的事实源是 `src/shared/contracts/voice-config.cjs`；
// 生产构建会把该契约的默认值注入为 `__VOICE_CONFIG_DEFAULTS__`。测试不能绕过这条
// 注入链，否则会得到“源码能构建、测试却缺全局”的假红。
//
// 这里只做同一件事：把契约默认值作为前置声明拼到 chunk 源码之前，再交给调用方的
// `new Function(...)`。不修改 chunk 源码，也不在运行期保留第二份默认值。
const { decodeChunk } = require('../../scripts/lib/chunk-decode.mjs');
const { VOICE_CONFIG_DEFAULTS } = require('../../src/shared/contracts/voice-config.cjs');

function voiceStateChunkWithDefaults() {
  const prelude = 'const __VOICE_CONFIG_DEFAULTS__ = '
    + JSON.stringify(VOICE_CONFIG_DEFAULTS)
    + ';\n';
  return prelude + decodeChunk('src/client/voice/state.js');
}

module.exports = { voiceStateChunkWithDefaults };
