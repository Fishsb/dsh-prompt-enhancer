// voice 语音识别模块契约测试（v3.2.5 · P1）
// 覆盖：① voice/* RPC schema 校验行为（lib/rpc-schema.cjs）
//       ② src/host/rpc-schema.js（源）与 lib/rpc-schema.cjs（运行时副本）双份同步防漂移
//       ③ lib/index.cjs 注册 voice/status·voice/transcribe（防重构删除无感）
//       ④ plugin-client.js 产物含 voice 逻辑（构建注入防漂移）+ vendor RecordRTC 注入
//       ⑤ lib/asr.cjs sanitizeVoiceCfg 行为 + transcribe 空配置/错误路径
//       ⑥ i18n ZH/EN voice 键平衡（31 键成对防漏）
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const libSchema = require('../lib/rpc-schema.cjs');
const asr = require('../lib/asr.cjs');

// ---- 1. voice/* RPC schema 校验 ----
test('VOICE-P01 voice/status 无参数通过', () => {
  assert.equal(libSchema.validateRpcArgs('voice/status', {}).ok, true);
});

test('VOICE-P02 voice/transcribe 合法 data URL 通过', () => {
  assert.equal(libSchema.validateRpcArgs('voice/transcribe', { audioBase64: 'data:audio/wav;base64,AAAA' }).ok, true);
  assert.equal(libSchema.validateRpcArgs('voice/transcribe', { audioBase64: 'data:audio/mp3;base64,AAAA', engine: 'cloud' }).ok, true);
});

test('VOICE-P03 voice/transcribe 非 data URL / 非法 engine 拒绝', () => {
  assert.equal(libSchema.validateRpcArgs('voice/transcribe', { audioBase64: 'AAAA' }).ok, false);
  assert.equal(libSchema.validateRpcArgs('voice/transcribe', { audioBase64: 'data:audio/mp4;base64,AAAA' }).ok, false);
  assert.equal(libSchema.validateRpcArgs('voice/transcribe', { audioBase64: 'data:audio/wav;base64,AAAA', engine: 'x' }).ok, false);
});

test('VOICE-P04 voice/transcribe 缺 audioBase64 拒绝（MISSING_ARG）', () => {
  const r = libSchema.validateRpcArgs('voice/transcribe', {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MISSING_ARG');
});

// ---- 2. 双份 rpc-schema 同步 ----
test('VOICE-P05 src/host/rpc-schema.js 源含 voice/* 且与 lib 副本一致', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'host', 'rpc-schema.js'), 'utf8');
  const m = src.match(/module\.exports = \"([\s\S]*)\"\s*;?\s*$/);
  const body = m ? m[1] : src;
  assert.ok(body.includes("'voice/status'"), 'src/host 源缺 voice/status');
  assert.ok(body.includes("'voice/transcribe'"), 'src/host 源缺 voice/transcribe');
  assert.ok(body.includes('required: [\'audioBase64\']'), 'src/host 源 voice/transcribe 缺 required');
  assert.equal(
    JSON.stringify(libSchema.schemas['voice/status']),
    JSON.stringify(require('../src/host/rpc-schema.js').schemas['voice/status']),
    'voice/status 双份不一致'
  );
  assert.equal(
    JSON.stringify(libSchema.schemas['voice/transcribe']),
    JSON.stringify(require('../src/host/rpc-schema.js').schemas['voice/transcribe']),
    'voice/transcribe 双份不一致'
  );
});

// ---- 3. lib/index.cjs 注册 ----
test('VOICE-P06 lib/index.cjs 注册 voice/status·voice/transcribe + config/set merge', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'index.cjs'), 'utf8');
  assert.ok(src.includes("harness.handle('voice/status'"), '未注册 voice/status');
  assert.ok(src.includes("harness.handle('voice/transcribe'"), '未注册 voice/transcribe');
  assert.ok(src.includes("require('./asr.cjs')"), '未 require asr.cjs');
  // config/set merge 语义（多写入方）
  assert.ok(src.includes('顶层键级 merge'), 'config/set 未升级 merge 语义');
});

