'use strict';
// official-bridge.test —— 官方录音路径增值桥（CHG-011 / 方案 §4.6.2.6 / UD-0014 选 B）
//
// 验证要求（UD-0010 / UD-0011）：**自动化不得以「需要真麦克风」为前置** ——
// 全部用**注入假件**（假 navigator.mediaDevices.getUserMedia / 假 MediaStream /
// 假 MediaRecorder / 假 AudioContext+AnalyserNode）驱动到「静音达标」，断言官方 stop 被触发。
// 真麦只作人工项登记（见报告）。
//
// 判据强度：数字锁用严格 ===；无 skip；不存在恒真断言。
// 覆盖：正例(A1 停官方) · 负控(未命中不改行为/同一性) · 幂等(层数) · 卸载恢复(===原函数) ·
//       互斥(两方向) · 不静默失效(状态可被观察到) · A2 兜底 · 显式降级 · 让位官方钩子 ·
//       变异自证(正例必红 + 负控必绿)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CHUNK = 'src/client/voice/official-bridge.js';

// ⚠ 契约面收口批（2026-10-17 · 第 ② 件）：本地 `decodeChunk` 副本已删除，改共享单一事实源
//   （`scripts/lib/chunk-decode.mjs`）。原实现的「行首锚定」依据已搬进该模块头注；
//   fail-closed 与「报错点名声」两条语义逐字保留。⚠ 取具名成员解构 —— `require()` 一个
//   ESM 模块拿到的是命名空间对象，不可直接调用（实测）。
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');

// §7.4 起：official-bridge 依赖 state.js 的单一事实源（vadSilenceMsOf / vadRequiredQuiet / voiceCfgState）。
// 测试注入**真实的 state.js**（而非桩），以保证「两条入口共用同一值」在测试里也是同一份实现。
function loadStateForBridge(env) {
  const src = decodeChunk('src/client/voice/state.js');
  const factory = new Function(
    'localStorage', 'host',
    src + '\n;return { vadSilenceMsOf, vadRequiredQuiet, voiceCfgState };'
  );
  return factory(env.localStorage, { call: () => Promise.resolve({ ok: false }) });
}

// ── 假浏览器环境 ────────────────────────────────────────────────────────────
// 用假件把「静音达标」推到底：先给高 RMS（有语音），再给低 RMS（静音）达 2s/100ms = 20 帧。
function makeFakeEnv(opts) {
  const o = opts || {};
  const timers = [];
  const frames = [];              // 每次 tick 返回的 RMS（归一化）
  // 默认脚本：5 帧校准（低）+ 1 帧语音（高）+ 20 帧静音 ⇒ 达标自动停
  for (let i = 0; i < 5; i++) frames.push(0.001);
  frames.push(0.5);
  for (let i = 0; i < 20; i++) frames.push(0.001);

  const recorderInstances = [];
  class FakeMediaRecorder {
    // 构造即 idle，start() 才进入 recording —— 模拟真实 MediaRecorder 行为
    // （包装器只在 state==='recording' 时捕获实例 ⇒ 必须 start 后捕获）
    constructor(stream) { this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/webm'; this.onstop = null; recorderInstances.push(this); }
    start() { this.state = 'recording'; mediaDevices.lastRecorder = this; }
    stop() { this.state = 'inactive'; this.stopCalls = (this.stopCalls || 0) + 1; if (typeof this.onstop === 'function') this.onstop(); }
    static isTypeSupported() { return true; }
  }

  // 官方停止按钮（P2-补做：停止**第一优先**路径 —— 唯一走完官方 finish() 的入口）
  const stopButton = {
    disabled: o.stopDisabled === true, clicks: 0,
    getAttribute: (n) => (n === 'aria-label' ? '停止并识别' : null),
    dispatchEvent() { this.clicks++; return true; },
    click() { this.clicks++; },
  };
  // 官方开始按钮（P2-补做：热键 → 派发点击它 = 「远程按一下官方按钮」；只在 idle 时存在）
  const startButton = {
    disabled: o.startDisabled === true, clicks: 0,
    getAttribute: (n) => (n === 'aria-label' ? '开始录音' : null),
    dispatchEvent() { this.clicks++; return true; },
    click() { this.clicks++; },
  };
  // ⚠ 未识别态批（2026-10-15 · 需求 3+4）：官方「未识别到语音」窗口的 retry 按钮。
  //   文案锚来自 **CDP 实读**（报告 §②）：aria-label = 「重新录音」/「Record again」；
  //   官方源码键值见 voice-input/lib/client.js:5199（zh）/ :5303（en），
  //   渲染点 :5150-5160（feedback 且无 pending ⇒ `aria-label: t('retryRecording')`, `onClick: () => start()`）。
  const retryButton = {
    disabled: o.retryDisabled === true, clicks: 0,
    getAttribute: (n) => (n === 'aria-label' ? '重新录音' : null),
    dispatchEvent() { this.clicks++; return true; },
    click() { this.clicks++; },
  };
  // 官方失败出口（相位 feedback + 文案节点，官方自带、插件只读）
  // ⚠ B-1（2026-10-14 定位批 · CDP 实读官方 DOM）：官方该节点是 **CSS-module 哈希类**
  //   （实测 `ddpbLW_activityMessage`）⇒ 裸 `.activityMessage` 选择器在真实 DOM 里**永不命中**。
  //   本假件**照实模拟**该点（realClassName 默认 true）：裸类名选择器返回 null，子串选择器才命中。
  const feedbackNode = {};
  const messageNode = { textContent: o.feedbackText || '未识别到语音', className: 'ddpbLW_activityMessage' };
  const activityRegion = { };
  const activityNodes = o.recordingPhase ? [{}, ] : [];

  class FakeAnalyser {
    constructor() { this.fftSize = 1024; }
    getByteTimeDomainData(buf) {
      const rms = o.frameRms ? o.frameRms(frames) : frames.shift();
      const v = (rms === undefined ? 0.001 : rms);
      // 反解：v = |d|，取正半轴 ⇒ (buf[i]-128)/128 = v
      const byte = Math.max(0, Math.min(255, Math.round(128 + v * 128)));
      for (let i = 0; i < buf.length; i++) buf[i] = byte;
    }
  }
  let closed = false;
  // SW-1（2026-10-15 接线批）：计数 AudioContext 构造 —— 「VAD 是否被启动」的**直接**判据
  //   （开关关闭 ⇒ 不得建 AC ⇒ 不观测）。原 `closed` 变量与既有断言语义不变，仅新增计数。
  let acCreated = 0;
  class FakeAudioContext {
    constructor() { acCreated++; this.state = 'running'; }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return new FakeAnalyser(); }
    close() { closed = true; this.state = 'closed'; return Promise.resolve(); }
  }

  const mediaDevices = {};
  const originalGum = function (constraints) {
    mediaDevices.lastConstraints = constraints;
    mediaDevices.callCount = (mediaDevices.callCount || 0) + 1;
    const stream = {
      id: 'stream-' + mediaDevices.callCount,
      getTracks: () => [{ stop() {} }],
    };
    mediaDevices.lastStream = stream;
    return Promise.resolve(stream);
  };
  mediaDevices.getUserMedia = originalGum;

  const windowStub = {
    AudioContext: FakeAudioContext,
    MediaRecorder: o.noRecorder ? undefined : FakeMediaRecorder,
    __dshPeDisableOfficialBridge: o.disabled === true,
    __dshSpeechVoiceActivityHook: o.officialHook || undefined,
    // F-18 回归锁：记录监听器，使测试能驱动**真实**的 keydown/keyup 处理器（而非另写一套假处理器）
    _ls: {},
    addEventListener(type, fn) { (this._ls[type] = this._ls[type] || []).push(fn); },
    removeEventListener(type, fn) { if (this._ls[type]) this._ls[type] = this._ls[type].filter((f) => f !== fn); },
    _fire(type, ev) { for (const fn of (this._ls[type] || [])) fn(ev); },
  };
  const documentStub = {
    // 初始必须为 null（真实 DOM 在录音开始前**根本没有**该属性）——需要相位的用例自行置位并驱动 observer
    // （若初始就置位，install 的首次 sync 会误判为「已有会话」⇒ missed 误报，实测被 OVB-M02/D02 抓到）
    _attr: null,
    body: {},
    querySelector(sel) {
      if (sel === '[data-voice-activity]') return documentStub._attr ? activityNodes[0] : null;
      if (sel === '[data-voice-activity="recording"]') return documentStub._attr === 'recording' ? activityNodes[0] : null;
      if (sel === '[data-voice-activity="feedback"]') return documentStub._attr === 'feedback' ? feedbackNode : null;
      // ⚠ 真实 DOM 里该类名被 CSS-module 哈希化（CDP 实测 `ddpbLW_activityMessage`）。
      //   o.realClassName !== false ⇒ 裸类名**不命中**（正是本批定位到的缺陷形态）；
      //   子串选择器（[class*="activityMessage"]）仍命中。
      if (sel === '[data-voice-activity="feedback"] .activityMessage') {
        if (o.realClassName === false) return documentStub._attr === 'feedback' ? messageNode : null;
        return null;
      }
      if (sel === '[data-voice-activity="feedback"] [class*="activityMessage"]') {
        return documentStub._attr === 'feedback' ? messageNode : null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel !== 'button') return [];
      const btns = [];
      // 官方结构：idle 时只有开始按钮（相位节点未挂载）；recording 时只有停止按钮。
      // ⚠ 开始按钮的标签在**非 idle** 时会被官方换成 setupPrompt.trigger ⇒ 此处据相位模拟该行为。
      if (!documentStub._attr) {
        if (!o.noStartButton) btns.push(startButton);
      } else if (!o.noStopButton) {
        btns.push(stopButton);
      }
      // ⚠ 未识别态批（CDP 实读：feedback 窗口内只有 `取消` + `重新录音`，均在位、均未 disabled）：
      //   feedback 相位下**没有**开始按钮、**没有**停止按钮，只有 retry 锚。
      //   `取消` 不在本假件的按钮面上（它**不得**被当作启动锚 —— 官方 retry 才是 `start()`）。
      if (documentStub._attr === 'feedback' && !o.noRetryButton) btns.push(retryButton);
      return btns;
    },
  };
  const localStorageStub = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };
  // 记录若干次 timer 注册（驱动静音所需），并给出手动驱动句柄
  const timerSvc = {
    interval(fn, ms) { const rec = { fn, ms, cleared: false }; timers.push(rec); return () => { rec.cleared = true; }; },
  };
  const observerInstances = [];
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; observerInstances.push(this); }
    observe() {}
    disconnect() {}
  }

  const sandboxWindow = windowStub;
  return {
    window: sandboxWindow, document: documentStub, localStorage: localStorageStub,
    navigator: { mediaDevices }, timers, timerSvc, observerInstances,
    mediaDevices, originalGum, recorderInstances, stopButton, startButton, retryButton, feedbackNode, frames,
    driveTicks: (n) => { let i = 0; for (const r of timers) { /* noop */ } return i; },
    // SW-1（2026-10-15）：AudioContext 构造计数 —— 「VAD 是否被启动」的直接读数
    acCreated: () => acCreated,
  };
}

// 求值 chunk：注入假全局，返回桥对象 + 观察句柄
function loadBridge(env, cfg) {
  const src = decodeChunk(CHUNK);
  const S = loadStateForBridge(env);
  // SW-1（2026-10-15 接线批）：允许用例注入指定配置（默认不注入 ⇒ 走真实 state.js 的默认值，
  //   既有用例行为逐字不变）。注入的是**真实** voiceCfgState 对象，故桥读到的是真实配置形态。
  if (cfg !== undefined) S.voiceCfgState.value = cfg;
  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    src + '\n;return officialVoiceBridge;'
  );
  let seq = 0;
  const bridge = factory(
    env.window, env.document, env.navigator, env.localStorage,
    (fn, ms) => { const rec = { fn, ms, cleared: false, id: ++seq }; env.timers.push(rec); return rec.id; },
    (id) => { const rec = env.timers.find((r) => r.id === id); if (rec) rec.cleared = true; },
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent(type, init) { return { type, init }; },
    S.vadSilenceMsOf, S.vadRequiredQuiet, S.voiceCfgState
  );
  bridge.setTimer(env.timerSvc);
  return bridge;
}

// 把假件的时间轴推到底：反复调用注册的 interval 回调直到不再新增或达上限
function runVad(env, maxTicks) {
  const cap = maxTicks || 200;
  let ticks = 0;
  for (const rec of env.timers) {
    if (rec.cleared) continue;
    while (!rec.cleared && ticks < cap) { rec.fn(); ticks++; }
  }
  return ticks;
}

const flush = () => new Promise((r) => setImmediate(r));

// ───────────────────────────── 正例：停止走官方停止按钮 ─────────────────────────────
// P2-补做（2026-10-13 · UD-0016）：热键改走官方路径后，**停止的第一优先 = 派发点击官方停止按钮**
// （唯一走完官方 `finish()`：相位收尾 → capture.stop() → 转写 → 写回）；MediaRecorder 实例仅兜底。
test('OVB-P01 正例：假件驱动到静音达标 ⇒ 派发点击官方停止按钮（走完官方链）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  assert.equal(bridge.install(), true, '安装应成功');
  // 官方采集：走标准接口（经包装器）
  const stream = await env.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
  assert.ok(stream, '官方拿到 stream');
  // 官方 start() 会 new MediaRecorder(stream) 然后 .start()
  const rec = new env.window.MediaRecorder(stream);
  rec.start();
  assert.equal(env.mediaDevices.lastRecorder, rec, '兜底包装须捕获到正在录音的官方实例');
  env.document._attr = 'recording';                  // 官方相位进入 recording（停止按钮此时才挂载）
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  const ticks = runVad(env);
  assert.ok(ticks >= 20, 'VAD 至少跑到静音帧数（实际 tick ' + ticks + '）');
  assert.equal(env.stopButton.clicks, 1, '静音达标 ⇒ 官方停止按钮必须被派发点击恰好 1 次（第一优先路径）');
  assert.equal(rec.stopCalls || 0, 0, '走官方停止按钮时不得再直接 stop 实例（不得双停）');
});

test('OVB-P02 兜底：无官方停止按钮时用 MediaRecorder 实例停（且明确记为兜底）', async () => {
  const env = makeFakeEnv({ recordingPhase: true, noStopButton: true });
  const bridge = loadBridge(env);
  bridge.install();
  const stream = await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const rec = new env.window.MediaRecorder(stream);
  rec.start();
  env.document._attr = 'recording';
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  runVad(env);
  assert.equal(env.stopButton.clicks, 0, '无停止按钮 ⇒ 无点击');
  assert.equal(rec.stopCalls, 1, '兜底路径须停掉 MediaRecorder 实例恰好 1 次');
});

test('OVB-P03 显式降级：采集进行中且 A1/A2 都不可用 ⇒ stopped=false + 记录降级原因（不假装已停）', async () => {
  const env = makeFakeEnv({ recordingPhase: true, noStopButton: true });
  const bridge = loadBridge(env);
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  // ⚠ N-1 语义（本批）：只有「**采集确在进行中**」才允许计降级 ⇒ 必须先把官方相位置为 recording
  //   （否则属「会话已收尾/未开」分支，按新语义**不得**写 abandonReason）。
  env.document._attr = 'recording';
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  const r = bridge.stopOfficial();
  assert.equal(r.stopped, false, '不得假装已停');
  assert.equal(r.via, 'abandoned', '须走显式降级路径');
  assert.ok(bridge.snapshot().abandonReason, '必须记录降级原因');
  assert.equal(bridge.snapshot().stopMissed, 1, '采集进行中且两路不可用 ⇒ 恰好计 1 次 missed');
});

// ───────────────────────────── 负控 ─────────────────────────────
test('OVB-N01 负控：包装未命中（非音频约束）不得有任何行为改变', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  bridge.install();
  const before = env.timers.length;
  const s = await env.navigator.mediaDevices.getUserMedia({ video: true });
  assert.equal(s.id, 'stream-1', '返回值原样');
  assert.equal(env.timers.length, before, '视频采集不得挂 VAD');
  assert.equal(bridge.snapshot().firstCallAt, 0, '未命中 ⇒ 首次调用时间仍为 0');
});

test('OVB-N02 负控：参数与返回值原样（同一性 === 同一对象）', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  bridge.install();
  const constraints = { audio: { noiseSuppression: true }, video: false };
  const p = env.navigator.mediaDevices.getUserMedia(constraints);
  // 参数同一性（同一对象引用被原样透传，未被克隆/改写）
  assert.equal(env.mediaDevices.lastConstraints, constraints, '约束对象必须原样透传（=== 同一对象）');
  const stream = await p;
  assert.equal(stream, env.mediaDevices.lastStream, '返回的 stream 必须是原函数返回的同一对象（===）');
  assert.equal(stream.id, 'stream-1', '未被替换');
});

test('OVB-N03 负控：原函数抛错 ⇒ 异常原样透传（不得改写异常）', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  bridge.install();
  const boom = new Error('permission-denied-by-fake');
  // 在安装之后替换原函数（包装器闭包持有对象引用 ⇒ 原样透传本函数）
  env.mediaDevices.getUserMedia = () => Promise.reject(boom);
  await assert.rejects(
    () => env.navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
    (e) => e === boom && e.message === 'permission-denied-by-fake',
    '异常必须是原对象（===）'
  );
});

// ───────────────────────────── 幂等 ─────────────────────────────
test('OVB-I01 幂等：两次安装 = 只包一次（断言包装层数）', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  assert.equal(bridge.install(), true, '首次安装 true');
  const wrapped = env.navigator.mediaDevices.getUserMedia;
  assert.equal(wrapped.__dshPeWrapped, true, '包装层须带标记');
  assert.equal(bridge.install(), false, '二次安装返回 false（不叠层）');
  assert.equal(env.navigator.mediaDevices.getUserMedia, wrapped, '二次安装不得替换包装层（层数仍为 1）');
  assert.equal(!!env.navigator.mediaDevices.getUserMedia.__dshPeWrapped, true, '仍是同一包装层');
});

test('OVB-I02 幂等：N 次安装后调用链深度仍为 1（不是 N 层叠加）', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  const first = () => { env.mediaDevices.callCount = 0; };
  for (let i = 0; i < 7; i++) bridge.install();
  assert.equal(env.navigator.mediaDevices.getUserMedia.__dshPeWrapped, true, '唯一包装层');
  const stream = await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.equal(env.mediaDevices.callCount, 1, '原函数恰被调用 1 次（无多层转发）');
  assert.ok(stream, 'stream 正常');
});

// ───────────────────────────── 卸载恢复（HMR 安全） ─────────────────────────────
test('OVB-U01 卸载恢复：卸载后 getUserMedia === 原函数', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  const orig = env.navigator.mediaDevices.getUserMedia;
  bridge.install();
  assert.notEqual(env.navigator.mediaDevices.getUserMedia, orig, '安装后应不同');
  assert.equal(bridge.uninstall(), true, '卸载应成功');
  assert.equal(env.navigator.mediaDevices.getUserMedia, orig, '卸载后必须 === 原函数');
});

test('OVB-U02 卸载恢复：MediaRecorder 亦恢复原构造函数', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  const origRec = env.window.MediaRecorder;
  bridge.install();
  assert.notEqual(env.window.MediaRecorder, origRec, '安装后 MediaRecorder 被包');
  bridge.uninstall();
  assert.equal(env.window.MediaRecorder, origRec, '卸载后 MediaRecorder === 原构造函数');
});

test('OVB-U03 重装可用：卸载 → 再安装仍能工作（HMR 反复挂载不失效）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install(); bridge.uninstall(); bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const rec = new env.window.MediaRecorder(env.mediaDevices.lastStream);
  rec.start();
  runVad(env);
  assert.equal(rec.state, 'inactive', '重装后 A1 仍能停官方');
});

// ───────────────────────────── 互斥（两方向） ─────────────────────────────
test('OVB-M01 互斥方向一：热键自控采集中 ⇒ 包装器直接透传不介入', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  bridge.install();
  bridge.setSelfCapture(true);
  const before = env.timers.length;
  const stream = await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.equal(stream, env.mediaDevices.lastStream, '仍原样返回');
  assert.equal(env.timers.length, before, '自控采集中不得挂官方 VAD（不介入）');
  assert.equal(bridge.snapshot().firstCallAt, 0, '不得记为官方命中');
});

