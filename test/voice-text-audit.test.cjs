'use strict';
// voice-text-audit.test.cjs —— 设置页文案审查批（2026-10-17）的**文案层**判据
//
// 判据面（每条都直接对应作业书里的一条要求，不是"看着像"）：
//   VTX-A  文案 bug：诊断行不得「主语谓语同词」（用户原话证据：清口水词：清口水词）
//   VTX-B  正常态不复述：状态行正常态不得出现 provider 计数 / 重复开关态
//   VTX-C  「无事发生」类正常态不报，但 pending（待检）仍须报
//   VTX-D  黑话面：设置页可见文案不得出现 VAD / provider / RPC / chunk / baseUrl / localStorage …
//   VTX-E  S-7：ZH/EN 键数相等（本批新增键后仍相等）
//   VTX-F  失败态**带时间可判性**且仍可见（刚失败 / 很久以前 / 之后成功过 三态）
//   VTX-G  原始读数仍保留在 title（可见文案改白话，读数不丢）
//   VTX-V  变异自证：把 A/B/C/D/F 逐个做坏 ⇒ 对应判据必红（判据有牙）
const test = require('node:test');
const assert = require('node:assert/strict');
// ⚠ 与同目录其它测试同款：CJS + 共享单一事实源的 chunk 解码器
//   （scripts/lib/chunk-decode.mjs 是 ESM ⇒ require 拿到命名空间对象，取具名成员解构）
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');

const VS = 'src/client/voice/voice-section.js';
const I18N = 'src/client/i18n.js';

function dicts() {
  const src = decodeChunk(I18N);
  return new Function(src + ';return { ZH: ZH, EN: EN };')();
}
function vs() { return decodeChunk(VS); }

// ─────────── VTX-A 主谓同词（用户点名的那条文案 bug 的**根因形态**）───────────
test('VTX-A 诊断行不得「主语谓语同词」（清口水词：清口水词 的根因形态）', () => {
  const src = vs();
  const D = dicts();
  // 渲染形态：t('voiceRefineSection') + '：' + <谓词>
  const m = src.match(/t\('voiceRefineSection'\)\s*\+\s*'：'\s*\+\s*([A-Za-z0-9_]+)/);
  assert.ok(m, '清口水词诊断行的渲染形态须仍是「主语 + ： + 谓词」');
  const predVar = m[1];
  // 谓词经 text 变量赋值；要求**至少有一个**谓词分支用的键，其值 ≠ 主语键的值
  // 本批修法：**只改值、不改键名、不新增键** ⇒ 谓词仍走既有键 voiceRefineEnabled，但其值已改写。
  assert.ok(src.includes("else text = t('voiceRefineEnabled')"), '谓词须仍走既有键 voiceRefineEnabled（不新增键）');
  assert.notEqual(D.ZH.voiceRefineEnabled, D.ZH.voiceRefineSection,
    '⚠ 主语键与谓词键的中文值**不得相同**（这正是「清口水词：清口水词」的成因）');
  assert.notEqual(D.EN.voiceRefineEnabled, D.EN.voiceRefineSection, 'EN 侧同理');
  // 逐字证据：两个键的实际值（报告 §7.6 引用本条）
  assert.equal(typeof D.ZH.voiceRefineSection, 'string');
  assert.equal(typeof D.ZH.voiceRefineEnabled, 'string');
  assert.notEqual(String(D.ZH.voiceRefineEnabled).trim(), '', '谓词键值不得为空（空值＝删文案，不是改文案）');
});

