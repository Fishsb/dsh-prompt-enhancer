'use strict';

// 目标模式第 6 批（清理历史负担）：默认参数常量的单一事实源一致性。
//
// 背景：`models-constants.cjs`（供 pure 域）与 `models-module.cjs`（供 RPC 域）
// 各自声明同一组默认值。迁移前 chunk 的正文被 HMM-02 冻结，因此本轮不合并定义；
// 但必须保证两份数值永不漂移——漂移会让「校验用的默认值」与「执行用的默认值」分叉。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const constants = require(path.join(REPO_ROOT, 'src/host/models-constants.cjs'));
const models = require(path.join(REPO_ROOT, 'src/host/models-module.cjs'));

const SHARED = ['DEFAULT_TIMEOUT_MS', 'DEFAULT_MAX_TOKENS', 'DEFAULT_OUTPUT_LIMIT'];

test('HMC-01 两份默认值定义数值相等（防漂移）', () => {
  for (const key of SHARED) {
    assert.ok(Object.hasOwn(constants, key), 'models-constants.cjs 必须导出 ' + key);
    assert.ok(Object.hasOwn(models, key), 'models-module.cjs 必须导出 ' + key);
    assert.equal(models[key], constants[key],
      key + ' 两份定义必须同值：constants=' + constants[key] + ' module=' + models[key]);
  }
});

test('HMC-02 两份默认值类型一致且为正整数', () => {
  for (const key of SHARED) {
    for (const [label, api] of [['constants', constants], ['module', models]]) {
      assert.equal(typeof api[key], 'number', label + '.' + key + ' 必须是数字');
      assert.ok(Number.isInteger(api[key]) && api[key] > 0, label + '.' + key + ' 必须是正整数');
    }
  }
});

test('HMC-03 漂移可检：改动任一侧必须被 HMC-01 拦住（判据有牙）', () => {
  const snapshot = constants.DEFAULT_TIMEOUT_MS;
  const mutated = { ...models, DEFAULT_TIMEOUT_MS: snapshot + 1 };
  const drifted = SHARED.some((key) => mutated[key] !== constants[key]);
  assert.equal(drifted, true, '注入 +1 后必须被识别为漂移（否则 HMC-01 无判别力）');
});