// ---- 4. client 产物注入 ----
test('VOICE-P07 plugin-client.js 产物含 voice 逻辑 + vendor RecordRTC', () => {
  const client = readFileSync(join(__dirname, '..', 'plugin-client.js'), 'utf8');
  assert.ok(client.includes('VoiceMicButton'), '产物缺 VoiceMicButton');
  assert.ok(client.includes('VoiceSection'), '产物缺 VoiceSection');
  assert.ok(client.includes("host.call('voice/transcribe'"), '产物缺 voice/transcribe 调用');
  assert.ok(client.includes('isEnhancing'), '产物缺 isEnhancing');
  assert.ok(client.includes('function RecordRTC'), '产物缺 vendor RecordRTC 注入');
  assert.ok(client.includes('desiredSampRate'), '产物缺 16k 采样参数');
});

test('VOICE-P08 client 产物含 voice 状态机与双暂存逻辑', () => {
  const client = readFileSync(join(__dirname, '..', 'plugin-client.js'), 'utf8');
  assert.ok(client.includes("'voicePendingEnhance'") || client.includes('voicePendingEnhance'), '产物缺 pending 暂存文案引用');
  assert.ok(client.includes('insertVoiceText'), '产物缺 insertVoiceText');
  assert.ok(client.includes('submitting') && client.includes('adjudicating'), '产物缺发送期暂存判定');
});

// ---- 5. lib/asr.cjs sanitize ----
test('VOICE-P09 sanitizeVoiceCfg 白名单净化', () => {
  const clean = asr.sanitizeVoiceCfg({
    asr: { engine: 'bad', cloud: { protocol: 'x', baseUrl: 'https://a.com/', apiKey: 'k', model: 'm' } },
    refine: { enabled: 'yes', maxTokens: 99999 },
  });
  assert.equal(clean.asr.engine, 'cloud'); // 非法回退 cloud
  assert.equal(clean.asr.cloud.protocol, 'chat'); // 非法回退 chat
  assert.equal(clean.asr.cloud.baseUrl, 'https://a.com'); // 去尾斜杠
  assert.equal(clean.refine.enabled, false); // 非 boolean 回退
  assert.equal(clean.refine.maxTokens, 300); // 越界回退默认
});

test('VOICE-P10 status 组装：cloud/refine configured 判定（P2 local 实时探测）', async () => {
  // refine 默认 chain 模式：已选基座模型（provider/model）→ configured=true（v3.2.8）
  const s = await asr.status({
    asr: { engine: 'cloud', cloud: { baseUrl: 'b', apiKey: 'k', model: 'm' } },
    refine: { enabled: true, provider: 'ollama', model: 'qwen2.5:1.5b' },
  });
  assert.equal(s.ok, true);
  assert.equal(s.asr.cloud.configured, true);
  assert.equal(s.refine.configured, true, 'chain 模式 + 已选模型 → 就绪');
  // custom 模式：独立三项完整 → configured
  const s2 = await asr.status({
    asr: { engine: 'cloud' },
    refine: { enabled: true, mode: 'custom', baseUrl: 'r', apiKey: 'k', model: 'm' },
  });
  assert.equal(s2.refine.configured, true, 'custom 模式独立三项 → 就绪');
  // local 字段结构（worker 探测，测试环境通常未运行 → installed=false 但结构完整）
  assert.equal(typeof s.asr.local.installed, 'boolean');
  assert.equal(typeof s.asr.local.modelReady, 'boolean');
  assert.equal(typeof s.asr.local.workerUp, 'boolean');
});

