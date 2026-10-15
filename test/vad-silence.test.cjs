'use strict';
// vad-silence.test —— PROJECT §7.4 / 方案 §4.6.2.7「静音检测间隔可配置」
//
// 契约（逐条对照 §7.4 原文，不自行设计）：
//   · 可调项 = VAD_SILENCE_MS（静音判定时长）；**不是** VAD_POLL_MS（100ms 内部轮询，不暴露）
//   · 档位 = 1–5 秒整数共 5 档；默认 2 秒（= 现值 ⇒ 不改变现有行为）
//   · 校验 = 接受 1–5 整数，非法值回落 2
//   · 落点改造 = VAD_REQUIRED_QUIET 由固定常量派生 → 按配置值**动态计算**
//   · 适用范围 = 两条录音入口共用同一值
//   · 须保留 = 自适应底噪校准 + 触发门 heardSpeech；60s 上限不受本配置影响
//
// 手法：与 official-bridge 测试一致——解码 chunk、注入假全局求值；无真麦克风前置。
// ⚠ 计时精度**未实测**（最坏偏差 ~VAD_POLL_MS = 100ms 粒度，见 U12/B4）——本文件**不**断言精度。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const decodeChunk = (rel) => {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const m = raw.match(/(?:^|\n)module\.exports = "([\s\S]*)";?\s*$/);
  if (!m) throw new Error('chunk wrapper mismatch: ' + rel);
  return JSON.parse('"' + m[1] + '"');
};

// 求值 state.js：得到归一化 / 帧数派生（§7.4 的单一事实源）
function loadState() {
  const src = decodeChunk('src/client/voice/state.js');
  const lsBacking = new Map();
  const localStorageStub = {
    getItem: (k) => (lsBacking.has(k) ? lsBacking.get(k) : null),
    setItem: (k, v) => lsBacking.set(k, String(v)),
    removeItem: (k) => lsBacking.delete(k),
  };
  const factory = new Function(
    'localStorage', 'host',
    src + '\n;return { normalizeVadSilenceMs, vadSilenceMsOf, vadRequiredQuiet, VOICE_CFG_DEFAULTS, voiceCfgState, mergeVoice, saveVoiceCfg, persistVoiceLocal };'
  );
  return factory(localStorageStub, { call: () => Promise.resolve({ ok: false }) });
}

// ───────────── ① 5 档各值被正确接受并落到 VAD_REQUIRED_QUIET ─────────────
test('VADSIL-P01 五档逐一接受：1–5 秒 → 1000/2000/3000/4000/5000ms', () => {
  const S = loadState();
  const expected = { 1: 1000, 2: 2000, 3: 3000, 4: 5000 - 1000, 5: 5000 };
  for (const [sec, ms] of Object.entries(expected)) {
    assert.equal(S.normalizeVadSilenceMs(Number(sec)), ms, sec + ' 秒应归一为 ' + ms + 'ms');
  }
});

test('VADSIL-P02 五档逐一落到 VAD_REQUIRED_QUIET（动态计算，非固定常量）', () => {
  const S = loadState();
  // §7.4：帧数 = 配置秒数 × 1000 / VAD_POLL_MS(100) ⇒ 1→10 / 2→20 / 3→30 / 4→40 / 5→50
  assert.equal(S.vadRequiredQuiet(1000), 10, '1 秒 → 10 帧');
  assert.equal(S.vadRequiredQuiet(2000), 20, '2 秒 → 20 帧（= 改前常量值）');
  assert.equal(S.vadRequiredQuiet(3000), 30, '3 秒 → 30 帧');
  assert.equal(S.vadRequiredQuiet(4000), 40, '4 秒 → 40 帧');
  assert.equal(S.vadRequiredQuiet(5000), 50, '5 秒 → 50 帧');
});

test('VADSIL-P03 动态性硬断言：帧数不是常量（5 档必须给出 5 个互不相同的值）', () => {
  const S = loadState();
  const frames = [1000, 2000, 3000, 4000, 5000].map((ms) => S.vadRequiredQuiet(ms));
  assert.equal(new Set(frames).size, 5, '5 档必须产生 5 个互不相同的帧数（若为常量则全等 ⇒ 判据红）');
  assert.deepEqual(frames, [10, 20, 30, 40, 50], '帧数须随配置单调变化');
});

