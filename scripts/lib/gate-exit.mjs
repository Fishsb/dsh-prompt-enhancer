'use strict';
// scripts/lib/gate-exit.mjs — 链级三态退出码**单一契约**（T3 / N3 · 2026-09-27 · 用户裁定 A）
//
// 为什么单独立一份：退出码是本门禁链**唯一的 CI 消费面**（CI 只看 exit code；`--json` 此前全仓
//   无消费者）。写方（gate.mjs）与消费方（CI、单测）必须按**同一份**语义读写；各写一遍 = 契约本身
//   变成"两处描述同一件事、迟早漂移"——本链 2026-09-26 那三次补丁（I2 整段子串 / N2 末 N 行窗口 /
//   N4 措辞自含反义）的病根同型：读方按自己的猜法重新解释写方的文本。故此处只放**纯函数 + 常量**，
//   不含任何自然语言匹配、不产生副作用（可在单测里直接断言真值表）。
//
// ── 契约 v1（三态退出码）──
//   0 = ALL_PASS          全环都**真判过且通过**（"全过"三个字的唯一机器含义）
//   1 = FAIL              任一环 FAIL（**失败优先于未判全**：有失败时先修失败）
//   2 = NOT_FULLY_JUDGED  无 FAIL，但至少一环**没判上**（SKIP / 无读数 / 任何非 PASS 状态）
//   ⚠ 2 与 0 必须在退出码上可分 —— 否则「有环没判」与「全判通过」在 CI 眼里完全同形（N3 根因）。
//   ⚠ 分母为 0 不许判绿（本仓既有纪律，见 card-arch A-3 空扫护栏）：**零环**（空状态集）算
//     NOT_FULLY_JUDGED，不因"没有环报错"而判 ALL_PASS。
//
// ── 接纳基线（accept baseline）──
//   有些 SKIP 是**结构性缺位**而非缺陷：本仓 arch-claims / cards 两环的扫描面 = 本地治理档 + 治理根，
//   在**仓外且 gitignore** ⇒ 干净 clone 与 CI 上**必然**缺位。把"缺位"改叫"失败"（缺位即红）只会
//   得到永久红——读数照样不可用（本轮已明确不采纳该口径）。故由**消费者显式声明**基线集合：
//   仅当「未判集合 ⊆ 基线」时把 2 降为 0（并打接纳行留痕），**否则仍为 2**（新出现的缺位不被静默吞掉）。
//   · 基线只认 **id**（结构面），不认理由文本 —— 理由随措辞漂移，id 不漂移。
//   · 空基线 / 未判集合为空 ⇒ **一律不接纳**（fail-closed："没有可判对象"不得冒充"已接纳"）。
//   · 基线**不得**写进 package.json 的 `gate` 脚本（否则本地默认被静默降级）；由单测锁定。
//   ⚠ 残留边界（如实登记，不冒充已堵）：接纳是**环粒度**——某环在基线内但**因其它原因**未判时，
//     退出码仍为 0；补偿 = gate 照打该环的 SKIP 摘要，CI 日志可读（见 gate.mjs 接纳行）。

/** 三态退出码（**唯一取值处**；改这里即改契约，单测 GATEEXIT-01 会红） */
export const GATE_EXIT = Object.freeze({ ALL_PASS: 0, FAIL: 1, NOT_FULLY_JUDGED: 2 });

/** 由各环状态派生链级 verdict。失败优先；任何非 PASS 状态（SKIP / UNKNOWN / 空表）一律算未判全。 */
export function verdictOf(statuses) {
  const list = (Array.isArray(statuses) ? statuses : []).map((s) => String(s).toUpperCase());
  if (list.includes('FAIL')) return 'FAIL';
  if (!list.length) return 'NOT_FULLY_JUDGED';          // 零环 = 什么都没判 ⇒ 不判绿（fail-closed）
  if (list.some((s) => s !== 'PASS')) return 'NOT_FULLY_JUDGED';
  return 'ALL_PASS';
}

/** verdict → 退出码；未知 verdict 一律 fail-closed 落到 2（不落 0）。 */
export function exitCodeOf(verdict) {
  return Object.prototype.hasOwnProperty.call(GATE_EXIT, verdict)
    ? GATE_EXIT[verdict]
    : GATE_EXIT.NOT_FULLY_JUDGED;
}

