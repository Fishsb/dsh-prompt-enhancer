'use strict';

// 官方语音桥普通模块（构建期由客户端运行时内联）。
// 浏览器环境与语音配置由调用方显式注入；桥的公开 API 与诊断读数不变。
function createOfficialVoiceBridge(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const window = d.window;
  const document = d.document;
  const navigator = d.navigator;
  const MutationObserver = d.MutationObserver;
  const voiceCfgState = d.voiceCfgState;
  const vadRequiredQuiet = d.vadRequiredQuiet;
  const vadSilenceMsOf = d.vadSilenceMsOf;
// P2-补做（2026-10-13 · CHG-011 / §4.6.2.6 · UD-0014 选 B）：官方录音路径增值桥。
// P2-补做·热键改走官方路径（2026-10-13 · UD-0016 · CHG-011）：
//   **热键 = 远程按一下官方录制按钮 = 一条链、一个状态** ⇒ 本桥新增**启动**能力
//   （`startOfficial()`：派发点击官方开始按钮），并把**停止**的第一优先改为
//   「派发点击官方停止按钮」（语义校验见下），插件自有采集链退居兜底。
//
// 目的：用户点**官方**麦克风按钮、或按**插件热键**时，本插件的两项增值——**静音监测（说完自动停）**
//   与**自动增强**——同样生效，且**走官方同一条链**（相位/电平/停止/上限/转写/写回全归官方）。
// 性质：**知情的高侵入方案**（§4.6.2.6 E5）——包装的是**浏览器标准 API**
//   （`navigator.mediaDevices.getUserMedia` / `MediaRecorder`），并对**官方渲染出来的按钮**
//   派发点击（等价用户按下）；**不改官方任何源码、不注入官方模块、不依赖其私有变量**
//   （官方只经公开 API 调用 ⇒ 不触红线）。
// 定位（UD-0014 第 2 条 / UD-0005 总纲）：**只做增值层的对齐**——采集/识别/写回**全部仍归官方**，
//   插件不接管、不遮蔽、不抢槽位、不恢复自建 🎤（否 C）。
//
// 三条不变量（改本文件时必须保持）：
//   ① **只观测不改行为**：`getUserMedia` 包装原样调用原函数、原样返回原结果（同一性保持，绝不改 stream / 不改参数）。
//   ② **停止必须走完官方链**：官方 `finish()`（相位收尾 → `capture.stop()` → 转写 → 写回）**只能**由
//      官方停止按钮触发 ⇒ 停止第一优先 = 派发点击官方停止按钮；`MediaRecorder.stop()` 仅是兜底
//      （实测语义：官方 `Recording.stop()` 不被 `MediaRecorder.stop()` 触发 ⇒ 单独调它**不会**走 `finish()`）。
//   ③ **不得静默失效**（§4.6.2.6 D）：任何一条失效都必须**可被用户看到**（设置页诊断区），不是只写日志。
//
// 与自建采集链的关系（UD-0016 第 2 条）：自建采集链已**退役**（`recorder.js`/热键模块不再自行
//   取麦、录音、停止、调 `voice/transcribe`）⇒ **不再需要「自控采集」互斥**；但 `setSelfCapture`
//   作为**外部显式声明**保留（有热键在录时，本桥不介入其采集），语义见函数注释。
const OVB_NS = '__dshPeOfficialBridge';
const OVB_REGION = 'dsh-official-voice-activity';
// ⚠ 2026-10-17（判停修复批 · CHG-178）：**绝对阈值下界 OVB_THRESHOLD = 0.025 已拆除**。
//   它不是调小一点就能完事的参数：作为 Math.max() 的下界，它让阈值在底噪 < 0.01 时
//   **完全不再跟随底噪** ⇒ 正常/偏小音量过不了门（用户必须很大声），并被 heardSpeech 闩锁
//   放大成「一降就停」。⇒ 判据改为**相对量**（噪声底 × 倍率），下限改为**与测量分辨率挂钩**。
//   ⚠ 拆的是「绝对下限」这一形态，不是换一个更小的常数（那只是把复发点挪位置）。
const OVB_NOISE_FACTOR = 2.5;          // 开阈倍率（阈值 = 噪声底 × 该值；语义仍为相对倍率）
const OVB_HYSTERESIS = 0.6;            // 关阈 = 开阈 × 该系数（迟滞带内的帧不累计静音 = hangover）
const OVB_THRESHOLD_MAX = 0.2;         // 阈值上限（语义不变）
const OVB_QUANT_STEP_8BIT = 1 / 256;   // 8-bit 路径的 **RMS 分辨率** ≈ 一个幅度台阶(1/128)的一半
const OVB_FLOAT_RESOLUTION = 1 / 32768; // float32 容器的有效分辨率 = 16-bit PCM 台阶（2^-15）
//   ⚠ 依据：MediaStreamTrack 虽以 float32 传输，但采集设备的分辨率上限就是 16-bit；
//     float32 容器不会凭空产生更多可测台阶 ⇒ 拿设备分辨率作下限，才谈得上量得出来。
const OVB_RESOLUTION_STEPS = 1;        // 阈值下限 = 分辨率 × 该步数（低于一个台阶的阈值量不出来）
// 噪声底 = **滑动最小值**（最近 N 帧的最小值；不是只降不升，也不是双向自由跟随）
const OVB_NOISE_WINDOW = 100;          // 100 帧 = 10 s @100ms/帧
const OVB_FLOOR_RISE = 0.02;           // 噪声底向上每帧最多 ×1.02（约 10 s 追平环境变吵）
// 底噪取样门：只有 rms < 底噪 × 该值的帧才参与底噪统计。
//   ⚠ 判据必须是**与阈值无关**的量：若按「是否为语音帧（rms >= 阈值）」取样，
//     就会形成「阈值升高 ⇒ 更多帧被算作非语音 ⇒ 底噪升高 ⇒ 阈值再升高」的正反馈环路
//     （本批实测命中：8-bit 路径底噪从 0.0039 爬到 0.0153，把小声续说压死）。
const OVB_FLOOR_TRACK_RATIO = 1.6;
// 连续帧确认：连续 3 帧（=300ms）达到开阈才算有人在说话。
//   ⚠ 为什么是连续而不是窗口内凑够 N 帧：环境噪声起伏常是方波式（风扇/空调/桌面震动），
//     档位一抬就是 2-3 帧，用凑数它照样凑得够 ⇒ 只有底噪也会被确认成语音（C 反向坏）。
const OVB_ONSET_RUN = 3;
// （旧 `OVB_SILENCE_MS = 2000` 已删除：静音时长改由配置提供，详见下方§7.4 说明）
const OVB_POLL_MS = 100;
// P2-补做（2026-10-13 · PROJECT §7.4 / 方案 §4.6.2.7）：静音帧数**不再由固定常量派生**，
// 而是由配置值动态计算 ⇒ 与 VAD 参数同一入口：`vadRequiredQuiet(vadSilenceMsOf(voiceCfgState.value))`。
// 旧写法（已退役）：`OVB_REQUIRED_QUIET = Math.round(OVB_SILENCE_MS / OVB_POLL_MS)`。
// 这是§7.4「静音档位驱动录音入口」的落点——若各自派生，用户改了档位会只对一条路径生效。
const OVB_CALIBRATE_FRAMES = 5;

// 官方按钮的文案锚（官方 zh/en 双语；官方源码 lib/client.js:5254/5255/5358/5359 实读）
const OVB_START_LABELS = ['开始录音', 'Start recording'];
const OVB_STOP_LABELS = ['停止并识别', 'Stop and transcribe'];
// ⚠ 未识别态批（2026-10-15 · 需求 3+4）：官方「未识别到语音」窗口渲染的**不是**开始按钮，
//   而是 aria-label = 上列（`重新录音` / `Record again`）的 retry 按钮 —— **CDP 实读**（报告 §②）：
//   feedback 窗口内只有两个按钮：`取消` 与 `重新录音`（均在位、均未 disabled）。
//   官方源码依据：voice-input/lib/client.js:5150-5160（feedback 且无 pending ⇒ roundButton,
//   aria-label: t('retryRecording')，onClick: () => start()）；键值 client.js:5199 / :5303。
//   ⚠ 旧实现只按 OVB_START_LABELS 找 ⇒ 该窗口**找不到任何按钮** ⇒ startMissed
//   ⇒ 热键「接不上」（用户报障的需求 4 形态）。
const OVB_RETRY_LABELS = ['重新录音', 'Record again'];
// 官方 DOM 相位锚（只读官方渲染结果）+ 官方失败出口文案节点
const OVB_ACTIVITY_ATTR = 'data-voice-activity';
const OVB_RECORDING_PHASE = 'recording';
const OVB_FEEDBACK_PHASE = 'feedback';
// 官方相位取值集合（穷举，官方源码实读）：idle | requesting | recording | transcribing | feedback
// ⚠ idle 时该节点根本不挂载（`expanded = phase !== "idle"`）⇒ 属性只在非 idle 存在。
const OVB_TRANSCRIBING_PHASE = 'transcribing';
const OVB_REQUESTING_PHASE = 'requesting';
// 官方失败出口的文案节点类名（`.activityMessage`，承载「未识别到语音」等官方文案）
const OVB_MESSAGE_CLASS = 'activityMessage';
// ⚠ B-1（2026-10-14 定位批 · CDP 实读官方 DOM）：该节点是 **CSS-module 哈希类**
//   （实测 `ddpbLW_activityMessage`）⇒ 裸 `.activityMessage` 选择器 **永不命中**（CDP 实测命中 0）。
//   故改用**子串匹配**（官方源码键名仍是 activityMessage ⇒ 哈希变化时依然命中），保留裸类名作后备。
const OVB_MESSAGE_CLASS_ATTR = '[class*="' + OVB_MESSAGE_CLASS + '"]';

function ovbBus() {
  if (typeof window === 'undefined') return null;
  if (!window[OVB_NS]) {
    window[OVB_NS] = {
      installed: false,
      original: null,
      originalRecorder: null,   // 兜底：原 window.MediaRecorder
      wrappedRecorder: false,
      recording: null,          // 兜底：当前官方采集的 MediaRecorder 实例
      active: false,            // 官方采集进行中（含握手/收尾）
      lastEndedAt: 0,           // 官方会话结束时刻（自动增强的触发信号源）
      firstCallAt: 0,           // 包装器首次被调用（诊断）
      lastCallAt: 0,
      sessionsStarted: 0,       // 观察到的官方会话数（相位上升沿）
      sessionsMissed: 0,        // 有会话但包装器从未被调用的次数（= 自动停未生效）
      lastMissedAt: 0,
      callCount: 0,             // 包装器被调用的**总次数**（诊断/判 missed 用）
      callCountAtPrevSessionEnd: 0, // 上一次会话收口时的调用计数（判 missed 的窗口下界）
      abandonReason: '',        // 显式降级原因（''=无降级）
      selfCapture: false,       // 外部（热键）声明「正在自采」⇒ 本桥不介入其采集
      timerSvc: null,
      listeners: new Set(),
      // ── 热键改走官方路径（UD-0016）新增：启动/停止派发点击与官方失败出口读数 ──
      lastPhase: '',            // 最近一次观察到的官方相位（诊断；idle 时为空串）
      startClicks: 0,           // 成功派发点击官方开始按钮的次数
      startMissed: 0,           // 找不到官方开始按钮而未能启动的次数（= 不得静默失效）
      lastStartMissedAt: 0,
      stopClicks: 0,            // 成功派发点击官方停止按钮的次数
      stopMissed: 0,            // 找不到官方停止按钮而未能停止的次数
      // ⚠ 未识别态批（2026-10-15）：需求 4 新增的 retry 路径读数（不得静默失效）——
      //   没有它就只能靠 startClicks 总数区分不出「走的是哪条锚」。
      retryClicks: 0,           // 经「未识别窗口 retry 按钮」成功启动的次数
      lastStartVia: '',         // 最近一次成功启动走的锚（诊断用；'' = 从未启动）
      feedbackSeen: 0,          // 观察到官方失败出口（相位 feedback）的次数
      lastFeedbackAt: 0,
      feedbackMessage: '',      // 官方失败出口的文案（`.activityMessage` 文本，只读）
      endedInFeedback: false,   // 本次官方会话以失败出口收尾 ⇒ 订阅方**不进入**「等写回 → 自动增强」
      // ⚠ CHG-090（2026-10-15 诊断如实化批）：`feedbackSeen` 是**页面生命期累计**（只在 uninstall 归零）
      //   ⇒ 拿它判「上次会话」会把**历史残留**读成**当前失败**（用户最初报障看到的那行正由此而来）。
      //   新增**会话级**读数：**最近一次已收口的会话**是否走了官方失败出口。
      //   置位：会话以 feedback 收口；复位：新会话开始 / 会话成功收口 / 从 feedback 重试 / uninstall。
      lastSessionFailed: false,
      // ⚠ VAD-1（2026-10-14）：静音判定的**可判别读数**（此前「门从未开过」这一失效形态
      //   在本快照里**没有任何字段** ⇒ 用户只能看到一句会误导的文案，属「会掩盖问题」。）
      vadHeardSpeech: false,    // 本会话内 heardSpeech 是否曾为真（门是否开过）
      vadQuietFrames: 0,        // 当前连续静音帧数
      vadThreshold: 0,          // 当前生效阈值（自愈后）
      vadNoiseFloor: 0,         // 当前底噪估计
      // ⚠ 2026-10-17（判停修复批 · F-5「不得静默失效」）：上面 4 个字段只能回答「门是否**曾**开过」，
      //   回答不了「门开着但没声音」vs「门根本没开」—— 正是「判据全绿而现场失败」的同族缺口。
      //   ⇒ 以下字段**逐帧刷新**，读的是**当下**而不是历史：
      vadFrameSpeech: false,    // 本帧判定（true=本帧判为有声）
      vadSpeaking: false,       // 当前是否处于「说话」态（双阈值迟滞的状态机位）
      vadRms: 0,                // 本帧原始 RMS（平滑前；区分「门没开」与「没声音」的关键）
      vadSnr: 0,                // 本帧 rms / 噪声底（相对判据的比值）
      vadThresholdOff: 0,       // 关阈（迟滞带下沿）
      vadResolution: 0,         // 当前判据下限（= 采集分辨率，随路径变）
      vadPath: '',              // 实际采集路径：'float'（getFloatTimeDomainData）| 'byte'（8-bit）
      vadPathErrors: 0,         // 采集路径回落/读失败次数（fail-closed 的证据）
      vadFrames: 0,             // 已处理帧数（tick 计数）
      vadCalibrating: true,     // 是否仍在校准窗内
      // ⚠ SW-1：开关的可判读数（此前「开关关了但 VAD 照跑」在快照里**无任何字段** ⇒ 无法判别）
      vadSkipped: 0,            // 因开关关闭而**未启动** VAD 的音频采集次数（开关真的约束了行为的证据）
    };
  }
  return window[OVB_NS];
}

function ovbNotify() {
  const b = ovbBus();
  if (!b) return;
  for (const fn of [...b.listeners]) { try { fn(); } catch (e) { /* 单个订阅者失败不影响其余 */ } }
}

function ovbSubscribe(fn) {
  const b = ovbBus();
  if (!b) return () => {};
  b.listeners.add(fn);
  return () => b.listeners.delete(fn);
}

// 诊断快照（设置页诊断区读取；**不静默**的就地来源）
function ovbSnapshot() {
  const b = ovbBus();
  if (!b) return null;
  return {
    installed: b.installed,
    firstCallAt: b.firstCallAt,
    lastCallAt: b.lastCallAt,
    callCount: b.callCount || 0,   // 包装器被调用总次数
    callCountAtPrevSessionEnd: b.callCountAtPrevSessionEnd || 0,   // missed 判据窗口下界
    sessionsStarted: b.sessionsStarted,
    sessionsMissed: b.sessionsMissed,
    lastMissedAt: b.lastMissedAt,
    abandonReason: b.abandonReason,
    recording: !!b.active,
    lastEndedAt: b.lastEndedAt,
    selfCapture: !!b.selfCapture,
    lastPhase: b.lastPhase,
    startClicks: b.startClicks,
    startMissed: b.startMissed,
    lastStartMissedAt: b.lastStartMissedAt,
    retryClicks: b.retryClicks || 0,
    lastStartVia: b.lastStartVia || '',
    stopClicks: b.stopClicks,
    stopMissed: b.stopMissed,
    feedbackSeen: b.feedbackSeen,
    lastSessionFailed: !!b.lastSessionFailed,
    // 2026-10-17（设置文案审查批 · 用户第二轮报障 D）：lastSessionFailed 的复位条件只有
    //   「之后录了一场成功会话」⇒ 若很久没录音，就会一直挂着某个陈年失败。**不吞掉**该事实，
    //   但把**发生时刻**一并暴露 ⇒ 设置页可以给出「距今多久」，用户自己判得了是不是当前问题。
    //   ⚠ 只加只读出口，不改任何置位/复位语义（复位条件仍只有成功会话）。
    lastSessionFailedAt: b.lastFeedbackAt || 0,
    lastFeedbackAt: b.lastFeedbackAt,
    feedbackMessage: b.feedbackMessage,
    endedInFeedback: !!b.endedInFeedback,
    vadHeardSpeech: !!b.vadHeardSpeech,
    vadQuietFrames: b.vadQuietFrames || 0,
    vadThreshold: b.vadThreshold || 0,
    vadNoiseFloor: b.vadNoiseFloor || 0,
    vadEnabled: ovbVadEnabled(),   // 开关**当前**真值（实时读配置；不是历史快照）— 诊断区据此区分「已关闭」与「已开启但未触发」
    vadSkipped: b.vadSkipped || 0,
    // ⚠ 2026-10-17（判停修复批 · F-5）：**当下**读数（不是"曾开过"）；逐帧刷新。
    vadFrameSpeech: !!b.vadFrameSpeech,
    vadSpeaking: !!b.vadSpeaking,
    vadRms: b.vadRms || 0,
    vadSnr: (typeof b.vadSnr === 'number') ? b.vadSnr : 0,
    vadThresholdOff: b.vadThresholdOff || 0,
    vadResolution: b.vadResolution || 0,
    vadPath: b.vadPath || '',
    vadPathErrors: b.vadPathErrors || 0,
    vadFrames: b.vadFrames || 0,
    vadCalibrating: !!b.vadCalibrating,
    // 设置页诊断行 title 的**一次拼入**形态（把这一串整体放进 title 即可，不必逐字段改文案）
    vadDiag: 'path=' + (b.vadPath || '-')
      + ' rms=' + (b.vadRms || 0).toFixed(4)
      + ' snr=' + ((typeof b.vadSnr === 'number') ? b.vadSnr : 0).toFixed(2)
      + ' frame=' + (b.vadFrameSpeech ? 'speech' : 'quiet')
      + ' thr=' + (b.vadThreshold || 0).toFixed(4)
      + ' thrOff=' + (b.vadThresholdOff || 0).toFixed(4)
      + ' floor=' + (b.vadNoiseFloor || 0).toFixed(4)
      + ' res=' + ((b.vadResolution || 0) > 0 ? b.vadResolution.toExponential(1) : '0')
      + ' frames=' + (b.vadFrames || 0)
      + ' cal=' + (b.vadCalibrating ? 1 : 0),
  };
}

// 可关闭：环境标志 / localStorage 配置均可停用包装（§4.6.2.6 E1④）
function ovbDisabled() {
  try {
    if (typeof window !== 'undefined' && window.__dshPeDisableOfficialBridge === true) return true;
  } catch (e) { /* 忽略 */ }
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('dsh.prompt-enhancer.officialBridge') === 'off') return true;
  } catch (e) { /* 忽略 */ }
  return false;
}

