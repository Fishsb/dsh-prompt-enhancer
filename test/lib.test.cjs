// host 纯函数单测（node:test，零依赖）
// 从 plugin-host.js 的 ==PURE-BEGIN== .. ==PURE-END== 区段切片并求值，
// 保证测试的即是被发布代码的同一份实现（单一事实源，不复制）。
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const src = readFileSync(join(__dirname, '..', 'plugin-host.js'), 'utf8');
const begin = src.indexOf('// ==PURE-BEGIN==');
const end = src.indexOf('// ==PURE-END==');
assert.ok(begin !== -1 && end > begin, 'PURE markers not found in plugin-host.js');

const pureText = src.slice(begin, end);
// validateConfig 引用了三个默认常量（定义在 PURE 区段之前）；从源码实际取值注入，
// 保持单一事实源（不硬编码，常量变更无需改测试）。
const grabConst = (name) => {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);');
  const m = src.match(re);
  if (!m) throw new Error('const ' + name + ' not found in plugin-host.js');
  return name + ' = ' + m[1] + ';';
};
const defaultsBlock = [grabConst('DEFAULT_TIMEOUT_MS'), grabConst('DEFAULT_MAX_TOKENS'), grabConst('DEFAULT_OUTPUT_LIMIT')].join('\n');
const pureFn = new Function(defaultsBlock + '\n' + pureText + `
  ;return { wrapUserText, cleanOutput, friendlyMessage, validateConfig, collectStream, buildTryChain };
`);
const {
  wrapUserText,
  cleanOutput,
  friendlyMessage,
  validateConfig,
  collectStream,
  buildTryChain,
} = pureFn();

test('wrapUserText 包装用户输入', () => {
  const out = wrapUserText('hi');
  assert.match(out, /^请优化以下提示词：/);
  assert.match(out, /"""\nhi\n"""/);
});

test('cleanOutput 剥离包装与成对引号', () => {
  // 回显包装前缀 + 尾部
  assert.equal(cleanOutput('请优化以下提示词：\n\n"""\n保留的正文\n"""'), '保留的正文');
  // 成对引号包裹剥离
  assert.equal(cleanOutput('"hello"'), 'hello');
  assert.equal(cleanOutput('```code```'), 'code');
  // 纯 trim
  assert.equal(cleanOutput('   plain text  '), 'plain text');
});

test('cleanOutput 不误伤裸文本', () => {
  // 不成对的引号保留
  assert.equal(cleanOutput('他说"你好"'), '他说"你好"');
  assert.equal(cleanOutput('代码片段不加个`包裹'), '代码片段不加个`包裹');
});

test('friendlyMessage 错误码→可读英文文案', () => {
  assert.match(friendlyMessage({ code: 'TIMEOUT' }), /timed out/i);
  assert.match(friendlyMessage({ code: 'UNKNOWN_MODEL' }), /not in catalog/i);
  assert.equal(friendlyMessage({}), friendlyMessage({ code: 'LLM_FAILED' }));
});

test('validateConfig 兼容 v1 平铺 + v2 结构', () => {
  // v1 平铺
  const v1 = validateConfig({ provider: 'p1', model: 'm1', reasoningEffort: 'max', timeoutMs: 60000, templateMode: 'custom', templateText: 'x' });
  assert.equal(v1.provider, 'p1');
  assert.equal(v1.model, 'm1');
  assert.equal(v1.reasoningEffort, 'max');
  assert.equal(v1.timeoutMs, 60000);
  assert.equal(v1.templateMode, 'custom');
  // v2 结构（main.reasoning.enabled + effort）
  const v2 = validateConfig({ main: { provider: 'p2', model: 'm2', reasoning: { enabled: true, effort: 'high' } }, fallback: [{ provider: 'p2', model: 'fb1', reasoning: { enabled: true, effort: 'medium' } }] });
  assert.equal(v2.provider, 'p2');
  assert.equal(v2.reasoningEffort, 'high');
  assert.equal(v2.fallback.length, 1);
  assert.equal(v2.fallback[0].reasoningEffort, 'medium');
});

