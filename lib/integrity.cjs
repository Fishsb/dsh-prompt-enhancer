'use strict';
/**
 * M5: integrity helpers (bundle-safe CommonJS copy used by lib/updater-host.cjs).
 * P1b（2026-09-19）：源/副本关系反转修正——原注「Source of truth: src/host/integrity.js」
 * 所指文件是从未接线的**死层**且已删除；**本文件即唯一事实源**。
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifySha256(filePath, expectedHash) {
  if (!expectedHash || typeof expectedHash !== 'string') {
    return { ok: false, code: 'NO_EXPECTED_HASH' };
  }
  try {
    const actual = await sha256File(filePath);
    const ok = actual.toLowerCase() === expectedHash.toLowerCase();
    return { ok, actual, expected: expectedHash.toLowerCase() };
  } catch (e) {
    return { ok: false, code: 'HASH_FAILED', message: String(e.message || e) };
  }
}

module.exports = { sha256File, verifySha256 };
