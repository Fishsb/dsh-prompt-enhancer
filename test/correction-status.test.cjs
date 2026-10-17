'use strict';
// ============================================================================
// CHG-184（纠错状态可视化批 · 2026-10-18）：**五态**逐态判据（⭐ 本批主讲）
// ============================================================================
// 用户逐字：「语音识别后的纠错功能需要有明确状态……这个状态信息用输入框的提示词增强的
//   按钮样式展示（就是和正在优化这样的状态显示）」。
//
// ⚠ 本文件判的是**逐态可判**（⛔ 不是「代码里有这个分支」）：
//   ① 未执行（idle）② 未执行·因开关关（skipped）③ 进行中（running）
//   ④ 已完成·有改动（changed）⑤ 已完成·无改动（unchanged）⑥ 失败（failed）
//   每态都给「相位读数 + 展示键 + 样式类」三项，并**成对做负控**（邻态不得同形）。
//
// ⚠ 判据面（三层，缺一层就是假绿）：
//   1. 行为层：真实求值 correction.js chunk，**驱动** markCorrection* 三件，读 snapshot.phase
//   2. 映射层：correctionPhaseView / correctionPhaseOf 的**优先级**（失败必须优先于正常态）
//   3. 接线层：hotkey.js 调度口**确实**调用 markCorrection*（不是只定义了没人用）
// ============================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');

/** 求值 correction.js chunk，注入一个可控的 voiceCfgState（开关真值）。 */
function loadCorrection(opts) {
  const o = opts || {};
  const src = decodeChunk('src/client/voice/correction.js');
  const voiceCfgState = { value: { correction: { enabled: o.enabled === true } } };
  const factory = new Function(
    'voiceCfgState',
    src + '\n;return { correctionState, correctionSnapshot, subscribeCorrection, notifyCorrection,'
    + ' markCorrectionSkipped, markCorrectionStarted, markCorrectionSettled, markCorrectionFailed,'
    + ' correctionPhaseOf, correctionPhaseView, correctionPhaseKnown, CORRECTION_PHASES };'
  );
  return factory(voiceCfgState);
}

// ───────────────────────── ① 未执行（idle） ─────────────────────────
test('CHG184-S1 态①「未执行」：从未触发 ⇒ phase=idle、展示键 = StateIdle、样式 = ✨ 空闲族', () => {
  const c = loadCorrection({ enabled: true });
  const snap = c.correctionSnapshot();
  assert.equal(snap.phase, 'idle', '从未触发 ⇒ phase 必须是 idle');
  assert.equal(snap.inFlight, false);
  assert.equal(snap.runs, 0, '未执行 ⇒ runs 必须为 0（没发过请求）');
  const view = c.correctionPhaseView(c.correctionPhaseOf(snap));
  assert.equal(view.phase, 'idle');
  assert.equal(view.key, 'voiceCorrectionStateIdle', '展示键必须是 idle 专键');
  assert.equal(view.cls, 'dsh-enh-btn-text', '样式 = ✨ 空闲族（同类复用，⛔ 不新造）');
  assert.equal(view.spinner, false, '空闲态不得转圈');
});

test('CHG184-S2 负控：idle 与 skipped **不同形**（⛔ 不得合并）', () => {
  const idle = loadCorrection({ enabled: false });
  const idleSnap = idle.correctionSnapshot();
  const idleView = idle.correctionPhaseView(idleSnap.phase);
  const skip = loadCorrection({ enabled: false });
  skip.markCorrectionSkipped('disabled');
  const skipSnap = skip.correctionSnapshot();
  const skipView = skip.correctionPhaseView(skipSnap.phase);
  assert.equal(idleSnap.phase, 'idle');
  assert.equal(skipSnap.phase, 'skipped');
  assert.notEqual(idleView.key, skipView.key, '两态展示键必须不同（否则用户看不出「开关关着」）');
  assert.notEqual(idleView.cls, skipView.cls, '两态样式类必须不同（idle 中性 / skipped 警示）');
  assert.equal(skipSnap.skipped, 1, '跳过计数必须真的+1（开关真的约束了行为的证据）');
});

// ───────────────────── ② 未执行·因开关关（skipped） ─────────────────────
test('CHG184-S3 态②「未执行·因开关关」：client 侧跳过 ⇒ phase=skipped、来源 = disabled', () => {
  const c = loadCorrection({ enabled: false });
  c.markCorrectionSkipped('disabled');
  const snap = c.correctionSnapshot();
  assert.equal(snap.phase, 'skipped');
  assert.equal(snap.skipped, 1);
  assert.equal(snap.lastSkipSource, 'disabled', '必须写明是**哪一侧**判的关');
  assert.equal(snap.runs, 0, '跳过 ⇒ 一次请求都没发（runs 必须仍为 0）');
  const view = c.correctionPhaseView(snap.phase);
  assert.equal(view.key, 'voiceCorrectionStateSkipped');
  assert.ok(view.cls.includes('dsh-plg-upd-outdated'), '跳过态用既有警示色族（不新造类）');
});

