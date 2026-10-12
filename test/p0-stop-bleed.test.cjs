'use strict';
// P0 止血专项回归（2026-10-12）：把本轮五项修复的**判据**固化下来——
//   P0-a 补退避重试（providerRetryPolicy 驱动；首轮流失败/次流成功）
//   P0-b 主超时预算覆盖准备阶段（计时器上移；辅助调用并入同一预算）
//   P0-c 看门狗按实测 TTFT 重算 + 探针短化 + 缓存
//   P0-d 辅助调用降级可见（progress.degraded / result.degraded）
//   P0-e max-tokens 截断不再误报 EMPTY_RESPONSE（可区分 kind + 真实文案 + 6 消费点一致）
//
// 夹具口径与 test/bundle-smoke.test.cjs 一致：用 new Function('harness', BODY) 求值
// 生成物 plugin-host.js（即被测的就是被发布的同一份实现，单一事实源）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');

function boot(opts) {
  const o = opts || {};
  const handlers = new Map();
  const harness = {
    handle(method, fn) {
      if (typeof method === 'string' && typeof fn === 'function') handlers.set(method, fn);
    },
    probeEnv() { return null; },
  };
  const ctx = {
    get: (name) => {
      if (name === 'llm' && o.llm) return o.llm;
      if (name === 'sessionQuery' && o.sessionQuery) return o.sessionQuery;
      if (name === 'sandboxPolicy' && o.sandboxPolicy) return o.sandboxPolicy;
      if (name === 'fs' && o.fs) return o.fs;
      return undefined;
    },
    effect: () => {},
    timer: o.timer ? o.timer : { timeout: () => () => {} },
  };
  const plugin = new Function('harness', BODY)(harness);
  if (typeof plugin.apply !== 'function') throw new Error('plugin.apply missing from bundle');
  plugin.apply(ctx);
  return { handlers };
}

// 真实定时器（同 bundle-smoke）：退避/看门狗用例需要真实等待。
const REAL_TIMER = { timeout: (cb, ms) => { const id = setTimeout(cb, ms); return () => clearTimeout(id); } };

// ⚠ 边界（2026-10-12 第三轮 · 独立复核的泄漏项，如实注明，勿读作「已完全释放」）：
// `startHelperAbort.dispose()/闸门` 会调用 `iterator.return()`（实测 return() 确被调用 2 次），
// 但 `collectStream` 对**已经被中止**的流**没有中止感知**——它是一个纯 `while(true) next()` 循环。
// 实测两种假流形态：
//   · 规范流（next() 尊重 return()，见 slowHelperLlm 生成流的 returned 检查）：return() 后
//     **不再产生任何 next()**（nextAfterReturn=0）；
//   · 仓库常见的「手写迭代器」假流（in-flight 的 next() 无视 return() 仍返回一个值）：
//     collectStream 会因而**多发 1 次 next()**（nextAfterReturn=1）才看到 done。
// ⇒ 该「多拉一次」的**根因在假流形态**（是否遵守 AsyncIterator 的 return() 语义），
//   实现侧仅余「孤儿 collectStream 仍会驱动一次」这一无害残量（计时器已清、iterator.return 已调用，
//   不构成定时器/句柄泄漏）。本文件内的夹具一律采用**规范流形态**，故本测试不依赖该残量。

// P0-b 行为判据专用：**非等比**缩放定时器——只缩短墙钟等待，**不是**「时序关系逐项守恒」。
// ⚠ 2026-10-12 第三轮订正（独立复核实测）：原注释称「等比缩放（1/50）…判据强度不变」**不成立**。
//   缩放同时施加于「插件侧 ctx.timer」与「假 llm 的 sleep」，但两者是**不同的轴**：
//     · 插件侧计时器（prepareBudget / helperTimeout / 主预算）≈ 常量 → 缩放后退化为**毫秒**；
//     · 假 llm 的耗时按 1/50 缩放 → 变短后**相对**那些常量计时器更短。
//   于是「辅助自然耗时 22000 vs 钳后超时 10000」这类**同轴**关系守恒（#21/#22 不受影响），
//   而「prepare + 生成 24500 vs 主预算 23000」这类**跨轴**关系**不守恒**——
//   缩放后 prepare 吃 440ms，主预算 460ms 到点，但生成只需 50ms ⇒ 490ms 就完成、通过，
//   于是**未真正中止的旧行为也能通过**（#23 曾因此假绿）。#21 不含 genMs（生成即时完成）
//   故落在同轴关系上，仍有牙。
//   现 #23 另加两条约束使其在缩放时基下亦不失真：① 参见 slowHelperLlm，生成流的 return()
//   **真正生效**；② 断言对「生成被调用且结果正确」与「未越过钳后超时」同时成立。
//   若将来该轴再引入新的跨轴比较，**必须改回真实时基**（REAL_TIMER + 不缩放 sleep）。
const P0B_SCALE = 50;
const scaledDelay = (ms) => Math.max(1, Math.round(Number(ms) / P0B_SCALE));
const FAST_TIMER = { timeout: (cb, ms) => { const id = setTimeout(cb, scaledDelay(ms)); return () => clearTimeout(id); } };

function streamOf(chunks) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() { return i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }; },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// P0-e：collectStream 显式处理 finish.kind === 'max-tokens'
// （判据 P0-5：可区分 kind / 真实文案 / 6 消费点行为一致）
// 直接从产物 PURE 区段切片求值，验证的就是被发布的同一份 collectStream。
// ---------------------------------------------------------------------------
const src = BODY;
const begin = src.indexOf('// ==PURE-BEGIN==');
const end = src.indexOf('// ==PURE-END==');
assert.ok(begin !== -1 && end > begin, 'PURE markers not found in plugin-host.js');
const pureText = src.slice(begin, end);
const grabConst = (name) => {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('const ' + name + ' not found');
  return name + ' = ' + m[1] + ';';
};
const defaultsBlock = [grabConst('DEFAULT_TIMEOUT_MS'), grabConst('DEFAULT_MAX_TOKENS'), grabConst('DEFAULT_OUTPUT_LIMIT')].join('\n');
const pureFn = new Function(defaultsBlock + '\n' + pureText + `
  ;return { collectStream, friendlyMessage, computeBackoffDelayMs, isRetryableFailure,
    resolveEnhanceTimeoutMs, resolvePrepareBudgetMs, WATCHDOG_TIMEOUT_MS, WATCHDOG_TTFT_MAX_MEASURED_MS, PROBE_CACHE_TTL_MS };
`);
const {
  collectStream, friendlyMessage, computeBackoffDelayMs, isRetryableFailure,
  resolveEnhanceTimeoutMs, resolvePrepareBudgetMs, WATCHDOG_TIMEOUT_MS, WATCHDOG_TTFT_MAX_MEASURED_MS, PROBE_CACHE_TTL_MS,
} = pureFn();

