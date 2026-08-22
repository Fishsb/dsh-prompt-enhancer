'use strict';
/**
 * dsh-prompt-enhancer — 维护/救援共享库（批次二 A4/B1 · v3.3.x）。
 *
 * 消费方：lib/updater-host.cjs 的 `--cli maintain` 维护菜单（运行时部署环境只有 lib/
 * 目录可用——scripts/dry-run-lib.mjs 不随发布物分发，故干跑三层在此提供 CJS 版；
 * scripts/dry-run-lib.mjs 经 ESM→CJS interop 委托本库保持单一事实源）。
 * 零 DSH 服务依赖：纯 node 内置 + ./sys.cjs（与执行器同款纪律）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const sys = require('./sys.cjs');

// ============================================================================
// 三层干跑（A6 CJS 形态：①组合语法 ②模块可解析 ③产物语法——③复用 sys.syntaxCheckFiles）
// ============================================================================

/** 定位 dsh bin：显式入参 > DSH_BIN > PATH 上的 dsh。 */
function resolveDshBin(explicit) {
  if (explicit) return explicit;
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  return 'dsh';
}

/** 第①层：组合干跑（官方 --dump-config 只组合不启动）。ok=false 时 output 为摘要。
 *  dshBinIsNodeScript=true 时 dshBin 视为 node 脚本、经当前 node 直启——
 *  演练/测试注入用（Windows spawnSync 无 shell 不能直启 .cmd，Node≥18 直接 EINVAL）。 */
function dumpCompose(opts) {
  const o = opts || {};
  const bin = resolveDshBin(o.dshBin);
  const baseArgs = ['--profile', String(o.profile || 'web'), '--dump-config'];
  const isNodeScript = o.dshBinIsNodeScript || process.env.DSH_BIN_NODE_SCRIPT === '1';
  const r = isNodeScript
    ? spawnSync(process.execPath, [bin].concat(baseArgs), { encoding: 'utf8', windowsHide: true, timeout: o.timeoutMs || 60000 })
    : spawnSync(bin, baseArgs, { encoding: 'utf8', windowsHide: true, timeout: o.timeoutMs || 60000 });
  const output = String(r.stdout || '') + String(r.stderr || '');
  return { ok: r.status === 0 && output.includes('== '), output: output.slice(0, 20000), code: r.status };
}

/** 从 dump 输出提取 entry name（宽松正则：兼容引号/裸值；过滤 !!js 表达式行——方案 R-d）。
 * 保守口径：仅收含 scope 分隔（'/'）的值——dump 里可能混有其他 `name:` 键，宁漏勿误
 * （误报会让干跑闸门错杀好安装）。无 scope 的裸包名（如 dshmarket）由调用方经
 * extraNames 显式补充（救援/菜单流程从 profile package.json 拿到权威 bundles 清单）。 */
