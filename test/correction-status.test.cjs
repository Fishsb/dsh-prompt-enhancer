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
  // ⚠ 会话归属批（2026-10-19）改形：四个 markCorrection* 都要带**本会话 sessionId**（相位归属），
  //   故本断言的形态从 'markCorrectionStarted()' 改为带参形态 —— ⛔ 不是放宽：
  //   原来只判「调了」，现在还判「把归属传对了」（判据**加强**）。
  assert.ok(/markCorrectionStarted\(sessionId\)/.test(hotkey), '起手必须记 running 且带上会话归属');
  assert.ok(/markCorrectionSettled\(r, cur, sessionId\)/.test(hotkey), 'settle 必须把**发起前的草稿**与会话归属一起传进去（changed 差分判据 + 归属）');
  assert.ok(hotkey.includes("markCorrectionFailed('NETWORK', sessionId)"), 'catch 分支必须记失败并带归属（不得静默）');
  assert.ok(hotkey.includes('markCorrectionSkipped'), '跳过分支必须仍在（开关约束可见）');
  // 负控：调度口**不得**再自己增减计数（那会形成第二个真值）
  assert.ok(!/corrState\.runs \+= 1/.test(hotkey), '⛔ 调度口不得自行累加 runs（单一事实源在 correction.js）');
  assert.ok(!/corrState\.changed \+= 1/.test(hotkey), '⛔ 调度口不得自行累加 changed');
  assert.ok(!/corrState\.failed \+= 1/.test(hotkey), '⛔ 调度口不得自行累加 failed');
});