// ⚠ SW-1（2026-10-15 接线批 · 用户可见开关不得说假话）：`vad.enabled` 此前**未被本文件消费**
//   （穷举实测：`voice-section.js` 写 8 处 / 本文件**引用 0 处**）⇒ 用户关掉「静音监测」开关，
//   VAD **照跑**、仍会派发点击官方停止 = **开关说了假话**（属「让失败不可观测」类，CHG-065 同族）。
//   现接上：`enabled === false` ⇒ **不启动 VAD**（不建 AudioContext、不观测、不自动停）。
//   ⚠ 与 `autoEnhance` **完全无关**：关「静音监测」≠ 关「自动增强」——两者各读各的配置，
//     `autoEnhance` 的读取点始终只有热键模块那一处（本批**未触碰**）。
//   ⚠ 只接开关：**未改动**判定算法 / 阈值策略 / 派发路径（派发仍**只**在 VAD 判到静音时发生）。
//   缺配置 / 缺 `vad` 字段 ⇒ 视为**开**（保持既有默认行为，不改动未配置用户的语义）。
function ovbVadEnabled() {
  try {
    const v = (typeof voiceCfgState !== 'undefined' && voiceCfgState) ? voiceCfgState.value : null;
    const vd = v && v.vad ? v.vad : null;
    return !vd || vd.enabled !== false;
  } catch (e) { return true; }
}