test('CHG184-S4 ⭐ 服务端守卫判关（CORRECTION_DISABLED）⇒ 归 skipped，⛔ 不得记成「已完成·无改动」', () => {
  const c = loadCorrection({ enabled: true });   // 客户端开关**开着**
  c.markCorrectionStarted();
  const phase = c.markCorrectionSettled({ ok: true, skipped: true, code: 'CORRECTION_DISABLED', text: 'abc' }, 'abc');
  assert.equal(phase, 'skipped', '服务端判关 ⇒ 相位必须是 skipped（不是 unchanged）');
  const snap = c.correctionSnapshot();
  assert.equal(snap.skipped, 1);
  assert.equal(snap.lastSkipSource, 'server', '来源必须是 server（客户端开着、服务端判关是可排查的关键事实）');
  assert.equal(snap.checked, 0, '⛔ 没跑过模型就不得计入「已判过」（否则「检查过 N 次」是假读数）');
  assert.equal(snap.changed, 0);
  assert.equal(snap.runs, 0, '⛔ 服务端判关不算 run（一次模型调用都没发生）');
});

// ───────────────────────── ③ 进行中（running） ─────────────────────────
test('CHG184-S5 态③「进行中」：markCorrectionStarted ⇒ phase=running、inFlight=1、转圈', () => {
  const c = loadCorrection({ enabled: true });
  c.markCorrectionStarted();
  const snap = c.correctionSnapshot();
  assert.equal(snap.phase, 'running', '请求在途 ⇒ phase 必须是 running');
  assert.equal(snap.inFlight, true, 'inFlight 必须为 true（这是「在途」的唯一真值）');
  const view = c.correctionPhaseView(c.correctionPhaseOf(snap));
  assert.equal(view.key, 'voiceCorrectionStateRunning');
  assert.equal(view.spinner, true, '进行中必须挂 spinner（与「正在优化」同一个 dsh-enh-spin）');
  assert.ok(view.cls.includes('dsh-enh-btn-busy'), '进行中用 ✨「正在优化」同一个 busy 类');
  assert.equal(snap.runs, 0, '起手不记 runs（计数在 settle 时记 —— ⛔ 不得一处增两处算）');
});

test('CHG184-S6 ⭐ running 优先于既有 phase：settle 之前即便上一次是 failed 也显示 running', () => {
  const c = loadCorrection({ enabled: true });
  c.markCorrectionFailed('NETWORK');
  assert.equal(c.correctionSnapshot().phase, 'failed');
  c.markCorrectionStarted();
  // 第二次请求在途 ⇒ 用户此刻应当看到「正在纠错」，而不是上一轮的失败
  assert.equal(c.correctionSnapshot().phase, 'running', '在途优先于历史失败（否则新一轮跑起来用户看不到）');
});

// ───────────────────── ④ 已完成·有改动（changed） ─────────────────────
test('CHG184-S7 态④「已完成·有改动」：文本变了 ⇒ phase=changed、counters 三项同步', () => {
  const c = loadCorrection({ enabled: true });
  c.markCorrectionStarted();
  const phase = c.markCorrectionSettled({ ok: true, text: '纠正后的文字' }, '识别出来的文字');
  assert.equal(phase, 'changed');
  const snap = c.correctionSnapshot();
  assert.equal(snap.changed, 1);
  assert.equal(snap.ok, 1);
  assert.equal(snap.checked, 1);
  assert.equal(snap.runs, 1);
  const view = c.correctionPhaseView(snap.phase);
  assert.equal(view.key, 'voiceCorrectionStateChanged');
  assert.ok(view.cls.includes('dsh-enh-btn-result'), '有改动用 ✨「已完成」同一个 result 类');
});

test('CHG184-S8 ⭐ changed 判据以**草稿差分**为准（server 的 changed 字段不作唯一依据）', () => {
  const c = loadCorrection({ enabled: true });
  // 服务端说 changed:true，但返回文本与原文逐字相同 ⇒ 按差分判，仍是 unchanged
  c.markCorrectionSettled({ ok: true, text: '一样的话', changed: true }, '一样的话');
  assert.equal(c.correctionSnapshot().phase, 'unchanged',
    '草稿没变就是无改动（⛔ 不得只信 server 的布尔 —— 它与用户看到的东西可能不一致）');
});