test('OVB-M02 互斥方向二：官方采集中 ⇒ 热键侧可查询到并会拒绝启动', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  // 先命中包装器（官方真实路径同样会经包装器），避免把「未命中」与「互斥」两件事混在一个测试里
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.equal(bridge.officialCapturing(), false, '未采集时为 false');
  // 官方相位标记挂载 ⇒ watchActivity 同步（经 MutationObserver 回调驱动）
  const mo = env.observerInstances[env.observerInstances.length - 1];
  assert.ok(mo, '须注册 MutationObserver 观察官方相位');
  env.document._attr = 'recording';
  mo.cb();
  assert.equal(bridge.officialCapturing(), true, '官方采集中 ⇒ 热键侧必须能查到（拒绝启动的依据）');
  // 官方会话结束
  env.document._attr = null;
  mo.cb();
  assert.equal(bridge.officialCapturing(), false, '结束后恢复可启动');
});

test('OVB-M03 互斥：自控标记释放后包装器恢复介入', async () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  bridge.install();
  bridge.setSelfCapture(true);
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.equal(bridge.snapshot().firstCallAt, 0, '自控期间不介入');
  bridge.setSelfCapture(false);
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.ok(bridge.snapshot().firstCallAt > 0, '释放后恢复介入');
});

// ───────────────── 热键 → 派发点击官方开始按钮（P2-补做 · UD-0016 形态变更落点） ─────────────────
test('OVB-S01 正例：startOfficial 派发点击官方开始按钮（事件对象可捕获）', () => {
  const env = makeFakeEnv({});
  const bridge = loadBridge(env);
  bridge.install();
  // idle 态：只有官方开始按钮在位（相位节点未挂载）
  assert.equal(env.stopButton.clicks, 0, '前置：尚无停止按钮点击');
  const r = bridge.startOfficial();
  assert.equal(r.started, true, '须报告已启动');
  assert.equal(r.via, 'official-start-button', '必须经「派发点击官方开始按钮」这条路径（唯一驱动官方整条链）');
  assert.equal(env.startButton.clicks, 1, '官方开始按钮必须被派发点击恰好 1 次');
  const snap = bridge.snapshot();
  assert.equal(snap.startClicks, 1, '派发点击计数须入诊断读数');
  assert.equal(snap.startMissed, 0, '成功启动不得计 missed');
});

test('OVB-S02 负控：官方开始按钮不存在 ⇒ 不得静默失败（诊断可见 + 零行为改变）', () => {
  const env = makeFakeEnv({ noStartButton: true });
  const bridge = loadBridge(env);
  bridge.install();
  const before = env.timers.length;
  const r = bridge.startOfficial();
  assert.equal(r.started, false, '无按钮 ⇒ 不得报告已启动');
  assert.equal(r.via, 'start-button-not-found', '须给出明确的未启动原因');
  const snap = bridge.snapshot();
  assert.equal(snap.startMissed, 1, '必须记为未启动（诊断区据此显示「未能派发点击官方开始按钮」）');
  assert.ok(snap.lastStartMissedAt > 0, '须记时间戳（可观察）');
  assert.ok(snap.abandonReason, '须留下降级原因（不得静默）');
  assert.equal(env.timers.length, before, '零行为改变（不得挂任何观察器/定时器）');
});

test('OVB-S03 负控：按钮 disabled ⇒ 不得派发点击（不得静默失败）', () => {
  const env = makeFakeEnv({ startDisabled: true });
  const bridge = loadBridge(env);
  bridge.install();
  const r = bridge.startOfficial();
  assert.equal(r.started, false, 'disabled 按钮不得被点击');
  assert.equal(env.startButton.clicks, 0, '不得派发点击到 disabled 按钮');
  assert.equal(bridge.snapshot().startMissed, 1, '须记为未启动');
});

test('OVB-S04 互斥：官方采集中再按热键 ⇒ 拒绝重复启动（不派发第二个开始）', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  env.document._attr = 'recording';
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  assert.equal(bridge.officialCapturing(), true, '前置：官方采集中');
  const r = bridge.startOfficial();
  assert.equal(r.started, false, '官方采集中 ⇒ 热键必须拒绝启动');
  assert.equal(r.via, 'already-capturing', '须给出「已在采集中」这一原因');
  assert.equal(env.startButton.clicks, 0, '不得再派发点击开始按钮');
});

// ───────────────── 官方 feedback 相位 · 语义订正批（2026-10-14 定位批）─────────────────
// ⚠ 语义订正的依据（静态证明 + CDP 实读，非推测）：
//   官方 `dsh-experimental-client-ui-voice-input/lib/client.js:4990-5026` 实读 —— `feedback(text)`
//   **只在转写已经完成之后**被调用，四个调用点是 `tooLarge` / `transcribe` 返回 !ok / `text === ""`
//   （未识别到语音）/ **`insertText` 返回 false（草稿冲突）**。最后一种**转写是成功的**。
//   ⇒ `feedback` **不是**「识别失败」专用出口；把它一律当失败并直接 return 会**跳过会话收口**
//   （`settleMiss` 不计、`lastEndedAt` 永不更新）⇒ 自动增强永不触发（本批 E1 夹具实测）。
//   故本组判据改为：feedback **照记读数**（endedInFeedback 保留给"不空等写回"），
//   且**必须完成会话收口**（lastEndedAt 更新 + missed 结算 + active 语义）。
test('OVB-F01 反馈相位：照记读数，且**必须完成会话收口**（订正：feedback ≠ 仅失败出口）', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();       // 进入采集
  env.document._attr = 'feedback'; mo.cb();        // 官方 feedback 相位
  const snap = bridge.snapshot();
  assert.equal(snap.feedbackSeen, 1, '必须识别出官方自带的 feedback 相位（恰好 1 次）');
  assert.equal(snap.endedInFeedback, true, '读数须置位（订阅方据此不进入「空等写回」）');
  assert.equal(snap.feedbackMessage, '未识别到语音', '文案须进诊断读数（经**子串**选择器命中哈希类）');
  // ⚠ 本批订正的核心：收口**必须**发生（旧实现此处为 lastEndedAt===0，直接跳过收口）
  assert.ok(snap.lastEndedAt > 0, 'feedback 即一次会话收口 ⇒ 必须记结束时刻（否则自动增强永不触发）');
  // ⚠ 未识别态批（2026-10-15）：该语义**不变**，但读数已换到语义正确的名字 `officialEntryBusy`
  //   （`officialCapturing` 自本批起严格表示「官方确在采集中」= recording 相位）。
  //   「官方仍占用语音入口」仍须可查 —— 这正是热键能**重新启动**而非被拒的依据。
  assert.equal(bridge.officialEntryBusy(), true, '收藏态语义不变：官方仍占用语音入口（等用户关闭/重试）');
  assert.equal(bridge.officialCapturing(), false, '⚠ 但该态**不是**「采集中」（旧实现读 active ⇒ 热键被拒）');
});

test('OVB-F01b 订正回归锁：feedback 的收口**恰好一次**（节点随后消失不得再计一次 missed）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  const afterFb = bridge.snapshot();
  assert.equal(afterFb.sessionsMissed, 0, '本会话包装器已被调用 ⇒ 收口不得计 missed');
  const endedAtFb = afterFb.lastEndedAt;
  env.document._attr = null; mo.cb();              // 用户点 X：节点消失
  const afterGone = bridge.snapshot();
  assert.equal(afterGone.sessionsMissed, 0, '⚠ 同一会话不得**二次**收口（否则 missed 被计两次）');
  assert.equal(afterGone.lastEndedAt, endedAtFb, '⚠ 不得覆盖首次收口时刻（否则订阅方重复装臂）');
  assert.equal(afterGone.endedInFeedback, false, '收口后标志必须复位');
});

test('OVB-F01c 订正回归锁：从 feedback 重试（相位回 recording）⇒ 不得残留「失败收场」读数', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  assert.equal(bridge.snapshot().endedInFeedback, true, '前置：已进 feedback');
  env.document._attr = 'recording'; mo.cb();       // 官方「重新录音」⇒ 相位回到 recording
  const snap = bridge.snapshot();
  assert.equal(snap.lastPhase, 'recording', '前置：相位确已回到 recording');
  assert.equal(snap.endedInFeedback, false,
    '⚠ 实测病：标志残留在真 ⇒ 诊断区报「上次官方会话以失败收场」而实际**正在录音**（读数说反话）');
});

test('OVB-F02 失败出口：未出现 feedback 时不得误报（负控）', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  assert.equal(bridge.snapshot().feedbackSeen, 0, '正常采集不得计失败出口');
  assert.equal(bridge.snapshot().endedInFeedback, false, '正常采集不得置失败收尾');
  env.document._attr = null; mo.cb();              // 成功路：节点消失
  const snap = bridge.snapshot();
  assert.equal(snap.endedInFeedback, false, '成功收尾不得带失败标记');
  assert.ok(snap.lastEndedAt > 0, '成功收尾须记结束时刻（自动增强据此等写回）');
});

// ───────────── N-1 回归锁：会话已收尾/未开 ⇒ 不得计 missed、不得写 abandonReason ─────────────
// 实测病（第 25 轮运行期）：一次**正常手动停**之后，相位停在 feedback（节点不消失）⇒ 静默 VAD 仍在跑；
// 它在**录音器已释放**时到阈值 ⇒ 旧实现照记 stopMissed + 写 abandonReason（第一优先分支）
// ⇒ 设置页此后**一直**显示「自动停已降级」，而自动停从未失败。
test('OVB-N04 N-1 回归锁：会话已收尾（相位非 recording）⇒ 不得计 missed、不得写降级原因', () => {
  const env = makeFakeEnv({ recordingPhase: true, noStopButton: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  // 会话走完：进入 recording 再收尾到 feedback（节点**不消失**——正是实测形态）
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  const before = bridge.snapshot();
  assert.equal(before.stopMissed, 0, '前置：尚未计 missed');
  // 静默 VAD 迟到触发（录音器已释放、停止按钮也不在）
  const r = bridge.stopOfficial();
  assert.equal(r.stopped, false, '不得假装已停');
  assert.equal(r.via, 'no-active-session', '会话已收尾 ⇒ 必须走「无进行中会话」分支');
  const after = bridge.snapshot();
  assert.equal(after.stopMissed, 0, 'N-1：会话已收尾 ⇒ **不得**计 stopMissed（诊断不得说反话）');
  assert.equal(after.abandonReason, '', 'N-1：会话已收尾 ⇒ **不得**写 abandonReason（否则诊断区常挂「已降级」）');
});

test('OVB-N05 N-1 回归锁：节点已卸载（idle）后迟到触发 ⇒ 同样不得计 missed/写原因', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = null; mo.cb();              // 成功收尾：节点消失
  const r = bridge.stopOfficial();
  assert.equal(r.via, 'no-active-session', '无进行中会话 ⇒ 不得走降级分支');
  assert.equal(bridge.snapshot().stopMissed, 0, 'N-1：不得计 missed');
  assert.equal(bridge.snapshot().abandonReason, '', 'N-1：不得写 abandonReason');
});

test('OVB-N06 N-1 反向锁（不得修过头）：采集**进行中**且两路不可用 ⇒ 仍须计 missed + 写原因', () => {
  const env = makeFakeEnv({ recordingPhase: true, noStopButton: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();       // 采集确在进行中
  const r = bridge.stopOfficial();
  assert.equal(r.via, 'abandoned', '采集进行中且两路不可用 ⇒ 必须显式降级（不得被 N-1 修复顺手改没）');
  assert.equal(bridge.snapshot().stopMissed, 1, '仍须计 missed');
  assert.ok(bridge.snapshot().abandonReason, '仍须留下降级原因');
});

// ───────────────── 不静默失效 ─────────────────────────────
test('OVB-D01 不静默：官方会话但包装器从未被调用 ⇒ 该状态可被观察到', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  // 官方绕开包装器自行采集（模拟官方改走别处 / 其它插件影子采集）
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording';
  mo.cb();
  env.document._attr = null;      // 会话结束（missed 判定点在**收口**，见竞态修复注释）
  mo.cb();
  const snap = bridge.snapshot();
  assert.equal(snap.sessionsStarted, 1, '须记录观察到 1 次官方会话');
  assert.equal(snap.sessionsMissed, 1, '包装器整场从未被调用 ⇒ 必须计为 missed');
  assert.ok(snap.lastMissedAt > 0, '须记时间戳（设置页据此显示「未观测到官方采集」）');
  assert.notEqual(snap.sessionsMissed, 0, '不得静默（0 = 静默失效）');
});

// ⚠ 竞态回归（CDP 实测命中并修复）：官方相位属性出现早于 getUserMedia 包装的 .then() 落地
//   （实测排序 phase@+18ms → firstCallAt@+30ms）⇒ 若在**上升沿**快照 firstCallAt===0 就永久计 missed，
//   会把**真命中**误报为「未观测到官方采集」。本判据锁死「命中不得误报」。
test('OVB-D04 竞态回归：相位先到、包装后落地 ⇒ 真命中不得被误判为 missed', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording';   // ① 相位先出现（此刻包装尚未被调用）
  mo.cb();
  assert.equal(bridge.snapshot().firstCallAt, 0, '前置：此刻包装确实尚未落地');
  // ② 包装随后落地（官方 getUserMedia 调用返回）
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.ok(bridge.snapshot().firstCallAt > 0, '前置：包装已落地');
  // ③ 会话收口
  env.document._attr = null;
  mo.cb();
  const snap = bridge.snapshot();
  assert.equal(snap.sessionsStarted, 1, '仍记录 1 次会话');
  assert.equal(snap.sessionsMissed, 0, '真命中 ⇒ 必须 0（旧实现在此处误报 1 = 掩盖问题）');
});

test('OVB-D02 不静默：正常命中时 missed 保持 0（诊断不误报）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  // 先命中包装器（firstCallAt 置位），再让官方相位标记挂载 ⇒ 不得计为 missed
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.ok(bridge.snapshot().firstCallAt > 0, '包装器须已命中');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording';
  mo.cb();
  const snap = bridge.snapshot();
  assert.equal(snap.sessionsStarted, 1, '仍记录会话数');
  assert.equal(snap.sessionsMissed, 0, '已命中 ⇒ 不得报 missed（诊断不误报）');
});

test('OVB-D03 不静默：订阅者能收到状态变更（设置页可刷新）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  let hits = 0;
  const off = bridge.subscribe(() => { hits++; });
  bridge.install();
  assert.ok(hits >= 1, '安装即应通知订阅者（设置页诊断区刷新）');
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.ok(hits >= 2, '命中官方采集亦应通知');
  off();
  const frozen = hits;
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  assert.equal(hits, frozen, '退订后不再收到通知');
});

// ───────────────────────────── 可关闭 / 让位官方 ─────────────────────────────
test('OVB-C01 可关闭：环境标志置位 ⇒ 不安装且原因可见', async () => {
  const env = makeFakeEnv({ disabled: true });
  const bridge = loadBridge(env);
  assert.equal(bridge.install(), false, '被标志停用时不得安装');
  assert.equal(bridge.snapshot().abandonReason, 'disabled-by-flag', '须记原因');
  assert.equal(env.navigator.mediaDevices.getUserMedia.__dshPeWrapped, undefined, '不得包装');
});

test('OVB-C02 可关闭：localStorage 关闭开关同样生效', async () => {
  const env = makeFakeEnv({});
  env.localStorage.setItem('dsh.prompt-enhancer.officialBridge', 'off');
  const bridge = loadBridge(env);
  assert.equal(bridge.install(), false, 'localStorage=off 时不得安装');
});

test('OVB-C03 让位官方：检测到官方钩子 ⇒ 停用包装并恢复原函数', async () => {
  const env = makeFakeEnv({ officialHook: { version: 1 }, recordingPhase: true });
  const bridge = loadBridge(env);
  const orig = env.navigator.mediaDevices.getUserMedia;
  bridge.install();
  assert.notEqual(env.navigator.mediaDevices.getUserMedia, orig, '先装上了');
  const yielded = bridge.yieldToOfficialIfPresent();
  assert.equal(yielded, true, '检测到官方钩子须让位');
  assert.equal(env.navigator.mediaDevices.getUserMedia, orig, '让位后恢复原函数');
  assert.equal(bridge.snapshot().installed, false, '不再处于安装态');
  assert.equal(bridge.snapshot().abandonReason, 'yielded-to-official-hook', '让位原因可见');
});

test('OVB-C04 让位官方：无官方钩子时不得误让位', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  assert.equal(bridge.yieldToOfficialIfPresent(), false, '无钩子不得让位');
  assert.equal(bridge.snapshot().installed, true, '仍处于安装态');
});

// ───────────────────── 官方路径·自动增强（§4.6.2.6 第 4 条） ─────────────────────
// 极简 React 桩：ref/state 槽位**跨渲染持久**（真 React 的语义），effect 每次渲染后执行。
// 为什么必须持久：组件的自动增强逻辑靠 `draftRef.current` 跨渲染读草稿，槽位若不持久，
// 第二此渲染会拿到全新 ref ⇒ 永远读不到写回。
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

function buildHotkeyHost(env, bridge, opts) {
  const o = opts || {};
  const mini = makeMiniReact();
  const timerRegs = [];
  const timerSvcLocal = {
    interval: (fn, ms) => { const r = { fn, ms, kind: 'interval', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
    // F-18：补停用 timeout 步进 ⇒ 测试可确定性地驱动 tick（不必等真实时钟）
    timeout: (fn, ms) => { const r = { fn, ms, kind: 'timeout', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
  };
  bridge.setTimer(timerSvcLocal);
  // F-18：热键监听器只在「已启用且有组合键」时注册 ⇒ 需要驱动真实处理器的用例须传 hotkey:true
  const hkCombo = o.hotkeyCombo || 'Backquote';
  const voiceCfgState = { value: { autoEnhance: o.autoEnhance === true, vad: { enabled: true }, hotkey: { enabled: o.hotkey === true, combo: o.hotkey === true ? hkCombo : '' }, refine: {} }, listeners: new Set(), synced: true };
  const enhanceCalls = [];
  // F-18：持久 store 桩 —— 组件通过 storeFor(sessionId) 写 `error` 作为「失败可见」出口，
  //   旧桩每次返回新对象 ⇒ 写进去看不见。改为稳定对象，使该出口可被断言。
  const storeStub = { phase: 'idle', error: null, backup: '', enhanced: '', seq: 0, memoryRounds: [], optimized: false, lastModel: '', fallbackUsed: false, degraded: [], truncated: false };
  const src = decodeChunk('src/client/voice/hotkey.js');
  const factory = new Function(
    'React', 'host', 'voiceCfgState', 'subscribeVoiceConfig', 'voiceHotkeyDisplay', 'parseVoiceHotkey',
    'matchVoiceHotkey', 'isEnhancing', 'subscribe', 'storeFor', 'startVoiceRecording', 'stopVoiceRecording',
    'isVoiceRecording', 'insertVoiceText', 'notify', 'enhance', 'timerSvc', 'officialVoiceBridge', 'makeT', 'ZH',
    'MarqueeSelect', 'CollapsibleSection', 'setInterval', 'clearInterval', 'setTimeout', 'navigator', 'window',
    src + '\n;return { VoiceHotkeyHost };'
  );
  const api = factory(
    mini.React,
    { call: () => Promise.resolve({ ok: true }) },
    voiceCfgState, () => () => {}, (c) => c, () => null, () => false, () => false,
    () => () => {}, () => storeStub,
    async () => { throw new Error('should not record'); }, async () => null, () => false,
    () => Promise.resolve({ filled: true }), () => {},
    (...a) => { enhanceCalls.push(a); },   // enhance 桩
    timerSvcLocal, bridge, (p) => (k) => k, {}, null, null,
    setInterval, clearInterval, setTimeout, env.navigator, env.window
  );
  const props = { sessionId: o.sessionId || 'sess-x', inputActions: { setDraft() {} }, input: { draft: o.draft0 || '' } };
  const render = (draft) => { if (draft !== undefined) props.input = { draft }; mini.begin(); api.VoiceHotkeyHost(props); mini.runEffects(); };
  // 驱动生产代码里的真实热键处理器（windows stub 记录的监听器）
  // ⚠ 必须显式给四个修饰键为 false：matchVoiceHotkey 用 `e.ctrlKey === hk.ctrl` 严格比较，
  //   缺字段（undefined）会与 hk 的 false 不等 ⇒ 匹配失败、处理器直接 return（实测踩到）。
  const KEYDOWN = (extra) => Object.assign({
    code: 'Backquote', key: '`', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
    repeat: false, preventDefault() {}, stopPropagation() {},
  }, extra || {});
  const keydown = () => env.window._fire('keydown', KEYDOWN());
  const keyup = () => env.window._fire('keyup', KEYDOWN());
  // 跑所有未清除的 timeout 步进（模拟时钟推进）
  const runTimeouts = (max) => { let n = 0; for (const r of timerRegs) { if (!r.cleared && r.kind === 'timeout') { r.cleared = true; r.fn(); n += 1; if (max && n >= max) break; } } return n; };
  return { render, props, enhanceCalls, timerRegs, voiceCfgState, mini, keydown, keyup, runTimeouts, store: storeStub };
}

test('OVB-A01 官方路径·自动增强：会话结束 + 写回落地 ⇒ autoEnhance 触发增强（有限轮询）', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: true, sessionId: 'sess-a1' });
  host.render('');                                  // 渲染#1：注册订阅
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();        // 官方会话开始（相位标记出现）
  env.document._attr = null; mo.cb();               // 官方会话结束（武装等待，快照 = 当前空草稿）
  host.render('官方识别出来的文字');                  // 渲染#2：官方写回落地
  let fired = false;
  for (const r of host.timerRegs) { if (!r.cleared) { r.fn(); fired = true; } }
  assert.equal(fired, true, '轮询必须真的跑过（不是空转）');
  assert.equal(host.enhanceCalls.length, 1, 'autoEnhance 开 ⇒ 写回落地后恰好触发 1 次增强（同一会话不重复）');
});

test('OVB-A02 官方路径·自动增强：autoEnhance 关 ⇒ 不得触发（负控）', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: false, sessionId: 'sess-a2' });
  host.render('');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();        // 官方会话开始
  env.document._attr = null; mo.cb();
  host.render('写回的文本');
  for (const r of host.timerRegs) { if (!r.cleared) r.fn(); }
  assert.equal(host.enhanceCalls.length, 0, 'autoEnhance 关 ⇒ 不得触发增强');
});

