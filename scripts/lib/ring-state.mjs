#!/usr/bin/env node
// scripts/lib/ring-state.mjs — 环→编排器 **状态出口契约**（产出侧与消费侧的唯一事实源）
//
// 为什么要有它（根因，不是个案）：
//   gate.mjs 的环级判定原先是**文本启发式**——靠「行首锚定 + 全输出定位」猜各环状态，连改三次
//   仍未根治（I2 整段子串匹配误判 → N2 末 4 行窗口把 SKIP 读成 PASS → N4 措辞自含反义子串）。
//   根因不在正则写得对不对，而在**环没有机读状态出口**：判据方只能从给人看的措辞里反推机器状态。
//   环一换措辞，SKIP 就可能被读成 PASS —— 这正是本仓反复治的「失败不可观测」。
//   故把状态**由环自己声明**，编排器只读结构、不再解释自然语言。
//
// 契约（一行三态）：
//   每个环在退出前，**向 stderr 打恰一行**：
//       RING-STATE <id> <PASS|FAIL|SKIP> <reason>
//   · 走 stderr 而非 stdout：各环 stdout 可能承载机读数据（rpc / cards 的 --json 必须是**可 parse 的
//     纯 JSON**），状态行属遥测通道，不得污染数据面；编排器把两条流合并后读取（p.stdout + p.stderr）。
//   · 恰一行；reason 内的换行 / 制表符压成单空格（契约行必须单行可 grep）。
//   · 三态语义不变：PASS=判过且过 / FAIL=判过不过 / **SKIP=没判上**（分母缺位、面缺位、未实装）。
//   · 退出码与状态分工不变：**退出码不承载 SKIP**（SKIP 环仍 exit 0），故消费侧不得只看退出码。
//
// 消费侧（gate.mjs）只调本模块的 deriveState()：**不对环输出做任何文本匹配**。
// 本文件里唯一的文本形东西是 NOISE（node 警告前缀）与契约行正则本身，且 NOISE **只用于退化位**——
// 完全没有状态行时区分「零输出」与「有输出但未接线」。环按契约输出时，该规则与判定无关。
import fs from 'node:fs';

/** 契约行的唯一前缀与状态集（改动即破坏契约，消费侧会按「未接线」记 FAIL） */
export const RING_PREFIX = 'RING-STATE';
export const RING_STATES = ['PASS', 'FAIL', 'SKIP'];

/** 契约行形状：**行首（列 0）锚定** + 三态闭集 + 可空 reason。**只解析本契约，不解释任何自然语言。**
 *  ⚠ 三态词必须在**字段位置**（tag 之后的第二个字段）；正文里出现的「PASS/SKIP/全过」等字样
 *    不构成状态——这正是 N4（措辞面假绿）在本层的根治形态。
 *  ⚠ **前导空白不被剥除**（独立复核席反例 R1 实测）：若先 trim 再匹配，`^` 锚就形同虚设，
 *    `'    RING-STATE rpc PASS 引用来的'` 这类**缩进仿冒行**会被读成真状态。
 *    故只做**尾部** CR 归一，`^` 必须落在列 0。缩进行一律不是契约行（进退化位）。 */
export const RING_LINE_RE = new RegExp('^' + RING_PREFIX + '\\s+(\\S+)\\s+(PASS|FAIL|SKIP)(?:\\s+(.*))?$');

