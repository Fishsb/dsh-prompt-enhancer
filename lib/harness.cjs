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
 *   opts.sys      : lib/sys.cjs（probeEnv / mergedEnv）
 *   opts.handlers : 与 index.cjs 共用的注册表（`harness.handle` 写入、RPC 网关读取）
 *
 * P3-2b（2026-10-14）：**`BODY` 参数已退役** —— 它此前唯一用途是 `sys.extractPure(BODY)`
 *   取回 PURE 片段里的 `mergeEnvPath`。该函数现已是 `lib/sys.cjs` 的**原生实现**，
 *   整条 `extractPure` 求值路径随之删除 ⇒ 本工厂不再需要 `plugin-host.js` 文本。
 *   ⚠ **装配桥接零改动**：`lib/index.cjs` 仍 `读取 BODY` + `new Function('harness', BODY)` 求值。
 */
function createHarness({ sys, handlers }) {
  return {
    handle(method, fn) {
      if (typeof method !== 'string' || typeof fn !== 'function') return;
      handlers.set(method, fn);
    },
    // envcheck 仍在 host 内（sys.cjs 共享实现；动态形态无此字段 → UNSUPPORTED）。
    // 批次C（P1-4）：sys.probeEnv 已全异步化——本 facade 直接返回 Promise；
    // P2-1 校验：两处消费方均已随执行器退役消失（plugin-host.js 内 0 处 harness.probeEnv 调用、
    // 执行器 apply 段已删）⇒ 本 facade 字段**暂留**（sys.probeEnv 自身仍被 test/sys.test.cjs 覆盖，
    // 属「零消费者导出面」欠账，登记待 P2-3 拆分批裁定，见报告 F-1）。
    probeEnv: (serviceName, executorPort) => sys.probeEnv(serviceName, sys.mergedEnv(), executorPort),
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
  };
}

module.exports = { createHarness };
