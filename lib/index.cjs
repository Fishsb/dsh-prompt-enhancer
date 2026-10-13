'use strict';
/**
 * dsh-prompt-enhancer — host half bundle entry（**薄装配入口**；P2-3 拆分批 2026-10-13）。
 *
 * Bridges the dynamic-plugin body (plugin-host.js) into the static cordis
 * bundle: evaluates the body once, adapts its `harness` RPC surface
 * (harness.handle) to an HTTP endpoint the bundled client half calls, and
 * registers that endpoint on the profile's web server.
 *
 * P2-3（2026-10-13 拆分批）：本文件由 **319 行**收敛为**薄装配入口**——按域拆出的实现见：
 *   · `lib/harness.cjs`     D1 harness facade（BODY 求值入参）
 *   · `lib/rpc-http.cjs`    D2 RPC 网关与 HTTP 栅栏（来源校验 / 1MiB 上限 / 路由注册）
 *   · `lib/rpc-config.cjs`  D3 配置持久化（config/get · config/set）
 *   · `lib/rpc-voice.cjs`   D4 语音 RPC（voice/status · voice/transcribe）
 * 新增文件是**仓库提交物**（不得由任何 build 脚本生成；`scripts/sync-runtime.mjs` 的 md5
 * 清单经 `lib/*.cjs` 动态枚举自动纳入）。
 *
 * P1-c（2026-10-13 执行器退役）：插件不再自建更新执行器，更新/安装交回官方 plugin
 * manager（`dsh plugin update`）。**P2-1（2026-10-13 清死簇）**：其残留死簇——原「executor
 * lifecycle」整段（executorCall / ensureExternalExecutor / spawnExecutor* /
 * buildExecutorTaskXml / cmdSafeValue 等 319 行）**整体删除**。
 *
 * The dynamic install (cordis_define) keeps working: there the harness is the
 * official one (probeEnv 缺位 → envcheck UNSUPPORTED)。
 */
const fs = require('node:fs');
const path = require('node:path');
const sys = require('./sys.cjs');
const { validateRpcArgs } = require('./rpc-schema.cjs');
// v3.2.5（语音识别模块）：ASR host 侧——refine 规整 + sanitize + 出网（通道 C）
// P1-a（2026-10-13 缩批）：云端双协议与本地 worker 引擎（asr-worker/asr-models/asr-deploy）已退役，
// 识别改由官方 `ctx.speechToText` 承担（见 apply() 的 setSpeechToText 注入）。
const asr = require('./asr.cjs');
const { createHarness } = require('./harness.cjs');
const rpcHttp = require('./rpc-http.cjs');
const rpcConfig = require('./rpc-config.cjs');
const rpcVoice = require('./rpc-voice.cjs');

// ⚠ 载体约束（ADR-230 ③，未变）：BODY 经 new Function('harness', BODY) 求值，其作用域无 require
// —— 一切需要 fs/path/http/child_process 的系统面逻辑必须留在 lib/ 侧的真 CommonJS 模块
// （harness.cjs / rpc-http.cjs / rpc-config.cjs / rpc-voice.cjs），不能写进 src/host/** chunk。
// 本次拆分批**未触碰载体**（载体三选一待用户拍板）。

const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');
const RPC_PATH = '/dsh-prompt-enhancer/rpc';

/** RPC handlers registered via harness.handle(method, fn). */
const handlers = new Map();

// ---- D1：harness facade（BODY 求值入参；见 lib/harness.cjs）----
const harness = createHarness({ BODY, sys, handlers });

// ---- BODY 求值：一个 top-level-return 的插件对象 ----
const plugin = new Function('harness', BODY)(harness);

// ---- D2：RPC 域名注册（网关与 HTTP 栅栏；见 lib/rpc-http.cjs）----
// ⚠ 对外签名保持**单参** `registerRpcRoute(ctx)`（既有单测 RPCG-05 直接单参调用）；
// 实现侧改为显式注入依赖（避免模块间共享全局可变状态）。
const registerRpcRoute = (ctx) => rpcHttp.registerRpcRoute(ctx, { RPC_PATH, handlers, validateRpcArgs });

