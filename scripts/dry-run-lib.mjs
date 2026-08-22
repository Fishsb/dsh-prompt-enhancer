// dry-run-lib.mjs — v3.3.x（A6·三层干跑库 · 批次二起为薄委托层）
// 目标：把「启动期爆炸」提前到安装/部署期拦截。三层：
//   ① dump-config   —— 官方 `dsh --profile X --dump-config` 只组合不启动，验组合语法层。
//                       【实测】引用不存在包的 patch 照样 exit=0 → 本层只拦 YAML/结构损坏。
//   ② resolve-probe —— 解析 dump 输出的全部 entry name，从 profile 与 dsh-install 两根
//                       require.resolve（官方语义：内置从安装目录解析、pnpm 管树外），
//                       任一不可解析即失败。拦 A1 peer 缺失 / A2 lockfile 剪枝类事故。
//   ③ node --check  —— 产物语法门（lib/sys.cjs syntaxCheckFiles），拦包内损坏。
// 单一事实源（批次二 B1/A4）：实现移入 lib/maintain-lib.cjs——救援 CLI 运行环境只有
// lib/ 目录可用；本文件保持原 ESM API 供 scripts/ 侧（sync-runtime 等）继续使用。
import { createRequire } from 'node:module';

const cjs = createRequire(import.meta.url)('../lib/maintain-lib.cjs');

export function resolveDshBin(explicit) {
  return cjs.resolveDshBin(explicit);
}

export function dumpCompose(opts) {
  return cjs.dumpCompose(opts);
}

export function extractEntryNames(dumpOutput) {
  return cjs.extractEntryNames(dumpOutput);
}

export function resolveProbe(names, roots) {
  return cjs.resolveProbe(names, roots);
}

export async function dryRunAll(opts) {
  return cjs.dryRunAll(opts);
}