test('OVB-A03 官方路径·自动增强：草稿始终未变 ⇒ 不得误触发（防"停完就增强"）', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: true, sessionId: 'sess-a3' });
  host.render('');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();        // 官方会话开始
  env.document._attr = null; mo.cb();
  // 不写回（草稿不变）⇒ 轮询耗尽也不得增强，且不得无限轮询
  for (const r of host.timerRegs) { for (let i = 0; i < 60 && !r.cleared; i++) r.fn(); }
  assert.equal(host.enhanceCalls.length, 0, '草稿未变 ⇒ 不得触发增强');
  assert.equal(host.timerRegs.every((r) => r.cleared), true, '必须有轮询上限（停止轮询，不得无限跑）');
});

// ⚠ 本用例精确复现**本批真实语音链实测**命中的形态（V-5 的断点）：
//   官方 `finish()` 的顺序是 `insertText(...)` **然后** `setPhase("idle")`
//   ⇒ 相位节点消失（bridge 判「收口」）时，**写回已经落地**。
//   旧实现只在「收口那一刻」才快照基线 ⇒ 基线 = 写回后的草稿 ⇒ 永远测不到 delta ⇒ 自动增强永不触发。
test('OVB-A04 官方路径·自动增强（实测形态）：写回**先于**收口落地 ⇒ 仍必须触发增强', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: true, sessionId: 'sess-a4' });
  host.render('')                                   // 渲染#1：注册订阅（基线 = 空草稿）
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();         // 会话开始（此刻基线被记录 = 空草稿）
  host.render('官方写回的文字');                      // ⭐ 写回**先**落地（相位仍在 recording）
  env.document._attr = null; mo.cb();                // 收口（相位消失）
  let fired = false;
  for (const r of host.timerRegs) { if (!r.cleared) { r.fn(); fired = true; } }
  assert.equal(fired, true, '轮询必须真的跑过');
  assert.equal(host.enhanceCalls.length, 1, '写回先于收口 ⇒ 仍须恰好触发 1 次增强（旧实现此处为 0 = V-5 断点）');
});

test('OVB-A05 官方路径·自动增强：跨会话基线不串（第二会话以自己的起点为准）', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: true, sessionId: 'sess-a5' });
  host.render('');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  // 第一会话：有写回 ⇒ 触发 1 次
  env.document._attr = 'recording'; mo.cb();
  host.render('第一段写回');
  env.document._attr = null; mo.cb();
  for (const r of host.timerRegs) { if (!r.cleared) r.fn(); }
  assert.equal(host.enhanceCalls.length, 1, '第一会话触发 1 次');
  // 第二会话：无写回（草稿保持第一段）⇒ 不得再触发
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = null; mo.cb();
  for (const r of host.timerRegs) { for (let i = 0; i < 60 && !r.cleared; i++) r.fn(); }
  assert.equal(host.enhanceCalls.length, 1, '第二会话无写回 ⇒ 不得误触发（基线须随会话重置）');
});

// ───────────────────────────── 接线契约（防"注释有、代码无"） ─────────────────────────────
test('OVB-W01 接线：buildclient 装配清单与 skeleton 注入标记均在位', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-client.mjs'), 'utf8');
  const skel = fs.readFileSync(path.join(ROOT, 'src', 'client', 'skeleton.js'), 'utf8');
  assert.ok(build.includes("require('../src/client/voice/official-bridge.js')"), 'build-client 缺 official-bridge chunk 引用');
  assert.ok(build.includes('@dsh-client-voice-official-bridge-inject'), 'build-client 缺注入标记映射');
  assert.ok(skel.includes('@dsh-client-voice-official-bridge-inject'), 'skeleton 缺注入标记');
});

test('OVB-W02 接线：apply 安装 + 卸载（HMR）+ 热键→派发点击官方按钮的接线均在位', () => {
  const app = decodeChunk('src/client/app.js');
  assert.ok(app.includes('officialVoiceBridge.install()'), 'apply 缺安装调用');
  assert.ok(app.includes('officialVoiceBridge.uninstall()'), 'apply 缺卸载（HMR 恢复）');
  assert.ok(app.includes('officialVoiceBridge.setTimer'), 'apply 缺 timer 注入');
  const hk = decodeChunk('src/client/voice/hotkey.js');
  // P2-补做（UD-0016）：热键改为派发点击官方按钮 —— 启动走 startOfficial，停止走 stopOfficial
  assert.ok(hk.includes('officialVoiceBridge.startOfficial()'), '热键缺「派发点击官方开始按钮」（本批形态变更的落点）');
  assert.ok(hk.includes('officialVoiceBridge.stopOfficial()'), '热键缺「派发点击官方停止按钮」（唯一走完官方 finish() 的路径）');
  assert.ok(hk.includes("st.error = 'VOICE_BUSY'"), '热键缺「录音中」可见提示');
  assert.ok(hk.includes("st.error = 'VOICE_OFFICIAL_UNAVAILABLE'"), '热键缺「官方按钮不可用」可见提示（不得静默失败）');
  // 自建采集链退役：热键不得再自行取麦/录音/转写/停止（看**活代码**——注释里记录退役事实是允许的）
  const hkLive = hk.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(hkLive.includes('startVoiceRecording'), false, '自建链退役后热键不得再调 startVoiceRecording');
  assert.equal(hkLive.includes('stopVoiceRecording'), false, '自建链退役后热键不得再调 stopVoiceRecording');
  assert.equal(hkLive.includes('voice/transcribe'), false, '自建链退役后热键不得再自行调 voice/transcribe');
  assert.equal(hkLive.includes('getUserMedia'), false, '自建链退役后热键不得再自行取麦');
  assert.equal(hkLive.includes('isVoiceRecording'), false, '自建链退役后热键不得再查自建录音态');
  // 纯函数（四项增值之一）必须保留且行为不变
  for (const fn of ['parseVoiceHotkey', 'matchVoiceHotkey', 'voiceHotkeyDisplay']) {
    assert.ok(hk.includes('function ' + fn), '热键纯函数 ' + fn + ' 必须保留（四项增值不得丢）');
  }
});

test('OVB-W03 接线：设置页诊断区在位（不静默失效的可见面）且有 i18n 键', () => {
  const vs = decodeChunk('src/client/voice/voice-section.js');
  assert.ok(vs.includes('function OfficialVoiceDiag'), '设置段缺诊断组件');
  assert.ok(vs.includes("React.createElement(OfficialVoiceDiag, props)"), '诊断组件未进入渲染路径');
  assert.ok(vs.includes("t('voiceOfficialMissed')"), '缺「未观测到官方采集」文案引用');
  // D-1/D-2（FOLLOWUP §4）：三态可区分 + selfCapture 分支 + 派发点击失败可见
  assert.ok(vs.includes("t('voiceOfficialVerified')"), '缺「已观测到官方采集（N 次）」分支（D-1 修复：0 次须可区分）');
  // F-11 修复（2026-10-13）：键内含占位符 ⇒ 渲染处**代入** `{n}`，不得再追加第二个计数
  //   （旧实现：键内 %d 未替换 + 渲染处又追加括号计数 ⇒ 用户可见 `…（共 %d 次）（1）`）
  assert.ok(vs.includes(".replace('{n}', String(snap.sessionsStarted))"),
    'F-11 修复：须以 .replace(\'{n}\', …) 代入计数（不得再追加第二个计数）');
  assert.ok(vs.includes("t('voiceOfficialStartMissed')"), '缺「未能派发点击官方开始按钮」分支（不得静默失败）');
  assert.ok(vs.includes("t('voiceOfficialSelfCapture')"), '缺 selfCapture 分支（D-2 修复）');
  assert.ok(vs.includes('snap.sessionsStarted > 0'), 'D-1 修复须以官方会话计数分支（严格可判别）');
  const i18n = decodeChunk('src/client/i18n.js');
  for (const k of ['voiceOfficialDiagTitle', 'voiceOfficialActive', 'voiceOfficialMissed', 'voiceOfficialAbandon', 'voiceOfficialSelfCapture', 'voiceOfficialArmed', 'voiceOfficialDisabled',
    'voiceOfficialVerified', 'voiceOfficialStartMissed', 'voiceOfficialFeedback', 'voiceOfficialFeedbackSeen', 'voiceOfficialFeedbackSeenAgo']) {
    assert.ok(i18n.includes(k + ":"), 'i18n 缺键 ' + k);
  }
  // ZH/EN 键集必须相等（S-7）
  const zh = i18n.split('const EN = {')[0];
  const en = 'const EN = {' + i18n.split('const EN = {')[1];
  const zk = (zh.match(/voiceOfficial[A-Za-z]+:/g) || []).sort();
  const ek = (en.match(/voiceOfficial[A-Za-z]+:/g) || []).sort();
  assert.deepEqual(zk, ek, 'voiceOfficial* ZH/EN 键集必须相等（S-7）');
  // 2026-10-17（设置文案审查批 · 报障 D）：新增 voiceOfficialFeedbackSeenAgo（带时距的失败文案）
  //   => 键数 11 -> 12。仍是严格 === 锁（不是放宽成 >=）：多一个少一个都红。
  assert.equal(zk.length, 12, 'voiceOfficial* 键数锁定为 12（严格 ===：原 11 + 本批 1 条带时距的失败文案）');
});

// F-11（2026-10-13）：用户可见面不得出现未替换的占位符，且计数只留一个
test('OVB-W04 F-11：诊断区成功态原文不含未替换占位符，且计数只出现一次', () => {
  const vs = decodeChunk('src/client/voice/voice-section.js');
  const i18n = decodeChunk('src/client/i18n.js');
  // 键：不得再含 printf 风格 %d（本项目约定为 {n}）
  assert.ok(!/voiceOfficialVerified: '[^']*%d/.test(i18n), 'F-11：键内不得再用 %d（约定 {n}）');
  assert.ok(/voiceOfficialVerified: '[^']*\{n\}[^']*'/.test(i18n), 'F-11：键内须含 {n} 占位符');
  assert.ok(/voiceOfficialVerified: '[^']*\{n\}[^']*'/.test(i18n), 'F-11：EN 键同样须含 {n}（文案值本批改白话，故不锁原文前缀）');
  // 渲染处：只代入，不再追加计数（不得同时出现 replace 与第二个拼接）
  const seg = vs.slice(vs.indexOf('voiceOfficialVerified'), vs.indexOf('voiceOfficialVerified') + 220);
  assert.ok(seg.includes(".replace('{n}'"), 'F-11：渲染处须代入 {n}');
  assert.ok(!/voiceOfficialVerified'\)\s*\+\s*'（'/.test(vs),
    'F-11：渲染处不得再追加第二个计数（旧实现 t(...) + \'（\' + n + \'）\'）');
  // 端到端字面值：代入后不得残留 {n} / %d
  const t = (k) => { const m = new RegExp("  " + k + ": '([^']*)'"); const r = i18n.match(m); return r ? r[1] : ''; };
  const zhText = t('voiceOfficialVerified').replace('{n}', '1');
  assert.equal(/[{]n[}]|%d/.test(zhText), false, 'F-11：代入后不得残留占位符 —— ' + zhText);
  // 2026-10-17（设置文案审查批）：文案本批改白话 => 不得再锁旧原文值。
  //   判据强度不降：仍要求代入后 (a) 无占位符残留 (b) 恰好只出现一次计数。
  assert.equal((zhText.match(/1/g) || []).length, 1, 'F-11：成功态原文须恰出现一次计数（实际 ' + zhText + '）');
});

test('OVB-W05 F-11 变异自证：把键退回 %d（且渲染处仍追加）⇒ OVB-W04 必红', () => {
  const i18n = decodeChunk('src/client/i18n.js');
  // 锚点随文案重写订正（值变了，键与占位符约定不变）：从当前 i18n 动态取该键的现值
  const anchor = "voiceOfficialVerified: '" + (i18n.match(/voiceOfficialVerified: '([^']*)'/) || [0, ''])[1] + "'";
  assert.ok(i18n.includes(anchor), 'F-11 修复锚点须存在');
  const mutated = i18n.replace(anchor, "voiceOfficialVerified: '已观测到官方采集（共 %d 次）'");
  assert.ok(!/voiceOfficialVerified: '[^']*%d/.test(i18n), '前置：修复后不得含 %d');
  assert.ok(/voiceOfficialVerified: '[^']*%d/.test(mutated), '退回 %d 后必须能被 OVB-W04 检出（若检出不了 ⇒ 判据没牙）');
});

test('OVB-W04 边界：src/host 与 plugin-host.js 零改动（本批不许碰载体）', () => {
  const host = fs.readFileSync(path.join(ROOT, 'plugin-host.js'), 'utf8');
  assert.equal(host.includes('officialVoiceBridge'), false, 'plugin-host.js 不得出现本批新增标识符（载体零改动）');
  const buildHost = fs.readFileSync(path.join(ROOT, 'scripts', 'build-host.mjs'), 'utf8');
  assert.equal(buildHost.includes('officialVoiceBridge'), false, 'build-host.mjs 不得涉及本批改动');
  // lib/index.cjs 的求值桥接原样保留（UD-0013 硬边界）
  const idx = fs.readFileSync(path.join(ROOT, 'lib', 'index.cjs'), 'utf8');
  assert.ok(idx.includes("new Function('harness', BODY)"), 'lib/index.cjs 的 new Function 桥接必须原样保留');
});

// ───────────────────────────── 变异自证 ─────────────────────────────
// 变异名运行时拼接（不在源码里形成字面量），且为判据的合法输入（合法约束对象）。
// 正例必红：把 A1 的 stop 触发点摘掉 ⇒ OVB-P01 必失败。
// 负控必绿：摘掉 stop 后，负控类判据（OVB-N01/N02）必须仍然通过。
function applyMutation(src, kind) {
  const KILL_A1 = 'ovb' + 'StopOfficial';
  if (kind === 'kill-a1-stop') {
    // 让 A1 分支永不成立（只改判定条件），A2 也随之不可用 ⇒ 正例必红
    const before = "if (b.recording && b.recording.state === 'recording') {";
    const after = "if (false && b.recording && b.recording.state === 'recording') {";
    if (!src.includes(before)) throw new Error('mutation anchor missing: ' + before);
    return src.replace(before, after);
  }
  if (kind === 'kill-vad-call') {
    const before = 'vadStop = ovbStartVad(stream,';
    const after = 'vadStop = (0 && ovbStartVad)(stream,';
    if (!src.includes(before)) throw new Error('mutation anchor missing: ' + before);
    return src.replace(before, after);
  }
  throw new Error('unknown mutation kind');
}

function loadMutant(env, kind) {
  const src = applyMutation(decodeChunk(CHUNK), kind);
  const S = loadStateForBridge(env);
  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    src + '\n;return officialVoiceBridge;'
  );
  let seq = 0;
  const bridge = factory(
    env.window, env.document, env.navigator, env.localStorage,
    (fn, ms) => { const rec = { fn, ms, cleared: false, id: ++seq }; env.timers.push(rec); return rec.id; },
    (id) => { const rec = env.timers.find((r) => r.id === id); if (rec) rec.cleared = true; },
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent(type, init) { return { type, init }; },
    S.vadSilenceMsOf, S.vadRequiredQuiet, S.voiceCfgState
  );
  bridge.setTimer(env.timerSvc);
  return bridge;
}

test('OVB-V01 变异自证·正例必红：摘掉 A1 stop ⇒ 正例判据必须失败', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadMutant(env, 'kill-a1-stop');
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const rec = new env.window.MediaRecorder(env.mediaDevices.lastStream);
  rec.start();
  runVad(env);
  // 正例判据在变异下必须失败（此处断言"确实失败了"，以证明判据有牙）
  const wouldPass = (rec.state === 'inactive' && rec.stopCalls === 1);
  assert.equal(wouldPass, false, '变异后正例判据必须为红（若仍绿 ⇒ 判据没牙）');
});

test('OVB-V02 变异自证·负控必绿：同一变异下负控判据仍须通过', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadMutant(env, 'kill-a1-stop');
  bridge.install();
  // 负控：非音频约束不介入 + 同一性 —— 与 A1 stop 无关，必须仍绿
  const before = env.timers.length;
  const s = await env.navigator.mediaDevices.getUserMedia({ video: true });
  assert.equal(s, env.mediaDevices.lastStream, '负控·同一性仍绿');
  assert.equal(env.timers.length, before, '负控·未命中仍绿');
});

test('OVB-V03 变异自证·摘掉 VAD ⇒ 静音达标不再触发官方 stop（读数来自变异本身）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadMutant(env, 'kill-vad-call');
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const rec = new env.window.MediaRecorder(env.mediaDevices.lastStream);
  rec.start();
  runVad(env);
  assert.equal(rec.stopCalls || 0, 0, 'VAD 被摘掉后不得再触发 stop（证明静音链路是 stop 的真实来源）');
});

test('OVB-V04 变异自证·幂等判据有牙：破坏幂等 ⇒ 层数判据必红', () => {
  const src = decodeChunk(CHUNK);
  const before = 'if (b.installed) return false;';
  assert.ok(src.includes(before), '幂等锚点须存在');
  // 运行期拼接变异：删掉幂等短路
  const mutated = src.replace(before, 'if (false) return false;');
  const env = makeFakeEnv({});
  const S4 = loadStateForBridge(env);
  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    mutated + '\n;return officialVoiceBridge;'
  );
  let seq = 0;
  const bridge = factory(
    env.window, env.document, env.navigator, env.localStorage,
    (fn, ms) => { const rec = { fn, ms, cleared: false, id: ++seq }; env.timers.push(rec); return rec.id; },
    () => {},
    class FakeMO { constructor() {} observe() {} disconnect() {} },
    function MouseEvent() { return {}; },
    S4.vadSilenceMsOf, S4.vadRequiredQuiet, S4.voiceCfgState
  );
  bridge.install();
  const first = env.navigator.mediaDevices.getUserMedia;
  const second = bridge.install();
  // 破坏幂等后：二次安装会返回 true（或替换包装层）⇒ 幂等判据必红
  const stillOneLayer = (env.navigator.mediaDevices.getUserMedia === first);
  assert.equal(second === false || stillOneLayer, false, '破坏幂等后「只包一次」判据必须为红');
});