const ANSI_RE = /\u001b\[[0-9;]*m/g;
export const stripAnsi = (s) => String(s == null ? '' : s).replace(ANSI_RE, '');
export const REASON_MAX = 200;

/** 退化位用：node 自身噪声（不是环的读数）。**只影响「零输出」判定与摘要摘录，不影响三态判定。** */
export const NOISE_RE = /^\(node:\d+\)|EnvHttpProxyAgent|to show where the warning|^\s*Use `node --trace-warnings|^\s*$/;

/** reason 单行化（换行/制表压空格）+ 截断。纯机械处理，不做语义改写。 */
export function sanitizeReason(v) {
  const s = stripAnsi(v).replace(/\s+/g, ' ').trim();
  if (!s) return '（未给理由）';
  return s.length > REASON_MAX ? s.slice(0, REASON_MAX - 3) + '...' : s;
}

/** 组装契约行（非法 id / 三态外状态直接抛——**不接受第四态，也不静默降级**） */
export function formatRingState(id, state, reason) {
  if (!/^[A-Za-z0-9_.-]+$/.test(String(id))) throw new Error('ring id 非法：' + id);
  if (!RING_STATES.includes(state)) throw new Error('ring 状态非法（三态闭集外不接受）：' + state);
  return RING_PREFIX + ' ' + id + ' ' + state + ' ' + sanitizeReason(reason);
}

/** 打契约行。用 fs.writeSync(2) 直写 fd：**同步、无缓冲**——多个环用 process.exit() 收尾，
 *  缓冲写会与 exit 竞态丢行（丢掉读数正是本契约要治的病）。 */
export function emitRingState(id, state, reason) {
  const line = formatRingState(id, state, reason);
  try { fs.writeSync(2, line + '\n'); } catch (e) { try { process.stderr.write(line + '\n'); } catch (e2) { /* 读侧不可写时不再抛 */ } }
  return line;
}

/** 崩溃安全网：未捕获异常也留下状态行——「崩溃」与「判红」必须可区分（两者过去在 RING 行同形）。
 *  行为与原默认一致（打印堆栈 + 退出码 1），只多一行状态行。 */
export function installCrashGuard(id) {
  process.on('uncaughtException', (e) => {
    const stack = (e && e.stack) || String(e);
    try { fs.writeSync(2, stack + '\n'); } catch (e2) { /* 忽略 */ }
    try { emitRingState(id, 'FAIL', '未捕获异常：' + ((e && e.message) || String(e))); } catch (e3) { /* 忽略 */ }
    process.exit(1);
  });
}

/** stdout 纯净性守卫：把**行首为契约行**的输出从 stdout 抹掉。
 *  为什么需要：带 --json 的环，其 stdout 是**机读数据面**（消费方 JSON.parse 取值）；契约行走 stderr，
 *  故 stdout 上出现契约行一定是接错通道（或未来重构把 emitRingState 改错目标）。此守卫把那一类
 *  静默破坏数据面的改动，变成「数据面依旧可 parse」。
 *  ⚠ 只抹**行首即契约行**的行；JSON 字符串值里的同名字样不在行首，不受影响。无开关：守卫不得可被静默关闭。 */
export function installStdoutHygiene() {
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (!s.includes(RING_PREFIX + ' ')) return orig(chunk, ...rest);
    const kept = s.split('\n').filter((l) => !new RegExp('^\\s*' + RING_PREFIX + '\\s').test(l)).join('\n');
    return kept.trim() ? orig(kept, ...rest) : true;
  };
}

/** 从环输出中解析契约行（**只认行首锚定的闭集，不做子串匹配**）。返回 0/1/N 条。 */
export function parseRingState(text) {
  const out = [];
  for (const raw of stripAnsi(text).split('\n')) {
    // 只归一**尾部** CR；前导空白必须保留，^ 才是真锚（见上方 R1 注释）。
    const m = raw.replace(/\r$/, '').match(RING_LINE_RE);
    if (m) out.push({ id: m[1], state: m[2], reason: (m[3] || '').trim() });
  }
  return out;
}

/** 摘录环输出末行（**仅用于退化位的理由说明**，不参与三态判定） */
export function excerpt(text, max = 160) {
  const ls = stripAnsi(text).split('\n').map((l) => l.trim()).filter((l) => l && !NOISE_RE.test(l));
  if (!ls.length) return '（无输出）';
  const tail = ls[ls.length - 1].replace(/\s+/g, ' ');
  return tail.length > max ? tail.slice(0, max - 3) + '...' : tail;
}

/**
 * 由「环的原始输出 + 退出码」派生三态。**唯一裁决点**，优先级：结构 > 退出码 > 退化位。
 * 返回 { state, source, reason }：source='structure' = 读环自报契约行；
 * source='derived' = 退化位（无契约行），reason 必须写明是哪一种退化。
 *
 * 退化位（穷举，只有这几条；**不含任何对措辞的匹配**）：
 *   D0 多条契约行          -> FAIL（契约要求恰一条；歧义不得静默取一个）
 *   D1 id 与编排器声明不符  -> FAIL（接线错误）
 *   D2 状态与退出码矛盾     -> FAIL（PASS/SKIP 却非零退出；FAIL 却零退出）
 *   D3 有输出但无契约行     -> FAIL（契约未接线 / 旧版环）——fail-closed，不猜
 *   D4 零输出 + exit 0     -> SKIP「无读数」（沿用既有口径：没跑 ≠ 判过；不是 PASS）
 *   D5 零输出 + exit ≠ 0   -> FAIL
 */
export function deriveState({ id, exitCode, text, note } = {}) {
  if (note) return { state: 'FAIL', source: 'derived', reason: String(note) };
  const raw = stripAnsi(text);
  const lines = parseRingState(raw);
  if (lines.length > 1) {
    // 返回值同样冻结（复核席 c3）：堵住「在 results.push 之前改写 v」这一整类。
    return Object.freeze({ state: 'FAIL', source: 'derived', reason: '契约违背：本环输出 ' + lines.length + ' 条状态行（应恰 1 条）：' + lines.map((l) => l.id + '=' + l.state).join(' / ')  });
  }
  if (lines.length === 1) {
    const l = lines[0];
    if (id && l.id !== id) {
      // 返回值同样冻结（复核席 c3）：堵住「在 results.push 之前改写 v」这一整类。
      return Object.freeze({ state: 'FAIL', source: 'structure', reason: '契约违背：状态行 id「' + l.id + '」≠ 本环声明 id「' + id + '」'  });
    }
    if (l.state === 'FAIL' && exitCode === 0) {
      // 返回值同样冻结（复核席 c3）：堵住「在 results.push 之前改写 v」这一整类。
      return Object.freeze({ state: 'FAIL', source: 'structure', reason: l.reason + '（状态面 FAIL，退出码面 0——两面对不上，取严）'  });
    }
    if (l.state !== 'FAIL' && exitCode !== 0) {
      // 返回值同样冻结（复核席 c3）：堵住「在 results.push 之前改写 v」这一整类。
      return Object.freeze({ state: 'FAIL', source: 'structure', reason: '契约违背：自报 ' + l.state + ' 但退出码 ' + exitCode + '——' + l.reason  });
    }
    // 返回值同样冻结（复核席 c3）：堵住「在 results.push 之前改写 v」这一整类。
    return Object.freeze({ state: l.state, source: 'structure', reason: l.reason || '（环未给理由）'  });
  }
  const hasOutput = raw.split('\n').some((l) => l.trim() && !NOISE_RE.test(l.trim()));
  if (!hasOutput) {
    return exitCode === 0
      ? { state: 'SKIP', source: 'derived', reason: '本环零输出且 exit 0——无读数（不是 PASS）' }
      : { state: 'FAIL', source: 'derived', reason: '本环零输出且退出码 ' + exitCode };
  }
  return {
    state: 'FAIL', source: 'derived',
    reason: '本环未输出 ' + RING_PREFIX + ' 契约行（旧版环 / 未接线）——exit ' + exitCode + ' · 末行摘录 ' + excerpt(raw),
  };
}

/** 汇总（**退出码面与措辞面同源**，避免两处各算一遍）。
 *  接受两种字段名：state（本模块内部裁决产物）/ status（gate --json 对外既有字段名）。
 *  ⚠ 只读**已是字符串枚举**的字段，不再推断（绝不从摘要文本反推状态）。 */
export function verdictOf(results) {
  const stateOf = (r) => r.state || r.status;
  const n = (s) => results.filter((r) => stateOf(r) === s).length;
  const fail = n('FAIL'); const skip = n('SKIP'); const pass = n('PASS');
  return {
    total: results.length, pass, fail, skip,
    unjudged: results.filter((r) => stateOf(r) === 'SKIP').map((r) => r.id),
    verdict: fail ? 'FAIL' : skip ? 'NOT_FULLY_JUDGED' : 'ALL_PASS',
    exitCode: fail ? 1 : 0,
  };
}

/** 摘要行：来源可辨（环自报 vs 退化位）——读者不必猜这条读数是判出来的还是回退出来的 */
export function summarize(entry) {
  return (entry.source === 'structure' ? '环自报：' : '退化位（无契约行）：') + entry.reason;
}
