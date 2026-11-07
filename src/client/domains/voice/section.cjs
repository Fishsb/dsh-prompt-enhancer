'use strict';

// 语音设置区块普通模块（构建期由客户端运行时内联）。
// 诊断组件与设置区块的可见文案、类名、ARIA 和交互不变。
function createVoiceSection(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const rpcMethods = d.rpcMethods && typeof d.rpcMethods === 'object' ? d.rpcMethods : {};
  const React = d.React;
  const makeT = d.makeT;
  const host = d.host;
  const voiceCfgState = d.voiceCfgState;
  const subscribeVoiceConfig = d.subscribeVoiceConfig;
  const saveVoiceCfg = d.saveVoiceCfg;
  const syncVoiceFromHost = d.syncVoiceFromHost;
  const vadSilenceMsOf = d.vadSilenceMsOf;
  const normalizeVadSilenceMs = d.normalizeVadSilenceMs;
  const CollapsibleSection = d.CollapsibleSection;
  const voiceHotkeyDisplay = d.voiceHotkeyDisplay;
  const officialVoiceBridge = d.officialVoiceBridge;
  const fillerSnapshot = d.fillerSnapshot;
  const subscribeFiller = d.subscribeFiller;
  const correctionSnapshot = d.correctionSnapshot;
  const subscribeCorrection = d.subscribeCorrection;
  const setTimeout = d.setTimeout;
  const clearTimeout = d.clearTimeout;
  const window = d.window;
// v3.2.5（语音识别模块）：设置段落块——「模型配置」tab 内可折叠段落（collapsible-section 样式）。
// P1-a（2026-10-13 缩批）：**引擎/云端/模型下载/运行时部署** 各段已退役（识别交官方
//   speech-to-text，其引擎与模型由官方设置页管理；插件不再持有 asr.cloud/local 面）。
//   本段只保留**四项增值**的配置：① 自动增强 ② 静音监测（VAD）③ 热键 ④ 文本规整（refine）。
// 交互：字段 blur/change 即 config/set（无保存按钮）；快捷键录制 blur/失焦取消。
// P2-补做（2026-10-13 · §4.6.2.6 D）：不得静默失效——官方录音路径增值对齐的**设置页诊断区**。
// 判据形态：若某次官方录音会话中包装器**从未被调用** ⇒ 必须在此处可见
// （「未观测到官方采集（自动停未生效）」）——不是只写日志。
// 2026-10-17：把「上次失败」的时刻折算成可读时距（给诊断文案用）。
//   ⚠ 只读、纯函数；无时刻（0/非法）⇒ 返回''，由调用方退化为不带时距的写法。
function ovbSinceLabel(at) {
  if (!at || typeof at !== 'number') return '';
  var d = Date.now() - at;
  if (d < 0) return '';
  var m = Math.floor(d / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟';
  var h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时';
  return Math.floor(h / 24) + ' 天';
}
function OfficialVoiceDiag(props) {
  const t = makeT(props);
  const [snap, setSnap] = React.useState(function () {
    return (typeof officialVoiceBridge !== 'undefined' && officialVoiceBridge) ? officialVoiceBridge.snapshot() : null;
  });
  React.useEffect(function () {
    if (typeof officialVoiceBridge === 'undefined' || !officialVoiceBridge) return undefined;
    const refresh = function () { setSnap(officialVoiceBridge.snapshot()); };
    refresh();
    return officialVoiceBridge.subscribe(refresh);
  }, []);
  if (!snap) return null;
  // 官方将来新增钩子 ⇒ 停用包装、优先用官方（总纲）
  if (typeof officialVoiceBridge !== 'undefined' && officialVoiceBridge
    && typeof officialVoiceBridge.yieldToOfficialIfPresent === 'function') officialVoiceBridge.yieldToOfficialIfPresent();
  // ⚠ D-1（空床假阳性修复）：**官方会话次数为 0** 时必须与「已验证」**可区分** ——
  //   旧末支（else = 「已就绪（等待官方录音）」）在 0 次会话时同样成立 ⇒ 与「官方路径已验证」同形
  //   （这正是「把『桥已装好』误读为『官方路径没问题』」的来源）。现按**会话计数**分支：
  //   0 次 ⇒ 明说「尚未观测到」；≥1 次且空闲 ⇒ 报「已观测到 N 次」。
  // ⚠ D-2（selfCapture 分支缺失修复）：外部显式声明自采中须可见（不得留描述不存在能力的串）。
  let text;
  let cls = 'dsh-plg-note';
  if (!snap.installed) { text = t('voiceOfficialDisabled'); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }
  // 2026-10-17（文案改白话）：abandonReason 是**内部代码**（如 stop-click-dispatch-failed），
  //   不是给普通用户看的话 ⇒ 从可见文案移到 title（原始读数仍在，排查不受影响）。
  else if (snap.abandonReason) { text = t('voiceOfficialAbandon'); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }
  else if (snap.selfCapture) { text = t('voiceOfficialSelfCapture'); }
  else if (snap.startMissed > 0 && snap.sessionsStarted === 0) { text = t('voiceOfficialStartMissed'); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }
  else if (snap.endedInFeedback) { text = t('voiceOfficialFeedback') + (snap.feedbackMessage ? '（' + snap.feedbackMessage + '）' : ''); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }
  else if (snap.sessionsMissed > 0) { text = t('voiceOfficialMissed'); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }
  // ⚠ SW-1（2026-10-15 接线批 · 用户可见开关不得说假话）：开关关闭态**必须可见** ——
  //   否则关掉「静音监测」后诊断会落到「已就绪（等待官方录音）」，读起来像「正在监测、只是还没触发」。
  //   ⚠⚠ **位置纪律（本席自查修正）**：必须排在**所有失效/异常分支之后** ——
  //     `abandonReason`（降级）/ `startMissed`（热键启动失败）/ `endedInFeedback`（失败出口）/ `sessionsMissed`（包装未命中）
  //     都是「不得静默失效」面。若开关态排在它们**之前**，用户一旦关掉开关，这些**真实故障会被永久掩蔽**
  //     （实测：关掉开关后「热键启动失败」也显示成「静音监测已关闭」，用户会以为是自己设置导致、实则热键坏了）。
  //   ⚠ 只排在**正常/瞬态**分支（`recording`/`feedbackSeen`/`sessionsStarted`/`armed`）之前：
  //     那些不是故障，而「开关到底关没关」正是用户此刻的疑问 ⇒ 开关态优先作答。
  else if (snap.vadEnabled === false) { text = t('voiceSilenceOff'); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }
  else if (snap.recording) { text = t('voiceOfficialActive'); }
  // ⚠ CHG-090（2026-10-15 诊断如实化批）：此前判据是 `snap.feedbackSeen > 0` —— 而它是**页面生命期累计**
  //   （唯一自增点在 feedback 收口；`= 0` 只在 uninstall）⇒ 文案「**上次**官方会话以失败收场」实为「**历次累计发生过**」
  //   且**永不自消**（刷新/HMR 才归零）⇒ 把**历史残留**读成**当前失败**（用户最初报障看到的那行正由此而来）。
  //   现改用**会话级**读数 `lastSessionFailed`（最近一次已收口会话是否走失败出口）：
  //   ① 最近一次**真的**以失败收口 ⇒ 仍为真 ⇒ **仍然可见**（不得静默失效）；
  //   ② 之后录了一场**成功**会话 / 官方「重新录音」开了新会话 ⇒ 复位 ⇒ 不再报陈年旧事。
  // ⚠⚠ 2026-10-17（设置文案审查批 · 用户第二轮报障 D）：该分支依据 lastSessionFailed，而它的复位
  //   条件只有「之后录了一场成功会话」⇒ 很久没录音就一直挂着陈年失败。本批给它**时间可判性**：
  //   · 刚失败（< 24h）⇒ 报「刚刚」；
  //   · 很久以前（≥ 24h）⇒ 报「上次录音没有识别成功（{when}前）」，把时距直接写在可见文案里；
  //   · 之后成功过 ⇒ lastSessionFailed 已被桥复位为 false，本分支不进入（第三态由桥保证）。
  //   ⛔ 不得因此把失败吞掉：三态里前两态都仍然可见，且原始时刻留在 title（lastFailAt=）。
  else if (snap.lastSessionFailed === true) {
    // ⚠ 时距取不到（脏快照 / 老桥无该字段）时**退化为不带时距的写法** —— 不得渲染出「（前）」这类残句。
    const ago = ovbSinceLabel(snap.lastSessionFailedAt);
    text = ago ? t('voiceOfficialFeedbackSeenAgo').replace('{when}', ago) : t('voiceOfficialFeedbackSeen');
  }
  // F-11 修复（2026-10-13）：键内已含占位符 ⇒ 此处**代入**而不再追加第二个计数
  //   （旧实现 key 含 %d 未替换、此处又追加一个括号计数 ⇒ 用户可见 `…（共 %d 次）（1）`）。
  else if (snap.sessionsStarted > 0) { text = t('voiceOfficialVerified').replace('{n}', String(snap.sessionsStarted)); }
  else { text = t('voiceOfficialArmed'); }
  // title 兼作「原始读数」出口：官方失败出口文案 / 派发点击计数 / 包装调用计数（排查用）
  const diagTitle = [snap.feedbackMessage, snap.abandonReason,
    'sessions=' + snap.sessionsStarted, 'missed=' + snap.sessionsMissed,
    'startClicks=' + snap.startClicks, 'stopClicks=' + snap.stopClicks,
    // ⚠ CHG-090：`stopMissed` 此前**只**在 snapshot 里、用户任何可见面都读不到
    //   ⇒ 与 `stopClicks` 相邻只读暴露（`stopClicks` 成功停 / `stopMissed` 停派发失败，成对可判）。
    //   注意：`abandonReason` 仍在数组**首位** ⇒ 降级原因的可读性未被本改动削弱。
    'stopMissed=' + (snap.stopMissed || 0),
    'feedback=' + snap.feedbackSeen,
    // 2026-10-17（报障 D）：失败发生时刻（原始读数，供排查「是不是陈年旧事」）
    'lastFailAt=' + (snap.lastSessionFailed && snap.lastSessionFailedAt ? new Date(snap.lastSessionFailedAt).toISOString() : '-'),
    // ⚠ VAD-1（2026-10-14 定位批 · 不得静默）：静音判定的内部读数（包括阈值）
    //   必须可被用户读到 —— 就是这一格此前**无法判别**：用户只能看到一句
    //   会误导的「以失败收场」，而真正失效的是「声门从未开过」。
    'vadHeard=' + (snap.vadHeardSpeech ? '1' : '0'), 'vadQuiet=' + snap.vadQuietFrames,
    'vadThr=' + (typeof snap.vadThreshold === 'number' ? snap.vadThreshold.toFixed(4) : '0'),
    'vadFloor=' + (typeof snap.vadNoiseFloor === 'number' ? snap.vadNoiseFloor.toFixed(4) : '0'),
    // ⚠ SW-1：开关真值 + 「因开关关闭而未启动 VAD」的采集次数（开关真的约束了行为的证据）
    'vadOn=' + (snap.vadEnabled === false ? '0' : '1'), 'vadSkipped=' + (snap.vadSkipped || 0),
  ].filter(function (x) { return !!x; }).join(' | ');
  return React.createElement('div', { className: 'dsh-plg-row' },
    React.createElement('span', { className: cls, role: 'status', title: diagTitle }, t('voiceOfficialDiagTitle') + '：' + text),
  );
}
// CHG-117：清口水词**可见性**组件（不得静默失效 —— 承 `CHG-115` `I-2`）。
//   显示：执行次数 / 发生过清理的次数 / 累计删除处数 / 因开关关闭而跳过次数 / 旧配置清理态。
//   ⚠ 开关**关闭**态必须可见（否则用户无法区分「没口水词」与「功能没跑」）。
function FillerDiag(props) {
  const t = makeT(props);
  const [snap, setSnap] = React.useState(function () {
    return (typeof fillerSnapshot === 'function') ? fillerSnapshot() : null;
  });
  React.useEffect(function () {
    const refresh = function () { setSnap(typeof fillerSnapshot === 'function' ? fillerSnapshot() : null); };
    refresh();
    const offs = [];
    if (typeof subscribeFiller === 'function') offs.push(subscribeFiller(refresh));
    // ⚠ 开关变化也要刷新（否则"关闭"态不会即时可见 ⇒ 静默）
    if (typeof subscribeVoiceConfig === 'function') offs.push(subscribeVoiceConfig(refresh));
    return function () { for (const off of offs) { try { off(); } catch (e) { /* 忽略 */ } } };
  }, []);
  if (!snap) return null;
  // ⚠ 开关真值直接读**单一事实源**（`voiceCfgState`），不从 props 传（避免两处真相）
  const cfgNow = (typeof voiceCfgState !== 'undefined' && voiceCfgState && voiceCfgState.value) ? voiceCfgState.value : {};
  const on = !!(cfgNow.filler && cfgNow.filler.enabled !== false);
  let text;
  if (!on) text = t('voiceRefineSkipped');
  else if (snap.cleaned > 0) text = t('voiceRefineCleaned') + ' ×' + snap.cleaned;
  // ⚠ 2026-10-17（文案 bug · 用户可见「清口水词：清口水词」）：此处的谓语原用 t('voiceRefineEnabled')，
  //   而 voiceRefineEnabled 的中文值就是「清口水词」，与主语 t('voiceRefineSection') 同词 ⇒ 主谓同形。
  //   现改用**专表状态的** voiceRefineIdle（'没有需要清理的'），主语/谓语是两个不同的键。
  // 2026-10-17（文案 bug 「清口水词：清口水词」）根因与修法：
  //   渲染是 t('voiceRefineSection') + '：' + 谓词，而谓词键 voiceRefineEnabled 的中文值
  //   也写成「清口水词」⇒ 主语谓语同一个词。
  //   ⇒ 遵守「只改值、不改键名、不新增键」：把**该键的值**改成一句状态话，形态与键名都不动。
  else text = t('voiceRefineEnabled');
  const title = [
    'runs=' + snap.runs, 'cleaned=' + snap.cleaned, 'removed=' + snap.removedTotal,
    'skipped=' + snap.skipped, 'on=' + (on ? '1' : '0'),
    'lastRemoved=' + (snap.lastRemoved && snap.lastRemoved.length ? snap.lastRemoved.map(function (x) { return x.text + '×' + x.count + '(' + x.kind + ')'; }).join(',') : '-'),
    // ⚠ 旧配置一次性清理的可见读数（用户裁定 2：不得静默删）
    'legacyRefine=' + (snap.legacyCleaned ? 'cleaned' : (snap.legacyChecked ? 'none' : 'pending')),
    // 2026-10-17：正常态不再单独显示它，但该事实仍在此可读（键保留、有消费者、信息不丢）
    (snap.legacyChecked && !snap.legacyCleaned ? t('voiceRefineLegacyNone') : ''),
  ].join(' | ');
  return React.createElement('div', { className: 'dsh-plg-row' },
    React.createElement('span', { className: 'dsh-plg-note', role: 'status', title: title },
      t('voiceRefineSection') + '：' + text),
    // 2026-10-17（§7.4 ③「无事发生」类）：**正常态不再报**。原实现对 `legacyChecked && !legacyCleaned`
    //   也渲染一行「无旧版规整配置」—— 那是「无事发生」的复述（用户点名的冗余）。
    //   ⚠ 但**未检完**（pending，即可能还有待处理）仍必须报；清理成功也报（那是有效读数的另一半）。
    //   ⛔ 不得把 pending 也静默掉 —— 那才是「静默失效」。
    React.createElement('span', { className: 'dsh-plg-muted', title: title },
      (snap.legacyCleaned ? ' · ' + t('voiceRefineLegacy') : (snap.legacyChecked ? '' : ' · ' + t('voiceRefineLegacyPending')))),
  );
}

// CHG-143：语音纠错的可见性诊断（不得静默失效 —— 承 CHG-115 I-2）。
//   ⚠ 位置纪律（承 SW-1 先例）：**开关关闭态**分行呈现，且**先报任何失败**（failed/lastCode）
//     再报「因开关未跑」——否则真实故障会被开关态永久掩蔽。
function CorrectionDiag(props) {
  const t = makeT(props);
  const [snap, setSnap] = React.useState(function () {
    return (typeof correctionSnapshot === 'function') ? correctionSnapshot() : null;
  });
  React.useEffect(function () {
    const refresh = function () { setSnap(typeof correctionSnapshot === 'function' ? correctionSnapshot() : null); };
    refresh();
    const offs = [];
    if (typeof subscribeCorrection === 'function') offs.push(subscribeCorrection(refresh));
    // ⚠ 开关变化也要刷新（否则「关闭」态不会即时可见 ⇒ 静默）
    if (typeof subscribeVoiceConfig === 'function') offs.push(subscribeVoiceConfig(refresh));
    return function () { for (const off of offs) { try { off(); } catch (e) { /* 忽略 */ } } };
  }, []);
  if (!snap) return null;
  // ⚠ 开关真值直接读**单一事实源**（voiceCfgState），不从 props 传（避免两处真相）
  const cfgNow = (typeof voiceCfgState !== 'undefined' && voiceCfgState && voiceCfgState.value) ? voiceCfgState.value : {};
  const on = !!(cfgNow.correction && cfgNow.correction.enabled === true);
  // ══ 残留①治理批（2026-10-20 · 本批）：可见文案 = **最近一次执行的结局**，⛔ 不再是页面累计计数。
  //   病历（用户口径 · 承 CHG-090 同族）：旧写法 `if (snap.failed > 0)` 读的是 `correctionState.failed`
  //   （**页面生命期累计**，只在刷新/HMR 归零）⇒ 哪怕最近一次是成功、或压根没跑，设置页也永远
  //   自报「纠错失败 ×N」。把「历史」当成「当下」—— 与本仓 `feedbackSeen`（CHG-090）同一类病。
  //
  //   ⚠ **单一事实源**：结局取自 `snap.phase`，而它由 `correction.js` 的 `correctionPhaseOf()`
  //     **唯一**推导（那台状态机已经拥有「刚刚这一次是什么」这个事实）。⛔ 本渲染层**不**按
  //     runs/failed/changed 这些**累计**计数反推「最近一次是什么」（那正是旧缺陷的成因）。
  //   ⚠ **失败不得被吞掉**：最近一次确实是 failed ⇒ 仍报失败（⛔ 不是为了「不报错」而静默真故障）。
  //     历史累计（runs/ok/changed/failed/skipped/lastCode/lastSkip）**原样保留在 title**。
  //   ⚠ **区分仍在**：「因开关没跑」(skipped / off) 与「跑了没改动」(unchanged) 是两组不同键，
  //     ⛔ 不得合并成同形（PROJECT §7.7 / R12 硬要求）。
  //   ⚠ 位置纪律（承 SW-1）：**真实故障与「没跑」排在开关态之前** —— 开关关着也不能掩蔽最近一次失败。
  //   ⚠ 时间可判性（承 CHG-090 与 2026-10-17 设置文案审查批）：失败/跳过给「多久前」，复用本文件既有
  //     时距函数 `ovbSinceLabel`（⛔ 不新造第二套折算）；取不到时刻 ⇒ **退化为不带时距**的写法，
  //     ⛔ 不得渲染出「（前）」这类残句（拼装前先判空，见下）。
  let text;
  const base = (function () {
    const ph = snap.phase;
    if (ph === 'failed') return t('voiceCorrectionFailed');
    if (ph === 'skipped') return t('voiceCorrectionSkipped');
    if (ph === 'running') return t('voiceCorrectionStateRunning');
    if (ph === 'changed') return t('voiceCorrectionChanged');
    if (ph === 'unchanged') return t('voiceCorrectionNoChange');
    // 走到这里 = 本页还没有任何一次执行（idle）：此时「开关关没关」才是用户此刻的疑问。
    if (!on) return t('voiceCorrectionOff');
    return t('voiceCorrectionArmed');
  })();
  // 括号里只放**这一次**的细节（失败码 / 多久前）—— ⛔ 不放任何累计计数（累计在 title）。
  const detail = (function () {
    const parts = [];
    if (snap.phase === 'failed' && snap.lastFailCode) parts.push(String(snap.lastFailCode));
    // 只有「失败 / 跳过」需要时距（这两态才值得问「是不是陈年旧事」）
    if (snap.phase === 'failed' || snap.phase === 'skipped') {
      const ago = ovbSinceLabel(snap.lastAt);
      // ⚠ 文案打磨：「刚刚」本身已含时距，再拼「前」会得到「（刚刚前）」这种别扭串
      //   （既有 official 诊断的键是「…（{when}前）」，那里 when 取不到就整段不渲染；
      //    这里同样的**不得出残句**纪律，用「刚刚 ⇒ 不拼前」实现）。
      if (ago) parts.push(ago === '刚刚' ? ago : ago + '前');
    }
    return parts.length ? '（' + parts.join(' · ') + '）' : '';
  })();
  text = base + detail;
  // title = **原始读数出口**（累计全部保留；可见文案不再夹带它们）
  const title = [
    'runs=' + snap.runs, 'ok=' + snap.ok, 'changed=' + snap.changed, 'failed=' + snap.failed,
    'skipped=' + snap.skipped, 'on=' + (on ? '1' : '0'),
    'lastCode=' + (snap.lastCode || '-'),
    'lastSkip=' + (snap.lastSkipReason || '-'),
    // 本批新增两格：最近一次结局 + 发生时刻（可见文案已按时距表达，这里留机器可读原件）
    'phase=' + (snap.phase || '-'),
    'lastAt=' + (snap.lastAt ? new Date(snap.lastAt).toISOString() : '-'),
  ].join(' | ');
  return React.createElement('div', { className: 'dsh-plg-row' },
    React.createElement('span', { className: on ? 'dsh-plg-note' : 'dsh-plg-note dsh-plg-upd-outdated', role: 'status', title: title },
      t('voiceCorrectionSection') + '：' + text),
  );
}
/* UD-0055 / UD-0057（学习词典）：归一与上限一律取契约层（lib/voice-config.cjs），
   本模块不自建筛子/合并逻辑。三处取值都写成 typeof 守卫：真实运行时由 app.cjs 注入，
   测试夹具（test/helpers/client-voice-modules.cjs 的 factoryBody）只取工厂内部正文，
   注入名为位置参数、没有 deps 对象，此时回落到契约层的默认值。 */
const _dictDeps = (typeof d !== 'undefined' && d && typeof d === 'object') ? d : {};
const normalizeDictionaryEntries = typeof _dictDeps.normalizeDictionaryEntries === 'function' ? _dictDeps.normalizeDictionaryEntries : null;
const dictionaryMaxEntries = typeof _dictDeps.VOICE_DICTIONARY_MAX_ENTRIES === 'number' ? _dictDeps.VOICE_DICTIONARY_MAX_ENTRIES : 500;
const dictionaryMaxTerm = typeof _dictDeps.VOICE_DICTIONARY_MAX_TERM === 'number' ? _dictDeps.VOICE_DICTIONARY_MAX_TERM : 20;

// ── 学习词典编辑器（UD-0055 / UD-0057）─────────────────────────────────────
// 口径：**自动入库**（采集侧在 hotkey 模块）+ **可编辑**（本组件）= 用户要的两件事。
//   · 编辑 / 删除 / 新增 / 停用 四种操作全在此；⛔ 没有「待审队列」（用户明确不要审）。
//   · 写入统一走 `saveVoiceCfg({ dictionary })` ⇒ 本地持久化 + `config/set` 落盘（既有入口，不新造）。
//   · 归一（长度、形近、去重合并、上限淘汰）一律交契约层 —— 本组件只产出「用户想要的结果」。
function DictionaryEditor(props) {
  const t = makeT(props);
  const v = voiceCfgState.value || {};
  const entries = (v.dictionary && Array.isArray(v.dictionary.entries)) ? v.dictionary.entries : [];
  const [buf, setBuf] = React.useState({ from: '', to: '' });
  const commit = (list) => {
    const normalized = normalizeDictionaryEntries ? normalizeDictionaryEntries(list) : list;
    saveVoiceCfg({ dictionary: { entries: normalized } });
  };
  const patchAt = (i, patch) => {
    const next = entries.map((e, k) => (k === i ? Object.assign({}, e, patch) : e));
    commit(next);
  };
  const removeAt = (i) => { commit(entries.filter((e, k) => k !== i)); };
  const addOne = () => {
    const from = String(buf.from || '').trim();
    const to = String(buf.to || '').trim();
    if (!from || !to) return;                         // 两侧都要有；⛔ 不静默造空条目
    commit(entries.concat([{ from: from, to: to, hits: 0, at: Date.now(), enabled: true }]));
    setBuf({ from: '', to: '' });
  };
  const termInput = (value, onChange, aria) => React.createElement('input', {
    type: 'text', className: 'dsh-plg-input', maxLength: String(dictionaryMaxTerm), 'aria-label': aria,
    value: value, style: { width: '110px', minWidth: '90px' }, onChange: (e) => onChange(e.target.value),
  });
  const rows = entries.map((e, i) => React.createElement('div', {
    className: 'dsh-plg-row', key: 'dict-' + i, style: { flexWrap: 'wrap', gap: '8px' },
  },
    React.createElement('span', { className: 'dsh-plg-muted' }, t('voiceDictFrom')),
    termInput(e.from, (x) => patchAt(i, { from: x }), t('voiceDictFrom')),
    React.createElement('span', { className: 'dsh-plg-muted' }, '→'),
    termInput(e.to, (x) => patchAt(i, { to: x }), t('voiceDictTo')),
    React.createElement('button', {
      type: 'button',
      className: 'dsh-plg-btn dsh-plg-tgl' + (e.enabled !== false ? ' dsh-plg-tgl-on' : ''),
      'aria-label': t('voiceDictEnable'), title: t('voiceDictEnable'),
      onClick: () => patchAt(i, { enabled: e.enabled === false }),
    }, e.enabled !== false ? t('voiceDictEnable') : '✕'),
    React.createElement('span', { className: 'dsh-plg-muted' }, String(e.hits || 0) + ' ' + t('voiceDictHits')),
    React.createElement('button', {
      type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly',
      title: t('voiceDictDelete'), 'aria-label': t('voiceDictDelete'),
      onClick: () => removeAt(i),
    }, '✕'),
  ));
  return React.createElement('div', { className: 'dsh-vi-section' },
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('span', { className: 'dsh-plg-label', style: { width: 'auto' }, title: t('voiceDictTip') }, t('voiceDictSection'))
    ),
    entries.length === 0
      ? React.createElement('div', { className: 'dsh-plg-row' },
        React.createElement('span', { className: 'dsh-plg-muted' }, t('voiceDictEmpty')))
      : React.createElement('div', null, rows),
    React.createElement('div', { className: 'dsh-plg-row', style: { flexWrap: 'wrap', gap: '8px' } },
      termInput(buf.from, (x) => setBuf({ from: x, to: buf.to }), t('voiceDictFrom')),
      React.createElement('span', { className: 'dsh-plg-muted' }, '→'),
      termInput(buf.to, (x) => setBuf({ from: buf.from, to: x }), t('voiceDictTo')),
      React.createElement('button', {
        type: 'button', className: 'dsh-plg-btn', onClick: addOne,
        disabled: !String(buf.from).trim() || !String(buf.to).trim(),
      }, t('voiceDictAdd')),
    ),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('span', { className: 'dsh-plg-muted', style: { whiteSpace: 'normal' } }, t('voiceDictTip'))
    ),
    entries.length >= dictionaryMaxEntries
      ? React.createElement('div', { className: 'dsh-plg-row' },
        React.createElement('span', { className: 'dsh-plg-note' }, t('voiceDictFull').replace('{n}', String(dictionaryMaxEntries))))
      : null,
  );
}
function VoiceSection(props) {
  const t = makeT(props);
  const [ver, setVer] = React.useState(0);
  const [status, setStatus] = React.useState(null); // {speech, refine} 就绪态
  // 快捷键录制模式（true=正在等待按键；期间暂停 mic 快捷键监听，避免抢走录制按键）
  const [hotkeyCapture, setHotkeyCapture] = React.useState(false);
  const startHotkeyCapture = () => { if (typeof window !== 'undefined') window.__voiceHotkeyCapturing = true; setHotkeyCapture(true); };
  const cancelHotkeyCapture = () => { if (typeof window !== 'undefined') window.__voiceHotkeyCapturing = false; setHotkeyCapture(false); };
  const onHotkeyKeyDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { cancelHotkeyCapture(); return; }
    const mods = ['Control', 'Alt', 'Shift', 'Meta'];
    if (mods.indexOf(e.code) >= 0) return; // 纯修饰键按下：等待主键
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    parts.push(e.code);
    saveVoiceCfg({ hotkey: { enabled: true, combo: parts.join('+') } });
    cancelHotkeyCapture();
  };
  const clearHotkey = () => { saveVoiceCfg({ hotkey: { enabled: false, combo: '' } }); };

  React.useEffect(() => subscribeVoiceConfig(() => setVer((v) => v + 1)), []);
  // 设置一变即刷新状态（防抖 350ms 合并连续改动；首次跳过）
  const skipFirstVerRef = React.useRef(true);
  React.useEffect(() => {
    if (skipFirstVerRef.current) { skipFirstVerRef.current = false; return; }
    const tmr = setTimeout(() => { check(); }, 350);
    return () => clearTimeout(tmr);
  }, [ver]);
  React.useEffect(() => {
    syncVoiceFromHost();
    check();
  }, []);

  const v = voiceCfgState.value;

  // 就绪态：识别引擎（委托官方 speechToText.snapshot()）+ 规整
  const check = () => {
    host.call(rpcMethods.VOICE_STATUS, {}).then((r) => { setStatus(r && r.ok === true ? r : null); }).catch(() => { setStatus(null); });
  };
  const speechReady = !!(status && status.speech && status.speech.available);
  const speechProviders = (status && status.speech && Array.isArray(status.speech.providers)) ? status.speech.providers : [];

  // CHG-117：原「规整跟随基座模型」的 models/list 拉取与 provider/model 选择面**整体删除**
  //   （清口水词为纯本地规则，无模型可配）。

  // 2026-10-18（UI 回退修复批 · 实机报障）：开关宽度改回**由「文字 + 内边距」决定**。
  //   病历（本批实测，settings-layout-audit 同款装置 + 多宽度扫描）：上一版把它写成**固定 96px**，
  //   而它所在的 row1 是 display:grid + 末列 minmax(220px,1fr) ⇒ 视口收窄到 760px 以下时
  //   末列被 220px 下限顶住、前三列的 96px 也随之失去可分配空间，grid 项**沿块轴被撑开**：
  //   实测 760px 容器下 96×30，640px 下 96×68，560px 及更窄下 **96×96（近方形）**。
  //   ⚠ 根因不是「96 这个数太大」而是「宽度被写成了与内容无关的像素」：
  //     调小像素只会把方块的高度门槛挪到别的宽度，不消除方块（本仓 CHG-179 已两次栽在固定像素）。
  //   ⇒ 宽度交给内容：width:auto + white-space:nowrap + 内边距（.dsh-plg-btn 的 5px 14px）。
  //   ⚠ min-width 是**兜底不裁**的下限（不是定宽）：EN 最长现实取值实测为
  //     Enhance OFF 102.13px / Correct OFF 95.98px / Silence OFF 94.22px / Filler OFF 81.17px；
  //     ZH 侧四个开关均 93px。取 96px ⇒ EN/ZH 两语言最长态都无省略号（实测 ell=false 全绿）。
  const ToggleChip = (p) => React.createElement('button', {
    type: 'button',
    className: 'dsh-plg-btn dsh-plg-tgl' + (p.on ? ' dsh-plg-tgl-on' : ''),
    onClick: p.onToggle,
    title: p.title || '',
    // 宽度由内容决定（auto + nowrap），min-width 只兜「EN 最长态不裁」的下限 —— 高度因此恒等于行高，不随宽度变化。
    //   ⚠ 不得改回固定 width:<px>：那会把「被挤压」换成「被撑成方块」（本批病历）。
    style: { width: 'auto', minWidth: '112px', boxSizing: 'border-box', flex: '0 0 auto', alignSelf: 'center', textAlign: 'center', whiteSpace: 'nowrap' },
  }, p.onText);

  // 行1（2026-10-17 布局批：原五列 → **四列**）：自动增强 | **语音纠错** | 清口水词 | 快捷键
  //   ⚠ 静音监测开关**已移出本行**（搬到第二行 silenceRow）⇒ 本行格数与 gridTemplateColumns 同步减一。
  const fillerCfg = v.filler || {};
  const fillerOn = fillerCfg.enabled !== false;   // ⚠ 默认**开**（用户裁定 4）
  // CHG-143：语音纠错（**独立步** · 默认关 · 与自动增强并联）
  const correctionOn = !!(v.correction && v.correction.enabled === true);
  // 2026-10-18（UI 回退修复批）：末列由 minmax(220px,1fr) 退回 minmax(0,1fr)。
  //   病历：220px 是上一版为「热键输入框别被压」加的硬下限，但它是**列的**下限 ⇒ 视口一窄，
  //   前三列（开关）与末列一起被顶住，grid 行高被撑到 68/96px（开关变方块、热键行折成多行）。
  //   ⇒ 热键输入框的可用性改由**它自己**的 min-width:120px 保（见该行 input 的 style），
  //     列的最小值回到 0 ⇒ 窄视口下先压缩的是**行内文本**，不是把行撑高。
  //   2026-10-18（本批第二轮）：**grid ⇒ flex + wrap**。上一版是 `display:grid` + 末列 `minmax(220px,1fr)`，
  //   而末列里装的是「热键 label + 输入框 + 清除」这一整行；grid 的列**不会回流**，视口一窄就只能由
  //   末列的容器自己去折行 ⇒ 该格从 30px 涨到 68/96px，而 grid 项默认 `align-items:normal`（=stretch）
  //   ⇒ **同一行的三个开关被沿块轴拉到同样的 68/96px 高**（实测 96×96 近方形，正是用户截图所见）。
  //   ⇒ 改 flex + flexWrap：热键子行是**独立的 flex 项**，窄视口时整块折到下一行并吃满整行宽度，
  //     不再把开关那一行撑高；`alignItems:center` 再兜一层（即使某行里出现更高的兄弟，开关也不被拉伸）。
  const row1 = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' } },
    React.createElement(ToggleChip, {
      on: !!v.autoEnhance,
      onText: t('voiceAutoEnhance') + t(v.autoEnhance ? 'voiceAutoEnhanceOn' : 'voiceAutoEnhanceOff'),
      title: t('voiceAutoEnhanceTip'),
      onToggle: () => saveVoiceCfg({ autoEnhance: !v.autoEnhance }),
    }),
    // CHG-143：语音纠错 —— 与其余开关**同款** ToggleChip（自述式「语音纠错开/关」）
    //   ⚠ 与「自动增强」是**两个独立开关**：只纠错不增强、或先纠错再增强，由两者组合决定。
    React.createElement(ToggleChip, {
      on: correctionOn,
      onText: t('voiceCorrectionShort') + t(correctionOn ? 'voiceAutoEnhanceOn' : 'voiceAutoEnhanceOff'),
      title: t('voiceCorrectionTip'),
      onToggle: () => saveVoiceCfg({ correction: { enabled: !correctionOn } }),
    }),
    // CHG-117：「清口水词」——与另两开关**同款** ToggleChip（自述式「清口水词开/关」）
    React.createElement(ToggleChip, {
      on: fillerOn,
      onText: t('voiceRefineShort') + t(fillerOn ? 'voiceAutoEnhanceOn' : 'voiceAutoEnhanceOff'),
      title: t('voiceRefineFillerTip'),
      onToggle: () => saveVoiceCfg({ filler: { enabled: !fillerOn } }),
    }),
    // 2026-10-17（挤压根治）：热键子行允许**换行**（flexWrap）—— 空间不足时把按钮折到下一行，
    //   而不是把输入框压小（实测 EN 下曾从 273px 压到 108.3px）。
    // 2026-10-18（本批）：热键子行改成**可变宽的 flex 项**（flex:1 1 auto）—— 宽裕时吃掉本行剩余宽度，
    //   窄时由外层 flexWrap 整块折行（而不是被挤在一个 220px 的列里折成三行）。
    // 2026-10-18（R2）：本列的 flex-basis / minWidth 随两处改动下移（320 ⇒ 160）。
    //     两处改动后内容下限 = 15 + 8 + 96 + 8 + 22 = **149**（实测 148.56）⇒ 取 160 留字体回退余量。
    //   ⚠ 若仍写 320：三个 chip(112×3) + 2×12 gap + 320 = **692px** > 真机 row1 **534px** ⇒ 本列必然整体折行。
    React.createElement('div', { className: 'dsh-plg-row', style: { flex: '1 1 160px', minWidth: '160px', flexWrap: 'wrap' } },
      // 2026-10-18（R2 · 热键列收窄批 · 第 2 处）：label ⇒ **极短标记**（U+2328），原文案 t('voiceHotkeyCombo')
      //   **一字未改**，改由 title + aria-label 承载（位置迁移，文案值不变）⇒ 仍可发现「这格是热键」。
      //   病历：72px 的中文「热键」/ 约 45px 的英文「Hotkey」+ 输入框 120 + 清除 92 + 2×8 gap ⇒ 本列最小内容宽 300+，
      //   与三个 chip 同排需 692px，而真机 row1 只有 534px ⇒ 必然整列折行。
      //   ⚠ 必须同时给 minWidth:0：全局 .dsh-plg-label 带 min-width:120px，只改 width 会被它顶回去。
      React.createElement('label', { className: 'dsh-plg-label', style: { width: 'auto', minWidth: '0' }, title: t('voiceHotkeyCombo'), 'aria-label': t('voiceHotkeyCombo') }, '\u2328'),
      React.createElement('input', {
        type: 'text', className: 'dsh-plg-input', readOnly: true,
        // 2026-10-18（R2 · 第 2 处的一部分）：min-width 120 ⇒ **96**（含内边距的占位）。
        //   依据：96 - 24(padding) - 2(border) = **70px 内容宽** > 最短现实热键串实测 29.6px（2.4 倍余量）；
        //   更长的串由 title/aria-label 悬停看全（见下）。96 亦与本仓既有控件下限同源（.dsh-plg-select / 滑块）。
        style: { flex: '1 1 0', minWidth: '96px', boxSizing: 'border-box' },
        value: hotkeyCapture ? t('voiceHotkeyCapturing') : voiceHotkeyDisplay(v.hotkey.combo),
        placeholder: t('voiceHotkeyNone'),
        // 2026-10-18（R2）：完整热键串的**可读出口**——窄列下输入框可能只显示一截，
        //   title + aria-label 恒为完整串（含「热键：」前缀，前缀文案取自既有键 t('voiceHotkeyCombo')）。
        // \u26a0 录制期的 value 就是 t('voiceHotkeyCapturing')（较长），标题必须**跟随 value**，
        //   否则窄列被裁的那一截就没有任何可读出口。
        title: t('voiceHotkeyCombo') + '\uFF1A' + (hotkeyCapture ? t('voiceHotkeyCapturing') : (voiceHotkeyDisplay(v.hotkey.combo) || t('voiceHotkeyNone'))),
        'aria-label': t('voiceHotkeyCombo') + '\uFF1A' + (hotkeyCapture ? t('voiceHotkeyCapturing') : (voiceHotkeyDisplay(v.hotkey.combo) || t('voiceHotkeyNone'))),
        onFocus: startHotkeyCapture, onKeyDown: onHotkeyKeyDown, onBlur: cancelHotkeyCapture,
      }),
      // 2026-10-18（R2 · 热键列收窄批 · 第 1 处）：清除 ⇒ **图标按钮**（复用既有 .dsh-plg-btn-icononly，
      //   仓内先例 = fallback-row 的 上/下/叉 三个图标按钮）。⛔ 不得变成不可发现：title 与 aria-label 都保留 t('voiceHotkeyClear')。
      //   92px 文本按钮 ⇒ 22×22 图标按钮（.dsh-plg-btn-icononly 的 min-width:22 + padding:2px 4px）。
      React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', title: t('voiceHotkeyClear'), 'aria-label': t('voiceHotkeyClear'), onClick: clearHotkey }, '\u2715'),
    ),
  );

  // P2-补做（2026-10-13 · PROJECT §7.4）：静音判定时长可配（**0–5** 档，默认 2 秒）。
  // 2026-10-17（用户点名布局批）：**静音监测开关从第一行搬到本行**，并**覆盖掉**原「静音时长」
  //   标签与下拉框 ⇒ 本行 = 开关组件 + 滑块 + 读数（三件）。
  //   ⚠ 2026-10-17（残项收口批）：原下拉组件的注入形参已随之收敛（**注入面与源码事实对齐**，见该批报告 §④）。
  // ⚠⚠ **单一事实源（硬性）**：**开关真相仍只有 `vad.enabled` 一个** —— 滑块上的 `0` 只是「关闭」的
  //   **界面表示**，**不是第二个真相**；⛔ 不得用 `silenceMs === 0` 另立关闭语义（同族缺陷 M-2/M-3）。
  //   · 读取：滑块值 = `vadOn ? round(silenceMs / 1000) : 0`
  //   · 写 0：**只置 `enabled = false`**，`silenceMs` **保持原值** ⇒ 重开回到上次档位（不回落 2 秒）
  //   · 档位域不变：`silenceMs` **永远只取 1–5 秒**（`normalizeVadSilenceMs` 的域与「非法回落 2000」未改）
  const vadOn = !!(v.vad && v.vad.enabled !== false);
  const silenceSec = Math.round(vadSilenceMsOf(v) / 1000);
  // ⚠ 写入必须**带上当前 `silenceMs`**：`saveVoiceCfg` 的 `patch.vad` 会**整体替换** `vad` 对象
  //   ⇒ 只写 `{ vad: { enabled } }` 时 `mergeVoice` 会把 `silenceMs` 归一为默认 2000
  //   （**实测**：用户选 5 秒 ⇒ 关一下再开 ⇒ 变成 2 秒）。带原值即可保持档位。
  const silenceMsNow = vadSilenceMsOf(v);
  const sliderSec = vadOn ? silenceSec : 0;
  // **两条控件（开关 + 滑块）共用同一写入入口** ⇒ 「0 = 关闭」只有一处实现，不会分叉成两份真相。
  const setSilence = (next) => {
    const zero = Number(next) === 0;
    return saveVoiceCfg({ vad: { enabled: !zero, silenceMs: zero ? silenceMsNow : normalizeVadSilenceMs(Number(next)) } });
  };
  // 2026-10-18（本批）：静音行显式声明为**单行 flex**（开关 flex:none · 滑块 flex:1 1 auto · 读数 flex:none），
  //   三件在同一行内；滑块吃满剩余宽度，读数紧贴滑块右端（不出现大段空白）。
  const silenceRow = React.createElement('div', { className: 'dsh-plg-row dsh-vi-silence-row', style: { flexWrap: 'nowrap' } },
    // 静音监测（原「静音自动停」）：自述式切换按钮「静音监测开/关」——**从第一行搬来**
    React.createElement(ToggleChip, {
      on: vadOn,
      onText: t('voiceVadShort') + t(vadOn ? 'voiceAutoEnhanceOn' : 'voiceAutoEnhanceOff'),
      title: t('voiceVadEnabled'),
      onToggle: () => setSilence(vadOn ? 0 : silenceSec),
    }),
    // 滑块（自绘）：**0–5** 档；`0` = 静音监测关闭（界面表示，真相仍是 vad.enabled）
    React.createElement('input', {
      type: 'range', min: '0', max: '5', step: '1',
      className: 'dsh-vi-slider',
      'aria-label': t('voiceVadSilenceLabel'),
      value: String(sliderSec),
      onChange: (e) => { setSilence(e.target.value); },
    }),
    // 读数（2026-10-17 设置文案审查批 · 用户点名）：**关闭态不渲染任何读数文本**（留空）。
    //   ⚠ 用户原话「关闭的时候保持原样式」—— 关闭态该行要回到**未开读数的原样式**，
    //     而不是换一条更短的说明（换短文案属用户未要求的新增，本批不做）。
    //   ⚠ 1–5 档读数照旧（N + 单位）；⚠ 关闭 ⇒ 滑块归 0 的联动**未改动**（真相仍是 vad.enabled 单点）。
    //   ⚠ 「不得静默失效」不受影响：开关本身已显示「静音监测关」，且 diagnostic 段与 title 原始读数在位。
    React.createElement('span', { className: 'dsh-plg-muted' }, vadOn ? (silenceSec + ' ' + t('voiceVadSilenceUnit')) : ''),
  );

  const body = React.createElement('div', { className: 'dsh-vi-section' },
    row1,
    silenceRow,
    // P1-a：识别引擎/模型由官方管理 —— 此处只报就绪态（不再提供引擎/模型选择）
    React.createElement('div', { className: 'dsh-plg-row' },
      // 2026-10-17（§7.4 ①「状态复述」）：**正常态不再复述**。
      //   · 「（N provider）」= 内部术语 + 计数复述 ⇒ 正常态不报；原始计数留在 title 里。
      //   · 「✓ 清口水词」= 复述开关本身的状态（开关就在上面一行）⇒ 正常态不报。
      //   ⚠⚠ **未就绪仍是异常**，照旧报（不得因精简把不可用说成正常）。
      React.createElement('span', { className: 'dsh-plg-status',
        title: speechReady ? ('providers=' + speechProviders.length + ' | fillerConfigured=' + !!(status && status.filler && status.filler.configured)) : '' },
        speechReady ? '\u2713 ' + t('voiceStatusReady') : '\u2717 ' + t('voiceStatusNotReady')),
    ),
    // P2-补做（2026-10-13）：官方路径增值对齐的可观测态（不得静默失效）
    React.createElement(OfficialVoiceDiag, props),
    // CHG-117（规整改造批）：原「三选下拉 + 模型行 + 地址/模型/密钥三行」**整体移除**
    //   （用户裁定：改为与另两开关同款 ToggleChip；清口水词为**纯本地规则**，无模型/无凭据）。
    //   ⚠ 取而代之的是**可见性**读数（承 `CHG-115` `I-2`「不得静默失效」）：
    //     清理发生了几次 / 是否被跳过 / 旧版配置是否已清理 —— 用户**看得出**。
    React.createElement(FillerDiag, props),
    // CHG-143：语音纠错的可见性读数（不得静默失效）
    React.createElement(CorrectionDiag, props),
    // UD-0055 / UD-0057：学习词典（自动入库 + 可编辑）
    React.createElement(DictionaryEditor, props),
  );
  return React.createElement(CollapsibleSection, { title: t('voiceSectionTitle') }, body);
}


  return { ovbSinceLabel, OfficialVoiceDiag, FillerDiag, CorrectionDiag, VoiceSection };
}

module.exports = { createVoiceSection };
