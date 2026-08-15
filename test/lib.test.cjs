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
  ;return { wrapUserText, cleanOutput, friendlyMessage, validateConfig, collectStream, buildTryChain,
    shouldInjectV2, extractHistory, inferFocusRules, extractKeywords, shouldIgnoreFile, analyzeInputRules,
    rankFiles, snippetFromLines, buildContextBlock, parseTaskProgress,
    parseMode, parseMemory, shouldInjectMemory, parseBudgetChars, resolveScanLimit,
    buildMemoryChainBlock, computeEditDelta, buildMemoryDeltaHint, buildChatMessages,
    MEMORY_ROUNDS_MAX, MEMORY_CHAIN_BUDGET_MAX, MEMORY_DELTA_MAX,
    MODE_TABLE, BUDGET_OPTIONS, BUDGET_WORKSPACE_TABLE,
    STAGE_SEQUENCE, STAGE_LABELS,
    PLUGIN_VERSION, UPDATE_MANIFEST, parseVersion, compareVersions, versionStatus,
    normalizeRepo, isValidTag, pickMaxTag, parseTagsPayload, validateManifestFiles, defaultDirFor,
    ENV_PROBE_KEYS, buildInstallArgs, buildRestartPlan, mergeEnvPath };
`);
const {
  wrapUserText,
  cleanOutput,
  friendlyMessage,
  validateConfig,
  collectStream,
  buildTryChain,
  shouldInjectV2,
  extractHistory,
  inferFocusRules,
  extractKeywords,
  analyzeInputRules,
  shouldIgnoreFile,
  rankFiles,
  snippetFromLines,
  buildContextBlock,
  parseTaskProgress,
  parseMode,
  parseMemory,
  shouldInjectMemory,
  parseBudgetChars,
  resolveScanLimit,
  buildMemoryChainBlock,
  computeEditDelta,
  buildMemoryDeltaHint,
  buildChatMessages,
  MEMORY_ROUNDS_MAX,
  MEMORY_CHAIN_BUDGET_MAX,
  MEMORY_DELTA_MAX,
  MODE_TABLE,
  BUDGET_OPTIONS,
  BUDGET_WORKSPACE_TABLE,
  STAGE_SEQUENCE,
  STAGE_LABELS,
  PLUGIN_VERSION,
  UPDATE_MANIFEST,
  parseVersion,
  compareVersions,
  versionStatus,
  normalizeRepo,
  isValidTag,
  pickMaxTag,
  parseTagsPayload,
  validateManifestFiles,
  defaultDirFor,
  ENV_PROBE_KEYS,
  buildInstallArgs,
  buildRestartPlan,
  mergeEnvPath,
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

// ================= v2.0.0（V2 上下文感知）单测 =================

test('U1 validateConfig mode/context 解析', () => {
  // 缺省 → base / 4000（v2.1：engine 字段废弃，缺省 mode=base）
  const d = validateConfig({});
  assert.equal(d.mode, 'base');
  assert.equal(d.context.budgetChars, 4000);
  assert.equal(d.context.workspace.maxFiles, 3);
  // 旧 engine v2 + basic → standard（迁移）
  const v2 = validateConfig({ engine: 'v2', context: { mode: 'basic', budgetChars: 2000, workspace: { maxFiles: 5, depth: 3 } } });
  assert.equal(v2.mode, 'standard');
  assert.equal(v2.context.budgetChars, 2000);
  // 旧 workspace 仅作上限兼容：maxFiles 5 ≤ 联动上限 3 时不生效（回退 3）
  assert.equal(v2.context.workspace.maxFiles, 3);
  assert.equal(v2.context.workspace.depth, 2);
  // 非法回退（v2.1：mode 迁移——非法 engine/mode 一律 base；预算/workspace 回退默认）
  const bad = validateConfig({ engine: 'v3', context: { mode: 'turbo', budgetChars: 999, workspace: { maxFiles: 99, depth: 99 } } });
  assert.equal(bad.mode, 'base');
  assert.equal(bad.context.budgetChars, 4000);
  assert.equal(bad.context.workspace.maxFiles, 3);
  assert.equal(bad.context.workspace.depth, 2);
  // v2.2：autoMemory 字段已删除 → 记忆开关缺省 false
  assert.equal(bad.memory, false);
});

test('U19 MODE_TABLE 完整性 + parseMode 迁移（v2.2 四模式）', () => {
  // 表完整性：4 模式齐全（记忆模式已删除）、字段合法、budget 属白名单
  assert.deepEqual(Object.keys(MODE_TABLE).sort(), ['base', 'lite', 'smart', 'standard']);
  for (const [k, row] of Object.entries(MODE_TABLE)) {
    assert.ok(['none', 'rule', 'llm'].includes(row.phaseA), k + ' phaseA');
    assert.ok(['none', 'file+event'].includes(row.phaseB), k + ' phaseB');
    assert.ok(['none', 'inject'].includes(row.phaseC), k + ' phaseC');
    assert.ok(BUDGET_OPTIONS.includes(row.budgetDefault), k + ' budgetDefault');
    assert.ok(['fixed', 'by-budget'].includes(row.scanLimit), k + ' scanLimit');
  }
  // 迁移：显式白名单 / 旧 engine+context.mode / 缺省非法 → base
  assert.equal(parseMode('standard', 'v2', 'smart'), 'standard');
  assert.equal(parseMode('memory', undefined, undefined), 'base'); // v2.2：memory 不再是模式（迁移由 validateConfig 处理）
  assert.equal(parseMode(undefined, 'v2', 'basic'), 'standard');
  assert.equal(parseMode(undefined, 'v2', 'smart'), 'smart');
  assert.equal(parseMode(undefined, 'v1', 'smart'), 'base');
  assert.equal(parseMode(undefined, undefined, undefined), 'base');
  assert.equal(parseMode('turbo', undefined, undefined), 'base');
  // parseBudgetChars 白名单
  assert.equal(parseBudgetChars(8000), 8000);
  assert.equal(parseBudgetChars(999), 4000);
  assert.equal(parseBudgetChars(undefined), 4000);
});

test('U20 resolveScanLimit 联动查表（§0.2/§4.1）', () => {
  // by-budget（智能）：4000 → 3/2；8000 → 6/3；2000 → 2/1（返回含 budget 档位字段）
  assert.deepEqual(resolveScanLimit('smart', 4000), { budget: 4000, maxFiles: 3, depth: 2 });
  assert.deepEqual(resolveScanLimit('smart', 8000), { budget: 8000, maxFiles: 6, depth: 3 });
  assert.deepEqual(resolveScanLimit('smart', 2000), { budget: 2000, maxFiles: 2, depth: 1 });
  // fixed（标准等）：固定 3/2
  assert.deepEqual(resolveScanLimit('standard', 8000), { maxFiles: 3, depth: 2 });
  // 未知模式（memory 已删除）→ 默认表行（base）fixed 3/2
  assert.deepEqual(resolveScanLimit('turbo', 4000), { maxFiles: 3, depth: 2 });
  // 联动表全档位覆盖
  assert.equal(BUDGET_WORKSPACE_TABLE.length, 4);
  for (const e of BUDGET_WORKSPACE_TABLE) assert.ok(BUDGET_OPTIONS.includes(e.budget));
});

test('U21 buildMemoryChainBlock 记忆链预算分配与防回显（v2.6.1）', () => {
  // 单轮：模板含两段 + 禁止回显 + 轮次编号
  const b = buildMemoryChainBlock([{ input: '原文内容', output: '优化输出' }], 4000);
  assert.ok(b.includes('原文内容') && b.includes('优化输出'));
  assert.ok(b.includes('禁止回显'));
  assert.ok(b.includes('第1轮'));
  // 预算等分：rounds=1 → 输入 1/3、输出 2/3（总预算 min(4000, 2400)=2400）
  const longInput = 'x'.repeat(1000);
  const longOutput = 'y'.repeat(2000);
  const bl = buildMemoryChainBlock([{ input: longInput, output: longOutput }], 4000);
  assert.ok(bl.includes('x'.repeat(800)), '单轮输入保留 800（2400/3）');
  assert.equal(bl.includes('x'.repeat(801)), false);
  assert.ok(bl.includes('y'.repeat(1600)), '单轮输出保留 1600（2400*2/3）');
  assert.equal(bl.includes('y'.repeat(1601)), false);
  // 多轮编号：时间序 第1轮 → 第2轮，内容完整
  const multi = buildMemoryChainBlock([
    { input: 'a1', output: 'o1' },
    { input: 'a2', output: 'o2' },
  ], 4000);
  assert.ok(multi.indexOf('第1轮') < multi.indexOf('第2轮'));
  assert.ok(multi.includes('a1') && multi.includes('o2'));
  // 轮数上限：>4 只保留最近 4 轮
  const five = [];
  for (let i = 1; i <= 5; i++) five.push({ input: 'in' + i, output: 'out' + i });
  const capped = buildMemoryChainBlock(five, 4000);
  assert.equal(capped.includes('in1'), false, '最旧轮应被丢弃');
  assert.ok(capped.includes('in5'), '最新轮保留');
  assert.equal((capped.match(/第\d轮/g) || []).length, MEMORY_ROUNDS_MAX);
  // 预算 0 / undefined → 空（等价不注入）
  assert.equal(buildMemoryChainBlock([{ input: 'a', output: 'b' }], 0), '');
  assert.equal(buildMemoryChainBlock([{ input: 'a', output: 'b' }], undefined), '');
  // 空链/缺省输入容错
  assert.equal(buildMemoryChainBlock([], 4000), '');
  assert.equal(buildMemoryChainBlock(null, 4000), '');
  assert.equal(buildMemoryChainBlock([{ input: '', output: '' }], 4000), '');
});

test('U22 validateConfig mode/记忆开关解析（v2.2）', () => {
  const c = validateConfig({ mode: 'smart', context: { budgetChars: 8000 }, memory: false });
  assert.equal(c.mode, 'smart');
  assert.equal(c.context.budgetChars, 8000);
  assert.equal(c.memory, false);
  // 旧配置迁移 A7：mode='memory' → mode='lite' + memory=true
  const mem = validateConfig({ mode: 'memory', context: { budgetChars: 4000 } });
  assert.equal(mem.mode, 'lite');
  assert.equal(mem.memory, true);
  // client 显式 memory 字段（config.memory）最高优先
  const memField = validateConfig({ mode: 'base', memory: true });
  assert.equal(memField.mode, 'base');
  assert.equal(memField.memory, true);
  // memory 字段 false 覆盖 autoMemory 的旧值（显式开关关闭）
  const memOff = validateConfig({ mode: 'standard', memory: false, autoMemory: true });
  assert.equal(memOff.memory, false);
  // 旧配置迁移：autoMemory 并入记忆开关（显式 memory 字段不传时）
  const auto = validateConfig({ mode: 'standard', autoMemory: true });
  assert.equal(auto.mode, 'standard');
  assert.equal(auto.memory, true);
  // autoMemory=false 且无 mode='memory' → 记忆关
  const off = validateConfig({ mode: 'standard', autoMemory: false });
  assert.equal(off.memory, false);
  // 旧 engine v2 + basic → standard（回归）
  const old = validateConfig({ engine: 'v2', context: { mode: 'basic' } });
  assert.equal(old.mode, 'standard');
  // 缺省 → base + 记忆关
  const d = validateConfig({});
  assert.equal(d.mode, 'base');
  assert.equal(d.memory, false);
});

test('U23 parseMemory/shouldInjectMemory 记忆开关语义（§6.4/§6.5）', () => {
  // parseMemory：mode='memory' 显式优先；autoMemory 并入；缺省 false
  assert.equal(parseMemory('memory', false), true);
  assert.equal(parseMemory('base', true), true);
  assert.equal(parseMemory('base', false), false);
  assert.equal(parseMemory(undefined, undefined), false);
  assert.equal(parseMemory('lite', undefined), false);
  // shouldInjectMemory：开关开 + 有记忆 + 预算>0 才注入（叠加模块）
  assert.equal(shouldInjectMemory(true, true, 4000), true);
  assert.equal(shouldInjectMemory(true, true, 2000), true);
  assert.equal(shouldInjectMemory(false, true, 4000), false); // 开关关 → 完全不注入
  assert.equal(shouldInjectMemory(true, false, 4000), false); // 无记忆
  assert.equal(shouldInjectMemory(true, true, 0), false);     // 预算 0
  assert.equal(shouldInjectMemory(true, true, undefined), false);
  assert.equal(shouldInjectMemory(undefined, true, 4000), false);
});

test('U12 shouldInjectV2 分支判定（表驱动 §4.1）', () => {
  assert.equal(shouldInjectV2('standard', 4000), true);
  assert.equal(shouldInjectV2('smart', 4000), true);
  assert.equal(shouldInjectV2('base', 4000), false);
  assert.equal(shouldInjectV2('lite', 4000), false);
  assert.equal(shouldInjectV2('standard', 0), false);
  assert.equal(shouldInjectV2('standard', undefined), false);
  assert.equal(shouldInjectV2('turbo', 4000), false); // 非法 → 默认表行（base）
  assert.equal(shouldInjectV2('memory', 4000), false); // v2.2：memory 不再是模式 → 默认表行
});

test('U24 STAGE 常量/映射完整性（v2.3 §7.3）', () => {
  // 阶段序列：prepare 为首、llm 为耗时主体、done 收尾；全部 8 阶段无重复
  assert.equal(STAGE_SEQUENCE[0], 'prepare');
  assert.equal(STAGE_SEQUENCE[6], 'llm');
  assert.equal(STAGE_SEQUENCE[7], 'done');
  assert.equal(new Set(STAGE_SEQUENCE).size, STAGE_SEQUENCE.length);
  assert.equal(STAGE_SEQUENCE.length, 8);
  // 映射键与序列一一对应、无缺键
  const labelKeys = Object.keys(STAGE_LABELS).sort();
  assert.deepEqual(labelKeys, [...STAGE_SEQUENCE].sort());
  for (const stage of STAGE_SEQUENCE) {
    assert.ok(STAGE_LABELS[stage], 'missing label for ' + stage);
    assert.equal(typeof STAGE_LABELS[stage].zh, 'string');
    assert.ok(STAGE_LABELS[stage].zh.length > 0, 'empty zh for ' + stage);
    assert.equal(typeof STAGE_LABELS[stage].en, 'string');
    assert.ok(STAGE_LABELS[stage].en.length > 0, 'empty en for ' + stage);
  }
});

test('U6/U16 extractHistory 过滤与取尾', () => {
  const events = [
    { type: 'tool', text: '[工具] read' },
    { type: 'user', text: '/help' },
    { type: 'user', text: '帮我写排序算法' },
    { type: 'assistant', text: '好的，以下是算法' },
    { type: 'user', text: '再优化一下' },
  ];
  const h = extractHistory(events, 4);
  assert.deepEqual(h.map((e) => e.type), ['user', 'assistant', 'user']);
  assert.equal(h[0].text, '帮我写排序算法');
  // 空输入
  assert.deepEqual(extractHistory([], 4), []);
  assert.deepEqual(extractHistory(null, 4), []);
  // 长会话取尾
  const many = [];
  for (let i = 0; i < 1000; i++) many.push({ type: 'user', text: 'msg' + i });
  const tail = extractHistory(many, 8);
  assert.equal(tail.length, 8);
  assert.equal(tail[7].text, 'msg999');
});

test('U6b extractHistory DSH role/kind 形状（data.content 容器 + chunk 跳过）', () => {
  // DSH 真实事件形状：type='user/message'|'assistant/message'|'assistant/chunk'，文本在 data.content[].text
  const events = [
    { type: 'tool/call', data: { name: 'read_file', input: { path: 'a.py' } } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '帮我修一下 parser.py 的 bug' }] } },
    { type: 'assistant/chunk', data: { content: [{ type: 'text', text: '好的，我来看' }] } },   // 流片段应跳过
    { type: 'assistant/message', data: { content: [{ type: 'text', text: '已定位问题在缓存层' }] } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '继续优化提示词' }] } },
  ];
  const h = extractHistory(events, 10);
  assert.deepEqual(h.map((e) => e.type), ['user', 'assistant', 'user']);
  assert.equal(h[0].text, '帮我修一下 parser.py 的 bug');
  assert.equal(h[1].text, '已定位问题在缓存层');
  assert.equal(h[2].text, '继续优化提示词');
  // 容器缺失但 data 存在、content 数组含非对象项 → 容错拼接
  const mixed = [
    { type: 'user/message', data: { content: ['plain', { text: ' + obj' }] } },
  ];
  const m = extractHistory(mixed, 4);
  assert.equal(m.length, 1);
  assert.equal(m[0].text, '+ obj');
  // type 缺失时 role 字段兜底
  const roleOnly = [
    { role: 'assistant', text: '兜底 role 文本' },
  ];
  const r = extractHistory(roleOnly, 4);
  assert.equal(r.length, 1);
  assert.equal(r[0].text, '兜底 role 文本');
});

test('U2 inferFocusRules 提取与停用词', () => {
  const focus = inferFocusRules('需要修改 src/utils/parser.py 并更新 package.json，实现 缓存 功能');
  assert.ok(focus.includes('parser.py') || focus.includes('parser'), '应提取文件名 token');
  assert.ok(focus.includes('package.json'), '应提取 package.json');
  assert.ok(focus.some((w) => w === '缓存'), '应提取中文主题词');
  assert.ok(!focus.includes('需要') && !focus.includes('实现'), '停用词应被过滤');
  // 空历史
  assert.deepEqual(inferFocusRules(''), []);
  assert.deepEqual(inferFocusRules(null), []);
});

test('U7 extractKeywords 数量上限与合并', () => {
  const kw = extractKeywords('请优化关于缓存失效的提示词', ['cache', 'redis']);
  assert.ok(kw.length >= 1 && kw.length <= 8, '数量应在 1-8');
  assert.ok(kw.includes('cache') || kw.includes('redis'), 'focus 应并入');
  assert.deepEqual(extractKeywords('', []), []);
  assert.deepEqual(extractKeywords('啊', null), []);
});

test('U14 shouldIgnoreFile 敏感过滤', () => {
  assert.equal(shouldIgnoreFile('.env'), true);
  assert.equal(shouldIgnoreFile('.env.local'), true);
  assert.equal(shouldIgnoreFile('config/credentials.json'), true);
  assert.equal(shouldIgnoreFile('keys/server.pem'), true);
  assert.equal(shouldIgnoreFile('id_rsa'), true);
  assert.equal(shouldIgnoreFile('app.log'), true);
  assert.equal(shouldIgnoreFile('node_modules/foo.js'), true);
  assert.equal(shouldIgnoreFile('dist/bundle.js'), true);
  assert.equal(shouldIgnoreFile('src/main.ts'), false);
  assert.equal(shouldIgnoreFile('src/parser.py'), false);
  assert.equal(shouldIgnoreFile('README.md'), false);
});

test('U3 rankFiles 排序与空关键词', () => {
  const files = ['src/deep/path/parser.py', 'parser_test.py', 'src/main.ts', 'docs/readme.md', 'package.json'];
  const top = rankFiles(files, ['parser'], 3);
  assert.ok(top.length >= 1 && top.length <= 3);
  assert.ok(top[0].path === 'parser_test.py', '文件名命中应最高分（浅路径）');
  // 空关键词 → 空列表
  assert.deepEqual(rankFiles(files, [], 3), []);
  assert.deepEqual(rankFiles(files, null, 3), []);
  // 敏感文件被过滤
  const withEnv = rankFiles(['.env', 'src/main.ts'], ['env'], 3);
  assert.ok(!withEnv.some((f) => f.path === '.env'), '敏感文件不进入候选');
});

test('U4 snippetFromLines 命中行与头部', () => {
  const lines = ['a', 'b', 'parser 命中行', 'c', 'd'];
  const s = snippetFromLines(lines, ['parser'], 800);
  assert.ok(s.includes('parser 命中行'), '应含命中行');
  assert.ok(s.includes('b') && s.includes('c'), '命中行 ±2 上下文');
  // 无命中取头部
  const s2 = snippetFromLines(['x', 'y', 'z'], ['nothing'], 800);
  assert.ok(s2.includes('x'), '无命中取头部');
  // 预算截断
  const long = snippetFromLines(['1234567890'], ['x'], 5);
  assert.ok(long.length <= 5, '输出 ≤ 预算');
  // 空输入
  assert.equal(snippetFromLines([], ['x'], 800), '');
  assert.equal(snippetFromLines(null, null, 800), '');
});

test('U5/U9/U10/U11 buildContextBlock 组装与优先级', () => {
  const progress = { task: '任务T', currentStep: '步骤S', completed: ['C1'] };
  const files = [{ path: 'a.py', snippet: '内容A' }];
  const events = ['事件E'];
  const block = buildContextBlock(progress, files, events, 4000);
  assert.ok(block.includes('任务T') && block.includes('a.py') && block.includes('事件E'));
  assert.ok(block.includes('【任务进度】') && block.includes('【相关项目文件】') && block.includes('【相关会话片段】'));
  // 预算 0 → 空
  assert.equal(buildContextBlock(progress, files, events, 0), '');
  assert.equal(buildContextBlock(progress, files, events, -1), '');
  // 极小预算：原文优先级——进度保留
  const tiny = buildContextBlock(progress, files, events, 60);
  assert.ok(tiny.length <= 60);
  assert.ok(tiny.includes('任务T') || tiny.length === 0, '进度段优先保留');
  // 部分组合
  assert.ok(buildContextBlock(progress, [], [], 4000).includes('【任务进度】'));
  assert.ok(buildContextBlock(null, files, [], 4000).includes('【相关项目文件】'));
  assert.ok(buildContextBlock(null, [], events, 4000).includes('【相关会话片段】'));
  assert.equal(buildContextBlock(null, [], [], 4000), '');
  // 中文/emoji 边界（不抛错）
  const emoji = buildContextBlock({ task: '任务😀', currentStep: '步骤🔧' }, [], [], 4000);
  assert.ok(emoji.includes('任务😀'));
});

test('U15 parseTaskProgress JSON 容错', () => {
  const good = parseTaskProgress('{"task":"T","currentStep":"S","completed":["C"],"focus":["F"]}');
  assert.equal(good.task, 'T');
  assert.equal(good.currentStep, 'S');
  assert.deepEqual(good.completed, ['C']);
  assert.deepEqual(good.focus, ['F']);
  // ```json 代码块包裹
  const fenced = parseTaskProgress('```json\n{"task":"T2","currentStep":"S2"}\n```');
  assert.equal(fenced.task, 'T2');
  // 前后缀噪音
  const noisy = parseTaskProgress('分析结果如下：\n{"task":"T3"}\n以上。');
  assert.equal(noisy.task, 'T3');
  // 损坏 JSON / 非 JSON → null
  assert.equal(parseTaskProgress('{bad json'), null);
  assert.equal(parseTaskProgress('hello world'), null);
  assert.equal(parseTaskProgress(''), null);
  assert.equal(parseTaskProgress(null), null);
  assert.equal(parseTaskProgress('{}'), null); // 缺必需字段
});

