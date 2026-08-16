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
    get: (name) => (name === 'llm' && opts && opts.llm ? opts.llm : undefined),
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
