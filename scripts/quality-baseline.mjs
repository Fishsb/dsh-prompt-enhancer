#!/usr/bin/env node
// Offline quality baseline for fixed samples.
//
// Scope is deliberately explicit:
//   · enhancement fidelity / excessive rewrite / correction precision are measured on the
//     checked-in corpus through the same pure functions used by the product;
//   · VAD auto-stop and latency/budget behavior reuse the existing deterministic regression
//     suites (`official-bridge` and `p0-stop-bleed`) and count passing named tests;
//   · this does NOT measure live LLM quality or real microphone/audio hardware. Those require
//     a configured model and real browser/audio environment and are reported separately.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = path.join(ROOT, 'test', 'fixtures', 'quality-baseline', 'corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const pure = require(path.join(ROOT, 'src', 'host', 'pure-module.cjs'));

function percentile(values, p) {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))];
}

const cleanStarted = process.hrtime.bigint();
const enhancementRows = corpus.enhancement.map((sample) => {
  const output = pure.cleanOutput(sample.modelOutput, sample.input);
  const kept = sample.facts.filter((fact) => output.includes(fact));
  const growth = sample.input.length > 0 ? output.length / sample.input.length : 0;
  return {
    id: sample.id,
    factsKept: kept.length,
    factsTotal: sample.facts.length,
    factRetention: sample.facts.length ? kept.length / sample.facts.length : 1,
    growth,
    excessive: growth > sample.maxGrowth,
    output,
  };
});

const correctionRows = [];
for (const input of corpus.correction.protected) {
  const output = pure.cleanCorrectionOutput(input, input);
  correctionRows.push({ kind: 'protected', input, output, misfire: output !== input, changed: output !== input });
}
for (const [input, expected] of corpus.correction.correct) {
  const output = pure.cleanCorrectionOutput(expected, input);
  correctionRows.push({ kind: 'correct', input, expected, output, misfire: output !== expected, changed: output !== input });
}
const cleanElapsedMs = Number(process.hrtime.bigint() - cleanStarted) / 1e6;

function runNamedTests(file, pattern) {
  const p = spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, file], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const text = String(p.stdout || '') + String(p.stderr || '');
  const rows = [...text.matchAll(/^(ok|not ok)\s+\d+\s+-\s+(.+?)(?:\s+\([^)]*ms\))?$/gm)]
    .map((m) => ({ ok: m[1] === 'ok', name: m[2].trim() }));
  const selected = rows.filter((row) => new RegExp(pattern).test(row.name));
  return {
    file,
    exit: p.status,
    total: selected.length,
    passed: selected.filter((row) => row.ok).length,
    failures: selected.filter((row) => !row.ok).map((row) => row.name),
  };
}

const vadSuite = runNamedTests('test/official-bridge.test.cjs', 'OVB-VAD|OVB-SW');
const latencySuite = runNamedTests('test/p0-stop-bleed.test.cjs', 'P0-b|超时|额度|耗时');

const protectedRows = correctionRows.filter((row) => row.kind === 'protected');
const correctRows = correctionRows.filter((row) => row.kind === 'correct');
const metrics = {
  enhancementFactRetention: enhancementRows.reduce((s, r) => s + r.factRetention, 0) / Math.max(1, enhancementRows.length),
  excessiveRewriteRate: enhancementRows.filter((r) => r.excessive).length / Math.max(1, enhancementRows.length),
  enhancementGrowthP50: percentile(enhancementRows.map((r) => r.growth), 50),
  correctionMisfireRate: protectedRows.filter((r) => r.misfire).length / Math.max(1, protectedRows.length),
  correctionRecall: correctRows.filter((r) => r.changed && !r.misfire).length / Math.max(1, correctRows.length),
  vadAutoStopPassRate: vadSuite.passed / Math.max(1, vadSuite.total),
  latencyRulePassRate: latencySuite.passed / Math.max(1, latencySuite.total),
  localCleanTotalMs: cleanElapsedMs,
};

const t = corpus.thresholds;
const checks = {
  enhancementFactRetention: metrics.enhancementFactRetention >= t.enhancementFactRetentionMin,
  excessiveRewriteRate: metrics.excessiveRewriteRate <= t.excessiveRewriteRateMax,
  correctionMisfireRate: metrics.correctionMisfireRate <= t.correctionMisfireRateMax,
  correctionRecall: metrics.correctionRecall >= t.correctionRecallMin,
  vadAutoStopPassRate: metrics.vadAutoStopPassRate >= t.vadAutoStopPassRateMin && vadSuite.total > 0,
  latencyRulePassRate: metrics.latencyRulePassRate >= t.latencyRulePassRateMin && latencySuite.total > 0,
  localCleanLatency: metrics.localCleanTotalMs <= t.localCleanTotalMsMax,
};

const report = {
  scope: 'offline-fixed-samples',
  metrics,
  thresholds: t,
  checks,
  suites: {
    vad: { total: vadSuite.total, passed: vadSuite.passed, failures: vadSuite.failures },
    latency: { total: latencySuite.total, passed: latencySuite.passed, failures: latencySuite.failures },
  },
  enhancementRows,
  correctionRows,
  notMeasured: ['live-llm-quality', 'real-microphone-vad', 'real-transcription-writeback'],
};

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log('Offline quality baseline (fixed samples)');
  console.log('  enhancement fact retention : ' + (metrics.enhancementFactRetention * 100).toFixed(1) + '%');
  console.log('  excessive rewrite rate     : ' + (metrics.excessiveRewriteRate * 100).toFixed(1) + '%');
  console.log('  correction misfire rate    : ' + (metrics.correctionMisfireRate * 100).toFixed(1) + '%');
  console.log('  correction recall          : ' + (metrics.correctionRecall * 100).toFixed(1) + '%');
  console.log('  VAD named-test pass rate   : ' + (metrics.vadAutoStopPassRate * 100).toFixed(1) + '% (' + vadSuite.passed + '/' + vadSuite.total + ')');
  console.log('  latency rule pass rate     : ' + (metrics.latencyRulePassRate * 100).toFixed(1) + '% (' + latencySuite.passed + '/' + latencySuite.total + ')');
  console.log('  local clean total latency  : ' + metrics.localCleanTotalMs.toFixed(1) + 'ms');
  console.log('  not measured               : live LLM quality, real microphone VAD, real transcription/write-back');
}

const failed = Object.keys(checks).filter((key) => checks[key] !== true);
if (failed.length) {
  console.error('QUALITY FAIL: ' + failed.join(', '));
  process.exit(1);
}