test('VOICE-P11 transcribe 错误路径：空配置 ASR_NO_KEY / local 分派 / BAD_AUDIO', async () => {
  const noKey = await asr.transcribe({ asr: { engine: 'cloud' } }, 'data:audio/wav;base64,AAAA');
  assert.equal(noKey.ok, false);
  assert.equal(noKey.code, 'ASR_NO_KEY');
  // P2：local 引擎已实现——分派到 worker（本机可能运行中或未部署）；无论 worker 状态如何，
  // 都应返回 ok:false 且错误码为 ASR_LOCAL_* 系列（不再有 NOT_READY 占位）
  const local = await asr.transcribe({ asr: { engine: 'local' } }, 'data:audio/wav;base64,AAAA');
  assert.equal(local.ok, false);
  assert.ok(String(local.code).startsWith('ASR_LOCAL_'), 'local 错误码应为 ASR_LOCAL_*，实际 ' + local.code);
  const badAudio = await asr.transcribe({ asr: { engine: 'cloud' } }, 'not-a-data-url');
  assert.equal(badAudio.ok, false);
  assert.equal(badAudio.code, 'BAD_AUDIO');
});

// ---- 6. i18n 平衡 ----
test('VOICE-P12 i18n voice 键 ZH/EN 平衡（37 键成对，v3.2.9 快捷键 +6）', () => {
  const i18n = readFileSync(join(__dirname, '..', 'src', 'client', 'i18n.js'), 'utf8');
  const m = i18n.match(/module\.exports = \"([\s\S]*)\"\s*;?\s*$/);
  const body = m ? m[1] : i18n;
  const zh = body.split('const EN = {')[0] || '';
  const en = body.split('const EN = {')[1] || '';
  const z = (zh.match(/voice[A-Za-z]+:/g) || []).length;
  const e = (en.match(/voice[A-Za-z]+:/g) || []).length;
  assert.ok(z >= 37, 'ZH voice 键不足 37（实际 ' + z + '）');
  assert.equal(z, e, 'ZH/EN voice 键不平衡: ' + z + ' vs ' + e);
});

// ---- 7. 整配置结构回归（2026-08-20 实测修复：handler 传整配置致 engine 恒回退 cloud）----
test('VOICE-P13 整配置结构调用（handler 真实形态）engine=local 生效', async () => {
  // host handler 传入的是整个 dsh-prompt-enhancer.config.json（顶层键含 voice），非 voice 段
  const whole = {
    version: '3.2.4',
    fallback: [],
    params: {},
    voice: {
      asr: { engine: 'local', cloud: { protocol: 'chat', baseUrl: 'b', apiKey: 'k', model: 'm' } },
      refine: { enabled: true, baseUrl: 'r', apiKey: 'k', model: 'm' },
    },
  };
  const s = await asr.status(whole);
  assert.equal(s.asr.engine, 'local', '整配置输入应读出 engine=local（此前恒 cloud）');
  assert.ok(s.asr.local && typeof s.asr.local.workerUp === 'boolean', 'local 探测结构完整');
  // 关键回归：engine=local 时 transcribe 必须走 local 分支（ASR_LOCAL_*），绝不能 ASR_NO_KEY
  const t = await asr.transcribe(whole, 'data:audio/wav;base64,AAAA');
  assert.equal(t.ok, false);
  assert.ok(String(t.code).startsWith('ASR_LOCAL_'), '整配置 + local 应走本地分支，实际 ' + t.code);
  // cloud 整配置：三元组完整（configured）→ 真实请求 baseUrl='b' 无效 → 云端分支网络错误（而非 local 分支）
  const wholeCloud = JSON.parse(JSON.stringify(whole));
  wholeCloud.voice.asr.engine = 'cloud';
  const tc = await asr.transcribe(wholeCloud, 'data:audio/wav;base64,AAAA');
  assert.equal(tc.code, 'ASR_NETWORK', 'cloud 整配置应走云端分支（bad url → NETWORK），实际 ' + tc.code);
});

// ---- 8. VAD 配置（2026-08-20 P3）：sanitize vad 白名单 ----
test('VOICE-P14 sanitizeVoiceCfg vad 字段：默认开启，显式 false 关闭', () => {
  const d = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' } });
  assert.equal(d.vad.enabled, true, 'vad 默认开启');
  const off = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, vad: { enabled: false } });
  assert.equal(off.vad.enabled, false, '显式 false 关闭');
});