// ── 外部显式声明「自采进行中」：本桥在其采集上**不介入**（不挂 VAD）────────────────
// ⚠ UD-0016 后语义收窄：自建采集链已退役 ⇒ 正常情况下**无人**再置此标记；
//   保留它是为了「有第三方/未来实现自行采集时，本桥明确不介入」这一显式契约（默认 false = 介入）。
function ovbSetSelfCapture(on) {
  const b = ovbBus();
  if (!b) return;
  b.selfCapture = on === true;
}
// 包装器侧：外部自采中 ⇒ 直接透传不介入
function ovbSelfCapturing() {
  const b = ovbBus();
  return !!(b && b.selfCapture);
}
// 热键侧：**官方确在采集中** ⇒ 拒绝重复启动（互斥保护 —— **有意保留**，本批未取消）。
// ⚠ 未识别态批（2026-10-15 · 需求 1/3 · 用户报障的确切形态）：判据从 `b.active` 改为
//   **官方自己渲染的相位真相**（`[data-voice-activity="recording"]`）。
//   `b.active` 的语义是「官方仍占用语音入口」，它在 feedback / 收尾态**仍为真**
//   （bridge 有意保持，见 ovbWatchActivity 内注释与 CHG-085 收口语义）⇒ 旧实现把
//   「**卡在收尾/未识别态**」与「**仍在采集中**」混为一谈 ⇒ 返回 already-capturing ⇒ 热键被拒。
//   现在：只有 recording 相位存在（= 采集确在进行中）才拒绝；
//   transcribing / feedback（未识别）/ 失败态 / 节点已卸载 ⇒ **不算采集中** ⇒ 放行，交由
//   ovbStartOfficial 重新启动一轮。
//   ⚠ 判据用**直接 DOM 相位查询**而非 b.active / b.lastPhase（后两者无法区分「还在录」与「已收尾」，
//     这正是 ovbStopOfficial 的 N-1 修复已记录过的同一陷阱）。
function ovbOfficialCapturing() {
  return ovbRecordingNow();
}
// ⚠ 与上面**语义不同**（不可互换）：官方是否仍**占用语音入口**（含收尾/未识别态）。
//   保留它是为了不丢 b.active 的既有承诺面（诊断区 / 订阅方 / CHG-085 收口语义都依据它）。
function ovbOfficialEntryBusy() {
  const b = ovbBus();
  return !!(b && b.active);
}

// ── 官方按钮定位与派发点击（等价用户按下；只读官方渲染结果，不改官方）────────────
// 统一派发点击：优先 `window.MouseEvent`（client chunk 的未声明标识符门禁 R2 只认白名单全局名，
// 裸 `MouseEvent` 会被判「未声明」⇒ 门禁 FAIL，实测命中）；不可用时回落 `el.click()`。
function ovbClickElement(el) {
  try {
    const EvCtor = (typeof window !== 'undefined' && typeof window.MouseEvent === 'function') ? window.MouseEvent : null;
    if (EvCtor) {
      el.dispatchEvent(new EvCtor('click', { bubbles: true, cancelable: true }));
      return true;
    }
    el.click();
    return true;
  } catch (e) {
    try { el.click(); return true; } catch (e2) { return false; }
  }
}

// 在「当前官方相位节点」内按 aria-label 找可用按钮；scope 不可查询时回落整文档。
function ovbFindButtonByLabels(labels, phaseAttr) {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
  const sel = phaseAttr
    ? '[' + OVB_ACTIVITY_ATTR + '="' + phaseAttr + '"]'
    : '[' + OVB_ACTIVITY_ATTR + ']';
  const region = (typeof document.querySelector === 'function') ? document.querySelector(sel) : null;
  // 只在 scope 确实可查询时收窄搜索面；否则回落整文档（元素缺失 querySelectorAll 不得使其崩掉）
  const scope = (region && typeof region.querySelectorAll === 'function') ? region : document;
  if (typeof scope.querySelectorAll !== 'function') return null;
  const btns = scope.querySelectorAll('button');
  for (const el of btns) {
    const label = el.getAttribute('aria-label') || '';
    if (labels.indexOf(label) >= 0 && !el.disabled) return el;
  }
  return null;
}