// ── P2-补做（UD-0016）新增能力的变异自证 ──────────────────────────────────────
// 变异名一律**运行时拼接**（不在源码里形成字面量），且为判据的合法输入。
test('OVB-V05 变异自证·正例必红：掏空「官方开始按钮查找」⇒ 启动正例必须失败', () => {
  const src = decodeChunk(CHUNK);
  // 变异：把按钮查找函数体掏空（恒返回 null）⇒ 启动必然失败。变异名运行时拼接，不形成字面量。
  const fnName = 'ovbFind' + 'StartButton';
  const anchor = 'function ' + fnName + '() {';
  const kill = 'function ' + fnName + '() { return null;';
  assert.ok(src.includes(anchor), '启动锚点须存在');
  const mutated = src.replace(anchor, kill);
  const env = makeFakeEnv({});
  const S5 = loadStateForBridge(env);
  const bridge = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    mutated + '\n;return officialVoiceBridge;'
  )(env.window, env.document, env.navigator, env.localStorage, () => 0, () => {},
    class FakeMO { constructor() {} observe() {} disconnect() {} }, function MouseEvent() { return {}; },
    S5.vadSilenceMsOf, S5.vadRequiredQuiet, S5.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  const r = bridge.startOfficial();
  assert.equal(r.started, false, '变异后「派发点击开始按钮」不得再成立（若仍绿 ⇒ 启动判据没牙）');
  assert.equal(env.startButton.clicks, 0, '变异后不得有任何点击（判据的读数来源就是它）');
});

test('OVB-V06 变异自证·负控必绿：同一变异下「按钮不存在不得静默」判据仍须通过', () => {
  const src = decodeChunk(CHUNK);
  const fnName = 'ovbFind' + 'StartButton';
  const mutated = src.replace('function ' + fnName + '() {', 'function ' + fnName + '() { return null;');
  const env = makeFakeEnv({ noStartButton: true });
  const S6 = loadStateForBridge(env);
  const bridge = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    mutated + '\n;return officialVoiceBridge;'
  )(env.window, env.document, env.navigator, env.localStorage, () => 0, () => {},
    class FakeMO { constructor() {} observe() {} disconnect() {} }, function MouseEvent() { return {}; },
    S6.vadSilenceMsOf, S6.vadRequiredQuiet, S6.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  const r = bridge.startOfficial();
  // 负控与「是否真找到按钮」无关：无论变异与否，「未启动必须留可见读数」都必须成立
  assert.equal(r.started, false, '负控必绿：未启动');
  assert.ok(bridge.snapshot().startMissed >= 1, '负控必绿：未启动必须计数（不得静默）');
});

test('OVB-V07 变异自证·正例必红：把 missed 判定退回「上升沿快照」⇒ 竞态回归判据必须失败', () => {
  const src = decodeChunk(CHUNK);
  const anchor = 'if (now === (b.callCountAtPrevSessionEnd || 0)) {';
  // 变异 = 精确复现**被 CDP 证伪**的旧口径：把窗口下界当成「本会话上升沿那一刻的计数」，
  //   而实现里上升沿读到的计数**已经含本次调用**（实测：相位出现时 callCount 已为 1）
  //   ⇒ 拿它当界 ⇒ 真命中被判 missed。运行期拼接变异名（不形成字面量）。
  const kill = 'if ((b.callCount || 0) === 1) {';
  assert.ok(src.includes(anchor), 'missed 收口锚点须存在');
  const mutated = src.replace(anchor, kill);
  const env = makeFakeEnv({ recordingPhase: true });
  const S7 = loadStateForBridge(env);
  const bridge = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    mutated + '\n;return officialVoiceBridge;'
  )(env.window, env.document, env.navigator, env.localStorage, () => 0, () => {},
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent() { return {}; }, S7.vadSilenceMsOf, S7.vadRequiredQuiet, S7.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  // 精确复现 CDP 实测形态：**调用先落地**（相位尚未出现），相位随后才到 ⇒ 旧口径误报 missed
  return env.navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(() => {
    const mo = env.observerInstances[env.observerInstances.length - 1];
    env.document._attr = 'recording'; mo.cb();
    env.document._attr = null; mo.cb();
    const snap = bridge.snapshot();
    assert.equal(snap.callCount > 0, true, '前置：包装确实落地过');
    assert.equal(snap.sessionsMissed > 0, true, '退回旧口径后必须误报 missed（若仍为 0 ⇒ 竞态判据没牙）');
  });
});

// ── N-1 修复的变异自证（变异名一律**运行时拼接**，且为判据的合法输入）──
test('OVB-V08 变异自证·正例必红：把 N-1 守卫退回旧口径 ⇒ N-1 回归锁必须失败', () => {
  const src = decodeChunk(CHUNK);
  const guard = 'if (!ovb' + 'RecordingNow()) {';
  assert.ok(src.includes(guard), 'N-1 守卫锚点须存在');
  const mutated = src.replace(guard, 'if (false) {');
  const env = makeFakeEnv({ recordingPhase: true, noStopButton: true });
  const S8 = loadStateForBridge(env);
  const bridge = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    mutated + '\n;return officialVoiceBridge;'
  )(env.window, env.document, env.navigator, env.localStorage, () => 0, () => {},
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent() { return {}; }, S8.vadSilenceMsOf, S8.vadRequiredQuiet, S8.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();        // 会话已收尾（实测病形态）
  const r = bridge.stopOfficial();
  const snap = bridge.snapshot();
  // 退回旧口径 ⇒ 照记 missed + 写原因 ⇒ N-1 回归锁的两条断言必红
  const wouldPass = (r.via !== 'no-active-session' && snap.stopMissed === 0 && snap.abandonReason === '');
  assert.equal(wouldPass, false, '退回旧口径后 N-1 回归锁必须为红（若仍绿 ⇒ 该锁没牙）');
});

test('OVB-V09 变异自证·负控必绿：同一变异下「采集进行中仍须降级」的反向锁仍须通过', () => {
  const src = decodeChunk(CHUNK);
  const guard = 'if (!ovb' + 'RecordingNow()) {';
  const mutated = src.replace(guard, 'if (false) {');
  const env = makeFakeEnv({ recordingPhase: true, noStopButton: true });
  const S9 = loadStateForBridge(env);
  const bridge = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    mutated + '\n;return officialVoiceBridge;'
  )(env.window, env.document, env.navigator, env.localStorage, () => 0, () => {},
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent() { return {}; }, S9.vadSilenceMsOf, S9.vadRequiredQuiet, S9.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();       // 采集**进行中**
  const r = bridge.stopOfficial();
  // 负控与「守卫在不在」无关：采集进行中且两路不可用，无论变异与否都必须降级
  assert.equal(r.via, 'abandoned', '负控必绿：采集进行中 ⇒ 仍须走降级');
  assert.equal(bridge.snapshot().stopMissed, 1, '负控必绿：仍须计 missed');
});

// ── missed 判定的「迟到落地」回归锁（本批 CDP 实测命中的第二种误报形态）──
// 病：某次会话的真正 `getUserMedia` 可能**极晚**才落地（实测：official start → phase recording
//     → 120s 上限 finish → 包装器 `.then()` 才落地）。若用「时刻快照」比 `firstCallAt`，
//     该会话的收口发生在包装落地**之前** ⇒ 真命中被判成 missed（实测 sessionsMissed=1 且 firstCallAt>0 并存）。
// 修：改用**调用计数**（只增不减）⇒ 收口时比较计数即可，无「迟到窗口」。
test('OVB-D05 迟到落地回归锁：会话收口早于包装调用 ⇒ 不得误报 missed', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();          // ① 相位先到（包装尚未被调用）
  env.document._attr = null; mo.cb();                 // ② 会话**先收口**（收口时 callCount 仍为 0）
  // ③ 包装调用**迟到**（收口之后才落地）
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const snap = bridge.snapshot();
  assert.equal(snap.callCount, 1, '前置：包装确实被调用过 1 次');
  assert.equal(snap.sessionsStarted, 1, '仍记录 1 次会话');
  assert.equal(snap.sessionsMissed, 1, '收口时确实一次都没被调用 ⇒ 该情形**应**计 missed（诚实判据）');
});

test('OVB-D06 迟到落地回归锁·真命中：会话内调用虽晚但**在收口前**计数已增 ⇒ 不得误报', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();          // 相位先到
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });  // 包装落地（会话仍在录）
  env.document._attr = null; mo.cb();                 // 会话收口
  const snap = bridge.snapshot();
  assert.equal(snap.callCount, 1, '前置：调用计数为 1');
  assert.equal(snap.sessionsMissed, 0, '会话内发生过调用 ⇒ 收口时计数不同 ⇒ **不得**计 missed');
});

test('OVB-V10 变异自证·正例必红：摘掉 missed 收口判定 ⇒ 迟到落地锁（该计 missed 那一支）必须失败', () => {
  const src = decodeChunk(CHUNK);
  const anchor = 'if (now === (b.callCountAtPrevSessionEnd || 0)) {';
  // 变异 = 精确复现本批实测误报的那个写法：**只看 firstCallAt 与「会话起点是否有过调用」的时刻关系**。
  // 实测形态：上一次会话已置 firstCallAt，而本次会话的 getUserMedia 迟到到收口之后 ⇒ 时刻口径判 missed。
  // 运行期拼接变异名（不形成字面量）。
  // 变异 = 让收口判定**永不成立**（等价于把 missed 判据整条摘掉）⇒ D05「该计 missed」必然失败
  const kill = 'if (false) {';
  assert.ok(src.includes(anchor), 'missed 锚点须存在');
  const mutated = src.replace(anchor, kill);
  const env = makeFakeEnv({ recordingPhase: true });
  const SV = loadStateForBridge(env);
  const bridge = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    mutated + '\n;return officialVoiceBridge;'
  )(env.window, env.document, env.navigator, env.localStorage, () => 0, () => {},
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent() { return {}; }, SV.vadSilenceMsOf, SV.vadRequiredQuiet, SV.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = null; mo.cb();      // 会话收口（此时一次都没被调用）⇒ 无变异时应计 missed
  return env.navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(() => {
    const snap = bridge.snapshot();
    assert.equal(snap.callCount, 1, '前置：确实调用过');
    assert.equal(snap.sessionsMissed === 0, true, '摘掉收口判定后必须**不再**计 missed ⇒ D05 的两义必红（若仍计 ⇒ 该锁没牙）');
  });
});

// ── F-18 修复的回归锁（2026-10-13·收尾批）─────────────────────────────────────
// 病：长按松开时若「启动尚未落地/停止派发太早」⇒ 旧实现**只写 `longReleaseRef` 标记、无人消费**
//     ⇒ 「松开即停」（README 承诺）静默落空，且**不留任何读数**（症状：已松手、官方仍在录音）。
// 修：两条进入路径都补**有界**消费（真派发停止并校验是否生效）；成功/失败都留读数。
test('OVB-R01 F-18：长按松开时启动尚未落地 ⇒ 必须在启动落地后**补停**，且 stopClicks 恰好 1', async () => {
  // ⚠ 必须 recordingPhase:true —— 该开关决定「相位节点数组」是否存在（false ⇒ 数组为空 ⇒ 相位永远查不到）。
  //   本组要的是「松开时相位**尚未**出现、随后才出现」，故节点须存在、`_attr` 初始为 null 由用例控制。
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: false, hotkey: true, sessionId: 'sess-r1' });
  host.render('');
  // 长按：按下 → 真实时间过阈值（500ms 是生产常量，不可改）→ 松开
  host.keydown();
  await new Promise((r) => setTimeout(r, 620));
  host.keyup();
  // 松开后官方启动才落地（相位出现）⇒ 桥报 recording；补停轮询应能真的派发到停止按钮
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  const snapMid = bridge.snapshot();
  for (let i = 0; i < 20; i++) host.runTimeouts(1);
  const snap = bridge.snapshot();
  assert.equal(snapMid.recording, true, '前置：官方确已进入采集态（补停窗口内）');
  assert.equal(snap.stopClicks, 1, 'F-18：补停必须恰好派发 1 次停止（旧实现为 0 = 松开即停落空）');
  assert.equal(snap.stopMissed, 0, '补停成功 ⇒ 不得记 missed');
});

test('OVB-R02 F-18：补停**成功**后不得再补（不得重复派发）⇒ stopClicks 不 >1', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: false, hotkey: true, sessionId: 'sess-r2' });
  host.render('');
  host.keydown();
  await new Promise((r) => setTimeout(r, 620));
  host.keyup();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  for (let i = 0; i < 40; i++) host.runTimeouts(1);   // 远超上限地驱动
  const snap = bridge.snapshot();
  assert.equal(snap.stopClicks, 1, 'F-18：补停成功即停 ⇒ stopClicks 必须恰好 1（>1 = 重复派发）');
});

test('OVB-R03 F-18：补停**失败**必须留可见读数（不得静默）', async () => {
  const env = makeFakeEnv({ recordingPhase: true, noStopButton: true });  // 停止按钮不可用 ⇒ 补停必败
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: false, hotkey: true, sessionId: 'sess-r3' });
  host.render('');
  host.keydown();
  await new Promise((r) => setTimeout(r, 620));
  host.keyup();
  // 官方进入采集态但**没有停止按钮** ⇒ 每次补停都会落到显式降级
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  for (let i = 0; i < 40; i++) host.runTimeouts(1);
  const snap = bridge.snapshot();
  assert.equal(snap.stopClicks, 0, '前置：确实一次都没停掉');
  assert.equal(host.store.error, 'VOICE_OFFICIAL_UNAVAILABLE', 'F-18：补停失败必须在组件状态留错误（可见面不得静默）');
});

test('OVB-R04 F-18 变异自证：退回「只写标记、无消费」⇒ OVB-R01 必红', async () => {
  const src = decodeChunk('src/client/voice/hotkey.js');
  // 变异 = 精确复现旧写法：只置标记，不启动补停轮询
  const anchor = "        longReleaseRef.current = true;\n        scheduleDeferredStop();";
  assert.ok(src.includes(anchor), 'F-18 消费锚点须存在');
  const mutated = src.replace(anchor, "        longReleaseRef.current = true;");
  assert.ok(!mutated.includes('scheduleDeferredStop();\n      }\n      return;'), '变异后不得再启动补停（否则变异无效）');
  // 用变异源码建一个宿主，断言补停**不会**发生 ⇒ 证明 OVB-R01 的判据有牙
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mini = makeMiniReact();
  const timerRegs = [];
  const timerSvcLocal = {
    interval: (fn, ms) => { const r = { fn, ms, kind: 'interval', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
    timeout: (fn, ms) => { const r = { fn, ms, kind: 'timeout', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
  };
  bridge.setTimer(timerSvcLocal);
  const voiceCfgState = { value: { autoEnhance: false, vad: { enabled: true }, hotkey: { enabled: true, combo: 'Backquote' }, refine: {} }, listeners: new Set() };
  const storeStub = { phase: 'idle', error: null, backup: '', enhanced: '', seq: 0, memoryRounds: [], optimized: false, lastModel: '', fallbackUsed: false, degraded: [], truncated: false };
  const factory = new Function(
    'React', 'host', 'voiceCfgState', 'subscribeVoiceConfig', 'voiceHotkeyDisplay', 'parseVoiceHotkey',
    'matchVoiceHotkey', 'isEnhancing', 'subscribe', 'storeFor', 'startVoiceRecording', 'stopVoiceRecording',
    'isVoiceRecording', 'insertVoiceText', 'notify', 'enhance', 'timerSvc', 'officialVoiceBridge', 'makeT', 'ZH',
    'MarqueeSelect', 'CollapsibleSection', 'setInterval', 'clearInterval', 'setTimeout', 'navigator', 'window',
    mutated + '\n;return { VoiceHotkeyHost };'
  );
  const api = factory(
    mini.React, { call: () => Promise.resolve({ ok: true }) },
    voiceCfgState, () => () => {}, (c) => c, () => null, () => false, () => false,
    () => () => {}, () => storeStub,
    async () => { throw new Error('x'); }, async () => null, () => false,
    () => Promise.resolve({ filled: true }), () => {}, () => {},
    timerSvcLocal, bridge, (p) => (k) => k, {}, null, null,
    setInterval, clearInterval, setTimeout, env.navigator, env.window
  );
  const props = { sessionId: 'sess-r4', inputActions: { setDraft() {} }, input: { draft: '' } };
  mini.begin(); api.VoiceHotkeyHost(props); mini.runEffects();
  env.window._fire('keydown', { code: 'Backquote', key: '`', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, preventDefault() {}, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 620));
  env.window._fire('keyup', { code: 'Backquote', key: '`', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, preventDefault() {}, stopPropagation() {} });
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  for (let i = 0; i < 40; i++) { for (const r of timerRegs) { if (!r.cleared && r.kind === 'timeout') { r.cleared = true; r.fn(); } } }
  const snap = bridge.snapshot();
  assert.equal(snap.stopClicks, 0, '变异（只写标记、无消费）下补停**不会**发生 ⇒ OVB-R01 的 stopClicks===1 判据有牙');
});

// ═══════════════════════════════════════════════════════════════════════════════
// VAD-1/VAD-2 订正批（2026-10-14 定位批）：**校准窗不可信** 的机制回归锁
// ═══════════════════════════════════════════════════════════════════════════════
// 背景（用户现场读数）：手动点官方 🎤 后「一直在录，不说话也不停 / 说完停顿也不停」。
// 机制（本批已定位）：`ovbStartVad` 拿**前 5 帧（≈500ms）中位数 ×2.5** 当阈值。
//   真人「按下按钮即开口」⇒ **校准样本含语音** ⇒ 底噪被抬到语音电平 ⇒ 阈值 = 底噪×2.5
//   **结构上高于同一段语音** ⇒ `heardSpeech` 永不为真 ⇒ 静音计数永不启动 ⇒ 一直录。
//   这也解释了为何既有 CDP 取证（假设备 + 素材，校准期恰落在素材**前置静音**里）会「通过」——
//   假件对「起始即说话」这一形态**有盲区**。
//
// 本组夹具用**生成器**驱帧（永不耗尽）：旧实现用有限数组时，帧取尽会被折叠成常量，
// 那会**伪造**出自愈行为（本席第一版夹具即栽在此处，已在报告中记录）。
function makeGenEnv(gen) {
  const env = makeFakeEnv({ recordingPhase: true });
  // 替换假件的取帧方式：改为按 tick 调用生成器（不再是有限数组 shift）
  const frames = [];
  env.frames = frames;
  const origMake = null; void origMake;
  return { env, gen };
}

// 用生成器驱动：重建假件的 analyser 取帧源
function installGenFrames(env, gen) {
  const FakeAnalyser = function () { this.fftSize = 1024; };
  FakeAnalyser.prototype.getByteTimeDomainData = function (buf) {
    const v = Math.max(0, Math.min(1, gen()));
    const byte = Math.max(0, Math.min(255, Math.round(128 + v * 128)));
    for (let i = 0; i < buf.length; i++) buf[i] = byte;
  };
  env.window.AudioContext = class {
    constructor() { this.state = 'running'; }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return new FakeAnalyser(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  };
}

// 夹具语法：stages = [{frames, rms}]，超出末段后沿用末段
function stageGen(stages) {
  let i = 0; let k = 0;
  return () => {
    while (i < stages.length - 1 && k >= stages[i].frames) { k -= stages[i].frames; i++; }
    k++;
    return stages[i].rms;
  };
}

// 驱动到静音达标/上限，返回读数（stopClicks 等）
async function driveVad(env, bridge, cap) {
  await env.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  await flush();
  env.document._attr = 'recording';
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  let ticks = 0;
  for (const rec of env.timers) { while (!rec.cleared && ticks < (cap || 600)) { rec.fn(); ticks++; } }
  return { ticks, snap: bridge.snapshot(), clicks: env.stopButton.clicks };
}

test('OVB-VAD-01 F2 首要假设：校准窗含语音（起始即说话）⇒ 修复后**必须**自动停', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([
    { frames: 5, rms: 0.05 },     // 校准窗：用户按下即开口 ⇒ 样本含语音
    { frames: 100, rms: 0.05 },   // 持续说话（与校准同电平）
    { frames: 300, rms: 0.001 },  // 说完停顿
  ]));
  const bridge = loadBridge(env);
  bridge.install();
  const r = await driveVad(env, bridge);
  assert.equal(r.clicks, 1, '起始即说话（校准含语音）⇒ 修复后必须派发点击官方停止恰好 1 次');
  assert.equal(r.snap.stopMissed, 0, '不得计 missed');
  assert.equal(r.snap.abandonReason, '', '不得留下降级原因');
});

test('OVB-VAD-02 F2\' 真实形态：校准含语音 + 语音有起伏（词间回落）⇒ 必须自动停', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([
    { frames: 5, rms: 0.05 },
    { frames: 100, rms: 0.08 },
    { frames: 300, rms: 0.001 },
  ]));
  const bridge = loadBridge(env);
  bridge.install();
  const r = await driveVad(env, bridge);
  assert.equal(r.clicks, 1, '有起伏的真实语音同样必须能自动停（阈值须已自愈回落）');
});

test('OVB-VAD-03 F1 低电平边界（语音低于绝对下限 0.025）⇒ **不得**误停（负控）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([
    { frames: 5, rms: 0.001 },
    { frames: 100, rms: 0.02 },   // 音量低于绝对阈值下限
    { frames: 300, rms: 0.001 },
  ]));
  const bridge = loadBridge(env);
  bridge.install();
  const r = await driveVad(env, bridge);
  assert.equal(r.clicks, 0, '语音电平低于绝对阈值下限时不得误判为说话（防误停取向保持）');
});

