'use strict';
// M2: bundle smoke test — evaluate the generated plugin-host.js with a mock
// harness + ctx (same mechanism as lib/index.cjs: new Function('harness', BODY))
// and verify RPC registration plus fast-path behavior. This is the first
// direct test of the generated bundle's runtime surface.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');

function boot(opts) {
  const handlers = new Map();
  const harness = {
    handle(method, fn) {
      if (typeof method === 'string' && typeof fn === 'function') handlers.set(method, fn);
    },
    probeEnv() {
      return null;
    },
  };
  // apply() directly executes: ctx.get('llm'), handler registration, ctx.effect.
  // All deep paths (timer, sessions, sandboxPolicy, web...) are only touched
  // inside handlers, so a minimal mock keeps the fast paths testable.
  // opts.llm injects a fake llm service to exercise the full enhance pipeline.
  const ctx = {
    get: (name) => {
      if (name === 'llm' && opts && opts.llm) return opts.llm;
      if (name === 'sessionQuery' && opts && opts.sessionQuery) return opts.sessionQuery;
      if (name === 'sandboxPolicy' && opts && opts.sandboxPolicy) return opts.sandboxPolicy;
      if (name === 'fs' && opts && opts.fs) return opts.fs;
      return undefined;
    },
    effect: () => {},
    timer: { timeout: () => () => {} },
  };
  const plugin = new Function('harness', BODY)(harness);
  if (typeof plugin.apply !== 'function') throw new Error('plugin.apply missing from bundle');
  plugin.apply(ctx);
  return { handlers };
}

// Fake llm service: records every stream() request, returns a one-delta
// successful stream (text-delta "OK" then finish stop).
function mockLlm(seen) {
  return {
    stream(params) {
      seen.push(params);
      return {
        [Symbol.asyncIterator]() {
          let step = 0;
          return {
            async next() {
              step += 1;
              if (step === 1) return { done: false, value: { type: 'text-delta', text: 'OK' } };
              return { done: false, value: { type: 'finish', reason: { kind: 'stop' } } };
            },
          };
        },
      };
    },
  };
}

test('SMK-01 bundle registers core RPC handlers', () => {
  const { handlers } = boot();
  const expected = [
    'enhance', 'enhance/progress', 'cancel', 'template/default', 'logs/last',
    'models/list', 'models/test', 'models/autochain', 'plugins/inventory',
  ];
  for (const method of expected) {
    assert.ok(handlers.has(method), 'missing handler: ' + method);
  }
});

test('SMK-02 enhance GUARD fast path (empty / command input)', async () => {
  const { handlers } = boot();
  const empty = await handlers.get('enhance')({ sessionId: 's', seq: 1, text: '' });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'GUARD');
  const command = await handlers.get('enhance')({ sessionId: 's', seq: 2, text: '/help me' });
  assert.equal(command.ok, false);
  assert.equal(command.code, 'GUARD');
});

