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

// ───────── VADSIL-P14（2026-10-17 布局批订正）─────────
// ⚠ 订正依据：用户点名「静音监测开关搬到第二行、覆盖掉静音时长标签与下拉框、滑块 1–5 ⇒ 0–5，
//   0 = 静音监测关闭」⇒ 旧断言「下拉必须恰好 5 档 / 滑块域必须 1–5 / 两条控件共用 setSilence」
//   已与新布局不符，**逐条按新布局订正**（订正前后对照见报告 §③）。
// ⚠ 手法升级（承 client chunk 契约事故的成因形态）：**真实载入 voice-section.js**
//   （decodeChunk → 求值 → 渲染 → 展开函数组件），**不再以子串断言代替**，也**不以外部桩替代该文件**。
//   ⇒ 这样判据同时兜住「文件被真实解码」这一面（契约事故的成因正是"新 chunk 用桩绕过、从不真载入"）。

/** 渲染 voice-section.js 的 VoiceSection，返回展开后的元素树（真载入，无桩替代）。 */
function renderVoiceSection(cfg) {
  const src = decodeChunk('src/client/voice/voice-section.js');
  const ReactStub = {
    createElement: (type, props, ...kids) => {
      const flat = kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false);
      const pr = Object.assign({}, props || {});
      if (flat.length) pr.children = flat.length === 1 ? flat[0] : flat;
      return { type, props: pr, kids: flat };
    },
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useRef: (init) => ({ current: init }),
    useEffect: () => {},
  };
  const saved = [];
  const S = loadState();
  // ⚠ 组件与真实 state.js **共用同一个 voiceCfgState 对象**（否则 saveVoiceCfg 写一处、组件读另一处，
  //   判据就成了"看着像"而非真行为）。cfg 作为初始值写入该单一事实源。
  const voiceCfgState = S.voiceCfgState;
  voiceCfgState.value = Object.assign({}, S.VOICE_CFG_DEFAULTS, {
    autoEnhance: false, correction: { enabled: false }, filler: { enabled: false },
    hotkey: { enabled: false, combo: '' },
  }, cfg || {});
  const factory = new Function(
    'React', 'makeT', 'host', 'voiceCfgState', 'subscribeVoiceConfig', 'saveVoiceCfg', 'syncVoiceFromHost',
    'vadSilenceMsOf', 'normalizeVadSilenceMs', 'MarqueeSelect', 'CollapsibleSection',
    'OfficialVoiceDiag', 'FillerDiag', 'CorrectionDiag', 'voiceHotkeyDisplay',
    'setTimeout', 'clearTimeout', 'window',
    src + '\n;return { VoiceSection };'
  );
  const api = factory(
    ReactStub, () => (k) => k, { call: () => Promise.resolve({ ok: false }) },
    voiceCfgState, () => () => {},
    // ⚠ 真实 saveVoiceCfg（取自 state.js）⇒ 本判据走**真** mergeVoice，不用桩伪造合并语义
    (patch) => { saved.push(patch); S.saveVoiceCfg(patch); },
    () => {}, S.vadSilenceMsOf, S.normalizeVadSilenceMs,
    (p) => ReactStub.createElement('mselect', {}, p.children),
    (p) => ReactStub.createElement('section', {}, p.children),
    () => null, () => null, () => null, (c) => String(c || ''),
    setTimeout, clearTimeout, {}
  );
  const expand = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (typeof n.type === 'function') { const o = n.type(n.props); return o ? expand(o) : null; }
    return { type: n.type, props: n.props, kids: (n.kids || []).map(expand).filter(Boolean) };
  };
  return { tree: expand(api.VoiceSection({})), saved, S, voiceCfgState };
}

/** 取第一行 / 第二行（第一行 = grid 行；第二行 = 其后的 dsh-plg-row）。 */
function layoutRows(cfg) {
  const r = renderVoiceSection(cfg);
  const section = r.tree.kids[0];
  const kids = section.kids.filter((k) => k && typeof k === 'object');
  const row1 = kids.find((k) => k.props && k.props.style && k.props.style.gridTemplateColumns);
  const row2 = kids[kids.indexOf(row1) + 1];
  return { r, row1, row2 };
}

