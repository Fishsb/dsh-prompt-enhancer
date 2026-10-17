'use strict';
// P2-3（2026-10-13 拆分批）：**harness facade 域** —— 原 `lib/index.cjs` D1 段整体移入。
//
// v2.6.0 — harness facade：`plugin-host.js`（BODY）经 `new Function('harness', BODY)` 求值时
// 拿到的那个 `harness` 对象。它把 BODY 的 `harness.handle` 收进 handlers Map，并补齐 BODY 在
// 动态安装形态下拿不到、只能由 CommonJS 侧提供的系统面字段。
//
// ⚠ 载体约束（ADR-230 ③，未变）：BODY 的作用域**无 require** ⇒ 一切需要 fs/path/http/
// child_process 的系统面逻辑必须留在真 CommonJS 侧（本模块），不能写进 `src/host/**` chunk。
// 本批拆分**未触碰载体**（`new Function` 桥接仍在 `lib/index.cjs`，三选一待用户拍板）。
//
// ⚠ 本文件是仓库提交物，不是构建产物。

const fs = require('node:fs');
const path = require('node:path');

/**
 * 构造 harness facade。
 *   opts.sys      : lib/sys.cjs（readPluginVersion / pluginRuntimeDir 等存活面）
 *   opts.handlers : 与 index.cjs 共用的注册表（`harness.handle` 写入、RPC 网关读取）
 *
 * P3-2b（2026-10-14）：**`BODY` 参数已退役** —— 它此前唯一用途是 `sys.extractPure(BODY)`
 *   取回 PURE 片段里的 `mergeEnvPath`。该函数现已是 `lib/sys.cjs` 的**原生实现**，
 *   整条 `extractPure` 求值路径随之删除 ⇒ 本工厂不再需要 `plugin-host.js` 文本。
 *   ⚠ **装配桥接零改动**：`lib/index.cjs` 仍 `读取 BODY` + `new Function('harness', BODY)` 求值。
 *
 * P3-2c（2026-10-14 · probeEnv 链退役）：**`probeEnv` 字段已退役** ——
 *   其唯一可能的调用方（`plugin-host.js` 内的 `harness.probeEnv`）计数为 **0**，
 *   且 `sys.probeEnv` / `sys.mergedEnv` 已随本批一并退役 ⇒ 本 facade 不再暴露该字段。
 *   ⚠ 其余三字段（`handle` / `readPluginVersion` / `pluginRuntimeDir`）**一字未动**。
 */
function createHarness({ sys, handlers }) {
  return {
    handle(method, fn) {
      if (typeof method !== 'string' || typeof fn !== 'function') return;
      handlers.set(method, fn);
    },
    // ⚠ P3-2c（2026-10-14）：原 `probeEnv` 字段在此退役（详见函数头注）。
    //   其承载的 envcheck RPC 面已随 P1-c 执行器退役（`plugin-host.js` 内 `envcheck` 零命中）。
    // v3.2.1-r（根因修复·版本检测失真）：PLUGIN_VERSION 构建硬编码与 package.json 脱节
    // （发版后未重建产物 → 永远报旧版）。运行时读取运行环境 package.json 作为本地版本
    // 单一事实源；读取失败回退 PLUGIN_VERSION（BODY 内常量）。
    readPluginVersion: () => {
      try {
        // v4.9：容错 UTF-8 BOM（2026-08-23 事故——BOM 使 JSON.parse 抛异常→版本回退构建常量）
        const pj = path.join(__dirname, '..', 'package.json');
        const rawPj = fs.readFileSync(pj, 'utf8').replace(/^\uFEFF/, '');
        const ver = JSON.parse(rawPj).version;
        return typeof ver === 'string' && ver !== '' ? ver : '';
      } catch (e) { return ''; }
    },
    // v3.2.1-r（幽灵目录修正）：一键更新走 tgz 安装后，update/check 的 defaultDir
    // （会话工作区/dsh-prompt-enhancer-<tag>/，v2.4.1 逐文件写入遗留）已无实际意义且误导——
    // 返回真实运行环境目录（实际安装目标）。
    pluginRuntimeDir: () => path.join(__dirname, '..'),
    // 纠错服务端守卫批（2026-10-17 · 第 ① 件）：**读已归一化的 voice 配置**的系统面。
    // 为什么必须由 lib 侧提供（而不是 chunk 内自己读）：
    //   ① 载体约束（ADR-230 ③）：BODY 经 `new Function('harness', BODY)` 求值，作用域**无 require/fs**
    //      ⇒ chunk 内物理上读不到磁盘；
    //   ② **单一事实源**（`M-3`）：磁盘读取用 `lib/rpc-config.cjs:readConfig()`、
    //      归一化用 `lib/asr.cjs:readNormalizedVoiceCfg()`（= `sanitizeVoiceCfg(voiceCfgOf(cfg))`，
    //      与 `asr.status()` **同一条路径**）—— 本字段**只是接线**，⛔ 不重写任何解析/取形逻辑。
    // ⚠ 为什么这里 require 而不是由 index 注入：`D-1` 是**正本行数读数锁**（`lib/index.cjs` = 114 行），
    //   而装配面必须落在一个**不被读数锁钉住**的位置；`lib/asr.cjs`/`lib/rpc-config.cjs` 都是同目录
    //   的普通模块（无环：两者都不 require 本文件，实测）。
    // ⚠ fail-closed：任一环节缺位/抛错 ⇒ 返回 `null`（调用方按"关"处理，且**必须可见**）。
    readVoiceConfig: () => {
      try {
        const raw = require('./rpc-config.cjs').readConfig();
        if (!raw || typeof raw !== 'object') return null;
        // ⚠ 必须下钻（`voiceCfgOf` 语义）——磁盘的 voice 段在 `cfg.voice` 之下；
        //   直接 `sanitizeVoiceCfg(raw)` 会只认顶层键 ⇒ `correction` 被静默归一成 false
        //   （本批实测踩到：开关打开也被判成关 ⇒ 功能被永久关死 = 拆东墙）。
        const out = require('./asr.cjs').readNormalizedVoiceCfg(raw);
        return out && typeof out === 'object' ? out : null;
      } catch (e) { return null; }
    },
  };
}

module.exports = { createHarness };