// ───────────── ② 非法值一律回落 2 ─────────────
test('VADSIL-P04 非法值逐一回落 2000：0 / 6 / 1.5 / "x" / null', () => {
  const S = loadState();
  const bad = [0, 6, 1.5, 'x', null];
  for (const v of bad) {
    assert.equal(S.normalizeVadSilenceMs(v), 2000, '非法值 ' + JSON.stringify(v) + ' 必须回落 2000');
  }
});

test('VADSIL-P05 非法值扩展集同样回落：负数 / 空串 / 数组 / 对象 / NaN / undefined / 布尔', () => {
  const S = loadState();
  const bad = [-1, -2000, '', [], {}, NaN, undefined, true, false, '2000', 100000];
  for (const v of bad) {
    assert.equal(S.normalizeVadSilenceMs(v), 2000, '非法值 ' + JSON.stringify(v) + ' 必须回落 2000');
  }
});

test('VADSIL-P06 毫秒书写等价：1000–5000 的 1000 整数倍被接受（与秒整数同域）', () => {
  const S = loadState();
  assert.equal(S.normalizeVadSilenceMs(1000), 1000);
  assert.equal(S.normalizeVadSilenceMs(3000), 3000);
  assert.equal(S.normalizeVadSilenceMs(5000), 5000);
  // 非 1000 整数倍（即使落在区间内）不得被当成 ms 通过
  assert.equal(S.normalizeVadSilenceMs(2500), 2000, '2500 不在合法档位 ⇒ 回落');
});

// ───────────── ③ 默认 2 秒 ⇒ 行为与改前一致（双读数） ─────────────
test('VADSIL-P07 双读数·默认值：VOICE_CFG_DEFAULTS.vad.silenceMs === 2000（= 改前硬编码值）', () => {
  const S = loadState();
  assert.equal(S.VOICE_CFG_DEFAULTS.vad.silenceMs, 2000,
    '默认必须等于改前的 VAD_SILENCE_MS 硬编码值（否则等于改行为）');
  assert.equal(S.VOICE_CFG_DEFAULTS.vad.enabled, true, 'vad 默认开（既有行为不变）');
});

test('VADSIL-P08 双读数·未配置时帧数 = 改前常量值 20（行为不变的判定式）', () => {
  const S = loadState();
  // 改前：Math.round(2000 / 100) === 20；改后未配置 ⇒ 同一入口必须同样给 20
  assert.equal(Math.round(2000 / 100), 20, '（改前基线）固定常量派生的帧数');
  assert.equal(S.vadRequiredQuiet(undefined), 20, '（改后）未配置 ⇒ 同一读数');
  assert.equal(S.vadRequiredQuiet(S.vadSilenceMsOf({})), 20, '（改后）空配置 ⇒ 同一读数');
  assert.equal(S.vadRequiredQuiet(S.vadSilenceMsOf({ vad: {} })), 20, '（改后）无 silenceMs ⇒ 同一读数');
});

test('VADSIL-P09 mergeVoice 白名单：非法 silenceMs 被净化，合法值保留', () => {
  const S = loadState();
  assert.equal(S.mergeVoice({ vad: { silenceMs: 4000 } }).vad.silenceMs, 4000, '合法 4000 保留');
  assert.equal(S.mergeVoice({ vad: { silenceMs: 6 } }).vad.silenceMs, 2000, '非法 6 回落');
  assert.equal(S.mergeVoice({ vad: { silenceMs: 1.5 } }).vad.silenceMs, 2000, '非法 1.5 回落');
  assert.equal(S.mergeVoice({ vad: {} }).vad.silenceMs, 2000, '缺位回落默认');
  assert.equal(S.mergeVoice({}).vad.silenceMs, 2000, '空配置回落默认');
  // 既有字段不得被本改动影响
  assert.equal(S.mergeVoice({ vad: { enabled: false } }).vad.enabled, false, 'enabled:false 仍保留');
  assert.equal(S.mergeVoice({ vad: {} }).vad.enabled, true, 'enabled 默认仍 true');
});