/** 从第二行取三件（开关 / 滑块 / 读数）。 */
function row2Parts(row2) {
  const chip = row2.kids.find((k) => typeof k.type === 'string' && k.type === 'button');
  const slider = row2.kids.find((k) => k.props && k.props.type === 'range');
  const readout = row2.kids.find((k) => k.props && k.props.className === 'dsh-plg-muted');
  return { chip, slider, readout };
}

test('VADSIL-P14 第一行由 5 格订正为 4 格：静音监测开关已搬走（真载入渲染断言）', () => {
  const { row1 } = layoutRows({ vad: { enabled: true, silenceMs: 3000 }, autoEnhance: false, correction: { enabled: false }, filler: { enabled: false }, hotkey: { enabled: false, combo: '' } });
  assert.ok(row1, '第一行（grid 行）必须在位');
  assert.equal(row1.props.style.gridTemplateColumns, 'auto auto auto minmax(0,1fr)',
    '格子数须与格数同步：4 格 ⇒ 3 个 auto + minmax（旧值五个 auto + minmax，已订正）');
  assert.equal(row1.kids.length, 4, '第一行须恰 4 个直接子元素（原 5 个：自动增强/静音监测/语音纠错/清口水词/热键）');
  const texts = row1.kids.map((k) => JSON.stringify(k.props.children || '')).join('|');
  assert.equal(texts.includes('voiceVadShort'), false, '第一行**不得**再含静音监测开关（已搬到第二行）');
  for (const k of ['voiceAutoEnhance', 'voiceCorrectionShort', 'voiceRefineShort']) {
    assert.ok(texts.includes(k), '第一行须仍含 ' + k + '（其余三个开关语义未变）');
  }
  assert.equal(row1.kids.filter((k) => k.type === 'button').length, 3,
    '第一行须恰 3 个开关按钮（原 4 个 ⇒ 静音监测已移出）');
});

test('VADSIL-P14b 第二行 = 开关 + 滑块 + 读数；标签与下拉框已被覆盖删除', () => {
  const { row2 } = layoutRows({ vad: { enabled: true, silenceMs: 3000 } });
  assert.ok(row2, '第二行必须在位');
  assert.equal(row2.props.className, 'dsh-plg-row', '第二行容器仍是 dsh-plg-row');
  assert.equal(row2.kids.length, 3, '第二行须恰 3 件（开关 + 滑块 + 读数），实际 ' + row2.kids.length);
  const { chip, slider, readout } = row2Parts(row2);
  assert.ok(chip && /dsh-plg-tgl/.test(chip.props.className), '第二行第 1 件须是 ToggleChip（静音监测开关）');
  assert.ok(JSON.stringify(chip.props.children || '').includes('voiceVadShort'), '第二行开关须是静音监测文案（从第一行搬来）');
  assert.ok(slider, '第二行第 2 件须是滑块');
  assert.ok(readout, '第二行第 3 件须是读数（本席裁定保留 ⇒ 滑块有数值反馈）');
  // ⚠ 用户点名删除的两件：标签 + 下拉框
  assert.equal(row2.kids.some((k) => k.type === 'label'), false, '第二行的「静音时长」label 必须已删除');
  assert.equal(row2.kids.some((k) => k.type === 'mselect'), false, '第二行的 MarqueeSelect 下拉必须已删除');
});

test('VADSIL-P14c 滑块档位订正 1–5 ⇒ 0–5（0 = 关闭；档位域 silenceMs 仍只 1–5）', () => {
  const { row2 } = layoutRows({ vad: { enabled: true, silenceMs: 3000 } });
  const { slider } = row2Parts(row2);
  assert.equal(slider.props.min, '0', '滑块最小值须为 0（旧值 1，已订正 —— 0 = 静音监测关闭）');
  assert.equal(slider.props.max, '5', '滑块最大值仍为 5（档位域不变）');
  assert.equal(slider.props.step, '1', '步长仍为 1');
  assert.ok(slider.props.className.includes('dsh-vi-slider'), '滑块仍用自绘类 dsh-vi-slider');
  // ⚠ 档位域不变：silenceMs 只取 1–5 秒（0 不得进入 silenceMs）
  const S = loadState();
  assert.equal(S.normalizeVadSilenceMs(0), 2000, 'normalizeVadSilenceMs 的域不得改：0 仍非法 ⇒ 回落 2000');
  for (const n of [1, 2, 3, 4, 5]) assert.equal(S.normalizeVadSilenceMs(n), n * 1000, '档位 ' + n + ' 秒仍合法');
});

