// Build lib/client.cjs from plugin-client.js: inlines the dynamic client
// body into the static __ModuleLoader__ bundle. Run: node scripts/build-client.mjs
//
// v3.2.1-t（架构调整·漂移检测）：--check 模式重建到内存，与磁盘产物（lib/client.cjs
// + plugin-client.js）对比——漂移即报错退出 1。供 sync-runtime / release / pre-commit 使用。
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
  const updaterChunk = require('../src/client/updater.js');
  const stateChunk = require('../src/client/state.js');
  const helpersChunk = require('../src/client/helpers.js');
  const modelHelpersChunk = require('../src/client/model-helpers.js');
  const enhanceButtonChunk = require('../src/client/components/enhance-button.js');
  const enhanceBarChunk = require('../src/client/components/enhance-bar.js');
  const updaterCardChunk = require('../src/client/components/updater-card.js');
  const pluginsSectionChunk = require('../src/client/components/plugins-section.js');
  const marqueeSelectChunk = require('../src/client/components/marquee-select.js');
  const collapsibleSectionChunk = require('../src/client/components/collapsible-section.js');
  const modelMainSectionChunk = require('../src/client/components/model-main-section.js');
  const fallbackRowChunk = require('../src/client/components/fallback-row.js');
  const modelConfigTabChunk = require('../src/client/components/model-config-tab.js');
  const paramsTabChunk = require('../src/client/components/params-tab.js');
  const modelPluginsSectionChunk = require('../src/client/components/model-plugins-section.js');
  const stylesChunk = require('../src/client/styles.js');
  const appChunk = require('../src/client/app.js');
  // v3.2.5（语音识别模块）：voice chunk（独立模块）+ RecordRTC vendor chunk（GENERATED）
  const recordrtcChunk = require('../src/client/vendor/recordrtc.chunk.js');
  const voiceStateChunk = require('../src/client/voice/state.js');
  const voiceRecorderChunk = require('../src/client/voice/recorder.js');
  const voiceInsertChunk = require('../src/client/voice/voice-insert.js');
  const voiceMicButtonChunk = require('../src/client/voice/mic-button.js');
  const voiceSectionChunk = require('../src/client/voice/voice-section.js');
  // Inject all chunks, looping until no marker remains: component chunks may
  // themselves contain other injection markers (e.g. the updater constants
  // lived between EnhanceBar and UpdaterCard), so a single pass would leave
  // nested markers unexpanded.
  const injections = [
    ['// @dsh-client-i18n-inject', i18nChunk],
    ['// @dsh-client-constants-inject', constantsChunk],
    ['// @dsh-client-updater-inject', updaterChunk],
    ['// @dsh-client-state-inject', stateChunk],
    ['// @dsh-client-helpers-inject', helpersChunk],
    ['// @dsh-client-model-helpers-inject', modelHelpersChunk],
    ['// @dsh-client-comp-enhance-button-inject\n', enhanceButtonChunk],
    ['// @dsh-client-comp-enhance-bar-inject\n', enhanceBarChunk],
    ['// @dsh-client-comp-updater-card-inject\n', updaterCardChunk],
    ['// @dsh-client-comp-marquee-select-inject\n', marqueeSelectChunk],
    ['// @dsh-client-comp-plugins-section-inject\n', pluginsSectionChunk],
    ['// @dsh-client-comp-collapsible-section-inject\n', collapsibleSectionChunk],
    ['// @dsh-client-comp-model-main-section-inject\n', modelMainSectionChunk],
    ['// @dsh-client-comp-fallback-row-inject\n', fallbackRowChunk],
    ['// @dsh-client-comp-model-config-tab-inject\n', modelConfigTabChunk],
    ['// @dsh-client-comp-params-tab-inject\n', paramsTabChunk],
    ['// @dsh-client-comp-model-plugins-section-inject\n', modelPluginsSectionChunk],
    ['// @dsh-client-vendor-recordrtc-inject\n', recordrtcChunk],
    ['// @dsh-client-voice-state-inject\n', voiceStateChunk],
    ['// @dsh-client-voice-recorder-inject\n', voiceRecorderChunk],
    ['// @dsh-client-voice-insert-inject\n', voiceInsertChunk],
    ['// @dsh-client-voice-comp-mic-button-inject\n', voiceMicButtonChunk],
    ['// @dsh-client-voice-comp-section-inject\n', voiceSectionChunk],
    ['// @dsh-client-styles-inject\n', stylesChunk],
    ['// @dsh-client-app-inject\n', appChunk],
  ];
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
// Rebuild after changing plugin-client.js: node scripts/build-client.mjs
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

  // Keep the root plugin-client.js as a committed artifact for dynamic Cordis
  // install and for the package "files" list.
  const clientHeader = `// GENERATED by scripts/build-client.mjs — do not edit by hand.\n// Source: src/client/skeleton.js + src/client/{i18n,constants,updater,state,helpers,model-helpers,styles,app}.js + src/client/components/*.js\n`;
  const clientArtifact = body.startsWith('// GENERATED') ? body : clientHeader + body;
  return { template, clientArtifact };
}

const { template, clientArtifact } = buildClient();
const args = process.argv.slice(2);

if (args.includes('--check')) {
  // v3.2.1-t（漂移检测）：对比两个产物，任一不一致即报错退出 1。
  let clientOk = true;
  let artifactOk = true;
  try { clientOk = readFileSync(join(root, 'lib', 'client.cjs'), 'utf8') === template; } catch { clientOk = false; }
  try { artifactOk = readFileSync(join(root, 'plugin-client.js'), 'utf8') === clientArtifact; } catch { artifactOk = false; }
  if (clientOk && artifactOk) {
    console.log('lib/client.cjs + plugin-client.js OK（源码 ↔ 产物一致）');
    process.exit(0);
  }
  console.error('[build-client --check] 漂移检测失败：client 产物与源码重建结果不一致！');
  console.error('  client.cjs 一致: ' + clientOk + ' | plugin-client.js 一致: ' + artifactOk);
  console.error('  修复：node scripts/build-client.mjs（重建产物），或还原被手改的产物。');
  process.exit(1);
}

mkdirSync(join(root, 'lib'), { recursive: true });
writeFileSync(join(root, 'lib', 'client.cjs'), template, 'utf8');
console.log('lib/client.cjs written (' + template.length + ' bytes)');
writeFileSync(join(root, 'plugin-client.js'), clientArtifact, 'utf8');
console.log('plugin-client.js written (' + clientArtifact.length + ' bytes)');
