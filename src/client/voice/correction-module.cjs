'use strict';

// 语音纠错状态普通模块（构建期由客户端运行时内联）。
// 相位核心仍由 correction-state-module.cjs 提供；本模块只保留既有状态机与展示映射。
function createCorrectionState(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const voiceCfgState = d.voiceCfgState;
  const __DSH_CORRECTION_STATE__ = d.correctionStateCore;
// ============================================================================
// CHG-184（纠错状态可视化批 · 2026-10-18）：语音纠错的**五态可见性**（输入框旁）。
//
// 归属：仍属**语音增值模块**（与 filler / vad / hotkey / autoEnhance 同类），
//   **不是**增强管线的一部分 —— 本文件只把 CHG-143 已有的读数（runs/skipped/ok/
//   changed/failed/lastCode）**收敛成一个可判的状态机**，⛔ 不改任何纠错判据 / 触发时机。
//
// 为什么需要（用户逐字报障）：「语音识别后的纠错功能需要有明确状态……这个状态信息用
//   输入框的提示词增强的按钮样式展示（就是和正在优化这样的状态显示）」。
//   病历：改前这些读数**只在设置页诊断区**可见（语音设置模块的 CorrectionDiag）——
//   而纠错发生在**识别完成之后**，那一刻用户正看着输入框 ⇒ 设置页那行他看不到。
//
// ⚠⚠ 五态**必须可判**（⛔ 不得合并）—— 尤其这两态在改前**同形**：
//     · 「没跑·因开关」（skipped + code=CORRECTION_DISABLED）
//     · 「跑了·没改动」（changed=false）
//   改前两者都只体现为「计数没涨」⇒ 这正是「看起来没生效」的来源。
//
// ⚠ 位置纪律（承 §7.7 / CHG-173 返回值语义 / SW-1 先例）：
//   ① **失败态优先于一切正常态**（真实故障不得被「已完成·无改动」掩蔽）；
//   ② **跳过态（开关关）与运行态分开**，且**未执行**不得渲染成「已完成」；
//   ③ idle（压根没触发）与 skipped（触发了但开关关）**必须是两个态**。
//
// 形态：照抄既有可见性模式（单一事实源 + 订阅 + snapshot），不新造机制。
// ============================================================================

// 五态常量（渲染层与测试共用同一份取值，不各写一遍字符串）
// 目标模式：相位常量由普通模块提供（构建期注入），取值逐项不变。
var CORRECTION_PHASES = __DSH_CORRECTION_STATE__.CORRECTION_PHASES;

var correctionState = {
  runs: 0,
  skipped: 0,
  ok: 0,
  changed: 0,
  failed: 0,
  lastAt: 0,
  lastCode: '',
  lastSkipReason: '',
  // ── CHG-184 新增读数（只增字段，不改既有字段语义）─────────────────────────
  // 进行中标记：请求在途期间为 true（= 用户此刻应当看到「正在纠错」）
  inFlight: false,
  // 本轮（最近一次 settle）的相位真值。⚠ 它**不是**由计数反推的：
  //   counts 是页面生命期累计，而相位描述的是「刚刚这一次」。
  phase: 'idle',
  // 最近一次失败码（与 lastCode 同源，但只在 failed 相位下有意义）
  lastFailCode: '',
  // 最近一次「跳过」的判定来源（disabled = 客户端开关关未发请求；server = 服务端守卫判关）
  lastSkipSource: '',
  // 累计「已判过」的次数（changed + unchanged）—— 无改动时把「检查过几次」说清
  checked: 0,
  // ── 会话归属批（2026-10-19）────────────────────────────────────────────────
  // 相位是**「刚刚这一次执行」的事实** ⇒ 它属于**发起它的那个会话**。
  //   病历（用户报障）：「现在新建或者切换到其他会话会显示纠错失败」。根因 = 本状态机是
  //   **页面级单例**且**没有会话维度**，而 ✨ 按钮的失败闪现只看全局 phase ⇒
  //   A 会话失败后相位一直停在 failed，切到 B / 新建会话时按钮**照样**闪「纠错失败」。
  //   ⚠ 只加**归属**，不改任何纠错判据 / 触发时机（⛔ 不改 runCorrection 与开关语义）。
  //   ⚠ '' = 归属未知（旧调用点 / 单测夹具）⇒ 不套用归属闸（保守：宁可显示，也不静默真故障）。
  ownerSessionId: '',
  // ── 已消费语义批（2026-10-20）────────────────────────────────────────────────
  // 病历：归属闸只保证「不是我的会话不显示」，但相位**没有「已消费」语义** ⇒
  //   同一场失败在**每一次**该会话的按钮重渲/切回时都会再闪 4 秒（用户看到的「反复闪」）。
  //
  // 形态：**单调递增的场次号 + 高水位已消费号**（而不是布尔「提醒过没有」，也不是「本页只提醒一次」）。
  //   · failureSeq     —— 第几场失败（**只在失败结算时 +1**，时间戳不参与判等）
  //   · consumedSeq    —— 已被「闪现」消费到第几场（高水位）
  //   ⇒ 「同一场只闪一次」= `failureSeq <= consumedSeq`；
  //   ⇒ 「新的一场仍照常闪」= 下一场失败把 failureSeq 推到 consumedSeq 之上。
  //
  // ⚠ 为什么**不会把两场不同的失败混成一场**（作业书 §2 要求的边界说明）：
  //   ① 判据是**计数**不是时间戳：`lastAt` 会在 running→settle 的每次 mark* 上刷新，
  //      用它会「同一场失败因为刷新时刻不同被当成两场」（反向错）；
  //   ② failureSeq 严格单调 +1，两场失败必得两个不同号；消费是高水位（只前进不后退），
  //      所以第 N 场消费后，第 N+1 场必然 > 高水位 ⇒ 必闪；
  //   ③ 消费**只在展示时**发生，且只把高水位推到**当前这一场**，不会连带吞掉未来场次。
  failureSeq: 0,
  consumedSeq: 0,
};

const correctionListeners = new Set();

function notifyCorrection() {
  for (var fn of Array.from(correctionListeners)) { try { fn(); } catch (e) { /* 单个订阅者失败不影响其余 */ } }
}

function subscribeCorrection(fn) {
  correctionListeners.add(fn);
  return function () { correctionListeners.delete(fn); };
}

/** 开关关闭 ⇒ 记为**跳过**（可见），不静默（与 filler 的 disabled 分支同款语义）。 */
function markCorrectionSkipped(reason, sessionId) {
  correctionState.ownerSessionId = typeof sessionId === 'string' ? sessionId : correctionState.ownerSessionId;
  correctionState.skipped += 1;
  correctionState.lastSkipReason = reason || 'disabled';
  correctionState.lastSkipSource = (reason === 'server') ? 'server' : 'disabled';
  correctionState.lastAt = Date.now();
  // ⚠ 相位 = skipped（**不是** idle）：这次确实做了「判定」这个动作，只是结果是不跑。
  //   与 idle 的区别正是用户最需要的那条信息 ——「开关关着」vs「压根没触发」。
  correctionState.phase = CORRECTION_PHASES.SKIPPED;
  correctionState.inFlight = false;
  notifyCorrection();
}

/** 请求发出（进行中）⇒ 相位 = running。⚠ 只置相位，不动任何计数（计数在 settle 时记）。 */
function markCorrectionStarted(sessionId) {
  correctionState.ownerSessionId = typeof sessionId === 'string' ? sessionId : correctionState.ownerSessionId;
  correctionState.inFlight = true;
  correctionState.phase = CORRECTION_PHASES.RUNNING;
  correctionState.lastAt = Date.now();
  notifyCorrection();
}

/**
 * 请求 settle ⇒ 结算相位。**唯一**决定 phase 的地方（⛔ 渲染层不得自行反推）。
 * @param {object|null} res 服务端响应（形状见 host runCorrection 的返回值）
 * @param {string} before 发出请求时的草稿（用于判定 changed —— 服务端返回值不可全信：
 *   server 侧 changed 只在成功分支给出；网络层失败时根本没有它）
 */
function markCorrectionSettled(res, before, sessionId) {
  var r = (res && typeof res === 'object') ? res : {};
  correctionState.ownerSessionId = typeof sessionId === 'string' ? sessionId : correctionState.ownerSessionId;
  correctionState.inFlight = false;
  correctionState.lastAt = Date.now();
  // ⚠ 服务端守卫判关（CORRECTION_DISABLED）⇒ 这属于**跳过**，不属于运行。
  //   为什么单独记来源：客户端开关开着、服务端读盘判关时，
  //   若显示「已完成·无改动」就是**假读数**（实际一次模型调用都没发生）。
  if (r.skipped === true && String(r.code || '') === 'CORRECTION_DISABLED') {
    correctionState.skipped += 1;
    correctionState.lastSkipReason = 'disabled';
    correctionState.lastSkipSource = 'server';
    correctionState.phase = CORRECTION_PHASES.SKIPPED;
    notifyCorrection();
    return correctionState.phase;
  }
  correctionState.runs += 1;
  if (r.ok === true && typeof r.text === 'string' && r.text.trim() !== '') {
    correctionState.ok += 1;
    correctionState.checked += 1;
    var changed = typeof before === 'string' ? (r.text !== before) : (r.changed === true);
    if (changed) {
      correctionState.changed += 1;
      correctionState.phase = CORRECTION_PHASES.CHANGED;
    } else {
      correctionState.phase = CORRECTION_PHASES.UNCHANGED;
    }
    correctionState.lastCode = '';
    correctionState.lastFailCode = '';
  } else {
    correctionState.failed += 1;
    // 已消费语义批：**这一场**失败有了自己的场次号（新的一场失败 ⇒ 号必前进 ⇒ 必闪一次）
    correctionState.failureSeq += 1;
    correctionState.lastCode = String(r.code || 'UNKNOWN');
    correctionState.lastFailCode = correctionState.lastCode;
    correctionState.phase = CORRECTION_PHASES.FAILED;
  }
  notifyCorrection();
  return correctionState.phase;
}

/** 网络层失败（catch 分支）⇒ 相位 = failed（不得静默） */
function markCorrectionFailed(code, sessionId) {
  correctionState.ownerSessionId = typeof sessionId === 'string' ? sessionId : correctionState.ownerSessionId;
  correctionState.inFlight = false;
  correctionState.runs += 1;
  correctionState.failed += 1;
  correctionState.failureSeq += 1;   // 网络层失败同样是一场**新**的失败（见状态机字段注释）
  correctionState.lastAt = Date.now();
  correctionState.lastCode = String(code || 'NETWORK');
  correctionState.lastFailCode = correctionState.lastCode;
  correctionState.phase = CORRECTION_PHASES.FAILED;
  notifyCorrection();
}

/**
 * ⭐ 相位推导的**单一事实源**（纯函数：入参 = snapshot，出参 = 渲染用的相位）。
 *
 * ⚠ 位置纪律在此函数里落地（顺序即优先级）：
 *   ① failed —— 真实故障优先于任何正常态（承 §7.7）
 *   ② running —— 在途（用户此刻应看到「正在纠错」）
 *   ③ skipped —— 开关关，没跑（**与 unchanged 分开**）
 *   ④ changed / unchanged —— 跑了，结果不同/相同
 *   ⑤ idle —— 压根没触发
 *
 * ⚠ 为什么 failed 排第一而**不是**排在「开关关闭态」之后：承 SW-1 实测事故 ——
 *   开关态排在故障分支之前会让真实故障被永久掩蔽（用户会以为是自己设置导致）。
 */
function correctionPhaseOf(snap, sessionId) {
  return __DSH_CORRECTION_STATE__.correctionPhaseOf(snap, sessionId);
}

/** 相位是否属于已知取值（由普通模块提供，未知取值一律退化为 idle）。 */
function correctionPhaseKnown(p) {
  return __DSH_CORRECTION_STATE__.correctionPhaseKnown(p);
}

/**
 * ⭐ 相位 → 展示键（i18n key）与样式类。**唯一定义处**（渲染层只查表，不写分支）。
 *
 * 返回 { phase, key, cls, ariaLive, spinner }：
 *   · key      —— i18n 键（不带计数的**基础文案**；计数由调用方按需追加）
 *   · cls      —— 样式类（复用「✨ 增强」那一族的既有类，⛔ 不新造一套）
 *   · ariaLive —— polite / assertive（失败态用 assertive：屏幕阅读器立即播报）
 *   · spinner  —— 是否挂 dsh-enh-spin 转圈（与「正在优化」同一个 spinner）
 *
 * ⚠ 样式类复用依据（改前已只读勘察，见报告 §③）：
 *   · running   → dsh-enh-btn-busy dsh-enh-btn-text（=「正在优化」同一个类，含状态色 + 淡背景）
 *   · changed   → dsh-enh-btn-result dsh-enh-btn-text（= ✨「已完成」同一个类）
 *   · unchanged → dsh-enh-btn-text（= ✨ 空闲态；⚠ 中性色，因为**这不是成功也不是失败**）
 *   · skipped   → dsh-enh-btn-text dsh-plg-upd-outdated（既有「关闭/未启用」警示色，全仓已在用）
 *   · failed    → dsh-enh-btn-text dsh-vi-err（既有错误态色，与 🎤 错误态同族）
 *   ⛔ 未新增任何 CSS 类 ⇒ 不改 styles.js（与 UI 回退批零文件重叠）。
 */
function correctionPhaseView(phase) {
  var p = phase;
  if (p === CORRECTION_PHASES.RUNNING) {
    return { phase: p, key: 'voiceCorrectionStateRunning', cls: 'dsh-enh-btn-busy dsh-enh-btn-text', ariaLive: 'polite', spinner: true };
  }
  if (p === CORRECTION_PHASES.CHANGED) {
    return { phase: p, key: 'voiceCorrectionStateChanged', cls: 'dsh-enh-btn-result dsh-enh-btn-text', ariaLive: 'polite', spinner: false };
  }
  if (p === CORRECTION_PHASES.UNCHANGED) {
    return { phase: p, key: 'voiceCorrectionStateUnchanged', cls: 'dsh-enh-btn-text', ariaLive: 'polite', spinner: false };
  }
  if (p === CORRECTION_PHASES.SKIPPED) {
    return { phase: p, key: 'voiceCorrectionStateSkipped', cls: 'dsh-enh-btn-text dsh-plg-upd-outdated', ariaLive: 'polite', spinner: false };
  }
  if (p === CORRECTION_PHASES.FAILED) {
    return { phase: p, key: 'voiceCorrectionStateFailed', cls: 'dsh-enh-btn-text dsh-vi-err', ariaLive: 'assertive', spinner: false };
  }
  return { phase: CORRECTION_PHASES.IDLE, key: 'voiceCorrectionStateIdle', cls: 'dsh-enh-btn-text', ariaLive: 'polite', spinner: false };
}

function correctionSnapshot() {
  return {
    runs: correctionState.runs,
    skipped: correctionState.skipped,
    ok: correctionState.ok,
    changed: correctionState.changed,
    failed: correctionState.failed,
    lastAt: correctionState.lastAt,
    lastCode: correctionState.lastCode,
    lastSkipReason: correctionState.lastSkipReason,
    // CHG-184：五态读数（渲染层据此决定显示什么；⛔ 不再由 counts 反推）
    inFlight: correctionState.inFlight,
    phase: correctionPhaseOf(correctionState),
    checked: correctionState.checked,
    lastFailCode: correctionState.lastFailCode,
    lastSkipSource: correctionState.lastSkipSource,
    // 会话归属批：本次相位属于哪个会话（'' = 未知）——渲染层只**读**它（判定在
    //   correctionPhaseOf 内，⛔ 不在渲染层另写一份）。
    ownerSessionId: correctionState.ownerSessionId,
    // 已消费语义批：场次号与高水位（渲染层**只读**；判定在 correctionFailureTicket 内）
    failureSeq: correctionState.failureSeq,
    consumedSeq: correctionState.consumedSeq,
    enabled: (function () {
      try {
        var c = (typeof voiceCfgState !== 'undefined' && voiceCfgState) ? voiceCfgState.value.correction : null;
        return !!(c && c.enabled === true);
      } catch (e) { return false; }
    })(),
  };
}

/**
 * ⭐ 「这一场失败还没有被闪现过吗」——**唯一判定处**（渲染层只调它，⛔ 不自己写「我提醒过没有」）。
 *
 * 归还的是**不透明 token**（= 场次号的字符串形态）：渲染层把它原样交回
 * {@link consumeCorrectionFailure} 即可，⛔ 不需要、也不应该理解它的数值含义。
 *
 * 返回 ''（空串）表示**此刻不该闪**，三种成因（对调用方同形，但都可从 snapshot 另行读出）：
 *   ① 相位不是 failed（最近一次是成功/跳过/在途）；
 *   ② 这一场不属于本会话（归属闸，与 correctionPhaseOf 同一份判定）；
 *   ③ 这一场已经被闪过了（`failureSeq <= consumedSeq`）。
 *
 * ⚠ 判定**复用** correctionPhaseOf（含归属闸）⇒ 归属规则只有一份，⛔ 不在本函数另写一遍。
 * @param {object} snap correctionSnapshot() 的返回值
 * @param {string} sessionId 观察者会话（缺省 ⇒ 不套用归属闸，与 correctionPhaseOf 同语义）
 * @returns {string} token；'' = 不闪
 */
function correctionFailureTicket(snap, sessionId) {
  return __DSH_CORRECTION_STATE__.correctionFailureTicket(snap, sessionId);
}
/**
 * 消费一场失败（把高水位推到**该 token 那一场**）。**只在展示时**由渲染层调用。
 *
 * @param {string} token correctionFailureTicket 给出的不透明 token
 * @returns {boolean} 是否真的消费了（false = token 无效 / 已过期 / 非当前场次 ⇒ 幂等，不改状态）
 */
function consumeCorrectionFailure(token) {
  var seq = __DSH_CORRECTION_STATE__.correctionFailureConsume(token, correctionState.failureSeq, correctionState.consumedSeq);
  if (seq === null) return false;
  correctionState.consumedSeq = seq;
  notifyCorrection();
  return true;
}


  return {
    CORRECTION_PHASES, correctionState, notifyCorrection, subscribeCorrection,
    markCorrectionSkipped, markCorrectionStarted, markCorrectionSettled, markCorrectionFailed,
    correctionPhaseOf, correctionPhaseKnown, correctionPhaseView, correctionSnapshot,
    correctionFailureTicket, consumeCorrectionFailure,
  };
}

module.exports = { createCorrectionState };