test('VADSIL-P14d 单一事实源：0 档写 enabled=false 且 silenceMs 保持原值（关→开回到上次档位）', () => {
  // ⚠ 本批实测发现（主持侧列为待测疑点，实测**成立**）：saveVoiceCfg 的 patch.vad **整体替换** vad 对象
  //   ⇒ 只写 { vad: { enabled } } 时 mergeVoice 把 silenceMs 归一为默认 2000 ⇒ 档位被静默重置。
  //   ⇒ 故开关写入必须带上当前 silenceMs；本断言锁住「0 档只置 enabled=false、silenceMs 保持原值」。
  // ⚠ 必须**同一个渲染实例**里取 row2 与 state（跨实例会拿到两份 voiceCfgState ⇒ 判据失真）
  const r = renderVoiceSection({ vad: { enabled: true, silenceMs: 5000 } });
  const rows = r.tree.kids[0].kids.filter((k) => k && typeof k === 'object');
  const row1 = rows.find((k) => k.props && k.props.style && k.props.style.gridTemplateColumns);
  const { slider } = row2Parts(rows[rows.indexOf(row1) + 1]);
  // 走**真实滑块 onChange**把档位拨到 0
  slider.props.onChange({ target: { value: '0' } });
  assert.equal(r.S.voiceCfgState.value.vad.enabled, false, '0 档须置 enabled = false');
  assert.equal(r.S.voiceCfgState.value.vad.silenceMs, 5000, '0 档**不得**改动 silenceMs（保持原值 5000 ⇒ 重开回上次档位）');
  assert.equal(r.S.voiceCfgState.value.vad.silenceMs === 0, false, '⛔ silenceMs 不得被写成 0（那是另立第二份真相）');
  // 同一事实源下重渲染：滑块须显示 0（反向联动「静音监测关 ⇒ 滑块自动到 0」）
  const t2 = (function () { const R = r; return R; })();
  assert.equal(t2.S.voiceCfgState.value.vad.enabled, false, '关闭态已在单一事实源上生效');
  const again = renderVoiceSection({ vad: { enabled: false, silenceMs: 5000 } });
  const arows = again.tree.kids[0].kids.filter((k) => k && typeof k === 'object');
  const ar1 = arows.find((k) => k.props && k.props.style && k.props.style.gridTemplateColumns);
  assert.equal(row2Parts(arows[arows.indexOf(ar1) + 1]).slider.props.value, '0', 'enabled=false ⇒ 滑块**自动到 0**（反向联动）');
  // 关 → 开 往返：档位须保持 5（不得回落 2）
  const back = layoutRows({ vad: { enabled: true, silenceMs: r.S.voiceCfgState.value.vad.silenceMs } });
  assert.equal(row2Parts(back.row2).slider.props.value, '5', '关→开后滑块须回到 5（silenceMs 未被重置为 2000）');
});