test('U46 computeEditDelta 行级修改摘要（v2.6.1）', () => {
  // 相同 → 空差异
  assert.deepEqual(computeEditDelta('相同内容', '相同内容'), { added: [], removed: [] });
  // 上一轮输出为空/缺失 → 空差异（无对比基线）
  assert.deepEqual(computeEditDelta('', '新内容'), { added: [], removed: [] });
  assert.deepEqual(computeEditDelta(null, '新内容'), { added: [], removed: [] });
  // 纯追加：尾部新增行
  const append = computeEditDelta('第一行\n第二行', '第一行\n第二行\n新增第三行');
  assert.deepEqual(append.removed, []);
  assert.deepEqual(append.added, ['新增第三行']);
  // 纯删除：移除中间行
  const del = computeEditDelta('第一行\n要删的行\n第三行', '第一行\n第三行');
  assert.deepEqual(del.removed, ['要删的行']);
  assert.deepEqual(del.added, []);
  // 中段修改（公共前缀/后缀剥离）：删除旧 + 新增新
  const mix = computeEditDelta('头\n旧A\n旧B\n尾', '头\n新A\n尾');
  assert.deepEqual(mix.removed, ['旧A', '旧B']);
  assert.deepEqual(mix.added, ['新A']);
  // 行数上限：增/删各 ≤ MEMORY_DELTA_LINES_MAX(6)
  const manyOld = Array.from({ length: 9 }, (_, i) => 'old' + i).join('\n');
  const manyNew = Array.from({ length: 9 }, (_, i) => 'new' + i).join('\n');
  const capped = computeEditDelta(manyOld, manyNew);
  assert.ok(capped.removed.length <= 6 && capped.added.length <= 6);
});