// 官方「开始录音」按钮：**只在 idle（相位节点未挂载）时存在**（官方 `expanded = phase !== "idle"`）。
// ⚠ 因此**不得**按相位属性收窄搜索（idle 时该属性不存在）⇒ 用整文档 + aria-label。
function ovbFindStartButton() {
  return ovbFindButtonByLabels(OVB_START_LABELS, null);
}

// 官方「未识别」窗口的 retry 按钮（aria-label = 重新录音 / Record again）：
//   只在 feedback 相位节点内存在 ⇒ 先按相位锚收窄（外带整文档兜底）。
//   CDP 实读（报告 §②）：该窗口的按钮就是这个 + `取消`（取消**不**得被当作启动锚）。
function ovbFindRetryButton() {
  const scoped = ovbFindButtonByLabels(OVB_RETRY_LABELS, OVB_FEEDBACK_PHASE);
  if (scoped) return scoped;
  return ovbFindButtonByLabels(OVB_RETRY_LABELS, null);
}

// 官方「停止并识别」按钮：只在 recording 相位节点内存在 ⇒ 先按相位锚收窄，再按文案。
function ovbFindStopButton() {
  const scoped = ovbFindButtonByLabels(OVB_STOP_LABELS, OVB_RECORDING_PHASE);
  if (scoped) return scoped;
  return ovbFindButtonByLabels(OVB_STOP_LABELS, null);
}

// ── 启动官方采集（热键 → 远程按一下官方开始按钮）────────────────────────────────
// 只有派发点击官方开始按钮能驱动官方整条链：官方相位是组件私有 useState，
// `actions.createRecording()` 虽能开麦但**不驱动相位**（轮次 22 勘察 §1③ 实读）。
function ovbStartOfficial() {
  const b = ovbBus();
  if (!b) return { started: false, via: 'no-bus' };
  if (ovbOfficialCapturing()) return { started: false, via: 'already-capturing' };
  // ⚠ 未识别态批（2026-10-15 · 需求 3+4）：两条入口各有一个**官方自己渲染**的启动锚，
  //   按「当前相位下真实存在的那个」依序尝试 —— 两次点击的语义在官方侧**完全相同**
  //   （都是 `start()`，voice-input/lib/client.js:5089-5091 与 :5156-5158），差别只在文案锚。
  //   ① feedback（未识别）窗口 ⇒ retry 锚（重新录音 / Record again）
  //   ② idle ⇒ 开始锚（开始录音 / Start recording）
  //   ⚠ 顺序不可颠倒：retry 先试（它只在 feedback 存在，且必须优先命中）；
  //     两者互斥共存（feedback 时开始锚**不渲染**，idle 时 retry 锚不存在）⇒ 不会误点。
  const candidates = [
    { el: ovbFindRetryButton(), via: 'official-retry-button' },
    { el: ovbFindStartButton(), via: 'official-start-button' },
  ];
  let foundAny = false;
  for (const c of candidates) {
    if (!c.el) continue;
    foundAny = true;
    if (!ovbClickElement(c.el)) continue;   // 找到但派发失败 ⇒ 试下一个锚，最终不静默
    if (c.via === 'official-retry-button') b.retryClicks++;
    else b.startClicks++;
    b.lastStartVia = c.via;
    ovbNotify();
    return { started: true, via: c.via };
  }
  // 不得静默失效：两个锚都不可用必须留下可见读数（设置页诊断区）
  b.startMissed++;
  b.lastStartMissedAt = Date.now();
  const failVia = foundAny ? 'start-click-dispatch-failed' : 'start-button-not-found';
  b.abandonReason = b.abandonReason || failVia;
  ovbNotify();
  return { started: false, via: failVia };
}

// 官方当前是否**确在录音**（直接读官方渲染的相位属性，不依赖 bus 缓存）——
// N-1 修复的判据基元：`[data-voice-activity="recording"]` 是官方**自己**渲染的真相，
// 「采集确在进行中」= 它存在。会话收尾（transcribing/feedback）或节点卸载 ⇒ 不存在。
function ovbRecordingNow() {
  try {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
    return !!document.querySelector('[' + OVB_ACTIVITY_ATTR + '="' + OVB_RECORDING_PHASE + '"]');
  } catch (e) { return false; }
}

// ── 停止官方采集：派发点击官方停止按钮（唯一走完官方链的路径）→ MediaRecorder 兜底 → 显式降级 ──
// ⚠ 语义校验（本轮实读官方源码）：官方 `finish()` 才做「相位收尾 → `capture.stop()` → 转写 → 写回」，
//   而它**只**由官方停止按钮的 onClick 触发（`client.js` 停止按钮 `onClick: () => { finish(); }`）。
//   直接调 `MediaRecorder.stop()` 既不改官方相位、也不转写/写回 ⇒ **不能**作为第一优先
//   （用户要「一条链、一个状态」⇒ 必须走官方停止按钮）。
//   返回 `via` 面：主路 'A1'（官方停止按钮）· 兜底 'A2'（MediaRecorder 实例）· 'abandoned'（显式降级）。
function ovbStopOfficial() {
  const b = ovbBus();
  if (!b) return { stopped: false, via: 'no-bus' };
  // A1（第一优先）：派发点击官方停止按钮 —— 唯一能走完官方 finish() 的路径
  const btn = ovbFindStopButton();
  if (btn && ovbClickElement(btn)) {
    b.stopClicks++;
    ovbNotify();
    return { stopped: true, via: 'A1' };
  }
  // A2（兜底）：持官方 MediaRecorder 实例调 .stop()——只停采集，不走官方转写/写回
  if (b.recording && b.recording.state === 'recording') {
    try {
      b.recording.stop();
      return { stopped: true, via: 'A2' };
    } catch (e) { /* 落到显式降级 */ }
  }
  // ⚠ N-1 修复（2026-10-13 · 与 F-1/F-2/F-10 同类「读数说反话」）：**只有「采集确在进行中」才计降级**。
  //   实测形态：一次**正常手动停**之后，相位停在 `feedback`（节点不消失）⇒ 静默的包装 VAD 仍在跑；
  //   它随后在**录音器已释放**时到达阈值 ⇒ 旧实现照记一次 stopMissed + 写 `abandonReason`，
  //   而该字段是诊断区**第一优先分支** ⇒ 此后设置页**一直**显示「自动停已降级」，
  //   而自动停**从未失败**（用户看到与事实相反且不消失的状态）。
  //   语义①（本处）：**官方当前不在 `recording` 相位**（会话未开 / 已进入 `transcribing`·`feedback`
  //   收尾 / 节点已卸载）⇒ **不计 missed、不写 reason**，只如实返回未停止。
  //   ⚠ 判据用**直接 DOM 相位查询**（不信 `b.lastPhase`：它把 `transcribing` 归为 `'active'`，
  //   不足以区分「还在录」与「已收尾」——这是本修复第一次写错并自查发现的点）。
  if (!ovbRecordingNow()) {
    return { stopped: false, via: 'no-active-session' };
  }
  // 显式降级：不假装已停——记原因，由设置页诊断区可见（§4.6.2.6 D 第 3 行）
  b.stopMissed++;
  b.abandonReason = btn ? 'stop-click-dispatch-failed' : (b.recording ? 'stop-failed-both-paths' : 'no-stop-button-and-no-recorder');
  ovbNotify();
  return { stopped: false, via: 'abandoned' };
}