// ---- 9. 多语言（2026-08-20 P3）：sanitize local.language 白名单 ----
test('VOICE-P15 sanitizeVoiceCfg local.language：默认 auto，非法回退 auto', () => {
  const d = asr.sanitizeVoiceCfg({ asr: { engine: 'local' } });
  assert.equal(d.asr.local.language, 'auto', '默认 auto');
  const ja = asr.sanitizeVoiceCfg({ asr: { engine: 'local', local: { language: 'ja' } } });
  assert.equal(ja.asr.local.language, 'ja', '合法枚举保留');
  const bad = asr.sanitizeVoiceCfg({ asr: { engine: 'local', local: { language: 'xx' } } });
  assert.equal(bad.asr.local.language, 'auto', '非法回退 auto');
});

// ---- 10. 模型管理框架（2026-08-20：插件精简·框架接口 + 可选下载）----
test('VOICE-P16 模型清单结构 + installed 判定 + sanitize model id', () => {
  const am = require('../lib/asr-models.cjs');
  const list = am.modelList();
  assert.equal(list.ok, true);
  assert.ok(Array.isArray(list.models) && list.models.length >= 1, '至少一个模型');
  const m = list.models[0];
  assert.equal(typeof m.id, 'string');
  assert.equal(typeof m.name, 'string');
  assert.ok(m.sizeMB > 0, 'sizeMB 为正');
  assert.equal(typeof m.installed, 'boolean');
  // 未知模型下载拒绝
  const bad = am.modelDownload('no-such-model');
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'MODEL_UNKNOWN');
  // sanitize model id（单模型 sense-voice，旧值 sensevoice-q8 兼容映射）
  const d = asr.sanitizeVoiceCfg({ asr: { engine: 'local', local: { model: 'sensevoice-q8' } } });
  assert.equal(d.asr.local.model, 'sense-voice', '旧值兼容映射');
});

// ---- 11. 模型管理 v2（多模型市场/自定义扫描/切换，2026-08-20）----
test('VOICE-P20 多模型切换白名单：paraformer/自定义/空 保留，非法回退（v3.2.16 修复）', () => {
  // 修复前：sanitizeVoiceCfg 模型白名单硬编码 sense-voice，任何非 sense-voice 选择被静默重置
  // → 设置页「切换模型」保存无效、UI 永不反映当前模型。修复后按 [A-Za-z0-9._-] 动态校验保留。
  const para = asr.sanitizeVoiceCfg({ asr: { engine: 'local', local: { model: 'paraformer-zh' } } });
  assert.equal(para.asr.local.model, 'paraformer-zh', '内置多模型 id 保留');
  const custom = asr.sanitizeVoiceCfg({ asr: { engine: 'local', local: { model: 'my-custom.model_v2' } } });
  assert.equal(custom.asr.local.model, 'my-custom.model_v2', '自定义模型目录名保留');
  const empty = asr.sanitizeVoiceCfg({ asr: { engine: 'local', local: { model: '' } } });
  assert.equal(empty.asr.local.model, '', '删除最后模型：空串保留（无当前模型）');
  const legacy = asr.sanitizeVoiceCfg({ asr: { engine: 'local', local: { model: 'sensevoice-q8' } } });
  assert.equal(legacy.asr.local.model, 'sense-voice', '旧值兼容映射');
  const bad = asr.sanitizeVoiceCfg({ asr: { engine: 'local', local: { model: '../evil' } } });
  assert.equal(bad.asr.local.model, 'sense-voice', '非法 id 回退默认');
});