test('U47 buildMemoryDeltaHint 修改摘要格式化（v2.6.1）', () => {
  // 空差异 → 空串
  assert.equal(buildMemoryDeltaHint({ added: [], removed: [] }), '');
  assert.equal(buildMemoryDeltaHint(null), '');
  assert.equal(buildMemoryDeltaHint({ added: ['a'], removed: undefined }), '');
  // 仅新增
  const addOnly = buildMemoryDeltaHint({ added: ['加了约束'], removed: [] });
  assert.ok(addOnly.includes('+新增：加了约束'));
  assert.equal(addOnly.includes('-删除：'), false);
  // 仅删除
  const delOnly = buildMemoryDeltaHint({ added: [], removed: ['删了示例'] });
  assert.ok(delOnly.includes('-删除：删了示例'));
  assert.equal(delOnly.includes('+新增：'), false);
  // 双侧 + 多行以「；」连接
  const both = buildMemoryDeltaHint({ added: ['a', 'b'], removed: ['c'] });
  assert.ok(both.includes('+新增：a；b') && both.includes('-删除：c'));
  // 字符上限 ≤ MEMORY_DELTA_MAX(300)
  const huge = buildMemoryDeltaHint({ added: ['x'.repeat(200)], removed: ['y'.repeat(200)] });
  assert.ok(huge.length <= MEMORY_DELTA_MAX);
});

