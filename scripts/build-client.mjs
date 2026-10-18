// Build lib/client.cjs from src/client/**: inlines the dynamic client
// body into the static __ModuleLoader__ bundle. Run: node scripts/build-client.mjs
//
// v3.2.1-t（架构调整·漂移检测）：--check 模式重建到内存，与磁盘产物（lib/client.cjs）
// 对比——漂移即报错退出 1。供 sync-runtime / release / pre-commit 使用。
// P1a（2026-09-19）：root plugin-client.js 为孤儿产物，已退役并从本脚本产出面移除。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function buildClient() {
  // The bundle skeleton (header comments + all injection markers) lives in
  // src/client/skeleton.js; every chunk is injected below.
  let body = require('../src/client/skeleton.js');

  // Normalize line endings BEFORE marker matching: source files may carry CRLF
  // (e.g. after a git checkout with core.autocrlf), which would break the
  // LF-based marker lookups. Chunks are normalized again at the end so the
  // committed artifacts stay byte-stable (LF).
  body = body.replace(/\r\n/g, '\n');
  const i18nChunk = require('../src/client/i18n.js');
  const constantsChunk = require('../src/client/constants.js');
  const stateChunk = require('../src/client/state.js');
  const helpersChunk = require('../src/client/helpers.js');
  const modelHelpersChunk = require('../src/client/model-helpers.js');
  const enhanceButtonChunk = require('../src/client/components/enhance-button.js');
  // CHG-184（纠错状态可视化批）：输入框旁的五态指示 chunk（与 ✨ 按钮同槽位、同族样式）
  const enhanceBarChunk = require('../src/client/components/enhance-bar.js');
  const marqueeSelectChunk = require('../src/client/components/marquee-select.js');
  const collapsibleSectionChunk = require('../src/client/components/collapsible-section.js');
  const modelMainSectionChunk = require('../src/client/components/model-main-section.js');
  const fallbackRowChunk = require('../src/client/components/fallback-row.js');
  const modelConfigTabChunk = require('../src/client/components/model-config-tab.js');
  const paramsTabChunk = require('../src/client/components/params-tab.js');
  const modelPluginsSectionChunk = require('../src/client/components/model-plugins-section.js');
  const stylesChunk = require('../src/client/styles.js');
  const appChunk = require('../src/client/app.js');
  // P1-a（2026-10-13 缩批）：RecordRTC vendor chunk 已退役（采集改浏览器原生 MediaRecorder）；
  // mic-button / voice-insert 已退役（按钮 UI 交官方；热键与填入逻辑搬入 hotkey.js）。
  // CHG-117（2026-10-16 · 规整改造批）：清口水词 —— 本地纯规则清理器（不调模型）
  // CHG-143（纠错语音独立步批）：语音纠错的可见性状态 chunk（照 filler.js 既有模式）
  const voiceCorrectionChunk = require('../src/client/voice/correction.js');
  const voiceFillerChunk = require('../src/client/voice/filler.js');
  const voiceStateChunk = require('../src/client/voice/state.js');
  const voiceRecorderChunk = require('../src/client/voice/recorder.js');
  // P2-补做（2026-10-13 · CHG-011 / §4.6.2.6 · UD-0014 选 B）：官方录音路径增值桥
  // （包装标准 API 只观测；静音监测 + 自动增强挂到官方路径 ⇒ 两条入口能力一致）
  const voiceOfficialBridgeChunk = require('../src/client/voice/official-bridge.js');
  const voiceHotkeyChunk = require('../src/client/voice/hotkey.js');
  const voiceSectionChunk = require('../src/client/voice/voice-section.js');
  // Inject all chunks, looping until no marker remains: component chunks may
  // themselves contain other injection markers (e.g. the updater constants
  // lived between EnhanceBar and UpdaterCard), so a single pass would leave
  // nested markers unexpanded.
  const injections = [
    ['// @dsh-client-i18n-inject', i18nChunk],
    ['// @dsh-client-constants-inject', constantsChunk],
    ['// @dsh-client-state-inject', stateChunk],
    ['// @dsh-client-helpers-inject', helpersChunk],
    ['// @dsh-client-model-helpers-inject', modelHelpersChunk],
    ['// @dsh-client-comp-enhance-button-inject\n', enhanceButtonChunk],
    ['// @dsh-client-comp-enhance-bar-inject\n', enhanceBarChunk],
    ['// @dsh-client-comp-marquee-select-inject\n', marqueeSelectChunk],
    ['// @dsh-client-comp-collapsible-section-inject\n', collapsibleSectionChunk],
    ['// @dsh-client-comp-model-main-section-inject\n', modelMainSectionChunk],
    ['// @dsh-client-comp-fallback-row-inject\n', fallbackRowChunk],
    ['// @dsh-client-comp-model-config-tab-inject\n', modelConfigTabChunk],
    ['// @dsh-client-comp-params-tab-inject\n', paramsTabChunk],
    ['// @dsh-client-comp-model-plugins-section-inject\n', modelPluginsSectionChunk],
    ['// @dsh-client-voice-correction-inject\n', voiceCorrectionChunk],
    ['// @dsh-client-voice-filler-inject\n', voiceFillerChunk],
    ['// @dsh-client-voice-state-inject\n', voiceStateChunk],
    ['// @dsh-client-voice-recorder-inject\n', voiceRecorderChunk],
    ['// @dsh-client-voice-official-bridge-inject\n', voiceOfficialBridgeChunk],
    ['// @dsh-client-voice-hotkey-inject\n', voiceHotkeyChunk],
    ['// @dsh-client-voice-comp-section-inject\n', voiceSectionChunk],
    ['// @dsh-client-styles-inject\n', stylesChunk],
    ['// @dsh-client-app-inject\n', appChunk],
  ];
  // ── chunk 契约门（2026-10-17 事故根治）────────────────────────────────
  // 每个 chunk 必须是**字符串**（`module.exports = "<源码文本>"`）。
  // 病历：src/client/voice/correction.js 曾以裸 JS 提交（`var ...; function ...` 且无
  //   module.exports 包裹）⇒ require 返回**空对象** ⇒ `body.replace(marker, chunk)`
  //   把对象字符串化成 "[object Object]" 注入产物 ⇒ 浏览器 new Function 求值抛
  //   `Unexpected identifier 'Object'` ⇒ 整个 client 半部装载失败（web boot 报
  //   「1 entry did not activate / import failed」）。
  // 本门在**构建期**即拒绝，并给出违规 chunk 的 marker 与实得类型（不是等浏览器报错）。
  const badChunks = injections.filter(([, c]) => typeof c !== 'string');
  if (badChunks.length) {
    console.error('[build-client] chunk 契约违反 —— 以下 chunk 未导出字符串：');
    for (const [marker, c] of badChunks) console.error('  · ' + marker.trim() + '  → 实得 ' + (typeof c));
    console.error('  修复：把 chunk 源码包成 module.exports = "<JSON 转义后的源码>";');
    throw new Error('chunk 契约门未通过（' + badChunks.length + ' 个）');
  }

  let previous;
  do {
    previous = body;
    for (const [marker, chunk] of injections) {
      if (body.includes(marker)) {
        body = body.replace(marker, chunk);
      }
    }
  } while (body !== previous);

  // Final line-ending normalization: chunk files may carry CRLF.
  body = body.replace(/\r\n/g, '\n');

  // Embed the body as a JSON string literal: safe against backticks, ${}, and
  // every other JS metacharacter inside the plugin code.
  const embedded = JSON.stringify(body);

  const template = `// GENERATED by scripts/build-client.mjs — do not edit by hand.
// Rebuild after changing src/client/**: node scripts/build-client.mjs
window.__ModuleLoader__.load({
  id: "dsh-prompt-enhancer",
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
    'use strict';

    const React = require('react');

    // RPC bridge to the host half's harness.handle handlers
    // (registered on /dsh-prompt-enhancer/rpc by lib/index.cjs).
    const host = {
      call(method, args) {
        return fetch('/dsh-prompt-enhancer/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, args: args || {} }),
        }).then((response) => response.json());
      },
    };

    // v2.6.0: bridge to the standalone update executor (lib/updater-host.cjs)
    // on its own port — survives dsh-web restarts; CORS allowed by the executor.
    const executor = {
      call(method, args, port) {
        return fetch('http://127.0.0.1:' + port + '/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, args: args || {} }),
        }).then((response) => response.json());
      },
    };

    // styles facade: inject CSS into a dedicated <style> tag.
    const styles = {
      insert(css) {
        if (document.querySelector('style[data-plugin-css="dsh-prompt-enhancer"]') !== null) return;
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-prompt-enhancer';
        tag.dataset.pluginCss = 'dsh-prompt-enhancer';
        tag.textContent = css;
        document.head.appendChild(tag);
      },
    };

    // Evaluate the dynamic client body (a top-level-return plugin object)
    // with the static environment's symbols closed over.
    const plugin = new Function('React', 'host', 'styles', 'executor', ${embedded})(React, host, styles, executor);

    module.exports = { ...plugin, inject: ['slots', 'locale', 'timer'] };
    return module.exports;
  },
});
`;

  // P1a（2026-09-19·圆桌决策 A）：root plugin-client.js 已退役——它「生成 + 进发布物 + 从不被装载」
  // （DSH 只认 package.json exports["./client"] → lib/client.cjs），且其正文已被本 template
  // 逐字内嵌（实测 318,792 字符在位），删除零代码丢失。唯一 client 载体 = lib/client.cjs。
  return { template };
}