test('P0-5① max-tokens finish 返回可区分 kind（不再落 EMPTY_RESPONSE 兜底）', async () => {
  const r = await collectStream(streamOf([
    { type: 'text-delta', text: '一段被长度上限截断的输出' },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])[Symbol.asyncIterator](), 8000);
  assert.equal(r.kind, 'maxtokens', 'kind 必须可区分（不是 ok，也不是 error/EMPTY_RESPONSE）');
  assert.notEqual(r.kind, 'error');
  assert.equal(r.text, '一段被长度上限截断的输出', '已收文本必须保留');
  assert.ok(r.failure && r.failure.code === 'OUTPUT_TRUNCATED', 'failure 码须真实：' + JSON.stringify(r.failure));
});

test('P0-5② friendlyMessage 对截断给出真实文案（不再是 empty response）', () => {
  const msg = friendlyMessage({ code: 'OUTPUT_TRUNCATED' });
  assert.ok(!/empty response/i.test(msg), '截断文案不得再是 empty response，实际：' + msg);
  assert.ok(/length limit/i.test(msg) && /truncat/i.test(msg), '文案须说明「达到长度上限被截断」：' + msg);
});

test('P0-5③ 6 个消费点行为一致：主生成采纳截断文本 / 5 个辅助点显式降级（不静默沿用旧兜底）', async () => {
  // 站点清单（产物行号，2026-10-12 实测）：2616 / 3729 / 3769 / 3927 / 3965 / 4227
  const sites = src.match(/collectStream\(/g) || [];
  assert.ok(sites.length >= 6, '至少 6 个 collectStream 调用点，实际 ' + sites.length);
  // 5 个辅助点必须显式声明截断（'maxtokens' 分支或 -truncated 降级键），
  // 主生成点必须显式识别 maxtokens 并给出 OUTPUT_TRUNCATED 兜底。
  assert.ok(src.includes("result.kind === 'maxtokens'"), '主生成点缺 maxtokens 显式分支');
  assert.ok(src.includes("code: 'OUTPUT_TRUNCATED'"), '主生成点缺 OUTPUT_TRUNCATED 兜底码');
  const truncatedKeys = src.match(/-truncated'/g) || [];
  assert.ok(truncatedKeys.length >= 4, '辅助点须显式声明截断降级（-truncated），实际 ' + truncatedKeys.length);
  // 主生成点：截断但有文本 → 采纳为结果（truncated: true）
  const llm = {
    stream(params) {
      return streamOf([
        { type: 'text-delta', text: '截断但可用的长草稿' },
        { type: 'finish', reason: { kind: 'max-tokens' } },
      ]);
    },
  };
  const { handlers } = boot({ llm, timer: REAL_TIMER });
  const out = await handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'base', fallback: [{ provider: 'p', model: 'm' }], params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  assert.equal(out.ok, true, '截断但有文本 → 须采纳结果而非报错：' + JSON.stringify(out));
  assert.equal(out.text, '截断但可用的长草稿');
  assert.equal(out.truncated, true, '结果须带截断标记');
});

test('P0-e×P0-a 联动：即使策略把 OUTPUT_TRUNCATED 列为可重试码，「有文本的截断」也不得重试', async () => {
  // 截断是确定性结果（同 maxTokens 重试必然再截断）——重试只会白耗预算。
  // 判据：策略声称可重试 OUTPUT_TRUNCATED，但「有文本」时 stream 只能被调用 1 次。
  let withTextCalls = 0;
  const llmWithText = {
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 3, retryableCodes: ['OUTPUT_TRUNCATED'], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }; },
    stream() { withTextCalls += 1; return streamOf([{ type: 'text-delta', text: '截断内容' }, { type: 'finish', reason: { kind: 'max-tokens' } }]); },
  };
  const b1 = boot({ llm: llmWithText, timer: REAL_TIMER });
  const out1 = await b1.handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'base', fallback: [{ provider: 'p', model: 'm' }], params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  assert.equal(out1.ok, true, '有文本的截断须采纳：' + JSON.stringify(out1));
  assert.equal(out1.truncated, true);
  assert.equal(withTextCalls, 1, '有文本的截断不得重试（实际 stream 调用 ' + withTextCalls + ' 次）');

  // 对照：无文本的纯截断（思考吃满预算）→ 允许按策略重试，耗尽后如实报 OUTPUT_TRUNCATED
  let emptyCalls = 0;
  const llmEmpty = {
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 1, retryableCodes: ['OUTPUT_TRUNCATED'], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }; },
    stream() { emptyCalls += 1; return streamOf([{ type: 'finish', reason: { kind: 'max-tokens' } }]); },
  };
  const b2 = boot({ llm: llmEmpty, timer: REAL_TIMER });
  const out2 = await b2.handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'base', fallback: [{ provider: 'p', model: 'm' }], params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  assert.equal(out2.ok, false, '纯截断（无文本）仍失败：' + JSON.stringify(out2));
  assert.equal(out2.code, 'OUTPUT_TRUNCATED', '失败码须真实：' + JSON.stringify(out2));
  assert.ok(!/empty response/i.test(out2.message || ''), '文案不得是 empty response：' + out2.message);
  assert.ok(emptyCalls >= 2, '无文本截断允许按策略重试（实际 ' + emptyCalls + ' 次）');
});

// ---------------------------------------------------------------------------
// P0-a：按官方 providerRetryPolicy 的退避重试（首轮流失败、次流成功）
// ---------------------------------------------------------------------------
test('P0-4 首轮流失败 + 次流成功：补退避重试后成功（且退避参数来自 providerRetryPolicy）', async () => {
  const seen = [];
  let streamCalls = 0;
  const llm = {
    // 策略由 provider 提供（不硬编码）：两次重试上限、可重试码含 EMPTY_RESPONSE、退避 1ms
    providerRetryPolicy(provider) {
      assert.equal(provider, 'p');
      return {
        mode: 'normal',
        maxRetries: 2,
        retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
        initialDelayMs: 1,
        maxDelayMs: 2,
        jitterRatio: 0,
      };
    },
    stream(params) {
      seen.push(params);
      streamCalls += 1;
      if (streamCalls === 1) {
        // 首轮：流本身失败（官方可重试码之一）
        return streamOf([{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'rate limited' } } }]);
      }
      // 次轮：成功
      return streamOf([
        { type: 'text-delta', text: 'RETRY-OK' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]);
    },
  };
  const { handlers } = boot({ llm, timer: REAL_TIMER });
  const out = await handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'base', fallback: [{ provider: 'p', model: 'm' }], params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  assert.equal(out.ok, true, '补退避后应成功：' + JSON.stringify(out));
  assert.equal(out.text, 'RETRY-OK');
  assert.ok(streamCalls >= 2, '必须真的重试了同一条模型（实际调用 ' + streamCalls + ' 次）');
  const logs = await handlers.get('logs/last')();
  assert.ok(logs.lines.some((l) => /\[enhance\] retry attempt=1/.test(l)), '须留下重试日志（可观测）');
});