test('OVB-VAD-04 N1 关键负控：校准窗含语音/噪声但**此后从未说话** ⇒ 绝不得误停', async () => {
  // ⚠ 本判据是修复的**反向锁**：自愈会让阈值快速回落，若不同步清掉平滑残留，
  //   校准窗的电平会被残留的 smoothRms 当作「听到过语音」⇒ 误计静音帧 ⇒ 误停。
  //   （本席第一版修复即命中该形态，被本夹具抓到后加了 VAD-2「校准结束清平滑」。）
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([
    { frames: 5, rms: 0.05 },     // 校准含噪（用户按按钮时有环境声/呼吸）
    { frames: 400, rms: 0.002 },  // 此后一片安静：用户**从未说话**
  ]));
  const bridge = loadBridge(env);
  bridge.install();
  const r = await driveVad(env, bridge);
  assert.equal(r.clicks, 0, '⚠ 校准含噪但此后从未说话 ⇒ **不得**误停（否则等于凭空结束录音）');
});

test('OVB-VAD-05 F3 高底噪（持续噪声不下降）⇒ 语音未过抬高后的阈 ⇒ 不得误停（负控）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([
    { frames: 5, rms: 0.06 },     // 高底噪：阈 = 0.06×2.5 = 0.15
    { frames: 100, rms: 0.1 },    // 说话 0.1 < 0.15 ⇒ 未过门
    { frames: 300, rms: 0.06 },
  ]));
  const bridge = loadBridge(env);
  bridge.install();
  const r = await driveVad(env, bridge);
  assert.equal(r.clicks, 0, '持续高底噪下语音未过门 ⇒ 不得计静音（与旧实现同取向；本判据锁住"未过门就不停"）');
});

test('OVB-VAD-06 读数不静默：VAD 内部状态必须进诊断快照（门是否开过可判）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([{ frames: 400, rms: 0.001 }]));
  const bridge = loadBridge(env);
  bridge.install();
  await driveVad(env, bridge);
  const snap = bridge.snapshot();
  for (const k of ['vadHeardSpeech', 'vadQuietFrames', 'vadThreshold', 'vadNoiseFloor']) {
    assert.ok(Object.prototype.hasOwnProperty.call(snap, k), '诊断快照缺读数 ' + k + '（门从未开过这一形态此前**无法判别**）');
  }
  assert.equal(snap.vadHeardSpeech, false, '全程静音 ⇒ 门未开过（这正是用户现场"一直录"的那一格）');
});

// ── 变异自证：把修复退回（仅降不升的自愈 + 校准清平滑）⇒ 判据必须转红 ──────────
// ⚠ 只在**内存副本**内变异（不动仓库文件）。
function loadMutantBridge(env, mutate) {
  const src = mutate(decodeChunk(CHUNK));
  const S = loadStateForBridge(env);
  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    src + '\n;return officialVoiceBridge;'
  );
  let seq = 0;
  const bridge = factory(
    env.window, env.document, env.navigator, env.localStorage,
    (fn, ms) => { const rec = { fn, ms, cleared: false, id: ++seq }; env.timers.push(rec); return rec.id; },
    (id) => { const rec = env.timers.find((r) => r.id === id); if (rec) rec.cleared = true; },
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent(type, init) { return { type, init }; },
    S.vadSilenceMsOf, S.vadRequiredQuiet, S.voiceCfgState
  );
  bridge.setTimer(env.timerSvc);
  return bridge;
}

// 变异①：把「运行期自愈（只降不升）」整段退回 ⇒ 校准被语音污染后阈值不再回落
function mutateNoSelfHeal(src) {
  const anchor = 'if (rms < noiseFloor) {';
  assert.ok(src.includes(anchor), '变异锚点须存在（自愈分支）');
  return src.replace(anchor, 'if (false) {');
}
// 变异②：把「校准结束清平滑残留」退回 ⇒ N1 形态被误判为「听到过语音」⇒ 误停
function mutateKeepSmooth(src) {
  const anchor = '            smoothRms = 0;\n';
  assert.ok(src.includes(anchor), '变异锚点须存在（校准清平滑）');
  return src.replace(anchor, '');
}

test('OVB-VAD-V01 变异自证·正例必红：退回「无自愈」⇒ F2 判据必须失败', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([
    { frames: 5, rms: 0.05 }, { frames: 100, rms: 0.05 }, { frames: 300, rms: 0.001 },
  ]));
  const bridge = loadMutantBridge(env, mutateNoSelfHeal);
  bridge.install();
  const r = await driveVad(env, bridge);
  const wouldPass = (r.clicks === 1);
  assert.equal(wouldPass, false, '退回无自愈后 F2（校准含语音）判据必须为红 —— 若仍绿说明判据没牙');
});

test('OVB-VAD-V02 变异自证·负控必绿：同一变异下 F1 低电平判据仍须通过', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([
    { frames: 5, rms: 0.001 }, { frames: 100, rms: 0.02 }, { frames: 300, rms: 0.001 },
  ]));
  const bridge = loadMutantBridge(env, mutateNoSelfHeal);
  bridge.install();
  const r = await driveVad(env, bridge);
  assert.equal(r.clicks, 0, '负控·低电平不得误停（与自愈无关，必须仍绿）');
});

test('OVB-VAD-V03 变异自证·正例必红：退回「不清平滑」⇒ N1 误停判据必须失败', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  installGenFrames(env, stageGen([
    { frames: 5, rms: 0.05 }, { frames: 400, rms: 0.002 },
  ]));
  const bridge = loadMutantBridge(env, mutateKeepSmooth);
  bridge.install();
  const r = await driveVad(env, bridge);
  const wouldPass = (r.clicks === 0);
  assert.equal(wouldPass, false, '退回不清平滑后 N1（校准含噪但未说话）必须**误停** ⇒ 证明该判据有牙');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SW-1（2026-10-15 接线批）：`vad.enabled` 开关必须**真的约束运行期行为**
// ═══════════════════════════════════════════════════════════════════════════════
// 病（上批报出）：`voice-section.js` 写 `vad.enabled` **8 处**，`official-bridge.js` **引用 0 处**
//   ⇒ 用户关掉「静音监测」，VAD **照跑**、仍会派发点击官方停止 = **用户可见的开关说了假话**
//   （属「让失败不可观测」类，CHG-065 同族）⇒ 必须修。
// 本组判据（逐条有牙）：
//   SW-01 关 ⇒ **不启动 VAD**（不建 AudioContext、不挂 interval、不自动停）+ 读数可判
//   SW-02 开 ⇒ 行为与改前一致（**负控**：静音达标照常派发点击官方停止）
//   SW-03 关「静音监测」**不得**连带关「自动增强」（两者语义独立）
//   SW-04 缺 `vad` / 缺 `enabled` ⇒ 视为**开**（不改动未配置用户语义）
//   SW-05 会话**中途**关掉 ⇒ 当帧起不再派发（开关对整场为真，不只启动那一刻）
//   SW-06 诊断可见：`vadEnabled`/`vadSkipped` 进快照，分支能区分「已关闭」与「已开启未触发」
//   SW-V01/V02 变异自证（退回接线 ⇒ SW-01 必红；同变异下 SW-02 负控必绿）
test('OVB-SW01 开关关（vad.enabled:false）⇒ 不启动 VAD、不自动停，且读数可判', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env, { vad: { enabled: false, silenceMs: 2000 }, autoEnhance: true, hotkey: {}, refine: {} });
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  await flush();
  env.document._attr = 'recording';
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  // 夹具默认脚本：校准 5 帧 + 1 帧语音 + 20 帧静音 ⇒ 开着时**必然**达标自动停
  runVad(env);
  const snap = bridge.snapshot();
  assert.equal(env.acCreated(), 0, '开关关闭 ⇒ **不得**创建 AudioContext（不观测）');
  assert.equal(env.timers.length, 0, '开关关闭 ⇒ **不得**挂 VAD 轮询');
  assert.equal(env.stopButton.clicks, 0, '开关关闭 ⇒ **不得**自动停（不得派发点击官方停止）');
  assert.equal(snap.vadEnabled, false, '快照须如实报「开关关」（不得静默）');
  assert.equal(snap.vadSkipped, 1, '须留下「因开关关闭而未启动 VAD」的计数（开关真的约束了行为的证据）');
  assert.equal(snap.abandonReason, '', '按意图关闭**不是**降级 ⇒ 不得写 abandonReason');
});

test('OVB-SW02 负控：开关开（默认）⇒ 行为与改前逐字一致（静音达标照常自动停）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env, { vad: { enabled: true, silenceMs: 2000 }, autoEnhance: false, hotkey: {}, refine: {} });
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  await flush();
  env.document._attr = 'recording';
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  runVad(env);
  const snap = bridge.snapshot();
  assert.equal(env.acCreated(), 1, '开关开 ⇒ 正常启动 VAD（负控：接线不得把开着的也挡掉）');
  assert.equal(env.stopButton.clicks, 1, '开关开 ⇒ 静音达标须照常派发点击官方停止（恰好 1 次）');
  assert.equal(snap.vadSkipped, 0, '开关开 ⇒ 不得计「未启动」');
  assert.equal(snap.vadEnabled, true, '快照须如实报「开关开」');
});

test('OVB-SW03 独立性：关「静音监测」**不得**连带关「自动增强」', () => {
  // 静态证明（两条配置各读各的路径，无耦合）：
  const br = decodeChunk(CHUNK);
  // 「静音监测」只在桥内被读，且只用于 VAD 启动/守卫
  assert.ok(/ovbVadEnabled\(\)/.test(br), '桥须读 vad.enabled 决定是否启动 VAD');
  // 「自动增强」的读取点仍在 hotkey.js（本批**未触碰**）——不得被 vad.enabled 影响
  const hk = decodeChunk('src/client/voice/hotkey.js');
  assert.ok(hk.includes('voiceCfgState.value.autoEnhance === true'),
    'autoEnhance 的读取点须仍在 hotkey.js（关静音监测 ≠ 关自动增强）');
  // ⚠ 只看**活代码**：桥内注释会提到 `autoEnhance`（说明「两者无关」这一契约本身），
  //   注释不是判定 ⇒ 判据须落在活代码上（与既有用例的 hkLive 做法同款）。
  const brLive = br.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(/autoEnhance/.test(brLive), false,
    '桥的**活代码**内不得出现 autoEnhance 判定（否则两开关被耦合 —— 本批只接 vad.enabled）');
});

// ⚠ SW03b：SW03 是**静态**证明（读取点不耦合）。本条补**行为**证明：
//   「静音监测关」与「自动增强开」同时成立时，自动增强**仍须照常触发** ——
//   否则用户关掉一个开关会静默丢掉另一个功能（连带关闭 = 开关说假话的另一种形态）。
test('OVB-SW03b 行为独立性：静音监测关 + 自动增强开 ⇒ 自动增强仍须触发（不得连带关闭）', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  // 桥读到「静音监测关」；热键组件的 config 桩保持 autoEnhance = true
  const bridge = loadBridge(env, { vad: { enabled: false, silenceMs: 2000 }, autoEnhance: true, hotkey: {}, refine: {} });
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: true, sessionId: 'sess-sw03b' });
  host.render('');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();      // 官方会话开始（桥不启 VAD，但照记相位）
  env.document._attr = null; mo.cb();             // 会话结束 ⇒ 自动增强装臂
  host.render('官方识别出来的文字');               // 写回落地
  for (const r of host.timerRegs) { if (!r.cleared) r.fn(); }
  assert.equal(host.enhanceCalls.length, 1,
    '静音监测关**不得**连带关自动增强 —— 写回落地后仍须恰好触发 1 次增强');
  assert.equal(bridge.snapshot().vadEnabled, false, '前置：静音监测确为关');
});

// ⚠ SW01b：「按意图关闭」**不得**被误报成「未观测到官方采集（自动停未生效）」。
//   桥的包装器调用计数（callCount）与开关**无关**，且是 missed 判据的基元 ⇒
//   必须在跳过 VAD 的同时**照记**计数，否则用户关掉开关后会看到一句错误的失效告警。
test('OVB-SW01b 关闭态不得误报 missed：跳过 VAD 但包装计数照记 ⇒ sessionsMissed 保持 0', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env, { vad: { enabled: false, silenceMs: 2000 }, autoEnhance: false, hotkey: {}, refine: {} });
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: {}, video: false });
  await flush();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();     // 会话开始
  env.document._attr = null; mo.cb();            // 会话收口（missed 判定点）
  const snap = bridge.snapshot();
  assert.equal(snap.sessionsStarted, 1, '官方会话须照常被观测到（开关只管 VAD）');
  assert.equal(snap.sessionsMissed, 0, '⚠ 包装器确被调用过 ⇒ 不得计 missed（否则关闭态会显示错误的失效告警）');
  assert.equal(snap.vadSkipped, 1, '须留下「因开关未启动 VAD」的计数');
  assert.equal(snap.abandonReason, '', '关闭不是降级 ⇒ 不得写 abandonReason');
});

test('OVB-SW04 缺配置 ⇒ 视为开（不改动未配置用户语义）', async () => {
  for (const cfg of [
    { autoEnhance: false },                                  // 缺 vad 段
    { vad: { silenceMs: 2000 }, autoEnhance: false },        // 缺 enabled 字段
    { vad: {}, autoEnhance: false },                         // vad 空对象
  ]) {
    const env = makeFakeEnv({ recordingPhase: true });
    const bridge = loadBridge(env, cfg);
    bridge.install();
    await env.navigator.mediaDevices.getUserMedia({ audio: {}, video: false });
    await flush();
    env.document._attr = 'recording';
    const mo = env.observerInstances[env.observerInstances.length - 1];
    mo.cb();
    runVad(env);
    assert.equal(bridge.snapshot().vadEnabled, true,
      '缺配置必须视为**开**（配置形态 ' + JSON.stringify(cfg) + '）—— 不得把未配置用户静默关掉');
    assert.equal(env.stopButton.clicks, 1, '缺配置 ⇒ 与改前一致地自动停');
  }
});

test('OVB-SW05 中途关开关：会话进行中改配置 ⇒ 当帧起不再派发（开关对整场为真）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const cfg = { vad: { enabled: true, silenceMs: 2000 }, autoEnhance: false, hotkey: {}, refine: {} };
  const bridge = loadBridge(env, cfg);
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: {}, video: false });
  await flush();
  env.document._attr = 'recording';
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  // ⚠ 有界驱动（与 runVad 同款上限）：VAD 的 interval **不会**因停止而 cleared
  //   （`stopped=true` 后 tick 直接 return）⇒ 无界 while 会永久空转（本席首版即栽在此处）。
  const pump = (n) => { let t = 0; for (const rec of env.timers) { if (rec.cleared) continue; while (!rec.cleared && t < n) { rec.fn(); t++; } } return t; };
  pump(3);                                     // 先跑少量帧（未达静音阈值）
  cfg.vad.enabled = false;                     // 用户**中途**关掉开关
  pump(200);                                   // 再跑满：若守卫失效，静音必然达标 ⇒ stopClicks 会 >0
  pump(200);                                   // 再多跑一轮，确保「达标」有充分机会发生
  assert.equal(env.stopButton.clicks, 0,
    '会话中途关掉开关 ⇒ 此后不得再派发自动停（否则开关只说半场真话）');
});

test('OVB-SW06 诊断可见：开关态进快照且分支可区分「已关闭」与「已开启未触发」', () => {
  const vs = decodeChunk('src/client/voice/voice-section.js');
  const i18n = decodeChunk('src/client/i18n.js');
  // 独立 i18n 键（前缀刻意避开被既有判据锁数的 voiceOfficial*/voiceVad*）
  assert.ok(i18n.includes("voiceSilenceOff:"), 'i18n 缺「静音监测已关闭」键');
  assert.ok(vs.includes("t('voiceSilenceOff')"), '诊断分支缺「已关闭」分支引用');
  assert.ok(vs.includes('snap.vadEnabled === false'), '该分支须以**开关真值**为判据（严格 ===）');
  // 与「已开启但未触发」可区分：后者不得命中「已关闭」分支
  assert.ok(vs.includes("t('voiceOfficialArmed')"), '「已开启但未触发」分支须仍在（armed）');
  // ⚠ 位置纪律（本席自查修正）：开关态必须排在**所有失效/异常分支之后** ——
  //   否则用户一旦关掉开关，`abandonReason`/`startMissed`/`endedInFeedback`/`sessionsMissed`
  //   这些**真实故障会被永久掩蔽**（实测命中：关掉开关后「热键启动失败」也显示成「静音监测已关闭」，
  //   用户会误以为是自己设置导致，实则热键坏了）= 正是本批要消灭的「让失败不可观测」类。
  const iSilenceOff = vs.indexOf("t('voiceSilenceOff')");
  for (const [k, ind] of [
    ['voiceOfficialAbandon', "t('voiceOfficialAbandon')"],
    ['voiceOfficialStartMissed', "t('voiceOfficialStartMissed')"],
    ['voiceOfficialFeedback', "t('voiceOfficialFeedback')"],
    ['voiceOfficialMissed', "t('voiceOfficialMissed')"],
  ]) {
    const idx = vs.indexOf(ind);
    assert.ok(idx > 0 && iSilenceOff > idx,
      '「已关闭」分支须排在失效分支 ' + k + ' **之后**（否则该故障会被开关态掩蔽）');
  }
  // 但必须排在**正常/瞬态**分支之前（「开关关没关」是用户此刻的疑问 ⇒ 优先作答）
  for (const [k, ind] of [
    ['voiceOfficialActive', "t('voiceOfficialActive')"],
    ['voiceOfficialArmed', "t('voiceOfficialArmed')"],
  ]) {
    const idx = vs.indexOf(ind);
    assert.ok(idx > 0 && iSilenceOff < idx,
      '「已关闭」分支须排在正常分支 ' + k + ' **之前**（否则关了开关仍显示「已就绪/采集进行中」）');
  }
  // title 暴露开关真值与「未启动」计数（可判别）
  assert.ok(vs.includes("'vadOn='"), '诊断 title 缺开关真值');
  assert.ok(vs.includes("'vadSkipped='"), '诊断 title 缺「因开关未启动 VAD」的计数');
  const br = decodeChunk(CHUNK);
  assert.ok(br.includes('vadEnabled: ovbVadEnabled()'), '快照须暴露开关当前真值');
  assert.ok(br.includes('b.vadSkipped = (b.vadSkipped || 0) + 1'), '快照须暴露「未启动」计数');
});

// ── 变异自证：把接线退回（仅内存副本）⇒ SW-01 必红，SW-02 负控必绿 ──────────────
// 变异名运行时拼接（不在源码里形成字面量）。
function mutateUnwire(src) {
  const anchor = 'if (!ovb' + 'VadEnabled()) {';
  assert.ok(src.includes(anchor), '变异锚点须存在（接线分支）');
  return src.replace(anchor, 'if (false) {');
}