// ---- D3 / D4：域 RPC 注册（各自的路由表见对应模块）----
rpcConfig.register(harness);
rpcVoice.register(harness, { readConfig: rpcConfig.readConfig, validateRpcArgs, asr });

// ============================================================================
// P1-c（2026-10-13 执行器退役 · Q3 已拍板：交回官方 plugin manager）
// ============================================================================
// 本段原为 4 条原生更新 RPC（update/restartNeeded · update/executorEnsure ·
// update/install · update/diagTail）+ 其专属机制（执行器拉起 D1 全域：executorCall /
// ensureExternalExecutor / spawnExecutor* / buildExecutorTaskXml / stage-install 接线）。
// **整体退役**——插件不再自建更新执行器、不再安装 staged 包、不再自行判定「需重启」。
// 更新/安装改由官方 DSH plugin manager 承担（`dsh plugin update` 等）。
// ⚠ 保留面（非更新用途，仍在用，不得删）：config/* · voice/status·voice/transcribe ·
//   HTTP 栅栏（isTrustedRpcRequest / readBody / registerRpcRoute）· 版本与运行目录读取
//   （readPluginVersion / pluginRuntimeDir）· harness.probeEnv facade。
// ⚠ P2-1 已删：cmdSafeValue / xmlEscape / currentUserSid / buildExecutorTaskXml / spawnExecutor*
//   / executorCall / readLatestExecutorVersion / resolveExecutorLogPath / sleep / CRLF —— 其唯一
//   调用点（执行器 .cmd / schtasks 任务生成）随 P1-c 退役，**对象消失** ⇒ 判据 A146-3 / RPCG-02 一并退役。

module.exports = {
  name: 'dsh-prompt-enhancer',  ...plugin,
  // P1-c（2026-10-13）：`installStagedTarball` / `findStagedTarball` 两个 staging 安装导出面
  //   随执行器退役一并移除（`lib/stage-install.cjs` 已删，更新/安装交回官方 plugin manager）。
  // 2026-09-12（安全修复 H1·单测锚定）：RPC 来源栅栏 / 请求体读取——内部导出供单测复用同一实现
  isTrustedRpcRequest: rpcHttp.isTrustedRpcRequest,
  readBody: rpcHttp.readBody,
  registerRpcRoute,
  apply(ctx) {
    // webServer is provided asynchronously after the profile composes the
    // web app — inject, don't get (same pattern as dsh-market).
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (hostCtx) => {
        hostCtx.effect(() => registerRpcRoute(hostCtx), 'dsh-prompt-enhancer: rpc route');
      });
    } else {
      registerRpcRoute(ctx);
    }
    // v3.2.8（用户需求·规整同增强设置方式）：注入基座 llm 服务到 asr.cjs——
    // refine chain 模式用规整区自选的基座模型（provider/model 由基座解析，免填 key，含本地模型）
    if (typeof ctx.get === 'function' && ctx.get('llm')) asr.setLlm(ctx.get('llm'));
    // P1-a（2026-10-13 缩批）：本地 worker 自启已退役（引擎宿主 asr-worker/asr-models/asr-deploy 三件已删）。
    // 识别改由官方 `ctx.speechToText`（dsh-experimental-speech-to-text）承担 —— 官方服务若就绪即注入；
    // 未就绪时不 park 插件（本处是普通 require 模块的服务取用，非 cordis 插件面 inject），
    // 由 voice/status·voice/transcribe 返回明确 code（SPEECH_SERVICE_UNAVAILABLE / ASR_LOCAL_WORKER_DOWN）。
    if (typeof ctx.get === 'function' && ctx.get('speechToText')) asr.setSpeechToText(ctx.get('speechToText'));
    return plugin.apply.call(this, ctx);
  },
};
