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
