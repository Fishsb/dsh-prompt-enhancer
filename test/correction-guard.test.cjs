// ============================================================================
// 纠错服务端守卫批（2026-10-17）· 判据锁：`voice/correct` 必须**自己**读
// `voice.correction.enabled`，关闭时**不调模型**且返回**可判的跳过码**。
//
// 病历（真机复核批实测，本批 §② 只读复现）：把开关置 false 后直调该 RPC —— 2/2 都走到模型
// （`HTTP 200` + `changed:true`）。根因：开关此前**只**由 client 的
// `runCorrectionThenMaybeEnhance` 拦截 ⇒ 任何直调路径（curl / 他 client / 未来新入口）都穿透。
//
// 本文件的判据纪律（逐条对齐作业书）：
//   ① 守卫用例**在代码层/单测层证明**，不真打模型（真实调用总数另有上限，见报告 §⑨）；
//   ② **返回值语义**：跳过时必须与「跑了没事」**可判** ⇒ 断言 `skipped` / `code`，
//      ⛔ 不得只看 `ok`（更不得伪造成 `changed:false`）；
//   ③ **取形 `=== true`**（与 mergeVoice / sanitizeVoiceCfg 同形）⇒ 缺省（config 里没有
//      `correction` 键）必须按**关**处理（fail-closed）；⛔ `!== false` 形态必须被判红；
//   ④ **变异自证 + 负控**：对真实 bundle 做**内存变异**（不改磁盘），同一判定路径必须翻转。
//
// ⚠ 本文件**不**断言「client 侧那道拦截被删」—— 用户裁定**保留**（纵深防御两层）。
//   本文件另设一条锁，确保它**还在**（防有人以「服务端有了」为由拆掉前端那层）。
// ============================================================================
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BODY = fs.readFileSync(path.join(ROOT, 'plugin-host.js'), 'utf8');
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');

/**
 * 求值 host bundle（与 `lib/index.cjs` 同一机制：`new Function('harness', BODY)`）。
 * opts.llm 注入可观测的假 llm 服务（记录每次 stream 调用）。
 */
function boot(opts) {
  const o = opts || {};
  const handlers = new Map();
  const harness = {
    handle(method, fn) { if (typeof method === 'string' && typeof fn === 'function') handlers.set(method, fn); },
  };
  const ctx = {
    get: (name) => {
      if (name === 'llm' && o.llm) return o.llm;
      return undefined;
    },
    effect: () => {},
    timer: o.timer || { timeout: () => () => {} },
  };
  const plugin = new Function('harness', BODY)(harness);
  plugin.apply(ctx);
  return { handlers };
}

/** 记录 stream 调用的假 llm；返回一段固定的「已纠错」文本。 */
function mockLlm(seen, outText) {
  return {
    stream(params) {
      seen.push(params);
      const text = outText === undefined ? '纠正后的文字' : outText;
      return {
        [Symbol.asyncIterator]() {
          let step = 0;
          return {
            async next() {
              step += 1;
              if (step === 1) return { done: false, value: { type: 'text-delta', text } };
              return { done: false, value: { type: 'finish', reason: { kind: 'stop' } } };
            },
            async return() { return { done: true, value: undefined }; },
          };
        },
      };
    },
  };
}

/** 一份「形状正确」的配置（fallback 链非空，否则会先落 NO_MODEL 抢在守卫之前）。 */
function cfgWith(correction) {
  const base = {
    fallback: [{ provider: 'p', model: 'm' }],
    params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
  };
  if (correction === undefined) return base;
  if (correction === 'nested') { base.voice = { correction: { enabled: false } }; return base; }
  return Object.assign({}, base, { correction });
}

const CORR_TEXT = '这各功能很好用，我门明天在说。';