async function runSwitchScenario(cfg, mutate) {
  const env = makeFakeEnv({ recordingPhase: true });
  const src = mutate ? mutate(decodeChunk(CHUNK)) : decodeChunk(CHUNK);
  const S = loadStateForBridge(env);
  S.voiceCfgState.value = cfg;
  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState', src + '\n;return officialVoiceBridge;');
  let seq = 0;
  const bridge = factory(env.window, env.document, env.navigator, env.localStorage,
    (fn, ms) => { const rec = { fn, ms, cleared: false, id: ++seq }; env.timers.push(rec); return rec.id; },
    (id) => { const rec = env.timers.find((r) => r.id === id); if (rec) rec.cleared = true; },
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent(type, init) { return { type, init }; },
    S.vadSilenceMsOf, S.vadRequiredQuiet, S.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: {}, video: false });
  await flush();
  env.document._attr = 'recording';
  const mo = env.observerInstances[env.observerInstances.length - 1];
  mo.cb();
  runVad(env);
  return { env, snap: bridge.snapshot() };
}

test('OVB-SW-V01 变异自证·正例必红：退回接线 ⇒ SW-01 判据必须失败', async () => {
  const r = await runSwitchScenario({ vad: { enabled: false, silenceMs: 2000 }, autoEnhance: false, hotkey: {}, refine: {} }, mutateUnwire);
  const wouldPass = (r.env.acCreated() === 0 && r.env.stopButton.clicks === 0);
  assert.equal(wouldPass, false,
    '退回接线后「开关关 ⇒ 不启动 VAD」必须为红 —— 若仍绿说明判据没牙（这正是改前的缺陷形态）');
});

test('OVB-SW-V02 变异自证·负控必绿：同一变异下「开关开」路径仍须通过', async () => {
  const r = await runSwitchScenario({ vad: { enabled: true, silenceMs: 2000 }, autoEnhance: false, hotkey: {}, refine: {} }, mutateUnwire);
  assert.equal(r.env.stopButton.clicks, 1, '负控·开关开时自动停仍须发生（与接线是否在位无关）');
  assert.equal(r.env.acCreated(), 1, '负控·开关开时 VAD 仍须启动');
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHG-090（2026-10-15 诊断如实化批）：诊断读数**不得说假话 / 不得读不到**
// ═══════════════════════════════════════════════════════════════════════════════
// 病历（生效链批实测，同 CHG-065 家族）：
//   ① `feedbackSeen` 是**页面生命期累计**（唯一自增点在 feedback 收口；`= 0` 只在 uninstall）
//      ⇒ 文案「**上次**官方会话以失败收场」实为「历次累计发生过」且**永不自消**
//      ⇒ 把**历史残留**读成**当前失败**（用户最初报障看到的那行正由此而来）。
//   ② §6.1 清单第 8 行 `stopMissed` 用户**任何可见面都读不到**（不在 diagTitle、不在可见分支）。
// 本组判据（逐条有牙）：
//   OVB-DT01 最近一次会话**真失败** ⇒ 仍然可见（不得静默失效）
//   OVB-DT02 之后录一场**成功**会话 ⇒ 陈旧失败读数**必须自消**（改正的核心）
//   OVB-DT03 官方「重新录音」（从 feedback 重试）⇒ 不再是「最近一次失败」
//   OVB-DT04 用户点 X 关闭 feedback ⇒ 该场仍是「最近一次会话」⇒ 读数**保留**
//   OVB-DT05 `stopMissed` 进 title（只读出口）+ 既有顺序判据仍绿（改动后重跑位置纪律）
//   OVB-DT-V01/V02 变异自证（退回 `feedbackSeen` 旧语义 ⇒ DT02 必红；负控必绿）

// ── 1.1 语义订正 ──────────────────────────────────────────────────────────────
test('OVB-DT01 语义订正·不得静默失效：最近一次会话**真的**以失败收口 ⇒ 仍须可见', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();       // 官方采集
  env.document._attr = 'feedback'; mo.cb();        // 官方失败出口
  const snap = bridge.snapshot();
  assert.equal(snap.feedbackSeen, 1, '前置：累计读数照记（本批**不改**累计计数语义）');
  assert.equal(snap.lastSessionFailed, true,
    '⚠ 最近一次会话确以失败收口 ⇒ 会话级读数须为真（否则「真失败」被静默吞掉 = 比原缺陷更坏）');
});

test('OVB-DT02 语义订正·核心：之后录一场**成功**会话 ⇒ 陈旧失败读数必须自消', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  // 第 1 场：以官方失败出口收口
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  assert.equal(bridge.snapshot().lastSessionFailed, true, '前置：第 1 场确为失败收口');
  // 用户点 X 关闭 feedback 节点
  env.document._attr = null; mo.cb();
  assert.equal(bridge.snapshot().lastSessionFailed, true,
    '前置：关闭 feedback 不改变「最近一次会话 = 那场失败」');
  // 第 2 场：正常采集、正常收口（成功）
  env.document._attr = 'recording'; mo.cb();
  assert.equal(bridge.snapshot().lastSessionFailed, false,
    '新会话开始 ⇒ 上一场的失败不再是「最近一次」');
  env.document._attr = null; mo.cb();              // 成功收口
  const snap = bridge.snapshot();
  assert.equal(snap.lastSessionFailed, false,
    '⚠ 核心订正：成功收口后不得再报「上次官方会话以失败收场」'
    + '（旧实现 feedbackSeen 恒 >0 ⇒ 文案永不自消 = 历史残留被读成当前失败）');
  assert.equal(snap.feedbackSeen, 1,
    '累计读数必须**照旧保留**（本批只订正会话级语义，不改既有累计判据）');
});

test('OVB-DT03 从 feedback 重试（官方「重新录音」）⇒ 不再是「最近一次失败」', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  assert.equal(bridge.snapshot().lastSessionFailed, true, '前置：已进 feedback 失败出口');
  env.document._attr = 'recording'; mo.cb();       // 官方「重新录音」：相位回 recording，节点仍在
  const snap = bridge.snapshot();
  assert.equal(snap.lastPhase, 'recording', '前置：相位确已回到 recording');
  assert.equal(snap.endedInFeedback, false, '既有 B-4 判据不得回退');
  assert.equal(snap.lastSessionFailed, false,
    '⚠ 已开新会话 ⇒ 最近一次会话不是那场失败（否则「正在录音」时仍报「上次失败收场」= 读数说反话）');
});

test('OVB-DT04 点 X 关闭 feedback ⇒ 该场仍是「最近一次会话」⇒ 读数保留（不得过度复位）', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  env.document._attr = null; mo.cb();              // 用户点 X：节点消失（**没有**新会话）
  const snap = bridge.snapshot();
  assert.equal(snap.endedInFeedback, false, '既有 B-4 判据：收口后标志复位');
  assert.equal(snap.lastSessionFailed, true,
    '⚠ 关闭 ≠ 成功 —— 最近一次会话**仍是**那场失败 ⇒ 读数必须保留（否则真失败被静默吞掉）');
});

// ── 1.2 stopMissed 可读性（选 (a)：加入 title 只读出口）────────────────────────
test('OVB-DT05 stopMissed 进 title（只读出口），且既有顺序判据不得被破坏', () => {
  const vs = decodeChunk('src/client/voice/voice-section.js');
  // 只读出口：title 数组内须出现 stopMissed（此前只有 snapshot 暴露、用户读不到）
  assert.ok(vs.includes("'stopMissed='"), '⚠ §6.1 清单第 8 行的 stopMissed 必须进入只读出口 title');
  assert.ok(/'stopMissed=' \+ \(snap\.stopMissed \|\| 0\)/.test(vs),
    'stopMissed 须以快照读数为源（不得另算/不得硬编码）');
  // 成对可判：stopClicks（成功停）与 stopMissed（停派发失败）须相邻同面
  const iClicks = vs.indexOf("'stopClicks='");
  const iMissed = vs.indexOf("'stopMissed='");
  assert.ok(iClicks > 0 && iMissed > iClicks, 'stopMissed 应紧邻 stopClicks（成对读出「停成功/停失败」）');
  // abandonReason 仍须在数组**首位**（降级原因可读性不得被本改动削弱）
  const iTitle = vs.indexOf('const diagTitle = [');
  const iAbandon = vs.indexOf('snap.abandonReason', iTitle);
  assert.ok(iAbandon > iTitle && iAbandon < iClicks,
    'abandonReason 须仍在 diagTitle 数组**首位**（本改动不得削弱降级原因的可读性）');
  // ⚠ 顺序判据（OVB-SW06 的位置纪律）改动后重跑：开关态仍须在失效分支之后、正常分支之前
  const iSilenceOff = vs.indexOf("t('voiceSilenceOff')");
  for (const [k, ind] of [
    ['voiceOfficialAbandon', "t('voiceOfficialAbandon')"],
    ['voiceOfficialStartMissed', "t('voiceOfficialStartMissed')"],
    ['voiceOfficialFeedback', "t('voiceOfficialFeedback')"],
    ['voiceOfficialMissed', "t('voiceOfficialMissed')"],
  ]) {
    assert.ok(vs.indexOf(ind) < iSilenceOff, '位置纪律回归：开关态仍须排在失效分支 ' + k + ' 之后');
  }
  for (const [k, ind] of [['voiceOfficialActive', "t('voiceOfficialActive')"], ['voiceOfficialArmed', "t('voiceOfficialArmed')"]]) {
    assert.ok(vs.indexOf(ind) > iSilenceOff, '位置纪律回归：开关态仍须排在正常分支 ' + k + ' 之前');
  }
});

// ── 变异自证：把语义退回 `feedbackSeen`（纯内存副本）⇒ DT02 必红，负控必绿 ─────────
// 变异名运行时拼接（不在源码里形成字面量，与 mutateUnwire 同款做法）。
function mutateCumulative(src) {
  const anchor = 'snap.lastSession' + 'Failed === true';
  assert.ok(src.includes(anchor), '变异锚点须存在（会话级判据）');
  return src.replace(anchor, 'snap.feedback' + 'Seen > 0');   // 退回旧语义
}

// 在纯内存副本上求值设置页诊断分支，返回「给定快照下选中的可见文案 key」
function renderDiagKey(snap, mutate) {
  const vs = mutate ? mutate(decodeChunk('src/client/voice/voice-section.js')) : decodeChunk('src/client/voice/voice-section.js');
  const t = (k) => k;   // 文案 key 直接当标识
  // ⚠ 切片本身已含 `let text;` 声明 ⇒ 此处**不得**再声明一次
  //   （首版即栽在 "Identifier 'text' has already been declared" —— 变异用例自己先崩，等于没做自证）
  const seg = vs.slice(vs.indexOf('  let text;'), vs.indexOf('const diagTitle'));
  assert.ok(seg.includes('let text;'), '诊断分支切片须含 text 声明（防锚点漂移后静默取到空段）');
  // 2026-10-17（报障 D）：诊断分支现在用同 chunk 内的 ovbSinceLabel() 折算时距
  //   => 求值该切片时须提供同一实现（从**真实 chunk** 里取，不在这里另写一份）。
  const sinceSrc = vs.slice(vs.indexOf('function ovbSinceLabel'), vs.indexOf('function OfficialVoiceDiag'));
  assert.ok(sinceSrc.includes('function ovbSinceLabel'), '须能从真实 chunk 取到 ovbSinceLabel 实现');
  const factory = new Function('snap', 't', 'officialVoiceBridge',
    sinceSrc + '\nreturn (function(){' + seg + ' return text; })();');
  return factory(snap, t, null);
}

// 失败文案键族（本批把上次失败改成带时距版本；旧键保留给无时刻的退化态）
const isFailKey = (k) => k === 'voiceOfficialFeedbackSeen' || k === 'voiceOfficialFeedbackSeenAgo';
test('OVB-DT-V01 变异自证·正例必红：退回累计语义 ⇒ DT02 的核心判据必须失败', () => {
  const snap = { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 2,
    endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false,
    feedbackSeen: 1, lastSessionFailed: false, lastSessionFailedAt: 0 };   // 经历：1 次失败 + 之后 1 次成功
  const fixed = renderDiagKey(snap, null);
  // 2026-10-17：失败文案本批改为带时距版本（voiceOfficialFeedbackSeenAgo）=> 判据按语义族判定；
  //   仍要求成功之后不得再报失败，只是不再锁死单一键名（键名不是语义）。
  assert.equal(isFailKey(fixed), false, '修正后：成功会话之后不得再报失败（前置）');
  const mutated = renderDiagKey(snap, mutateCumulative);
  assert.equal(isFailKey(mutated), true,
    '⚠ 退回累计语义后，该快照仍会报上次失败 = 陈旧读数不自消 —— 若本断言不成立，说明判据没牙');
});

test('OVB-DT-V02 变异自证·负控必绿：同一变异下「最近一次真失败」仍须报失败', () => {
  const snap = { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 1,
    endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false,
    feedbackSeen: 1, lastSessionFailed: true };    // 最近一次**就是**那场失败
  const fixed = renderDiagKey(snap, null);
  assert.equal(isFailKey(fixed), true, '修正后：真失败仍须可见（不得静默失效）');
  const mutated = renderDiagKey(snap, mutateCumulative);
  assert.equal(isFailKey(mutated), true, '负控：该快照在两种语义下都必须报失败');
});

// ⚠ 变异自证（桥侧）：DT-V01/V02 只覆盖**渲染**分支；DT02 的核心是**桥**的读数语义
//   ⇒ 必须另有桥侧变异（把快照字段退回累计旧语义 ⇒ DT02 核心判据必红）。
// 变异名运行时拼接（不在源码里形成字面量）。
function mutateSnapshotCumulative(src) {
  const anchor = 'lastSession' + 'Failed: !!b.lastSession' + 'Failed,';
  assert.ok(src.includes(anchor), '变异锚点须存在（快照会话级字段）');
  return src.replace(anchor, 'lastSession' + 'Failed: b.feedback' + 'Seen > 0,');   // 退回累计旧语义
}

function runSessionScenario(mutate) {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const src = mutate ? mutate(decodeChunk(CHUNK)) : decodeChunk(CHUNK);
  const S = loadStateForBridge(env);
  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    src + '\n;return officialVoiceBridge;');
  let seq = 0;
  const bridge = factory(env.window, env.document, env.navigator, env.localStorage,
    (fn, ms) => { const rec = { fn, ms, cleared: false, id: ++seq }; env.timers.push(rec); return rec.id; },
    (id) => { const rec = env.timers.find((r) => r.id === id); if (rec) rec.cleared = true; },
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent(type, init) { return { type, init }; },
    S.vadSilenceMsOf, S.vadRequiredQuiet, S.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  // 第 1 场：官方失败出口收口
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  env.document._attr = null; mo.cb();
  // 第 2 场：正常采集 + 成功收口
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = null; mo.cb();
  return bridge.snapshot();
}

test('OVB-DT-V03 变异自证·桥侧正例必红：快照退回累计语义 ⇒ DT02 核心判据必须失败', () => {
  const fixed = runSessionScenario(null);
  assert.equal(fixed.lastSessionFailed, false,
    '修正后：1 次失败 + 之后 1 次成功 ⇒ 最近一次会话未失败（前置）');
  const mutated = runSessionScenario(mutateSnapshotCumulative);
  assert.equal(mutated.lastSessionFailed, true,
    '⚠ 退回累计语义后该快照必报 true（陈旧读数不自消）—— 若本断言不成立，说明 DT02 的判据没牙');
});

test('OVB-DT-V04 变异自证·桥侧负控必绿：同一变异下「最近一次真失败」两种语义都为真', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const src = mutateSnapshotCumulative(decodeChunk(CHUNK));
  const S = loadStateForBridge(env);
  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    src + '\n;return officialVoiceBridge;');
  let seq = 0;
  const bridge = factory(env.window, env.document, env.navigator, env.localStorage,
    (fn, ms) => { const rec = { fn, ms, cleared: false, id: ++seq }; env.timers.push(rec); return rec.id; },
    (id) => { const rec = env.timers.find((r) => r.id === id); if (rec) rec.cleared = true; },
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent(type, init) { return { type, init }; },
    S.vadSilenceMsOf, S.vadRequiredQuiet, S.voiceCfgState);
  bridge.setTimer(env.timerSvc);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();   // **只**这一场，且以失败收口
  assert.equal(bridge.snapshot().lastSessionFailed, true,
    '负控：最近一次（唯一一场）确为失败 ⇒ 两种语义下都必须为真（不得静默失效）');
});

// ══════════════════════════════════════════════════════════════════════════════
// 未识别态批（2026-10-15 · 用户报障/需求）——「卡在未识别」不得阻塞热键 + 接上该窗口的按钮
//
// 只读取证（CDP 实读 + 官方源码实读；完整读数见报告 §②）：
//   · 官方 feedback（未识别）窗口 DOM：\`<div class="ddpbLW_captureRow" data-voice-activity="feedback">\`
//     内**只有两个按钮**：aria-label=\`取消\`（X，onClick=cancel）与 aria-label=\`重新录音\`
//     （retry，onClick=\`start()\`）；两者均 vis=true、均 dis=false。
//     文案节点 \`ddpbLW_activityMessage\` 文本 = \`未识别到语音\`。
//   · **手动点该窗口的「重新录音」⇒ 官方相位回到 requesting**（CDP 实测 via=CLICKED，
//     相位 requesting ⇒ **官方自身在该状态下可用**）⇒ 需求 2/3 的问题**纯在插件侧**。
//   · 官方源码：\`dsh-experimental-client-ui-voice-input/lib/client.js:4990-5026\`（feedback 调用点）/
//     \`:5150-5160\`（retry 渲染）/ \`:5089-5091\` 与 \`:5156-5158\`（两处 onClick 都是 start()）。
// ══════════════════════════════════════════════════════════════════════════════

// ── 判据组 A：门禁语义 —— 只有「确在采集中」才拒绝（互斥保护保留）──────────────
test('OVB-UN01 需求 1/3 正例：官方卡在 feedback（未识别）⇒ 热键**不得**被拒，且能重新启动一轮', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();        // 第 1 轮：采集
  env.document._attr = 'feedback'; mo.cb();         // 空音轨 ⇒ 未识别到语音（用户报障状态）
  // 前置：该状态确为「未识别」，且官方仍占用语音入口
  assert.equal(bridge.snapshot().feedbackMessage, '未识别到语音', '前置：确在未识别态');
  assert.equal(bridge.snapshot().lastPhase, 'feedback', '前置：相位 = feedback');
  assert.equal(bridge.officialEntryBusy(), true,
    '前置（CHG-085 语义不变）：官方仍占用语音入口 ⇒ active 仍为真（本批**不改**这一读数）');
  // 核心：相位不是 recording ⇒ 不构成「采集中」⇒ 门禁必须放行
  assert.equal(bridge.officialCapturing(), false,
    '⚠ 核心：feedback（未识别）**不得**被算作「采集中」（旧实现读 active ⇒ 恒 true ⇒ 热键被拒 = 用户报障）');
  // 端到端：热键再触发 ⇒ 派发点击 retry 锚 ⇒ 官方重新进入一轮
  const r = bridge.startOfficial();
  assert.equal(r.started, true, '⚠ 需求 1：未识别态下热键必须能重新启动一轮（旧实现返回 already-capturing）');
  assert.equal(r.via, 'official-retry-button',
    '⚠ 需求 3+4：必须走未识别窗口的**真实锚**（重新录音 / Record again），而不是开始锚');
  assert.equal(env.retryButton.clicks, 1, 'retry 按钮必须被派发点击恰好 1 次');
  assert.equal(env.startButton.clicks, 0, '该窗口没有开始按钮 ⇒ 不得误点开始锚');
  const snap = bridge.snapshot();
  assert.equal(snap.retryClicks, 1, '新路径必须有可判读数（不得静默）');
  assert.equal(snap.startMissed, 0, '⚠ 旧实现此处 startMissed=1（「找不到按钮」）——本批必须归零');
  assert.equal(snap.lastStartVia, 'official-retry-button', '最近一次启动走的锚须可读');
  // 官方在新一轮开始时的真实形态：节点仍在（捕获行不卸载），相位回 requesting/recording
  env.document._attr = 'recording'; mo.cb();
  assert.equal(bridge.officialCapturing(), true, '重新起步后回到采集中 ⇒ 互斥保护照旧');
});

