// scripts/lib/gov-root.mjs — 治理根**跨环境发现**（路径发现，不是判据）
//
// 为什么要有它（2026-10-12 环境无关化·第一批）：
//   `arch-claims.mjs` / `card-arch-consistency.mjs` 原本把治理根**硬编码成 Windows 盘符** `D:\FF`。
//   后果不是「找不到治理档」，而是**同一台机器的两个视角给出不同判定**：本仓在 WSL 下开发时治理根
//   实际是 `/mnt/d/FF`（= `D:\FF` 的同一份目录），硬编码盘符必然落空 ⇒ SNAP_ENV 记成
//   `gov-unreadable` ⇒ A194-4 / S-2 两条断言被迫 SKIP、投影判「读数漂移」⇒ **arch-claims 环 FAIL、
//   gate 整链 exit 1**。实测证据（本批）：
//     `node scripts/gate.mjs`                         ⇒ exit 1（arch-claims FAIL 文档漂移）
//     `PE_GOV_ROOT=/mnt/d/FF node scripts/gate.mjs`   ⇒ exit 0（5 环全 PASS）
//   一句判据面一个字没改、只是**找错了地方** —— 正是本批 A 类要拿掉的「必须某个特定环境才能跑」。
//
// 口径（**只影响「找不找得到」，不改变任何判据内容**，也不放宽任何断言）：
//   ① 显式 `PE_GOV_ROOT` 永远最高优先，且**即使不存在也原样采信**（保持显式声明的可预测性）；
//   ② 其次平台惯用候选；
//   ③ 再把 Windows 盘符路径映射成 WSL 镜像（`D:\FF` → `/mnt/d/FF`，盘符小写）；
//   ④ 全都不存在 ⇒ 退回惯用缺省（消费方据此判 `gov-unreadable`，CI/干净 clone 语义不变）。
import fs from 'node:fs';

/** 平台惯用缺省（保持既有行为：Windows 侧治理根就是它）。 */
export const DEFAULT_GOV_ROOT = 'D:\\FF';

/** Windows 盘符路径 → WSL 镜像路径；非盘符路径原样返回。`D:\FF` → `/mnt/d/FF` */
export function wslMirror(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(String(p));
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/') : p;
}

/** 按优先级列出候选治理根（去重，不改判据）。 */
export function govRootCandidates(env = process.env) {
  const out = [];
  const push = (p) => { if (p && !out.includes(p)) out.push(p); };
  push(env.PE_GOV_ROOT);
  push(DEFAULT_GOV_ROOT);
  for (const p of out.slice()) push(wslMirror(p));
  return out;
}

/** 解析治理根：显式 env 优先（无条件采信）；否则取第一个真实存在的候选；都不存在则回缺省。 */
export function resolveGovRoot(env = process.env) {
  if (env.PE_GOV_ROOT) return env.PE_GOV_ROOT;
  for (const p of govRootCandidates(env)) {
    try { if (fs.existsSync(p)) return p; } catch { /* 不可访问的候选跳过 */ }
  }
  return DEFAULT_GOV_ROOT;
}