/** 解析 `--accept-unjudged=a,b` 或 `--accept-unjudged a,b`；未给出 → null（= 不接纳任何未判）。 */
export function parseAcceptBaseline(argv) {
  const a = Array.isArray(argv) ? argv.map(String) : [];
  let raw = null;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith('--accept-unjudged=')) raw = a[i].slice('--accept-unjudged='.length);
    else if (a[i] === '--accept-unjudged' && a[i + 1] !== undefined) raw = a[i + 1];
  }
  if (raw === null) return null;
  return Array.from(new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)));
}

/** 应用接纳基线。返回 {code, verdict, unjudged, baseline, blocking, accepted, unexpected}。
 *  accepted=true ⇔ verdict 恰为 NOT_FULLY_JUDGED ∧ 未判集合**非空** ∧ ⊆ 基线（且基线非空）∧ **无可接纳面之外的阻塞**。
 *
 *  @param blocking 不可接纳面：**非 PASS 且非 SKIP** 的环 id（如零输出的 UNKNOWN）。
 *    为什么必须单列（独立复核席实测的真缺口 D2）：SKIP = 判据**自己声明**"本地扫描面缺位"——
 *    可枚举、可基线化；UNKNOWN = 环**根本没给出读数**（脚本被换空/静默坏死）——那是**缺陷**不是缺位。
 *    若允许它被基线吸收，则"把门环换成空脚本"就能让链级报 0，与本裁定要堵的假绿**同形**
 *    （实测旧行为：把 arch-claims 换成 0 字节 exit 0 的 no-op ⇒ 加基线后仍 exit 0）。
 *    故此面**优先于一切接纳判断**：只要非空，无论 id 是否在基线内，一律拒绝并要求仍是 NOT_FULLY_JUDGED。 */
export function applyBaseline(verdict, unjudged, baseline, blocking) {
  const u = Array.from(new Set((unjudged || []).map(String)));
  const base = baseline === null || baseline === undefined ? [] : Array.from(new Set(baseline.map(String)));
  const blk = Array.from(new Set((blocking || []).map(String)));
  const refused = { code: exitCodeOf(verdict), verdict, unjudged: u, baseline: base, blocking: blk, accepted: false, unexpected: verdict === 'NOT_FULLY_JUDGED' ? u : [] };
  if (blk.length) {
    // 失败优先仍优先：有 FAIL 时保持 1；否则一律落未判全（不得因 id 恰在基线内而放过）
    return { ...refused, code: verdict === 'FAIL' ? GATE_EXIT.FAIL : GATE_EXIT.NOT_FULLY_JUDGED, unexpected: Array.from(new Set([...refused.unexpected, ...blk])) };
  }
  if (verdict !== 'NOT_FULLY_JUDGED') return refused;   // FAIL 永不接纳（失败优先）
  // 空基线 / 无未判对象 ⇒ 不接纳（fail-closed）。⚠ `!base.length` 这一支**当前被下一行的 unexpected
  //   分支完全覆盖**（基线为空 ⇒ 任何非空未判集合都落在基线外）——变异测试实测：删掉它行为逐项不变。
  //   保留它作为**前置守卫**：把"空基线不得接纳"写在判定入口，而非依赖下游推导；日后若改动 unexpected
  //   的算法，它仍是承重条件（GATEEXIT-11 穷举锁最终行为，不锁实现写法）。
  if (!base.length || !u.length) return refused;
  const unexpected = u.filter((id) => !base.includes(id));
  if (unexpected.length) return { ...refused, unexpected };
  // ⚠ 返回形状必须与其它分支**逐键一致**（独立复核席 D1 的连带发现：本条最初漏了 blocking，
  //   于是"可接纳"路径的 r.blocking === undefined，下游若遍历该字段就崩）。接线实测见 GATEEXIT-11 的形状断言。
  return { code: GATE_EXIT.ALL_PASS, verdict, unjudged: u, baseline: base, blocking: blk, accepted: true, unexpected: [] };
}
