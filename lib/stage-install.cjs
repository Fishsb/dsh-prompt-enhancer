'use strict';
/**
 * dsh-prompt-enhancer — staging tarball 安装域（批次二抽取 · v3.3.x）。
 *
 * 为什么独立成模块：维护菜单 CLI（updater-host --cli maintain）要复用
 * installStagedTarball/findStagedTarball，但 lib/index.cjs 模块加载即写进程索引
 * （setInterval 探测 3080 就绪后写 dsh-prompt-enhancer.json）——CLI 进程 require 它会把
 * 索引污染成自己的 pid。本模块零副作用，host（index.cjs）与 CLI 双向复用同一实现，
 * 杜绝逻辑分叉（批次一导出纪律的延续）。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const sys = require('./sys.cjs');

/** v4.8：DSH_HOME 统一解析（与 asr-models/sys 同口径）。 */
function dshHomeDir() {
  return process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
}

/** staging 目录里最新的待装 tgz（无则 null）。 */
function findStagedTarball() {
  try {
    const dir = path.join(sys.EXECUTOR_ROOT, 'staging');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter((f) => /^dsh-prompt-enhancer-.*\.tgz$/.test(f))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files.length ? path.join(dir, files[0].f) : null;
  } catch (e) { return null; }
}

/**
 * 读 tgz 内 package/package.json 的 version（G5 版本方向门用；失败返回 ''）。
 * 用 System32 bsdtar -O 直出 stdout（不落盘）。
 */
