'use strict';

// 目标模式：voice/state-module.cjs 的等价、持久化与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { VOICE_CONFIG_DEFAULTS } = require('../src/shared/contracts/voice-config.cjs');
const { createVoiceState } = require('../src/client/voice/state-module.cjs');

function makeStorage(seed) {
  const backing = new Map(seed ? Object.entries(seed) : []);
  return {
    backing,
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('CVSTATE-01 旧状态与录音占位 chunk 退役，普通状态模块在位', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/voice/state.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/voice/recorder.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/voice/state-module.cjs')), true);
  assert.equal(typeof createVoiceState, 'function');
});

test('CVSTATE-02 工厂使用共享默认值，并保留 VAD 归一化与白名单取形', () => {
  const api = createVoiceState({
    host: { call: () => Promise.resolve({ ok: false }) },
    storage: makeStorage(),
    defaults: VOICE_CONFIG_DEFAULTS,
    autoSync: false,
  });
  assert.deepEqual(api.VOICE_CFG_DEFAULTS, VOICE_CONFIG_DEFAULTS);
  assert.equal(api.normalizeVadSilenceMs(5), 5000);
  assert.equal(api.normalizeVadSilenceMs(5000), 5000);
  assert.equal(api.normalizeVadSilenceMs(0), 2000);
  assert.equal(api.vadRequiredQuiet(2000), 20);
  assert.deepEqual(api.mergeVoice({
    filler: { enabled: false },
    hotkey: { enabled: true, combo: 'Alt+Backquote' },
    autoEnhance: true,
    correction: { enabled: true },
  }), {
    filler: { enabled: false },
    vad: { enabled: true, silenceMs: 2000 },
    hotkey: { enabled: true, combo: 'Alt+Backquote' },
    autoEnhance: true,
    correction: { enabled: true },
  });
});

test('CVSTATE-03 saveConfig 只提交 voice 顶层键，并持久化非敏感配置', async () => {
  const calls = [];
  const storage = makeStorage();
  const api = createVoiceState({
    host: {
      call(method, args) {
        calls.push({ method, args });
        return Promise.resolve({ ok: true });
      },
    },
    storage,
    defaults: VOICE_CONFIG_DEFAULTS,
    autoSync: false,
  });
  api.saveVoiceCfg({ autoEnhance: true, hotkey: { enabled: true, combo: 'Alt+Backquote' } });
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'config/set');
  assert.deepEqual(Object.keys(calls[0].args.config), ['voice']);
  assert.equal(calls[0].args.config.voice.autoEnhance, true);
  assert.deepEqual(JSON.parse(storage.backing.get('dsh.prompt-enhancer.voice')).hotkey, {
    enabled: true,
    combo: 'Alt+Backquote',
  });
});

test('CVSTATE-04 自动同步并发去重，并把旧 refine 清理可见地写入 fillerState', async () => {
  let getCalls = 0;
  let setCalls = 0;
  const fillerState = {
    legacyChecked: false,
    legacyCleaned: false,
    legacyAt: 0,
  };
  const api = createVoiceState({
    host: {
      call(method) {
        if (method === 'config/get') {
          getCalls += 1;
          return Promise.resolve({
            ok: true,
            config: {
              voice: {
                hotkey: { enabled: true, combo: 'Alt+Backquote' },
                refine: { enabled: true },
              },
            },
          });
        }
        setCalls += 1;
        return Promise.resolve({ ok: true });
      },
    },
    storage: makeStorage(),
    fillerState,
    defaults: VOICE_CONFIG_DEFAULTS,
    autoSync: true,
  });
  const same = api.syncVoiceFromHost();
  await settle();
  await same;
  await settle();
  assert.equal(getCalls, 1, '模块级启动与显式调用必须复用同一在途请求');
  assert.equal(setCalls, 1, '旧 refine 只清理一次');
  assert.equal(fillerState.legacyChecked, true);
  assert.equal(fillerState.legacyCleaned, true);
  assert.equal(api.voiceCfgState.value.hotkey.enabled, true);
});

test('CVSTATE-05 同步失败走注入了有界 timer，耗尽后终止而非永久悬挂', async () => {
  const pending = [];
  let calls = 0;
  const api = createVoiceState({
    host: {
      call() {
        calls += 1;
        return Promise.resolve({ ok: false });
      },
    },
    storage: makeStorage(),
    timerSvc: {
      timeout(fn) {
        pending.push(fn);
        return pending.length;
      },
    },
    defaults: VOICE_CONFIG_DEFAULTS,
    autoSync: true,
  });
  await settle();
  while (pending.length) {
    pending.shift()();
    await settle();
  }
  assert.equal(calls, 10);
  assert.equal(api.voiceCfgState.synced, true);
  assert.equal(api.voiceCfgState.syncing, false);
});

test('CVSTATE-06 产物内联状态模块，共享运行时暴露 fillerState，旧 chunk 与相对 require 均不存在', () => {
  const build = fs.readFileSync(path.join(REPO_ROOT, 'scripts/build-client.mjs'), 'utf8');
  const shared = fs.readFileSync(path.join(REPO_ROOT, 'src/client/shared-runtime.cjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(build.includes("entry: 'src/client/voice/state-module.cjs'"));
  assert.ok(build.includes("'// @dsh-client-voice-recorder-inject\\n', ''"));
  assert.ok(shared.includes('fillerState: filler.fillerState'));
  assert.ok(client.includes('src/client/voice/state-module.cjs'));
  assert.ok(client.includes('__DSH_VOICE_STATE__.createVoiceState'));
  assert.equal(client.includes('src/client/voice/state.js'), false);
  assert.equal(client.includes('src/client/voice/recorder.js'), false);
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
});