// ───────────── ④ 两个开关与其余三项增值不回归 ─────────────
// CHG-117（2026-10-16 · 规整改造批）：原第 [4] 项 `refine` 已改名为 `filler`（只留 `enabled`，
//   默认 **开**）。本用例的**其余三项语义逐条未变**；改名处同步改名，**未删任何断言**。
test('VADSIL-P10 不回归：vad.enabled / autoEnhance / hotkey / filler 四项仍在且语义不变', () => {
  const S = loadState();
  const d = S.VOICE_CFG_DEFAULTS;
  assert.equal(d.vad.enabled, true, '[1] 静音监测默认开');
  assert.equal(d.autoEnhance, false, '[2] 自动增强默认关');
  assert.equal(d.hotkey.enabled, false, '[3] 热键默认关（combo 空）');
  assert.equal(d.filler.enabled, true, '[4] 清口水词默认开（用户裁定 4）');
  assert.equal(d.refine, undefined, 'CHG-117：旧父键 refine 不得回流');
  const m = S.mergeVoice({ autoEnhance: true, hotkey: { enabled: true, combo: 'Backquote' }, filler: { enabled: false } });
  assert.equal(m.autoEnhance, true, 'autoEnhance true 保留');
  assert.equal(m.hotkey.enabled, true, 'hotkey true 保留');
  assert.equal(m.hotkey.combo, 'Backquote', 'combo 保留');
  assert.equal(m.filler.enabled, false, 'filler false 保留');
  assert.equal(S.mergeVoice({ filler: { enabled: 'x' } }).filler.enabled, true, '非 false 一律视为开（与 host 同形）');
  assert.equal(S.mergeVoice({}).filler.enabled, true, '缺省 ⇒ 开');
  assert.equal(S.mergeVoice({ refine: { enabled: true } }).filler.enabled, true, '⚠ 旧键不得被读取（改名后无读旧名路径）');
});

test('VADSIL-P11 不回归：host 侧 sanitizeVoiceCfg 白名单与 client 同口径', () => {
  const asr = require(path.join(ROOT, 'lib', 'asr.cjs'));
  // 合法 5 档
  assert.equal(asr.sanitizeVoiceCfg({ vad: { silenceMs: 1000 } }).vad.silenceMs, 1000);
  assert.equal(asr.sanitizeVoiceCfg({ vad: { silenceMs: 3000 } }).vad.silenceMs, 3000);
  assert.equal(asr.sanitizeVoiceCfg({ vad: { silenceMs: 5000 } }).vad.silenceMs, 5000);
  // 非法集（§7.4 点名的 5 个）一律回落 2 秒
  for (const v of [0, 6, 1.5, 'x', null]) {
    assert.equal(asr.sanitizeVoiceCfg({ vad: { silenceMs: v } }).vad.silenceMs, 2000,
      'host 侧非法值 ' + JSON.stringify(v) + ' 必须回落 2000');
  }
  // 既有面不回归
  assert.equal(asr.sanitizeVoiceCfg({ vad: { enabled: false } }).vad.enabled, false, 'enabled 仍可关');
  assert.equal(asr.sanitizeVoiceCfg({}).vad.enabled, true, 'enabled 默认仍开');
  assert.equal(asr.sanitizeVoiceCfg({ autoEnhance: true }).autoEnhance, true, 'autoEnhance 不受影响');
});

