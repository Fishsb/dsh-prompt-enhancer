'use strict';

// 增强阶段执行器（目标模式：普通模块）的契约测试。
// 内部阶段为 analyze / retrieve / assemble / llm / commit；
// 线上 enhance/progress 的既有 stage 名仍保持 llm，不暴露内部 commit。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnhancePipeline } = require('../src/host/enhance-pipeline.cjs');
const { ENHANCE_STAGE_ORDER } = require('../src/shared/contracts/enhance-stages.cjs');

test('ENHP-01 默认阶段顺序来自共享契约', () => {
  const pipeline = createEnhancePipeline();
  assert.deepEqual(pipeline.stages(), ENHANCE_STAGE_ORDER);
  assert.deepEqual(pipeline.stages(), ['analyze', 'retrieve', 'assemble', 'llm', 'commit']);
});

test('ENHP-02 runAll 按顺序执行并传递状态', async () => {
  const pipeline = createEnhancePipeline();
  const seen = [];
  for (const name of ENHANCE_STAGE_ORDER) {
    pipeline.register(name, async (state) => {
      seen.push(name);
      return { ...state, trace: state.trace.concat(name) };
    });
  }
  const out = await pipeline.runAll({ trace: [] });
  assert.deepEqual(seen, ['analyze', 'retrieve', 'assemble', 'llm', 'commit']);
  assert.deepEqual(out.trace, ['analyze', 'retrieve', 'assemble', 'llm', 'commit']);
});

test('ENHP-03 同阶段多个处理器按 priority 升序执行', async () => {
  const pipeline = createEnhancePipeline();
  const seen = [];
  pipeline.register('assemble', (s) => { seen.push('late'); return s; }, { priority: 100 });
  pipeline.register('assemble', (s) => { seen.push('early'); return s; }, { priority: 10 });
  await pipeline.run('assemble', {});
  assert.deepEqual(seen, ['early', 'late']);
  assert.equal(pipeline.handlersFor('assemble').length, 2);
});

test('ENHP-04 未知阶段 / 非函数处理器 fail-closed', () => {
  const pipeline = createEnhancePipeline();
  assert.throws(() => pipeline.register('unknown', () => {}), /unknown stage/);
  assert.throws(() => pipeline.register('analyze', null), /handler must be a function/);
  assert.throws(() => pipeline.handlersFor('generate'), /unknown stage/);
});

test('ENHP-05 阶段处理器的错误原样上抛，不吞成成功', async () => {
  const pipeline = createEnhancePipeline();
  pipeline.register('retrieve', async () => { throw new Error('SENTINEL-STAGE-FAIL'); });
  await assert.rejects(() => pipeline.runAll({}), /SENTINEL-STAGE-FAIL/);
});