test('SMK-03 enhance NO_LLM fast path (mock ctx has no llm service)', async () => {
  const { handlers } = boot();
  const out = await handlers.get('enhance')({ sessionId: 's', seq: 1, text: 'hello' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'NO_LLM');
});

test('SMK-04 enhance/progress returns NO_RECORD for unknown request', async () => {
  const { handlers } = boot();
  const out = await handlers.get('enhance/progress')({ sessionId: 'missing', seq: 42 });
  assert.deepEqual(out, { ok: false, code: 'NO_RECORD' });
});

// M3 fix：校验层 schema 必须与真实 client payload 形状对齐——client 调 enhance 传
// {sessionId, seq, text, config, mode}（helpers.js），handler 读 args.text；
// 此前 schema 误用 draft 字段导致全部 enhance 请求被 400 拦截（lib/index.cjs 分发前校验）。
test('SMK-05 RPC schema accepts real client payload shapes', () => {
  const { validateRpcArgs } = require('../lib/rpc-schema.cjs');
  // 真实 client 形状（helpers.js enhance 调用）
  assert.equal(validateRpcArgs('enhance', { sessionId: 's', seq: 1, text: 'draft body', config: {}, mode: 'base' }).ok, true);
  // 真实 client 形状（updater-card doCheck）
  assert.equal(validateRpcArgs('update/check', { repo: 'Fishsb/dsh-prompt-enhancer', sessionId: 's', tagsPayload: '[]', releasePayload: '{}' }).ok, true);
  // 真实 client 形状（model-main runTest）
  assert.equal(validateRpcArgs('models/test', { provider: 'p', model: 'm' }).ok, true);
  // 真实 client 形状（plugins-section act）
  assert.equal(validateRpcArgs('plugins/run', { sessionId: 's', pluginId: 'p', packageId: 'x', mode: 'run' }).ok, true);
  // 防回归：缺 text 应被拒
  assert.equal(validateRpcArgs('enhance', { sessionId: 's', draft: 'x' }).ok, false);
});

// v2.9.0-fix：reasoning（带 effort）链节自动放宽 maxTokens（>=8000）——
// 思考过程消耗输出预算，配置的 2000 在长输入 + effort=max 时耗尽 → 空流。
test('SMK-06 reasoning link auto-widens maxTokens', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlm(seen) });
  const out = await handlers.get('enhance')({
    sessionId: 's',
    seq: 1,
    text: '优化一下',
    config: {
      mode: 'base',
      fallback: [{ provider: 'p', model: 'm', reasoning: { enabled: true, effort: 'max' } }],
      params: { maxTokens: 2000, timeoutMs: 30000 },
    },
  });
  assert.equal(out.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reasoningEffort, 'max');
  assert.equal(seen[0].maxTokens, 8000);
});

test('SMK-07 non-reasoning link keeps configured maxTokens', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlm(seen) });
  const out = await handlers.get('enhance')({
    sessionId: 's',
    seq: 1,
    text: '优化一下',
    config: {
      mode: 'base',
      fallback: [{ provider: 'p', model: 'm' }],
      params: { maxTokens: 2000, timeoutMs: 30000 },
    },
  });
  assert.equal(out.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].maxTokens, 2000);
});

// ---- v3.0 模式重构：会话轮次窗口关联检索集成测试 ----

function streamOf(chunks) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          return i < chunks.length ? { done: false, value: chunks[i++] } : { done: true };
        },
      };
    },
  };
}

// v3.0v2 llm mock：relevance（会话关联判定）/ intent（开发意向判定）/
// docanalysis（文档检索+项目地图合并分析）三类 judge + 主调用；
// opts: { related, devIntent, hasProjectMap }。
function mockLlmSmart(seen, opts) {
  const o = opts || {};
  return {
    stream(params) {
      seen.push(params);
      const sys = typeof params.system === 'string' ? params.system : '';
      if (sys.includes('会话关联性判定器')) {
        return streamOf([
          { type: 'text-delta', text: JSON.stringify({ related: o.related !== false, reason: 't' }) },
          { type: 'finish', reason: { kind: 'stop' } },
        ]);
      }
      if (sys.includes('意图判定器')) {
        return streamOf([
          { type: 'text-delta', text: JSON.stringify({ isDevIntent: o.devIntent !== false, reason: 'i' }) },
          { type: 'finish', reason: { kind: 'stop' } },
        ]);
      }
      if (sys.includes('项目文档分析器')) {
        return streamOf([
          {
            type: 'text-delta',
            text: JSON.stringify({
              relatedDocs: [{ path: 'README.md', excerpt: '用户管理系统，含登录功能说明' }],
              hasProjectMap: o.hasProjectMap !== false,
              codePaths: ['src'],
              reason: 'd',
            }),
          },
          { type: 'finish', reason: { kind: 'stop' } },
        ]);
      }
      if (sys.includes('会话任务分析器')) {
        // publish v2 管道的阶段 A（LLM 任务分析）
        return streamOf([
          { type: 'text-delta', text: JSON.stringify({ task: '优化登录', currentStep: '', completed: [], focus: ['登录'] }) },
          { type: 'finish', reason: { kind: 'stop' } },
        ]);
      }
      return streamOf([
        { type: 'text-delta', text: 'OK' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]);
    },
  };
}

// v3.0 sessionQuery mock：2 轮历史（4 条消息事件）。
function mockSessionQuery() {
  return {
    listEvents: async () => [
      { type: 'user/message', seq: 1 },
      { type: 'assistant/message', seq: 2 },
      { type: 'user/message', seq: 3 },
      { type: 'assistant/message', seq: 4 },
    ],
    filterEvents: async () => [
      { type: 'user/message', seq: 1, text: '帮我优化提示词' },
      { type: 'assistant/message', seq: 2, text: '好的' },
      { type: 'user/message', seq: 3, text: '再优化一下' },
      { type: 'assistant/message', seq: 4, text: '可以' },
    ],
  };
}

test('SMK-08 lite window hit injects session reference', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlmSmart(seen, { related: true }), sessionQuery: mockSessionQuery() });
  const out = await handlers.get('enhance')({
    sessionId: 's',
    seq: 1,
    text: '优化一下',
    config: {
      mode: 'lite',
      fallback: [{ provider: 'p', model: 'm' }],
      params: { maxTokens: 2000, timeoutMs: 30000 },
    },
  });
  assert.equal(out.ok, true);
  // judge 调用（RELEVANCE_PROMPT）→ 主调用
  assert.equal(seen.length, 2);
  assert.ok(seen[0].system.includes('会话关联性判定器'), 'first call is relevance judge');
  assert.equal(seen[0].maxTokens, 400, 'judge 小预算');
  // 参考块注入到主调用的 user 消息文本（finalText = v2Block + 原文包裹）
  const mainText = seen[1].messages[0].content[0].text;
  assert.ok(mainText.includes('【相关会话参考】'), 'main call receives session reference');
  assert.ok(mainText.includes('再优化一下'), 'reference contains window text');
});