const { template } = buildClient();
const args = process.argv.slice(2);

if (args.includes('--check')) {
  // v3.2.1-t（漂移检测）：产物与源码重建结果不一致即报错退出 1。
  // P1a：唯一 client 产物 = lib/client.cjs（孤儿 plugin-client.js 已退役，不再检）。
  let clientOk = true;
  try { clientOk = readFileSync(join(root, 'lib', 'client.cjs'), 'utf8') === template; } catch { clientOk = false; }
  if (clientOk) {
    console.log('lib/client.cjs OK（源码 ↔ 产物一致）');
    process.exit(0);
  }
  console.error('[build-client --check] 漂移检测失败：client 产物与源码重建结果不一致！');
  console.error('  修复：node scripts/build-client.mjs（重建产物），或还原被手改的产物。');
  process.exit(1);
}

mkdirSync(join(root, 'lib'), { recursive: true });
writeFileSync(join(root, 'lib', 'client.cjs'), template, 'utf8');
// ⚠ 口径订正（③ · 2026-10-16 门禁缺口批，与 build-host.mjs 同源）：`template.length` 是字符串长度
//   （UTF-16 码元数），不是字节数；本产物亦含 CJK（实测 252904 字符 vs 319470 字节）。
console.log('lib/client.cjs written (' + template.length + ' chars / ' + Buffer.byteLength(template, 'utf8') + ' bytes)');