test('U48 buildChatMessages 记忆链真多轮消息（v2.6.1）', () => {
  // 无记忆链 → 仅最终 user 消息（与旧单消息一致）
  const single = buildChatMessages([], '请优化：abc', 'id', 4000);
  assert.equal(single.messages.length, 1);
  assert.equal(single.messages[0].role, 'user');
  assert.equal(single.messages[0].content[0].text, '请优化：abc');
  assert.equal(single.memChars, 0);
  // 两轮 → user/assistant 交替 + 最终 user；时间序
  const two = buildChatMessages([
    { input: 'i1', output: 'o1' },
    { input: 'i2', output: 'o2' },
  ], 'final', 'enh', 4000);
  assert.deepEqual(two.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(two.messages.map((m) => m.content[0].text), ['i1', 'o1', 'i2', 'o2', 'final']);
  assert.equal(new Set(two.messages.map((m) => m.id)).size, 5, 'id 唯一');
  assert.equal(two.messages[1].source.kind, 'assistant');
  // 预算 0 → 无历史消息（仅最终）
  const zero = buildChatMessages([{ input: 'i1', output: 'o1' }], 'final', 'enh', 0);
  assert.equal(zero.messages.length, 1);
  assert.equal(zero.memChars, 0);
  // 预算截断：历史文本合计 ≤ min(budget, MEMORY_CHAIN_BUDGET_MAX)
  const big = buildChatMessages([{ input: 'x'.repeat(5000), output: 'y'.repeat(5000) }], 'final', 'enh', 4000);
  assert.equal(big.messages[0].content[0].text.length, 800, '输入截到 2400/3');
  assert.equal(big.messages[1].content[0].text.length, 1600, '输出截到 2400*2/3');
  assert.equal(big.memChars, MEMORY_CHAIN_BUDGET_MAX);
  // 轮数上限：>4 轮只取最近 4 轮
  const five = [];
  for (let i = 1; i <= 5; i++) five.push({ input: 'in' + i, output: 'out' + i });
  const capped = buildChatMessages(five, 'final', 'enh', 4000);
  assert.equal(capped.messages.length, 9, '4 轮 ×2 + 最终');
  assert.equal(capped.messages[0].content[0].text, 'in2');
  assert.equal(capped.messages[7].content[0].text, 'out5');
});

test('U13 既有用例回归计数', () => {
  // 此用例仅占位：既有 13 项由上方用例共同构成，node --test 汇总 pass 数
  assert.ok(true);
});

// ================= v2.4.0 版本检测与一键更新 · 纯函数用例 =================
// 方案「插件版本检测与一键更新方案.md」§2/§3：版本比较 / 归一化 / 检测目标。

test('U30 PLUGIN_VERSION / UPDATE_MANIFEST 常量', () => {
  assert.match(PLUGIN_VERSION, /^\d+\.\d+\.\d+$/, '本地版本须为纯 semver（v 前缀不保留）');
  assert.deepEqual(UPDATE_MANIFEST, ['plugin-host.js', 'plugin-client.js', 'README.md', 'README.en.md', 'LICENSE', 'cordis.patch.yml']);
});

test('U31 parseVersion 归一化', () => {
  assert.deepEqual(parseVersion('v2.4.0').seg, [2, 4, 0]);
  assert.equal(parseVersion('v2.4.0').pre, null);
  assert.equal(parseVersion('2.4').seg[2], 0, '缺段补 0');
  assert.deepEqual(parseVersion('V1.2.3').seg, [1, 2, 3], '大写 V 前缀可去');
  assert.deepEqual(parseVersion('2.4.0-rc.1').pre, ['rc', 1], '预发布：数值段转 number');
  assert.deepEqual(parseVersion('2.4.0+build5').seg, [2, 4, 0], 'build 元数据剥离');
  assert.equal(parseVersion('master').ok, false);
  assert.equal(parseVersion('').ok, false);
  assert.equal(parseVersion('  ').ok, false);
  assert.equal(parseVersion('1.2.3.4').ok, false, '超过 3 段非法');
  assert.equal(parseVersion('2.x').ok, false);
  assert.equal(parseVersion(null).ok, false);
});

test('U32 compareVersions semver 比较', () => {
  assert.equal(compareVersions('2.4.0', '2.3.3'), 1);
  assert.equal(compareVersions('1.9.9', '2.0.0'), -1);
  assert.equal(compareVersions('2.4.0', '2.4.0'), 0);
  assert.equal(compareVersions('2.4', '2.4.0'), 0, '缺段等价');
  assert.equal(compareVersions('2.4.0', '2.4.0-rc.1'), 1, '无预发布 > 有预发布');
  assert.equal(compareVersions('2.4.0-rc.1', '2.4.0-rc.2'), -1);
  assert.equal(compareVersions('2.4.0-alpha.1', '2.4.0-rc.1'), -1, '字符串段字典序');
  assert.equal(compareVersions('2.4.0-rc', '2.4.0-rc.1'), -1, '前缀相同短者更小');
  assert.equal(compareVersions('master', '2.0.0'), null, '无法解析 → null');
});

test('U33 versionStatus 状态判定', () => {
  assert.equal(versionStatus('2.3.3', '2.4.0'), 'outdated');
  assert.equal(versionStatus('2.4.0', '2.4.0'), 'current');
  assert.equal(versionStatus('2.4.0', '2.3.3'), 'current', '本地领先仍为 current');
  assert.equal(versionStatus('x', '2.0.0'), 'unknown');
  assert.equal(versionStatus('2.0.0', 'y'), 'unknown');
});

test('U34 normalizeRepo / isValidTag 白名单', () => {
  assert.equal(normalizeRepo('Fishsb/dsh-prompt-enhancer'), 'Fishsb/dsh-prompt-enhancer');
  assert.equal(normalizeRepo('  a/b  '), 'a/b', '两侧空白去除');
  assert.equal(normalizeRepo('a'), null);
  assert.equal(normalizeRepo('a/b/c'), null);
  assert.equal(normalizeRepo('../x'), null);
  assert.equal(normalizeRepo('a/' + 'x'.repeat(100)), null, '超长非法');
  assert.equal(normalizeRepo(''), null);
  assert.equal(isValidTag('v2.4.0'), true);
  assert.equal(isValidTag('2.4.0-rc.1'), true);
  assert.equal(isValidTag('v2.4.0/evil'), false, '斜杠拒绝');
  assert.equal(isValidTag('..'), false);
  assert.equal(isValidTag('a b'), false, '空白拒绝');
});

test('U35 pickMaxTag 取最大可解析版本', () => {
  const tags = [{ name: 'v1.0.0' }, { name: 'v2.3.3' }, { name: 'release-candidate' }, { name: 'v2.4.0' }];
  assert.deepEqual(pickMaxTag(tags), { raw: 'v2.4.0', version: '2.4.0' });
  assert.deepEqual(pickMaxTag([{ name: 'v2.4.0-rc.1' }, { name: 'v2.4.0' }]), { raw: 'v2.4.0', version: '2.4.0' });
  assert.equal(pickMaxTag([{ name: 'master' }, { name: 'nightly' }]), null, '全不可解析 → null');
  assert.equal(pickMaxTag([]), null);
  assert.equal(pickMaxTag(null), null);
});

test('U36 defaultDirFor', () => {
  assert.equal(defaultDirFor('D:\\lk\\deepseek', 'v2.4.0'), 'D:\\lk\\deepseek/dsh-prompt-enhancer-v2.4.0');
  assert.equal(defaultDirFor('D:\\lk\\deepseek\\', 'v2.4.0'), 'D:\\lk\\deepseek/dsh-prompt-enhancer-v2.4.0', '尾部斜杠归一');
  assert.equal(defaultDirFor('', 'v2.4.0'), '');
  assert.equal(defaultDirFor(null, 'v2.4.0'), '');
});

test('U37 parseTagsPayload / validateManifestFiles（v2.4.1 新契约）', () => {
  // parseTagsPayload：JSON 数组文本 → 数组；非法/非数组 → null
  assert.equal(parseTagsPayload('[{"name":"v2.4.0"}]')[0].name, 'v2.4.0');
  assert.equal(parseTagsPayload('{"message":"Not Found"}'), null, 'GitHub 错误对象非数组 → null');
  assert.equal(parseTagsPayload('not json'), null);
  assert.equal(parseTagsPayload(''), null);
  assert.equal(parseTagsPayload(null), null);
  // validateManifestFiles：恰好 6 个清单文件、无重复/多余、内容 ≤1MB
  const okFiles = UPDATE_MANIFEST.map((name) => ({ name, content: 'x' }));
  const r1 = validateManifestFiles(okFiles);
  assert.equal(r1.ok, true);
  assert.equal(r1.files.length, 6);
  assert.equal(validateManifestFiles(okFiles.slice(0, 5)).ok, false, '缺文件');
  assert.equal(validateManifestFiles(okFiles.concat([{ name: 'extra.js', content: 'x' }])).ok, false, '多余文件');
  assert.equal(validateManifestFiles([...okFiles, { name: 'LICENSE', content: 'dup' }]).ok, false, '重复文件');
  assert.equal(validateManifestFiles([{ name: 'plugin-host.js', content: 'x'.repeat(1000001) }]).ok, false, '超 1MB');
  assert.equal(validateManifestFiles(null).ok, false);
  assert.equal(validateManifestFiles([{ name: 'plugin-host.js' }]).ok, false, '缺 content');
});

test('U38 analyzeInputRules（v2.4.4 lite 规则引擎：目标/约束/格式/示例 要素检查）', () => {
  // 全要素输入 → 无缺失、无建议
  const full = analyzeInputRules('请生成一份 JSON 格式的月度报告，不超过 500 字，不要包含财务数据，例如输入输出对样例');
  assert.equal(full.suggestions.length, 0, '全要素应无缺失');
  // 目标缺失：无任务动词的模糊文本
  const noGoal = analyzeInputRules('关于天气的说明文字');
  assert.ok(noGoal.missing.some((m) => m.key === 'goal'), '应检出目标缺失');
  // 约束缺失：有目标无限制
  const noConstraint = analyzeInputRules('帮我写一个排序算法');
  assert.ok(noConstraint.missing.some((m) => m.key === 'constraints'), '应检出约束缺失');
  assert.ok(noConstraint.missing.some((m) => m.key === 'format'), '应检出格式缺失');
  // 数字约束命中：长度上限
  const withLen = analyzeInputRules('写一段话，不超过 50 字');
  assert.ok(!withLen.missing.some((m) => m.key === 'constraints'), '长度约束应命中');
  // 示例命中：示例词
  const withExample = analyzeInputRules('翻译下面内容，示例：hello → 你好');
  assert.ok(!withExample.missing.some((m) => m.key === 'example'), '示例应命中');
  // 空输入 → 全部缺失
  const empty = analyzeInputRules('');
  assert.equal(empty.missing.length, 4, '空输入应四项全缺');
  // 建议与缺失一一对应
  const paired = analyzeInputRules('随便');
  assert.equal(paired.suggestions.length, paired.missing.length, '建议数应等于缺失数');
});

// v2.4.5（语义保真修正）：SYSTEM_PROMPT 关键契约断言 + lite 规则保守化断言。
// SYSTEM_PROMPT 定义在 PURE 区段之前，此处直接从源码文本求值（单一事实源）。
test('U39 SYSTEM_PROMPT 语义保真契约 + lite 规则保守化（v2.4.5）', () => {
  // —— 从源码提取 SYSTEM_PROMPT 数组并求值 ——
  const m = src.match(/const SYSTEM_PROMPT = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'SYSTEM_PROMPT array not found');
  const systemText = new Function('return [' + m[1] + '].join(\'\\n\');')();
  // 语义保真核心契约
  assert.ok(systemText.includes('理解原文（第一优先'), '应含「理解原文（第一优先）」阶段');
  assert.ok(systemText.includes('语义等价是底线'), '应含「语义等价是底线」');
  assert.ok(systemText.includes('不得歪曲、臆造、遗漏原文任何已明确的信息'), '硬性约束应含禁臆造');
  assert.ok(systemText.includes('保持对外调用方式与原有功能不变'), '示例 3 语义保真示范应在');
  assert.ok(systemText.includes('示例 4'), '应含 4 条示例');
  // 删除旧版矛盾约束（曾诱导删细节/臆造）
  assert.ok(!systemText.includes('只写"做什么"，不解释"怎么做"'), '应删除「只写做什么不解释怎么做」（与示例矛盾，诱导删细节）');
  assert.ok(!systemText.includes('补充缺失的必要上下文'), '应删除「补充缺失的必要上下文」（诱导臆造）');
  assert.ok(!systemText.includes('优化后的提示词不超过 800 字符'), '长度约束应改为服从语义保真');
  // 长度新表述与主体语言规则
  assert.ok(systemText.includes('长度服从语义保真'), '应含「长度服从语义保真」');
  assert.ok(systemText.includes('输入以中文为主体则输出必须为中文'), '语言规则应为「主体语言」');
  // —— lite 规则保守化：建议不再诱导添加新要求 ——
  const cons = analyzeInputRules('帮我写一个排序算法');
  const consHint = cons.suggestions.find((s) => s.includes('约束')) || '';
  assert.ok(consHint.includes('仅当原文语义暗示需要限制'), '约束建议应保守（不诱导硬加约束）');
  assert.ok(!consHint.includes('请在优化结果中补充合理约束'), '约束建议不应含旧版诱导措辞');
  const goal = analyzeInputRules('关于天气的说明文字');
  const goalHint = goal.suggestions.find((s) => s.includes('目标')) || '';
  assert.ok(goalHint.includes('推断不出时保持原文表述，不得臆造'), '目标建议应保守（不臆造目标）');
});

// v2.4.6（提示词外置）：prompts/*.md 为事实源，plugin-host.js 生成区由
// scripts/sync-prompts.mjs 生成。U40 断言三者一致（生成区 = md 逐行求值），
// 防「改了 md 忘同步 / 手改生成区」两类漂移。
test('U40 prompts 外置一致性（v2.4.6）：生成区 = prompts/*.md 逐行求值', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  // 生成区三常量的提取（与脚本 SOURCES 顺序一致）
  const extractConst = (name) => {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\n\\];'));
    assert.ok(m, name + ' array not found in generated block');
    return new Function('return [' + m[1] + '].join(\'\\n\');')();
  };
  const mdOf = (file) => {
    const lines = readFileSync(join(__dirname, '..', 'prompts', file), 'utf8').split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join('\n');
  };
  // 生成区必须处于 ==PROMPTS-BEGIN== / ==PROMPTS-END== 标记内
  assert.ok(src.includes('// ==PROMPTS-BEGIN=='), '应含生成区起始标记');
  assert.ok(src.includes('// ==PROMPTS-END=='), '应含生成区结束标记');
  // 逐文件核对：生成常量 === md 内容
  assert.equal(extractConst('SYSTEM_PROMPT'), mdOf('system.md'), 'SYSTEM_PROMPT 应与 prompts/system.md 一致');
  assert.equal(extractConst('TASK_ANALYSIS_PROMPT'), mdOf('task-analysis.md'), 'TASK_ANALYSIS_PROMPT 应与 prompts/task-analysis.md 一致');
  assert.equal(extractConst('CONTEXT_GUARD'), mdOf('context-guard.md'), 'CONTEXT_GUARD 应与 prompts/context-guard.md 一致');
});