test('P0-4b 修复前行为对照：无可重试策略（旧宿主形态）→ 失败且不重试', async () => {
  let calls = 0;
  const llm = {
    // 无 providerRetryPolicy（旧宿主 / 服务缺该 API）
    stream() {
      calls += 1;
      return streamOf([{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'rate limited' } } }]);
    },
  };
  const { handlers } = boot({ llm, timer: REAL_TIMER });
  const out = await handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'base', fallback: [{ provider: 'p', model: 'm' }], params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  assert.equal(out.ok, false, '无可重试策略时保持「只尝试一次」的原语义（零回归）');
  assert.equal(out.code, 'RATE_LIMIT', '失败码须如实透传：' + JSON.stringify(out));
  // 独立复审 low（2026-10-12）：原断言用 calls <= 2 计配额，把**既有**链级重试（pass 0 → 整链重试一次）
  // 也算进来——将来链级轮次一调，这条会以「退避重试回归」的名义误报，指向错误位置。
  // 改为直接断言行为：无策略时**不得出现 P0-a 的退避重试日志**。
  const logs = await handlers.get('logs/last')();
  assert.ok(!logs.lines.some((l) => /\[enhance\] retry attempt=/.test(l)),
    '无策略时不得触发 P0-a 退避重试（日志中不应有 retry attempt）');
  assert.ok(!logs.lines.some((l) => /\[enhance\] retry skipped/.test(l)), '无策略时不应进入重试判定');
});

test('P0-a 纯函数：退避公式与官方 localDelay 一致 + 可重试码从策略取', () => {
  const backoff = { initialDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 };
  assert.equal(computeBackoffDelayMs(backoff, 1, () => 0.5), 100, 'retry=1 → initial');
  assert.equal(computeBackoffDelayMs(backoff, 2, () => 0.5), 200, 'retry=2 → initial*2');
  assert.equal(computeBackoffDelayMs(backoff, 4, () => 0.5), 800, 'retry=4 → initial*8');
  assert.equal(computeBackoffDelayMs(backoff, 5, () => 0.5), 1000, '封顶 maxDelayMs');
  assert.equal(computeBackoffDelayMs(backoff, 1, () => 1), 100, 'jitterRatio=0 → 无抖动');
  const jb = { initialDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0.5 };
  assert.equal(computeBackoffDelayMs(jb, 1, () => 0), 50, 'jitterRatio=0.5, rand=0 → 0.5x');
  assert.equal(computeBackoffDelayMs(jb, 1, () => 1), 150, 'jitterRatio=0.5, rand=1 → 1.5x');
  // 可重试码：normal 模式只认策略码集；always 一律可重试
  const normal = { mode: 'normal', maxRetries: 1, retryableCodes: ['RATE_LIMIT'] };
  assert.equal(isRetryableFailure(normal, { code: 'RATE_LIMIT' }), true);
  assert.equal(isRetryableFailure(normal, { code: 'QUOTA' }), false, '不在策略码集 → 不重试');
  assert.equal(isRetryableFailure({ mode: 'always' }, { code: 'QUOTA' }), true, 'always → 一律重试');
  assert.equal(isRetryableFailure(null, { code: 'RATE_LIMIT' }), false, '无策略 → 不重试');
  // ★ 独立复核 blocker 的回归锁：官方 ResolvedRetryPolicy 是**平铺**结构（实测
  //   resolveRetryPolicy(undefined) → {mode,maxRetries,retryableCodes,initialDelayMs:500,maxDelayMs:10000,jitterRatio:0.1}，
  //   无 backoff 子对象）。若实现回退读 policy.backoff.*，退避参数会恒落硬编码兜底（500/10000/0.1）。
  //   判据：把「平铺来源」与「仅嵌套 backoff」两种输入喂进纯函数，平铺必须生效、嵌套**不得**生效。
  const flat = { mode: 'normal', maxRetries: 2, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 };
  assert.equal(computeBackoffDelayMs(flat, 1, () => 0.5), 1, '平铺 initialDelayMs=1 必须生效（这是 blocker 的牙）');
  assert.equal(computeBackoffDelayMs(flat, 5, () => 0.5), 2, '平铺 maxDelayMs=2 必须生效');
  const nestedOnly = { mode: 'normal', maxRetries: 2, retryableCodes: ['RATE_LIMIT'], backoff: { initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 } };
  assert.equal(computeBackoffDelayMs(nestedOnly, 1, () => 0.5), 500, '仅嵌套 backoff（非官方 shape）→ 走防御兜底 500（证明读的是平铺字段）');
});

// ---------------------------------------------------------------------------
// P0-c：看门狗按实测 TTFT 重算 + 探针短化 + 缓存
// ---------------------------------------------------------------------------
test('P0-c 看门狗阈值可按实测 TTFT 复算（≥实测上界×2，且 < 默认主预算 30s）', () => {
  assert.ok(WATCHDOG_TTFT_MAX_MEASURED_MS >= 9300, '实测上界须来自自载读数（9.3s）');
  assert.ok(WATCHDOG_TIMEOUT_MS >= WATCHDOG_TTFT_MAX_MEASURED_MS * 2, '至少 2× 实测上界：' + WATCHDOG_TIMEOUT_MS);
  assert.ok(WATCHDOG_TIMEOUT_MS < 30000, '必须小于默认主预算 30s，否则看门狗永远晚于预算（等于失效）');
  assert.ok(PROBE_CACHE_TTL_MS >= 30000, '探针缓存 TTL 须延长以复用（旧 5s 会反复重探）');
});

test('P0-c 探针已短化：不再要求真写 ~800 词长文', () => {
  assert.ok(!src.includes('about 800 words'), '探针提示词不得再要求 800 词长文（成本反噬源）');
  assert.ok(src.includes('Reply with the single word OK'), '须改为短探针（TTFT 即结论）');
});