test('VOICE-P17 模型市场多条目 + 自定义扫描 + modelApply 校验', () => {
  const am = require('../lib/asr-models.cjs');
  const list = am.modelList();
  assert.ok(list.models.length >= 2, '内置至少 2 个下载配置');
  const ids = list.models.map((m) => m.id);
  assert.ok(ids.includes('sense-voice') && ids.includes('paraformer-zh'), '内置含 SenseVoice + Paraformer');
  const sense = list.models.find((m) => m.id === 'sense-voice');
  assert.equal(sense.type, 'sense-voice');
  const para = list.models.find((m) => m.id === 'paraformer-zh');
  assert.equal(para.type, 'paraformer', 'paraformer 带类型（worker 按类型加载）');
  // 自定义扫描：非内置目录 + onnx + tokens → custom 列出（本机 models/ 可能无自定义目录，但结构须正确）
  for (const m of list.models) {
    assert.equal(typeof m.installed, 'boolean');
    assert.equal(typeof m.custom, 'boolean');
  }
  // modelApply：未安装拒绝 / 已安装 ok（环境自适应：模型是否已装因机器而异，两个方向都要能验）
  const paraInstalled = para.installed;
  if (!paraInstalled) {
    const bad = am.modelApply('paraformer-zh');
    assert.equal(bad.code, 'MODEL_NOT_INSTALLED', '未安装模型切换应拒绝');
  } else {
    const okp = am.modelApply('paraformer-zh');
    assert.equal(okp.ok, true, JSON.stringify(okp));
    assert.equal(okp.model, 'paraformer-zh');
  }
  if (sense.installed) {
    const ok = am.modelApply('sense-voice');
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.model, 'sense-voice');
    assert.equal(ok.type, 'sense-voice');
  } else {
    const bad2 = am.modelApply('sense-voice');
    assert.equal(bad2.code, 'MODEL_NOT_INSTALLED', '默认模型未安装时同样应拒绝');
  }
});

// ---- 12. 规整复用模型配置（2026-08-20 用户需求）：chain 模式走基座 llm ----
test('VOICE-P18 refine chain 模式：基座模型选择（provider/model）+ llm 调用 + 降级', async () => {
  // sanitize：默认 chain；provider/model 保留；custom 保留
  const d = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, refine: { enabled: true, provider: 'ollama', model: 'qwen2.5:1.5b' } });
  assert.equal(d.refine.mode, 'chain', '默认 chain');
  assert.equal(d.refine.provider, 'ollama', 'provider 保留（基座本地模型）');
  assert.equal(d.refine.model, 'qwen2.5:1.5b', 'model 保留');
  const c = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, refine: { enabled: true, mode: 'custom' } });
  assert.equal(c.refine.mode, 'custom', 'custom 保留');
  // chain 模式 mock llm
  let called = null;
  asr.setLlm({
    stream: (args) => { called = args; return (async function* () { yield { text: '方案OK' }; })(); },
  });
  const voice = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, refine: { enabled: true, provider: 'ollama', model: 'qwen2.5:1.5b' } });
  const r = await asr.refineText(voice, '嗯方案OK');
  assert.equal(r.ok, true);
  assert.equal(r.text, '方案OK');
  assert.equal(called.provider, 'ollama', 'provider 透传（基座本地模型）');
  assert.equal(called.model, 'qwen2.5:1.5b', 'model 透传');
  assert.ok(called.system.includes('口水词'), '系统提示词为去口水词');
  assert.ok(called.maxTokens > 0, 'maxTokens 有值');
  // 未选模型跳过 / 无 llm 服务报错
  const empty = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, refine: { enabled: true } });
  assert.equal((await asr.refineText(empty, 'x')).skipped, true, '未选模型跳过');
  asr.setLlm(null);
  const voice2 = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, refine: { enabled: true, provider: 'a', model: 'b' } });
  assert.equal((await asr.refineText(voice2, 'x')).code, 'REFINE_NO_LLM', '无 llm 服务报错');
  // status：chain + provider/model → configured；未选 → false
  asr.setLlm({ stream: () => (async function* () { yield { text: 'y' }; })() });
  const s1 = await asr.status({ voice: { asr: { engine: 'cloud' }, refine: { enabled: true, provider: 'ollama', model: 'qwen2.5:1.5b' } } });
  assert.equal(s1.refine.configured, true, 'chain+已选模型就绪');
  const s2 = await asr.status({ voice: { asr: { engine: 'cloud' }, refine: { enabled: true } } });
  assert.equal(s2.refine.configured, false, 'chain+未选模型未就绪');
});