// ─────────────────── ⑤ 已完成·无改动（unchanged）⭐ 本批核心 ───────────────────
test('CHG184-S9 态⑤「已完成·无改动」：跑了但没改 ⇒ phase=unchanged、**与 skipped 不同形**', () => {
  const c = loadCorrection({ enabled: true });
  c.markCorrectionStarted();
  const phase = c.markCorrectionSettled({ ok: true, text: '原样返回的文本' }, '原样返回的文本');
  assert.equal(phase, 'unchanged', '护栏判「不该改」⇒ 这是 unchanged，⛔ 不是 idle、⛔ 不是 skipped');
  const snap = c.correctionSnapshot();
  assert.equal(snap.checked, 1, '「检查过 N 次」必须可读（这是最常见的「看起来没生效」）');
  assert.equal(snap.runs, 1);
  assert.equal(snap.changed, 0);
  assert.equal(snap.skipped, 0, '⛔ 不得混入跳过计数');
  const view = c.correctionPhaseView(snap.phase);
  assert.equal(view.key, 'voiceCorrectionStateUnchanged');
  assert.equal(view.cls, 'dsh-enh-btn-text', '无改动用中性色（⛔ 不得用成功绿/失败红 —— 它不是任何一种）');
  // 与 skipped 的负控：两者 cls 与 key 都必须不同
  const skipView = c.correctionPhaseView('skipped');
  assert.notEqual(view.key, skipView.key, '⭐ unchanged 与 skipped 的文案必须不同');
  assert.notEqual(view.cls, skipView.cls, '⭐ unchanged 与 skipped 的样式必须不同');
});

// ───────────────────────── ⑥ 失败（failed） ─────────────────────────
test('CHG184-S10 态⑥「失败」：!ok ⇒ phase=failed、失败码可见、assertive', () => {
  const c = loadCorrection({ enabled: true });
  c.markCorrectionStarted();
  const phase = c.markCorrectionSettled({ ok: false, code: 'NO_MODEL' }, 'abc');
  assert.equal(phase, 'failed');
  const snap = c.correctionSnapshot();
  assert.equal(snap.failed, 1);
  assert.equal(snap.lastFailCode, 'NO_MODEL', '失败码必须可读（不得只给一个「失败」）');
  assert.equal(snap.lastCode, 'NO_MODEL');
  const view = c.correctionPhaseView(snap.phase);
  assert.equal(view.key, 'voiceCorrectionStateFailed');
  assert.equal(view.ariaLive, 'assertive', '失败态必须 assertive（屏幕阅读器立即播报）');
  assert.ok(view.cls.includes('dsh-vi-err'), '失败用既有错误态色族');
});

test('CHG184-S11 网络层失败（catch）⇒ phase=failed、码 = NETWORK、不得静默', () => {
  const c = loadCorrection({ enabled: true });
  c.markCorrectionStarted();
  c.markCorrectionFailed('NETWORK');
  const snap = c.correctionSnapshot();
  assert.equal(snap.phase, 'failed');
  assert.equal(snap.lastFailCode, 'NETWORK');
  assert.equal(snap.failed, 1);
  assert.equal(snap.runs, 1, '网络层失败也算一次真实发起（与 skipped 可区分）');
});

// ─────────────── 位置纪律：失败态**优先于**一切正常态（§7.7） ───────────────
test('CHG184-S12 ⭐⭐ 位置纪律：failed 相位在任何推导路径下都排第一（不得被正常态掩蔽）', () => {
  const c = loadCorrection({ enabled: true });
  // 构造「失败 + 同时具备正常态特征」的脏快照：changed/checked 都 > 0
  c.markCorrectionSettled({ ok: true, text: '改过了' }, '原来的');
  assert.equal(c.correctionSnapshot().phase, 'changed');
  c.markCorrectionFailed('TIMEOUT');
  const snap = c.correctionSnapshot();
  assert.equal(snap.phase, 'failed', '失败必须压倒历史成功');
  // 直判纯函数：即便入参里同时带 inFlight 与 changed，failed 也必须胜出
  assert.equal(c.correctionPhaseOf({ phase: 'failed', inFlight: true }), 'failed',
    '⭐ failed 优先于 running（真实故障不得被「正在纠错」盖住）');
  assert.equal(c.correctionPhaseOf({ phase: 'failed', changed: 9, checked: 9 }), 'failed');
  // 负控：非失败时才轮到 running
  assert.equal(c.correctionPhaseOf({ phase: 'changed', inFlight: true }), 'running',
    'running 次优先（在途时必须显示在途，否则用户看不到这一轮在跑）');
  // 未知取值 fail-closed 到 idle（⛔ 不猜成「已完成」）
  assert.equal(c.correctionPhaseOf({ phase: 'wat' }), 'idle', '未知相位退化为 idle，不得猜成已完成');
  assert.equal(c.correctionPhaseOf(null), 'idle');
});

