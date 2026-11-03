'use strict';

// 目标模式：增强 assemble 阶段的语义锁（消息组装 / 记忆 / 继续模式 / 日志）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createAssembleStage } = require('../src/host/enhance-assemble.cjs');

function makeStage(overrides) {
  const logs = [];
  const progress = [];
  const deps = {
    setProgress: (rec, stage) => progress.push([rec, stage]),
    hlog: (...args) => logs.push(args.join(' ')),
    wrapUserText: (text) => 'USER(' + text + ')',
    wrapPublishText: (text) => 'PUBLISH(' + text + ')',
    buildMemoryDeltaHint: (delta) => (delta && delta.added && delta.added.length ? 'HINT(' + delta.added.join('|') + ')' : ''),
    buildChatMessages: (rounds, finalText, id, budget) => ({
      messages: [{ id, role: 'user', content: [{ type: 'text', text: finalText }] }],
      memChars: rounds.length + ':' + budget,
    }),
    stageContext: 'context',
    continuePrompt: 'CONTINUE',
  };
  return { stage: createAssembleStage(Object.assign(deps, overrides || {})).enhanceStageAssemble, logs, progress };
}

function baseState(overrides) {
  return Object.assign({
    args: {}, sessionId: 's', seq: 3, text: '原文', rec: {},
    cfg: { mode: 'base', context: { budgetChars: 1200 } },
    chain: [{ provider: 'p', model: 'm' }], system: 'SYS',
    memRounds: [], memoryActive: false, memDelta: null,
    v2Block: '', v2Log: 'none', isContinuation: false,
    timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000, isPublish: false,
  }, overrides || {});
}

test('HAS-01 常规布局：进度、包装、v2 块、单条消息与配置日志', async () => {
  const { stage, logs, progress } = makeStage();
  const out = await stage(baseState({ v2Block: 'REF', v2Log: 'rounds=1-1' }));
  assert.equal(progress.length, 1);
  assert.equal(progress[0][1], 'context');
  assert.equal(out.messages.length, 1);
  assert.equal(out.messages[0].id, 'enhance-s-3');
  assert.equal(out.messages[0].content[0].text, 'REF\n\nUSER(原文)');
  assert.match(logs[0], /mode=base/);
  assert.match(logs[0], /ctx=rounds=1-1/);
});

test('HAS-02 publish 使用中性包装；seed 仅影响日志标签', async () => {
  const { stage, logs } = makeStage();
  const out = await stage(baseState({ isPublish: true, args: { seed: true }, cfg: { mode: 'publish', context: { budgetChars: 0 } } }));
  assert.equal(out.messages[0].content[0].text, 'PUBLISH(原文)');
  assert.match(logs[0], /mode=publish\(seed\)/);
});

test('HAS-03 继续模式：system 追加提示词，finalText 以本轮修改为主方向', async () => {
  const { stage } = makeStage();
  const out = await stage(baseState({ isContinuation: true, memoryActive: true, memRounds: [{ input: 'i', output: 'o' }], memDelta: { added: ['加约束'], removed: [] } }));
  assert.equal(out.system, 'SYS\n\nCONTINUE');
  const text = out.messages[0].content[0].text;
  assert.match(text, /^【本轮修改】（主要优化方向）\nHINT\(加约束\)/);
  assert.match(text, /【当前提示词】\n"""\n原文\n"""/);
});

test('HAS-04 记忆模式：delta 加在最终输入前，memChars 来自纯函数且日志标明 delta', async () => {
  const { stage, logs } = makeStage();
  const out = await stage(baseState({ memoryActive: true, memRounds: [{ input: 'i', output: 'o' }], memDelta: { added: ['a'], removed: [] } }));
  assert.equal(out.messages[0].content[0].text, 'HINT(a)\n\nUSER(原文)');
  assert.match(logs[0], /memory rounds=1 chars=1:1200 delta=yes/);
});

test('HAS-05 产物内联 assemble 模块，阶段名仍注册为 assemble', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/enhance-assemble.cjs"'));
  assert.ok(host.includes('"src/host/enhance-assemble.cjs"'));
  assert.ok(host.includes("registerEnhanceStage('assemble', enhanceStageAssemble"));
  assert.equal((host.match(/require\(/g) || []).length, 0);
});