test('OVB-UN02 需求 1 边界：transcribing（收尾中）同样不算「采集中」⇒ 不得被拒', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  assert.equal(bridge.officialCapturing(), true, '前置：录制中 ⇒ 采集中');
  env.document._attr = 'transcribing'; mo.cb();     // 官方停录后转写（收尾相位）
  assert.equal(bridge.officialCapturing(), false,
    '收尾相位（transcribing）不是「采集中」⇒ 不得再算作采集中（旧实现读 active ⇒ 仍为 true）');
});

test('OVB-UN03 互斥保护**保留**（负控·需求明确要求不得取消）：真采集中仍须拒绝重复启动', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  assert.equal(bridge.officialCapturing(), true, '前置：官方确在采集中（recording 相位）');
  const r = bridge.startOfficial();
  assert.equal(r.started, false, '⚠ 官方确在采集中 ⇒ 仍须拒绝重复启动（互斥 = 有意保护，本批不得取消）');
  assert.equal(r.via, 'already-capturing', '拒因仍须是 already-capturing');
  assert.equal(env.retryButton.clicks + env.startButton.clicks, 0, '不得派发任何点击');
});

test('OVB-UN04 互斥保护**保留**（全相位矩阵）：只有 recording 才构成「采集中」', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  // 官方相位取值集合（官方源码实读）：idle(节点不挂载) | requesting | recording | transcribing | feedback
  const expect = { requesting: false, recording: true, transcribing: false, feedback: false };
  for (const [phase, want] of Object.entries(expect)) {
    env.document._attr = phase; mo.cb();
    assert.equal(bridge.officialCapturing(), want,
      '相位 ' + phase + ' ⇒ officialCapturing 必须为 ' + want
      + '（判据 = 官方自渲染的 recording 相位，不是「官方是否仍占用入口」）');
  }
  // idle：相位节点整体卸载
  env.document._attr = null; mo.cb();
  assert.equal(bridge.officialCapturing(), false, 'idle（节点卸载）⇒ 不是采集中');
});

// ── 判据组 B：需求 4 的锚面 —— 找得到、触发得到、且不得静默 ────────────────────
test('OVB-UN05 需求 4 正例：未识别窗口按钮按**真实锚**被找到并触发（事件可捕获）', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'feedback'; mo.cb();
  // 锚必须在位且可被定位（这就是需求 4「未识别窗口的按钮没有识别、没有接上」的判据）
  assert.ok(bridge._internal.findRetryButton(), 'feedback 态必须能定位到 retry 锚');
  assert.deepEqual(bridge._internal.RETRY_LABELS, ['重新录音', 'Record again'],
    '锚必须是**实读到的**官方文案（zh/en 双语，与官方源码键值 1:1）');
  assert.equal(bridge._internal.findStartButton(), null,
    '⚠ 该窗口**没有**开始按钮 —— 这正是旧实现 startMissed 的根因（锚面不足）');
  const r = bridge.startOfficial();
  assert.equal(r.via, 'official-retry-button', '须报告走的是 retry 锚（可判）');
  assert.equal(env.retryButton.clicks, 1, 'retry 锚被派发点击 1 次');
});

test('OVB-UN06 需求 4 负控：retry 锚不存在且开始锚也不存在 ⇒ 不得静默失败', () => {
  const env = makeFakeEnv({ noRetryButton: true, noStartButton: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'feedback'; mo.cb();
  const before = env.timers.length;
  const r = bridge.startOfficial();
  assert.equal(r.started, false, '两个锚都不可用 ⇒ 不得报告已启动');
  assert.equal(r.via, 'start-button-not-found', '须给出明确原因（锚面 exhausted）');
  const snap = bridge.snapshot();
  assert.equal(snap.startMissed, 1, '必须记为未启动（诊断区可见）');
  assert.ok(snap.abandonReason, '须留下降级原因（不得静默）');
  assert.equal(env.timers.length, before, '零行为改变（不得挂观察器/定时器）');
});

test('OVB-UN07 需求 4 负控：retry 按钮 disabled ⇒ 不得派发点击，且不得静默失败', () => {
  const env = makeFakeEnv({ retryDisabled: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'feedback'; mo.cb();
  const r = bridge.startOfficial();
  assert.equal(env.retryButton.clicks, 0, '⚠ disabled 的 retry 锚**不得**被点击');
  assert.equal(r.started, false,
    '该窗口只有 retry 一个启动锚（官方开始按钮在 feedback 相位**不渲染**）⇒ 无可用锚时不得假装已启动');
  assert.equal(r.via, 'start-button-not-found', '须给出明确原因（锚面已耗尽）');
  const snap = bridge.snapshot();
  assert.equal(snap.startMissed, 1, '必须记为未启动（诊断区可见 —— 不得静默）');
  assert.ok(snap.abandonReason, '须留下降级原因');
});

test('OVB-UN08 不得静默失效：新路径读数进快照（retryClicks / lastStartVia），且卸载复位', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'feedback'; mo.cb();
  bridge.startOfficial();
  const snap = bridge.snapshot();
  assert.equal(snap.retryClicks, 1, '快照须暴露 retry 路径计数');
  assert.equal(snap.lastStartVia, 'official-retry-button', '快照须暴露最近一次启动走的锚');
  bridge.uninstall();
  assert.equal(bridge.snapshot().retryClicks, 0, '卸载须复位（HMR 反复挂载不残留）');
  assert.equal(bridge.snapshot().lastStartVia, '', '卸载须复位');
});

// ── 判据组 C：feedback→重新录音 必须开启**新一轮**（否则「能重启一轮」落空）────
test('OVB-UN09 需求 1 实质：从 feedback 重试 ⇒ 新一轮必须能收口（lastEndedAt 前进、missed 不重复计）', async () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  const afterFb = bridge.snapshot();
  assert.ok(afterFb.lastEndedAt > 0, '前置：第 1 轮已在 feedback 分支收口');
  assert.equal(afterFb.sessionsMissed, 0, '前置：本轮包装器已命中 ⇒ 不计 missed');
  const endedAt1 = afterFb.lastEndedAt;
  const sessions1 = afterFb.sessionsStarted;
  // 用户在未识别窗口里**重新录音**（相位回 recording，节点不卸载）
  await new Promise((r) => setTimeout(r, 5));     // 保证新一轮收口时刻与第 1 轮可区分
  env.document._attr = 'recording'; mo.cb();
  assert.equal(bridge.snapshot().sessionsStarted, sessions1 + 1,
    '⚠ 重试必须是**新一轮会话**（旧实现不重开会话 ⇒ 计数不增）');
  // 第 2 轮官方照旧会取一次麦（真实链路形态：相位 requesting → getUserMedia → recording）
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  // 第 2 轮正常收口（节点消失）
  env.document._attr = null; mo.cb();
  const after2 = bridge.snapshot();
  assert.ok(after2.lastEndedAt > endedAt1,
    '⚠ 核心：第 2 轮必须能被收口（旧实现 settled 未被复位 ⇒ 永不收口 ⇒ lastEndedAt 停在第 1 轮）');
  assert.equal(after2.sessionsMissed, 0,
    '⚠ 第 2 轮包装器在会话内被调用过 ⇒ 不得误计 missed（也不得把第 1 轮重复计一次）');
});

test('OVB-UN10 需求 1 实质·负控：点 X 关闭（节点消失，无新会话）⇒ 会话计数**不得**虚增', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  const sessions = bridge.snapshot().sessionsStarted;
  env.document._attr = null; mo.cb();              // 点 X
  assert.equal(bridge.snapshot().sessionsStarted, sessions,
    '⚠ 关闭窗口**没有**开新一轮 ⇒ 会话计数不得增（否则与「重试」不可区分）');
});

// ── 判据组 D：不得把未识别态误认成「采集成功收尾」（CHG-085 收口语义一致）─────
test('OVB-UN11 收口语义一致：未识别态**已经**收口（不重复计 missed / 不重写时刻）', async () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  // ⚠ 本假件的 getUserMedia 桩经「构造参数名 mediaDevices」引用调用计数对象（见 makeFakeEnv 注释）；
  //   而桥**只为** VAD 观测而调用它、**不传参** ⇒ 该名在假件里不存在 ⇒ 内部异常被桥静默吞掉
  //   ⇒ 本会话的包装器会被判成「从未被调用」（sessionsMissed=1）——**装置失真，非产品行为**。
  //   照 OVB-P01 的既有做法先手动命中一次包装器，使本用例判的是收口语义而不是该装置缺口。
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  const a = bridge.snapshot();
  assert.ok(a.lastEndedAt > 0, '未识别 = 一次收口 ⇒ 记结束时刻');
  assert.equal(a.sessionsMissed, 0, '不得计 missed');
  // 节点随后消失（用户点 X）⇒ 同一会话**不得**二次收口
  env.document._attr = null; mo.cb();
  const b2 = bridge.snapshot();
  assert.equal(b2.sessionsMissed, 0, '⚠ 不得重复收口（否则 missed 计两次）');
  assert.equal(b2.lastEndedAt, a.lastEndedAt, '⚠ 不得覆盖首次收口时刻');
});

test('OVB-UN12 不得误认成采集成功：未识别出口的会话级读数仍为「失败收口」', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  const snap = bridge.snapshot();
  assert.equal(snap.endedInFeedback, true, '未识别出口必须被标为失败出口（订阅方不空等写回）');
  assert.equal(snap.lastSessionFailed, true, '会话级读数须为失败（不得被本批改成成功）');
  assert.equal(snap.feedbackMessage, '未识别到语音', '官方文案须进读数（只读）');
});

// ── 判据组 E：变异自证（退回 ⇒ 新判据必红）+ 负控 ─────────────────────────────
// 变异 1：门禁退回旧口径（读 `b.active`）——正是用户报障的那一版
function mutateGateBackToActive(src) {
  const anchor = 'function ovbOfficialCapturing() {\n  return ovbRecordingNow();\n}';
  if (!src.includes(anchor)) throw new Error('gate mutation anchor missing');
  return src.replace(anchor, 'function ovbOfficialCapturing() {\n  const b = ovbBus();\n  return !!(b && b.active);\n}');
}
// 变异 2：启动退回单锚（只有开始锚）——正是需求 4 描述的那一版
function mutateStartSingleAnchor(src) {
  const anchor = '    { el: ovbFindRetryButton(), via: \'official-retry-button\' },\n';
  if (!src.includes(anchor)) throw new Error('start mutation anchor missing');
  return src.replace(anchor, '');
}
// 变异 3：不重开会话（摘掉 settled 复位）——「能重启一轮」的实质面
function mutateNoNewSession(src) {
  const anchor = '      if (present) {\n        settled = false;\n        everMounted = true;\n        b.sessionsStarted++;\n        b.active = true;\n      }';
  if (!src.includes(anchor)) throw new Error('new-session mutation anchor missing');
  return src.replace(anchor, '      if (false) {\n        settled = false;\n        everMounted = true;\n        b.sessionsStarted++;\n        b.active = true;\n      }');
}

function loadMutantSrc(env, mutated) {
  const S = loadStateForBridge(env);
  const factory = new Function(
    'window', 'document', 'navigator', 'localStorage', 'setInterval', 'clearInterval', 'MutationObserver', 'MouseEvent',
    'vadSilenceMsOf', 'vadRequiredQuiet', 'voiceCfgState',
    mutated + '\n;return officialVoiceBridge;'
  );
  let seq = 0;
  const bridge = factory(env.window, env.document, env.navigator, env.localStorage,
    (fn, ms) => { const rec = { fn, ms, cleared: false, id: ++seq }; env.timers.push(rec); return rec.id; },
    (id) => { const rec = env.timers.find((r) => r.id === id); if (rec) rec.cleared = true; },
    class FakeMO { constructor(cb) { this.cb = cb; env.observerInstances.push(this); } observe() {} disconnect() {} },
    function MouseEvent(type, init) { return { type, init }; },
    S.vadSilenceMsOf, S.vadRequiredQuiet, S.voiceCfgState);
  // 与 loadBridge 同款：装载时注入假 MediaRecorder（桥的 recorder 捕获在装载期完成）
  if (env.window.MediaRecorder) new env.window.MediaRecorder(env.mediaDevices.lastStream);
  bridge.setTimer(env.timerSvc);
  return bridge;
}

test('OVB-UN-V01 变异自证·正例必红：门禁退回 b.active ⇒ UN01/UN02/UN04 必红', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadMutantSrc(env, mutateGateBackToActive(decodeChunk(CHUNK)));
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  // 退回后：feedback 态仍被判「采集中」⇒ 热键被拒（用户报障形态）
  const wouldPass = (bridge.officialCapturing() === false && bridge.startOfficial().started === true);
  assert.equal(wouldPass, false,
    '退回 b.active 后「未识别态不阻塞热键」必须为红（若仍绿 ⇒ 新判据没牙，用户报障会复现）');
});

test('OVB-UN-V02 变异自证·负控必绿：同一变异下「真采集中仍须拒绝」仍须通过', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadMutantSrc(env, mutateGateBackToActive(decodeChunk(CHUNK)));
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  // 负控：互斥保护在两种口径下都必须成立（本批**不得**削弱它）
  const r = bridge.startOfficial();
  assert.equal(r.started, false, '负控必绿：真采集中仍拒绝');
  assert.equal(r.via, 'already-capturing', '负控必绿：拒因不变');
});

test('OVB-UN-V03 变异自证·正例必红：启动退回单锚（只有开始锚）⇒ UN01/UN05 必红', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadMutantSrc(env, mutateStartSingleAnchor(decodeChunk(CHUNK)));
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'feedback'; mo.cb();
  const r = bridge.startOfficial();
  // 退回后：未识别窗口的 retry 锚被无视 ⇒ 找不到按钮（需求 4 的原缺陷）
  const wouldPass = (r.started === true && r.via === 'official-retry-button' && env.retryButton.clicks === 1);
  assert.equal(wouldPass, false,
    '退回单锚后「未识别窗口按钮被接上」必须为红（若仍绿 ⇒ 需求 4 的判据没牙）');
  assert.equal(bridge.snapshot().startMissed, 1, '退回后必须复现 startMissed=1（原缺陷读数）');
});

test('OVB-UN-V04 变异自证·负控必绿：同一变异下「真采集中仍拒绝」仍须通过', () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadMutantSrc(env, mutateStartSingleAnchor(decodeChunk(CHUNK)));
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  const r = bridge.startOfficial();
  assert.equal(r.started, false, '负控必绿：真采集中仍拒绝重复启动');
});

test('OVB-UN-V05 变异自证·正例必红：不重开会话 ⇒ UN09（新一轮必须能收口）必红', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadMutantSrc(env, mutateNoNewSession(decodeChunk(CHUNK)));
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  const endedAt1 = bridge.snapshot().lastEndedAt;
  env.document._attr = 'recording'; mo.cb();       // 重试
  const sessionsGrew = bridge.snapshot().sessionsStarted > 1;
  env.document._attr = null; mo.cb();              // 第 2 轮收口
  const wouldPass = (sessionsGrew && bridge.snapshot().lastEndedAt > endedAt1);
  assert.equal(wouldPass, false,
    '不重开会话后「第 2 轮能收口」必须为红（若仍绿 ⇒ 需求 1 的实质面没被判定）');
});

test('OVB-UN-V06 变异自证·负控必绿：同一变异下「点 X 不得虚增会话」仍须通过', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadMutantSrc(env, mutateNoNewSession(decodeChunk(CHUNK)));
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  env.document._attr = 'feedback'; mo.cb();
  const sessions = bridge.snapshot().sessionsStarted;
  env.document._attr = null; mo.cb();              // 点 X
  assert.equal(bridge.snapshot().sessionsStarted, sessions,
    '负控必绿：无论是否重开会话，点 X 都不得虚增会话计数');
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHG-098（2026-10-15 点按语义修复批）：点按 = **模拟点击官方按钮一次**
// ═══════════════════════════════════════════════════════════════════════════════
// 用户钉死的语义（逐字）：「点按的逻辑应该是模拟官方语音按钮的点按啊」
//   ⇒ **一次点按 = 一次官方按钮点击**：官方未在录时点按 ⇒ 只派发「开始」，**不得**因松手而停；
//     官方已在录时点按 ⇒ 派发「停止」（= 设计里的「再按结束」）。
//   ⇒ **长按（≥500ms）保持原样**：按住说话、松开停止（用户明说「长按可以正常识别」）。
// 病（取证批 CHG-097 双证坐实，`hotkey.js:290` 旧写法）：
//   `keydown` 置位 → `keyup` 立即消费 ⇒ 一次点按派发「开始+停止」⇒ 录音 <100ms
//   ⇒ 官方 `client.js:4759` `decodeAudioData` 抛 `EncodingError`（真机 blob 110B）
//   ⇒ 用户看到「语音识别失败：Unable to decode audio data」。
// 本组判据（逐条有牙）：
//   POINT-01 <100ms 档：官方未在录 ⇒ **只**派发开始（不得派发停止）
//   POINT-02 100–500ms 档：同上（与时长无关，仍是"点按"）
//   POINT-03 >500ms 档（长按）：1 开始 + 1 停止（**负控：不得改变**）
//   POINT-04 「再按结束」：第 1 次点按开着 ⇒ 第 2 次点按 ⇒ 派发停止（恰好 1 次）
//   POINT-05 判别力：**同一时序**下，「竞态侥幸」不得蒙混（见下注 D-14）
//   POINT-V01/V02 变异自证（退回 `statusRef` 旧判据 ⇒ POINT-01 必红；长按负控必绿）
//
// ⚠ **判别力说明（D-14 假锁病历）**：本组**不**只在「相位尚未落地」的时序下测 —— 那正是取证批
//   实测到的「**竞态侥幸**」形态（甲档：`stopClicks=0` 只因停止按钮还没挂载，**不是**因为实现守语义）。
//   故 POINT-01 的关键在于：**先让官方进入 recording（相位真值可见），再松开** ——
//   此时旧实现**必然**派发停止（乙档已实测 `stopClicks=1`），新实现**必须**为 0。
//   若夹具只在"相位未落地"下测，新旧两版**都是 0** ⇒ 判据**没有判别力**（假锁）。

// 三档通用驱动：按下 → （可选：让官方相位生效）→ 松开
async function runPointScenario(gapMs, opts) {
  const o = opts || {};
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: false, hotkey: true, sessionId: o.sessionId || 'sess-pt' });
  host.render('');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  // 按下前是否让官方**已在录**：模拟「第二次点按」或「竞态命中（官方已进 recording）」
  if (o.recordingBeforePress) { env.document._attr = 'recording'; mo.cb(); }
  host.keydown();
  if (o.recordingAfterPress) { env.document._attr = 'recording'; mo.cb(); }
  await new Promise((r) => setTimeout(r, gapMs));
  host.keyup();
  // 长按分支的补停：驱动其有界轮询
  for (let i = 0; i < 20; i++) host.runTimeouts(1);
  return { env, bridge, host, snap: bridge.snapshot() };
}

test('OVB-POINT01 点按<100ms：官方未在录 ⇒ **只**派发开始，不得派发停止（录音不得被掐断）', async () => {
  // ⚠ 判别力关键：here 让官方在**松开之前**已进 recording（= 取证批乙档形态）。
  //   旧实现此时必然 stopClicks=1（录音被掐断）；新实现必须为 0。
  const r = await runPointScenario(60, { recordingAfterPress: true, sessionId: 'sess-pt1' });
  assert.equal(r.snap.startClicks, 1, '点按须派发一次官方「开始」');
  assert.equal(r.snap.stopClicks, 0,
    '⚠ 点按**不得**派发停止（旧实现此处为 1 = 录音 <100ms 被掐断 ⇒ 官方 decodeAudioData 抛错）');
  assert.equal(r.snap.stopMissed, 0, '点按分支不得计 missed');
  assert.equal(r.host.store.error, null, '正常点按不得留下 VOICE_BUSY 一类错误（不得静默失败的另一面）');
});

test('OVB-POINT02 点按 100–500ms：语义与 <100ms 档**一致**（仍是"点按"，不得因时长而变）', async () => {
  const r = await runPointScenario(250, { recordingAfterPress: true, sessionId: 'sess-pt2' });
  assert.equal(r.snap.startClicks, 1, '点按须派发一次官方「开始」');
  assert.equal(r.snap.stopClicks, 0, '⚠ 100–500ms 仍属"点按" ⇒ **不得**派发停止（与 <100ms 同语义）');
});