// ── 官方同一路 stream 上挂插件自己的分析器判静音（只读 stream，不修改它）──────
// ⚠ 2026-10-17（判停修复批 · CHG-178）：**判据形态变更**（不是参数调整）。
//   改前三件叠加：绝对下界 Math.max(0.025, …) 把阈值钉死 · 0.7/0.3 指数平滑再压约 3 dB ·
//   heardSpeech 一次性闩锁永不复位 ⇒ 「必须很大声」+「一降就停」。
//   改后：**相对判据**（瞬时 rms 与「噪声底 × 倍率」比较）+ 双阈值迟滞 + 连续帧确认 + 逐帧可判读数。
//   为什么**必须**是相对量（不是把 0.025 改小）：官方 getUserMedia **不传 autoGainControl**
//   （实读官方 dsh-experimental-client-ui-voice-input/lib/client.js:1532-1534：只有 echoCancellation /
//   noiseSuppression / deviceId）⇒ AGC 交给浏览器默认（通常开）⇒ 同一句话的**绝对** RMS 前后不可比；
//   而 AGC 同时放大语音与环境噪声 ⇒ **比值近似不变**。⛔ 本桥不变量①禁止改官方 constraints（那才是越界）。
//   下限为什么不是更小的常数：下限 = **当前采集路径的量化台阶**（测量分辨率），不是经验值。
function ovbStartVad(stream, onSilence) {
  const b = ovbBus();
  if (!b) return null;
  const AC = (typeof window !== 'undefined' && window.AudioContext) ? window.AudioContext
    : (typeof window !== 'undefined' && window.webkitAudioContext) ? window.webkitAudioContext
    : null;
  if (!AC) { b.abandonReason = 'no-audio-context'; return null; }
  let ctx = null;
  try {
    ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    // ── 取帧路径：float32 优先，8-bit fail-closed 回落（回落更严，不比主路径松）──────
    const frameLen = analyser.fftSize;
    const byteBuf = new Uint8Array(frameLen);
    const floatBuf = (typeof Float32Array === 'function') ? new Float32Array(frameLen) : null;
    let useFloat = !!(floatBuf && typeof analyser.getFloatTimeDomainData === 'function');
    let pathErrors = 0;
    let resolution = useFloat ? OVB_FLOAT_RESOLUTION : OVB_QUANT_STEP_8BIT;
    // 读一帧 → RMS(0..1)。float 路径不可用/读不出（脏 polyfill 不写缓冲）⇒ 记一次路径错误并**回落 8-bit**
    //   （fail-closed：分辨率更低 ⇒ 下限抬高 ⇒ 只会更严，⛔ 不得更松）。
    const readRms = () => {
      if (useFloat) {
        try {
          floatBuf[0] = NaN;                       // 哨兵：先置 NaN，读回仍是 NaN ⇒ 该 API 没写缓冲
          analyser.getFloatTimeDomainData(floatBuf);
          if (!Number.isFinite(floatBuf[0])) throw new Error('float-path-no-fill');
          let sum = 0;
          for (let i = 0; i < frameLen; i++) { const v = floatBuf[i]; sum += v * v; }
          return Math.sqrt(sum / frameLen);
        } catch (e) {
          useFloat = false;
          resolution = OVB_QUANT_STEP_8BIT;
          pathErrors++;
          b.vadPathErrors = pathErrors;
          b.vadPath = 'byte';
          b.abandonReason = b.abandonReason || 'vad-float-path-fallback';
        }
      }
      analyser.getByteTimeDomainData(byteBuf);
      let sum = 0;
      for (let i = 0; i < byteBuf.length; i++) { const d = (byteBuf[i] - 128) / 128; sum += d * d; }
      return Math.sqrt(sum / byteBuf.length);
    };
    let heardSpeech = false;      // 本会话内**是否曾**确认到语音 —— 「从未说话不得判停」的反向锁（保留）
    let speaking = false;         // 当前是否处于「说话」态（双阈值迟滞的状态机位）
    let aboveRun = 0;             // 连续达到开阈的帧数（连续帧确认）
    let quietFrames = 0;
    let stopped = false;
    let noiseFloor = 0;           // 噪声底（最近 OVB_NOISE_WINDOW 帧的最小值；向上速率受限）
    let vadThreshold = resolution * OVB_NOISE_FACTOR;   // 开阈（确认有人说话）
    let vadThresholdOff = vadThreshold;                 // 关阈（迟滞带下沿 = 仍在说话）
    let calibrating = true;
    let frames = 0;
    const noiseSamples = [];
    const quietWindow = [];
    // 阈值下限 = 测量分辨率（8-bit RMS ≈ 1/256；float ≈ 2^-15）。
    //   ⚠ 与「分辨率」挂钩，不是挑了一个更小的经验常数（后者只是把复发点挪到看不见的地方）。
    const measurableFloor = () => resolution * OVB_RESOLUTION_STEPS;
    // 由噪声底重算双阈值：开阈 = 底噪 × NOISE_FACTOR（不高于上限）；
    //   关阈 = 开阈 × HYSTERESIS（不低于底噪）。迟滞带内的帧**不**累计静音帧（= hangover）。
    const applyFloor = () => {
      const f = Math.max(noiseFloor, measurableFloor());
      vadThreshold = Math.min(OVB_THRESHOLD_MAX, f * OVB_NOISE_FACTOR);
      vadThresholdOff = Math.min(vadThreshold, Math.max(f, vadThreshold * OVB_HYSTERESIS));
    };
    applyFloor();
    // 噪声底 = **滑动最小值**。取样门**与阈值无关**（⚠ 关键）：
    //   若按「是否为语音帧（rms >= 阈值）」取样，会形成
    //   「阈值升高 ⇒ 更多帧被判为非语音 ⇒ 底噪升高 ⇒ 阈值再升高」的**正反馈**
    //   （本批实测命中：8-bit 路径底噪从 0.0039 爬到 0.0153，把小声续说压死）。
    //   取样门 = rms < 底噪 × OVB_FLOOR_TRACK_RATIO（只看像不像环境电平）；
    //   向上速率护栏 OVB_FLOOR_RISE/帧（约 10 s 追平环境变吵，但不会一大跳）。
    const trackFloor = (v) => {
      const sample = (v > measurableFloor()) ? v : measurableFloor();
      quietWindow.push(sample);
      if (quietWindow.length > OVB_NOISE_WINDOW) quietWindow.shift();
      let mn = quietWindow[0];
      for (let i = 1; i < quietWindow.length; i++) { if (quietWindow[i] < mn) mn = quietWindow[i]; }
      if (mn > noiseFloor) noiseFloor = Math.min(mn, noiseFloor * (1 + OVB_FLOOR_RISE));
      else noiseFloor = mn;
      applyFloor();
    };
    // §7.4：连续静音帧数按**当前配置值**动态计算
    const requiredQuiet = vadRequiredQuiet(vadSilenceMsOf(voiceCfgState.value));
    const tick = () => {
      if (stopped) return;
      // ⚠ SW-1b：会话**中途**把开关关掉 ⇒ 当帧起不再监测（开关对整场都为真，而非只在启动那一刻）。
      if (!ovbVadEnabled()) return;
      try {
        frames++;
        const rms = readRms();
        if (calibrating) {
          noiseSamples.push(rms);
          b.vadFrames = frames;
          b.vadPath = useFloat ? 'float' : 'byte';
          b.vadResolution = resolution;
          b.vadCalibrating = true;
          if (noiseSamples.length >= OVB_CALIBRATE_FRAMES) {
            calibrating = false;
            // 校准只给**初值**（中位数）。⚠ 校准窗**不保证落在静音里**（用户按下即开口）⇒
            //   初值可能被语音污染；此后由滑动最小值接管 —— 一旦出现更低的非语音帧
            //   （词间回落 / 随后停顿），底噪即回落到真实量级（= §7.4 自愈的本意，D 判据的落点）。
            //   ⚠ 改前这里还有 smoothRms = 0（清指数平滑残留）；本判据**不再用平滑值**判，
            //     该残留路径整体消失（F-2）。
            const sorted = noiseSamples.slice().sort(function (a, c) { return a - c; });
            const med = sorted[Math.floor(sorted.length / 2)];
            noiseFloor = (med > measurableFloor()) ? med : measurableFloor();
            applyFloor();
            b.vadCalibrating = false;
          }
          return;
        }
        // ── 帧判定（相对量；平滑已拆除）
        const isOn = rms >= vadThreshold;
        const isOff = rms < vadThresholdOff;
        // ── 语音确认 = **连续帧**确认（商用共性④：requires consecutive frames above threshold
        //   to trigger state changes, preventing spurious transitions）。
        //   为什么不是「窗口内凑够 N 帧」（本批实测否掉）：环境噪声起伏常是**方波式**
        //     （风扇/空调/桌面震动），档位一抬就是 2–3 帧，凑数照样能凑够 ⇒ 只有底噪也被确认成语音（C 反向坏）。
        //   为什么不是单帧：敲击/碰撞/单点量化跳变只有 1–2 帧。
        //   为什么 3 帧（300ms）够：真实音节的有声段 100–300ms+，包络峰肩就有 3 帧；
        //     字间回落会打断连续段 ⇒ 确认只看一个音节内是否持续有声，不跨音节。
        if (isOn) aboveRun++; else aboveRun = 0;
        if (aboveRun >= OVB_ONSET_RUN) {
          // 确认到语音：门打开，静音计数清零
          heardSpeech = true;
          quietFrames = 0;
        } else if (heardSpeech) {
          // ⚠ 这条 else if (heardSpeech) 是「从未说话 ⇒ 不得判停」的反向锁（VADSIL-P13 判它的字面形态）。
          // 状态机 + 迟滞（**这条是 A 判据的落点**）：
          //   只要本帧仍在**关阈**之上（>= 底噪，即迟滞带下沿）⇒ 说话态、静音帧清零；
          //   落到关阈以下 ⇒ 才计一帧安静。
          //   ⚠ 为什么说话态不能「只在开阈之上」才重建：小声续说的音节峰往往只略高于关阈
          //     （底噪 0.004 时约 0.010），它在开阈附近来回 ⇒ 若只认开阈，软语音会**永远**
          //     回不到说话态 ⇒ 每个音节都计静音帧 ⇒ 2 s 后照样判停（本批实测命中该形态）。
          //   ⇒「关阈 = 底噪」这一档才是"人还在说话"的判据；开阈只用于**首次确认**。
          speaking = !isOff;
          if (speaking) quietFrames = 0; else quietFrames++;
        }
        // 噪声底取样（门与阈值无关，见 trackFloor 注释）
        if (!(noiseFloor > measurableFloor()) || rms < noiseFloor * OVB_FLOOR_TRACK_RATIO) trackFloor(rms);
        // 读数出账（不得静默：逐帧反映**当下**，不是只记曾开过）
        b.vadHeardSpeech = heardSpeech;
        b.vadSpeaking = speaking;
        b.vadQuietFrames = quietFrames;
        b.vadThreshold = vadThreshold;
        b.vadThresholdOff = vadThresholdOff;
        b.vadNoiseFloor = noiseFloor;
        b.vadFrameSpeech = isOn;
        b.vadRms = rms;
        b.vadSnr = (noiseFloor > 0) ? (rms / noiseFloor) : 0;
        b.vadResolution = resolution;
        b.vadPath = useFloat ? 'float' : 'byte';
        b.vadPathErrors = pathErrors;
        b.vadFrames = frames;
        b.vadCalibrating = false;
        if (quietFrames >= requiredQuiet) { stopped = true; onSilence(); }
      } catch (e) { /* 单帧失败忽略 */ }
    };
    let stop = null;
    if (b.timerSvc && typeof b.timerSvc.interval === 'function') {
      const disposer = b.timerSvc.interval(tick, OVB_POLL_MS);
      stop = () => { try { if (typeof disposer === 'function') disposer(); } catch (e) { /* 忽略 */ } };
    } else {
      const id = setInterval(tick, OVB_POLL_MS);
      stop = () => { try { clearInterval(id); } catch (e) { /* 忽略 */ } };
    }
    return () => {
      stopped = true;
      try { if (stop) stop(); } catch (e) { /* 忽略 */ }
      try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (e) { /* 忽略 */ }
    };
  } catch (e) {
    try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (e2) { /* 忽略 */ }
    b.abandonReason = 'vad-init-failed';
    return null;
  }
}

