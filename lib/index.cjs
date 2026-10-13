'use strict';
/**
 * dsh-prompt-enhancer — host half bundle entry (v2.7.1).
 *
 * Bridges the dynamic-plugin body (plugin-host.js) into the static cordis
 * bundle: evaluates the body once, adapts its `harness` RPC surface
 * (harness.handle) to an HTTP endpoint the bundled client half calls, and
 * registers that endpoint on the profile's web server.
 *
 * P1-c（2026-10-13 执行器退役）：插件不再自建更新执行器，更新/安装交回官方 plugin
 * manager（`dsh plugin update`）。**P2-1（2026-10-13 清死簇）**：其残留死簇——原 :64-382
 * 「executor lifecycle」（executorCall / ensureExternalExecutor / spawnExecutor* /
 * buildExecutorTaskXml / cmdSafeValue 等 319 行）**整体删除**；旧注释里 updater-host /
 * 3081 端口 / update/executorEnsure 的残留描述一并清掉。
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

// ⚠ 载体约束（ADR-230 ③，未变）：BODY 经 new Function('harness', BODY) 求值，其作用域无 require
// —— 一切需要 fs/path/http/child_process 的系统面逻辑必须留在本模块（真 CommonJS），
// 不能写进 src/host/** chunk。本次清簇**未触碰载体**（载体三选一待用户拍板）。

// 2026-08-18（进程级重启降级）：原「写进程索引」逻辑随执行器退役（P1-c）已不存在；
// DSH_ENHANCER_NO_INDEX=1 的语义保留在历史注释与 lib/sys.cjs 侧（本模块不再写索引）。

const BODY = fs.readFileSync(path.join(__dirname, '..', 'plugin-host.js'), 'utf8');
const RPC_PATH = '/dsh-prompt-enhancer/rpc';

/** RPC handlers registered via harness.handle(method, fn). */
const handlers = new Map();

const pure = sys.extractPure(BODY);
const envForProbe = () => sys.mergedEnv(pure);


// ============================================================================
// v2.6.0 — harness facade
// ============================================================================

const harness = {
  handle(method, fn) {
    if (typeof method !== 'string' || typeof fn !== 'function') return;
    handlers.set(method, fn);
  },
  // envcheck 仍在 host 内（sys.cjs 共享实现；动态形态无此字段 → UNSUPPORTED）。
  // 批次C（P1-4）：sys.probeEnv 已全异步化——本 facade 直接返回 Promise；
  // P2-1 校验：两处消费方均已随执行器退役消失（plugin-host.js 内 0 处 harness.probeEnv 调用、
  // 执行器 apply 段已删）⇒ 本 facade 字段**暂留**（sys.probeEnv 自身仍被 test/sys.test.cjs 覆盖，
  // 属「零消费者导出面」欠账，登记待 P2-3 拆分批裁定，见报告 F-1）。
  probeEnv: (serviceName, executorPort) => sys.probeEnv(serviceName, pure, envForProbe(), executorPort),
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

/** Evaluate the body: a top-level-return plugin object. */
const plugin = new Function('harness', BODY)(harness);

/** RPC 请求体上限（1MiB）——原实现无上限，本机任意进程 POST 超大 body 可直接吃内存。 */
const RPC_BODY_LIMIT = 1024 * 1024;

/**
 * 2026-09-12（安全修复·审查 H1 实测驱动）：本 RPC 路由注册在 DSH web 鉴权栅栏**之外**——
 * 实测无 token 的 `POST /dsh-prompt-enhancer/rpc`（text/plain，不触发 CORS 预检）返回 200 真实数据，
 * 而 `GET /` 是 401：任意网页可借用户浏览器驱动 config/set、update/portRestart 等副作用。
 * 加来源栅栏：带 Origin 的浏览器请求必须与 Host 同源；Sec-Fetch-Site 为跨站即拒。
 * 无来源头的本机调用（node/curl/插件自身 client 走同源 fetch）不受影响。
 */
function isTrustedRpcRequest(request) {
  const headers = (request && request.headers) || {};
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = String(headers.origin || '');
  if (origin) {
    try {
      if (new URL(origin).host !== String(headers.host || '')) return false;
    } catch { return false; }
  }
  return true;
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    request.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > RPC_BODY_LIMIT) {
        aborted = true;
        chunks.length = 0;
        try { request.destroy(); } catch { /* ignore */ }
        resolve({ __tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (aborted) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(parsed);
      } catch {
        resolve({});
      }
    });
    request.on('error', () => resolve({}));
  });
}

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function registerRpcRoute(ctx) {
  const webServer = ctx.get('webServer');
  if (!webServer || typeof webServer.register !== 'function') return;
  webServer.register({
    kind: 'exact',
    path: RPC_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        writeJson(response, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      if (!isTrustedRpcRequest(request)) {
        writeJson(response, 403, { ok: false, code: 'FORBIDDEN_ORIGIN' });
        return;
      }
      const { method, args, __tooLarge } = await readBody(request);
      if (__tooLarge) {
        writeJson(response, 413, { ok: false, code: 'BODY_TOO_LARGE' });
        return;
      }
      const check = validateRpcArgs(method, args || {});
      if (!check.ok) {
        writeJson(response, 400, { ok: false, code: check.code, message: check.message });
        return;
      }
      const fn = handlers.get(method);
      if (!fn) {
        writeJson(response, 404, { ok: false, code: 'UNKNOWN_METHOD', method });
        return;
      }
      try {
        const result = await fn(args || {});
        writeJson(response, 200, result || { ok: true });
      } catch (error) {
        writeJson(response, 500, {
          ok: false,
          code: 'HANDLER_FAILED',
          message: String((error && error.message) || error),
        });
      }
    },
  });
}