function extractEntryNames(dumpOutput) {
  const names = new Set();
  for (const m of String(dumpOutput || '').matchAll(/^\s*-?\s*name:\s*['"]?([A-Za-z0-9@/._-]+)['"]?\s*$/gm)) {
    const v = m[1];
    if (!v || v.includes('ctx.') || !v.includes('/')) continue; // 包名必含 scope 分隔；排除表达式
    names.add(v);
  }
  return [...names];
}

/**
 * 第②层：模块可解析探测。names 中任一从任一根解析失败即 fail。
 * roots 顺序 = 解析优先级（树外包 profile 在前、内置安装目录在后——两根并试，假设 #11 实施首日验证项）。
 */
function resolveProbe(names, roots) {
  const missing = [];
  for (const name of names || []) {
    let resolved = false;
    let lastErr = '';
    for (const root of roots || []) {
      try {
        if (!root || !fs.existsSync(root)) continue;
        createRequire(path.join(root, 'package.json')).resolve(name);
        resolved = true;
        break;
      } catch (e) { lastErr = String(e && e.code ? e.code : e); }
    }
    if (!resolved) missing.push({ name, lastErr });
  }
  return { ok: missing.length === 0, missing };
}

/** 全流程便捷入口：①→②→③（③可选）。extraNames = 调用方已知的权威包名（无 scope 裸名补录）。
 * 返回 { ok, layer, detail }——首个失败层即停。 */
function dryRunAll(opts) {
  const o = opts || {};
  const l1 = dumpCompose({ profile: o.profile, dshBin: o.dshBin });
  if (!l1.ok) return { ok: false, layer: 'compose', detail: l1.output.slice(0, 500) };
  const names = [...new Set([...extractEntryNames(l1.output), ...(o.extraNames || [])])];
  const l2 = resolveProbe(names, o.roots);
  if (!l2.ok) return { ok: false, layer: 'resolve', detail: JSON.stringify(l2.missing.slice(0, 5)) };
  if (o.artifactFiles && o.artifactFiles.length) {
    const l3 = sys.syntaxCheckFiles(o.artifactFiles);
    if (!l3.ok) return { ok: false, layer: 'syntax', detail: JSON.stringify(l3.failures[0] || {}) };
  }
  return { ok: true, layer: 'all', detail: { entries: names.length } };
}

/** dsh 安装根推导（resolve-probe 第二根）：DSH_INSTALL_DIR > nssm AppParameters 反推 > null。 */
function dshInstallRoot() {
  if (process.env.DSH_INSTALL_DIR && fs.existsSync(process.env.DSH_INSTALL_DIR)) {
    return process.env.DSH_INSTALL_DIR;
  }
  try {
    const r = spawnSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\dsh-web\\Parameters', '/v', 'AppParameters'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    const m = /REG_EXPAND_SZ\s+(\S+)/.exec(String(r.stdout || ''));
    if (m) {
      const nm = String(m[1]).split(/[\\/]/).indexOf('node_modules');
      if (nm > 0) {
        const root = String(m[1]).split(/[\\/]/).slice(0, nm).join('\\');
        if (root && fs.existsSync(root)) return root;
      }
    }
  } catch { /* fallthrough */ }
  return null;
}

/** 干跑双根推导：树外包根 = profile 目录；内置根 = dsh 安装目录（可缺）。 */
function dryRunRoots(homeOverride, profileName) {
  const home = homeOverride || process.env.DSH_HOME ||
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  const roots = [];
  const pd = path.join(home, 'profiles', profileName || 'web');
  if (fs.existsSync(pd)) roots.push(pd);
  const inst = dshInstallRoot();
  if (inst) roots.push(inst);
  return roots;
}

// ============================================================================
// profile 装配面读取与改写（救援 Step0/Step2 用）
// ============================================================================

function profilePaths(homeOverride, profileName) {
  const home = homeOverride || process.env.DSH_HOME ||
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  const dir = path.join(home, 'profiles', profileName || 'web');
  return {
    home,
    dir,
    packageJson: path.join(dir, 'package.json'),
    patchYml: path.join(dir, 'cordis.patch.yml'),
    workspaceYml: path.join(dir, 'pnpm-workspace.yaml'),
    homePatchYml: path.join(home, 'cordis.patch.yml'),
  };
}

/** 读 profile package.json（损坏返回 null——诊断态不抛）。 */
function readProfilePackage(pp) {
  try {
    return JSON.parse(fs.readFileSync((pp && pp.packageJson) || pp, 'utf8'));
  } catch { return null; }
}

/** bundles 清单（dsh.profile.bundles）；缺省 []。 */
function bundleList(pkg) {
  return (pkg && pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles))
    ? pkg.dsh.profile.bundles.filter((n) => typeof n === 'string' && n !== '')
    : [];
}

/** 官方基座判定：@deepseek-ai/* 为不可禁基座（§5.3 纪律二）。 */
function isOfficialBase(name) {
  return typeof name === 'string' && name.startsWith('@deepseek-ai/');
}

/** 第三方 bundles（救援处置候选集）。 */
function thirdPartyBundles(pkg) {
  return bundleList(pkg).filter((n) => !isOfficialBase(n));
}

/** 从 bundles 移除条目并写回（JSON 结构安全改写；只动 dsh.profile.bundles 数组）。 */
function removeBundle(pkgPath, name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const arr = pkg && pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles)
      ? pkg.dsh.profile.bundles : null;
    if (!arr) return { ok: false, message: 'bundles 列表不存在' };
    const next = arr.filter((n) => n !== name);
    if (next.length === arr.length) return { ok: false, message: 'bundles 无此条目: ' + name };
    pkg.dsh.profile.bundles = next;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

/** 读 patch 层已禁用 id 集（宽松匹配 `- id: X` 行 + 其后 disabled:true 块）。 */
function readPatchIds(patchYmlPath) {
  let text = '';
  try { text = fs.readFileSync(patchYmlPath, 'utf8'); } catch { return []; }
  const ids = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const idm = /^\s*-\s*id:\s*['"]?([A-Za-z0-9@/._-]+)['"]?\s*$/.exec(line);
    if (idm) { cur = idm[1]; continue; }
    if (cur && /^\s+disabled:\s*true\s*$/.test(line)) ids.push(cur);
    if (/^\s*-\s/.test(line) && !idm) cur = null;
  }
  return ids;
}

const PATCH_HEADER = '# Your patch layer for this dsh profile, applied after every bundle layer:\n' +
  '# a top-level YAML array of loader patch entries (id-targeted config\n' +
  '# overrides, disables, and insert lists; `!!js` expressions allowed).\n';

/**
 * 全量重写 patch 层为「静态 disabled 记忆条目」集合（二分定位每轮重建用；幂等）。
 * ⚠️ 会丢弃原有人工 patch 条目——调用前必须已完成 Step1 快照（只禁用不删除的回退锚点）。
 * 格式对齐 dev_uninject_plugin 防 include.refresh 复活（E3）。
 */
function writeDisableEntries(patchYmlPath, ids) {
  const list = [...new Set(ids || [])];
  const body = list.length
    ? list.map((id) => '- id: ' + JSON.stringify(id) + '\n  disabled: true\n').join('')
    : '[]\n';
  fs.writeFileSync(patchYmlPath, PATCH_HEADER + body, 'utf8');
  return { ok: true, count: list.length };
}

/** 追加一条静态 disabled 条目（保留原文件内容——精准禁用路径用）。 */
function appendDisableEntry(patchYmlPath, id) {
  let text = '';
  try { text = fs.readFileSync(patchYmlPath, 'utf8'); } catch { text = ''; }
  const trimmed = text.replace(/\s+$/, '');
  const entry = '- id: ' + JSON.stringify(id) + '\n  disabled: true';
  let next;
  if (!trimmed || trimmed === '[]') {
    next = PATCH_HEADER + entry + '\n';
  } else if (trimmed.endsWith('[]')) {
    next = trimmed.slice(0, -2) + entry + '\n]\n';
  } else {
    next = trimmed + '\n' + entry + '\n';
  }
  fs.writeFileSync(patchYmlPath, next, 'utf8');
  return { ok: true };
}

/**
 * F1 悬空 junction 清理：扫描 profile node_modules 一级 link，目标不存在则摘除链接本身。
 * 只删链接不删数据（救援纪律一）；返回清理清单。
 */
function sweepDanglingLinks(profileDir) {
  const nm = path.join(profileDir, 'node_modules');
  const removed = [];
  let entries = [];
  try { entries = fs.readdirSync(nm); } catch { return removed; }
  for (const name of entries) {
    const p = path.join(nm, name);
    try {
      const st = fs.lstatSync(p);
      if (!st.isSymbolicLink() && !st.isJunction?.()) {
        // junction 在 Windows 上 lstat 报 symbolicLink；非链接跳过
        if (!st.isSymbolicLink()) continue;
      }
      const target = fs.readlinkSync(p);
      const abs = path.isAbsolute(target) ? target : path.resolve(path.dirname(p), target);
      if (!fs.existsSync(abs)) {
        fs.rmSync(p, { recursive: false, force: true });
        removed.push(name + ' → ' + target);
      }
    } catch { /* 单个失败不影响其余 */ }
  }
  return removed;
}

// ============================================================================
// G7①·日志路径发现（nssm 注册表 Parameters/AppStdout|AppStderr，不写死）+ 尾部抓取
// ============================================================================

function expandEnvVars(s) {
  return String(s || '').replace(/%([^%]+)%/g, (all, name) => process.env[name] || all);
}

/** 返回服务 stdout/stderr 日志路径数组（发现失败返回空数组，不抛）。 */
function serviceLogPaths(serviceName) {
  if (process.platform !== 'win32') return [];
  const out = [];
  try {
    const r = spawnSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + serviceName + '\\Parameters'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    const text = String(r.stdout || '');
    for (const key of ['AppStdout', 'AppStderr']) {
      const m = new RegExp(key + '\\s+REG_(?:EXPAND_)?SZ\\s+(\\S+)').exec(text);
      if (m) out.push(expandEnvVars(m[1]));
    }
  } catch { /* 尽力而为 */ }
  return out.filter((p, i, a) => a.indexOf(p) === i);
}

/** 读文件尾部 ≤maxLines 行（文件缺失返回 ''）。 */
function tailLines(file, maxLines) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    return lines.slice(-Math.max(1, maxLines || 200)).join('\n');
  } catch { return ''; }
}

