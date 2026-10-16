// ============================================================================
// CHG-143（纠错语音独立步批）：**四组合矩阵** + 手动 ✨ 零纠错调用 · 判据锁
// ============================================================================
// 用户第三轮架构澄清（逐字）：「…是属于语言功能的增强模块，就是这个纠错**可以独立存在**的，
//   比如说**纠错功能打开的话提示詞自动增强没有打开的话，语言输入识别完成之后会自动的使用纠错
//   然后就结束**，如果**自动增强和语言纠错都打开的话那就是语言输入完成之后先纠错然后接着增强**，
//   这样的一个逻辑关系，**并不是集成绑定在提示詞增强一起的**」。
//
// 本文件判的就是这句话里的**四格矩阵**，每格给「**调用次数 + 顺序**」读数（不是"结果看着对"）：
//   ① 纠错关 + 增强关 ⇒ 纠错 0 次、增强 0 次
//   ② 纠错关 + 增强开 ⇒ 纠错 0 次、增强 1 次
//   ③ 纠错开 + 增强关 ⇒ 纠错 1 次、增强 **0 次**（⭐ 独立存在的证据）
//   ④ 纠错开 + 增强开 ⇒ 纠错 1 次、增强 1 次，**且纠错先于增强**（顺序可证）
//
// ⚠ 手动 ✨ 不纠错（用户第四项裁定）：由「增强入口不碰纠错」保证 —— 本文件用源码面判据锁住
//   （`enhance` 调用链里不得出现纠错调用），并实测 `src/client/helpers.js` 的 `enhance()`
//   **不发起** `voice/correct`（零调用）。
// ============================================================================
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** 解码 chunk（契约面收口批 2026-10-17 · 第 ② 件：本地副本已删除，改共享单一事实源）。
 *  ⚠ 判别力**上升**（非等价搬移）：旧实现用 `assert.ok(m, …)`，只在**测试体内**失败且信息是
 *  assertion 文案；共享解码器在**读取期**即 `throw`，错误**点名 chunk 文件**。
 *  ⚠ 取具名成员解构（`require()` 一个 ESM 模块拿到命名空间对象，不可直接调用 —— 实测）。 */
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');

// 极简 React 桩（ref/state 跨渲染持久；effect 每次渲染后执行）——照抄 official-bridge.test.cjs
function makeMiniReact() {
  const refSlots = [];
  const stateSlots = [];
  let effects = [];
  let ri = 0, si = 0;
  return {
    begin() { ri = 0; si = 0; effects = []; },
    React: {
      useState(init) { const i = si++; if (!(i in stateSlots)) stateSlots[i] = typeof init === 'function' ? init() : init; return [stateSlots[i], (v) => { stateSlots[i] = v; }]; },
      useRef(init) { const i = ri++; if (!(i in refSlots)) refSlots[i] = { current: init }; return refSlots[i]; },
      useEffect(fn) { effects.push(fn); },
    },
    runEffects() { for (const fn of effects) fn(); },
  };
}

/** 官方桥的假环境（相位 = data-voice-activity 属性；与 official-bridge.test.cjs 同款形态）。 */
function makeFakeEnv(opts) {
  const o = opts || {};
  const observers = [];
  const doc = {
    _attr: o.recordingPhase ? 'recording' : null,
    body: {},
    querySelector(sel) {
      if (sel.includes('data-voice-activity')) {
        if (!this._attr) return null;
        if (sel.includes('="recording"')) return this._attr === 'recording' ? { querySelectorAll: () => [] } : null;
        if (sel.includes('="feedback"')) return this._attr === 'feedback' ? { querySelectorAll: () => [] } : null;
        return { querySelectorAll: () => [] };
      }
      return null;
    },
    querySelectorAll() { return []; },
  };
  class MO {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() {}
  }
  const win = { _listeners: {}, addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }, removeEventListener() {}, _fire(t, e) { for (const fn of (this._listeners[t] || []).slice()) fn(e); } };
  return { document: doc, window: win, navigator: { mediaDevices: { getUserMedia: () => Promise.resolve({}) } }, observerInstances: observers, MutationObserver: MO, AudioContext: function () { throw new Error('no-ac'); } };
}