// ============================================================================
// v3.2.4 — RPC: config/get · config/set（配置磁盘持久化）
// 修复 Issue #1：DSH Desktop 主进程每次启动动态分配端口（listen port 0），
// Chromium localStorage 按 Origin（协议://域名:端口）隔离 → 新 Origin 下配置「丢失」，
// client 误判 fresh 用默认链覆盖用户配置。磁盘配置跨端口共享（client 双写 + 启动同步）。
// 存储：$DSH_HOME/dsh-prompt-enhancer.config.json（原子写 tmp+rename，失败不阻断插件）
// ============================================================================
const CONFIG_FILE = (() => {
  try {
    const dshHome = process.env.DSH_HOME || String(process.env.HOME || process.env.USERPROFILE || '') + '/.dsh';
    fs.mkdirSync(dshHome, { recursive: true });
    return path.join(dshHome, 'dsh-prompt-enhancer.config.json');
  } catch (e) {
    return null;
  }
})();

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

// ============================================================================
// v3.2.5 — RPC: voice/status · voice/transcribe（语音识别模块）
// P1-a（2026-10-13 缩批）：**只保留这两条**。模型清单/下载/进度/切换/删目录/删模型
// 与运行时部署（voice/model*、voice/deploy* 共 8 条）**已退役** —— 这些能力由官方
// `speechToText` 与其 provider 包提供（官方已解决模型获取与准备），插件不再自建。
// voice/status  ：改读官方 `ctx.speechToText.snapshot()`（引擎就绪态）+ refine 就绪态
// voice/transcribe：data URL 音频 → 委托官方 `ctx.speechToText` → refine 规整 → {text,raw,refined}
// REFINE 失败降级 raw（不阻塞）；配置一律从磁盘读（voice 字段），apiKey 不进 RPC 请求。
harness.handle('voice/status', async () => {
  try {
    let cfg = null;
    if (CONFIG_FILE && fs.existsSync(CONFIG_FILE)) {
      try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { cfg = null; }
    }
    return await asr.status(cfg);
  } catch (e) {
    return { ok: false, code: 'VOICE_STATUS_FAILED', message: String((e && e.message) || e) };
  }
});

harness.handle('voice/transcribe', async (args) => {
  try {
    const v = validateRpcArgs('voice/transcribe', args);
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
    let cfg = null;
    if (CONFIG_FILE && fs.existsSync(CONFIG_FILE)) {
      try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { cfg = null; }
    }
    const engine = args && typeof args === 'object' ? args.engine : undefined;
    return await asr.transcribe(cfg, args.audioBase64, engine);
  } catch (e) {
    return { ok: false, code: 'VOICE_TRANSCRIBE_FAILED', message: String((e && e.message) || e) };
  }
});

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
  isTrustedRpcRequest,
  readBody,
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