// ---------------------------------------------------------------------------
// P0-d：让降级可见（辅助调用失败 → UI 出口）
// ---------------------------------------------------------------------------
test('P0-d 辅助调用失败经 progress/result 暴露（用户侧可见，非仅环形日志）', async () => {
  // lite 模式：打开 rounds 检索，judgeRelevance 必被调用；让它超时失败 → 记降级
  const llm = {
    providerRetryPolicy() { return null; },
    stream(params) {
      // 判定调用（RELEVANCE_PROMPT 模板）：立即以失败 finish 结束（模拟「判定不可用」→ 记降级）
      if (/会话关联性判定器/.test(String(params.system || ''))) {
        return streamOf([{ type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'judge unavailable' } } }]);
      }
      return streamOf([{ type: 'text-delta', text: 'OK' }, { type: 'finish', reason: { kind: 'stop' } }]);
    },
  };
  const events = [
    { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '第一轮需求' }] } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '第一轮答复' }] } } },
  ];
  const sessionQuery = {
    // fetchSessionHistory 前置校验要求 listEvents+filterEvents 同时存在（否则直接 return []）
    readSurface: async () => ({ session: { id: 's' }, capturedThroughSeq: 2, events }),
    listEvents: async () => events.map((e) => ({ type: e.type, seq: e.seq })),
    filterEvents: async () => events,
  };
  const { handlers } = boot({ llm, sessionQuery, timer: REAL_TIMER });
  const p = handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'lite', fallback: [{ provider: 'p', model: 'm' }], context: { budgetChars: 2000 }, params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  // 并发轮询 progress —— 抓取「进行中」暴露过的 degraded（判定调用被钳到剩余预算后超时 → 记降级）
  let progressSeen = null;
  const poll = (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const r = await handlers.get('enhance/progress')({ sessionId: 's', seq: 1 }).catch(() => null);
      if (r && r.ok && Array.isArray(r.degraded) && r.degraded.length > 0) { progressSeen = r.degraded; return; }
      if (r && r.ok !== true) return; // 记录已被清理 → 结束轮询
      await new Promise((res) => setTimeout(res, 100));
    }
  })();
  const out = await p;
  await poll;
  assert.ok(out && typeof out === 'object', 'enhance 须有返回');
  // 判据：降级必须经 UI 出口（progress.degraded 或 result.degraded）暴露
  const resultDegraded = Array.isArray(out.degraded) ? out.degraded : [];
  assert.ok(progressSeen !== null || resultDegraded.length > 0,
    '辅助调用失败必须经 UI 暴露（progress.degraded 或 result.degraded），实际 progress=' + JSON.stringify(progressSeen) + ' result=' + JSON.stringify(out));
  if (resultDegraded.length > 0) {
    assert.ok(resultDegraded.some((k) => /relevance/.test(k)), '降级键须可定位来源：' + JSON.stringify(resultDegraded));
  }
});

test('P0-d client 出口存在：enhance/progress 返回 degraded 字段 + 产物含降级文案键', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.cjs'), 'utf8');
  assert.ok(client.includes('degradedPrefix'), 'client 产物缺降级提示键');
  assert.ok(client.includes('errOUTPUT_TRUNCATED'), 'client 产物缺截断真实文案键');
  assert.ok(src.includes('degraded: Array.isArray(rec.degraded)'), 'host enhance/progress 须暴露 degraded');
});

// ---------------------------------------------------------------------------
// P0-b：主超时预算覆盖准备阶段（计时器在 analyze 之前挂）
// ---------------------------------------------------------------------------
test('P0-b 主超时计时器上移到准备阶段之前，且生成额度不被准备阶段侵蚀（独立复核 high 的回归锁）', () => {
  const iGen = src.indexOf('const genTimeoutMs = resolveEnhanceTimeoutMs(');
  const iPrep = src.indexOf('const prepareBudgetMs = resolvePrepareBudgetMs(');
  const iTotal = src.indexOf('const totalBudgetMs = genTimeoutMs > 0 ? genTimeoutMs + prepareBudgetMs : 0;');
  const iTimer = src.indexOf('const timeoutDisposer = totalBudgetMs > 0 ? ctx.timer.timeout(');
  const iAnalyze = src.indexOf("await runEnhanceStages('analyze', state)");
  assert.ok(iGen > 0 && iPrep > 0 && iTotal > 0 && iTimer > 0 && iAnalyze > 0, '五处锚点须都在产物中');
  assert.ok(iGen < iTimer && iPrep < iTimer, '预算计算须在计时器之前');
  assert.ok(iTimer < iAnalyze, '计时器须在 analyze（准备阶段）**之前**挂上——这是本条的核心判据');
  // 关键：总预算 = 生成额度 + 准备额度 —— 准备阶段有界，但生成阶段仍拿满原 timeoutMs
  // （复核实测过「prepare 2s + generation 5s / timeout 6s」在旧实现下被拆东墙判超时）
  assert.ok(src.includes('state.budgetMs = genTimeoutMs;'), '生成额度须与 log/语义分离保存');
  assert.ok(src.includes('state.budgetDeadline = totalBudgetMs > 0 ? Date.now() + totalBudgetMs : null;'), '预算截止须用总预算');
  assert.ok(src.includes('function resolvePrepareBudgetMs(row, sources, T)'), '缺准备预算纯函数');
  // 预算公式单一事实源：analyze 与 handler 共用 resolveEnhanceTimeoutMs
  assert.ok(src.includes('function resolveEnhanceTimeoutMs(cfg, chain)'), '缺预算公式纯函数');
  assert.equal(src.split('resolveEnhanceTimeoutMs(').length - 1 >= 3, true, '预算公式须被 analyze 与 handler 共用');
});

test('P0-b prepare 预算纯函数：可复算且不引用未初始化的 const（TDZ 回归锁）', () => {
  // 复核实测过的致命形态：RELEVANCE_TIMEOUT_MS 定义在 PURE 区段内较后位置，
  // 若 resolvePrepareBudgetMs 直接引用它 → const 暂时性死区 → enhance 请求挂起。
  // 判据一：函数体不得直接出现常量名，超时表一律由入参 T 提供。
  const start = src.indexOf('function resolvePrepareBudgetMs(row, sources, T)');
  const end = src.indexOf('function resolveEnhanceTimeoutMs(cfg, chain)');
  assert.ok(start > 0 && end > start, 'resolvePrepareBudgetMs 须存在且在 resolveEnhanceTimeoutMs 之前');
  const fnSrc = src.slice(start, end);
  for (const c of ['RELEVANCE_TIMEOUT_MS', 'V2_SEARCH_EVENTS_TIMEOUT_MS', 'V2_WORKSPACE_TIMEOUT_MS', 'V2_PROGRESS_TIMEOUT_MS', 'WEB_PLAN_TIMEOUT_MS', 'WEB_SEARCH_TIMEOUT_MS', 'WEB_SEARCH_MAX_RESULTS']) {
    assert.ok(fnSrc.indexOf(c) === -1, 'resolvePrepareBudgetMs 不得直接引用 ' + c + '（TDZ 风险）');
  }
  // 判据二：可复算（值来自入参 T）
  const T = { relevanceMs: 10000, eventsMs: 10000, workspaceMs: 2000, progressMs: 15000, webPlanMs: 10000, webSearchMs: 10000, webSearchMaxResults: 3 };
  assert.equal(resolvePrepareBudgetMs({ kind: 'rounds', windows: [[1, 1]] }, [], T), 20000, 'lite：events 10s + 1 窗口 10s');
  assert.equal(resolvePrepareBudgetMs({ kind: 'rounds', windows: [[1, 2], [3, 5], [6, 10]] }, [], T), 40000, 'standard：events 10s + 3 窗口 30s');
  assert.equal(resolvePrepareBudgetMs({ kind: 'rounds', windows: [[1, 1], [2, 3]] }, ['workspace'], T), 54000, 'smart：events 10 + 2 窗口 20 + intent/docs 20 + 2×ws 4 = 54s');
  assert.equal(resolvePrepareBudgetMs({ kind: 'v2' }, [], T), 67000, 'publish：progress 15 + events 10 + plan 10 + web 30 + ws 2 = 67s');
  assert.equal(resolvePrepareBudgetMs({ kind: 'none' }, [], T), 0, 'base/none：准备阶段无辅助 LLM 调用');
});

