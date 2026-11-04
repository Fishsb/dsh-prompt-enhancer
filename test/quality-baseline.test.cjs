'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'quality-baseline', 'corpus.json'), 'utf8'));
const pure = require(path.join(ROOT, 'src', 'host', 'pure-module.cjs'));

test('QB-01 增强固定语料：受保护事实零丢失、过度改写为零', () => {
  let kept = 0;
  let total = 0;
  const excessive = [];
  for (const row of corpus.enhancement) {
    const out = pure.cleanOutput(row.modelOutput, row.input);
    for (const fact of row.facts) { total += 1; if (out.includes(fact)) kept += 1; }
    if (out.length / row.input.length > row.maxGrowth) excessive.push(row.id);
  }
  assert.equal(kept, total, '固定语料的事实保留率必须 100%');
  assert.deepEqual(excessive, [], '不得出现超阈过度改写');
});

test('QB-02 纠错固定语料：受保护样本误改率为零、真纠错召回为 100%', () => {
  const misfires = corpus.correction.protected.filter((input) => pure.cleanCorrectionOutput(input, input) !== input);
  assert.deepEqual(misfires, [], '受保护样本不得误改');
  const missed = corpus.correction.correct.filter(([input, expected]) => {
    const out = pure.cleanCorrectionOutput(expected, input);
    return out !== expected || out === input;
  });
  assert.deepEqual(missed, [], '真纠错不得被清洗层打回原文');
});

test('QB-03 基线阈值显式且非空（阈值本身是质量回归契约）', () => {
  assert.equal(corpus.thresholds.enhancementFactRetentionMin, 1);
  assert.equal(corpus.thresholds.excessiveRewriteRateMax, 0);
  assert.equal(corpus.thresholds.correctionMisfireRateMax, 0);
  assert.equal(corpus.thresholds.correctionRecallMin, 1);
  assert.ok(corpus.thresholds.vadAutoStopPassRateMin > 0);
  assert.ok(corpus.thresholds.latencyRulePassRateMin > 0);
  assert.ok(Number.isFinite(corpus.thresholds.localCleanTotalMsMax));
});