// ───────────────────── 接线层：调度口真的在用状态机 ─────────────────────
test('CHG184-S13 ⭐ 接线：hotkey 调度口调用 markCorrectionStarted / Settled / Failed（不是只定义没人用）', () => {
  const hotkey = decodeChunk('src/client/voice/hotkey.js');
  assert.ok(hotkey.includes('markCorrectionStarted()'), '起手必须记 running');
  assert.ok(/markCorrectionSettled\(r, cur\)/.test(hotkey), 'settle 必须把**发起前的草稿**传进去（changed 差分判据）');
  assert.ok(hotkey.includes("markCorrectionFailed('NETWORK')"), 'catch 分支必须记失败（不得静默）');
  assert.ok(hotkey.includes('markCorrectionSkipped'), '跳过分支必须仍在（开关约束可见）');
  // 负控：调度口**不得**再自己增减计数（那会形成第二个真值）
  assert.ok(!/corrState\.runs \+= 1/.test(hotkey), '⛔ 调度口不得自行累加 runs（单一事实源在 correction.js）');
  assert.ok(!/corrState\.changed \+= 1/.test(hotkey), '⛔ 调度口不得自行累加 changed');
  assert.ok(!/corrState\.failed \+= 1/.test(hotkey), '⛔ 调度口不得自行累加 failed');
});

