'use strict';

// 目标模式：宿主入口不得重新长出已退役更新执行器/agent 查询死残留。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');

const FORBIDDEN = ['updateCache', 'pullInFlight', 'resolveSessionPolicy', 'resolveAgent'];

test('HAR-01 app 源不再定义退役更新/agent 残片', () => {
  const app = fs.readFileSync(path.join(REPO_ROOT, 'src/host/app.js'), 'utf8');
  for (const name of FORBIDDEN) {
    assert.equal(app.includes(name), false, 'app 源仍含死残留：' + name);
  }
});

test('HAR-02 host 产物不再携带退役更新/agent 残片', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  for (const name of FORBIDDEN) {
    assert.equal(host.includes(name), false, 'host 产物仍含死残留：' + name);
  }
});
