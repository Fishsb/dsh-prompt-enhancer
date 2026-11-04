#!/usr/bin/env node
// Quality baseline for fixed samples.
//
// Two explicitly separate modes:
//   · enhancement fidelity / excessive rewrite / correction precision are measured on the
//     checked-in corpus through the same pure functions used by the product;
//   · VAD auto-stop and latency/budget behavior reuse the existing deterministic regression
//     suites (`official-bridge` and `p0-stop-bleed`) and count passing named tests;
//   · `--live` additionally runs each enhancement corpus row through the running DSH
//     `enhance` RPC (same model chain and prompts as the product);
//   · `--voice` is reserved for a real microphone/audio run and never counts deterministic
//     tests as hardware evidence.
// Default stays offline because it must remain deterministic in CI.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { GATE_EXIT } from './lib/gate-exit.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = path.join(ROOT, 'test', 'fixtures', 'quality-baseline', 'corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const pure = require(path.join(ROOT, 'src', 'host', 'pure-module.cjs'));
const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LIVE = argv.includes('--live');
const VOICE = argv.includes('--voice');
const URL_BASE = argOf('--url', process.env.DSH_URL || 'http://127.0.0.1:3080');
const sessionPrefix = 'quality-' + Date.now();

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
  scope: LIVE ? 'live-model-fixed-samples' : 'offline-fixed-samples',
  metrics,
  thresholds: t,
  checks,
  suites: {
    vad: { total: vadSuite.total, passed: vadSuite.passed, failures: vadSuite.failures },
    latency: { total: latencySuite.total, passed: latencySuite.passed, failures: latencySuite.failures },
  },
  enhancementRows,
  correctionRows,
  notMeasured: LIVE ? ['real-microphone-vad', 'real-transcription-writeback'] : ['live-llm-quality', 'real-microphone-vad', 'real-transcription-writeback'],
};

async function rpc(method, args) {
  const response = await fetch(new URL('/dsh-prompt-enhancer/rpc', URL_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* caller sees raw status */ }
  if (!response.ok) throw new Error('RPC HTTP ' + response.status + ': ' + text.slice(0, 300));
  return json;
}

if (LIVE) {
  let config = null;
  try {
    const cfg = await rpc('config/get', {});
    config = cfg && cfg.config && typeof cfg.config === 'object' ? cfg.config : null;
  } catch (error) {
    report.live = { status: 'failed', error: String(error && error.message || error), rows: [] };
    checks.liveModelQuality = false;
  }
  if (config) {
    const liveRows = [];
    for (let i = 0; i < corpus.enhancement.length; i += 1) {
      const sample = corpus.enhancement[i];
      const request = {
        sessionId: sessionPrefix + '-' + i,
        seq: 1,
        text: sample.input,
        config,
        mode: 'base',
      };
      try {
        const out = await rpc('enhance', request);
        const text = out && typeof out.text === 'string' ? pure.cleanOutput(out.text, sample.input) : '';
        const kept = sample.facts.filter((fact) => text.includes(fact));
        const growth = sample.input.length > 0 ? text.length / sample.input.length : 0;
        liveRows.push({
          id: sample.id,
          ok: out && out.ok === true,
          status: out && out.status,
          model: out && out.model,
          error: out && !out.ok ? { code: out.code, message: out.message } : null,
          text,
          factsKept: kept.length,
          factsTotal: sample.facts.length,
          factRetention: sample.facts.length ? kept.length / sample.facts.length : 1,
          growth,
          excessive: growth > sample.maxGrowth,
        });
      } catch (error) {
        liveRows.push({
          id: sample.id, ok: false, status: 'failed', error: { code: 'RPC_FAILED', message: String(error && error.message || error) },
          text: '', factsKept: 0, factsTotal: sample.facts.length, factRetention: 0, growth: 0, excessive: false,
        });
      }
    }
    const liveMetrics = {
      enhancementFactRetention: liveRows.reduce((sum, row) => sum + row.factRetention, 0) / Math.max(1, liveRows.length),
      excessiveRewriteRate: liveRows.filter((row) => row.excessive).length / Math.max(1, liveRows.length),
      successRate: liveRows.filter((row) => row.ok).length / Math.max(1, liveRows.length),
    };
    report.live = { status: 'measured', models: [...new Set(liveRows.map((row) => row.model).filter(Boolean))], metrics: liveMetrics, rows: liveRows };
    checks.liveModelQuality = liveMetrics.successRate === 1
      && liveMetrics.enhancementFactRetention >= t.enhancementFactRetentionMin
      && liveMetrics.excessiveRewriteRate <= t.excessiveRewriteRateMax;
  }
}

report.notMeasured = report.notMeasured.filter((item) => {
  if (item === 'live-llm-quality') return report.live?.status !== 'measured';
  return true;
});
report.voice = VOICE
  ? { status: 'not-run', reason: 'Real microphone/audio verification requires a deviceful browser run; deterministic tests are not counted as hardware evidence.' }
  : { status: 'skipped', reason: 'Pass --voice to request real microphone/audio verification.' };

if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log((LIVE ? 'Live model quality baseline (fixed samples)' : 'Offline quality baseline (fixed samples)'));
  console.log('  enhancement fact retention : ' + (metrics.enhancementFactRetention * 100).toFixed(1) + '%');
  console.log('  excessive rewrite rate     : ' + (metrics.excessiveRewriteRate * 100).toFixed(1) + '%');
  console.log('  correction misfire rate    : ' + (metrics.correctionMisfireRate * 100).toFixed(1) + '%');
  console.log('  correction recall          : ' + (metrics.correctionRecall * 100).toFixed(1) + '%');
  console.log('  VAD named-test pass rate   : ' + (metrics.vadAutoStopPassRate * 100).toFixed(1) + '% (' + vadSuite.passed + '/' + vadSuite.total + ')');
  console.log('  latency rule pass rate     : ' + (metrics.latencyRulePassRate * 100).toFixed(1) + '% (' + latencySuite.passed + '/' + latencySuite.total + ')');
  console.log('  local clean total latency  : ' + metrics.localCleanTotalMs.toFixed(1) + 'ms');
  if (report.live?.status === 'measured') {
    console.log('  live model success         : ' + (report.live.metrics.successRate * 100).toFixed(1) + '%');
    console.log('  live fact retention        : ' + (report.live.metrics.enhancementFactRetention * 100).toFixed(1) + '%');
    console.log('  live excessive rewrite     : ' + (report.live.metrics.excessiveRewriteRate * 100).toFixed(1) + '%');
    console.log('  live models                : ' + report.live.models.join(', '));
  } else if (report.live?.status === 'failed') {
    console.log('  live model quality         : FAILED · ' + report.live.error);
  }
  console.log('  voice hardware             : ' + report.voice.status.toUpperCase() + ' · ' + report.voice.reason);
  console.log('  not measured               : ' + (report.notMeasured.join(', ') || 'none'));
}

const failed = Object.keys(checks).filter((key) => checks[key] !== true);
if (failed.length) {
  console.error('QUALITY FAIL: ' + failed.join(', '));
  process.exit(GATE_EXIT.FAIL);
}
if (VOICE) {
  console.error('QUALITY NOT FULLY JUDGED: real microphone/audio verification was not executed.');
  process.exit(GATE_EXIT.NOT_FULLY_JUDGED);
}
process.exit(GATE_EXIT.ALL_PASS);