// ───────────── 落点改造：两条入口共用同一入口 ─────────────
test('VADSIL-P12 共用同一入口：静音档位由 bridge 的包装 VAD 单一入口驱动（自建链已退役）', () => {
  const rec = decodeChunk('src/client/voice/recorder.js');
  const br = decodeChunk('src/client/voice/official-bridge.js');
  // P2-补做（2026-10-13 · UD-0016）：自建采集链退役 ⇒ VAD 只剩**一条链路**（bridge 包装 VAD）。
  // 判据强度不变：仍逐项断言「按配置动态计算 + 取同一配置值 + 不得有固定帧数常量」。
  const liveRec = rec.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(liveRec.trim(), '', 'recorder.js 活代码须已空壳（自建采集链退役，仅留说明注释）');
  assert.equal(/\bconst VAD_SILENCE_MS\b/.test(liveRec), false, 'recorder 活代码不得再有硬编码静音时长常量');
  assert.equal(/\bconst VAD_REQUIRED_QUIET\b/.test(liveRec), false, 'recorder 活代码不得再有固定帧数常量');
  // 包装 VAD：同一入口（唯一在用的落点）
  assert.ok(br.includes('vadRequiredQuiet(vadSilenceMsOf(voiceCfgState.value))'), 'bridge 缺「经同一入口按配置动态计算帧数」');
  assert.equal(br.includes('const OVB_REQUIRED_QUIET'), false, 'bridge 不得再有固定帧数常量');
  assert.equal(/\bconst OVB_SILENCE_MS\b/.test(br.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')), false, 'bridge 活代码不得再有硬编码静音时长常量');
  // 退役后不得再有第二条 VAD 实现（防止「退役了却留着第二份真相」）
  assert.equal(rec.includes('setInterval'), false, 'recorder 活代码不得再有自建 VAD 轮询');
});

test('VADSIL-P13 须保留：自适应底噪校准与触发门 heardSpeech 在包装 VAD 中在位', () => {
  const rec = decodeChunk('src/client/voice/recorder.js');
  const br = decodeChunk('src/client/voice/official-bridge.js');
  // P2-补做（UD-0016）：两条路径收敛为一条（wrapper VAD）⇒ 只判该条；记录退役事实的那一份不带活代码。
  for (const [name, src] of [['official-bridge', br]]) {
    assert.ok(src.includes('heardSpeech'), name + ' 缺触发门 heardSpeech（未说话不得触发，防误停）');
    assert.ok(/CALIBRATE_FRAMES/.test(src), name + ' 缺自适应底噪校准采样帧数');
    assert.ok(/NOISE_FACTOR/.test(src), name + ' 缺自适应阈值系数');
    assert.ok(/THRESHOLD_MAX/.test(src), name + ' 缺阈值上限');
    // 触发门语义：必须先 heardSpeech 才计静音帧
    assert.ok(/else if \(heardSpeech\)/.test(src), name + ' 触发门用法被改（须保持「先听到语音才计静音」）');
  }
  // 退役面：recorder.js 活代码不得再留第二套校准常量（防「退役了却留着第二份真相」）
  const recLive = rec.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const sym of ['heardSpeech', 'CALIBRATE_FRAMES', 'NOISE_FACTOR', 'THRESHOLD_MAX']) {
    assert.equal(recLive.includes(sym), false, 'recorder 活代码不得再有 ' + sym + '（自建 VAD 已退役）');
  }
});

test('VADSIL-P14 UI 在位：下拉框 + 滑块 + 双向同步（§7.4 点名形态）', () => {
  const vs = decodeChunk('src/client/voice/voice-section.js');
  assert.ok(vs.includes('silenceRow'), '设置段缺静音时长行');
  assert.ok(vs.includes("t('voiceVadSilenceLabel')"), '缺标签文案引用');
  assert.ok(vs.includes("type: 'range'"), '缺滑块（§7.4 点名：下拉框 + 滑块）');
  assert.ok(vs.includes("min: '1', max: '5', step: '1'"), '滑块域必须 1–5 整数');
  assert.ok(vs.includes('[1, 2, 3, 4, 5].map'), '下拉必须恰好 5 档');
  assert.ok(vs.includes('dsh-vi-slider'), '缺自绘滑块样式类（§7.4：滑块须自绘）');
  // 两条控件都必须经同一 setter（双向同步，同一归一化入口）
  // 调用点严格 === 2（下拉 onChange / 滑块 onChange 各一）⇒ 证明两条控件共用同一 setter
  assert.equal((vs.match(/setSilence\(/g) || []).length, 2, '下拉与滑块须共用同一 setSilence（双向同步，调用点严格 2 处）');
  assert.ok(vs.includes('const setSilence = (next) =>'), '缺 setSilence 定义');
  assert.ok(vs.includes('normalizeVadSilenceMs(Number(next))'), 'setter 必须经同一归一化入口（非法值回落）');
  // 样式确实自绘（styles.js 有该类）
  const st = decodeChunk('src/client/styles.js');
  assert.ok(st.includes('.dsh-vi-slider'), 'styles.js 缺自绘滑块样式');
  assert.ok(st.includes('::-webkit-slider-thumb'), '缺 WebKit 自绘（轨道/握手）');
  assert.ok(st.includes('::-moz-range-thumb'), '缺 Firefox 自绘（轨道/握手）');
});

test('VADSIL-P15 i18n：新增 3 键且 ZH/EN 键集相等（S-7）', () => {
  const i18n = decodeChunk('src/client/i18n.js');
  for (const k of ['voiceVadSilenceLabel', 'voiceVadSilenceUnit', 'voiceVadSilenceHint']) {
    assert.ok(i18n.includes(k + ':'), 'i18n 缺键 ' + k);
  }
  const zh = i18n.split('const EN = {')[0];
  const en = 'const EN = {' + i18n.split('const EN = {')[1];
  const pattern = (s) => (s.match(/voiceVad[A-Za-z]*:/g) || []).sort();
  assert.deepEqual(pattern(zh), pattern(en), 'voiceVad* ZH/EN 键集必须相等（S-7）');
  assert.equal(pattern(zh).length, 5, 'voiceVad* 键数锁定 5（enabled/short + 新增 3，严格 ===）');
});

test('VADSIL-P16 VAD_POLL_MS 未被暴露为可调项（§7.4 明确：不暴露）', () => {
  const S = loadState();
  const vs = decodeChunk('src/client/voice/voice-section.js');
  assert.equal(S.VOICE_CFG_DEFAULTS.vad.pollMs, undefined, '配置面不得出现 pollMs');
  assert.equal(/pollMs/.test(vs), false, 'UI 不得有轮询间隔控件');
  // 轮询间隔仍是实现细节常量（100ms），且不随配置变化
  const rec = decodeChunk('src/client/voice/recorder.js');
  assert.ok(rec.includes('VAD_POLL_MS = 100'), '轮询间隔须仍是 100ms 实现常量');
});

// ───────────── 变异自证 ─────────────
// 变异名运行时拼接；正例必红、负控必绿。
function mutate(src, kind) {
  const A = 'const' + ' VAD_SILENCE_MS_DEFAULT = 2000;';
  if (kind === 'kill-default') {
    // 默认值被改 → 默认行为双读数必红
    assert.ok(src.includes(A), '变异锚点须存在');
    return src.replace(A, 'const VAD_SILENCE_MS_DEFAULT = 3000;');
  }
  if (kind === 'freeze-frames') {
    // 帧数退回固定常量派生（不再动态）→ P03 必须红
    const anchor = '  const poll = 100; // = recorder.js 的 VAD_POLL_MS（内部轮询，不对外暴露）\n  return Math.max(1, Math.round(ms / poll));';
    assert.ok(src.includes(anchor), '变异锚点须存在');
    const m = src.replace(anchor, '  const poll = 100;\n  return 20;');
    // 同时摘掉归一化，避免被归一化掩盖
    return m;
  }
  throw new Error('unknown mutation kind');
}

function loadMutantState(kind) {
  const src = mutate(decodeChunk('src/client/voice/state.js'), kind);
  const lsBacking = new Map();
  const localStorageStub = { getItem: (k) => (lsBacking.has(k) ? lsBacking.get(k) : null), setItem: (k, v) => lsBacking.set(k, String(v)), removeItem: (k) => lsBacking.delete(k) };
  const factory = new Function('localStorage', 'host', src + '\n;return { normalizeVadSilenceMs, vadRequiredQuiet };');
  return factory(localStorageStub, { call: () => Promise.resolve({ ok: false }) });
}

test('VADSIL-V01 变异自证·正例必红：改默认值 ⇒ 默认双读数判据必须失败', () => {
  const M = loadMutantState('kill-default');
  // 默认双读数判据在变异下必须为红
  const wouldPass = (M.normalizeVadSilenceMs(undefined) === 2000 && M.vadRequiredQuiet(undefined) === 20);
  assert.equal(wouldPass, false, '变异后「默认 = 2 秒」判据必须红（若仍绿 ⇒ 判据没牙）');
});

test('VADSIL-V02 变异自证·负控必绿：同一变异下「合法档位接受」判据仍须通过', () => {
  const M = loadMutantState('kill-default');
  // 负控：合法值路径与默认值无关，必须仍绿
  assert.equal(M.normalizeVadSilenceMs(1000), 1000, '负控·1 秒仍接受');
  assert.equal(M.normalizeVadSilenceMs(5000), 5000, '负控·5 秒仍接受');
  assert.equal(M.vadRequiredQuiet(3000), 30, '负控·3 秒仍 → 30 帧');
});

test('VADSIL-V03 变异自证·正例必红：帧数退回固定常量 ⇒ 动态性判据必须失败', () => {
  const M = loadMutantState('freeze-frames');
  const frames = [1000, 2000, 3000, 4000, 5000].map((ms) => M.vadRequiredQuiet(ms));
  const wouldPass = (new Set(frames).size === 5);
  assert.equal(wouldPass, false, '帧数被回退为常量后「5 档互不相同」判据必须红');
});

test('VADSIL-V04 变异自证·负控必绿：同一变异下非法值回落判据仍须通过', () => {
  const M = loadMutantState('freeze-frames');
  // 负控：非法值回落走归一化，与帧数派生无关，必须仍绿
  for (const v of [0, 6, 1.5, 'x', null]) {
    assert.equal(M.normalizeVadSilenceMs(v), 2000, '负控·非法值 ' + JSON.stringify(v) + ' 仍回落 2000');
  }
});