// ── 官方相位观察（只读官方渲染出来的 DOM 属性，不注入/不改官方）──────────────
function ovbWatchActivity() {
  const b = ovbBus();
  if (!b || typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  if (typeof MutationObserver !== 'function') return;
  let everMounted = false;
  let wasFeedback = false;
  // ⚠ B-5（本批）：本会话是否**已完成收口**（settleMiss + lastEndedAt）。
  //   feedback 分支与「节点消失」分支都会收口 ⇒ 用同一标志保证**恰好一次**（否则会重复计 missed）。
  let settled = false;
  // ⚠ 竞态修复（CDP 实测命中）：官方相位属性出现（requesting）**早于** `getUserMedia` 包装的
  //   `.then()` 落地（实测排序：phase@+18ms → firstCallAt@+30ms）。旧实现在**相位上升沿那一刻**
  //   快照 `firstCallAt === 0` 就永久计 missed ⇒ **真命中被误判为未命中**（实测该形态下 firstCallAt>0
  //   与 sessionsMissed=1 同时成立，诊断区会误报「未观测到官方采集」= 掩盖问题）。
  //   现改为**会话收口时按调用计数判定**：会话结束时若计数与开始时**相同**（整场一次都没被调用过）
  //   ⇒ 才计 missed。计数只增不减 ⇒ 既免疫「相位先到、包装后落地」的上升沿竞态，
  //   也免疫「本次调用来得极晚（会话结束之后才落地）」的形态（两者均被 CDP 实测命中）。
  const settleMiss = () => {
    const now = b.callCount || 0;
    // 窗口语义：自**上一次会话收口**以来包装器是否被调用过。
    // 为何不用「上升沿快照」（本批 CDP 实测两次命中不同形态的误报）：
    //   ① 相位先到、调用后到（delta 在收口时已 >0，尚可）；
    //   ② **调用先到、相位后到**（实测：callCount 在相位出现时就已是 1）⇒ 上升沿快照把 delta 记成 0，
    //      收口时判「没调用过」= 真命中被误报为 missed。
    // 用「上次收口以来的计数窗口」则与相位/调用的先后顺序无关：本次会话期间只要发生过调用，窗口必变。
    if (now === (b.callCountAtPrevSessionEnd || 0)) {
      b.sessionsMissed++;
      b.lastMissedAt = Date.now();
    }
    b.callCountAtPrevSessionEnd = now;
  };
  // 只读官方失败出口的文案（`.activityMessage`）供诊断区显示，绝不写回
  const readFeedbackMessage = () => {
    try {
      const scope = '[' + OVB_ACTIVITY_ATTR + '="' + OVB_FEEDBACK_PHASE + '"] ';
      const node = document.querySelector(scope + OVB_MESSAGE_CLASS_ATTR)
        || document.querySelector(scope + '.' + OVB_MESSAGE_CLASS);
      const txt = node && typeof node.textContent === 'string' ? node.textContent : '';
      return txt.slice(0, 120);
    } catch (e) { return ''; }
  };
  // 官方相位观察（只读官方渲染出来的 DOM）。收口（settleMiss + lastEndedAt）由 `settled` 保证**恰好一次**。
  const sync = () => {
    const present = !!document.querySelector('[' + OVB_ACTIVITY_ATTR + ']');
    const rec = document.querySelector('[' + OVB_ACTIVITY_ATTR + '="' + OVB_RECORDING_PHASE + '"]');
    const fb = document.querySelector('[' + OVB_ACTIVITY_ATTR + '="' + OVB_FEEDBACK_PHASE + '"]');
    // 记录当前相位（诊断用；idle = 节点已卸载 ⇒ 空串）
    if (fb) b.lastPhase = OVB_FEEDBACK_PHASE;
    else if (rec) b.lastPhase = OVB_RECORDING_PHASE;
    else if (present) b.lastPhase = 'active';
    else b.lastPhase = '';
    // ── 官方 `feedback` 相位（B-3）─────────────────────────────
    // 它**不是**「识别失败」专用出口：官方 `client.js:4990-5026` 实读 ——
    //   `feedback()` 只在**转写已完成之后**调用：
    //   `tooLarge` / 转写失败 / `text === ""`（未识别到语音）/ **`insertText` false**
    //   （草稿冲突；此时转写是**成功**的）。
    // 旧实现把整支当失败并直接 return ⇒ **跳过会话收口**：
    //   `settleMiss` 不计、`lastEndedAt` 永不更新 ⇒ **自动增强永不触发**（实测：E1）。
    // 现在：读数照旧记（`endedInFeedback` 保留 = 订阅方不空等写回），但**同步完成一次收口**。
    // ⚠ `b.active` 在此**保持为真**：官方此时仍占用语音入口（开始按钮不渲染），
    //   若置 false，热键再按会走 `start-button-not-found` 并写 `abandonReason`
    //   ⇒ 诊断区第二优先分支会**盖掉**本条 feedback 文案（又一处会掩盖问题）。
    if (fb) {
      if (!everMounted) {
        everMounted = true;
        settled = false;
        b.sessionsStarted++;
        ovbNotify();
      }
      b.endedInFeedback = true;
      if (!wasFeedback) {
        wasFeedback = true;
        b.feedbackSeen++;
        b.lastSessionFailed = true;   // CHG-090：最近一次会话以失败出口收口
        b.lastFeedbackAt = Date.now();
        b.feedbackMessage = readFeedbackMessage();
        if (!settled) { settled = true; settleMiss(); b.lastEndedAt = Date.now(); }
        ovbNotify();
      }
      return;   // 已收口：等待用户关闭（X）或重试
    }
    if (!fb && wasFeedback) {
      // ⚠ CHG-090：**先**判是否「官方仍在挂载」——它区分两种离开 feedback 的形态：
      //   ① `present` 仍为真 = 官方「重新录音」（新会话已开始）⇒ 最近一次会话**不再是**那场失败 ⇒ 复位；
      //   ② `present` 为假 = 用户点 X 关闭 ⇒ 最近一次会话**确实**以失败收口 ⇒ **保留**读数（不得静默失效）。
      if (present) b.lastSessionFailed = false;
      wasFeedback = false;
      // ⚠ B-4（本批实测）：离开 feedback 相位（官方「重新录音」或 X）必须复位标志，
      //   否则相位已回到 recording 而诊断仍报「上次官方会话以失败收场」（实测：E3）。
      b.endedInFeedback = false;
      // ⚠ 未识别态批（2026-10-15 · 需求 1「未识别态触发 ⇒ **能重新启动一轮**」）：
      //   官方「重新录音」是**相位内换会话**（captureRow 节点不卸载 ⇒ `everMounted` 仍为 true）
      //   ⇒ 上一轮在 feedback 分支已把 `settled` 置 true 且**无人复位**
      //   ⇒ 新一轮**永不收口**：settleMiss 不计、`lastEndedAt` 不更新
      //   ⇒ 自动增强不触发、诊断读数停在上一次（「能重启一轮」等于落空）。
      //   故在此**显式开启新一轮**（仅当确实回到了活跃相位；点 X 时 present 为假 ⇒ 不开）。
      //   ⚠ 与 CHG-085 收口语义一致：feedback 那一轮**已经**收口（不重复计 missed / 不重写时刻），
      //     这里开的是**下一轮**，不是把未识别态当成采集成功。
      if (present) {
        settled = false;
        everMounted = true;
        b.sessionsStarted++;
        b.active = true;
      }
    }
    // 新会话上升沿（含从 feedback 重试：上一会话已收口 ⇒ everMounted 已落）
    if (present && !everMounted) {
      everMounted = true;
      settled = false;
      b.sessionsStarted++;
      b.active = true;
      b.endedInFeedback = false;
      b.lastSessionFailed = false;   // CHG-090：新会话开始 ⇒ 上一场的失败不再是「最近一次」
      ovbNotify();
    }
    if (present && !rec) b.active = true;
    // 会话收口（相位节点消失）
    if (!present && everMounted) {
      everMounted = false;
      b.active = false;
      // ⚠ missed 判定放在**会话收口**处（不是上升沿）：见 settleMiss 注释（竞态修复）。
      // ⚠ B-5：feedback 分支已收口时（settled）**不得**重复收口 —— 否则 missed 被计两次。
      // ⚠ 未识别态批（2026-10-15 · 自查发现的既有缺陷）：下方 `_alreadySettledBeforeGone` 原用共享的 `settled`，
      //   而本分支**刚刚**把 `settled` 置 true ⇒ 该判据恒为真 ⇒ 自第 2 场会话起
      //   `lastEndedAt` **永不更新**（自动增强每页只能装臂一次）。
      //   现先快照「本会话是否**已**在 feedback 分支收口」—— 它才是该判据本来想表达的东西。
      //   ⚠ 语义不变：feedback 已收口 ⇒ 仍不重写时刻（OVB-F01b）；普通收尾 ⇒ 照旧记时刻（OVB-F02）。
      const settledInFeedback = settled;
      if (!settled) { settled = true; settleMiss(); }
      // 官方会话结束 ⇒ 记结束时刻（自动增强的订阅方据此在写回落地后触发）。
      //   若 feedback 分支已写过同一会话的时刻 ⇒ 不覆盖（保持首次收口时间，避免订阅方重复装臂）。
      //   ⚠ 若本会话已在 feedback 分支收口 ⇒ 保留该时刻（不重写），保证订阅方不重复装臂。
      const _alreadySettledBeforeGone = settledInFeedback;
      // ⚠ CHG-090：**成功**收口（节点消失、且不是 feedback 分支已收口的那场）⇒ 最近一次会话未走失败出口。
      //   判据用 `_alreadySettledBeforeGone`：feedback 已收口时**不得**把它抹掉。
      if (!_alreadySettledBeforeGone) b.lastSessionFailed = false;
      if (!_alreadySettledBeforeGone) b.lastEndedAt = Date.now();
      ovbNotify();
      b.endedInFeedback = false;
    }
  };

  try {
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [OVB_ACTIVITY_ATTR] });
    sync();
  } catch (e) { /* 观察失败不致命：诊断区另有包装器调用状态 */ }
}