test('CHG184-S14 ⭐ 接线：状态组件注册在**输入框旁同一槽位**（与 ✨ 同族位置），且只读', () => {
  const app = decodeChunk('src/client/app.js');
  assert.ok(/id: 'correction-status'/.test(app), '状态组件必须注册（否则组件存在但没人挂）');
  const idxStatus = app.indexOf("id: 'correction-status'");
  const idxEnh = app.indexOf("id: 'prompt-enhance'");
  assert.ok(idxEnh >= 0 && idxStatus > idxEnh, '必须注册在 ✨ 之后（同族位置）');
  assert.ok(app.includes("conversation.input.right"), '必须是输入框右槽位');
  const comp = decodeChunk('src/client/voice/correction-status.js');
  // 只读契约：组件内不得发起任何 RPC（⛔ 状态展示不得变成第二个调用点）
  assert.ok(!/host\.call\(/.test(comp), '⚠ 状态组件必须只读：不得调用 host.call');
  // 样式族复用：必须用 ✨ 那一族的既有类（⛔ 不得新造一套）
  assert.ok(comp.includes('dsh-enh-btn'), '必须复用 ✨ 按钮族的容器类');
  const styles = decodeChunk('src/client/styles.js');
  for (const cls of ['dsh-enh-btn-busy', 'dsh-enh-btn-result', 'dsh-enh-spin', 'dsh-vi-err', 'dsh-plg-upd-outdated']) {
    assert.ok(styles.includes('.' + cls), '复用的类必须在 styles.js 里实存（否则是空类名）: ' + cls);
  }
});

test('CHG184-S15 i18n：五态键 ZH/EN 双侧齐全且逐键同形（S-7）', () => {
  const i18n = decodeChunk('src/client/i18n.js');
  const keys = ['voiceCorrectionStateIdle', 'voiceCorrectionStateIdleOff', 'voiceCorrectionStateRunning',
    'voiceCorrectionStateChanged', 'voiceCorrectionStateUnchanged', 'voiceCorrectionStateSkipped',
    'voiceCorrectionStateFailed', 'voiceCorrectionStateAriaLabel'];
  for (const k of keys) {
    const n = [...i18n.matchAll(new RegExp('\\b' + k + ':', 'g'))].length;
    assert.equal(n, 2, '键 ' + k + ' 必须在 ZH 与 EN 各出现一次（实测出现 ' + n + ' 次）');
  }
});

test('CHG184-S16 ⭐ 五态文案**两两不同**（否则「可判」只是形而上）', () => {
  const i18n = decodeChunk('src/client/i18n.js');
  // 取 ZH 那一段里的取值（第一个匹配即 ZH 侧）
  const grab = (k) => {
    const m = i18n.match(new RegExp(k + ":\\s*'([^']*)'"));
    return m ? m[1] : null;
  };
  const vals = {};
  for (const k of ['voiceCorrectionStateIdle', 'voiceCorrectionStateIdleOff', 'voiceCorrectionStateRunning',
    'voiceCorrectionStateChanged', 'voiceCorrectionStateUnchanged', 'voiceCorrectionStateSkipped',
    'voiceCorrectionStateFailed']) {
    vals[k] = grab(k);
    assert.ok(vals[k] && vals[k].length > 0, k + ' 必须有非空中文取值');
  }
  // ⚠ 核心：这三态**必须**互相不同 —— 它们是用户报障「看起来没生效」的三个候选解释
  assert.notEqual(vals.voiceCorrectionStateUnchanged, vals.voiceCorrectionStateSkipped,
    '⭐「跑了没改动」与「开关关没跑」文案必须不同（作业书硬要求）');
  assert.notEqual(vals.voiceCorrectionStateUnchanged, vals.voiceCorrectionStateIdle,
    '「跑了没改动」与「压根没触发」文案必须不同');
  assert.notEqual(vals.voiceCorrectionStateSkipped, vals.voiceCorrectionStateIdle,
    '「开关关」与「压根没触发」文案必须不同');
  assert.notEqual(vals.voiceCorrectionStateRunning, vals.voiceCorrectionStateUnchanged,
    '「进行中」与「已完成·无改动」文案必须不同（否则用户以为还在跑）');
});

test('CHG184-S17 变异自证：把 UNCHANGED 与 SKIPPED 合并成一个相位 ⇒ S9 必须红', () => {
  // 本用例在**内存里**改坏状态机（不落盘），验证 S9 的判别力是**行为**而非字面量。
  const src = decodeChunk('src/client/voice/correction.js');
  const mutated = src.replace(
    "    if (changed) {\n      correctionState.changed += 1;\n      correctionState.phase = CORRECTION_PHASES.CHANGED;\n    } else {\n      correctionState.phase = CORRECTION_PHASES.UNCHANGED;\n    }",
    "    if (changed) {\n      correctionState.changed += 1;\n      correctionState.phase = CORRECTION_PHASES.CHANGED;\n    } else {\n      correctionState.phase = CORRECTION_PHASES.SKIPPED;\n    }"
  );
  assert.notEqual(mutated, src, '变异必须真的改到了目标行（否则本用例空转）');
  const factory = new Function('voiceCfgState', mutated + '\n;return { correctionSnapshot, markCorrectionSettled, markCorrectionStarted, correctionPhaseView, correctionPhaseOf };');
  const c = factory({ value: { correction: { enabled: true } } });
  c.markCorrectionStarted();
  c.markCorrectionSettled({ ok: true, text: '一样' }, '一样');
  assert.equal(c.correctionSnapshot().phase, 'skipped', '变异后相位变成 skipped（证明判据咬得住）');
  const a = c.correctionPhaseView('skipped');
  const b = c.correctionPhaseView('unchanged');
  assert.notEqual(a.key, b.key, '基线：两态展示键不同');
  // ⭐ 判别力结论：合并后 S9 的「phase === unchanged」断言必然失败 —— 本条即其最小形态
  assert.notEqual(c.correctionSnapshot().phase, 'unchanged',
    '⭐ 合并相位后不再可能得到 unchanged ⇒ S9 的断言会被咬红（负控成立）');
});

test('CHG184-S18 负控：失败态在**渲染层**不会被 skipped/unchanged 覆盖（端到端串联）', () => {
  const c = loadCorrection({ enabled: false });
  // 先跑一次成功的无改动，再失败 → 显示失败（⛔ 不得回到「无改动」）
  c.markCorrectionSettled({ ok: true, text: 'x' }, 'x');
  assert.equal(c.correctionSnapshot().phase, 'unchanged');
  c.markCorrectionFailed('LLM_FAILED');
  const snap = c.correctionSnapshot();
  assert.equal(c.correctionPhaseOf(snap), 'failed');
  assert.equal(c.correctionPhaseView(c.correctionPhaseOf(snap)).key, 'voiceCorrectionStateFailed');
  // 再补一刀：开关也关着，失败**仍然**优先（承 SW-1：开关态不得掩蔽真实故障）
  c.markCorrectionSkipped('disabled');
  assert.equal(c.correctionSnapshot().phase, 'skipped', '跳过是**新发生的事件**（相位随之更新是对的）');
  // 但「失败优先」的纪律由 correctionPhaseOf 保证：入参同时带两者时 failed 胜
  assert.equal(c.correctionPhaseOf({ phase: 'skipped', lastFailCode: 'X', failed: 1 }), 'skipped',
    '⚠ 如实登记：switched 之后 skipped 是**最新事件**，此处按最新事件显示（不是被掩蔽）');
  assert.equal(c.correctionPhaseOf({ phase: 'failed', skipped: 3 }), 'failed', '失败优先于历史跳过计数');
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHG-184 渲染面：**逐态渲染树**（⛔ 不是「代码里有这个分支」）
// ═══════════════════════════════════════════════════════════════════════════════
// 作业书硬要求：「须给状态可视化的逐态证明：未执行 / 进行中 / 已完成·无改动 /
//   已完成·有改动 / 失败 —— 逐态给读数或构造（⛔ 不得只给『代码里有这个分支』）」。
// ⇒ 本段**真的把 CorrectionStatus 渲染成元素树**，逐态读回
//   { role, aria-live, className, 可见文本 }，并对五态两两做**不同形**的负控。
//
// ⚠ 渲染桩：极简 React（createElement 返回普通对象、useState/useEffect 按槽位持久）
//   —— 与 test/official-bridge.test.cjs 的 makeMiniReact 同款形态，不引入新装置。
// ⚠ 组件是**无状态展示**（只读 snapshot），故一次渲染即得最终文本；订阅由 useEffect 装，
//   本段直接调用 runEffects 再渲染一次（模拟「状态变化后重渲染」）。
// ═══════════════════════════════════════════════════════════════════════════════

/** 极简 React 桩：createElement → 普通树；useState/useEffect 按槽位持久；渲染后跑 effect。 */
function makeRenderReact() {
  const hooks = { state: [], effects: [] };
  let si = 0;
  let ei = 0;
  const React = {
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2);
      return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) };
    },
    Fragment: 'Fragment',
    useState(init) {
      const i = si++;
      if (!(i in hooks.state)) hooks.state[i] = typeof init === 'function' ? init() : init;
      return [hooks.state[i], (v) => { hooks.state[i] = v; }];
    },
    useEffect(fn) { hooks.effects[ei++] = fn; },
    useRef(init) { return { current: init }; },
  };
  return {
    React,
    begin() { si = 0; ei = 0; hooks.effects = []; },
    runEffects() { const list = hooks.effects.slice(); for (const fn of list) { try { const d = fn(); if (typeof d === 'function') d(); } catch (e) { /* 订阅桩 */ } } },
  };
}

