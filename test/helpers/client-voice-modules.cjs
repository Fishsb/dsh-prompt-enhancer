'use strict';

// 语音普通模块的统一测试入口（CHG-343，边界修正）。
// 测试仍求值真实模块源码；这里只负责把模块体从工厂包装中取出，供既有沙箱注入。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

// 取工厂内部正文（依赖声明之后、return 之前），供既有 new Function 沙箱按原依赖名注入。
// 不取工厂签名本身：测试调用方已经按符号名提供依赖，重复的形参声明会触发语法错误。
function factoryBody(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const fnStart = raw.indexOf('function ');
  const bodyStart = raw.indexOf('//', fnStart);
  const end = raw.lastIndexOf('\n  return ');
  if (fnStart < 0 || bodyStart < 0 || end <= bodyStart) {
    throw new Error('语音模块正文边界读不出：' + rel);
  }
  return raw.slice(bodyStart, end);
}

module.exports = {
  correctionBody: () => factoryBody('src/client/voice/correction-module.cjs'),
  officialBridgeBody: () => factoryBody('src/client/voice/official-bridge-module.cjs'),
  hotkeyBody: () => factoryBody('src/client/voice/hotkey-module.cjs'),
  voiceSectionBody: () => factoryBody('src/client/voice/voice-section-module.cjs'),
  correctionSource: () => factoryBody('src/client/voice/correction-module.cjs')
    + '\nreturn { correctionState, correctionSnapshot, subscribeCorrection, notifyCorrection,'
    + ' markCorrectionSkipped, markCorrectionStarted, markCorrectionSettled, markCorrectionFailed,'
    + ' correctionPhaseOf, correctionPhaseView, correctionPhaseKnown, CORRECTION_PHASES,'
    + ' correctionFailureTicket, consumeCorrectionFailure };',
  officialBridgeSource: () => factoryBody('src/client/voice/official-bridge-module.cjs')
    + '\nreturn officialVoiceBridge;',
  hotkeySource: () => factoryBody('src/client/voice/hotkey-module.cjs'),
  voiceSectionSource: () => factoryBody('src/client/voice/voice-section-module.cjs')
    + '\nreturn { ovbSinceLabel, OfficialVoiceDiag, FillerDiag, CorrectionDiag, VoiceSection };',
};