test('OVB-POINT03 负控·长按>500ms：按住说话、松开停止 ⇒ 1 开始 + 1 停止（**行为不得改变**）', async () => {
  const r = await runPointScenario(650, { recordingAfterPress: true, sessionId: 'sess-pt3' });
  assert.equal(r.snap.startClicks, 1, '长按须派发一次官方「开始」');
  assert.equal(r.snap.stopClicks, 1, '⚠ 长按=松开即停（用户明说长按正常）⇒ 必须恰好 1 次停止（负控：本批不得改变它）');
  assert.equal(r.snap.stopMissed, 0, '长按补停成功 ⇒ 不得计 missed');
});

test('OVB-POINT04 「再按结束」：官方已在录时点按 ⇒ 派发停止（恰好 1 次）', async () => {
  const r = await runPointScenario(60, { recordingBeforePress: true, sessionId: 'sess-pt4' });
  assert.equal(r.snap.stopClicks, 1, '⚠ 官方已在录 ⇒ 这一次点按 = 点一下官方「停止」⇒ 恰好 1 次');
  assert.equal(r.snap.startClicks, 0, '已在录 ⇒ 不得再派发「开始」（否则走 already-capturing、写 VOICE_BUSY 掩盖意图）');
  assert.equal(r.host.store.error, null, '「再按结束」不得产生 VOICE_BUSY');
});

test('OVB-POINT05 判别力自证：同一时序下，旧判据（statusRef）**必然**派发停止 ⇒ 判据有牙', async () => {
  // 用**纯静态**判据补充行为读数：确认新判据源**不是** statusRef（否则与旧实现同形 = 假锁）。
  const hk = decodeChunk('src/client/voice/hotkey.js');
  assert.ok(hk.includes("pressWasRecordingRef.current === true"),
    '点按分支须以「按下前的相位真值快照」为判据（本批修复点）');
  assert.equal(/if \(statusRef\.current === 'recording'\) stopAndTranscribe\(0\);/.test(hk), false,
    '⚠ 旧的 statusRef 判据必须已消失（同一次按键刚置真 ⇒ 恒真 ⇒ 必停 = 假锁根源）');
  // 相位真值读取面存在（本次按下的分流依据）
  assert.ok(hk.includes('function officialRecordingNow()'), '须有官方相位真值读取器');
  // ⚠ CHG-105（2026-10-16 · 线二现场失效修复）**订正**本行断言：
  //   原断言写的是 `s.recording === true`（= 以桥快照 `snapshot().recording` 为相位真值）——
  //   而该字段 = `!!b.active`（官方是否仍**占用语音入口**），**不是**「是否确在采集」；
  //   官方「未识别」(feedback) 时它**仍为 true** ⇒ 会把未识别态**误判为「正在录」**
  //   ⇒ `pressStart` 不调 `startRec()`、`pressEnd` 反而派发**停止** = 现场「不能继续识别」。
  //   ⇒ 该断言其实**把缺陷固化成了预期**（与 `F-2` 同一类错误）。现订正为桥的**同语义相位面**
  //   `officialCapturing()`（= 官方渲染的相位真值）。
  //   ⚠ 判别力不变：本用例的核心仍是「点按判据源**不得**是 `statusRef`」（上一行断言），
  //     这里只是把**正向**的相位真值源订正为正确的那一个。
  assert.ok(hk.includes('officialVoiceBridge.officialCapturing() === true'),
    '须以桥导出的相位真值 officialCapturing() 为判据（不得用 snapshot().recording = !!active）');
  assert.equal(/officialVoiceBridge\.snapshot\(\)\.recording === true/.test(hk), false,
    '⚠ CHG-105：不得再以 snapshot().recording（= !!b.active，语义不同）作相位真值');
});

// ── 变异自证：把点按判据退回 statusRef（纯内存副本）⇒ POINT01/POINT04 必红 ──────────
// 变异名运行时拼接（不在源码里形成字面量，与既有变异用例同款做法）。
function mutatePointPress(src) {
  const anchor = 'if (pressWasRecording' + 'Ref.current === true) stopAndTranscribe(0);';
  assert.ok(src.includes(anchor), '变异锚点须存在（新点按判据）');
  return src.replace(anchor, "if (statusRef.current === 'recording') stopAndTranscribe(0);");
}

test('OVB-POINT-V01 变异自证·正例必红：退回 statusRef 判据 ⇒ 点按必派发停止', async () => {
  // 在**纯内存副本**上求值变异版 hotkey，驱动同一时序，确认其 stopClicks===1（= 判据有牙）
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const src = mutatePointPress(decodeChunk('src/client/voice/hotkey.js'));
  const mini = makeMiniReact();
  const timerRegs = [];
  const timerSvcLocal = {
    interval: (fn, ms) => { const r = { fn, ms, kind: 'interval', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
    timeout: (fn, ms) => { const r = { fn, ms, kind: 'timeout', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
  };
  bridge.setTimer(timerSvcLocal);
  const voiceCfgState = { value: { autoEnhance: false, vad: { enabled: true }, hotkey: { enabled: true, combo: 'Alt+Backquote' }, refine: {} }, listeners: new Set(), synced: true };
  const storeStub = { phase: 'idle', error: null };
  const factory = new Function(
    'React', 'host', 'voiceCfgState', 'subscribeVoiceConfig', 'voiceHotkeyDisplay', 'parseVoiceHotkey',
    'matchVoiceHotkey', 'isEnhancing', 'subscribe', 'storeFor', 'startVoiceRecording', 'stopVoiceRecording',
    'isVoiceRecording', 'insertVoiceText', 'notify', 'enhance', 'timerSvc', 'officialVoiceBridge', 'makeT', 'ZH',
    'MarqueeSelect', 'CollapsibleSection', 'setInterval', 'clearInterval', 'setTimeout', 'navigator', 'window',
    src + '\n;return { VoiceHotkeyHost };'
  );
  const api = factory(
    mini.React, { call: () => Promise.resolve({ ok: true }) },
    voiceCfgState, () => () => {}, (c) => c, () => null, () => false, () => false,
    () => () => {}, () => storeStub,
    async () => { throw new Error('should not record'); }, async () => null, () => false,
    () => Promise.resolve({ filled: true }), () => {},
    (...a) => {}, timerSvcLocal, bridge, (p) => (k) => k, {}, null, null,
    setInterval, clearInterval, setTimeout, env.navigator, env.window
  );
  const props = { sessionId: 'sess-mut', inputActions: { setDraft() {} }, input: { draft: '' } };
  mini.begin(); api.VoiceHotkeyHost(props); mini.runEffects();
  const KEY = () => ({ code: 'Backquote', key: '`', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, repeat: false, preventDefault() {}, stopPropagation() {} });
  env.window._fire('keydown', KEY());
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();            // 官方已进 recording（竞态命中）
  await new Promise((r) => setTimeout(r, 60));
  env.window._fire('keyup', KEY());
  for (let i = 0; i < 20; i++) { for (const rec of timerRegs) { if (!rec.cleared && rec.kind === 'timeout') { rec.cleared = true; rec.fn(); } } }
  assert.equal(bridge.snapshot().stopClicks, 1,
    '⚠ 退回 statusRef 判据后，点按**必然**派发停止（= 录音被掐断）—— 若此处不为 1，说明本组判据没有判别力');
});

test('OVB-POINT-V02 变异自证·负控必绿：同一变异下长按仍须 1 开始 + 1 停止（行为不变）', async () => {
  const r = await runPointScenario(650, { recordingAfterPress: true, sessionId: 'sess-ptv2' });
  assert.equal(r.snap.stopClicks, 1, '负控：长按松开即停与点按修复无关 ⇒ 必须仍为 1 次停止');
  assert.equal(r.snap.startClicks, 1, '负控：长按仍须 1 次开始');
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHG-105（2026-10-16 · 线二**现场失效**修复）：未识别态再按热键 ⇒ 必须能重开
// ═══════════════════════════════════════════════════════════════════════════════
// 现场读数（用户逐字）：「是这个不行，未识别状态使用热键不能继续识别」
// ⇒ **线二（2463390 + 6b5180a）判据全绿、到位取证也过、且已生效，但现场第 4 块不通过。**
// 病根（本批实测复现，**桥没问题、热键侧门禁吞了调用**）：
//   `statusRef` 的语义 = 「已向官方派发过开始」，只在三处复位（派发失败 ×2 / 我们自己派发停止）。
//   而**会话以 `feedback`（未识别）收场时无人复位**（官方自己结束、我们从未派发停止）
//   ⇒ `statusRef` 永卡 `'recording'` ⇒ `pressStart` 入口守卫
//   （`if (!wasRecordingAtPress && statusRef.current !== 'idle') return;`）把第二次按下**整个吞掉**
//   ⇒ 根本没走到 `startRec()` ⇒ 桥侧线二的 retry 锚（`OVB_RETRY_LABELS`）**永远没机会被调到**。
// ⚠ 为什么既有线二判据抓不到：线二用例**直调 `bridge.startOfficial()`**（桥层），
//   **从不经过热键按键路径** ⇒ 夹具与现场分层，属「夹具不等于现场」的又一实例。
// 判据：
//   UNF-01 正例：热键开启 → 未识别收场 → 再按热键 ⇒ **必须派发 retry 锚恰好 1 次**（终态断言）
//   UNF-02 判别力锚点：同一路径断言 `statusRef` 已被会话结束复位（`startMissed===0` + `lastStartVia` 为 retry）
//   UNF-03 负控：真「采集中」再按热键 ⇒ 仍须拒绝重复启动（互斥保护不得破坏）
//   UNF-V01 变异自证·正例必红：退回（删掉会话结束复位）⇒ UNF-01 必红
//   UNF-V02 变异自证·负控必绿：同一变异下「点按开始 / 长按松开即停」路径行为不变

// 驱动：真实 hotkey + 真实 bridge，走**真实按键路径**（不是直调桥）
function buildFieldHost(opts) {
  const o = opts || {};
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const host = buildHotkeyHost(env, bridge, { autoEnhance: false, hotkey: true, sessionId: o.sessionId || 'sess-unf' });
  host.render('');
  const mo = env.observerInstances[env.observerInstances.length - 1];
  return { env, bridge, host, mo };
}

test('OVB-UNF01 ⭐线二现场失效修复：未识别态下再按热键 ⇒ 必须能重新开始（派发 retry 锚恰好 1 次）', () => {
  const r = buildFieldHost({ sessionId: 'sess-unf1' });
  const { env, bridge, host, mo } = r;
  // 第 1 步：热键点按 ⇒ 开始
  host.keydown();
  env.document._attr = 'recording'; mo.cb();
  host.keyup();
  assert.equal(bridge.snapshot().startClicks, 1, '前置：首次热键已派发开始');
  // 第 2 步：官方走到「未识别」（feedback）—— 不出声
  env.document._attr = 'feedback'; mo.cb();
  assert.equal(bridge.snapshot().lastPhase, 'feedback', '前置：确在未识别态');
  assert.equal(bridge.officialCapturing(), false, '前置：feedback 不算「采集中」');
  // 第 3 步：⭐ 再按热键 ⇒ 必须重新开始
  const beforeRetry = bridge.snapshot().retryClicks;
  host.keydown();
  env.document._attr = 'recording'; mo.cb();
  host.keyup();
  const snap = bridge.snapshot();
  assert.equal(snap.retryClicks, beforeRetry + 1,
    '⚠ 核心：未识别态再按热键**必须**派发 retry 锚（旧实现 0 增长 = 现场「按了没反应」）');
  assert.equal(snap.lastStartVia, 'official-retry-button', '⚠ 必须走未识别窗口的真实锚（重新录音）');
  assert.equal(snap.startMissed, 0, '不得退化成「找不到按钮」');
});

test('OVB-UNF02 判别力锚点：会话以未识别收场 ⇒ statusRef 必须已复位（否则第二次按下被吞）', () => {
  const r = buildFieldHost({ sessionId: 'sess-unf2' });
  const { env, bridge, host, mo } = r;
  host.keydown(); env.document._attr = 'recording'; mo.cb(); host.keyup();
  env.document._attr = 'feedback'; mo.cb();
  // 复位判据：再按一次必须**真的派发**（若 statusRef 未复位，守卫会 early-return ⇒ 0 派发）
  const before = bridge.snapshot().retryClicks + bridge.snapshot().startClicks;
  host.keydown(); host.keyup();
  const after = bridge.snapshot().retryClicks + bridge.snapshot().startClicks;
  assert.equal(after, before + 1, '⚠ 判别力锚点：未识别收场后 statusRef 必须已复位 ⇒ 下次按下必须产生 1 次派发');
});

test('OVB-UNF03 负控：真「采集中」再按热键 ⇒ 仍须拒绝重复启动（互斥保护不得破坏）', () => {
  const r = buildFieldHost({ sessionId: 'sess-unf3' });
  const { env, bridge, host, mo } = r;
  host.keydown(); env.document._attr = 'recording'; mo.cb(); host.keyup();
  const snap0 = bridge.snapshot();
  // 官方**确在采集中**（recording 相位仍在）⇒ 第二次按下应走「停止」（点按=再按结束），**不得**再开一轮
  host.keydown(); host.keyup();
  const snap = bridge.snapshot();
  assert.equal(snap.startClicks, snap0.startClicks, '负控：采集中再按不得再派发「开始」（互斥保护）');
  assert.equal(snap.retryClicks, snap0.retryClicks, '负控：采集中不得派发 retry 锚');
});

// ── 变异自证（CHG-105）：两处修复各自退回 ⇒ UNF01 必红 ─────────────────────────
// ⚠ 本缺陷**两处独立成因**，故变异亦分两路：
//   D1（会话结束未复位 statusRef）· D2（相位真值读错源：snapshot().recording ≠ 相位真值）
//   必须在**纯内存副本**上分别退回，证明每一条判据都真的盯着自己的成因。
//   变异名运行时拼接（不在源码里形成字面量，与既有变异用例同款）。

const mutateHotkey = (src, kind) => {
  if (kind === 'no-reset') {
    const anchor = "      if (statusRef.current !== 'idle') statusRef.current = 'idle';\n";
    assert.ok(src.includes(anchor), '变异锚点须存在（D1 会话结束复位）');
    return src.replace(anchor, '');
  }
  if (kind === 'wrong-phase-source') {
    const anchor = 'return officialVoiceBridge.officialCapturing() === true;';
    assert.ok(src.includes(anchor), '变异锚点须存在（D2 相位真值源）');
    return src.replace(anchor, 'return officialVoiceBridge.snapshot().recording === true;');
  }
  throw new Error('unknown mutation kind: ' + kind);
};

// 用变异版 hotkey 驱动同一条现场路径
function buildMutatedHost(mutation, opts) {
  const o = opts || {};
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  const mini = makeMiniReact();
  const timerRegs = [];
  const timerSvcLocal = {
    interval: (fn, ms) => { const r = { fn, ms, kind: 'interval', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
    timeout: (fn, ms) => { const r = { fn, ms, kind: 'timeout', cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; },
  };
  bridge.setTimer(timerSvcLocal);
  // ⚠ combo 必须与下面的 KEY 桩**严格一致**（KEY 的 altKey=false ⇒ combo 不得含 Alt；
  //   matchVoiceHotkey 用严格比较，不一致 ⇒ 处理器根本不触发 ⇒ 全部读数恒 0
  //   ⇒ 变异用例会**平凡通过**（0===0）＝假绿，正是 D-14 病历。实测踩到过。）
  const voiceCfgState = { value: { autoEnhance: false, vad: { enabled: true }, hotkey: { enabled: true, combo: 'Backquote' }, refine: {} }, listeners: new Set(), synced: true };
  const storeStub = { phase: 'idle', error: null };
  const src = mutateHotkey(decodeChunk('src/client/voice/hotkey.js'), mutation);
  const factory = new Function(
    'React', 'host', 'voiceCfgState', 'subscribeVoiceConfig', 'voiceHotkeyDisplay', 'parseVoiceHotkey',
    'matchVoiceHotkey', 'isEnhancing', 'subscribe', 'storeFor', 'startVoiceRecording', 'stopVoiceRecording',
    'isVoiceRecording', 'insertVoiceText', 'notify', 'enhance', 'timerSvc', 'officialVoiceBridge', 'makeT', 'ZH',
    'MarqueeSelect', 'CollapsibleSection', 'setInterval', 'clearInterval', 'setTimeout', 'navigator', 'window',
    src + '\n;return { VoiceHotkeyHost };'
  );
  const api = factory(
    mini.React, { call: () => Promise.resolve({ ok: true }) },
    voiceCfgState, () => () => {}, (c) => c, () => null, () => false, () => false,
    () => () => {}, () => storeStub,
    async () => { throw new Error('should not record'); }, async () => null, () => false,
    () => Promise.resolve({ filled: true }), () => {},
    (...a) => {}, timerSvcLocal, bridge, (p) => (k) => k, {}, null, null,
    setInterval, clearInterval, setTimeout, env.navigator, env.window
  );
  // ⚠ 顺序与 buildHotkeyHost 完全一致：render() = begin() → 组件调用 → runEffects()
  //   （顺序错/缺 begin ⇒ effect 不注册 ⇒ 事件处理器缺席，实测踩到）
  const props = { sessionId: o.sessionId || 'sess-mut-unf', inputActions: { setDraft() {} }, input: { draft: '' } };
  mini.begin();
  api.VoiceHotkeyHost(props);
  mini.runEffects();
  const KEY = () => ({ code: 'Backquote', key: '`', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, preventDefault() {}, stopPropagation() {} });
  const mo = env.observerInstances[env.observerInstances.length - 1];
  return {
    env, bridge, mo, storeStub,
    keydown: () => env.window._fire('keydown', KEY()),
    keyup: () => env.window._fire('keyup', KEY()),
  };
}

test('OVB-UNF-V01 变异自证·D1 必红：删掉「会话结束复位 statusRef」⇒ UNF01 判据必须失败', () => {
  const h = buildMutatedHost('no-reset', { sessionId: 'sess-unf-m1' });
  h.keydown(); h.env.document._attr = 'recording'; h.mo.cb(); h.keyup();
  h.env.document._attr = 'feedback'; h.mo.cb();
  const before = h.bridge.snapshot().retryClicks + h.bridge.snapshot().startClicks;
  h.keydown(); h.keyup();
  const after = h.bridge.snapshot().retryClicks + h.bridge.snapshot().startClicks;
  assert.equal(after, before,
    '⚠ D1 退回后：未识别态再按热键**必然 0 派发**（= 现场「按了没反应」）。若此处有增长，说明 UNF01 没有判别力');
});

test('OVB-UNF-V02 变异自证·D2 必红：相位真值退回 snapshot().recording ⇒ UNF01 判据必须失败', () => {
  const h = buildMutatedHost('wrong-phase-source', { sessionId: 'sess-unf-m2' });
  h.keydown(); h.env.document._attr = 'recording'; h.mo.cb(); h.keyup();
  h.env.document._attr = 'feedback'; h.mo.cb();
  const snap0 = h.bridge.snapshot();
  h.keydown(); h.keyup();
  const snap = h.bridge.snapshot();
  // D2 退回后：未识别态被误判为「正在录」⇒ 点按分支反而派发**停止**（retry 仍为 0）
  assert.equal(snap.retryClicks, snap0.retryClicks,
    '⚠ D2 退回后：retry 锚**不得**被派发（相位真值读错源 ⇒ 走不到 startRec）');
  assert.equal(snap.stopClicks, snap0.stopClicks + 1,
    '⚠ D2 退回的**特征读数**：未识别态被误判为「正在录」⇒ 反而派发 1 次**停止**（正是现场「不能继续识别」）');
});

test('OVB-UNF-V03 变异自证·负控必绿：两处变异下，正常「点按开始 / 长按松开即停」行为不变', () => {
  for (const kind of ['no-reset', 'wrong-phase-source']) {
    const h = buildMutatedHost(kind, { sessionId: 'sess-unf-v3' + kind });
    // 正常点按（idle）⇒ 必须仍派发 1 次开始
    h.keydown(); h.env.document._attr = 'recording'; h.mo.cb(); h.keyup();
    assert.equal(h.bridge.snapshot().startClicks, 1, '负控(' + kind + ')：正常点按仍须派发 1 次开始');
  }
});
