'use strict';

// 语音配置契约（发布物内自包含的纯数据模块）。
// ⚠ 本文件是 `src/shared/contracts/voice-config.cjs` 的唯一实现来源；
//   发布白名单只含 `lib/`，因此运行时模块必须从 lib/ 取用，不得 require src/。
const VOICE_CONFIG_KEYS = Object.freeze(['filler', 'vad', 'hotkey', 'autoEnhance', 'correction', 'dictionary']);
const VOICE_CONFIG_DEFAULTS = Object.freeze({
  filler: Object.freeze({ enabled: true }),
  vad: Object.freeze({ enabled: true, silenceMs: 2000 }),
  hotkey: Object.freeze({ enabled: false, combo: '' }),
  autoEnhance: false,
  correction: Object.freeze({ enabled: false }),
  // 学习词典（UD-0055 / UD-0057）：识别完成后记录用户手改，形近替换自动生效。
  //   entries: { from, to, hits, at, enabled } —— 纯字面替换，⛔ 不碰纠错提示词。
  dictionary: Object.freeze({ entries: Object.freeze([]) }),
});

function cloneVoiceConfigDefaults() {
  return JSON.parse(JSON.stringify(VOICE_CONFIG_DEFAULTS));
}

// 静音档位归一：1–5 秒整数（毫秒写法 1000–5000 的整千倍）合法，其余回落默认。
function normalizeVadSilenceMs(v) {
  const n = typeof v === 'number' ? v : NaN;
  if (Number.isInteger(n)) {
    if (n >= 1000 && n <= 5000 && n % 1000 === 0) return n;
    if (n >= 1 && n <= 5) return n * 1000;
  }
  return VOICE_CONFIG_DEFAULTS.vad.silenceMs;
}


// ── 学习词典（UD-0055 / UD-0057）────────────────────────────────────────────
// 口径（单一事实源；host `sanitizeVoiceCfg` 与 client `mergeVoice` 同批同形取用）：
//   · 单条词长 ≤ 20 字；形近筛子 = 等长或长度差 ≤ 2；from === to 无意义 ⇒ 丢弃。
//   · 重复 from 合并：hits 累加、at 取较大值、enabled 取「或」（任一启用即启用）。
//   · 淘汰 = 按 hits 降序 + at 降序，上限 VOICE_DICTIONARY_MAX_ENTRIES。
//   · 替换 = 纯字面（split/join），⛔ 不用正则（避免把用户词当模式）；长 from 先替换。
const VOICE_DICTIONARY_MAX_ENTRIES = 500;
const VOICE_DICTIONARY_MAX_TERM = 20;

function dictionaryTerm(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!s || s.length > VOICE_DICTIONARY_MAX_TERM) return '';
  return s;
}

function normalizeDictionaryEntries(list) {
  const arr = Array.isArray(list) ? list : [];
  const byFrom = new Map();
  for (let i = 0; i < arr.length; i += 1) {
    const raw = arr[i] && typeof arr[i] === 'object' ? arr[i] : null;
    if (!raw) continue;
    const from = dictionaryTerm(raw.from);
    const to = dictionaryTerm(raw.to);
    if (!from || !to || from === to) continue;
    if (Math.abs(from.length - to.length) > 2) continue;
    const hits = Number.isInteger(raw.hits) && raw.hits > 0 ? raw.hits : 0;
    const at = typeof raw.at === 'number' && isFinite(raw.at) && raw.at > 0 ? raw.at : 0;
    const enabled = raw.enabled !== false;
    const prev = byFrom.get(from);
    if (prev) {
      prev.hits += hits;
      if (at > prev.at) prev.at = at;
      if (enabled) prev.enabled = true;
      continue;
    }
    byFrom.set(from, { from: from, to: to, hits: hits, at: at, enabled: enabled });
  }
  const entries = Array.from(byFrom.values());
  entries.sort((a, b) => (b.hits - a.hits) || (b.at - a.at));
  return entries.slice(0, VOICE_DICTIONARY_MAX_ENTRIES);
}

// 纯字面替换：只动命中的字面串；空词典 / 全停用 ⇒ 返回原文（调用方据此判定「草稿逐字不变」）。
function applyVoiceDictionary(text, entries) {
  const src = typeof text === 'string' ? text : '';
  if (!src) return { text: src, applied: 0 };
  const list = normalizeDictionaryEntries(entries).filter((e) => e.enabled === true);
  if (list.length === 0) return { text: src, applied: 0 };
  const ordered = list.slice().sort((a, b) => (b.from.length - a.from.length) || (a.from < b.from ? -1 : 1));
  let out = src;
  let applied = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const e = ordered[i];
    if (out.indexOf(e.from) === -1) continue;
    out = out.split(e.from).join(e.to);
    applied += 1;
  }
  return { text: out, applied: applied };
}

// 从「机器输出 → 用户手改」的差异里学一条候选：公共前后缀之外的那一段。
// 纯插入/纯删除（一侧为空）、超长、长度差 > 2 ⇒ 不入库（形近筛子）。
function learnVoiceDictionaryDiff(machine, edited) {
  const a = typeof machine === 'string' ? machine : '';
  const b = typeof edited === 'string' ? edited : '';
  if (!a || !b || a === b) return [];
  let p = 0;
  const maxP = Math.min(a.length, b.length);
  while (p < maxP && a.charAt(p) === b.charAt(p)) p += 1;
  let s = 0;
  const maxS = Math.min(a.length - p, b.length - p);
  while (s < maxS && a.charAt(a.length - 1 - s) === b.charAt(b.length - 1 - s)) s += 1;
  const from = a.slice(p, a.length - s);
  const to = b.slice(p, b.length - s);
  if (!from || !to) return [];
  if (from.trim() === '' || to.trim() === '') return [];
  // ⚠ 单字差异**不入库**：中文里一字之差往往是同音/近义误判（`置`↔`装`、`快`↔`慢`），
  //   自动学习收进来会变成噪声、且替换面极大（用户仍可**手动**新增单字条目 —— 那是明确意图）。
  if (from.length < 2 || to.length < 2) return [];
  if (from.length > VOICE_DICTIONARY_MAX_TERM || to.length > VOICE_DICTIONARY_MAX_TERM) return [];
  if (Math.abs(from.length - to.length) > 2) return [];
  return [{ from: from, to: to, hits: 1, at: Date.now(), enabled: true }];
}

module.exports = {
  VOICE_CONFIG_KEYS,
  VOICE_CONFIG_DEFAULTS,
  cloneVoiceConfigDefaults,
  normalizeVadSilenceMs,
  VOICE_DICTIONARY_MAX_ENTRIES,
  VOICE_DICTIONARY_MAX_TERM,
  normalizeDictionaryEntries,
  applyVoiceDictionary,
  learnVoiceDictionaryDiff,
};