// v2.4.7（每模式独立自定义模板）：validateConfig 对 template.texts 的解析与迁移契约。
test('U41 template.texts 每模式解析/迁移/超长忽略（v2.4.7）', () => {
  // ① 新结构 texts：按模式白名单解析，未给键保持空串
  const per = validateConfig({ template: { mode: 'custom', texts: { base: 'B模板', smart: 'S模板' } } });
  assert.equal(per.templateMode, 'custom');
  assert.equal(per.templateTexts.base, 'B模板', 'base 模式自定义文本应解析');
  assert.equal(per.templateTexts.smart, 'S模板', 'smart 模式自定义文本应解析');
  assert.equal(per.templateTexts.lite, '', '未给键应保持空串');
  assert.equal(per.templateTexts.standard, '', '未给键应保持空串');
  // ② 非法键忽略（不在 4 模式白名单）
  const badKey = validateConfig({ template: { mode: 'custom', texts: { foo: 'x', 'base:extra': 'y' } } });
  assert.equal(badKey.templateTexts.base, '', '非法键应忽略');
  assert.equal(badKey.templateTexts.smart, '', '非法键应忽略');
  // ③ 超长忽略（>4000 不采用）
  const tooLong = validateConfig({ template: { mode: 'custom', texts: { base: 'x'.repeat(4001) } } });
  assert.equal(tooLong.templateTexts.base, '', '超长文本应忽略');
  // ④ 旧全局 templateText 迁移：无 texts 时复制到全部 4 模式（保持"全局一份"语义）
  const legacy = validateConfig({ template: { mode: 'custom', templateText: '旧全局模板' } });
  assert.equal(legacy.templateTexts.base, '旧全局模板', '旧 templateText 应迁移到 base');
  assert.equal(legacy.templateTexts.lite, '旧全局模板', '旧 templateText 应迁移到 lite');
  assert.equal(legacy.templateTexts.standard, '旧全局模板', '旧 templateText 应迁移到 standard');
  assert.equal(legacy.templateTexts.smart, '旧全局模板', '旧 templateText 应迁移到 smart');
  // ⑤ 无自定义 → 全空（enhance 按模式回退内置 SYSTEM_PROMPT）
  const none = validateConfig({ template: { mode: 'builtin' } });
  assert.equal(none.templateTexts.base, '', 'builtin 无自定义文本');
  assert.equal(none.templateTexts.smart, '', 'builtin 无自定义文本');
  // ⑥ texts 存在时旧 templateText 不覆盖 texts（新结构优先）
  const both = validateConfig({ template: { mode: 'custom', templateText: '旧', texts: { base: '新' } } });
  assert.equal(both.templateTexts.base, '新', 'texts 存在时优先新结构');
  assert.equal(both.templateTexts.lite, '', 'texts 存在时旧值不扩散到其他模式');
  // ⑦ v2 结构 template.mode/template.text（v2.4.7 修复：此前 v2 结构自定义模板不生效）
  const v2 = validateConfig({ template: { mode: 'custom', text: 'v2文本' } });
  assert.equal(v2.templateMode, 'custom', 'v2 结构 template.mode 应解析');
  assert.equal(v2.templateTexts.base, 'v2文本', 'v2 结构 template.text 应迁移到全部模式');
  assert.equal(v2.templateTexts.smart, 'v2文本', 'v2 结构 template.text 应迁移到全部模式');
});