// ---- 8. v3.2.9 快捷键唤醒（hotkey 白名单 + 产物含双触发逻辑）----
test('VOICE-P19 hotkey 配置白名单 + 产物含快捷键/双触发逻辑', () => {
  // sanitize：默认关闭且 combo 空（v3.2.33）；显式启用/自定义 combo
  const d = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' } });
  assert.equal(d.hotkey.enabled, false, '默认关闭');
  assert.equal(d.hotkey.combo, '', '默认空');
  const off = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, hotkey: { enabled: false } });
  assert.equal(off.hotkey.enabled, false, '显式禁用');
  const custom = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, hotkey: { enabled: true, combo: 'Ctrl+Shift+Backquote' } });
  assert.equal(custom.hotkey.combo, 'Ctrl+Shift+Backquote', '组合键保留');
  const bad = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, hotkey: { combo: 123 } });
  assert.equal(bad.hotkey.combo, '', '非法 combo 回退空');
  // 产物含快捷键/双触发逻辑
  const client = readFileSync(join(__dirname, '..', 'plugin-client.js'), 'utf8');
  assert.ok(client.includes('VOICE_LONG_PRESS_MS'), '产物缺长按阈值常量');
  assert.ok(client.includes('parseVoiceHotkey'), '产物缺快捷键解析');
  assert.ok(client.includes('pressStart') && client.includes('pressEnd'), '产物缺按下/松开触发抽象');
  assert.ok(client.includes('voiceHotkeyCapturing'), '产物缺录制 i18n 引用');
  // i18n 键平衡（v3.2.9 +6 键 → 37）
  const i18n = readFileSync(join(__dirname, '..', 'src', 'client', 'i18n.js'), 'utf8');
  const m = i18n.match(/module\.exports = \"([\s\S]*)\"\s*;?\s*$/);
  const body = m ? m[1] : i18n;
  const zh = body.split('const EN = {')[0] || '';
  const en = body.split('const EN = {')[1] || '';
  const z = (zh.match(/voice[A-Za-z]+:/g) || []).length;
  const e = (en.match(/voice[A-Za-z]+:/g) || []).length;
  assert.ok(z >= 37, 'ZH voice 键不足 37（实际 ' + z + '）');
  assert.equal(z, e, 'ZH/EN voice 键不平衡: ' + z + ' vs ' + e);
});

// ---- 13. v3.2.17 语音识别完自动触发增强（autoEnhance）----
// 沙箱求值 client state.js chunk（mock localStorage/host，隔离模块级状态）
function makeVoiceSandbox(store) {
  const src = require('../src/client/voice/state.js');
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const host = { call: async () => ({ ok: true, config: null }) };
  const fn = new Function('localStorage', 'host',
    src + '\nreturn { mergeVoice, saveVoiceCfg, voiceCfgState, syncVoiceFromHost };');
  return fn(localStorage, host);
}