test('VADSIL-P14e 读数为 0 档显示「已关闭」文案（复用既有键，不新增 i18n 键）', () => {
  const on = layoutRows({ vad: { enabled: true, silenceMs: 3000 } });
  const off = layoutRows({ vad: { enabled: false, silenceMs: 3000 } });
  const rOn = row2Parts(on.row2).readout, rOff = row2Parts(off.row2).readout;
  assert.equal(typeof rOn.props.children, 'string', '1–5 档读数须是字符串（N + 单位）');
  assert.match(rOn.props.children, /^3\s/, '1–5 档读数须以档位数字开头（实际 ' + JSON.stringify(rOn.props.children) + '）');
  assert.ok(String(rOn.props.children).includes('voiceVadSilenceUnit'), '1–5 档读数须带单位键');
  assert.equal(rOff.props.children, 'voiceSilenceOff', '0 档读数须为 t(voiceSilenceOff)（实际 ' + JSON.stringify(rOff.props.children) + '）');
  assert.equal(String(rOff.props.children).includes('0 '), false, '⚠ 0 档**不得**显示「0 秒」（会被读成"零秒静音判定"，与"关闭"语义冲突）');
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

// ═════════ VADSIL-P14x 变异自证（三处各自退回 ⇒ 相应判据必红）═════════════
// ⚠ 手法：**内存变异**（把真 chunk 源码文本改一处后求值）——不落盘、不碰工作区，
//   与「关闭 /tmp 副本内变异」等效，但避免在测试里做文件系统写（更安全、更快）。
// ⚠ 变异名一律运行时拼接，避免在源码里形成字面量。

/** 用给定源码文本渲染（与 renderVoiceSection 同环境，仅源码不同）。 */
function renderWithSource(src, cfg) {
  const ReactStub = {
    createElement: (type, props, ...kids) => {
      const flat = kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false);
      const pr = Object.assign({}, props || {});
      if (flat.length) pr.children = flat.length === 1 ? flat[0] : flat;
      return { type, props: pr, kids: flat };
    },
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useRef: (init) => ({ current: init }),
    useEffect: () => {},
  };
  const S = loadState();
  S.voiceCfgState.value = Object.assign({}, S.VOICE_CFG_DEFAULTS, { vad: { enabled: true, silenceMs: 3000 } }, cfg || {});
  const factory = new Function(
    'React', 'makeT', 'host', 'voiceCfgState', 'subscribeVoiceConfig', 'saveVoiceCfg', 'syncVoiceFromHost',
    'vadSilenceMsOf', 'normalizeVadSilenceMs', 'MarqueeSelect', 'CollapsibleSection',
    'OfficialVoiceDiag', 'FillerDiag', 'CorrectionDiag', 'voiceHotkeyDisplay',
    'setTimeout', 'clearTimeout', 'window',
    src + '\n;return { VoiceSection };'
  );
  const api = factory(
    ReactStub, () => (k) => k, { call: () => Promise.resolve({ ok: false }) },
    S.voiceCfgState, () => () => {}, (patch) => { S.saveVoiceCfg(patch); },
    () => {}, S.vadSilenceMsOf, S.normalizeVadSilenceMs,
    (p) => ReactStub.createElement('mselect', {}, p.children),
    (p) => ReactStub.createElement('section', {}, p.children),
    () => null, () => null, () => null, (c) => String(c || ''),
    setTimeout, clearTimeout, {}
  );
  const expand = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (typeof n.type === 'function') { const o = n.type(n.props); return o ? expand(o) : null; }
    return { type: n.type, props: n.props, kids: (n.kids || []).map(expand).filter(Boolean) };
  };
  const tree = expand(api.VoiceSection({}));
  const kids = tree.kids[0].kids.filter((k) => k && typeof k === 'object');
  const row1 = kids.find((k) => k.props && k.props.style && k.props.style.gridTemplateColumns);
  return { row1, row2: kids[kids.indexOf(row1) + 1], S };
}

