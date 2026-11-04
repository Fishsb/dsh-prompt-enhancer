'use strict';

// 语音纠错开关解析（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 语义必须与现有实现逐项一致：
//   · 取形 `=== true`（缺省 = 关，fail-closed）；
//   · 优先读 host 已归一化配置（harness.readVoiceConfig）；
//   · 仅当该面缺位时回退请求随行 config；
//   · 返回值同时给出真值与来源，供 RPC 的 switchFrom 字段使用。
const { RPC_ERROR_CODES } = require('../shared/contracts/contract-data.cjs');
const CORRECTION_DISABLED_CODE = RPC_ERROR_CODES.CORRECTION_DISABLED;
const CORRECTION_ENABLED_REASON = 'correction.enabled';

function correctionEnabledOf(rawCfg) {
  const c = rawCfg && typeof rawCfg === 'object' ? rawCfg : null;
  if (!c) return false;
  const top = c.correction;
  if (top && typeof top === 'object') return top.enabled === true;
  const v = c.voice;
  if (v && typeof v === 'object' && v.correction && typeof v.correction === 'object') return v.correction.enabled === true;
  return false;
}

function resolveCorrectionSwitch(argsCfg, harness) {
  let face = null;
  try {
    face = (harness && typeof harness.readVoiceConfig === 'function') ? harness.readVoiceConfig() : null;
  } catch (e) {
    face = null;
  }
  if (face && typeof face === 'object') {
    return { on: correctionEnabledOf(face) === true, from: 'host-normalized' };
  }
  return { on: correctionEnabledOf(argsCfg) === true, from: 'request-config' };
}

module.exports = {
  CORRECTION_DISABLED_CODE,
  CORRECTION_ENABLED_REASON,
  correctionEnabledOf,
  resolveCorrectionSwitch,
};
