'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ENHANCE_STAGES, ENHANCE_STAGE_ORDER, isEnhanceStage, nextEnhanceStage } = require('../src/shared/contracts/enhance-stages.cjs');

test('ENHST-01 阶段顺序固定', () => {
  assert.deepEqual(ENHANCE_STAGE_ORDER, ['analyze', 'retrieve', 'assemble', 'llm', 'commit']);
});

test('ENHST-02 阶段表冻结', () => {
  assert.equal(Object.isFrozen(ENHANCE_STAGES), true);
  assert.equal(Object.isFrozen(ENHANCE_STAGE_ORDER), true);
});

test('ENHST-03 合法阶段判定', () => {
  assert.equal(isEnhanceStage(ENHANCE_STAGES.ANALYZE), true);
  assert.equal(isEnhanceStage('llm'), true);
  assert.equal(isEnhanceStage(''), false);
});

test('ENHST-04 下一阶段', () => {
  assert.equal(nextEnhanceStage('analyze'), 'retrieve');
  assert.equal(nextEnhanceStage('retrieve'), 'assemble');
  assert.equal(nextEnhanceStage('assemble'), 'llm');
  assert.equal(nextEnhanceStage('llm'), 'commit');
  assert.equal(nextEnhanceStage('commit'), null);
  assert.equal(nextEnhanceStage('unknown'), null);
});
