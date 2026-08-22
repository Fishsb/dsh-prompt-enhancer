// dry-run-lib.mjs — v3.3.x（A6·三层干跑库）
// 目标：把「启动期爆炸」提前到安装/部署期拦截。三层：
//   ① dump-config   —— 官方 `dsh --profile X --dump-config` 只组合不启动，验组合语法层。
//                      【实测】引用不存在包的 patch 照样 exit=0 → 本层只拦 YAML/结构损坏。
//   ② resolve-probe —— 解析 dump 输出的全部 entry name，从 profile 与 dsh-install 两根
//                      require.resolve（官方语义：内置从安装目录解析、pnpm 管树外），
//                      任一不可解析即失败。拦 A1 peer 缺失 / A2 lockfile 剪枝类事故。
//   ③ node --check  —— 产物语法门（lib/sys.cjs syntaxCheckFiles），拦包内损坏。
// 使用方：scripts/sync-runtime.mjs（部署前）；救援 CLI 批次二接线同一库。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/** 定位 dsh bin：显式入参 > DSH_BIN > PATH 上的 dsh。 */
export function resolveDshBin(explicit) {
  if (explicit) return explicit;
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  return 'dsh';
}

/** 第①层：组合干跑。返回 { ok, output, code }；ok=false 时 output 为 stderr 摘要。 */
export function dumpCompose({ profile, dshBin, timeoutMs = 60000 } = {}) {
  const bin = resolveDshBin(dshBin);
  const r = spawnSync(bin, ['--profile', String(profile || 'web'), '--dump-config'], {
    encoding: 'utf8', windowsHide: true, timeout: timeoutMs,
  });
  const output = String(r.stdout || '') + String(r.stderr || '');
  return { ok: r.status === 0 && output.includes('== '), output: output.slice(0, 20000), code: r.status };
}

/** 从 dump 输出提取 entry name（宽松正则：兼容引号/裸值；过滤 !!js 表达式行）。 */
export function extractEntryNames(dumpOutput) {
  const names = new Set();
  for (const m of String(dumpOutput || '').matchAll(/^\s*-?\s*name:\s*['"]?([A-Za-z0-9@/._-]+)['"]?\s*$/gm)) {
    const v = m[1];
    if (!v || v.includes('ctx.') || !v.includes('/')) continue; // 包名必含 scope 分隔或点路径；排除表达式
    names.add(v);
  }
  return [...names];
}

/**
 * 第②层：模块可解析探测。names 中任一从任一根解析失败即 fail。
 * roots 顺序 = 解析优先级（树外包 profile 在前、内置安装目录在后——两根并试）。
 */
export function resolveProbe(names, roots) {
  const missing = [];
  for (const name of names || []) {
    let resolved = false;
    let lastErr = '';
    for (const root of roots || []) {
      try {
        if (!existsSync(root)) continue;
        createRequire(root + '/package.json').resolve(name);
        resolved = true;
        break;
      } catch (e) { lastErr = String(e && e.code ? e.code : e); }
    }
    if (!resolved) missing.push({ name, lastErr });
  }
  return { ok: missing.length === 0, missing };
}

/**
 * 全流程便捷入口：①→②→③（③由 lib/sys.cjs syntaxCheckFiles 提供）。
 * 返回 { ok, layer, detail } —— 首个失败层即停。
 */
export async function dryRunAll({ profile, roots, artifactFiles, dshBin, syntaxCheckFiles }) {
  const l1 = dumpCompose({ profile, dshBin });
  if (!l1.ok) return { ok: false, layer: 'compose', detail: l1.output.slice(0, 500) };
  const names = extractEntryNames(l1.output);
  const l2 = resolveProbe(names, roots);
  if (!l2.ok) return { ok: false, layer: 'resolve', detail: JSON.stringify(l2.missing.slice(0, 5)) };
  if (syntaxCheckFiles) {
    const l3 = syntaxCheckFiles(artifactFiles || []);
    if (!l3.ok) return { ok: false, layer: 'syntax', detail: JSON.stringify(l3.failures[0] || {}) };
  }
  return { ok: true, layer: 'all', detail: { entries: names.length } };
}