test('P0-b 辅助调用并入同一预算 + 超时真中断（钳到剩余预算 + 超预算跳过记降级）', () => {
  for (const marker of ['function helperTimeoutMs(state, baseMs)', 'function budgetExhausted(state)', 'function markDegraded(state, kind)']) {
    assert.ok(src.includes(marker), '缺预算/降级基建：' + marker);
  }
  // P0-b 修正：辅助超时须**真中断**（startHelperAbort 同时把超时钳到剩余预算）
  assert.ok(src.includes('function startHelperAbort(state, baseMs)'), '缺辅助真中断基建 startHelperAbort');
  assert.ok(src.includes('startHelperAbort(state, RELEVANCE_TIMEOUT_MS)'), 'judgeRelevance 超时须钳到剩余预算');
  assert.ok(src.includes('startHelperAbort(state, WEB_PLAN_TIMEOUT_MS)'), 'planWebSearch 超时须钳到剩余预算');
  // 每处须以 race 结算（不得 await 流自然结束）
  assert.ok(src.includes('abortCtl.race('), '辅助须以 race 结算，不得 await 流自然结束');
  // 5 处辅助调用点都须带 state（才能并入预算）
  assert.ok(src.includes('judgeRelevance(winText, text, chain0, state)'), 'judgeRelevance 调用点未并入预算');
  assert.ok(src.includes('judgeDevIntent(text, state.v2Block || \'\', chain0, state)'), 'judgeDevIntent 调用点未并入预算');
  assert.ok(src.includes('analyzeDocsRelevance(docsText, text, state.v2Block || \'\', chain0, state)'), 'analyzeDocsRelevance 调用点未并入预算');
  assert.ok(src.includes('planWebSearch(text, memoText, state.scenario, chain0, state)'), 'planWebSearch 调用点未并入预算');
  assert.ok(src.includes('budgetDeadline: state.budgetDeadline'), 'publish v2 管道未接预算截止时刻');
});

test('P0-b 预算公式与旧实现语义一致（含 reasoningEffort 放宽 / 0=无限制）', () => {
  assert.equal(resolveEnhanceTimeoutMs({ timeoutMs: 30000 }, []), 30000, '普通链 → 原值');
  assert.equal(resolveEnhanceTimeoutMs({ timeoutMs: 30000 }, [{ reasoningEffort: 'max' }]), 120000, '带 effort → ≥120s（旧语义）');
  assert.equal(resolveEnhanceTimeoutMs({ timeoutMs: 0 }, [{ reasoningEffort: 'max' }]), 0, '0 = 无限制不挂计时器');
  assert.equal(resolveEnhanceTimeoutMs({ timeoutMs: 200000 }, [{ reasoningEffort: 'max' }]), 200000, '已大于 120s → 取原值');
});