test('SMK-09 standard all windows miss → no reference', async () => {
  const seen = [];
  const { handlers } = boot({ llm: mockLlmSmart(seen, { related: false }), sessionQuery: mockSessionQuery() });
  const out = await handlers.get('enhance')({
    sessionId: 's',
    seq: 1,
    text: '优化一下',
    config: {
      mode: 'standard',
      fallback: [{ provider: 'p', model: 'm' }],
      params: { maxTokens: 2000, timeoutMs: 30000 },
    },
  });
  assert.equal(out.ok, true);
  // judge 调用 1 次（前 2 轮窗口 miss；3-5 / 6-10 轮窗口越界跳过）
  assert.equal(seen.length, 2);
  assert.ok(seen[0].system.includes('会话关联性判定器'), 'first call is relevance judge');
  const mainText = seen[1].messages[0].content[0].text;
  assert.ok(!mainText.includes('【相关会话参考】'), 'no reference when all windows miss');
});

// v3.0（S3）：smart 工作区阶段 mock——根目录含 README.md 与 index.js。
function mockWorkspaceFs() {
  const files = new Map([
    ['README.md', '# 我的项目\n这是一个用户管理系统，支持注册登录权限管理。'],
    ['src/index.js', 'function login(user) { return user; }\nexport default login;'],
  ]);
  return {
    resolve: async (p) => (typeof p === 'object' && p !== null ? p : p),
    listDir: async (target) => {
      const base = target === undefined || target === null || target === 'root' ? '' : String(target).replace(/^root\//, '');
      const out = [];
      for (const p of files.keys()) {
        if (base !== '' && !p.startsWith(base + '/')) continue;
        const rest = base === '' ? p : p.slice(base.length + 1);
        if (!rest) continue;
        const seg = rest.split('/')[0];
        const isDir = rest.includes('/');
        out.push({ name: seg, type: isDir ? 'directory' : 'file', target: 'root/' + (base ? base + '/' : '') + seg });
      }
      return out;
    },
    readText: async (target) => {
      const key = String(target).replace(/^root\//, '');
      return files.get(key) || '';
    },
  };
}

test('SMK-10 smart full flow: intent + doc-analysis + code reference', async () => {
  const seen = [];
  const { handlers } = boot({
    llm: mockLlmSmart(seen, { related: true, devIntent: true, hasProjectMap: true }),
    sessionQuery: mockSessionQuery(),
    sandboxPolicy: { workspaceRoot: 'root' },
    fs: mockWorkspaceFs(),
  });
  const out = await handlers.get('enhance')({
    sessionId: 's',
    seq: 1,
    text: '优化一下这个登录功能',
    config: {
      mode: 'smart',
      fallback: [{ provider: 'p', model: 'm' }],
      params: { maxTokens: 2000, timeoutMs: 30000 },
    },
  });
  assert.equal(out.ok, true);
  // 关联判定 → 开发意向判定 → 文档分析（B+C 合并）→ 主调用
  assert.ok(seen.length >= 4, 'relevance+intent+docanalysis+main, got ' + seen.length);
  assert.ok(seen[0].system.includes('会话关联性判定器'), 'call 0 = relevance judge');
  assert.ok(seen[1].system.includes('意图判定器'), 'call 1 = dev-intent judge');
  assert.equal(seen[1].maxTokens, 400, 'intent judge 小预算');
  assert.ok(seen[2].system.includes('项目文档分析器'), 'call 2 = doc-analysis judge (B+C merged)');
  // SMART_TAIL 仅在进入第三步时注入 system
  assert.ok(seen[3].system.includes('调整方案'), 'smart tail injected when third step entered');
  // 文档 + 代码参考注入 messages
  const mainText = seen[3].messages[0].content[0].text;
  assert.ok(mainText.includes('【项目文档参考】'), 'doc reference injected');
  assert.ok(mainText.includes('【相关代码参考】'), 'code reference injected');
});

test('SMK-11 smart non-dev-intent stops before workspace', async () => {
  const seen = [];
  const { handlers } = boot({
    llm: mockLlmSmart(seen, { related: true, devIntent: false }),
    sessionQuery: mockSessionQuery(),
    sandboxPolicy: { workspaceRoot: 'root' },
    fs: mockWorkspaceFs(),
  });
  const out = await handlers.get('enhance')({
    sessionId: 's',
    seq: 1,
    text: '优化一下这个登录功能',
    config: {
      mode: 'smart',
      fallback: [{ provider: 'p', model: 'm' }],
      params: { maxTokens: 2000, timeoutMs: 30000 },
    },
  });
  assert.equal(out.ok, true);
  // 关联判定 → 意向判定（非开发意向 → 停）→ 主调用；无 doc-analysis
  assert.equal(seen.length, 3, 'relevance+intent+main');
  assert.ok(seen[1].system.includes('意图判定器'), 'call 1 = dev-intent judge');
  assert.ok(!seen[2].system.includes('项目文档分析器'), 'no doc-analysis when non-dev-intent');
  // 无 SMART_TAIL、无文档/代码参考
  assert.ok(!seen[2].system.includes('调整方案'), 'no smart tail when stopped');
  const mainText = seen[2].messages[0].content[0].text;
  assert.ok(!mainText.includes('【项目文档参考】'), 'no doc reference when stopped');
  assert.ok(!mainText.includes('【相关代码参考】'), 'no code reference when stopped');
});

// v3.0v2：publish 保持 v2 管道（任务分析 + 文件检索），无 smart 专属环节。
test('SMK-12 publish keeps v2 pipeline (no smart tail)', async () => {
  const seen = [];
  const { handlers } = boot({
    llm: mockLlmSmart(seen, { related: true }),
    sessionQuery: mockSessionQuery(),
    sandboxPolicy: { workspaceRoot: 'root' },
    fs: mockWorkspaceFs(),
  });
  const out = await handlers.get('enhance')({
    sessionId: 's',
    seq: 1,
    text: '帮我优化登录功能的开发方案',
    config: {
      mode: 'publish',
      fallback: [{ provider: 'p', model: 'm' }],
      params: { maxTokens: 2000, timeoutMs: 300000 },
    },
  });
  assert.equal(out.ok, true);
  // 阶段 A（任务分析）→ 主调用；无 relevance/intent/docanalysis
  assert.equal(seen.length, 2, 'task-analysis + main');
  assert.ok(seen[0].system.includes('会话任务分析器'), 'call 0 = task analysis (v2 phase A)');
  assert.ok(seen[1].system.includes('开发规格说明书'), 'publish system = 九章规格');
  assert.ok(!seen[1].system.includes('调整方案'), 'publish 无 smart tail');
});