// v2.5.0（一键更新并重启）：安装命令构造契约。
test('U42 buildInstallArgs 命令构造（v2.5.0）', () => {
  const args = buildInstallArgs('D:\\dsh\\bin.js', 'v2.5.0', 'web');
  assert.deepEqual(args, [
    'D:\\dsh\\bin.js', 'plugin', '--profile', 'web', 'add', 'github:Fishsb/dsh-prompt-enhancer#v2.5.0',
  ], '命令数组形态：node <dshBin> plugin --profile <p> add github:Fishsb/dsh-prompt-enhancer#<tag>');
  // tag 形态透传（含无 v 前缀；lib 层 isInstallArgs 另有正则把关，此处仅契约构造）
  const noV = buildInstallArgs('bin', '2.4.8', 'web');
  assert.equal(noV[5], 'github:Fishsb/dsh-prompt-enhancer#2.4.8', '无 v 前缀 tag 原样拼接');
  // profile 透传
  const p = buildInstallArgs('bin', 'v1.0.0', 'custom-profile');
  assert.equal(p[3], 'custom-profile', 'profile 透传');
  // 固定 repo：任何 tag 都只能拼到 Fishsb/dsh-prompt-enhancer
  assert.match(args[5], /^github:Fishsb\/dsh-prompt-enhancer#/, 'repo 固定');
});

// v2.6.0：重启计划契约（独立执行器使用——参数对象，不再拼接 cmd 链；
// timeout 在非交互环境立即返回的教训：缓冲由执行器 node setTimeout 保证）。
test('U43 buildRestartPlan 重启计划（v2.6.0）', () => {
  const plan = buildRestartPlan('dsh-web', 3080, 5);
  assert.deepEqual(plan, { serviceName: 'dsh-web', port: 3080, maxAttempts: 5 }, '参数对象：svc/port/attempts');
  const p2 = buildRestartPlan('dsh-web-alt', 3090, 3);
  assert.equal(p2.serviceName, 'dsh-web-alt', 'serviceName 透传');
  assert.equal(p2.port, 3090, 'port 透传');
  assert.equal(p2.maxAttempts, 3, 'maxAttempts 透传');
});

// v2.5.0：PATH 合并契约（系统 PATH + 用户 PATH）。
test('U44 mergeEnvPath PATH 合并去重（v2.5.0）', () => {
  assert.equal(mergeEnvPath('C:\\A;C:\\B', 'C:\\B;D:\\C'), 'C:\\A;C:\\B;D:\\C', '大小写不敏感去重且保留顺序');
  assert.equal(mergeEnvPath('C:\\A', 'C:\\a;D:\\x'), 'C:\\A;D:\\x', '重复段忽略（含大小写差异）');
  assert.equal(mergeEnvPath('C:\\A', ''), 'C:\\A', '空用户 PATH 原样返回');
  assert.equal(mergeEnvPath('', 'D:\\x'), 'D:\\x', '空系统 PATH 仅用户 PATH');
  assert.equal(mergeEnvPath('C:\\A;;D:\\B', ''), 'C:\\A;D:\\B', '空段忽略');
});

// v2.5.0：环境探测计划契约（与 lib/index.cjs probeEnv 的 key 一一对应）。
// v2.7.0：收敛为执行器（独立 detached 进程）重启阶段直接依赖 4 项。
test('U45 ENV_PROBE_KEYS 探测计划（v2.7.0 收敛）', () => {
  assert.ok(Array.isArray(ENV_PROBE_KEYS) && ENV_PROBE_KEYS.length === 4, '探测项 4 个（v2.7.0 收敛为执行器重启阶段依赖）');
  const keys = ENV_PROBE_KEYS.map((e) => e.key);
  assert.equal(new Set(keys).size, 4, 'key 唯一');
  for (const e of ENV_PROBE_KEYS) {
    assert.ok(['block', 'warn'].includes(e.level), 'level 合法: ' + e.key);
  }
  assert.ok(keys.includes('service') && keys.includes('svc-type')
    && keys.includes('svc-bin') && keys.includes('port'),
    '4 项 key 与 probeEnv 一致');
  assert.equal(keys.includes('account'), false, 'account 已清理（启动账号与 sc start 无关）');
  assert.equal(keys.includes('restart'), false, 'restart 已清理（KillProcessTree 不影响独立执行器）');
  const json = JSON.stringify(ENV_PROBE_KEYS);
  assert.ok(!/proxy|password|token|secret/i.test(json), '计划不含敏感字段');
});