// ---------------------------------------------------------------------------
// 独立复核回修（2026-10-12）：把复核席 5 条 finding 的修复钉成判据
// ---------------------------------------------------------------------------
test('复核 high·P0-e：截断文本若仍带未闭合的指令包装，不得采纳（防覆盖用户草稿）', async () => {
  // 复核实测形态：模型回显「请优化以下提示词：\n"""\n<原文前半>」被 max-tokens 截断，
  // cleanOutput 因包装未闭合剥不掉 → 旧实现会把带包装残片当结果覆盖草稿（旧行为是报错、草稿保留）。
  const llm = {
    stream() {
      return streamOf([
        { type: 'text-delta', text: '请优化以下提示词：\n"""\n我想做一个卡牌游戏的排行榜功能，需要支持' },
        { type: 'finish', reason: { kind: 'max-tokens' } },
      ]);
    },
  };
  const { handlers } = boot({ llm, timer: REAL_TIMER });
  const out = await handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '我想做一个卡牌游戏的排行榜功能，需要支持战力排序、段位升降和赛季结算',
    config: { mode: 'base', fallback: [{ provider: 'p', model: 'm' }], params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  assert.equal(out.ok, false, '带未闭合包装的截断不得被采纳：' + JSON.stringify(out));
  assert.equal(out.code, 'OUTPUT_TRUNCATED', '须如实报截断：' + JSON.stringify(out));
  assert.ok(!/empty response/i.test(out.message || ''), '文案不得是 empty response');
  assert.ok(!String(out.text || '').includes('"""'), '结果不得含未闭合包装残片');

  // 对照：干净的截断（无包装残留）仍应被采纳（保住「长草稿不再被丢弃」的收益）
  const llmClean = {
    stream() {
      return streamOf([
        { type: 'text-delta', text: '这是一份足够长的、干净的被截断优化结果，可安全采纳作为草稿使用。' },
        { type: 'finish', reason: { kind: 'max-tokens' } },
      ]);
    },
  };
  const b2 = boot({ llm: llmClean, timer: REAL_TIMER });
  const out2 = await b2.handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'base', fallback: [{ provider: 'p', model: 'm' }], params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  assert.equal(out2.ok, true, '干净截断仍须采纳：' + JSON.stringify(out2));
  assert.equal(out2.truncated, true);
});

test('复核 medium·P0-d：第 5 个辅助点 v2ResolveProgress 的失败也经 UI 暴露（不再只写 hlog）', () => {
  // 判据：v2ResolveProgress 必须有 degrade 出口，且 handler 把 onDegrade 接进 services。
  assert.ok(src.includes('const degrade = (kind) => {'), 'v2ResolveProgress 缺 degrade 出口');
  assert.ok(src.includes("onDegrade: (kind) => { markDegraded(state, kind); }"), 'handler 未把 onDegrade 接进 services');
  // 出口形态含括号表达式（degrade(timedOut ? ...)），故按函数体内的 degrade( 调用计数
  const fnStart = src.indexOf('async function v2ResolveProgress');
  const fnEnd = src.indexOf('// 阶段 B：工作区文件检索', fnStart);
  const fnBody = src.slice(fnStart, fnEnd);
  // 定义处是 `const degrade = (kind)`（不含 `degrade(`），故 3 次 `degrade(` 即 3 个调用出口
  const calls = (fnBody.match(/degrade\(/g) || []).length;
  assert.ok(calls >= 3, 'v2ResolveProgress 至少 3 个降级出口（bad-json/timeout-or-truncated/failed），实际 ' + calls);
});

test('复核 medium·死键：truncated 与 degradedHint 均有**位置正确**的消费点（不是只存在于 i18n/注释）', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.cjs'), 'utf8');
  // 终审席指出：子串检查对位置无鉴别力（只出现在注释里也过）。改为形状断言——
  // ① truncated 必须作为**表达式条件**被读（`s.truncated === true` 参与条件）；
  // ② degradedHint 必须出现在**字符串拼接调用**里（`t('degradedHint')`），而非注释。
  assert.ok(/s\s*&&\s*\[?\(?[^\n]*s\.truncated === true/.test(client) ||
            /\(\(s\.degraded && s\.degraded\.length > 0\) \|\| s\.truncated === true\)/.test(client),
    'truncated 未作为渲染条件被读取（死键）');
  assert.ok(client.includes("t('degradedHint')"), 'degradedHint 未作为 i18n 取值调用被引用（只出现于注释/未接线）');
  assert.ok(client.includes("t('degradedPrefix')"), 'degradedPrefix 未作为 i18n 取值调用被引用');
  // ③ 正文表达式须与改前逐字一致（终审席的溢出根因项：正文不得加长）
  assert.ok(client.includes("s && s.fallbackUsed === true && s.lastModel ? t('resultFallback').replace('{model}', prettifyModel(s.lastModel)) : t('result')"),
    '结果态正文须保持与改前逐字一致（不得加长以免 nowrap 按钮溢出）');
});

test('复核 medium·P0-a：always + timeoutMs=0（无限制）仍有安全上限，不依赖预算中断', () => {
  assert.ok(src.includes('const RETRY_ALWAYS_SAFETY_CAP = 5;'), '缺 always 安全上限');
  assert.ok(src.includes('? RETRY_ALWAYS_SAFETY_CAP'), 'always 分支未使用安全上限');
  // 原 1024 上限在 timeoutMs=0 下最坏 ~2.8 小时（复核实测推算）——不得回退到它
  assert.ok(!/mode === 'always' \? 1024/.test(src), 'always 不得回退到 1024 次上限');
});

test('复审 medium·重试不得混进降级通道（重试后成功 ≠ 上下文降级）', async () => {
  // 语义：P0-a 的重试是「瞬时故障自愈」；把它记进 rec.degraded 会让 UI 在**成功**路径上
  // 显示「⚠ 部分上下文不可用」——这是常见路径（限流/瞬时错误），会削弱降级信号可信度。
  let n = 0;
  const llm = {
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 2, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 }; },
    stream() {
      n += 1;
      if (n === 1) return streamOf([{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'rate limited' } } }]);
      return streamOf([{ type: 'text-delta', text: '最终成功的干净结果' }, { type: 'finish', reason: { kind: 'stop' } }]);
    },
  };
  const { handlers } = boot({ llm, timer: REAL_TIMER });
  const out = await handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'base', fallback: [{ provider: 'p', model: 'm' }], params: { maxTokens: 2000, timeoutMs: 30000 } },
  });
  assert.equal(out.ok, true, '重试后应成功：' + JSON.stringify(out));
  assert.equal(out.text, '最终成功的干净结果');
  assert.ok(n >= 2, '须真的重试过（实际 ' + n + ' 次）');
  // 同时：重试须可观测（与降级分通道）——progress 暴露 retries，且不进 degraded
  const prog = await handlers.get('enhance/progress')({ sessionId: 's', seq: 1 }).catch(() => null);
  assert.ok(prog === null || prog.ok === false || (prog.retries === undefined || Array.isArray(prog.retries)), 'progress.retries 字段形态异常');
  const degraded = Array.isArray(out.degraded) ? out.degraded : [];
  assert.ok(!degraded.some((k) => /^retry-/.test(k)),
    '重试不得进 degraded（否则成功结果被误标「部分上下文不可用」）：' + JSON.stringify(degraded));
  // 但要可观测：日志须有重试记录
  const logs = await handlers.get('logs/last')();
  assert.ok(logs.lines.some((l) => /\[enhance\] retry attempt=1/.test(l)), '重试须留可观测日志');
});

// ---------------------------------------------------------------------------
// P0-b 行为判据（2026-10-12 · 独立复核 blocker 的回归锁）
//   缺口：原「结构锁」只断言源码形状，**没有任何行为判据**能实测到「慢辅助把生成饿死」，
//   这正是复核方反例（辅助 23s/24s ⇒ genCalls=0、TIMEOUT）能存活的原因。
//   本组判据构造**慢辅助的假 llm**，直接断言生成仍被调用且结果正确 —— 有牙（还原修复即红）。
// ---------------------------------------------------------------------------

