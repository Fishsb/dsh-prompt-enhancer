'use strict';
// P2-3（2026-10-13 拆分批）：**语音 RPC 域** —— 原 `lib/index.cjs` D4 段整体移入。
//
// v3.2.5 — RPC: voice/status（语音识别模块）
// P1-a（2026-10-13 缩批）：**只保留 voice/status**。模型清单/下载/进度/切换/删目录/删模型
// 与运行时部署（voice/model*、voice/deploy* 共 8 条）**已退役** —— 这些能力由官方
// `speechToText` 与其 provider 包提供（官方已解决模型获取与准备），插件不再自建。
// CHG-117（2026-10-16 · 规整改造批）：`voice/transcribe` **一并删除** ——
//   该 RPC 自「自建采集链退役」（`2ab8cf7`）后**已无任何调用方**（`CHG-115` `I-1` 定位），
//   且其内部调官方 `transcribe()` 时漏传 `AbortSignal` 必然失败（`I-3`）⇒ 整链死代码。
//   规整改由 **client 半部本地纯规则** 承担（`src/client/voice/filler.js`，不走 RPC）。
// voice/status：读官方 `ctx.speechToText.snapshot()`（引擎就绪态）+ filler 就绪态
//
// ⚠ 依赖显式注入（不 require index.cjs，避免环）：deps = { readConfig, asr }
// ⚠ 本文件是仓库提交物，不是构建产物。

/** 注册本域 RPC。 */
function register(harness, deps) {
  const { readConfig, asr } = deps;   // CHG-117：删 voice/transcribe 后 validateRpcArgs 不再需要

  harness.handle('voice/status', async () => {
    try {
      return await asr.status(readConfig());
    } catch (e) {
      return { ok: false, code: 'VOICE_STATUS_FAILED', message: String((e && e.message) || e) };
    }
  });
}

module.exports = { register };