// ─────────── VTX-B 正常态不复述 ───────────
test('VTX-B 状态行正常态不复述（无 provider 计数 / 无重复开关态）', () => {
  const src = vs();
  // 旧形态：'（' + speechProviders.length + ' provider）' —— 内部术语 + 计数复述
  assert.equal(/' provider）/ .test(src), false, '可见文案不得再渲染 provider 计数（内部术语 + 复述）');
  // 旧形态：**状态行**里追加 ' · ✓ ' + t('voiceRefineEnabled') 复述开关态
  //   ⚠ 判据须**限定在状态行切片内**：同一个键在清口水词诊断行里是**合法**的谓词
  //     （那里是"清口水词：这次没有口水词"，不是复述）。全局查会让合法用法误伤。
  const live = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const iStatus = live.indexOf("className: 'dsh-plg-status'");
  assert.ok(iStatus > 0, '状态行须在位（否则本条判据失去判据对象，不得静默跳过）');
  const statusSeg = live.slice(iStatus, iStatus + 600);
  assert.equal(new RegExp("t\\('voiceRefineEnabled'\\)").test(statusSeg), false,
    '状态行不得再复述「清口水词」开关态（开关本身就在上面一行）');
  // 未就绪仍须报（不得因精简把不可用说成正常）
  assert.ok(src.includes("t('voiceStatusNotReady')"), '未就绪仍是异常 ⇒ 必须仍可见');
  assert.ok(src.includes("t('voiceStatusReady')"), '就绪态仍须给一个 ✓ 形状（不是删掉整行）');
  // 原始计数改留在 title
  assert.ok(/title: speechReady \? \('providers='/.test(src), '原始读数须保留在 title（可见文案改白话、读数不丢）');
});

// ─────────── VTX-C 「无事发生」不报，但 pending 必须报 ───────────
test('VTX-C 旧配置清理：正常态（已检且无事）不报；pending（待检）仍须报', () => {
  const src = vs();
  assert.equal(src.includes("legacyChecked ? ' · ' + t('voiceRefineLegacyNone')"), false,
    '「无旧版规整配置」属「无事发生」类 ⇒ 正常态不得再报');
  assert.ok(src.includes("snap.legacyChecked ? '' : ' · ' + t('voiceRefineLegacyPending')"),
    '待检（pending）仍须报 —— 否则就是静默失效');
  assert.ok(src.includes("t('voiceRefineLegacy')"), '清理成功仍须报（有效读数的另一半）');
});

// ─────────── VTX-D 黑话面 ───────────
test('VTX-D 设置页可见文案无内部术语（VAD/provider/RPC/chunk/baseUrl/localStorage/LLM）', () => {
  const D = dicts();
  const BAD = /VAD|provider|RPC|chunk|baseUrl|localStorage|\bLLM\b/i;
  const keys = [
    'cfgModeHintStandard', 'cfgModeHintSmart', 'cfgContextNote', 'cfgMemoryNote', 'cfgHint',
    'cfgMaxTokens', 'cfgOutputLimit', 'cfgParamsModeDefault', 'cfgMeasureLive', 'cfgMeasureHist',
    'cfgNoProvider', 'secPluginsIntro', 'tplNote', 'voiceSilenceOff', 'voiceOfficialDiagTitle',
    'voiceOfficialVerified', 'voiceOfficialMissed', 'voiceOfficialAbandon', 'voiceOfficialStartMissed',
    'voiceOfficialFeedback', 'voiceOfficialFeedbackSeen', 'voiceOfficialFeedbackSeenAgo',
    'voiceCorrectionArmed', 'voiceCorrectionOff', 'voiceCorrectionNoChange',
    'voiceRefineEnabled', 'voiceRefineSkipped', 'voiceRefineLegacy', 'voiceStatusNotReady',
  ];
  const bad = [];
  for (const k of keys) {
    const z = String(D.ZH[k] || ''), e = String(D.EN[k] || '');
    if (BAD.test(z)) bad.push('ZH ' + k + ' = ' + z);
    if (BAD.test(e)) bad.push('EN ' + k + ' = ' + e);
  }
  assert.deepEqual(bad, [], '可见文案仍含内部术语：\n  ' + bad.join('\n  '));
});

// ─────────── VTX-E S-7 键集平衡 ───────────
test('VTX-E S-7：ZH/EN 键集相等（本批新增键后仍相等）', () => {
  const D = dicts();
  const zk = Object.keys(D.ZH).sort(), ek = Object.keys(D.EN).sort();
  assert.deepEqual(zk, ek, 'ZH/EN 顶层键集必须完全相等');
  for (const k of ['voiceRefineLegacyPending', 'voiceOfficialFeedbackSeenAgo']) {
    assert.ok(zk.includes(k), '本批新增键须在两侧同时存在：' + k);
  }
});

// ─────────── VTX-F 失败态的时间可判性（三态） ───────────
test('VTX-F 失败态带时距（三态：刚失败 / 很久以前 / 之后成功过）且失败不被吞掉', () => {
  const src = vs();
  assert.ok(src.includes('function ovbSinceLabel'), '须有把失败时刻折算成时距的纯函数');
  assert.ok(src.includes("t('voiceOfficialFeedbackSeenAgo')"), '失败文案须用带时距的键');
  assert.ok(src.includes("ovbSinceLabel(snap.lastSessionFailedAt)"), '时距须取自桥暴露的失败时刻');
  assert.ok(src.includes("t('voiceOfficialFeedbackSeen')"), '取不到时刻时须退化为不带时距的失败文案（不得渲染残句）');
  assert.ok(src.includes('lastSessionFailed === true'), '判据仍是会话级 lastSessionFailed（不是页面累计）');
  // 原始时刻进 title
  assert.ok(src.includes("'lastFailAt='"), '失败发生时刻须进 title（不吞掉、可查）');
  // 时距函数本身：三档语义
  const start = src.indexOf('function ovbSinceLabel');
  const body = src.slice(start, src.indexOf('function OfficialVoiceDiag'));
  assert.ok(body.includes("'刚刚'"), '刚失败 ⇒ 报「刚刚」');
  assert.ok(/Math\.floor\(h \/ 24\)/.test(body), '很久以前 ⇒ 折算成「天」');
  assert.ok(/return ''/.test(body), '无时刻 ⇒ 返回空串（由调用方退化）');
});

// ─────────── VTX-G 原始读数保留在 title ───────────
test('VTX-G 原始读数保留在 title（可见改白话、读数不丢）', () => {
  const src = vs();
  for (const probe of ['runs=', 'skipped=', 'legacyRefine=', 'sessions=', 'missed=', 'startClicks=']) {
    assert.ok(src.includes(probe), '原始读数须仍留在 title：' + probe);
  }
});

// ─────────── VTX-V 变异自证（本文件判据有牙）───────────
function mutate(src, pairs) {
  let out = src;
  for (const p of pairs) {
    if (!out.includes(p[0])) throw new Error('变异锚点未命中：' + String(p[0]).slice(0, 50));
    out = out.split(p[0]).join(p[1]);
  }
  return out;
}

test('VTX-V01 变异自证·正例必红：把谓词键的值改回与主语同词 ⇒ VTX-A 必红', () => {
  const D = dicts();
  const i18n = decodeChunk(I18N);
  // 单因子变异：只把 voiceRefineEnabled 的中文值改回与主语同词的「清口水词」
  //   （这就是用户看到「清口水词：清口水词」的那一态）⇒ VTX-A 的 notEqual 必须变红。
  // 锚点取**当前实际值**（本文件不复制产品文案的旧值 —— 那样一动文案就静默失效）
  const cur = (i18n.match(/voiceRefineEnabled: '([^']*)'/) || [, ''])[1];
  assert.ok(cur, '前置：须能从 i18n 取到 voiceRefineEnabled 的现值');
  const mutatedI18n = i18n.replace("voiceRefineEnabled: '" + cur + "'", "voiceRefineEnabled: '清口水词'");
  assert.notEqual(mutatedI18n, i18n, '前置：变异锚点须命中');
  const M = new Function(mutatedI18n + ';return { ZH: ZH, EN: EN };')().ZH;
  // 直接重放 VTX-A 的核心断言，验证它会失败（而不是"断言还在，只是对象变了"）
  let threw = false;
  try { assert.notEqual(M.voiceRefineEnabled, M.voiceRefineSection, '主谓同词'); } catch (e) { threw = true; }
  assert.equal(threw, true, '把谓词值改回与主语同词后，VTX-A 的 notEqual 必须失败（判据有牙）');
  // 负控：现行（未变异）值**不得**相等
  assert.notEqual(D.ZH.voiceRefineEnabled, D.ZH.voiceRefineSection, '负控：现行文案本身不得主谓同词');
});

test('VTX-V02 变异自证·正例必红：状态行加回 provider 计数 ⇒ VTX-B 必红', () => {
  const src = mutate(vs(), [["t('voiceStatusReady')", "t('voiceStatusReady') + '（' + speechProviders.length + ' provider）'"]]);
  assert.equal(/' provider）/.test(src), true, '变异生效（可见文案含 provider 计数）⇒ VTX-B 必然失败（判据有牙）');
});

test('VTX-V03 变异自证·正例必红：pending 也静默 ⇒ VTX-C 必红', () => {
  const src = mutate(vs(), [["snap.legacyChecked ? '' : ' · ' + t('voiceRefineLegacyPending')", "''"]]);
  assert.equal(src.includes("t('voiceRefineLegacyPending')"), false,
    '变异生效（pending 也被静默）⇒ VTX-C 必然失败（判据有牙）');
});

test('VTX-V04 变异自证·正例必红：文案塞回 VAD 黑话 ⇒ VTX-D 必红', () => {
  const D = dicts();
  const BAD = /VAD|provider|RPC|chunk|baseUrl|localStorage|\bLLM\b/i;
  assert.equal(BAD.test('静音监测（VAD）'), true, '判据正则须能命中 VAD');
  assert.equal(BAD.test(String(D.ZH.voiceOfficialDiagTitle)), false, '现行文案无黑话（前置）');
});

test('VTX-V05 变异自证·正例必红：失败文案退回无时距 ⇒ VTX-F 必红', () => {
  const src = mutate(vs(), [["t('voiceOfficialFeedbackSeenAgo')", "t('voiceOfficialFeedbackSeen')"]]);
  assert.equal(src.includes("t('voiceOfficialFeedbackSeenAgo')"), false,
    '变异生效（不再有带时距的失败文案）⇒ VTX-F 必然失败（判据有牙）');
});