// 造一个「判定调用慢 N 毫秒但最终成功」的假 llm；生成调用即时成功并计数。
function slowHelperLlm(opts) {
  const o = opts || {};
  const helperMs = o.helperMs;
  const genMs = o.genMs || 0;
  // 等待函数可注入：行为判据传缩放版（与 FAST_TIMER 同比例），其余场景用真实等待。
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const state = { genCalls: 0, helperCalls: 0 };
  const events = [
    { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '我想做一个卡牌游戏的排行榜功能' }] } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '好的，需要支持战力排序' }] } } },
  ];
  const sessionQuery = {
    readSurface: async () => ({ session: { id: 's' }, capturedThroughSeq: 2, events }),
    listEvents: async () => events,
    filterEvents: async () => events,
  };
  const llm = {
    providerRetryPolicy() { return null; },
    stream(params) {
      const isJudge = /会话关联性判定器/.test(String((params && params.system) || ''));
      if (isJudge) {
        state.helperCalls += 1;
        return {
          [Symbol.asyncIterator]() {
            let i = 0;
            return {
              async next() {
                if (i === 0) {
                  await sleep(helperMs);
                  i += 1;
                  return { done: false, value: { type: 'text-delta', text: '{"related":true,"reason":"ok"}' } };
                }
                if (i === 1) { i += 1; return { done: false, value: { type: 'finish', reason: { kind: 'stop' } } }; }
                return { done: true };
              },
              return() { i = 99; return Promise.resolve({ done: true }); },  // 支持真中断
            };
          },
        };
      }
      state.genCalls += 1;
      // 生成可带自身耗时（模拟「慢但正常」的模型）。
      // P0-b 修正（2026-10-12 · 第三轮 · 独立复核）：本流的 return() 必须**真正生效**——
      // next() 在 return() 之后立即以 done 收尾（真实 DSH 适配器在 iterator.return() 后即停止产出）。
      // 此前 generator **无任何 return() 语义**，于是被测互操作在「缩放后太短」的窗口中即使
      // 未真正中断辅助也照样收敛，令 #23 成为假绿（详见文件头 P0B_SCALE 说明与 #23 注释）。
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          let returned = false;
          return {
            async next() {
              if (returned) return { done: true };
              if (genMs > 0 && i === 0) { await sleep(genMs); }
              if (returned) return { done: true };   // 等待期间被中断 → 立即收尾
              if (i === 0) { i += 1; return { done: false, value: { type: 'text-delta', text: 'GENERATED-OK' } }; }
              if (i === 1) { i += 1; return { done: false, value: { type: 'finish', reason: { kind: 'stop' } } }; }
              return { done: true };
            },
            return() { returned = true; return Promise.resolve({ done: true }); },
          };
        },
      };
    },
  };
  return { llm, sessionQuery, state };
}

test('P0-b 行为判据·慢辅助不得饿死生成（复核反例 23s/24s：genCalls 必须 ≥1 且结果正确）', async () => {
  // 复核反例原值：辅助 23s/24s、timeoutMs=3000（总预算 = 3000 + prepareBudgetMs(lite)=20000 = 23000ms）
  // 修复前：辅助跑过自身钳后超时 → 总预算先到点 → genCalls=0、ok:false TIMEOUT。
  for (const helperMs of [9000, 20000, 23000]) {
    const { llm, sessionQuery, state } = slowHelperLlm({ helperMs, sleep: (ms) => new Promise((r) => setTimeout(r, scaledDelay(ms))) });
    const { handlers } = boot({ llm, sessionQuery, timer: FAST_TIMER });
    const out = await handlers.get('enhance')({
      sessionId: 's', seq: 1, text: '优化一下',
      config: { mode: 'lite', fallback: [{ provider: 'p', model: 'm' }], context: { budgetChars: 2000 }, params: { maxTokens: 2000, timeoutMs: 3000 } },
    });
    assert.ok(state.genCalls >= 1, '辅助 ' + helperMs + 'ms 时生成必须仍被调用（复核反例：genCalls=0）——实际 ' + state.genCalls);
    assert.equal(out.ok, true, '辅助 ' + helperMs + 'ms 时结果须成功（复核反例：TIMEOUT）：' + JSON.stringify(out));
    assert.equal(out.text, 'GENERATED-OK', '结果须是正确的生成内容');
  }
});

test('P0-b 行为判据·辅助必须在其钳后超时内被真正中断（不得越过超时继续跑）', async () => {
  // 判据：辅助自身超时 = min(RELEVANCE_TIMEOUT_MS=10000, 剩余预算)。辅助实际耗 30s（远超钳后 10s），
  // 修复前会一直等到流自然结束（≈30s）→ 越过 prepareBudgetMs；
  // 修复后必须在 ≈10s 就中止并继续生成 ⇒ 总耗时应显著小于辅助自然耗时。
  const helperMs = 30000;
  const { llm, sessionQuery, state } = slowHelperLlm({ helperMs, sleep: (ms) => new Promise((r) => setTimeout(r, scaledDelay(ms))) });
  const { handlers } = boot({ llm, sessionQuery, timer: FAST_TIMER });
  const t0 = Date.now();
  const out = await handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'lite', fallback: [{ provider: 'p', model: 'm' }], context: { budgetChars: 2000 }, params: { maxTokens: 2000, timeoutMs: 3000 } },
  });
  const elapsed = Date.now() - t0;
  // 缩放后的等价阈值：辅助自然耗时 scaledDelay(30000)=600ms；钳后超时 scaledDelay(10000)=200ms
  assert.ok(state.genCalls >= 1, '辅助真卡死时仍须能生成（实际 ' + state.genCalls + ' 次）');
  assert.equal(out.ok, true, '辅助真卡死 ⇒ 降级后仍应成功生成：' + JSON.stringify(out));
  assert.ok(elapsed < scaledDelay(helperMs), '辅助须在其钳后超时内被中断（实际 ' + elapsed + 'ms 应 < 辅助自然耗时 ' + scaledDelay(helperMs) + 'ms[缩放后]）');
  const degraded = Array.isArray(out.degraded) ? out.degraded : [];
  assert.ok(degraded.some((k) => /relevance/.test(k)), '辅助超时须记降级（P0-d 登记面）：' + JSON.stringify(degraded));
});

