'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plan = require('../src/shared/voice/postprocess-plan.cjs');

test('POSTPLAN-01 全关 => 空计划（零动作）', () => {
  assert.deepEqual(plan.planVoicePostprocess({}).steps, []);
  assert.deepEqual(plan.planVoicePostprocess(null).steps, []);
  assert.deepEqual(plan.planVoicePostprocess({
    fillerEnabled: false,
    correctionEnabled: false,
    autoEnhanceEnabled: false,
  }).steps, []);
});

test('POSTPLAN-02 三项独立开关按固定顺序展开', () => {
  assert.deepEqual(plan.planVoicePostprocess({ fillerEnabled: true }).steps, ['filler']);
  assert.deepEqual(plan.planVoicePostprocess({ correctionEnabled: true }).steps, ['correction']);
  assert.deepEqual(plan.planVoicePostprocess({ autoEnhanceEnabled: true }).steps, ['enhance']);
  assert.deepEqual(plan.planVoicePostprocess({
    fillerEnabled: true,
    correctionEnabled: true,
    autoEnhanceEnabled: true,
  }).steps, ['filler', 'correction', 'enhance']);
});

test('POSTPLAN-03 用户矩阵：纠错开 + 增强关 => 绝不出现 enhance', () => {
  const p = plan.planVoicePostprocess({
    fillerEnabled: true,
    correctionEnabled: true,
    autoEnhanceEnabled: false,
  });
  assert.deepEqual(p.steps, ['filler', 'correction']);
  assert.equal(p.hasEnhance, false);
  assert.equal(plan.voicePostprocessHas(p, 'enhance'), false);
});

test('POSTPLAN-04 用户矩阵：纠错开 + 增强开 => 纠错先于增强', () => {
  const p = plan.planVoicePostprocess({
    fillerEnabled: false,
    correctionEnabled: true,
    autoEnhanceEnabled: true,
  });
  assert.deepEqual(p.steps, ['correction', 'enhance']);
  assert.equal(p.correctionBeforeEnhance, true);
});

test('POSTPLAN-05 计划是冻结的，调用方不能就地改写顺序', () => {
  const p = plan.planVoicePostprocess({ fillerEnabled: true, correctionEnabled: true });
  assert.equal(Object.isFrozen(p), true);
  assert.equal(Object.isFrozen(p.steps), true);
  assert.throws(() => { p.steps.push('enhance'); }, TypeError);
});

test('POSTPLAN-06 只认严格 true；字符串/数字/缺省一律视为关（与既有配置取形同口径）', () => {
  const p = plan.planVoicePostprocess({
    fillerEnabled: 'true',
    correctionEnabled: 1,
    autoEnhanceEnabled: 'yes',
  });
  assert.deepEqual(p.steps, []);
});

test('POSTPLAN-07 步骤游标：next 只按计划返回，越界返回 null', () => {
  const p = plan.planVoicePostprocess({ fillerEnabled: true, correctionEnabled: true });
  assert.equal(plan.voicePostprocessNext(p, 0), 'filler');
  assert.equal(plan.voicePostprocessNext(p, 1), 'correction');
  assert.equal(plan.voicePostprocessNext(p, 2), null);
  assert.equal(plan.voicePostprocessNext(null, 0), null);
});