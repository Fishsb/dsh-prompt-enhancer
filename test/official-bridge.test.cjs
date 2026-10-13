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

const decodeChunk = (rel) => {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // 行首锚定（chunk 头部注释里可能含代码样文本，裸 module.exports 正则会被误导）
  const m = raw.match(/(?:^|\n)module\.exports = "([\s\S]*)";?\s*$/);
  if (!m) throw new Error('chunk wrapper mismatch: ' + rel);
  return JSON.parse('"' + m[1] + '"');
};

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
  // 官方失败出口（相位 feedback + .activityMessage 文案节点，官方自带、插件只读）
  const feedbackNode = {};
  const messageNode = { textContent: o.feedbackText || '未识别到语音' };
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
  class FakeAudioContext {
    constructor() { this.state = 'running'; }
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
    addEventListener() {}, removeEventListener() {},
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
      if (sel === '[data-voice-activity="feedback"] .activityMessage') return documentStub._attr === 'feedback' ? messageNode : null;
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
    mediaDevices, originalGum, recorderInstances, stopButton, startButton, feedbackNode, frames,
    driveTicks: (n) => { let i = 0; for (const r of timers) { /* noop */ } return i; },
  };
}

// 求值 chunk：注入假全局，返回桥对象 + 观察句柄
function loadBridge(env) {
  const src = decodeChunk(CHUNK);
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

test('OVB-P03 显式降级：A1/A2 都不可用 ⇒ stopped=false + 记录降级原因（不假装已停）', async () => {
  const env = makeFakeEnv({ recordingPhase: true, noStopButton: true });
  const bridge = loadBridge(env);
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const r = bridge.stopOfficial();
  assert.equal(r.stopped, false, '不得假装已停');
  assert.equal(r.via, 'abandoned', '须走显式降级路径');
  assert.ok(bridge.snapshot().abandonReason, '必须记录降级原因');
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

// ───────────────── 官方失败出口（feedback）· TASK §3.3 缺口修复 ─────────────────
test('OVB-F01 失败出口：相位 feedback ⇒ 记为失败收尾，且**不**被当作「已结束等写回」', () => {
  const env = makeFakeEnv({ recordingPhase: true, feedbackText: '未识别到语音' });
  const bridge = loadBridge(env);
  bridge.install();
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();       // 进入采集
  env.document._attr = 'feedback'; mo.cb();        // 官方失败出口
  const snap = bridge.snapshot();
  assert.equal(snap.feedbackSeen, 1, '必须识别出官方自带的失败出口（恰好 1 次）');
  assert.equal(snap.endedInFeedback, true, '失败收尾标记须置位（订阅方据此不进入等写回）');
  assert.equal(snap.feedbackMessage, '未识别到语音', '失败文案（.activityMessage）须进诊断读数');
  assert.equal(snap.lastEndedAt, 0, '失败出口节点不消失 ⇒ 不得伪装成「已结束」（旧缺口正是按已结束等写回）');
  assert.equal(bridge.officialCapturing(), true, '失败出口仍处采集态（须等用户关闭/重试）');
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
  const timerSvcLocal = { interval: (fn, ms) => { const r = { fn, ms, cleared: false }; timerRegs.push(r); return () => { r.cleared = true; }; } };
  bridge.setTimer(timerSvcLocal);
  const voiceCfgState = { value: { autoEnhance: o.autoEnhance === true, vad: { enabled: true }, hotkey: { enabled: false, combo: '' }, refine: {} }, listeners: new Set(), synced: true };
  const enhanceCalls = [];
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
    () => () => {}, () => ({ phase: 'idle' }),
    async () => { throw new Error('should not record'); }, async () => null, () => false,
    () => Promise.resolve({ filled: true }), () => {},
    (...a) => { enhanceCalls.push(a); },   // enhance 桩
    timerSvcLocal, bridge, (p) => (k) => k, {}, null, null,
    setInterval, clearInterval, setTimeout, env.navigator, env.window
  );
  const props = { sessionId: o.sessionId || 'sess-x', inputActions: { setDraft() {} }, input: { draft: o.draft0 || '' } };
  const render = (draft) => { if (draft !== undefined) props.input = { draft }; mini.begin(); api.VoiceHotkeyHost(props); mini.runEffects(); };
  return { render, props, enhanceCalls, timerRegs, voiceCfgState, mini };
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
  assert.ok(vs.includes("t('voiceOfficialStartMissed')"), '缺「未能派发点击官方开始按钮」分支（不得静默失败）');
  assert.ok(vs.includes("t('voiceOfficialSelfCapture')"), '缺 selfCapture 分支（D-2 修复）');
  assert.ok(vs.includes('snap.sessionsStarted > 0'), 'D-1 修复须以官方会话计数分支（严格可判别）');
  const i18n = decodeChunk('src/client/i18n.js');
  for (const k of ['voiceOfficialDiagTitle', 'voiceOfficialActive', 'voiceOfficialMissed', 'voiceOfficialAbandon', 'voiceOfficialSelfCapture', 'voiceOfficialArmed', 'voiceOfficialDisabled',
    'voiceOfficialVerified', 'voiceOfficialStartMissed', 'voiceOfficialFeedback', 'voiceOfficialFeedbackSeen']) {
    assert.ok(i18n.includes(k + ":"), 'i18n 缺键 ' + k);
  }
  // ZH/EN 键集必须相等（S-7）
  const zh = i18n.split('const EN = {')[0];
  const en = 'const EN = {' + i18n.split('const EN = {')[1];
  const zk = (zh.match(/voiceOfficial[A-Za-z]+:/g) || []).sort();
  const ek = (en.match(/voiceOfficial[A-Za-z]+:/g) || []).sort();
  assert.deepEqual(zk, ek, 'voiceOfficial* ZH/EN 键集必须相等（S-7）');
  assert.equal(zk.length, 11, 'voiceOfficial* 键数锁定为 11（严格 ===：7 原有 + 4 本批新增）');
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
  const anchor = 'if (b.firstCallAt === callAtSessionStart) {';
  // 变异 = 精确复现旧口径：按**上升沿快照**（callAtSessionStart）判定，而不是收口时的实况
  const kill = 'if (callAtSessionStart === 0) {';
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
  // 模拟实测竞态：相位先到，随后包装才落地 ⇒ 退回旧口径会把真命中误报为 missed
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording'; mo.cb();
  bridge.setSelfCapture(false);
  return env.navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(() => {
    env.document._attr = null; mo.cb();
    const snap = bridge.snapshot();
    assert.equal(snap.firstCallAt > 0, true, '前置：包装确实落地过');
    assert.equal(snap.sessionsMissed > 0, true, '退回旧口径后必须误报 missed（若仍为 0 ⇒ 竞态判据没牙）');
  });
});