test('P0-b 行为判据·生成额度不被侵蚀（辅助慢 + 生成慢，原本能过的仍要能过）', async () => {
  // 复核反例 2（erosion2）：辅助 22s（慢而健康）+ 生成 2.5s，timeoutMs=3000。
  // HEAD ok:true；修复前 TIMEOUT（生成中途总预算到点）。判据：生成必须拿满自己的额度 ⇒ ok:true。
  // ⚠ 第三轮（独立复核）说明本用例为何需要 slowHelperLlm 的「return() 真正生效」：
  //   本用例是**跨轴**比较（prepare+sleep 的墙钟 vs 插件的常量计时器），缩放后关系不守恒——
  //   若生成流的 return() 不生效，未中断的旧行为也能在 490ms 左右自然收尾而通过（历史假绿）。
  //   令 return() 生效后，旧行为下的生成会被主预算在 460ms 处中止 ⇒ 本用例报红（已实测）。
  const { llm, sessionQuery, state } = slowHelperLlm({ helperMs: 22000, genMs: 2500, sleep: (ms) => new Promise((r) => setTimeout(r, scaledDelay(ms))) });
  const { handlers } = boot({ llm, sessionQuery, timer: FAST_TIMER });
  const t0 = Date.now();
  const out = await handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'lite', fallback: [{ provider: 'p', model: 'm' }], context: { budgetChars: 2000 }, params: { maxTokens: 2000, timeoutMs: 3000 } },
  });
  const elapsed = Date.now() - t0;
  assert.equal(out.ok, true, '慢辅助 + 慢生成（2.5s < 3s 额度）必须成功（复核反例 2：修复前 TIMEOUT）：' + JSON.stringify(out));
  assert.equal(out.text, 'GENERATED-OK');
  assert.ok(state.genCalls >= 1, '生成须被调用（实际 ' + state.genCalls + ' 次）');
  // 不劣化的核心：慢辅助**不得越过自己的钳后超时**去吃掉总预算（= 上一轮反例的根因）。
  // 缩放后：辅助钳后超时 scaledDelay(10000)=200ms；辅助自然耗时 scaledDelay(22000)=440ms。
  // 真修好 ⇒ 辅助在 200ms 被中止，整体在「200 + 生成」内完成，必 < 辅助自然耗时。
  assert.ok(elapsed < scaledDelay(22000),
    '慢辅助须在其钳后超时内被中止（实际 ' + elapsed + 'ms 应 < 辅助自然耗时 ' + scaledDelay(22000) + 'ms[缩放后]）');
  // 真实时基下的同一判据（不缩放）：证明本用例结论不依赖缩放。
  // 用真实计时器与真实 sleep 复跑一次；阈值取「辅助自然耗时」以下、留足生成余量。
  const rt = slowHelperLlm({ helperMs: 22000, genMs: 2500 });   // sleep 缺省 = 真实等待
  const rtBoot = boot({ llm: rt.llm, sessionQuery: rt.sessionQuery, timer: REAL_TIMER });
  const rt0 = Date.now();
  const rtOut = await rtBoot.handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'lite', fallback: [{ provider: 'p', model: 'm' }], context: { budgetChars: 2000 }, params: { maxTokens: 2000, timeoutMs: 3000 } },
  });
  const rtElapsed = Date.now() - rt0;
  assert.equal(rtOut.ok, true, '真实时基：慢辅助 + 慢生成必须成功：' + JSON.stringify(rtOut));
  assert.equal(rtOut.text, 'GENERATED-OK');
  assert.ok(rt.state.genCalls >= 1, '真实时基：生成须被调用（实际 ' + rt.state.genCalls + ' 次）');
  // 真修好 ⇒ 辅助在 10s 处被中止，整体应显著短于「辅助自然 22s + 生成」；修复前为 ~27s。
  assert.ok(rtElapsed < 20000,
    '真实时基：慢辅助须在其 10s 钳后超时内被中止（实际 ' + rtElapsed + 'ms 应 < 20000ms；修复前约 27000ms）');
});

// ---------------------------------------------------------------------------
// P0-b 第三轮修复（startWaitAbort，plugin-host.js:2716）的 **A 腿回归锁**
//   缺口（2026-10-12 变异自证实测，非推测）：本文件两处 sessionQuery 夹具（:325 / :559）
//   全部**立即返回、无 await sleep** ⇒ startWaitAbort 这条腿（sessionQuery / fs / web）
//   在测试里**零覆盖**。第三轮修复当时只有探针证据（修好 12508ms vs 未修 27019ms），
//   没有任何测试守着它，后续改动可**静默回退**。本组把慢点放到 sessionQuery.readSurface。
//   判据两层（仅 ok 对该腿鉴别力不足，故必须带钳位层）：
//     ① 行为层 —— ok / text / genCalls 正确，且超时被**显式登记**（degraded 含 history-timeout）；
//     ② 钳位层 —— elapsedMs 显著小于「READ + 生成」，防「等它自然结束」冒充修好。
// ---------------------------------------------------------------------------

// 复用 slowHelperLlm 的**同一套 llm 夹具**（判定流 + 生成流，生成流 return() 真生效），
// 仅把 sessionQuery 换成「readSurface 慢 READ 毫秒」的形态。
function slowReadSurfaceLlm(opts) {
  const o = opts || {};
  const readMs = o.readMs;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const base = slowHelperLlm({ helperMs: 0, genMs: o.genMs || 0, sleep });
  const events = [
    { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '我想做一个卡牌游戏的排行榜功能' }] } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '好的，需要支持战力排序' }] } } },
  ];
  const sessionQuery = {
    readSurface: async () => { await sleep(readMs); return { session: { id: 's' }, capturedThroughSeq: 2, events }; },
    listEvents: async () => events,
    filterEvents: async () => events,
  };
  return { llm: base.llm, sessionQuery, state: base.state };
}

test('P0-b 行为判据·慢 readSurface 不得吃掉生成额度（A 腿 startWaitAbort 回归锁；READ=23000 越过 10s 钳）', async () => {
  // 修复前（HEAD 形态：histTimer 只置标志、await 等到底）：readSurface 23000ms 越过其自身
  // 10s 钳，把总预算（3000 + 20000 = 23000ms）吃光 → 生成拿不到额度；实测变异形态为
  // ok:false / TIMEOUT / elapsed≈27019ms。修好后：10s 处中止会话读取并按降级继续，
  // 生成拿满自己的额度 → elapsed 钉在 ≈12500ms（10s 钳 + 2.5s 生成）。
  const READ = 23000;
  const { llm, sessionQuery, state } = slowReadSurfaceLlm({ readMs: READ, genMs: 2500 });
  const { handlers } = boot({ llm, sessionQuery, timer: REAL_TIMER });
  const t0 = Date.now();
  const out = await handlers.get('enhance')({
    sessionId: 's', seq: 1, text: '优化一下',
    config: { mode: 'lite', fallback: [{ provider: 'p', model: 'm' }], context: { budgetChars: 2000 }, params: { maxTokens: 2000, timeoutMs: 3000 } },
  });
  const elapsedMs = Date.now() - t0;

  // ① 行为层：慢会话读取不得侵蚀生成额度
  assert.equal(out.ok, true, '慢 readSurface（' + READ + 'ms）不得吃掉生成额度（修复前形态：TIMEOUT））：' + JSON.stringify(out));
  assert.equal(out.text, 'GENERATED-OK', '结果须是正确的生成内容');
  assert.ok(state.genCalls >= 1, '生成须被调用（修复前形态：genCalls=0）——实际 ' + state.genCalls);
  const degraded = Array.isArray(out.degraded) ? out.degraded : [];
  assert.ok(degraded.indexOf('history-timeout') !== -1,
    '会话读取超时须被**显式登记**（不得静默吞掉）：' + JSON.stringify(degraded));

  // ② 钳位层（本用例的鉴别力所在）：必须**在 10s 钳处中止**，而不是等 readSurface 自然结束。
  // READ + 生成本应为 23000 + 2500 = 25500ms；被钳住则 ≈ 12500ms。
  assert.ok(elapsedMs < 18000,
    '慢 readSurface 须在其 10s 钳后超时内被中止（实际 ' + elapsedMs + 'ms 应 < 18000ms；' +
    '等它自然结束的形态约 ' + (READ + 2500) + 'ms、实测变异形态约 27019ms）');
});

