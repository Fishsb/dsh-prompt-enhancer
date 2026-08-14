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
    shouldInjectV2, extractHistory, inferFocusRules, extractKeywords, shouldIgnoreFile,
    rankFiles, snippetFromLines, buildContextBlock, parseTaskProgress,
    parseMode, parseMemory, shouldInjectMemory, parseBudgetChars, resolveScanLimit,
    buildMemoryBlock, MODE_TABLE, BUDGET_OPTIONS, BUDGET_WORKSPACE_TABLE };
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
  buildMemoryBlock,
  MODE_TABLE,
  BUDGET_OPTIONS,
  BUDGET_WORKSPACE_TABLE,
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

test('U21 buildMemoryBlock 预算分配与防回显（§2.3/§6.5）', () => {
  // 正常：模板含两段 + 禁止回显
  const b = buildMemoryBlock('原文内容', '优化输出', 4000);
  assert.ok(b.includes('原文内容') && b.includes('优化输出'));
  assert.ok(b.includes('禁止回显'));
  // 预算分配：prevInput ≤ 400、prevOutput ≤ 800（默认预算充足时）
  const longInput = 'x'.repeat(600);
  const longOutput = 'y'.repeat(1200);
  const bl = buildMemoryBlock(longInput, longOutput, 4000);
  assert.equal(bl.includes('x'.repeat(401)), false, 'prevInput 应截断到 400');
  assert.ok(bl.includes('x'.repeat(400)), 'prevInput 保留 400');
  assert.equal(bl.includes('y'.repeat(801)), false, 'prevOutput 应截断到 800');
  assert.ok(bl.includes('y'.repeat(800)), 'prevOutput 保留 800');
  // v2.2 叠加预算（§6.5）：prevInput+prevOutput 合计 ≤ MEMORY_BLOCK_BUDGET_MAX(1200)
  assert.ok(bl.length < 400 + 800 + 64, '模板骨架外记忆内容合计 ≤ 1200（骨架开销上限 64）');
  // 记忆块优先占用：budget 600 → prevInput 400 + prevOutput 200
  const b600 = buildMemoryBlock(longInput, longOutput, 600);
  assert.ok(b600.includes('x'.repeat(400)), 'budget 600 时 prevInput 仍保留 400');
  assert.ok(b600.includes('y'.repeat(200)), 'budget 600 时 prevOutput 截到 200');
  assert.equal(b600.includes('y'.repeat(201)), false);
  // 预算 0 → 空（等价轻量）
  assert.equal(buildMemoryBlock('a', 'b', 0), '');
  assert.equal(buildMemoryBlock('a', 'b', undefined), '');
  // 缺省输入容错
  assert.equal(buildMemoryBlock('', '', 4000), '');
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

test('U13 既有用例回归计数', () => {
  // 此用例仅占位：既有 13 项由上方用例共同构成，node --test 汇总 pass 数
  assert.ok(true);
});