test('VADSIL-P14x-1 变异①：开关仍留第一行 ⇒ P14 必红（判据有牙）', () => {
  const src = decodeChunk('src/client/voice/voice-section.js');
  // 把静音监测开关**搬回**第一行（用**改前的原形态**内联表达式，避免 TDZ：
  //   row1 在 vadOn 声明之前 ⇒ 变异块不得引用 vadOn）
  const chipBlock = "    React.createElement(ToggleChip, {\n      on: !!(v.vad && v.vad.enabled !== false),\n      onText: t('voiceVadShort') + t(v.vad && v.vad.enabled !== false ? 'voiceAutoEnhanceOn' : 'voiceAutoEnhanceOff'),\n      title: t('voiceVadEnabled'),\n      onToggle: () => saveVoiceCfg({ vad: { enabled: !(v.vad && v.vad.enabled !== false) } }),\n    }),\n";
  const anchorRow = "    React.createElement('div', { className: 'dsh-plg-row' },\n      React.createElement('label', { className: 'dsh-plg-label', style: { minWidth: 0 } }, t('voiceHotkeyCombo')),";
  assert.ok(src.includes(anchorRow), '前置：热键行锚点须在位');
  const back = src
    .replace("'auto auto auto minmax(0,1fr)'", "'auto auto auto auto minmax(0,1fr)'")
    .replace(anchorRow, chipBlock + anchorRow);
  const mu = renderWithSource(back, {});
  // 变异后：第一行 5 格且含 voiceVadShort ⇒ P14 的两条断言必红
  assert.equal(mu.row1.props.style.gridTemplateColumns, 'auto auto auto auto minmax(0,1fr)', '变异后 grid 应回到 5 列');
  assert.ok(JSON.stringify(mu.row1.kids.map((k) => k.props.children || '')).includes('voiceVadShort'),
    '变异后第一行应重新含静音监测 ⇒ P14 的「第一行不得含 voiceVadShort」必红（判据有牙）');
});

test('VADSIL-P14x-2 变异②：滑块最小值仍为 1 ⇒ P14c 必红（判据有牙）', () => {
  const src = decodeChunk('src/client/voice/voice-section.js');
  const mutated = src.replace("min: '0', max: '5', step: '1'", "min: '1', max: '5', step: '1'");
  assert.notEqual(mutated, src, '前置：变异锚点须命中');
  const mu = renderWithSource(mutated, {});
  const sl = mu.row2.kids.find((k) => k.props && k.props.type === 'range');
  assert.equal(sl.props.min, '1', '变异后滑块 min 应为 1 ⇒ P14c 的「min 须为 0」必红（判据有牙）');
});

test('VADSIL-P14x-3 变异③：把 0 写进 silenceMs（而非只置 enabled=false）⇒ P14d 必红（判据有牙）', () => {
  const src = decodeChunk('src/client/voice/voice-section.js');
  const anchor = 'silenceMs: zero ? silenceMsNow : normalizeVadSilenceMs(Number(next))';
  assert.ok(src.includes(anchor), '前置：setSilence 的写入锚点须在位');
  // 退回「另立第二份真相」的写法：0 直接写进 silenceMs
  const mutated = src.replace(anchor, 'silenceMs: Number(next) === 0 ? 0 : normalizeVadSilenceMs(Number(next))');
  const mu = renderWithSource(mutated, { vad: { enabled: true, silenceMs: 5000 } });
  const sl = mu.row2.kids.find((k) => k.props && k.props.type === 'range');
  sl.props.onChange({ target: { value: '0' } });
  // ⚠ 变异把 0 写进 silenceMs ⇒ mergeVoice 视 0 为非法 ⇒ 归一为默认 2000（**不是 0**，但同样**不是 5000**）
  //   ⇒ P14d 的「silenceMs 须保持原值 5000」必红 —— 这正是该判据要咬住的"档位被重置"。
  const got = mu.S.voiceCfgState.value.vad.silenceMs;
  assert.notEqual(got, 5000,
    '变异后 silenceMs 不再保持 5000（实得 ' + got + '）⇒ P14d 的「保持原值」必红（判据有牙）');
  assert.equal(mu.S.voiceCfgState.value.vad.enabled, false, '变异后 enabled 仍为 false（0 档语义未变）');
});

test('VADSIL-P14x-4 负控：不动任何文件 ⇒ P14 系列全绿（防"恒红"）', () => {
  const { row1, row2 } = layoutRows({ vad: { enabled: true, silenceMs: 3000 } });
  assert.equal(row1.props.style.gridTemplateColumns, 'auto auto auto minmax(0,1fr)', '负控：4 列');
  assert.equal(row2.kids.length, 3, '负控：第二行 3 件');
  assert.equal(row2Parts(row2).slider.props.min, '0', '负控：滑块 min 0');
  assert.equal(row2Parts(row2).slider.props.max, '5', '负控：滑块 max 5');
});