function peekTarballVersion(tgzPath) {
  try {
    const tarBin = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
    const r = spawnSync(tarBin, ['-xzf', String(tgzPath).replace(/\\/g, '/'), '-O', 'package/package.json'], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    if (r.status !== 0) return '';
    const pj = JSON.parse(String(r.stdout || ''));
    return typeof pj.version === 'string' ? pj.version : '';
  } catch { return ''; }
}

/**
 * v3.2.1-r（安装与 host 解耦）：staging tgz 安装 = 直接解包覆盖运行环境目录，
 * 不用 `dsh plugin add`（= pnpm add）——pnpm 操作**正在运行的 profile** 会冻结 host
 * 事件循环（2026-08-19 实测根因）。npm pack tgz 解包 + 文件级覆盖复制，秒级完成。
 *
 * 门禁链（批次一/二）：包名校验 → sha256 旁挂复验（v3.3.2）→ A6 语法层 node --check →
 * A5 安装即快照（返回 snapshotDir 供失败回滚/救援回退）→ 覆盖复制。
 * 批次二：结果附 { snapshotDir, version }——menu2 干跑闸门失败时按 dir 自动回滚。
 */
function installStagedTarball(tgzPath, profile) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(String(profile || ''))) {
      return { ok: false, message: 'profile 非法: ' + profile };
    }
    if (!fs.existsSync(tgzPath)) return { ok: false, message: 'tgz 不存在: ' + tgzPath };
    // v3.3.2（供应链加固·安装前复验）：staging 旁挂 .sha256 存在即强制复验——防下载与
    // 安装窗口内文件被替换；旁挂缺失（旧 staging 遗留 / 未校验产物）不阻断，向后兼容。
    const sidecar = tgzPath + '.sha256';
    if (fs.existsSync(sidecar)) {
      let expected = '';
      try { expected = fs.readFileSync(sidecar, 'utf8').trim().toLowerCase(); } catch { /* 读不到按缺失处理 */ }
      if (/^[0-9a-f]{64}$/.test(expected)) {
        const actual = createHash('sha256').update(fs.readFileSync(tgzPath)).digest('hex');
        if (actual !== expected) {
          return { ok: false, message: 'staging tgz sha256 复验失败（actual=' + actual.slice(0, 16) + '…/expected=' + expected.slice(0, 16) + '…），文件可能在下载后被替换，已拒绝安装' };
        }
      }
    }
    const dshHome = process.env.DSH_HOME || path.join(String(process.env.HOME || process.env.USERPROFILE || ''), '.dsh');
    const runtimeDir = path.join(dshHome, 'profiles', profile, 'node_modules', 'dsh-prompt-enhancer');
    if (!fs.existsSync(runtimeDir)) {
      return { ok: false, message: '运行环境目录不存在: ' + runtimeDir };
    }
    // 解包到临时目录（Windows 自带 bsdtar 绝对路径——PATH 里 Git Bash GNU tar 会把
    // `-C C:\...` 解析成远程主机；bsdtar 认 Windows 路径）
    const tarBin = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-install-'));
    const r = spawnSync(tarBin, ['-xzf', String(tgzPath).replace(/\\/g, '/'), '-C', tmp], { windowsHide: true, timeout: 30000 });
    if (r.status !== 0) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: false, message: 'tgz 解包失败: ' + String(r.stderr || r.stdout || '').slice(0, 200) };
    }
    const pkgDir = path.join(tmp, 'package');
    if (!fs.existsSync(pkgDir)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: false, message: 'tgz 缺少顶层 package/ 目录（非 npm pack 产物）' };
    }
    // 校验 tgz 内包名与版本（防止装错包/目录污染）
    let newVer = '';
    let pkgName = '';
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
      newVer = typeof pj.version === 'string' ? pj.version : '';
      pkgName = typeof pj.name === 'string' ? pj.name : '';
    } catch { /* 解析失败不阻断 */ }
    if (pkgName !== '' && pkgName !== 'dsh-prompt-enhancer') {
      fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: false, message: 'tgz 包名不匹配: ' + pkgName };
    }
    // A6·三层干跑之语法层：解包产物零执行 `node --check`——拦「包内部损坏」。
    {
      const gateFiles = [];
      for (const f of ['plugin-host.js', 'plugin-client.js']) {
        const p = path.join(pkgDir, f);
        if (fs.existsSync(p)) gateFiles.push(p);
      }
      const newLib = path.join(pkgDir, 'lib');
      if (fs.existsSync(newLib)) {
        for (const f of fs.readdirSync(newLib)) {
          if (/\.cjs$/.test(f)) gateFiles.push(path.join(newLib, f));
        }
      }
      const gate = sys.syntaxCheckFiles(gateFiles);
      if (!gate.ok) {
        fs.rmSync(tmp, { recursive: true, force: true });
        const first = gate.failures[0] || {};
        return { ok: false, code: 'STAGED_SYNTAX_CHECK_FAILED', message: 'staging 语法检查未通过（' + path.basename(first.file || '') + '）：' + String(first.message || '').split('\n')[0] };
      }
    }
    // A5·安装即快照：覆盖运行环境前留回退锚点（尽力而为，失败不阻断安装）。
    let snapshotDir = null;
    {
      const snap = sys.rescueSnapshot({ profileName: profile, reason: 'staged-install pre v' + (newVer || '?') });
      if (!snap.ok) console.log('[enhance] rescue snapshot 失败（不阻断安装）: ' + snap.message);
      else {
        console.log('[enhance] rescue snapshot → ' + snap.dir + '（' + snap.files + ' files）');
        snapshotDir = snap.dir;
      }
    }
    // 文件级覆盖复制（不删目录——运行中的 host 正从该目录加载，删目录可能触发句柄/路径锁）
    fs.cpSync(pkgDir, runtimeDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    // v4.8（审查修正·file: 依赖地雷根治）：安装成功后 tgz 不再删除——搬迁到持久插件包缓存
    // （profiles/<profile>/plugins/dsh-prompt-enhancer-tgz/）。背景（2026-08-23 实测）：
    // profile package.json 的 file: 依赖指向 staging tgz，装完即删会让该依赖悬空；此后任何
    // pnpm 操作（如 dsh-market 更新触发 profile install）都会因解析失败把整包从 node_modules
    // 清掉——快捷方式三功能全灭 MODULE_NOT_FOUND。持久化副本同时是桌面快捷方式自愈分支的恢复源。
    try {
      const cacheDir = path.join(dshHomeDir(), 'profiles', profile || 'web', 'plugins', 'dsh-prompt-enhancer-tgz');
      fs.mkdirSync(cacheDir, { recursive: true });
      const persist = path.join(cacheDir, path.basename(tgzPath));
      fs.rmSync(persist, { force: true });
      fs.renameSync(tgzPath, persist);
      if (fs.existsSync(tgzPath + '.sha256')) {
        fs.rmSync(persist + '.sha256', { force: true });
        fs.renameSync(tgzPath + '.sha256', persist + '.sha256');
      }
    } catch (e) {
      // 搬迁失败回退旧行为（删除），不阻断安装完成
      try { fs.unlinkSync(tgzPath); } catch (e2) { /* ignore */ }
      try { fs.unlinkSync(tgzPath + '.sha256'); } catch (e2) { /* ignore */ }
    }
    return { ok: true, message: '已解包安装 v' + (newVer || '?') + ' → ' + runtimeDir, snapshotDir, version: newVer };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

module.exports = { findStagedTarball, installStagedTarball, peekTarballVersion };
