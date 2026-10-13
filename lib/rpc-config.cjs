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

const CONFIG_FILE = (() => {
  try {
    const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    fs.mkdirSync(dshHome, { recursive: true });
    return path.join(dshHome, 'dsh-prompt-enhancer.config.json');
  } catch (e) {
    return null;
  }
})();

/** 读磁盘配置；文件缺位/损坏/非对象一律返回 null（调用方各自兜底，不抛）。 */
function readConfig() {
  if (!CONFIG_FILE || !fs.existsSync(CONFIG_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
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
  harness.handle('config/get', async () => {
    try {
      if (!CONFIG_FILE || !fs.existsSync(CONFIG_FILE)) return { ok: true, config: null };
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ok: true, config: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null };
    } catch (e) {
      return { ok: false, code: 'CONFIG_READ_FAILED', message: String((e && e.message) || e) };
    }
  });

  harness.handle('config/set', async (args) => {
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
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const cur = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
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
