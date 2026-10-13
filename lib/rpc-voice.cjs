'use strict';
// P2-3（2026-10-13 拆分批）：**语音 RPC 域** —— 原 `lib/index.cjs` D4 段整体移入。
//
// v3.2.5 — RPC: voice/status · voice/transcribe（语音识别模块）
// P1-a（2026-10-13 缩批）：**只保留这两条**。模型清单/下载/进度/切换/删目录/删模型
// 与运行时部署（voice/model*、voice/deploy* 共 8 条）**已退役** —— 这些能力由官方
// `speechToText` 与其 provider 包提供（官方已解决模型获取与准备），插件不再自建。
// voice/status  ：改读官方 `ctx.speechToText.snapshot()`（引擎就绪态）+ refine 就绪态
// voice/transcribe：data URL 音频 → 委托官方 `ctx.speechToText` → refine 规整 → {text,raw,refined}
// REFINE 失败降级 raw（不阻塞）；配置一律从磁盘读（voice 字段），apiKey 不进 RPC 请求。
//
// ⚠ 依赖显式注入（不 require index.cjs，避免环）：deps = { readConfig, validateRpcArgs, asr }
// ⚠ 本文件是仓库提交物，不是构建产物。

/** 注册本域 RPC。 */
function register(harness, deps) {
  const { readConfig, validateRpcArgs, asr } = deps;

  harness.handle('voice/status', async () => {
    try {
      return await asr.status(readConfig());
    } catch (e) {
      return { ok: false, code: 'VOICE_STATUS_FAILED', message: String((e && e.message) || e) };
    }
  });

  harness.handle('voice/transcribe', async (args) => {
    try {
      const v = validateRpcArgs('voice/transcribe', args);
      if (!v.ok) return { ok: false, code: v.code, message: v.message };
      const engine = args && typeof args === 'object' ? args.engine : undefined;
      return await asr.transcribe(readConfig(), args.audioBase64, engine);
    } catch (e) {
      return { ok: false, code: 'VOICE_TRANSCRIBE_FAILED', message: String((e && e.message) || e) };
    }
  });
}

module.exports = { register };