// ============================================================================
// 元凶指认（G12：指认名 ≠ 禁用名——报错模块可能是 peer 依赖而非 bundle 条目）
// ============================================================================

/** 从日志文本提取可疑信号：缺失模块名 / SyntaxError 文件 / duplicate 症状。 */
function scanCulprits(logText) {
  const modules = [];
  const syntaxErrors = [];
  let duplicate = false;
  for (const line of String(logText || '').split(/\r?\n/)) {
    for (const m of line.matchAll(/Cannot find module ['"]([^'"]+)['"]/g)) {
      if (!modules.includes(m[1])) modules.push(m[1]);
    }
    if (/SyntaxError/.test(line)) syntaxErrors.push(line.trim().slice(0, 200));
    if (/ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM/.test(line) && !modules.length && !syntaxErrors.length) {
      // 兜底行（无具体模块名时至少留下错误类别证据）
      if (!syntaxErrors.includes(line.trim().slice(0, 200))) syntaxErrors.push(line.trim().slice(0, 200));
    }
    if (/duplicate|already registered/i.test(line)) duplicate = true;
  }
  return { modules, syntaxErrors: syntaxErrors.slice(0, 10), duplicate };
}

/**
 * 缺失模块 → 声明该依赖的宿主包（bundles 第三方条目里找 dependencies/peerDependencies/
 * optionalDependencies 键命中者）。映射不到返回 []（退化路径=列第三方条目供人选）。
 */