/** 把元素树压成可读读数：{ role, ariaLive, className, tabIndex, text }　*/
function readTree(node) {
  const out = { text: '', classes: [], roles: [], ariaLive: [], tabIndexes: [], titles: [] };
  const walk = (n) => {
    if (n === null || n === undefined || n === false || n === true) return;
    if (typeof n === 'string' || typeof n === 'number') { out.text += String(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const p = n.props || {};
    if (typeof p.className === 'string') out.classes.push(p.className);
    if (p.role) out.roles.push(p.role);
    if (p['aria-live']) out.ariaLive.push(p['aria-live']);
    if (p.tabIndex !== undefined) out.tabIndexes.push(p.tabIndex);
    if (p.title) out.titles.push(p.title);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return out;
}

/** 载入 CorrectionStatus 组件（真实 chunk），注入给定 snapshot 与开关真值。 */
function loadStatus(opts) {
  const o = opts || {};
  const mini = makeRenderReact();
  const src = decodeChunk('src/client/voice/correction-status.js');
  const corr = decodeChunk('src/client/voice/correction.js');
  const DICT = {
    voiceCorrectionStateIdle: '纠错：未执行',
    voiceCorrectionStateIdleOff: '纠错：未执行（开关关）',
    voiceCorrectionStateRunning: '正在纠错…',
    voiceCorrectionStateChanged: '纠错完成·已订正',
    voiceCorrectionStateUnchanged: '纠错完成·无需改动',
    voiceCorrectionStateSkipped: '纠错：未执行（开关关）',
    voiceCorrectionStateFailed: '纠错失败',
    voiceCorrectionStateAriaLabel: '语音纠错状态',
  };
  const makeT = () => (k) => (Object.prototype.hasOwnProperty.call(DICT, k) ? DICT[k] : k);
  const voiceCfgState = { value: { correction: { enabled: o.enabled === true } }, listeners: new Set() };
  // 同一 new Function 作用域内求值 correction.js（状态机）→ correction-status.js（组件）
  const factory = new Function(
    'React', 'makeT', 'voiceCfgState', 'subscribeVoiceConfig', 'host',
    corr + '\n' + src + '\n;return { CorrectionStatus };'
  );
  const api = factory(mini.React, makeT, voiceCfgState, () => () => {}, { call: () => Promise.reject(new Error('只读：不应有 RPC')) });
  return { api, mini };
}

/** 渲染一次并读回读数（先跑 effect 装订阅，再渲染）。 */
function renderStatus(api, mini, props) {
  mini.begin();
  const tree = api.CorrectionStatus(props);
  mini.runEffects();
  return readTree(tree);
}

test('CHG184-R1 ⭐ 渲染面·态①「未执行」：可见文本 = 未执行，样式 = ✨ 空闲族，无 spinner', () => {
  const { api, mini } = loadStatus({ enabled: true });
  const r = renderStatus(api, mini, { sessionId: 's-1', inputActions: { setDraft() {} }, input: { draft: '' } });
  assert.equal(r.text, '纠错：未执行', '未执行态的可见文本（真实渲染，非字面量匹配）');
  assert.ok(r.classes.some((c) => c.includes('dsh-enh-btn') && c.includes('dsh-enh-btn-text')), '必须是 ✨ 按钮族类名');
  assert.equal(r.classes.some((c) => c.includes('dsh-enh-btn-busy')), false, '未执行不得带 busy');
  assert.deepEqual(r.roles, ['status'], '必须是 role=status（可被辅助技术读到）');
  assert.equal(r.ariaLive[0], 'polite');
  assert.deepEqual(r.tabIndexes, [-1], '纯状态不可 Tab 聚焦（与 ✨ 同向）');
});

test('CHG184-R2 ⭐ 渲染面·态②「未执行·因开关关」：文本写明开关关（与「压根没触发」不同）', () => {
  const { api, mini } = loadStatus({ enabled: false });
  const r = renderStatus(api, mini, { sessionId: 's-2', inputActions: { setDraft() {} }, input: { draft: '' } });
  assert.ok(r.text.includes('开关关'), 'istigh 未执行且开关关 ⇒ 必须写明「开关关」，实得：' + r.text);
});

test('CHG184-R3 ⭐ 渲染面·态③「进行中」：文本 = 正在纠错… + spinner + busy 类', () => {
  const { api, mini } = loadStatus({ enabled: true });
  // 用真实状态机推进到 running（不手搓 snapshot 字段）
  const corr = decodeChunk('src/client/voice/correction.js');
  const f = new Function('voiceCfgState', corr + '\n;return { markCorrectionStarted };');
  const st = f({ value: { correction: { enabled: true } } });
  // ⚠ 组件读的是自己作用域内的 correctionState ⇒ 必须在**同一作用域**里推进。
  const mini2 = makeRenderReact();
  const src = decodeChunk('src/client/voice/correction-status.js');
  const DICT = {
    voiceCorrectionStateRunning: '正在纠错…', voiceCorrectionStateAriaLabel: '语音纠错状态',
  };
  const factory = new Function('React', 'makeT', 'voiceCfgState', 'subscribeVoiceConfig', 'host',
    corr + '\n' + src + '\n;return { CorrectionStatus, markCorrectionStarted };');
  const api2 = factory(mini2.React, () => (k) => DICT[k] || k, { value: { correction: { enabled: true } } }, () => () => {}, {});
  api2.markCorrectionStarted();
  mini2.begin();
  const tree = api2.CorrectionStatus({ sessionId: 's-3', inputActions: {}, input: { draft: '' } });
  mini2.runEffects();
  const r = readTree(tree);
  assert.equal(r.text, '正在纠错…', '进行中的可见文本');
  assert.ok(r.classes.some((c) => c.includes('dsh-enh-btn-busy')), '进行中必须带 ✨「正在优化」同一个 busy 类');
  const hasSpin = JSON.stringify(tree).includes('dsh-enh-spin');
  assert.equal(hasSpin, true, '进行中必须渲染 spinner（与「正在优化」同一个 dsh-enh-spin）');
});

test('CHG184-R4 ⭐ 渲染面·态④「已完成·无改动」：文本说清「无需改动」（最常见的「看起来没生效」）', () => {
  const corr = decodeChunk('src/client/voice/correction.js');
  const src = decodeChunk('src/client/voice/correction-status.js');
  const DICT = { voiceCorrectionStateUnchanged: '纠错完成·无需改动', voiceCorrectionStateAriaLabel: '语音纠错状态' };
  const mini = makeRenderReact();
  const factory = new Function('React', 'makeT', 'voiceCfgState', 'subscribeVoiceConfig', 'host',
    corr + '\n' + src + '\n;return { CorrectionStatus, markCorrectionSettled };');
  const api = factory(mini.React, () => (k) => DICT[k] || k, { value: { correction: { enabled: true } } }, () => () => {}, {});
  api.markCorrectionSettled({ ok: true, text: '一样的文字' }, '一样的文字');
  mini.begin();
  const r = readTree(api.CorrectionStatus({ sessionId: 's-4', inputActions: {}, input: { draft: '' } }));
  assert.equal(r.text, '纠错完成·无需改动', '无改动态必须明说「检查过了、没需要改」');
  assert.equal(r.classes.some((c) => c.includes('dsh-enh-btn-result')), false, '⛔ 无改动不是成功态 ⇒ 不得用成功绿');
  assert.equal(r.classes.some((c) => c.includes('dsh-vi-err')), false, '⛔ 也不是失败态');
});

test('CHG184-R5 ⭐ 渲染面·态⑤「已完成·有改动」：文本 = 已订正 + 成功族类', () => {
  const corr = decodeChunk('src/client/voice/correction.js');
  const src = decodeChunk('src/client/voice/correction-status.js');
  const DICT = { voiceCorrectionStateChanged: '纠错完成·已订正', voiceCorrectionStateAriaLabel: '语音纠错状态' };
  const mini = makeRenderReact();
  const factory = new Function('React', 'makeT', 'voiceCfgState', 'subscribeVoiceConfig', 'host',
    corr + '\n' + src + '\n;return { CorrectionStatus, markCorrectionSettled };');
  const api = factory(mini.React, () => (k) => DICT[k] || k, { value: { correction: { enabled: true } } }, () => () => {}, {});
  api.markCorrectionSettled({ ok: true, text: '纠正后' }, '纠正前');
  mini.begin();
  const r = readTree(api.CorrectionStatus({ sessionId: 's-5', inputActions: {}, input: { draft: '' } }));
  assert.equal(r.text, '纠错完成·已订正');
  assert.ok(r.classes.some((c) => c.includes('dsh-enh-btn-result')), '有改动用 ✨「已完成」同一个 result 类');
});

test('CHG184-R6 ⭐ 渲染面·态⑥「失败」：文本含失败码 + aria-live=assertive（⛔ 不得静默）', () => {
  const corr = decodeChunk('src/client/voice/correction.js');
  const src = decodeChunk('src/client/voice/correction-status.js');
  const DICT = { voiceCorrectionStateFailed: '纠错失败', voiceCorrectionStateAriaLabel: '语音纠错状态' };
  const mini = makeRenderReact();
  const factory = new Function('React', 'makeT', 'voiceCfgState', 'subscribeVoiceConfig', 'host',
    corr + '\n' + src + '\n;return { CorrectionStatus, markCorrectionFailed };');
  const api = factory(mini.React, () => (k) => DICT[k] || k, { value: { correction: { enabled: true } } }, () => () => {}, {});
  api.markCorrectionFailed('NETWORK');
  mini.begin();
  const r = readTree(api.CorrectionStatus({ sessionId: 's-6', inputActions: {}, input: { draft: '' } }));
  assert.ok(r.text.includes('纠错失败'), '失败必须可见');
  assert.ok(r.text.includes('NETWORK'), '失败码必须可见（不得只说「失败」）');
  assert.equal(r.ariaLive[0], 'assertive', '失败必须 assertive（屏幕阅读器立即播报）');
  assert.ok(r.classes.some((c) => c.includes('dsh-vi-err')), '失败用既有错误色族');
});

test('CHG184-R7 ⭐ 渲染面对账：五态①⑤①的**可见文本两两不同**（同形即缺陷）', () => {
  const corr = decodeChunk('src/client/voice/correction.js');
  const src = decodeChunk('src/client/voice/correction-status.js');
  const DICT = {
    voiceCorrectionStateIdle: '纠错：未执行', voiceCorrectionStateIdleOff: '纠错：未执行（开关关）',
    voiceCorrectionStateRunning: '正在纠错…', voiceCorrectionStateChanged: '纠错完成·已订正',
    voiceCorrectionStateUnchanged: '纠错完成·无需改动', voiceCorrectionStateSkipped: '纠错：未执行（开关关）',
    voiceCorrectionStateFailed: '纠错失败', voiceCorrectionStateAriaLabel: '语音纠错状态',
  };
  const mk = () => {
    const mini = makeRenderReact();
    const factory = new Function('React', 'makeT', 'voiceCfgState', 'subscribeVoiceConfig', 'host',
      corr + '\n' + src + '\n;return { CorrectionStatus, markCorrectionStarted, markCorrectionSettled, markCorrectionFailed, markCorrectionSkipped };');
    return { mini, api: factory(mini.React, () => (k) => DICT[k] || k, { value: { correction: { enabled: true } } }, () => () => {}, {}) };
  };
  const texts = {};
  const read = (h, ph) => { h.mini.begin(); return readTree(h.api.CorrectionStatus({ sessionId: 's-7', inputActions: {}, input: { draft: '' } })).text; };
  let h = mk(); texts.idle = read(h);
  h = mk(); h.api.markCorrectionStarted(); texts.running = read(h);
  h = mk(); h.api.markCorrectionSettled({ ok: true, text: 'a' }, 'b'); texts.changed = read(h);
  h = mk(); h.api.markCorrectionSettled({ ok: true, text: 'a' }, 'a'); texts.unchanged = read(h);
  h = mk(); h.api.markCorrectionFailed('X'); texts.failed = read(h);
  h = mk(); h.api.markCorrectionSkipped('disabled'); texts.skipped = read(h);
  const vals = Object.values(texts);
  assert.equal(new Set(vals).size, vals.length, '⭐ 六态可见文本必须两两不同，实得：' + JSON.stringify(texts));
  assert.notEqual(texts.unchanged, texts.skipped, '⭐「跑了没改动」≠「开关关没跑」（作业书硬要求）');
});