/** 载入 official-bridge chunk（只取真实实现，不 mock 其内部）。 */
function loadBridge(env) {
  const src = decodeChunk('src/client/voice/official-bridge.js');
  const factory = new Function(
    'window', 'document', 'navigator', 'MutationObserver', 'voiceCfgState', 'vadRequiredQuiet', 'vadSilenceMsOf',
    src + '\n;return officialVoiceBridge;'
  );
  return factory(env.window, env.document, env.navigator, env.MutationObserver,
    { value: { vad: { enabled: false } } }, () => 20, () => 2000);
}

/**
 * 构建 hotkey 宿主（真实 hotkey.js 源码 + 可观测的 `voice/correct` 与 `enhance` 桩）。
 * ⚠ 两个桩都记录**调用序号**到一个共享 timeline ⇒ 顺序可证（不只是次数）。
 */
function buildHost(env, bridge, o) {
  const mini = makeMiniReact();
  const timerRegs = [];
  const timerSvcLocal = {
    interval: (fn, ms) => { const r = { fn, ms, kind: 'interval', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
    timeout: (fn, ms) => { const r = { fn, ms, kind: 'timeout', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
  };
  bridge.setTimer(timerSvcLocal);
  const voiceCfgState = {
    value: {
      autoEnhance: o.autoEnhance === true,
      correction: { enabled: o.correction === true },
      vad: { enabled: true },
      hotkey: { enabled: false, combo: '' },
      filler: { enabled: false },          // 关掉清口水词，隔离本判据（不混入 filler 行为）
      refine: {},
    },
    listeners: new Set(), synced: true,
  };
  // 共享 timeline：记录每一次被调用的**名称**，顺序即真相
  const timeline = [];
  const correctCalls = [];
  const enhanceCalls = [];
  const host = {
    call: (method, args) => {
      if (method === 'voice/correct') {
        timeline.push('correct');
        correctCalls.push(args);
        // 默认：返回一个"纠错后"的文本（可被 o.correctResult 覆盖）
        return Promise.resolve(o.correctResult || { ok: true, text: '纠正后的文字', changed: true });
      }
      return Promise.resolve({ ok: true });
    },
  };
  const storeStub = { phase: 'idle', error: null, backup: '', enhanced: '', seq: 0, memoryRounds: [], optimized: false, lastModel: '', fallbackUsed: false, degraded: [], truncated: false };
  const src = decodeChunk('src/client/voice/hotkey.js');
  const factory = new Function(
    'React', 'host', 'voiceCfgState', 'subscribeVoiceConfig', 'voiceHotkeyDisplay', 'parseVoiceHotkey',
    'matchVoiceHotkey', 'isEnhancing', 'subscribe', 'storeFor', 'startVoiceRecording', 'stopVoiceRecording',
    'isVoiceRecording', 'insertVoiceText', 'notify', 'enhance', 'timerSvc', 'officialVoiceBridge', 'makeT', 'ZH',
    'MarqueeSelect', 'CollapsibleSection', 'setInterval', 'clearInterval', 'setTimeout', 'navigator', 'window',
    'configState', 'markCorrectionSkipped', 'notifyCorrection', 'correctionState',
    src + '\n;return { VoiceHotkeyHost };'
  );
  const api = factory(
    mini.React, host, voiceCfgState, () => () => {}, (c) => c, () => null, () => false, () => false,
    () => () => {}, () => storeStub,
    async () => { throw new Error('should not record'); }, async () => null, () => false,
    () => Promise.resolve({ filled: true }), () => {},
    (...a) => { timeline.push('enhance'); enhanceCalls.push(a); },
    timerSvcLocal, bridge, (p) => (k) => k, {}, null, null,
    setInterval, clearInterval, setTimeout, env.navigator, env.window,
    { value: {} }, () => {}, () => {}, { runs: 0, skipped: 0, ok: 0, changed: 0, failed: 0, lastAt: 0, lastCode: '', lastSkipReason: '' }
  );
  const props = { sessionId: o.sessionId || 'sess-combo', inputActions: { setDraft() {} }, input: { draft: o.draft0 || '' } };
  const render = (draft) => { if (draft !== undefined) props.input = { draft }; mini.begin(); api.VoiceHotkeyHost(props); mini.runEffects(); };
  return { render, props, timeline, correctCalls, enhanceCalls, timerRegs, voiceCfgState };
}

/**
 * 跑一次「识别完成」全链（正常写回出口）：
 *   渲染 → 会话开始（recording）→ 会话结束（收口）→ 渲染写回 → 推进轮询
 * 返回 host（含 timeline/correctCalls/enhanceCalls）。
 */
async function runRecognitionComplete(o) {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHost(env, bridge, o);
  host.render('');                                     // 渲染#1：注册订阅
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();           // 官方会话开始
  env.document._attr = null; mo.cb();                  // 官方会话结束（装臂等写回）
  host.render(o.writeBack || '识别出来的文字');           // 渲染#2：写回落地
  // 推进轮询（写回落地那一步即可命中，无需等到上限）
  for (const r of host.timerRegs) { if (!r.cleared) r.fn(); }
  // 让 voice/correct 的 Promise 链 settle（含 then 里的增强发起）
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return host;
}

// ───────────────────────── 四组合矩阵（逐格：次数 + 顺序） ─────────────────────────

test('CHG143-C1 组合 纠错关 + 增强关 ⇒ 纠错 0 次、增强 0 次（不动）', async () => {
  const host = await runRecognitionComplete({ correction: false, autoEnhance: false });
  assert.equal(host.correctCalls.length, 0, '纠错关 ⇒ 必须**零**纠错调用');
  assert.equal(host.enhanceCalls.length, 0, '增强关 ⇒ 必须**零**增强调用');
  assert.deepEqual(host.timeline, [], '本组合下不得发生任何调用');
});

test('CHG143-C2 组合 纠错关 + 增强开 ⇒ 纠错 0 次、增强 1 次（只增强）', async () => {
  const host = await runRecognitionComplete({ correction: false, autoEnhance: true });
  assert.equal(host.correctCalls.length, 0, '纠错关 ⇒ 必须**零**纠错调用');
  assert.equal(host.enhanceCalls.length, 1, '增强开 ⇒ 恰好 1 次增强');
  assert.deepEqual(host.timeline, ['enhance'], '顺序面：只有增强');
});

test('CHG143-C3 ⭐ 组合 纠错开 + 增强关 ⇒ 纠错 1 次、增强 **0 次**（只纠错 → 结束）', async () => {
  const host = await runRecognitionComplete({ correction: true, autoEnhance: false });
  assert.equal(host.correctCalls.length, 1, '纠错开 ⇒ 恰好 1 次纠错调用');
  assert.equal(host.enhanceCalls.length, 0, '⭐ 用户明写「自动增强没打开…使用纠错然后就结束」⇒ 增强必须 **0 次**');
  assert.deepEqual(host.timeline, ['correct'], '⭐ 顺序面：只有纠错，**没有任何增强**（独立存在的证据）');
  // ⭐ 这一格是「纠错可脱离增强独立生效」的**唯一**证据格：它必须在新架构下成立
  assert.ok(!host.timeline.includes('enhance'), 'timeline 中不得出现 enhance');
});

test('CHG143-C4 ⭐ 组合 纠错开 + 增强开 ⇒ 先纠错 → 再增强（顺序可证）', async () => {
  const host = await runRecognitionComplete({ correction: true, autoEnhance: true });
  assert.equal(host.correctCalls.length, 1, '纠错开 ⇒ 恰好 1 次纠错调用');
  assert.equal(host.enhanceCalls.length, 1, '增强开 ⇒ 恰好 1 次增强');
  assert.deepEqual(host.timeline, ['correct', 'enhance'], '⭐ 顺序面：**纠错先、增强后**（用户明写「先纠错然后接着增强」）');
});

// ───────────────────── 纠错结果参与下游（草稿被纠正后再增强） ─────────────────────

test('CHG143-C5 纠错开 + 增强开：增强基于**纠错后**的草稿发起（不是原稿）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHost(env, bridge, { correction: true, autoEnhance: true, correctResult: { ok: true, text: '纠正后的文字', changed: true } });
  host.render('');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = null; mo.cb();
  host.render('识别出来的文字');
  for (const r of host.timerRegs) { if (!r.cleared) r.fn(); }
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(host.timeline, ['correct', 'enhance'], '顺序：纠错 → 增强');
  // 增强拿到的草稿应为**纠错后**的文本（write 回草稿 → draftRef 更新 → enhance 读 draftRef）
  const draftArg = host.enhanceCalls[0][1];
  assert.equal(draftArg, '纠正后的文字', '增强须基于纠错后的草稿（纠错的产出要真正流入下一步）');
});

// ───────────────────── 故障路径：纠错失败/不可达 ⇒ 不吞掉增强 ─────────────────────

test('CHG143-C6 纠错失败（!ok）⇒ 不得吞掉增强（增强仍须发生）且失败可见', async () => {
  const host = await runRecognitionComplete({ correction: true, autoEnhance: true, correctResult: { ok: false, code: 'NO_MODEL' } });
  assert.equal(host.correctCalls.length, 1, '纠错仍被发起 1 次');
  assert.equal(host.enhanceCalls.length, 1, '纠错失败**不得**阻断增强（按 autoEnhance 继续）');
  assert.deepEqual(host.timeline, ['correct', 'enhance'], '顺序仍是纠错 → 增强');
});

test('CHG143-C7 纠错开 + 增强关 + 纠错失败 ⇒ 不得出现增强调用（负控）', async () => {
  const host = await runRecognitionComplete({ correction: true, autoEnhance: false, correctResult: { ok: false, code: 'TIMEOUT' } });
  assert.equal(host.correctCalls.length, 1, '纠错被发起 1 次');
  assert.equal(host.enhanceCalls.length, 0, '增强关 ⇒ 即便纠错失败也**不得**触发增强');
  assert.deepEqual(host.timeline, ['correct'], 'timeline 只应有纠错');
});

// ───────────────────── 两个出口都要给读数（勿漏 endedInFeedback） ─────────────────────

test('CHG143-C8 ⭐ 未识别出口（endedInFeedback）同样走组合判定：纠错开 + 增强开 ⇒ 纠错→增强', async () => {
  // 病（RECON §3 点名）：hotkey.js 有**两个**「识别完成」出口 —— 正常写回 + `snap.endedInFeedback`。
  //   只改一个 ⇒ 漏一半。本用例专测**未识别**出口。
  const env = makeFakeEnv({ recordingPhase: false });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHost(env, bridge, { correction: true, autoEnhance: true, sessionId: 'sess-fb' });
  host.render('原草稿文字');                            // 渲染#1：注册订阅 + 基线
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'feedback'; mo.cb();             // ⭐ 官方以「未识别」失败出口收尾
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(host.correctCalls.length, 1, '未识别出口**也必须**发起纠错（不得漏掉这一半）');
  assert.equal(host.enhanceCalls.length, 1, '未识别出口也须按 autoEnhance 增强');
  assert.deepEqual(host.timeline, ['correct', 'enhance'], '未识别出口顺序同为纠错 → 增强');
});

test('CHG143-C9 未识别出口 · 纠错开 + 增强关 ⇒ 只纠错、无增强（出口负控）', async () => {
  const env = makeFakeEnv({ recordingPhase: false });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHost(env, bridge, { correction: true, autoEnhance: false, sessionId: 'sess-fb2' });
  host.render('原草稿文字');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'feedback'; mo.cb();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(host.correctCalls.length, 1, '未识别出口发起纠错');
  assert.equal(host.enhanceCalls.length, 0, '增强关 ⇒ 不得增强');
  assert.deepEqual(host.timeline, ['correct'], 'timeline 只应有纠错');
});

// ───────────────────── ⭐ 手动 ✨ 零纠错调用（用户第四项裁定） ─────────────────────

test('CHG143-M1 ⭐ 手动 ✨ 增强零纠错调用：helpers.js 的 enhance() 不含 voice/correct', () => {
  const helpers = decodeChunk('src/client/helpers.js');
  assert.ok(!helpers.includes('voice/correct'), '⭐ 手动 ✨ 的增强入口不得出现 voice/correct（用户明选：手动 ✨ 不纠错）');
  assert.ok(!helpers.includes('runCorrectionThenMaybeEnhance'), '增强入口不得调用纠错调度器');
  // 正向：手动路径确实存在（防"删掉整个入口"式的假绿）
  assert.ok(helpers.includes("host.call('enhance'"), '手动增强入口须仍在（正向对照）');
});

test('CHG143-M2 ⭐ 纠错调度器**只**在语音链路的两个出口被调用（不得在增强管线内）', () => {
  const hotkey = decodeChunk('src/client/voice/hotkey.js');
  // 定义形如 `const runCorrectionThenMaybeEnhance = () => {` ⇒ 名字后**不**跟 `()`
  assert.ok(hotkey.includes('const runCorrectionThenMaybeEnhance = () =>'), '调度器须有定义');
  // 调用点 = 名字后紧跟 `()`；应为**恰好 2 处**（正常写回出口 + 未识别出口）——
  //   ⚠ 这正是「两个出口都要给读数」的机检形态：漏一个出口 ⇒ 此处变 1 ⇒ 立红。
  const calls = hotkey.match(/runCorrectionThenMaybeEnhance\(\)/g) || [];
  assert.equal(calls.length, 2, '应恰好 2 处调用（写回出口 + 未识别出口）—— 漏一半即红');
  // ⚠ 反向：增强管线（host bundle）内不得出现纠错调用
  const hostBundle = fs.readFileSync(path.join(ROOT, 'plugin-host.js'), 'utf8');
  const enhanceStart = hostBundle.indexOf("harness.handle('enhance'");
  const corrStart = hostBundle.indexOf("harness.handle('voice/correct'");
  assert.ok(enhanceStart > 0 && corrStart > 0, '两个 handler 都须在产物内');
  // `enhance` handler 体的**上界** = 纠错块自身的起始标记（纠错块紧随 enhance handler 之后）。
  //   ⚠ 不能用 `harness.handle('cancel'` 作界：纠错块正插在 enhance 与 cancel **之间**
  //   ⇒ 那样的切片会把纠错块算进 enhance 体内（本席第一版即栽在此处，实测报红）。
  const corrMarker = hostBundle.indexOf('// ================= CHG-143');
  assert.ok(corrMarker > 0 && corrMarker < corrStart, '纠错块起始标记须在 voice/correct 注册之前');
  const enhanceBody = hostBundle.slice(enhanceStart, corrMarker);
  assert.ok(!/voice\/correct|runCorrection/.test(enhanceBody), '⭐ 增强 handler 体内不得有任何纠错调用（不绑进增强管线）');
  // 正向对照：纠错块**确实存在**且注册了 RPC（防"把整个功能删掉"式的假绿）
  assert.ok(corrMarker > 0, '纠错块须存在（正向对照）');
  assert.ok(/harness\.handle\('voice\/correct'/.test(hostBundle.slice(corrMarker)), '纠错块内须注册 voice/correct');
});

test('CHG143-M3 ⭐ 手动增强路径（helpers.enhance）与语音纠错在源码面**可分辨**', () => {
  const helpers = decodeChunk('src/client/helpers.js');
  // 手动路径：唯一的 RPC 是 enhance（增强），且不读 correction 开关
  assert.ok(helpers.includes("host.call('enhance'"), '手动路径走 enhance RPC');
  assert.ok(!/correction/.test(helpers), '手动路径不得读 correction 配置（来源显式区分，不靠"增强里顺手带"）');
});

// ───────────────────── 开关默认关闭（用户已定） ─────────────────────

test('CHG143-S1 新开关默认**关闭**：client 默认值 + mergeVoice 白名单取形', () => {
  const state = decodeChunk('src/client/voice/state.js');
  assert.ok(/correction:\s*\{\s*enabled:\s*false\s*\}/.test(state), 'VOICE_CFG_DEFAULTS.correction.enabled 须为 false');
  assert.ok(/correction:\s*\{\s*enabled:\s*\(v && v\.correction && v\.correction\.enabled === true\)/.test(state),
    'mergeVoice 取形须逐字对齐 autoEnhance（=== true ⇒ 缺省/非法回退 false）');
});

test('CHG143-S2 两侧白名单**同形**：host sanitizeVoiceCfg ↔ client mergeVoice', () => {
  const host = fs.readFileSync(path.join(ROOT, 'lib/asr.cjs'), 'utf8');
  const client = decodeChunk('src/client/voice/state.js');
  // host 侧（lib/asr.cjs 是普通 cjs 源文本）
  assert.ok(/correction:\s*\{\s*enabled:\s*\(cfg && cfg\.correction && cfg\.correction\.enabled === true\) \? true : false \}/.test(host),
    'host sanitizeVoiceCfg 须有同形 correction 白名单');
  // client 侧
  assert.ok(/correction:\s*\{\s*enabled:\s*\(v && v\.correction && v\.correction\.enabled === true\) \? true : false \}/.test(client),
    'client mergeVoice 须有同形 correction 白名单');
  // ⚠ 漏改一侧 ⇒ 开关形同虚设（M-3）：两侧都必须命中
  assert.ok(host.includes('correction') && client.includes('correction'), '两侧都须含 correction（漏一侧即 M-3 缺陷）');
});

// ───────────────────── ⭐ 护栏随能力搬迁（§0-octies · 强度不得下降） ─────────────────────
// 本席从 `prompts/enhance/discipline.md` 第 6 条移出的受约束例外，**整块逐字**迁入新步提示词。
// 本条把它机检化：**每一条护栏都必须在位**（一条不少、一条不弱）。
//   ⚠ 这是「移除的是位置、不是强度」的可验收形态 —— 若将来有人把某条删/削弱，此处立红。
test('CHG143-G1 ⭐ 护栏随能力搬迁：四条合取判据 + 兜底 + 可见性**逐字在位**', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'prompts/enhance/correction.md'), 'utf8');
  const guards = [
    // ── 例外主体 + 合取性（"同时" 是合取的关键字，改成"任一"即失效）──
    ['例外主体', '**字词层低争议订正（本条唯一例外·可撤回）**'],
    ['合取（同时满足下列四条）', '**同时**满足下列四条时才适用本例外'],
    // ── ① 唯一读法 ──
    ['① 唯一读法', '**唯一读法**：该处只有一种写法能同时保住原文全部语义要素（动作对象、动作方向、数量、范围、禁止项、术语、语气），不存在第二种同样成立的读法'],
    // ── ② 只换单位 ──
    ['② 只换单位', '**只换单位**：订正只是把一个字/词换成另一个字/词，不得增词、删词、换序、扩写、缩写，也不得改变标点语义'],
    // ── ③ 非事实面 ──
    ['③ 非事实面', '**非事实面**：该字词不是项目/代码面的名称（标识符、文件名、路径、接口名、字段名、命令名、库名）——疑似错字落在这类名称上**一律不动、按原文处理**'],
    // ── ④ 非专名非数值 ──
    ['④ 非专名非数值', '**非专名非数值**：人名、机构名、产品名、数字、单位、版本号**一律不动**'],
    // ── 兜底（拿不准不改）三件套 ──
    ['兜底标题', '**兜底（拿不准不改）**'],
    ['兜底-原样保留（禁止猜测性订正）', '**原样保留原文、不做任何订正**'],
    ['兜底-宁可漏改', '宁可漏改，绝不错改'],
    ['兜底-禁止猜测代替判定', '**禁止**以「大概是这个意思」的猜测代替判定'],
    // ── 可见性 ──
    ['可见性标题 + 禁止文内标注', '**可见性（可撤回·禁止文内标注）**'],
    ['可见性-禁加说明/标记/注释/清单/前后缀', '在输出中加入任何纠错说明、标记、行内注释、清单或前后缀'],
    ['可见性-整段撤回对照原文', '用户以**整段撤回**（撤回即还原原文）对照原文'],
    // ── 例外不外溢 ──
    ['例外不外溢（其余要求强度不变）', '**原样适用、强度不变**'],
  ];
  const missing = guards.filter(([, frag]) => !prompt.includes(frag)).map(([n]) => n);
  assert.deepEqual(missing, [], '以下护栏未逐字在位（强度下降/丢失）：' + missing.join('、'));
});

test('CHG143-G2 ⭐ 增强层已不再自带纠错能力（移除的**可判**形态）', () => {
  // 移除后：纪律模板与三档 T1 都不得再出现「字词层低争议订正」与其指针
  const discipline = fs.readFileSync(path.join(ROOT, 'prompts/enhance/discipline.md'), 'utf8');
  assert.ok(!discipline.includes('字词层低争议订正'), 'discipline.md 第 6 条不得再留该例外（已移出）');
  assert.ok(discipline.includes('不得臆造、删减、替换、颠倒原文已明确的信息'), '第 6 条核心句须**原样存活**（回归纯「不得替换」）');
  for (const m of ['base', 'lite', 'standard']) {
    const t1 = fs.readFileSync(path.join(ROOT, 'prompts/enhance', m, 'system.md'), 'utf8');
    assert.ok(!t1.includes('字词层低争议订正'), m + '/system.md 不得再留纠错例外指针（否则指向空气）');
    assert.ok(!t1.includes('输出纪律第 6 条'), m + '/system.md 不得再留「见输出纪律第 6 条」指针');
    // 正向：语义等价底线仍在（防"把整条删掉"式的假绿）
    assert.ok(t1.includes('语义等价是底线'), m + '/system.md 须保留「语义等价是底线」');
  }
  // smart/publish 本批一字未动（对照）
  for (const m of ['smart', 'publish']) {
    const t1 = fs.readFileSync(path.join(ROOT, 'prompts/enhance', m, 'system.md'), 'utf8');
    assert.ok(!t1.includes('字词层低争议订正'), m + '/system.md 本就不含该例外（未被本批触碰）');
  }
});

test('CHG143-G3 ⭐ 新步提示词已进产物生成区（20 个常量 · 由脚本重建）', () => {
  const bundle = fs.readFileSync(path.join(ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(bundle.includes('const CORRECTION_PROMPT = ['), 'CORRECTION_PROMPT 须已进产物生成区');
  assert.ok(bundle.includes('你正在执行「**语音输入纠错**」任务'), '纠错提示词正文须在产物的生成区内');
  // 反向：产物内不得再留被移除的例外（纪律层）
  const discStart = bundle.indexOf('const DISCIPLINE_PROMPT = [');
  const discEnd = bundle.indexOf('].join(', discStart);
  const disc = bundle.slice(discStart, discEnd);
  assert.ok(!disc.includes('字词层低争议订正'), '产物的 DISCIPLINE_PROMPT 不得再含该例外（已移出）');
});
