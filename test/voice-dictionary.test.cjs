'use strict';

// UD-0055 / UD-0057（学习词典）七项验收。
// 纪律：本批只加「学习词典」这一条链路；⛔ 不改纠错提示词、⛔ 不改 VOICE_CORRECT 调用形态。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VOICE_CONFIG_KEYS,
  VOICE_CONFIG_DEFAULTS,
  VOICE_DICTIONARY_MAX_ENTRIES,
  VOICE_DICTIONARY_MAX_TERM,
  normalizeDictionaryEntries,
  applyVoiceDictionary,
  learnVoiceDictionaryDiff,
} = require('../src/shared/contracts/voice-config.cjs');
const { sanitizeVoiceCfg } = require('../lib/asr.cjs');
const { voiceStateChunkWithDefaults } = require('./helpers/voice-state-chunk.cjs');

function loadVoiceStateModule() {
  const src = voiceStateChunkWithDefaults();
  const ls = new Map();
  const localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k),
  };
  // 与生产装配同形：把契约层的归一实现注入（`src/client/app.cjs` 也是这么传的）
  const factory = new Function('localStorage', 'host', 'normalizeDictionaryEntries', src + '\n;return { VOICE_CFG_DEFAULTS, mergeVoice };');
  return factory(localStorage, { call: () => Promise.resolve({ ok: false }) }, normalizeDictionaryEntries);
}

// ── ① 双白名单同形（`M-3`）：host `sanitizeVoiceCfg` ↔ client `mergeVoice` ───────────────
test('VDICT-01 host 白名单与 client 白名单在 dictionary 上同形同值', () => {
  const input = {
    filler: { enabled: true },
    vad: { enabled: true, silenceMs: 2000 },
    hotkey: { enabled: false, combo: '' },
    autoEnhance: false,
    correction: { enabled: false },
    dictionary: { entries: [{ from: 'AB', to: 'AC' }, { from: 'AB', to: 'AC' }] },
  };
  const host = sanitizeVoiceCfg(input);
  const client = loadVoiceStateModule().mergeVoice(input);
  assert.deepEqual(Object.keys(host).sort(), Object.keys(client).sort());
  assert.deepEqual(host.dictionary, client.dictionary);
  assert.equal(host.dictionary.entries.length, 1, '重复 from 必须合并成一条');
  assert.ok(VOICE_CONFIG_KEYS.includes('dictionary'));
  assert.ok(Object.prototype.hasOwnProperty.call(VOICE_CONFIG_DEFAULTS, 'dictionary'));
});

// ── ② 空词典 / 全停用 ⇒ 草稿逐字不变 ────────────────────────────────────────────
test('VDICT-02 空词典与全停用词典都不改动草稿（逐字相等且 applied === 0）', () => {
  const text = '这是一段需要保持完全不变的话，ABCD。';
  const empty = applyVoiceDictionary(text, []);
  assert.equal(empty.text, text);
  assert.equal(empty.applied, 0);
  const disabled = applyVoiceDictionary(text, [{ from: 'ABCD', to: 'abdc', enabled: false }]);
  assert.equal(disabled.text, text);
  assert.equal(disabled.applied, 0);
  // 非字符串输入按原文返回（保守）
  assert.deepEqual(applyVoiceDictionary('', []), { text: '', applied: 0 });
});

// ── ③ 形近筛子 ───────────────────────────────────────────────────────────────
test('VDICT-03 形近筛子：等长或长度差 ≤2 收，差 >2 / from===to / 超长 丢', () => {
  const kept = normalizeDictionaryEntries([
    { from: 'abc', to: 'abd' },
    { from: 'abcd', to: 'ab' },
    { from: 'ab', to: 'abcd' },
  ]);
  assert.equal(kept.length, 3, '长度差 0/2/2 都在筛内');
  const dropped = normalizeDictionaryEntries([
    { from: 'ab', to: 'abcde' },
    { from: 'same', to: 'same' },
    { from: 'x'.repeat(VOICE_DICTIONARY_MAX_TERM + 1), to: 'y' },
    { from: '', to: 'z' },
  ]);
  assert.deepEqual(dropped, []);
});

// ── ④ 重复合并（hits 累加 / at 取大 / enabled 取或）──────────────────────────────
test('VDICT-04 同 from 合并：hits 累加、at 取较大、enabled 取或', () => {
  const out = normalizeDictionaryEntries([
    { from: 'hellp', to: 'hello', hits: 2, at: 100, enabled: false },
    { from: 'hellp', to: 'hello', hits: 3, at: 900, enabled: true },
    { from: 'hellp', to: 'hello', hits: 1, at: 500, enabled: false },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].hits, 6);
  assert.equal(out[0].at, 900);
  assert.equal(out[0].enabled, true);
});

// ── ⑤ 上限与淘汰 ─────────────────────────────────────────────────────────────
test('VDICT-05 超过上限按 hits 降序 + at 降序淘汰', () => {
  const many = [];
  for (let i = 0; i < VOICE_DICTIONARY_MAX_ENTRIES + 25; i += 1) {
    many.push({ from: 'w' + i, to: 'v' + i, hits: i, at: 1000 + i, enabled: true });
  }
  const out = normalizeDictionaryEntries(many);
  assert.equal(out.length, VOICE_DICTIONARY_MAX_ENTRIES);
  assert.equal(out[0].hits, VOICE_DICTIONARY_MAX_ENTRIES + 24, '命中最多者必须留下');
  assert.ok(out.every((e, i) => i === 0 || out[i - 1].hits >= e.hits), '必须按 hits 降序');
});

// ── ⑥ 替换不误伤：差集断言（只可能少掉被替换的片段，不允许新造内容）────────────
test('VDICT-06 替换只动命中的字面串：去掉替换段后与原文逐字相等', () => {
  const text = '今天开会说 recieve 这个词，然后 recieve 又出现一次。';
  const r = applyVoiceDictionary(text, [{ from: 'recieve', to: 'receive' }]);
  assert.equal(r.applied, 1);
  assert.equal(r.text, '今天开会说 receive 这个词，然后 receive 又出现一次。');
  // 差集：原文剔除 from 后的残段 == 结果剔除 to 后的残段（其余一字未改）
  assert.equal(text.split('recieve').join(''), r.text.split('receive').join(''));
});

// ── ⑦ 采集：机器输出 → 用户手改 的差异学习 ───────────────────────────────────
test('VDICT-07 差异学习：换词入库、纯插入/纯删除不入库、超长不入库', () => {
  const learned = learnVoiceDictionaryDiff('这个功能很好', '这个特性很好');
  assert.equal(learned.length, 1);
  assert.equal(learned[0].from, '功能');
  assert.equal(learned[0].to, '特性');
  assert.equal(learned[0].hits, 1);
  assert.equal(learned[0].enabled, true);
  assert.deepEqual(learnVoiceDictionaryDiff('请打开设置页', '请打开设置页谢谢'), [], '纯插入不入库');
  assert.deepEqual(learnVoiceDictionaryDiff('请打开设置页谢谢', '请打开设置页'), [], '纯删除不入库');
  assert.deepEqual(learnVoiceDictionaryDiff('ab', 'a'.repeat(VOICE_DICTIONARY_MAX_TERM + 5)), [], '超长不入库');
  assert.deepEqual(learnVoiceDictionaryDiff('请打开设置页', '请打开设备页'), [], '单字差异不入库（噪声面）');
  assert.deepEqual(learnVoiceDictionaryDiff('同', '同'), []);
  assert.deepEqual(learnVoiceDictionaryDiff(null, ''), []);
});