// ── 安装（幂等）：只包一次；重复安装不叠层 ───────────────────────────────────
function installOfficialVoiceBridge() {
  const b = ovbBus();
  if (!b) return false;
  if (b.installed) return false;                      // 幂等：已装即返回，绝不叠层
  if (ovbDisabled()) { b.abandonReason = 'disabled-by-flag'; return false; }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices
    || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    b.abandonReason = 'no-navigator-media-devices';
    return false;
  }
  const mediaDevices = navigator.mediaDevices;
  // ⚠ 保存**未绑定**的原函数：卸载/HMR 时必须恢复成 `=== 原函数`（绑定副本会破坏同一性，
  //   实测：bind 后再赋回，`getUserMedia === 原函数` 为 false ⇒ HMR 卸载判据必红）。
  //   调用侧用 `original.apply(mediaDevices, arguments)` 保持官方原有的 this 语义。
  const original = mediaDevices.getUserMedia;
  let vadStop = null;

  function wrappedGetUserMedia() {
    // 只读判定 + 原样转发：参数（arguments）与返回值/异常**逐字原样**，绝不改 stream
    // 本插件不接管采集/识别/写回（UD-0005）；外部已声明自采中则直接透传不介入
    if (ovbSelfCapturing()) return original.apply(mediaDevices, arguments);
    const constraints = arguments[0];
    const isAudioOnly = !!constraints && !!(constraints.audio) && !constraints.video;
    const p = original.apply(mediaDevices, arguments);
    if (!isAudioOnly || !p || typeof p.then !== 'function') return p;
    // 只在音频采集上挂观察器；错误原样透传（同一性保持）
    return p.then((stream) => {
      try {
        if (vadStop) { try { vadStop(); } catch (e) { /* 忽略 */ } vadStop = null; }
        b.firstCallAt = b.firstCallAt || Date.now();
        b.lastCallAt = Date.now();
        // ⚠ missed 判定基元（第二次修）：用**调用计数**而非 `firstCallAt` 快照。
        //   为何不能用 firstCallAt 比时刻：若上一次会话已置 firstCallAt，则全程未变；
        //   而本次会话真正的 getUserMedia 可能**迟到**到会话收口之后才落地（CDP 实测命中该形态：
        //   official start → phase recording → 120s 后 finish → 包装器 .then() 才落地）
        //   ⇒ 按时刻比较会把**真命中**判成 missed（本批实测 sessionsMissed=1 且 firstCallAt>0 并存）。
        //   计数只增不减 ⇒ 只要本会话内发生过调用，收口时两值必不同，无竞态、无迟到窗口。
        b.callCount = (b.callCount || 0) + 1;
        // ⚠ SW-1：开关关闭 ⇒ **不启动 VAD**（不观测、不自动停）。
        //   ⚠ 包装观测读数（callCount 等）**照记** —— 它与 VAD 开关无关，且是 missed 判据的基元；
        //     若一并跳过，会把「按意图关闭」误报成「未观测到官方采集」。
        //   ⚠ stream **原样返回**（只观测不改行为：本分支连观测都不做，更不改行为）。
        if (!ovbVadEnabled()) {
          b.vadSkipped = (b.vadSkipped || 0) + 1;
          ovbNotify();
          return stream;
        }
        vadStop = ovbStartVad(stream, () => {
          const r = ovbStopOfficial();
          // ⚠ N-1 修复（第二处）：会话已收尾/未在采集 ⇒ **不得**记降级原因（与 ovbStopOfficial 同语义，
          //   否则手动停之后仍会被写上一次 'silence-detected-stop-unavailable'，同样挂在第一优先分支上）。
          if (r.via === 'no-active-session') return;
          if (!r.stopped && !b.abandonReason) b.abandonReason = 'silence-detected-stop-unavailable';
        });
        ovbNotify();
      } catch (e) { /* 观察失败不得影响官方链路 */ }
      return stream;
    }, (err) => { throw err; });
  }
  wrappedGetUserMedia.__dshPeWrapped = true;

  try { mediaDevices.getUserMedia = wrappedGetUserMedia; } catch (e) {
    b.abandonReason = 'get-user-media-wrap-failed';
    return false;
  }
  b.original = original;
  b.installed = true;
  ovbWrapRecorder();
  ovbWatchActivity();
  ovbNotify();
  return true;
}