// ───────────── ① 核心：开关关闭 ⇒ 零模型调用 + 可见跳过码 ─────────────
test('GUARD-C1 ⭐ 开关关闭 ⇒ **零**模型调用，且返回可判的跳过码（不是 changed:false）', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlm(seen) });
  const out = await handlers.get('voice/correct')({
    sessionId: 's1', text: CORR_TEXT, config: cfgWith({ enabled: false }),
  });
  assert.equal(seen.length, 0, '⭐ 开关关闭 ⇒ 必须**一次**模型调用都不发生（本判据 = 病历的正面）');
  assert.equal(out.skipped, true, '必须显式标记 skipped（让「没跑因开关」可判）');
  assert.equal(out.code, 'CORRECTION_DISABLED', '必须给可判的跳过码');
  assert.equal(out.skippedBy, 'correction.enabled', '跳过原因须点名开关（哪一项开关）');
  // ⭐ 关键：不得与「跑了没事」同形
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'changed'), false,
    '⭐ 跳过时**不得**给 changed（给了就会让「关了」与「没错字」同形）');
  assert.equal(out.changed, undefined, 'changed 必须是缺位，而不是 false');
  // 守卫不是失败：ok 仍 true（用户的选择，不该被当错误重试）
  assert.equal(out.ok, true, '守卫不是失败 ⇒ ok 仍为 true（区分点 = skipped/code，不是 ok）');
  // 原文回传（调用方拿到的草稿不被吞）
  assert.equal(out.text, CORR_TEXT, '跳过时须原样回传 text（不吞草稿）');
  assert.ok(typeof out.message === 'string' && out.message !== '', '跳过须带可读信息（不得静默）');
});

test('GUARD-C2 开关打开 ⇒ 恰好 1 次模型调用，且**没有**跳过标记（对照）', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlm(seen) });
  const out = await handlers.get('voice/correct')({
    sessionId: 's2', text: CORR_TEXT, config: cfgWith({ enabled: true }),
  });
  assert.equal(seen.length, 1, '开关打开 ⇒ 走模型（1 次）');
  assert.equal(out.ok, true);
  assert.equal(out.skipped, undefined, '真跑过就不得带跳过标记');
  assert.equal(out.changed, true, '真跑过才给 changed（本例模型确实改了）');
});

test('GUARD-C3 开关打开但模型**没改** ⇒ changed:false 且**无** skipped（两态可判）', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlm(seen, CORR_TEXT) });   // 原样回同一串
  const out = await handlers.get('voice/correct')({
    sessionId: 's3', text: CORR_TEXT, config: cfgWith({ enabled: true }),
  });
  assert.equal(seen.length, 1, '跑过（1 次调用）');
  assert.equal(out.changed, false, '跑了没事 ⇒ changed:false');
  assert.equal(out.skipped, undefined, '⭐ 与「因开关没跑」可判：此处**没有** skipped');
  assert.equal(out.code, undefined, '⭐ 也不得带跳过码');
});

// ───────────── ② fail-closed：缺省/读不到 ⇒ 按关处理，但可见 ─────────────
test('GUARD-C4 ⭐ fail-closed：config 缺 `correction` 键 ⇒ 按**关**处理（零调用）且可见', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlm(seen) });
  const out = await handlers.get('voice/correct')({ sessionId: 's4', text: CORR_TEXT, config: cfgWith(undefined) });
  assert.equal(seen.length, 0, '缺省语义 = 关 ⇒ 不得调模型');
  assert.equal(out.skipped, true, '必须可见（不得静默）');
  assert.equal(out.code, 'CORRECTION_DISABLED');
});

test('GUARD-C5 fail-closed：完全不给 config ⇒ 同样按关处理且可见', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlm(seen) });
  const out = await handlers.get('voice/correct')({ sessionId: 's5', text: CORR_TEXT });
  assert.equal(seen.length, 0, '无配置 ⇒ 读不到 ⇒ 关（fail-closed）');
  assert.equal(out.skipped, true);
  assert.equal(out.code, 'CORRECTION_DISABLED');
});

