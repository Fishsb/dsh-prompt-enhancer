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

// 模板体系扩展（2026-08-17）：每模式 3 个内置模板 + 多自定义模板的 schema 白名单契约
test('CFG-05 template.pick/custom 白名单解析（默认/supplement/dev/custom:N）', () => {
  const r = validateConfig({
    version: 2,
    template: {
      mode: 'builtin',
      pick: { base: 'supplement', smart: 'dev', publish: 'custom:1' },
      custom: { publish: [{ name: '甲', text: 'A' }, { name: '乙', text: 'B' }] },
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.template.pick.base, 'supplement');
  assert.equal(r.value.template.pick.smart, 'dev');
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
