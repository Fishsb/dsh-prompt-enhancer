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

  // 官方停止按钮（A2 兜底）：官方 zh 文案「停止并识别」+ 官方 DOM 相位锚
  const stopButton = {
    disabled: false, clicks: 0,
    getAttribute: (n) => (n === 'aria-label' ? '停止并识别' : null),
    dispatchEvent() { this.clicks++; return true; },
    click() { this.clicks++; },
  };
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
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'button') return o.noStopButton ? [] : [stopButton];
      return [];
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
    mediaDevices, originalGum, recorderInstances, stopButton, frames,
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

// ───────────────────────────── 正例：A1 停官方 ─────────────────────────────
test('OVB-P01 正例：假件驱动到静音达标 ⇒ 触发官方 stop（A1 持 MediaRecorder 实例）', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  assert.equal(bridge.install(), true, '安装应成功');
  // 官方采集：走标准接口（经包装器）
  const stream = await env.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
  assert.ok(stream, '官方拿到 stream');
  // 官方 start() 会 new MediaRecorder(stream) 然后 .start()（先构造后 start ⇒ 包装器此刻才捕获）
  const rec = new env.window.MediaRecorder(stream);
  rec.start();
  assert.equal(env.mediaDevices.lastRecorder, rec, '包装器须捕获到正在录音的官方实例');
  const ticks = runVad(env);
  assert.ok(ticks >= 20, 'VAD 至少跑到静音帧数（实际 tick ' + ticks + '）');
  assert.equal(rec.state, 'inactive', '官方 MediaRecorder 必须已被 stop（A1 路径）');
  assert.equal(rec.stopCalls, 1, '官方 stop 恰好被调用 1 次（不重复停）');
});

test('OVB-P02 A2 兜底：无 MediaRecorder 实例时派发点击官方停止按钮', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  await env.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  env.mediaDevices.lastRecorder = null; // 模拟 A1 不可用（官方未走 MediaRecorder / 包装器未捕获）
  runVad(env);
  assert.equal(env.stopButton.clicks, 1, '官方停止按钮必须被点击 1 次（A2 路径）');
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

// ───────────────────────────── 不静默失效 ─────────────────────────────
test('OVB-D01 不静默：官方会话但包装器从未被调用 ⇒ 该状态可被观察到', async () => {
  const env = makeFakeEnv({ recordingPhase: true });
  const bridge = loadBridge(env);
  bridge.install();
  // 官方绕开包装器自行采集（模拟官方改走别处 / 其它插件影子采集）
  const mo = env.observerInstances[env.observerInstances.length - 1];
  env.document._attr = 'recording';
  mo.cb();
  const snap = bridge.snapshot();
  assert.equal(snap.sessionsStarted, 1, '须记录观察到 1 次官方会话');
  assert.equal(snap.sessionsMissed, 1, '包装器从未被调用 ⇒ 必须计为 missed');
  assert.ok(snap.lastMissedAt > 0, '须记时间戳（设置页据此显示「未观测到官方采集」）');
  assert.notEqual(snap.sessionsMissed, 0, '不得静默（0 = 静默失效）');
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

test('OVB-W02 接线：apply 安装 + 卸载（HMR）+ 热键互斥标记均在位', () => {
  const app = decodeChunk('src/client/app.js');
  assert.ok(app.includes('officialVoiceBridge.install()'), 'apply 缺安装调用');
  assert.ok(app.includes('officialVoiceBridge.uninstall()'), 'apply 缺卸载（HMR 恢复）');
  assert.ok(app.includes('officialVoiceBridge.setTimer'), 'apply 缺 timer 注入');
  const hk = decodeChunk('src/client/voice/hotkey.js');
  assert.ok(hk.includes('officialVoiceBridge.officialCapturing()'), '热键缺官方采集中判定（互斥方向二）');
  assert.ok(hk.includes("st.error = 'VOICE_BUSY'"), '热键缺「录音中」可见提示');
  assert.ok(hk.includes('setSelfCapture(true)'), '热键缺自控开始标记（互斥方向一）');
  assert.ok(hk.includes('setSelfCapture(false)'), '热键缺自控结束释放');
});

test('OVB-W03 接线：设置页诊断区在位（不静默失效的可见面）且有 i18n 键', () => {
  const vs = decodeChunk('src/client/voice/voice-section.js');
  assert.ok(vs.includes('function OfficialVoiceDiag'), '设置段缺诊断组件');
  assert.ok(vs.includes("React.createElement(OfficialVoiceDiag, props)"), '诊断组件未进入渲染路径');
  assert.ok(vs.includes("t('voiceOfficialMissed')"), '缺「未观测到官方采集」文案引用');
  const i18n = decodeChunk('src/client/i18n.js');
  for (const k of ['voiceOfficialDiagTitle', 'voiceOfficialActive', 'voiceOfficialMissed', 'voiceOfficialAbandon', 'voiceOfficialSelfCapture', 'voiceOfficialArmed', 'voiceOfficialDisabled']) {
    assert.ok(i18n.includes(k + ":"), 'i18n 缺键 ' + k);
  }
  // ZH/EN 键集必须相等（S-7）
  const zh = i18n.split('const EN = {')[0];
  const en = 'const EN = {' + i18n.split('const EN = {')[1];
  const zk = (zh.match(/voiceOfficial[A-Za-z]+:/g) || []).sort();
  const ek = (en.match(/voiceOfficial[A-Za-z]+:/g) || []).sort();
  assert.deepEqual(zk, ek, 'voiceOfficial* ZH/EN 键集必须相等（S-7）');
  assert.equal(zk.length, 7, 'voiceOfficial* 键数锁定为 7（严格 ===）');
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