test('GUARD-C6 取形非法值一律按关：correction.enabled = "true" / 1 / null / {} / 0', async () => {
  const vals = ['true', 1, null, {}, 0, 'yes'];
  for (const v of vals) {
    const seen = [];
    const { handlers } = boot({ llm: mockLlm(seen) });
    const out = await handlers.get('voice/correct')({ sessionId: 's6-' + String(v), text: CORR_TEXT, config: cfgWith({ enabled: v }) });
    assert.equal(seen.length, 0, '非法值 ' + JSON.stringify(v) + ' 必须按关（不得调模型）');
    assert.equal(out.skipped, true, '非法值 ' + JSON.stringify(v) + ' 须可见跳过');
  }
});

// ───────────── ③ 位置纪律：守卫在入参校验之后（既有码不抢跑/不被遮蔽） ─────────────
test('GUARD-C7 既有码语义不变：空文本仍 GUARD、无 llm 仍 NO_LLM（守卫不抢跑）', async () => {
  const seen = [];
  const { handlers: h1 } = boot({ llm: mockLlm(seen) });
  const empty = await h1.get('voice/correct')({ sessionId: 's7', text: '   ', config: cfgWith({ enabled: false }) });
  assert.equal(empty.code, 'GUARD', '空文本校验先于守卫（既有语义不被动）');
  const { handlers: h2 } = boot({});
  const noLlm = await h2.get('voice/correct')({ sessionId: 's7', text: 'x', config: cfgWith({ enabled: false }) });
  assert.equal(noLlm.code, 'NO_LLM', '无 llm 服务优先报 NO_LLM（不得被守卫吞成 skipped）');
});

test('GUARD-C8 守卫在 `chain` 建立之前：即使 fallback 为空（NO_MODEL 先兆）关闭态也判 skipped', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlm(seen) });
  const out = await handlers.get('voice/correct')({
    sessionId: 's8', text: CORR_TEXT,
    config: { fallback: [], params: { timeoutMs: 1000, maxTokens: 100, outputLimit: 1000 }, correction: { enabled: false } },
  });
  assert.equal(out.skipped, true, '开关关闭时先判跳过（不因缺模型而落 NO_MODEL）');
  assert.equal(seen.length, 0);
});

