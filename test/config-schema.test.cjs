'use strict';
// M3: config schema/migration tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, migrateLegacyConfig, cloneDefaults } = require('../src/host/config-schema.js');

test('CFG-01 validateConfig accepts valid config', () => {
  const r = validateConfig({ mode: 'smart', memory: true });
  assert.equal(r.ok, true);
  assert.equal(r.value.mode, 'smart');
  assert.equal(r.value.memory, true);
});

test('CFG-02 validateConfig rejects invalid mode', () => {
  const r = validateConfig({ mode: 'unknown' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('invalid mode')));
});

test('CFG-03 migrateLegacyConfig maps v1 fields', () => {
  const out = migrateLegacyConfig({ provider: 'p', model: 'm', mode: 'lite', memory: true });
  assert.equal(out.main.provider, 'p');
  assert.equal(out.main.model, 'm');
  assert.equal(out.mode, 'lite');
  assert.equal(out.memory, true);
});

test('CFG-04 cloneDefaults returns fresh copy', () => {
  const a = cloneDefaults();
  const b = cloneDefaults();
  a.mode = 'smart';
  assert.equal(b.mode, 'base');
});

// 模板体系扩展（2026-08-18 修订）：每模式 2 个内置模板 + 多自定义模板的 schema 白名单契约
// （旧内置键 supplement/dev 统一迁移为 increment）
test('CFG-05 template.pick/custom 白名单解析（默认/increment/custom:N + 旧键迁移）', () => {
  const r = validateConfig({
    version: 2,
    template: {
      mode: 'builtin',
      pick: { base: 'increment', smart: 'supplement', lite: 'dev', publish: 'custom:1' },
      custom: { publish: [{ name: '甲', text: 'A' }, { name: '乙', text: 'B' }] },
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.template.pick.base, 'increment');
  assert.equal(r.value.template.pick.smart, 'increment', '旧 supplement 应迁移为 increment');
  assert.equal(r.value.template.pick.lite, 'increment', '旧 dev 应迁移为 increment');
  assert.equal(r.value.template.pick.publish, 'custom:1');
  assert.equal(r.value.template.custom.publish.length, 2);
  assert.equal(r.value.template.custom.publish[1].text, 'B');
  // 缺省 default、非法/越界回退 default、空 text 丢弃、name 截断、每模式上限 10
  const bad = validateConfig({
    version: 2,
    template: {
      pick: { lite: 'nope', base: 'custom:99' },
      custom: {
        base: [
          ...Array.from({ length: 9 }, (_, i) => ({ name: 'n' + i, text: 't' + i })),
          { name: 'x'.repeat(60), text: 'y' },
          { text: '' },
          { name: 'n9', text: 't9' },
        ],
      },
    },
  });
  assert.equal(bad.value.template.pick.base, 'default');
  assert.equal(bad.value.template.pick.lite, 'default');
  assert.equal(bad.value.template.custom.base.length, 10, '每模式自定义模板上限 10（空 text 丢弃、超限条目截断）');
  assert.equal(bad.value.template.custom.base[9].name, 'x'.repeat(40), 'name 截断到 40');
  assert.equal(bad.value.template.custom.base[0].text, 't0');
  // 旧配置迁移：无 pick 且 mode==='custom' → texts 迁为 custom:0
  const migrated = validateConfig({ version: 2, template: { mode: 'custom', texts: { base: '旧' } } });
  assert.equal(migrated.value.template.pick.base, 'custom:0');
  assert.equal(migrated.value.template.custom.base[0].text, '旧');
  // 已有 pick 不迁移
  const noMigrate = validateConfig({ version: 2, template: { mode: 'custom', texts: { base: '旧' }, pick: { base: 'default' } } });
  assert.equal(noMigrate.value.template.pick.base, 'default');
  assert.equal(noMigrate.value.template.custom.base.length, 0);
});

test('CFG-06 params 无限制（0）允许（v3.1.7 用户需求）', () => {
  // timeoutMs/maxTokens/outputLimit = 0 → 无限制（不设超时 / provider 默认上限 / 不截断）
  const r = validateConfig({ params: { timeoutMs: 0, maxTokens: 0, outputLimit: 0 } });
  assert.equal(r.ok, true);
  assert.equal(r.value.params.timeoutMs, 0);
  assert.equal(r.value.params.maxTokens, 0);
  assert.equal(r.value.params.outputLimit, 0);
  // 非法值（负数 / 超范围）仍回退默认
  const bad = validateConfig({ params: { timeoutMs: -1, maxTokens: 99999, outputLimit: -5 } });
  assert.equal(bad.value.params.timeoutMs, 30000);
  assert.equal(bad.value.params.maxTokens, 2000);
  assert.equal(bad.value.params.outputLimit, 8000);
});