test('VOICE-P21 client state.js：autoEnhance 默认 false + mergeVoice 校验（非法回退 false）', () => {
  const store = {};
  const sb = makeVoiceSandbox(store);
  // 默认值（VOICE_CFG_DEFAULTS 展开 + mergeVoice 白名单双保险）
  assert.equal(sb.voiceCfgState.value.autoEnhance, false, '初始默认 false');
  const mv = sb.mergeVoice;
  assert.equal(mv({ autoEnhance: true }).autoEnhance, true, 'true 保留');
  assert.equal(mv({ autoEnhance: false }).autoEnhance, false, 'false 保留');
  assert.equal(mv({}).autoEnhance, false, '缺省回退 false');
  assert.equal(mv({ autoEnhance: 'yes' }).autoEnhance, false, '字符串非法回退 false');
  assert.equal(mv({ autoEnhance: 1 }).autoEnhance, false, '数字非法回退 false');
  assert.equal(mv(null).autoEnhance, false, 'null 输入安全');
});

test('VOICE-P22 client state.js：autoEnhance 持久化（save→load 保留 true/false）', () => {
  const store = {};
  const sb1 = makeVoiceSandbox(store);
  sb1.saveVoiceCfg({ autoEnhance: true });
  const raw1 = JSON.parse(store['dsh.prompt-enhancer.voice']);
  assert.equal(raw1.autoEnhance, true, 'save true → localStorage 持久化 true');
  // 模拟重启：新沙箱读同一 localStorage → 恢复 true
  const sb2 = makeVoiceSandbox(store);
  assert.equal(sb2.voiceCfgState.value.autoEnhance, true, 'load 恢复 true');
  sb2.saveVoiceCfg({ autoEnhance: false });
  const raw2 = JSON.parse(store['dsh.prompt-enhancer.voice']);
  assert.equal(raw2.autoEnhance, false, 'save false → localStorage 持久化 false');
  const sb3 = makeVoiceSandbox(store);
  assert.equal(sb3.voiceCfgState.value.autoEnhance, false, 'load 恢复 false');
});

test('VOICE-P23 sanitizeVoiceCfg autoEnhance 白名单（host 透传存储）', () => {
  const d = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' } });
  assert.equal(d.autoEnhance, false, '默认 false');
  const on = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, autoEnhance: true });
  assert.equal(on.autoEnhance, true, 'true 保留');
  const bad = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, autoEnhance: 'yes' });
  assert.equal(bad.autoEnhance, false, '非法回退 false');
});

test('VOICE-P24 产物含 autoEnhance 触发链路 + i18n 键平衡（v3.2.17 +3 键 → 40）', () => {
  const client = readFileSync(join(__dirname, '..', 'plugin-client.js'), 'utf8');
  assert.ok(client.includes('autoEnhance'), '产物缺 autoEnhance 配置字段');
  assert.ok(client.includes('voiceAutoEnhanceOn'), '产物缺自动增强开 i18n 引用');
  assert.ok(client.includes('voiceAutoEnhanceOff'), '产物缺自动增强关 i18n 引用');
  assert.ok(client.includes('voiceAutoEnhanceTip'), '产物缺自动增强提示 i18n 引用');
  // 触发链路：insertVoiceText 返回后按 filled/pending/autoEnhance 判定调用 enhance
  assert.ok(client.includes('fill.filled === true'), '产物缺 filled 判定');
  assert.ok(client.includes('fill.pending'), '产物缺 pending 判定');
  assert.ok(client.includes("enhance(sessionId, filledText, inputActions, draftRef)"), '产物缺 enhance 自动触发调用');
  // i18n 键平衡（v3.2.17 +3 键 → 40）
  const i18n = readFileSync(join(__dirname, '..', 'src', 'client', 'i18n.js'), 'utf8');
  const m = i18n.match(/module\.exports = \"([\s\S]*)\"\s*;?\s*$/);
  const body = m ? m[1] : i18n;
  const zh = body.split('const EN = {')[0] || '';
  const en = body.split('const EN = {')[1] || '';
  const z = (zh.match(/voice[A-Za-z]+:/g) || []).length;
  const e = (en.match(/voice[A-Za-z]+:/g) || []).length;
  assert.ok(z >= 40, 'ZH voice 键不足 40（实际 ' + z + '）');
  assert.equal(z, e, 'ZH/EN voice 键不平衡: ' + z + ' vs ' + e);
});
