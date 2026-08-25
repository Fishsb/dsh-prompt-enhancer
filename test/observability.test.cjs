'use strict';
// M5: observability and integrity tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../src/host/logger.js');
const { sha256File, verifySha256 } = require('../src/host/integrity.js');

test('OBS-01 logger writes structured JSON and tails', () => {
  const lines = [];
  const logger = createLogger({ writer: (line) => lines.push(line), ringSize: 2 });
  logger.info('test.event', { a: 1 });
  logger.error('test.error', { b: 2 });
  assert.equal(lines.length, 1, 'info goes to writer, error goes to console.error');
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.event, 'test.event');
  assert.equal(parsed.a, 1);
  assert.equal(logger.tail(1).length, 1);
});

test('OBS-02 sha256File and verifySha256', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-obs-'));
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'hello');
  const hash = await sha256File(file);
  assert.match(hash, /^[a-f0-9]{64}$/);
  const ok = await verifySha256(file, hash);
  assert.equal(ok.ok, true);
  const bad = await verifySha256(file, '0'.repeat(64));
  assert.equal(bad.ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('OBS-03 批次D hlog/herr 行带 ISO 时间戳前缀且保留原文案（chunk eval 手法）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'host', 'diagnostics.js'), 'utf8');
  const m = /^module\.exports = ("[\s\S]*");?\s*$/m.exec(src);
  assert.ok(m, 'diagnostics chunk payload 可解析');
  const payload = JSON.parse(m[1]);
  // 隔离 console 注入：payload 体内裸 console 解析到参数
  const captured = [];
  const fakeConsole = {
    log: (...a) => captured.push(['log', a.join(' ')]),
    error: (...a) => captured.push(['error', a.join(' ')]),
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('console', payload + '\n;return { hlog, herr, LOG_RING };')(fakeConsole);
  assert.equal(typeof api.hlog, 'function');
  assert.equal(typeof api.herr, 'function');

  api.hlog('[enhance] update/envcheck ok svc=dsh-web', { items: 4 });
  api.herr('[enhance] update/envcheck failed', 42);

  assert.equal(captured.length, 2);
  assert.equal(captured[0][0], 'log', 'hlog 走 console.log');
  assert.equal(captured[1][0], 'error', 'herr 走 console.error');
  const TS = '^\\[20\\d{2}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\] ';
  assert.match(captured[0][1], new RegExp(TS + '\\[enhance\\] update/envcheck ok svc=dsh-web \\{"items":4\\}$'),
    'hlog 输出行以 [20…Z] 开头且原文案/参数原样保留');
  assert.match(captured[1][1], new RegExp(TS + '\\[enhance\\] update/envcheck failed 42$'),
    'herr 输出行同样带 ISO 前缀');

  assert.equal(api.LOG_RING.length, 2, '环形缓冲仍收录两行');
  assert.match(api.LOG_RING[0], /^\[20\d{2}-/, 'LOG_RING 内容含时间戳前缀（logs/last 消费方可见）');
  assert.ok(api.LOG_RING[0].includes('[enhance] update/envcheck ok'), '关键 token 原样保留（grep 兼容，D-1）');
});