test('validateConfig 边界与默认回退', () => {
  // 非法数值回退默认
  const c = validateConfig({ timeoutMs: -5, maxTokens: 999999999, outputLimit: 1, main: {} });
  assert.equal(c.timeoutMs, 30000);
  assert.equal(c.maxTokens, 2000);
  assert.equal(c.outputLimit, 8000);
  // 空对象 → 全默认
  const d = validateConfig({});
  assert.equal(d.provider, '');
  assert.equal(d.fallback.length, 0);
});

test('collectStream 成功路径（text-delta + stop finish）', async () => {
  async function* gen() {
    yield { type: 'text-delta', text: 'Hello' };
    yield { type: 'text-delta', text: ' world' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
  const r = await collectStream(gen(), 8000);
  assert.equal(r.kind, 'ok');
  assert.equal(r.text, 'Hello world');
});

test('collectStream 输出超限 → toolong', async () => {
  async function* gen() {
    yield { type: 'text-delta', text: 'a'.repeat(9000) };
  }
  const r = await collectStream(gen(), 8000);
  assert.equal(r.kind, 'toolong');
});

test('collectStream 无 finish → cancelled', async () => {
  async function* gen() {
    yield { type: 'text-delta', text: 'x' };
  }
  const r = await collectStream(gen(), 8000);
  assert.equal(r.kind, 'cancelled');
});

// ---- v21（P1-4）模型能力解析缓存单测 ----
// resolveModelInfoCached 在 PURE 区段之前（模块级），独立提取求值。
const cacheStart = src.indexOf('const modelInfoCache = new Map();');
const cacheEnd = src.indexOf('function wrapUserText');
assert.ok(cacheStart !== -1 && cacheEnd > cacheStart, 'cache region not found in plugin-host.js');
const cacheText = src.slice(cacheStart, cacheEnd);
const cacheFn = new Function(cacheText + `
  ;return { resolveModelInfoCached, MODEL_INFO_TTL_MS };
`);
const { resolveModelInfoCached, MODEL_INFO_TTL_MS } = cacheFn();
assert.equal(MODEL_INFO_TTL_MS, 300000, 'TTL 应为 5 分钟');

test('resolveModelInfoCached 命中缓存（第二次不重复解析）', async () => {
  let calls = 0;
  const fakeLlm = {
    resolveModelInfo: async (provider, model) => {
      calls += 1;
      return { provider, model, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } };
    },
  };
  const a = await resolveModelInfoCached(fakeLlm, 'p1', 'm1');
  const b = await resolveModelInfoCached(fakeLlm, 'p1', 'm1');
  assert.equal(calls, 1, '同键第二次应命中缓存');
  assert.equal(a.model, 'm1');
  assert.equal(b.model, 'm1');
  assert.equal(a.reasoning.efforts[0].name, 'High');
});

test('resolveModelInfoCached 不同键独立缓存', async () => {
  let calls = 0;
  const fakeLlm = {
    resolveModelInfo: async () => { calls += 1; return { ok: true }; },
  };
  await resolveModelInfoCached(fakeLlm, 'pA', 'mA');
  await resolveModelInfoCached(fakeLlm, 'pB', 'mB');
  assert.equal(calls, 2, '不同 provider/model 键应各自解析');
});

// ---- v23（D6）模型链构建单测 ----
test('buildTryChain 按链顺序尝试（含去重与 reasoningEffort）', () => {
  const chain = buildTryChain(
    [
      { provider: 'p1', model: 'm1' },
      { provider: 'p1', model: 'm1' }, // 重复应去重
      { provider: 'p2', model: 'm2', reasoningEffort: 'high' },
    ],
    [{ provider: 'p9', model: 'm9' }],
  );
  assert.equal(chain.length, 2);
  assert.deepEqual(chain[0], { provider: 'p1', model: 'm1' });
  assert.deepEqual(chain[1], { provider: 'p2', model: 'm2', reasoningEffort: 'high' });
});

test('buildTryChain 链为空 → 用自适应/内置链补足', () => {
  const adaptive = [
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
  ];
  const chain = buildTryChain([], adaptive);
  assert.deepEqual(chain, adaptive);
  // 无效条目过滤
  const mixed = buildTryChain(
    [{ provider: '', model: 'x' }, null, { provider: '  ', model: 'y' }, { provider: 'p', model: 'm' }],
    adaptive,
  );
  assert.equal(mixed.length, 1);
  assert.deepEqual(mixed[0], { provider: 'p', model: 'm' });
});