// ── 兜底包装：捕获官方 MediaRecorder 实例（仅在官方停止按钮不可用时才用它停）────
// 官方以**裸全局** `new MediaRecorder(stream)` 构造（官方 client.js:4701，全文无局部绑定）
// ⇒ 解析到本包装 ⇒ `inst.start` patch 后记录实例（真实实现构造态为 inactive，start 后才 recording）。
function ovbWrapRecorder() {
  const b = ovbBus();
  if (!b || b.wrappedRecorder) return;
  if (typeof window === 'undefined' || typeof window.MediaRecorder !== 'function') return;
  const Orig = window.MediaRecorder;
  function WrappedRecorder() {
    const inst = new Orig(...arguments);
    try {
      // ⚠ 捕获时机：真实 `new MediaRecorder(stream)` 构造后 state 为 `inactive`，
      //   **只有 start() 之后**才是 `recording` ⇒ 必须在 start() 上挂钩才会拿到实例
      //   （仅按构造态判断会永久漏捕 ⇒ 实测被 OVB-P01 抓到）。
      //   构造态已是 recording 的实现（非常规）一并兜住。
      const st = inst.state;
      if (st === 'recording' || st === undefined) b.recording = inst;
      const origStart = inst.start;
      if (typeof origStart === 'function') {
        inst.start = function () {
          const r = origStart.apply(this, arguments);
          try { if (inst.state === 'recording') b.recording = inst; } catch (e0) { /* 忽略 */ }
          return r;
        };
      }
      // 官方收尾（自身 stop / 手动停 / 上限停）后清引用，防陈旧句柄被再次 stop
      const clearIfSelf = () => { if (b.recording === inst) b.recording = null; };
      if (typeof inst.addEventListener === 'function') {
        inst.addEventListener('stop', clearIfSelf);
      } else if ('onstop' in inst) {
        const prev = inst.onstop;
        inst.onstop = function () { try { if (prev) prev.apply(this, arguments); } finally { clearIfSelf(); } };
      }
    } catch (e) { /* 捕获失败不影响官方实例本身 */ }
    return inst;
  }
  WrappedRecorder.prototype = Orig.prototype;
  for (const k of ['isTypeSupported']) { if (typeof Orig[k] === 'function') WrappedRecorder[k] = Orig[k].bind(Orig); }
  try { window.MediaRecorder = WrappedRecorder; } catch (e) {
    b.abandonReason = 'media-recorder-wrap-failed';
    return;
  }
  b.originalRecorder = Orig;
  b.wrappedRecorder = true;
}

// 卸载 / HMR：恢复原函数（同一性：恢复后 === 原函数），并把命名空间复位
function uninstallOfficialVoiceBridge() {
  const b = ovbBus();
  if (!b) return false;
  if (b.original && typeof navigator !== 'undefined' && navigator.mediaDevices) {
    try { navigator.mediaDevices.getUserMedia = b.original; } catch (e) { /* 忽略 */ }
  }
  if (b.wrappedRecorder && b.originalRecorder) {
    try { window.MediaRecorder = b.originalRecorder; } catch (e) { /* 忽略 */ }
  }
  // ⚠ 必须复位录制器包装态：否则「卸载→再安装」时 ovbWrapRecorder 会被 wrappedRecorder 挡掉，
  //   导致 HMR 反复挂载后兜底捕获永久失效（实测被 OVB-U03 抓到）。
  b.wrappedRecorder = false;
  b.originalRecorder = null;
  b.installed = false;
  b.firstCallAt = 0;
  b.lastCallAt = 0;
  b.callCount = 0;
  b.callCountAtPrevSessionEnd = 0;
  b.recording = null;
  b.active = false;
  b.abandonReason = '';
  b.lastPhase = '';
  b.startClicks = 0;
  b.startMissed = 0;
  b.lastStartMissedAt = 0;
  b.stopClicks = 0;
  b.stopMissed = 0;
  b.retryClicks = 0;
  b.lastStartVia = '';
  b.feedbackSeen = 0;
  b.lastSessionFailed = false;
  b.lastFeedbackAt = 0;
  b.feedbackMessage = '';
  b.endedInFeedback = false;
  b.vadHeardSpeech = false;
  b.vadQuietFrames = 0;
  b.vadThreshold = 0;
  b.vadNoiseFloor = 0;
  b.vadSkipped = 0;
  b.vadFrameSpeech = false;
  b.vadSpeaking = false;
  b.vadRms = 0;
  b.vadSnr = 0;
  b.vadThresholdOff = 0;
  b.vadResolution = 0;
  b.vadPath = '';
  b.vadPathErrors = 0;
  b.vadFrames = 0;
  b.vadCalibrating = true;
  ovbNotify();
  return true;
}

// 官方将来新增钩子 ⇒ 停用包装、优先用官方（§4.6.2.6 D 第 4 行 / UD-0005 总纲）
// 探针 = 官方是否把「静音/自动停」做成正式能力（官方导出面或 remote 方法出现该语义）
function ovbOfficialHookPresent() {
  try {
    if (typeof window === 'undefined') return false;
    const probe = window.__dshSpeechVoiceActivityHook;
    return !!(probe && (typeof probe === 'function' || typeof probe === 'object'));
  } catch (e) { return false; }
}
function ovbYieldToOfficialIfPresent() {
  const b = ovbBus();
  if (!b || !b.installed) return false;
  if (!ovbOfficialHookPresent()) return false;
  uninstallOfficialVoiceBridge();
  b.abandonReason = 'yielded-to-official-hook';
  ovbNotify();
  return true;
}

const officialVoiceBridge = {
  OVB_REGION,
  install: installOfficialVoiceBridge,
  uninstall: uninstallOfficialVoiceBridge,
  snapshot: ovbSnapshot,
  subscribe: ovbSubscribe,
  setTimer: (t) => { const b = ovbBus(); if (b) b.timerSvc = t || null; },
  setSelfCapture: ovbSetSelfCapture,
  officialCapturing: ovbOfficialCapturing,
  // 未识别态批（2026-10-15）：与 officialCapturing **语义不同**的读数 —— 官方是否仍占用语音入口
  //   （含收尾/未识别态）。CHG-085 收口语义与诊断面依赖它；不得与「采集中」混用。
  officialEntryBusy: ovbOfficialEntryBusy,
  startOfficial: ovbStartOfficial,
  stopOfficial: ovbStopOfficial,
  yieldToOfficialIfPresent: ovbYieldToOfficialIfPresent,
  _internal: {
    START_LABELS: OVB_START_LABELS,
    STOP_LABELS: OVB_STOP_LABELS,
    // §7.4：静音帧数现由配置动态计算（不再是常量）⇒ 对外暴露**计算入口**，供测试与运行期核对
    requiredQuiet: () => vadRequiredQuiet(vadSilenceMsOf(voiceCfgState.value)),
    ACTIVITY_ATTR: OVB_ACTIVITY_ATTR,
    FEEDBACK_PHASE: OVB_FEEDBACK_PHASE,
    RECORDING_PHASE: OVB_RECORDING_PHASE,
    bus: ovbBus,
    findStartButton: ovbFindStartButton,
    findRetryButton: ovbFindRetryButton,
    RETRY_LABELS: OVB_RETRY_LABELS,
    findStopButton: ovbFindStopButton,
    // N-1 判据基元：官方当前是否确在录音（只读官方相位属性）——供测试与运行期核对
    recordingNow: ovbRecordingNow,
  },
};


  return officialVoiceBridge;
}

module.exports = { createOfficialVoiceBridge };