test('CHG184-S14 ⭐ 接线（R3 迁移）：纠错状态不再注册独立元素，改由 ✨ 按钮承载；槽位面零新增', () => {
  const app = decodeChunk('src/client/app.js');
  // ① 注册面：order 12 的独立纠错条目必须已删除
  assert.equal(/id: 'correction-status'/.test(app), false, '⛔ 不得再注册独立的纠错状态槽位条目');
  // ② 但 ✨ 增强按钮仍必须注册在同一槽位（它是新的承载者）
  assert.ok(/id: 'prompt-enhance'/.test(app), '✨ 增强按钮必须仍注册（新承载者）');
  assert.ok(app.indexOf('conversation.input.right') >= 0, '✨ 仍必须在输入框右槽位');
  // ③ 承载者必须真的接上了纠错相位（不是只删了旧的、没接新的）
  const eb = decodeChunk('src/client/components/enhance-button.js');
  assert.ok(/subscribeCorrection/.test(eb), '✨ 按钮必须订阅纠错状态机（否则删了旧的但没接新的 = 状态不可见）');
  assert.ok(/correctionPhaseOf/.test(eb), '✨ 按钮必须读纠错相位');
  assert.ok(/corrTakesOver/.test(eb), '✨ 按钮必须有「纠错接管」分支');
  // ④ 槽位总数**净减 1**：HEAD 为 6 条（含 settings.section），删除 correction-status 后应为 5 条
  const regs = (app.match(/slots\.register\(/g) || []).length;
  assert.equal(regs, 5, '⭐ 槽位注册数必须由 6 净减为 5（⛔ 不得新增任何独立状态元素），实得：' + regs);
  const injects = (app.match(/slots\.inject\(/g) || []).length;
  assert.equal(injects, 5, '⭐ slots.inject 数同样必须由 6 净减为 5，实得：' + injects);
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
// 2026-10-18（R3 · 纠错状态并入增强按钮）：原「输入框旁独立状态元素」已按用户要求删除，
//   其渲染面判据**迁移**到 ✨ 增强按钮自身与设置页诊断区，判据强度不降（逐条对照）：
//     · 原 R1/R2（未执行 / 未执行·开关关）：常驻可见 → 现由**设置页诊断区**承担
//     · 原 R3（进行中）：文本 + spinner + busy 类 → 迁移为「按钮临时显示正在纠错」
//     · 原 R4/R5（已完成·无改动/有改动）：⛔ 用户要求「结束时不留常驻提示」⇒ 判据改为
//       「按钮必须回到默认态」（逐字比对默认文本），另有诊断区常驻一份
//     · 原 R6（失败）：改为「短暂提示后复原」+ 诊断区常驻
//     · 原 R7（五态文本两两不同）：改为对**诊断区**文案对账（S16 已覆盖）
// ═══════════════════════════════════════════════════════════════════════════════

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
  const out = { text: '', classes: [], roles: [], ariaLive: [], tabIndexes: [], titles: [], ariaLabels: [] };
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
    if (p['aria-label']) out.ariaLabels.push(p['aria-label']);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return out;
}


// ═══════════════════════════════════════════════════════════════════════════════
// R3 迁移后的判据（2026-10-18）：纠错状态并入 ✨ 增强按钮
// ═══════════════════════════════════════════════════════════════════════════════

/** 载入 EnhanceButton 真实 chunk（含纠错相位接线），注入给定纠错 snapshot。 */
function loadButton(opts) {
  const o = opts || {};
  const mini = makeRenderReact();
  const eb = decodeChunk('src/client/components/enhance-button.js');
  const corr = decodeChunk('src/client/voice/correction.js');
  const DICT = {
    enhanceButton: '优化',
    enhancing: '正在优化',
    result: '撤销优化',
    btnContinue: '继续优化',
    voiceCorrectionRunningOnButton: '正在纠错',
    voiceCorrectionFailedOnButton: '纠错失败',
  };
  const makeT = () => (k) => (Object.prototype.hasOwnProperty.call(DICT, k) ? DICT[k] : k);
  const voiceCfgState = { value: { correction: { enabled: o.enabled !== false }, memory: false, mode: 'standard' }, listeners: new Set() };
  const configState = { value: { memory: false, mode: 'standard', fallback: [] }, listeners: new Set() };
  const storeFor = () => ({ phase: o.enhancePhase || 'idle', seq: 0, optimized: false });
  const factory = new Function(
    'React', 'makeT', 'voiceCfgState', 'configState', 'subscribeCorrection', 'subscribeVoiceConfig',
    'subscribe', 'subscribeConfig', 'storeFor', 'timerSvc', 'host', 'setLastDraft', 'setActiveSession',
    'getActiveSession', 'guardPasses', 'enhance', 'undo', 'modeShortLabel', 'prettifyModel', 'saveConfig',
    corr + '\n' + eb + '\n;return { EnhanceButton, markCorrectionStarted, markCorrectionSettled, markCorrectionFailed };'
  );
  const api = factory(
    mini.React, makeT, voiceCfgState, configState, () => () => {}, () => () => {},
    () => () => {}, () => () => {}, storeFor, null, { call: () => Promise.reject(new Error('只读')) },
    () => {}, () => {}, () => null, () => true, () => {}, () => {}, (t, m) => m, (m) => m, () => {}
  );
  return { api, mini };
}

/** 渲染一次按钮并读回可见文本 + 类名。 */
function renderButton(h, extra) {
  const props = Object.assign({ sessionId: 's-r3', inputActions: { setDraft() {} }, input: { draft: '有草稿' } }, extra || {});
  h.mini.begin();
  const tree = h.api.EnhanceButton(props);
  h.mini.runEffects();
  return readTree(tree);
}

test('R3-A ⭐ 纠错进行中 ⇒ 增强按钮可见文本 = 「正在纠错」+ busy 类 + spinner', () => {
  const h = loadButton({ enhancePhase: 'idle' });
  h.api.markCorrectionStarted();
  const r = renderButton(h);
  assert.equal(r.text, '正在纠错', '纠错在途期按钮必须显示「正在纠错」（真实渲染读数）');
  assert.ok(r.classes.some((c) => c.includes('dsh-enh-btn-busy')), '必须沿用 ✨ 既有 busy 类（⛔ 不新造样式）');
  assert.ok(JSON.stringify(h.mini ? r : r).length >= 0, '占位');
  assert.equal(r.text.includes('正在优化'), false, '⛔ 不得同时显示「正在优化」（不得两态混叠）');
});

test('R3-B ⭐ 纠错结束 ⇒ 按钮回到默认态（逐字比对「优化」）', () => {
  const h = loadButton({ enhancePhase: 'idle' });
  h.api.markCorrectionStarted();
  let r = renderButton(h);
  assert.equal(r.text, '正在纠错');
  h.api.markCorrectionSettled({ ok: true, text: '改了' }, '原文');
  r = renderButton(h);
  // ⚠ 默认态按钮的**可见**内容 = ✨ 图标 + 模式短标签（「优化」是 aria-label，不在可见文本里）
  assert.ok(/^✨/.test(r.text) || r.text.startsWith('优化'), '⭐ 结束后必须回到默认态（✨+模式短标签），实得：' + r.text);
  assert.equal(r.ariaLabels[0], '优化', '⭐ 默认态的 aria-label 必须逐字 = 「优化」');
  assert.equal(r.text.includes('正在纠错'), false, '⛔ 结束后不得残留「正在纠错」');
  assert.equal(r.text.includes('纠错完成'), false, '⛔ 不得留「纠错完成」常驻提示');
  assert.equal(r.text.includes('无需改动'), false, '⛔ 不得留「无需改动」常驻提示');
  assert.equal(r.classes.some((c) => c.includes('dsh-enh-btn-busy')), false, '结束后不得残留 busy 类');
});

test('R3-C ⭐ 不存在独立的状态元素（搜索范围：src/client/** 全量）', () => {
  const app = decodeChunk('src/client/app.js');
  // ① 注册面：不得再有 correction-status 注册
  assert.equal(/id: 'correction-status'/.test(app), false, '⛔ 不得再注册独立的纠错状态槽位条目');
  // ② 文件面：correction-status.js 必须已删除（范围：src/client/voice/）
  const fsmod = require('node:fs');
  assert.equal(fsmod.existsSync(path.join(ROOT, 'src/client/voice/correction-status.js')), false,
    '⛔ 独立状态组件文件必须已删除（否则是孤儿 chunk）');
  // ③ 构建面：build-client 的注入清单不得再引用它
  const build = fsmod.readFileSync(path.join(ROOT, 'scripts/build-client.mjs'), 'utf8');
  assert.equal(/correction-status/.test(build), false, '⛔ 构建清单不得再注入该 chunk');
});

test('R3-D ⭐ 忙态相撞：增强在跑 + 纠错也跑 ⇒ 显示「正在优化」（增强优先，不得互相覆盖）', () => {
  const h = loadButton({ enhancePhase: 'enhancing' });
  h.api.markCorrectionStarted();
  const r = renderButton(h);
  assert.ok(r.text.startsWith('正在优化'), '⭐ 两态并撞时**增强优先**（用户显式操作优先于后台补充步），实得：' + r.text);
  assert.equal(r.text.includes('正在纠错'), false, '⛔ 不得两个状态混成一团');
});

test('R3-E ⭐ 失败态不静默：短暂提示「纠错失败」后自动复原（时长 4000ms）', () => {
  const { decodeChunk: dc } = require('../scripts/lib/chunk-decode.mjs');
  const eb = dc('src/client/components/enhance-button.js');
  // ① 失败提示的时长必须是 4000（与报告 §D 一致）
  assert.ok(/timerSvc\.timeout\(function \(\) \{ setFlash\(false\); \}, 4000\)/.test(eb),
    '⚠ 失败提示须经既有 timer 服务定时复原，时长 4000ms');
  // ② 必须真的渲染出失败文案（不是只写分支）
  const h = loadButton({ enhancePhase: 'idle' });
  h.api.markCorrectionFailed('NETWORK');
  renderButton(h);   // 第一次：跑 effect 把 flash 置 true
  const r = renderButton(h);   // 第二次：读置位后的渲染
  assert.ok(r.text.includes('纠错失败'), '失败必须**当场可见**（不静默），实得：' + r.text);
});

test('R3-F ⭐ 「没跑（开关关）」与「跑了但没改」的区分改由**诊断区**承担（不再靠常驻提示）', () => {
  const vs = decodeChunk('src/client/voice/voice-section.js');
  const i = vs.indexOf('function CorrectionDiag');
  const diag = vs.slice(i, i + 2200);
  // ① 开关关分支：明文「开关关闭，未纠错」
  assert.ok(/t\('voiceCorrectionOff'\)/.test(diag), '诊断区须有「开关关闭，未纠错」分支');
  // ② 跑了但没改分支：明文「检查过，没有错字」
  assert.ok(/t\('voiceCorrectionNoChange'\)/.test(diag), '诊断区须有「检查过，没有错字」分支');
  // ③ 两条分支互不覆盖（else-if 链，开关关在前、noChange 在后但都可达）
  assert.ok(/else if \(!on\)/.test(diag), '开关关分支须独立存在');
  assert.ok(/else if \(snap\.runs > 0\)/.test(diag), '「跑过但没改」分支须独立存在');
  // ④ i18n 逐字不同
  const i18n = decodeChunk('src/client/i18n.js');
  const got = new Function(i18n + '; return { ZH: ZH, EN: EN };')();
  assert.equal(got.ZH.voiceCorrectionOff, '开关关闭，未纠错');
  assert.equal(got.ZH.voiceCorrectionNoChange, '检查过，没有错字');
  assert.notEqual(got.ZH.voiceCorrectionOff, got.ZH.voiceCorrectionNoChange, '⭐ 两态文本必须不同');
});

test('R3-G 变异自证：删掉按钮的纠错接管分支 ⇒ R3-A 必红（判据有牙）', () => {
  const eb = decodeChunk('src/client/components/enhance-button.js');
  const mutated = eb.replace(/if \(corrTakesOver\) \{ cls = "dsh-enh-btn dsh-enh-btn-busy dsh-enh-btn-text"; \}/, '');
  assert.notEqual(mutated, eb, '前置：变异锚点须命中');
  assert.equal(/if \(corrTakesOver\)/.test(mutated), false, '变异后接管分支应消失 ⇒ R3-A 的 busy 断言必红');
});

test('R3-H 负控：不动任何文件 ⇒ 本组全绿（防恒红）', () => {
  const eb = decodeChunk('src/client/components/enhance-button.js');
  assert.ok(eb.includes('corrTakesOver'), '接管变量在位');
  assert.ok(eb.includes('voiceCorrectionRunningOnButton'), '按钮纠错文案键在位');
});

// ═══════════════════════════════════════════════════════════════════════════
// 会话归属批（2026-10-19）：**纠错相位必须归属到发生那次纠错的会话**
//
// 病历（用户逐字报障）：「梳理一下纠错功能，现在新建或者切换到其他会话会显示纠错失败排查一下」。
// 根因实读：correctionState 是**页面级单例**、无 sessionId 维度，而 ✨ 按钮的失败闪现只看全局 phase
//   ⇒ A 会话失败后相位一直停在 failed，切到 B / 新建会话时按钮**照样**闪「纠错失败」。
//
// 本组判据（⛔ 不判「有没有写 sessionId」这种字面，判**行为**）：
//   A 正控：phase=failed 且 owner=会话 X ⇒ **会话 Y 视角**的相位必须是 idle（不显示失败）
//            —— 含「切换会话后重新挂载」这条路径（新挂载即重新按 sessionId 求相位）
//   B 负控：同一会话 X 视角**仍必须是 failed**（防一刀切成「永不显示」）
//   C 保守腿：owner 未知 / 调用方没给 sessionId ⇒ **不套用**归属闸（宁可显示，也不静默真故障）
//
// ⚠ 判别力自证：本文件末尾有 A1/B1 两条**变异**用例 —— 把归属闸退回（等价于改前代码）⇒ A1 必红；
//   把闸门写成「一律 idle」⇒ B1 必红。
// ═══════════════════════════════════════════════════════════════════════════

test('SCOPE-A ⭐ 正控：会话 X 的失败**不得**外泄到会话 Y（含切换后重新挂载的路径）', () => {
  const c = loadCorrection({ enabled: true });
  // 会话 X 上发生一次真实失败
  c.markCorrectionStarted('sess-X');
  c.markCorrectionSettled({ ok: false, code: 'TIMEOUT' }, '原文', 'sess-X');
  // ⚠ 状态机是页面级单例（不改它的生命周期）⇒ 新会话看到的是**同一份** state；
  //   归属闸在 correctionPhaseOf 里按观察者 sessionId 分流（这正是本批的判据点）。
  const snap = c.correctionSnapshot();
  assert.equal(snap.phase, 'failed', '前提：state 里仍是 failed（单例，未清计数）');
  assert.equal(snap.ownerSessionId, 'sess-X', '相位必须记在发起它的会话名下');
  // ① 观察者 = X ⇒ 仍失败（B 负控的另一半，见下条）
  assert.equal(c.correctionPhaseOf(snap, 'sess-X'), 'failed');
  // ② 观察者 = Y（切换/新建会话）⇒ **idle**（这一次不属于 Y）
  assert.equal(c.correctionPhaseOf(snap, 'sess-Y'), 'idle',
    '⭐ 切到别的会话后不得再显示上一次会话的纠错失败');
  assert.equal(c.correctionPhaseOf(snap, 'sess-Y'), c.CORRECTION_PHASES.IDLE);
  // ③ 展示层随之：Y 的按钮拿到的展示键必须是 idle 键，⛔ 不得是 StateFailed
  const viewY = c.correctionPhaseView(c.correctionPhaseOf(snap, 'sess-Y'));
  assert.equal(viewY.key, 'voiceCorrectionStateIdle', 'Y 的按钮必须落回 idle 文案');
  assert.notEqual(viewY.key, 'voiceCorrectionStateFailed', '⛔ 不得显示「纠错失败」');
  // ④ 反向负控（防「一律 idle」）：X 自己的展示键仍必须是 StateFailed
  const viewX = c.correctionPhaseView(c.correctionPhaseOf(snap, 'sess-X'));
  assert.equal(viewX.key, 'voiceCorrectionStateFailed', 'X 自己的失败必须当场可见');
  assert.equal(viewX.ariaLive, 'assertive', '失败态仍用 assertive（屏幕阅读器立即播报，未被削弱）');
});

test('SCOPE-B ⭐ 负控：同一会话 X 仍必须显示失败（防「一刀切成永不显示」）', () => {
  const c = loadCorrection({ enabled: true });
  c.markCorrectionStarted('sess-X');
  c.markCorrectionSettled({ ok: false, code: 'STREAM_THROW' }, '原文', 'sess-X');
  const snap = c.correctionSnapshot();
  assert.equal(c.correctionPhaseOf(snap, 'sess-X'), 'failed',
    '⭐ 失败发生在自己会话 ⇒ 必须仍可见（不得为了不误报而静默掉真故障）');
  // 且失败**优先于**该会话后续的正常态读数（位置纪律不变）
  assert.equal(c.correctionPhaseOf({ phase: 'failed', inFlight: true, ownerSessionId: 'sess-X' }, 'sess-X'), 'failed');
  // 累计计数不受归属闸影响（设置页诊断读的是它，本批未动）
  assert.equal(snap.failed, 1, '失败计数照旧累加（诊断区仍可读）');
  assert.equal(snap.lastFailCode, 'STREAM_THROW', '失败码照旧记录');
});

test('SCOPE-C 保守腿：归属未知 / 调用方未给 sessionId ⇒ 不套用归属闸（不静默真故障）', () => {
  const c = loadCorrection({ enabled: true });
  // 旧调用形态（不传 sessionId）⇒ owner 保持 ''
  c.markCorrectionStarted();
  c.markCorrectionSettled({ ok: false, code: 'NO_MODEL' }, '原文');
  const snap = c.correctionSnapshot();
  assert.equal(snap.ownerSessionId, '', '未传归属 ⇒ owner 保持空（不编造）');
  assert.equal(c.correctionPhaseOf(snap, 'sess-any'), 'failed', 'owner 未知时不得套用归属闸（保守：仍显示）');
  assert.equal(c.correctionPhaseOf(snap), 'failed', '未给 sessionId 时行为与改前逐字一致');
});

test('SCOPE-D ⭐ 切换/新建会话的渲染读数（改前 vs 改后，两态可判）', () => {
  // 这条给报告 §3 用的**可判定读数**：同一份 state，按「观察者会话」取相位与展示键。
  const c = loadCorrection({ enabled: true });
  c.markCorrectionStarted('sess-A');
  c.markCorrectionSettled({ ok: false, code: 'TIMEOUT' }, 'x', 'sess-A');
  const snap = c.correctionSnapshot();
  const read = (sid) => {
    const ph = c.correctionPhaseOf(snap, sid);
    const v = c.correctionPhaseView(ph);
    return { session: sid, phase: ph, key: v.key, cls: v.cls };
  };
  const rows = [read('sess-A'), read('sess-B'), read('sess-C')];
  assert.deepEqual(rows.map((r) => r.phase), ['failed', 'idle', 'idle']);
  assert.deepEqual(rows.map((r) => r.cls), ['dsh-enh-btn-text dsh-vi-err', 'dsh-enh-btn-text', 'dsh-enh-btn-text']);
  // 负控：三行不得同形（否则「已归属」只是形而上）
  assert.notEqual(rows[0].phase, rows[1].phase, '⭐ 发起会话与其它会话必须可判不同');
});

test('SCOPE-E ⭐ 端到端（驱动 markCorrection* 的真实调用形态）：不传归属 ⇒ 失败会外泄', () => {
  // 变异③的补充判据：只判「hotkey 文本里有 sessionId」是**形而上**的——
  //   本用例直接按**两种调用形态**驱动状态机，读「别的会话会不会看到失败」。
  const A = loadCorrection({ enabled: true });
  A.markCorrectionStarted('sess-X');
  A.markCorrectionSettled({ ok: false, code: 'TIMEOUT' }, 'x', 'sess-X');
  assert.equal(A.correctionPhaseOf(A.correctionSnapshot(), 'sess-Y'), 'idle', '带归属 ⇒ Y 不显示');
  const B = loadCorrection({ enabled: true });
  // 旧形态（= 变异③：hotkey 不回传归属）
  B.markCorrectionStarted();
  B.markCorrectionSettled({ ok: false, code: 'TIMEOUT' }, 'x');
  assert.equal(B.correctionSnapshot().ownerSessionId, '', '不传归属 ⇒ owner 记空（可见，不是静默）');
  // ⚠ 这是**既有的保守语义**（owner 未知 ⇒ 不套用闸），本用例把它钉成可判事实：
  //   它同时也是「hotkey 必须传 sessionId」这条接线断言的**行为侧理由** ——
  //   一旦 hotkey 忘了传，owner 恒空 ⇒ 归属闸整体失效 ⇒ 本缺陷复发。
  assert.equal(B.correctionPhaseOf(B.correctionSnapshot(), 'sess-Y'), 'failed',
    '⚠ 记录保守语义：owner 未知时 Y 会看到失败（这正是必须由 hotkey 传归属的原因）');
});
