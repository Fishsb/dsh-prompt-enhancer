'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-17（设置文案审查批 · §7.4「位置纪律」回归锁）
//
// 为什么要把位置纪律**单独锁成文本判据**：
//   本批按用户诉求删掉了「正常态复述」（状态行不再报 provider 计数 / 不再重复开关态；
//   「无旧版配置」不再报）。删 ① 类**不得**顺手把 ②③ 类（异常 / 待检）一起静默掉 ——
//   那正是「静默失效」。仅靠"文本里还出现某个键"查不出这类回归（分支还在，只是被前面的分支挡死）。
//   ⇒ 本文件直接**求值真实分支链**（从 chunk 里切出），逐态断言"该报谁"。
//
// 判据：
//   VTP-A  失效/降级分支**先于**开关关闭分支（开关关掉也不得掩蔽真实故障）
//   VTP-B  开关关闭分支**先于**正常/瞬态分支（"开关关没关"是用户此刻的疑问）
//   VTP-C  各异常态逐态可判（abandon / startMissed / endedInFeedback / sessionsMissed / disabled）
//   VTP-D  正常态落到 verified / armed（不是异常键）
//   VTP-E  失败态三态：刚失败 / 很久以前 / 之后成功过
//   VTP-V  变异自证：开关关闭分支挪到最前 ⇒ VTP-A 必红
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');

const VS = 'src/client/voice/voice-section.js';

function diagSource() {
  const src = decodeChunk(VS);
  const i = src.indexOf('  let text;');
  const j = src.indexOf('const diagTitle');
  assert.ok(i > 0 && j > i, '诊断分支切片锚点须在位（防锚点漂移后静默取到空段）');
  const seg = src.slice(i, j);
  const k = src.indexOf('function ovbSinceLabel');
  assert.ok(k > 0, '时距函数须在位');
  const since = src.slice(k, src.indexOf('function OfficialVoiceDiag'));
  return { seg, since };
}

/** 用真实分支链求值：返回该快照命中的**文案键**。 */
function keyOf(snap) {
  const { seg, since } = diagSource();
  const t = (k) => k;
  const f = new Function('snap', 't', 'officialVoiceBridge',
    since + String.fromCharCode(10) + 'return (function(){' + seg + ' return text; })();');
  return f(snap, t, null);
}

const BASE = {
  installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 0,
  endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false,
  feedbackSeen: 0, lastSessionFailed: false, lastSessionFailedAt: 0, feedbackMessage: '',
};

test('VTP-A 失效/降级分支先于开关关闭分支（关掉开关不得掩蔽真实故障）', () => {
  const { seg } = diagSource();
  const iOff = seg.indexOf("t('voiceSilenceOff')");
  assert.ok(iOff > 0, '开关关闭分支须在位（关闭态仍要可见，否则关掉开关等于静默）');
  for (const k of ['voiceOfficialAbandon', 'voiceOfficialStartMissed', 'voiceOfficialFeedback', 'voiceOfficialMissed', 'voiceOfficialDisabled']) {
    const i = seg.indexOf("t('" + k + "')");
    assert.ok(i > 0, '失效分支须在位：' + k);
    assert.ok(i < iOff, '失效分支 ' + k + ' 必须排在开关关闭分支之前（否则关掉开关就把它掩蔽了）');
  }
});

test('VTP-B 开关关闭分支先于正常/瞬态分支', () => {
  const { seg } = diagSource();
  const iOff = seg.indexOf("t('voiceSilenceOff')");
  for (const k of ['voiceOfficialActive', 'voiceOfficialArmed', 'voiceOfficialVerified']) {
    const i = seg.indexOf("t('" + k + "')");
    assert.ok(i > 0, '正常分支须在位：' + k);
    assert.ok(i > iOff, '正常分支 ' + k + ' 必须排在开关关闭分支之后（否则关了开关仍显示已就绪/采集中）');
  }
});

test('VTP-C 各异常态逐态可判（求值真实分支链，不是查子串）', () => {
  assert.equal(keyOf({ ...BASE, abandonReason: 'stop-click-dispatch-failed', vadEnabled: false }), 'voiceOfficialAbandon',
    '降级态即使开关关掉也必须报降级（不得显示成静音监测已关闭）');
  assert.equal(keyOf({ ...BASE, startMissed: 2, sessionsStarted: 0, vadEnabled: false }), 'voiceOfficialStartMissed',
    '启动失败即使开关关掉也必须报');
  assert.equal(keyOf({ ...BASE, endedInFeedback: true }), 'voiceOfficialFeedback', '失败出口须报');
  assert.equal(keyOf({ ...BASE, sessionsStarted: 1, sessionsMissed: 1 }), 'voiceOfficialMissed', '包装未命中须报');
  assert.equal(keyOf({ ...BASE, installed: false }), 'voiceOfficialDisabled', '增值桥停用须报');
});

test('VTP-D 正常态落到 verified / armed（不是异常键）', () => {
  assert.equal(keyOf({ ...BASE, sessionsStarted: 3 }), 'voiceOfficialVerified', '正常态（录过 3 次）须报 verified');
  assert.equal(keyOf({ ...BASE }), 'voiceOfficialArmed', '正常态（还没录）须报 armed');
});

test('VTP-E 失败态三态：刚失败 / 很久以前 / 之后成功过', () => {
  const now = Date.now();
  assert.equal(keyOf({ ...BASE, sessionsStarted: 1, lastSessionFailed: true, lastSessionFailedAt: now - 600000 }),
    'voiceOfficialFeedbackSeenAgo', '刚失败须用带时距的键');
  assert.equal(keyOf({ ...BASE, sessionsStarted: 1, lastSessionFailed: true, lastSessionFailedAt: now - 40 * 86400000 }),
    'voiceOfficialFeedbackSeenAgo', '很久以前的失败仍须可见（不得吞掉），只是时距不同');
  assert.equal(keyOf({ ...BASE, sessionsStarted: 3, lastSessionFailed: false }),
    'voiceOfficialVerified', '之后成功过 ⇒ 不得再报陈年失败');
  assert.equal(keyOf({ ...BASE, sessionsStarted: 1, lastSessionFailed: true, lastSessionFailedAt: 0 }),
    'voiceOfficialFeedbackSeen', '时距取不到时须退化为不带时距的失败文案（不得出现（前）残句）');
});

test('VTP-V 变异自证·正例必红：开关关闭分支挪到最前 ⇒ VTP-A 必红', () => {
  const { seg } = diagSource();
  const line = "  else if (snap.vadEnabled === false) { text = t('voiceSilenceOff'); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }";
  assert.ok(seg.includes(line), '前置：开关关闭分支语句须如预期在位');
  const mutated = seg.replace(line, '')
    .replace('  if (!snap.installed) {', "  if (snap.vadEnabled === false) { text = t('voiceSilenceOff'); cls = 'x'; }\n  else if (!snap.installed) {");
  assert.notEqual(mutated, seg, '前置：变异须生效');
  const iOff = mutated.indexOf("t('voiceSilenceOff')");
  const iAbandon = mutated.indexOf("t('voiceOfficialAbandon')");
  assert.ok(iOff < iAbandon, '变异后开关分支确实排到了失效分支之前');
  let threw = false;
  try { assert.ok(iAbandon < iOff, '失效分支必须排在开关关闭分支之前'); } catch (e) { threw = true; }
  assert.equal(threw, true, '变异态下 VTP-A 的核心断言必须失败（判据有牙）');
});
