'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'quality-baseline.mjs'), 'utf8');

test('QLIVE-01 质量命令显式分离离线、真实模型与真实语音', () => {
  assert.match(source, /--live/);
  assert.match(source, /--voice/);
  assert.match(source, /'live-model-fixed-samples'/);
  assert.match(source, /real-microphone-vad/);
  assert.match(source, /real-transcription-writeback/);
  assert.doesNotMatch(source, /live-llm-quality', 'real-microphone-vad', 'real-transcription-writeback'\)\]/, '未运行 --live 时不得声称真实模型已测');
});

test('QLIVE-02 真实模型检查使用真实 enhance RPC 与同一固定语料', () => {
  assert.match(source, /rpc\('enhance', request\)/);
  assert.match(source, /rpc\('config\/get'/);
  assert.match(source, /corpus\.enhancement/);
  assert.match(source, /factRetention/);
  assert.match(source, /excessiveRewriteRate/);
});

test('QLIVE-03 语音未执行必须是三态退出码 2，不得冒充通过', () => {
  assert.match(source, /GATE_EXIT\.NOT_FULLY_JUDGED/);
  assert.match(source, /QUALITY NOT FULLY JUDGED/);
  assert.match(source, /if \(VOICE\)/);
  assert.match(source, /deterministic tests are not counted as hardware evidence/);
});

test('QLIVE-04 质量命令已纳入 npm test，且不自称实时模型已测', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /test\/quality-live\.test\.cjs/);
  assert.equal(pkg.scripts.quality, 'node scripts/quality-baseline.mjs');
  assert.match(source, /Default stays offline because it must remain deterministic in CI/);
});

test('QLIVE-05 阈值按草稿类型显式分层：短结构草案允许必要结构化，不放宽事实保真', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'quality-baseline', 'corpus.json'), 'utf8'));
  const row = corpus.enhancement.find((item) => item.id === 'E3');
  assert.ok(row, 'E3 固定语料必须存在');
  assert.equal(row.maxGrowth, 4);
  assert.ok(row.input.length < 40, 'E3 是短草案，长度阈值是结构化扩展预算，不是事实保真放宽');
  assert.deepEqual(row.facts, ['纸牌游戏', '2-4 人', '记分', '撤销']);
});
