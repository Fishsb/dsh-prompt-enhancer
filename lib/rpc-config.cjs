'use strict';
// P2-3（2026-10-13 拆分批）：**配置持久化域** —— 原 `lib/index.cjs` D3 段整体移入。
//
// v3.2.4 — RPC: config/get · config/set（配置磁盘持久化）
// 修复 Issue #1：DSH Desktop 主进程每次启动动态分配端口（listen port 0），
// Chromium localStorage 按 Origin（协议://域名:端口）隔离 → 新 Origin 下配置「丢失」，
// client 误判 fresh 用默认链覆盖用户配置。磁盘配置跨端口共享（client 双写 + 启动同步）。
// 存储：$DSH_HOME/dsh-prompt-enhancer.config.json（原子写 tmp+rename，失败不阻断插件）
//
// ⚠ 对外接口（供 RPC 网关与 voice 域共用）：CONFIG_FILE · readConfig() · register(harness)
// ⚠ 本文件是仓库提交物，不是构建产物。

const fs = require('node:fs');
const path = require('node:path');
const { RPC_METHODS } = require('./contracts.cjs');

// 改名过渡（2026-11-05，dsh-voice-prompt-enhancer）：磁盘文件名与包名对齐。
// 本版：新名写入 + 首次使用时自动迁移旧文件（旧文件保留为 .migrated 备份，下一版再整体退役）。
// 读取顺序：新名 → 旧名（旧名仅为迁移前的兜底，下一版可删）。
const CONFIG_BASENAMES = ['dsh-voice-prompt-enhancer.config.json', 'dsh-prompt-enhancer.config.json'];

const CONFIG_DIR = (() => {
  try {
    const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    fs.mkdirSync(dshHome, { recursive: true });
    return dshHome;
  } catch (e) {
    return null;
  }
})();

/** 写入目标：新名。 */
const CONFIG_FILE = CONFIG_DIR === null ? null : path.join(CONFIG_DIR, CONFIG_BASENAMES[0]);

/** 读取目标：新名优先，旧名回退（迁移完成前）。 */
const CONFIG_READ_CANDIDATES = CONFIG_DIR === null ? [] : CONFIG_BASENAMES.map((b) => path.join(CONFIG_DIR, b));

const LEGACY_CONFIG_FILE = CONFIG_DIR === null ? null : path.join(CONFIG_DIR, CONFIG_BASENAMES[1]);

/**
 * 旧名配置迁移到新名（幂等，仅在新名不存在且旧名存在时执行）。
 * 复制而非移动：旧文件改名保留为 .migrated 备份，回滚到上一发布版时仍能读到原配置。
 */
function migrateLegacyConfig() {
  if (CONFIG_FILE === null || LEGACY_CONFIG_FILE === null) return;
  try {
    if (fs.existsSync(CONFIG_FILE)) return;
    if (!fs.existsSync(LEGACY_CONFIG_FILE)) return;
    fs.copyFileSync(LEGACY_CONFIG_FILE, CONFIG_FILE);
    try {
      fs.renameSync(LEGACY_CONFIG_FILE, LEGACY_CONFIG_FILE + '.migrated');
    } catch (e) { /* 改名失败不阻断：旧文件仍在，读取回退照常工作 */ }
  } catch (e) { /* 迁移失败不阻断插件：readConfig 仍会回退读旧名 */ }
}

/** 实际存在的配置路径（新名优先）；都不存在返回 null。 */
function resolveConfigPath() {
  for (const candidate of CONFIG_READ_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** 读磁盘配置；文件缺位/损坏/非对象一律返回 null（调用方各自兜底，不抛）。 */
function readConfig() {
  migrateLegacyConfig();
  const file = resolveConfigPath();
  if (file === null) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * 注册本域 RPC。handlers 经**显式注入**（不共享全局可变状态，P-M3）。
 * ⚠ 「顶层键级 merge」语义仍在此处原文保留（多写入方防互相清空，见下）。
 */
function register(harness) {
  harness.handle(RPC_METHODS.CONFIG_GET, async () => {
    try {
      migrateLegacyConfig();
      const readPath = resolveConfigPath();
      if (readPath === null) return { ok: true, config: null };
      const parsed = JSON.parse(fs.readFileSync(readPath, 'utf8'));
      return { ok: true, config: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null };
    } catch (e) {
      return { ok: false, code: 'CONFIG_READ_FAILED', message: String((e && e.message) || e) };
    }
  });

  harness.handle(RPC_METHODS.CONFIG_SET, async (args) => {
    try {
      const patch = args && typeof args === 'object' ? args.config : null;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return { ok: false, code: 'BAD_ARGS', message: 'config must be an object' };
      }
      if (!CONFIG_FILE) return { ok: false, code: 'NO_DSH_HOME', message: 'cannot resolve DSH_HOME' };
      // v3.2.5（语音模块·多写入方）：config/set 升级为「顶层键级 merge」——enhancer 与 voice
      // 两个模块各写各的顶层键（configState / voice），整体替换会让后写方清空先写方配置。
      // 向后兼容：v3.2.4 唯一写入方（enhancer）传完整 configState → merge 结果与替换等价。
      let merged = {};
      migrateLegacyConfig();
      const mergeSource = resolveConfigPath();
      if (mergeSource !== null) {
        try {
          const cur = JSON.parse(fs.readFileSync(mergeSource, 'utf8'));
          if (cur && typeof cur === 'object' && !Array.isArray(cur)) merged = cur;
        } catch (e) { /* 损坏文件按空处理（覆盖恢复），不阻断写入 */ }
      }
      for (const k of Object.keys(patch)) merged[k] = patch[k];
      const size = Buffer.byteLength(JSON.stringify(merged), 'utf8');
      if (size > 1024 * 1024) return { ok: false, code: 'CONFIG_TOO_LARGE', message: 'config exceeds 1MB' };
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      const tmp = CONFIG_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(merged), 'utf8');
      fs.renameSync(tmp, CONFIG_FILE);
      return { ok: true };
    } catch (e) {
      return { ok: false, code: 'CONFIG_WRITE_FAILED', message: String((e && e.message) || e) };
    }
  });
}

// ⚠ `CONFIG_FILE` 是**模块内私有**常量（readConfig / register 用；外部只用 `readConfig`）⇒ **不进导出面**：
//   R5 判「导出面无消费者 = 死码」，导出它会制造假死码项（P2-3 首跑实测命中）。
module.exports = { readConfig, register };