function mapCulpritToBundles(culpritModule, pp, pkg) {
  const hits = [];
  const c = String(culpritModule || '');
  for (const name of thirdPartyBundles(pkg)) {
    const pkgJsonPath = path.join(pp.dir, 'node_modules', ...name.split('/'), 'package.json');
    let deps = null;
    try {
      const pj = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      deps = { ...pj.dependencies, ...pj.peerDependencies, ...pj.optionalDependencies };
    } catch { /* 包目录可能已损坏——恰是需要怀疑的对象 */ }
    if (deps && Object.keys(deps).some((k) => c === k || c.startsWith(k + '/'))) hits.push(name);
    else if (!fs.existsSync(pkgJsonPath)) hits.push(name); // 条目在 bundles 但包目录缺失 = 直接嫌疑
  }
  return hits;
}

// ============================================================================
// 决策纯函数（单测切片）
// ============================================================================

/** 语义化版本比较（容忍 v 前缀 / 预发布段按字典序兜底）；非法输入返回 null。 */
function compareSemver(a, b) {
  const parse = (s) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(String(s || '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || ''] : null;
  };
  const pa = parse(a); const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  if (pa[3] !== pb[3]) return pa[3] < pb[3] ? -1 : 1;
  return 0;
}

/**
 * G5 版本方向门（menu2 应用更新）：返回动作决策。
 * downgrade/equal 必须显式确认；invalid 任一侧版本不可读时要求确认但注明原因。
 * （2026-08-22 单测抓出并修复：原实现比较方向写反——降级会被当升级直接放行。）
 */
function decideUpdateAction(curVer, newVer) {
  const cmp = compareSemver(curVer, newVer);
  if (curVer == null || newVer == null || cmp === null) {
    return { action: 'confirm', reason: 'version-unreadable', detail: '当前=' + (curVer || '?') + ' 新=' + (newVer || '?') };
  }
  if (cmp > 0) return { action: 'confirm-downgrade', reason: 'older', detail: curVer + ' → ' + newVer + '（降级！）' };
  if (cmp === 0) return { action: 'confirm-equal', reason: 'same', detail: curVer + '（同版本重装）' };
  return { action: 'proceed', reason: 'upgrade', detail: curVer + ' → ' + newVer };
}

/** G6 DSH 家族镜像判定：镜像名含 dsh，或 node.exe（3080 是 DSH 的端口）→ 自动杀；否则须确认。 */
function isDshFamilyImage(image) {
  const img = String(image || '');
  return /dsh/i.test(img) || /^node(\.exe)?$/i.test(img);
}

module.exports = {
  // 干跑三层
  resolveDshBin,
  dumpCompose,
  extractEntryNames,
  resolveProbe,
  dryRunAll,
  dryRunRoots,
  dshInstallRoot,
  // 装配面读取/改写
  profilePaths,
  readProfilePackage,
  bundleList,
  isOfficialBase,
  thirdPartyBundles,
  removeBundle,
  readPatchIds,
  writeDisableEntries,
  appendDisableEntry,
  sweepDanglingLinks,
  // 日志与指认
  serviceLogPaths,
  tailLines,
  scanCulprits,
  mapCulpritToBundles,
  expandEnvVars,
  // 决策纯函数
  compareSemver,
  decideUpdateAction,
  isDshFamilyImage,
};