// ───────────── ④ 纵深防御：client 那道拦截**必须还在**（用户裁定保留） ─────────────
test('GUARD-D1 ⭐ 两层防线都在：client 侧调度口仍读开关（不得以「服务端有了」为由拆掉）', () => {
  const hotkey = decodeChunk('src/client/voice/hotkey.js');
  assert.ok(hotkey.includes('const runCorrectionThenMaybeEnhance = () =>'),
    'client 侧调度口须仍在（用户裁定：保留，纵深防御两层）');
  assert.ok(/const correctionCfgOn = \(\) => \{/.test(hotkey), 'client 侧开关读取须仍在');
  assert.ok(/if \(!wantCorrect\) \{/.test(hotkey), 'client 侧仍须按开关分流（置 false 时不发请求）');
  // 服务端守卫（同一事实的第二层）：bundle 内必须有取形 + 跳过码
  assert.ok(/function correctionEnabledOf\(rawCfg\)/.test(BODY), 'host bundle 内须有守卫取形函数');
  assert.ok(BODY.includes("CORRECTION_DISABLED"), 'host bundle 内须有跳过码');
  // 说明边界：两层不是冗余缺陷，而是**有意**的（任一层单独失效都还有另一层）
  assert.ok(hotkey.includes('markCorrectionSkipped'),
    'client 侧的跳过计数仍须在（用户可见性读数不随本批改动）');
});

// ───────────── ⑤ ⭐ 读哪一份配置（本席自查修正过的关键一处） ─────────────
// 病历（本批自检逮到，见报告 §④）：守卫第一版读的是**随请求带来的** `args.config`。
//   而 client 调度口传的是 `configState`（**增强配置**）——`src/client/state.js` 的
//   `cloneDefaults()` 形状里**既无 `voice` 也无 `correction`**（本节 GUARD-R1 机检这一事实）。
//   ⇒ 若读随行 config，**产品链路上开关打开也会被判成"关"** ⇒ 纠错被永久关死
//   （那正是「拆东墙补西墙」：补了守卫，砸了功能）。
// ⇒ 正解：读**服务端已归一化**的 face（`harness.readVoiceConfig()` = readConfig → sanitizeVoiceCfg）。
test('GUARD-R1 ⭐ 产品链路形态：随行 config **无** voice/correction 键 + 磁盘面为开 ⇒ 必须**走模型**（不得误关）', async () => {
  const seen = [];
  const handlers = new Map();
  const harness = {
    handle: (m, f) => { if (typeof m === 'string' && typeof f === 'function') handlers.set(m, f); },
    // 模拟 host 装配面：已归一化的 voice 配置（sanitizeVoiceCfg 的产物形状）
    readVoiceConfig: () => ({ filler: { enabled: true }, vad: { enabled: true, silenceMs: 2000 }, hotkey: { enabled: false, combo: '' }, autoEnhance: false, correction: { enabled: true } }),
  };
  const ctx = { get: (n) => (n === 'llm' ? mockLlm(seen) : undefined), effect: () => {}, timer: { timeout: () => () => {} } };
  new Function('harness', BODY)(harness).apply(ctx);
  // ⭐ 随行 config = 真实 client 形状（增强配置，无 voice / 无 correction）
  const clientCfg = { version: 2, fallback: [{ provider: 'p', model: 'm' }], params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 } };
  assert.equal(Object.prototype.hasOwnProperty.call(clientCfg, 'voice'), false, '前提：增强配置里没有 voice 键');
  assert.equal(Object.prototype.hasOwnProperty.call(clientCfg, 'correction'), false, '前提：增强配置里没有 correction 键');
  const out = await handlers.get('voice/correct')({ sessionId: 'r1', text: CORR_TEXT, config: clientCfg });
  assert.equal(seen.length, 1, '⭐ 磁盘面为开 ⇒ 必须走模型（若读随行 config 会误判成关 = 拆东墙）');
  assert.equal(out.skipped, undefined, '不得跳过');
  assert.equal(out.switchFrom, undefined, '走了真实路径 ⇒ 不带跳过标记');
});

test('GUARD-R2 ⭐ 同一产品形态下磁盘面为关 ⇒ 跳过，且 `switchFrom` 写明读的是 host 归一化面', async () => {
  const seen = [];
  const handlers = new Map();
  const harness = {
    handle: (m, f) => { if (typeof m === 'string' && typeof f === 'function') handlers.set(m, f); },
    readVoiceConfig: () => ({ correction: { enabled: false } }),
  };
  const ctx = { get: (n) => (n === 'llm' ? mockLlm(seen) : undefined), effect: () => {}, timer: { timeout: () => () => {} } };
  new Function('harness', BODY)(harness).apply(ctx);
  const out = await handlers.get('voice/correct')({ sessionId: 'r2', text: CORR_TEXT, config: {} });
  assert.equal(seen.length, 0, '磁盘面为关 ⇒ 0 次模型调用');
  assert.equal(out.skipped, true);
  assert.equal(out.switchFrom, 'host-normalized', '⭐ 必须点名"读的是服务端归一化面"（可判来源，不靠猜）');
});

test('GUARD-R3 磁盘面不可用（null）⇒ fail-closed 按关，且来源可见为 request-config 回退', async () => {
  const seen = [];
  const handlers = new Map();
  const harness = {
    handle: (m, f) => { if (typeof m === 'string' && typeof f === 'function') handlers.set(m, f); },
    readVoiceConfig: () => null,       // 读盘失败 / 未注入
  };
  const ctx = { get: (n) => (n === 'llm' ? mockLlm(seen) : undefined), effect: () => {}, timer: { timeout: () => () => {} } };
  new Function('harness', BODY)(harness).apply(ctx);
  const out = await handlers.get('voice/correct')({ sessionId: 'r3', text: CORR_TEXT, config: { correction: { enabled: false } } });
  assert.equal(seen.length, 0, '磁盘面缺位 ⇒ fail-closed（按关）');
  assert.equal(out.skipped, true);
  assert.equal(out.switchFrom, 'request-config', '来源须可见：说明这是回退路径');
});

test('GUARD-R4 ⭐ 装配面自洽：harness.readVoiceConfig 复用既有 readConfig + 归一化面（不新造第二份）', () => {
  // ⚠ 装配位置订正（本批实测）：接线落在 `lib/harness.cjs` 而非 `lib/index.cjs` ——
  //   因为 `D-1` 是**正本行数读数锁**（`lib/index.cjs` = 114 行），在 index 里加行会把读数顶红。
  //   本用例随之锚到真实装配位置（判据强度不变：仍逐条断言"复用了既有函数、没造第二份"）。
  const hs = fs.readFileSync(path.join(ROOT, 'lib', 'harness.cjs'), 'utf8');
  assert.ok(/readVoiceConfig:\s*\(\)\s*=>\s*\{/.test(hs), 'harness facade 须暴露 readVoiceConfig');
  assert.ok(/require\('\.\/rpc-config\.cjs'\)\.readConfig\(\)/.test(hs),
    '⭐ 读取须复用既有 rpc-config.readConfig（不新造磁盘读取）');
  assert.ok(/require\('\.\/asr\.cjs'\)\.readNormalizedVoiceCfg\(raw\)/.test(hs),
    '⭐ 归一化须复用既有 asr.readNormalizedVoiceCfg（= sanitizeVoiceCfg(voiceCfgOf(cfg))，不新造白名单/下钻）');
  assert.ok(/catch \(e\) \{ return null; \}/.test(hs), 'readVoiceConfig 须 fail-closed（抛错即 null）');
  // 反向：harness.cjs **不得**自行解析 voice 配置（禁止第二份实现，M-3）
  assert.equal(/correction\s*&&\s*[a-z]/.test(hs), false, 'harness.cjs 不得自造取形（那是第二份实现 —— 只许接线）');
  assert.equal(/enabled\s*===\s*true/.test(hs), false, 'harness.cjs 不得自造取形（enabled === true 只许在 asr 白名单内）');
  // 正向对照：归一化实现确实在 asr 里（防"两边都没有"的假绿）
  const asr = fs.readFileSync(path.join(ROOT, 'lib', 'asr.cjs'), 'utf8');
  assert.ok(/function readNormalizedVoiceCfg\(cfg\)/.test(asr), 'asr 须有 readNormalizedVoiceCfg');
  assert.ok(/sanitizeVoiceCfg\(voiceCfgOf\(cfg\)\)/.test(asr), '⭐ 它须走 sanitizeVoiceCfg(voiceCfgOf(cfg)) 这条既有路径（与 status() 同源）');
});

// ───────────── ⑥ 变异自证 + 负控（对**内存**变异，不改磁盘） ─────────────
// 变异①：把守卫整段去掉 ⇒ 关掉开关时模型**会**被调用 ⇒ GUARD-C1 的判据必须翻转。
//   ⚠ 根因确认：这正是复核批实测到的形态（关掉开关仍走模型 = 守卫不存在）。
test('GUARD-V1 ⭐ 变异自证①：去掉守卫（内存变异真实 bundle）⇒ 关闭态**必调模型**（判据必红）', async () => {
  const GUARDED = BODY;
  // 变异：删掉守卫那一段（从 `if (correctionEnabledOf(...` 到其 `}` 结束的分支）
  const startMark = '      const corrSwitch = resolveCorrectionSwitch(args && args.config);';
  const i = GUARDED.indexOf(startMark);
  assert.ok(i > 0, '变异锚点必须在 bundle 内（否则变异无效 ⇒ 本自证无判别力）');
  const endMark = '\n      }\n      const chain = buildTryChain(cfg.fallback);';
  const j = GUARDED.indexOf(endMark, i);
  assert.ok(j > i, '变异锚点结束位置必须找到');
  const mutated = GUARDED.slice(0, i) + '      // [MUTANT-V1] 守卫已删除（不判开关）' + GUARDED.slice(j + 2);

  const run = async (body) => {
    const seen = [];
    const handlers = new Map();
    const harness = { handle: (m, f) => { if (typeof m === 'string' && typeof f === 'function') handlers.set(m, f); } };
    const ctx = { get: (n) => (n === 'llm' ? mockLlm(seen) : undefined), effect: () => {}, timer: { timeout: () => () => {} } };
    new Function('harness', body)(harness).apply(ctx);
    const out = await handlers.get('voice/correct')({ sessionId: 'v1', text: CORR_TEXT, config: cfgWith({ enabled: false }) });
    return { seen: seen.length, out };
  };
  const guarded = await run(GUARDED);
  const bare = await run(mutated);
  // 正例（守卫在位）：0 调用
  assert.equal(guarded.seen, 0, '前提：守卫在位 ⇒ 0 次模型调用');
  // 变异体：必红 —— 关掉开关仍打了模型（= 复核批实测形态，根因确认）
  assert.equal(bare.seen, 1, '⭐ 变异①（去守卫）⇒ 关闭态**必须**走到模型（1 次）—— 判据翻转 = 本自证有效');
  assert.equal(bare.out.skipped, undefined, '变异体不得再带跳过标记（病历形态复现）');
});

// 变异②：把取形改成 `!== false`（缺省被读成开）⇒ GUARD-C4/C5 的判据必须翻转。
//   ⚠ 变异必须**覆盖全部分支**（含"键整体缺位"的兜底返回 `true`）：只改一句
//     `top.enabled !== false` 时，`correction` 键整体缺失会先落到外层 `typeof` 判断之外
//     ⇒ **不翻转**（本席第一版就栽在这：变异没生效却当成"判据无判别力"）。
//     这里按 `!== false` 的**完整语义**做变异 = 缺省/非法一律读成开（与真实误写同形）。
test('GUARD-V2 ⭐ 变异自证②：取形改 `!== false` ⇒ 缺省态**必调模型**（判据必红）', async () => {
  const ORIG = BODY;
  const FROM = `      const top = c.correction;
      if (top && typeof top === 'object') return top.enabled === true;
      const v = c.voice;
      if (v && typeof v === 'object' && v.correction && typeof v.correction === 'object') return v.correction.enabled === true;
      return false;                               // 缺省 = 关（与两侧白名单同口径）`;
  const TO = `      const top = c.correction;
      if (top && typeof top === 'object') return top.enabled !== false;   // [MUTANT-V2] !== false
      const v = c.voice;
      if (v && typeof v === 'object' && v.correction && typeof v.correction === 'object') return v.correction.enabled !== false;   // [MUTANT-V2]
      return true;                                // [MUTANT-V2] 缺省被读成开`;
  assert.ok(ORIG.indexOf(FROM) > 0, '变异锚点必须在 bundle 内（否则变异无效 ⇒ 本自证无判别力）');
  const mutated = ORIG.replace(FROM, TO);
  assert.notEqual(mutated, ORIG, '变异必须生效');

  const run = async (body, cfg) => {
    const seen = [];
    const handlers = new Map();
    const harness = { handle: (m, f) => { if (typeof m === 'string' && typeof f === 'function') handlers.set(m, f); } };
    const ctx = { get: (n) => (n === 'llm' ? mockLlm(seen) : undefined), effect: () => {}, timer: { timeout: () => () => {} } };
    new Function('harness', body)(harness).apply(ctx);
    const out = await handlers.get('voice/correct')({ sessionId: 'v2', text: CORR_TEXT, config: cfg });
    return { seen: seen.length, out };
  };
  // 两个"缺省"形态都要翻：① `correction` 键整体缺位 ② `correction.enabled` 缺位
  for (const [label, cfg] of [['correction 键缺位', cfgWith(undefined)], ['correction.enabled 缺位', cfgWith({})]]) {
    const okRun = await run(ORIG, cfg);
    assert.equal(okRun.seen, 0, '前提：正常实现在 ' + label + ' ⇒ 0 次调用');
    assert.equal(okRun.out.skipped, true, '前提：正常实现 ' + label + ' ⇒ 跳过可见');
    const badRun = await run(mutated, cfg);
    assert.equal(badRun.seen, 1, '⭐ 变异②（!== false）· ' + label + ' ⇒ **必须**被读成开并走模型 —— 判据翻转 = 本自证有效');
    assert.equal(badRun.out.skipped, undefined, '变异体不再跳过（' + label + ' 被当成开）');
  }
});

// 负控：不动任何东西 ⇒ 全套判据必绿（防"自证装置本身坏了也报红/报绿"）
test('GUARD-V3 负控：不改任何东西 ⇒ 关闭态 0 调用且可判、打开态 1 调用（全绿）', async () => {
  const seenOff = [];
  const { handlers: hOff } = boot({ llm: mockLlm(seenOff) });
  const off = await hOff.get('voice/correct')({ sessionId: 'v3a', text: CORR_TEXT, config: cfgWith({ enabled: false }) });
  assert.equal(seenOff.length, 0, '负控：关闭态 0 调用');
  assert.equal(off.skipped, true, '负控：关闭态可判');
  const seenOn = [];
  const { handlers: hOn } = boot({ llm: mockLlm(seenOn) });
  const on = await hOn.get('voice/correct')({ sessionId: 'v3b', text: CORR_TEXT, config: cfgWith({ enabled: true }) });
  assert.equal(seenOn.length, 1, '负控：打开态 1 调用');
  assert.equal(on.skipped, undefined, '负控：打开态不带跳过标记');
});

// ───────────── ⑦ ⭐ 行为级接线验证（补上 R4 的盲区：源码文本匹配挡不住"接线被切断"） ─────────────
// 病历（本批自查 · 变异 M3 实测）：把 `lib/index.cjs` 的 `voiceConfig` 工厂改成返回 `null`
//   （= 接线切断，但源码文本仍在）⇒ 上面 R4 仍**全绿**，本文件其余用例也全绿 ——
//   因为它们直接求值 bundle，绕过了真实入口。⇒ 本组用例**走真实 `lib/index.cjs` 装配**，
//   以"真实 handler 是否真的读到磁盘开关"为判据。⚠ 用**临时 DSH_HOME**（子进程内设 env，
//   因 `rpc-config.cjs` 的 CONFIG_FILE 在模块加载期求值），不碰用户真实配置。
test('GUARD-E1 ⭐ 行为级：真实入口 + 真实磁盘配置，开关 false ⇒ 0 调用且跳过；true ⇒ 1 调用', () => {
  const fsx = require('node:fs');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const home = fsx.mkdtempSync(path.join(os.tmpdir(), 'cg-e1-'));
  const CFG = path.join(home, 'dsh-prompt-enhancer.config.json');
  const seed = { version: 2, fallback: [{ provider: 'p', model: 'm' }], params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 }, voice: { correction: { enabled: false } } };
  fsx.writeFileSync(CFG, JSON.stringify(seed), 'utf8');

  const DRIVER = `
    (async () => {
      const fs = require('node:fs'); const path = require('node:path');
      const ROOT = process.cwd();
      const CFG = process.env.__CG_CFG;
      const seen = [];
      const LLM = { stream(p) { seen.push(p); return { [Symbol.asyncIterator]() { const steps = [
        { done: false, value: { type: 'text-delta', text: '纠正后的文字' } },
        { done: false, value: { type: 'finish', reason: { kind: 'stop' } } },
        { done: true, value: undefined }]; let i = 0;
        return { async next() { return steps[Math.min(i++, 2)]; }, async return() { return { done: true, value: undefined }; } }; } }; } };
      const indexMod = require(path.join(ROOT, 'lib', 'index.cjs'));
      let captured = null;
      const webServer = { register: (r) => { captured = r; } };
      const hostCtx = { effect: (fn) => { if (typeof fn === 'function') fn(); }, get: (k) => (k === 'webServer' ? webServer : undefined) };
      const TIMER = { timeout: () => () => {}, interval: () => () => {} };
      const ctx = { inject: (d, cb) => cb(hostCtx), effect: () => {}, timer: TIMER,
        get: (k) => (k === 'webServer' ? webServer : (k === 'llm' ? LLM : undefined)) };
      indexMod.apply(ctx);
      const { EventEmitter } = require('node:events');
      const call = (sessionId) => new Promise((resolve) => {
        const args = { sessionId, text: '这各功能很好用', config: { version: 2, fallback: [{ provider: 'p', model: 'm' }], params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 } } };
        const req = new EventEmitter(); req.method = 'POST'; req.headers = { host: '127.0.0.1:3080' }; req.destroy = () => {};
        process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify({ method: 'voice/correct', args }))); req.emit('end'); });
        const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { resolve({ status: this.code, body: JSON.parse(String(b)) }); } };
        captured.handler(req, res);
      });
      const setCorr = (on) => {
        const j = JSON.parse(fs.readFileSync(CFG, 'utf8'));
        j.voice = Object.assign({}, j.voice || {}, { correction: { enabled: on === true } });
        fs.writeFileSync(CFG, JSON.stringify(j), 'utf8');
      };
      const out = {};
      setCorr(false);
      const b1 = seen.length;
      const r1 = await call('e1-off');
      out.off = { body: r1.body, calls: seen.length - b1 };
      setCorr(true);
      const b2 = seen.length;
      const r2 = await call('e1-on');
      out.on = { body: r2.body, calls: seen.length - b2 };
      console.log(JSON.stringify(out));
    })().catch((e) => { console.log(JSON.stringify({ error: String((e && e.stack) || e) })); });
  `;
  let out;
  try {
    const r = spawnSync(process.execPath, ['-e', DRIVER], {
      cwd: ROOT, encoding: 'utf8', timeout: 120000,
      env: Object.assign({}, process.env, { DSH_HOME: home, __CG_CFG: CFG }),
    });
    const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
    assert.ok(line, '子进程无输出（stderr: ' + String(r.stderr || '').slice(0, 400) + '）');
    out = JSON.parse(line);
  } finally {
    try { fsx.rmSync(home, { recursive: true, force: true }); } catch {}
  }
  assert.ok(!out.error, '子进程抛错: ' + out.error);
  // ⭐ 关：真实入口必须真的读到磁盘开关 ⇒ 0 调用 + 跳过可见 + 来源是 host 归一化面
  assert.equal(out.off.calls, 0, '⭐ 真实入口下：开关 false ⇒ 必须 0 次模型调用（接线断了就会走到模型）');
  assert.equal(out.off.body.skipped, true, '真实入口下须可见跳过');
  assert.equal(out.off.body.switchFrom, 'host-normalized', '⭐ 来源必须是 host 归一化面（接线被切断时会退化成 request-config 或直接开跑）');
  // ⭐ 开：同一形态下必须真的走模型（防"永久关死"这种拆东墙）
  assert.equal(out.on.calls, 1, '⭐ 真实入口下：开关 true ⇒ 必须 1 次模型调用（读错源会误关）');
  assert.equal(out.on.body.skipped, undefined, '开关 true 时不得跳过');
  assert.equal(out.on.body.changed, true, '开关 true 时给真实结果');
});
