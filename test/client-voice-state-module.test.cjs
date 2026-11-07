'use strict';

// 目标模式：voice/state-module.cjs 的等价、持久化与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { VOICE_CONFIG_DEFAULTS } = require('../src/shared/contracts/voice-config.cjs');
const { RPC_METHODS } = require('../src/shared/contracts/rpc.cjs');
const { createVoiceState } = require('../src/client/domains/voice/state.cjs');

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
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/domains/voice/state.cjs')), true);
  assert.equal(typeof createVoiceState, 'function');
});

test('CVSTATE-02 工厂使用共享默认值，并保留 VAD 归一化与白名单取形', () => {
  const api = createVoiceState({
    host: { call: () => Promise.resolve({ ok: false }) },
    storage: makeStorage(),
    defaults: VOICE_CONFIG_DEFAULTS,
    rpcMethods: RPC_METHODS,
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
    dictionary: { entries: [] },
  });
});

// UD-0055 / UD-0057（学习词典）：`dictionary` 是与 VAD 同形的第六个白名单键 ——
// 归一化必须走契约层（⛔ 不在 client 侧自建筛子），故这里同时断言「缺省为空」与「注入后按契约归一」。
test('CVSTATE-02b dictionary 键按契约层归一（同形白名单的第六键）', () => {
  const { normalizeDictionaryEntries } = require('../lib/voice-config.cjs');
  const api = createVoiceState({
    host: { call: () => Promise.resolve({ ok: false }) },
    storage: makeStorage(),
    defaults: VOICE_CONFIG_DEFAULTS,
    rpcMethods: RPC_METHODS,
    normalizeDictionaryEntries,
    autoSync: false,
  });
  const merged = api.mergeVoice({
    dictionary: { entries: [
      { from: '设置页', to: '设备页', hits: 1, at: 5, enabled: true },
      { from: '设置页', to: '设备页', hits: 2, at: 9, enabled: false },
      { from: '同名', to: '同名' },
      { from: '太长的替换串超过二十个字这一条必须被丢掉', to: 'x' },
    ] },
  });
  assert.deepEqual(merged.dictionary.entries, [
    { from: '设置页', to: '设备页', hits: 3, at: 9, enabled: true },
  ]);
  assert.deepEqual(api.mergeVoice({}).dictionary, { entries: [] });
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
    rpcMethods: RPC_METHODS,
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
    rpcMethods: RPC_METHODS,
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
    rpcMethods: RPC_METHODS,
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
  const shared = fs.readFileSync(path.join(REPO_ROOT, 'src/client/common/runtime.cjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(build.includes("entry: 'src/client/app.cjs'"), 'build-client 必须从普通入口模块打包');
  assert.ok(shared.includes('fillerState: filler.fillerState'));
  assert.ok(client.includes('src/client/domains/voice/state.cjs'));
  assert.ok(client.includes('createVoiceState({ host:'));
  assert.equal(client.includes('src/client/voice/state.js'), false);
  assert.equal(client.includes('src/client/voice/recorder.js'), false);
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
});
