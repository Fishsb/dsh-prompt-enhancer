// voice 语音识别模块契约测试（v3.2.5 · P1）
// 覆盖：① voice/* RPC schema 校验行为（lib/rpc-schema.cjs）
//       ② rpc-schema 单一事实源 = lib/rpc-schema.cjs（P1b 2026-09-19：死层副本已删，不得复活）
//       ③ lib/index.cjs 注册 voice/status·voice/transcribe（防重构删除无感）
//       ④ lib/client.cjs 产物含 voice 逻辑（构建注入防漂移）+ vendor RecordRTC 注入
//       ⑤ lib/asr.cjs sanitizeVoiceCfg 行为 + transcribe 空配置/错误路径
//       ⑥ i18n ZH/EN voice 键平衡（31 键成对防漏）
const { readFileSync, existsSync } = require('node:fs');
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

// ---- 2. rpc-schema 单一事实源（P1b：双份同步已终结）----
test('VOICE-P05 rpc-schema 单一事实源：lib 副本含 voice/*，死层副本不得复活', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'rpc-schema.cjs'), 'utf8');
  assert.ok(src.includes("'voice/status'"), 'lib/rpc-schema.cjs 缺 voice/status');
  assert.ok(src.includes("'voice/transcribe'"), 'lib/rpc-schema.cjs 缺 voice/transcribe');
  assert.ok(src.includes('required: [\'audioBase64\']'), 'voice/transcribe 缺 required');
  assert.equal(
    JSON.stringify(libSchema.schemas['voice/status']),
    JSON.stringify(require('../lib/rpc-schema.cjs').schemas['voice/status']),
    'voice/status 自洽'
  );
  assert.ok(!existsSync(join(__dirname, '..', 'src', 'host', 'rpc-schema.js')),
    '死层副本 src/host/rpc-schema.js 复活了——双架构不得回归（P1b）');
});

// ---- 3. lib/index.cjs 注册 ----
// P2-3（2026-10-13 拆分批）：源码锚**重锚**（voice 域实现移至 lib/rpc-voice.cjs；
//   asr require 与 merge 语义分别落在 rpc-voice.cjs / rpc-config.cjs），**断言一条不减**
//   —— 仍是 4 条（两条 harness.handle + asr require + merge 语义）；另加 1 条入口接线断言。
test('VOICE-P06 voice/status·voice/transcribe RPC 注册（P2-3：域 = lib/rpc-voice.cjs，入口须接线）', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'rpc-voice.cjs'), 'utf8');
  assert.ok(src.includes("harness.handle('voice/status'"), '未注册 voice/status');
  assert.ok(src.includes("harness.handle('voice/transcribe'"), '未注册 voice/transcribe');
  const cfg = readFileSync(join(__dirname, '..', 'lib', 'rpc-config.cjs'), 'utf8');
  // config/set merge 语义（多写入方）—— 随域移至 rpc-config.cjs
  assert.ok(cfg.includes('顶层键级 merge'), 'config/set 未升级 merge 语义');
  const entry = readFileSync(join(__dirname, '..', 'lib', 'index.cjs'), 'utf8');
  assert.ok(entry.includes("require('./asr.cjs')"), '入口未 require asr.cjs');
  assert.ok(entry.includes("require('./rpc-voice.cjs')"), '入口未接线 rpc-voice.cjs（拆分后成为孤儿模块）');
});

// ---- 4. client 产物注入 ----
// P2-补做（2026-10-13 · UD-0016）：热键改走官方按钮路径 ⇒ 判据面随退役更新（**强度不变**）：
// 产物须含**派发点击官方按钮**的接线与热键纯函数，且**不得**再含自建采集链。
test('VOICE-P07 lib/client.cjs 产物含语音逻辑（P2：热键派发点击官方按钮）', () => {
  const client = readFileSync(join(__dirname, '..', 'lib', 'client.cjs'), 'utf8'); // 唯一 client 载体
  assert.ok(client.includes('VoiceHotkeyHost'), '产物缺热键通道组件');
  assert.ok(client.includes('VoiceSection'), '产物缺 VoiceSection');
  assert.ok(client.includes('startOfficial'), '产物缺「派发点击官方开始按钮」（本批形态变更的落点）');
  assert.ok(client.includes('stopOfficial'), '产物缺「派发点击官方停止按钮」');
  assert.ok(client.includes('isEnhancing'), '产物缺 isEnhancing');
  assert.ok(!client.includes('function RecordRTC'), 'RecordRTC vendor 应已退役（P1-a）');
  // 自建采集链退役（UD-0016）：产物不得再含自建录音入口与自行转写**调用**
  // （⚠ 看调用形态，不看裸串：hotkey.js 的退役说明注释里会提到该 RPC 名，那是允许的）
  assert.equal(client.includes('startVoiceRecording'), false, '产物不得再含自建录音入口');
  assert.equal(client.includes("host.call('voice/transcribe'"), false, '产物不得再含自行调 voice/transcribe 的调用点');
  assert.equal(client.includes('stopVoiceRecording'), false, '产物不得再含自建停止入口');
});

test('VOICE-P08 client 产物含 voice 状态机与热键可见失败面', () => {
  const client = readFileSync(join(__dirname, '..', 'lib', 'client.cjs'), 'utf8'); // P1a：唯一 client 载体
  assert.ok(client.includes("'voicePendingEnhance'") || client.includes('voicePendingEnhance'), '产物缺 pending 暂存文案引用');
  // P2（UD-0016）：热键改为驱动官方链 ⇒ 双暂存逻辑随自建链退役；判据换成**可见失败面**（不得静默失败）
  assert.ok(client.includes('VOICE_BUSY'), '产物缺「录音中」忙提示');
  assert.ok(client.includes('VOICE_OFFICIAL_UNAVAILABLE'), '产物缺「官方按钮不可用」提示（不得静默失败）');
  assert.ok(client.includes('endedInFeedback'), '产物缺官方失败出口判定（TASK §3.3 缺口修复）');
});

// ---- 5. lib/asr.cjs sanitize ----
// P1-a（2026-10-13 缩批）：asr.cloud / asr.local 面随「识别交官方」退役 ⇒ 本判据改判
// **仍存的四项增值配置面**（refine/vad/hotkey/autoEnhance）的白名单净化，判据强度不变（仍逐项严格等号）。
test('VOICE-P09 sanitizeVoiceCfg 白名单净化（四项增值配置面）', () => {
  const clean = asr.sanitizeVoiceCfg({
    refine: { enabled: 'yes', maxTokens: 99999, mode: 'bogus', baseUrl: 'https://a.com/' },
    vad: { enabled: 'x' },
    hotkey: { enabled: 'x', combo: 123 },
    autoEnhance: 'x',
  });
  assert.equal(clean.refine.enabled, false);   // 非 boolean 回退
  assert.equal(clean.refine.maxTokens, 300);   // 越界回退默认
  assert.equal(clean.refine.mode, 'chain');    // 非法 mode 回退 chain
  assert.equal(clean.refine.baseUrl, 'https://a.com'); // 去尾斜杠
  assert.equal(clean.vad.enabled, true);       // 非 false 即 true
  assert.equal(clean.hotkey.enabled, false);   // 非 true 即 false
  assert.equal(clean.hotkey.combo, '');        // 非字符串回退空串
  assert.equal(clean.autoEnhance, false);      // 非 true 即 false
  // P1-a：asr.cloud / asr.local 已退役 —— 净化结果不得再出现这两段
  assert.equal(clean.asr, undefined, 'asr.cloud/local 面应已退役');
});

// P1-a（2026-10-13 缩批）：status 改**委托官方 `ctx.speechToText.snapshot()`** ⇒ 本判据改判
// 「委托面 + refine 就绪态」；判据强度不变（仍逐项严格等号 + 结构断言）。
// ⚠ 测试环境未注入 speechToText ⇒ speech.available=false 且带 SPEECH_SERVICE_UNAVAILABLE
//   （这正是「取不到服务时不 park、而是显式降级」的判据）。
test('VOICE-P10 status 组装：委托官方 speechToText + refine configured 判定', async () => {
  // refine 默认 chain 模式：已选基座模型（provider/model）→ configured=true（v3.2.8）
  const s = await asr.status({ refine: { enabled: true, provider: 'ollama', model: 'qwen2.5:1.5b' } });
  assert.equal(s.ok, true);
  assert.equal(s.refine.configured, true, 'chain 模式 + 已选模型 → 就绪');
  // custom 模式：独立三项完整 → configured
  const s2 = await asr.status({ refine: { enabled: true, mode: 'custom', baseUrl: 'r', apiKey: 'k', model: 'm' } });
  assert.equal(s2.refine.configured, true, 'custom 模式独立三项 → 就绪');
  // 委托面结构（未注入服务 ⇒ available=false + 明确 error；注入后 providers/selection 来自官方 snapshot）
  assert.equal(typeof s.speech.available, 'boolean');
  assert.ok(Array.isArray(s.speech.providers), 'providers 须为数组');
  assert.equal(s.speech.available, false, '测试环境未注入 speechToText ⇒ available=false');
  assert.equal(s.speech.error, 'SPEECH_SERVICE_UNAVAILABLE', '须显式降级而非静默');
});

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
test('VOICE-P14 sanitizeVoiceCfg vad 字段：默认开启，显式 false 关闭', () => {
  const d = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' } });
  assert.equal(d.vad.enabled, true, 'vad 默认开启');
  const off = asr.sanitizeVoiceCfg({ asr: { engine: 'cloud' }, vad: { enabled: false } });
  assert.equal(off.vad.enabled, false, '显式 false 关闭');
});

// ---- 9. 多语言（2026-08-20 P3）：sanitize local.language 白名单 ----
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
  const client = readFileSync(join(__dirname, '..', 'lib', 'client.cjs'), 'utf8'); // P1a：唯一 client 载体
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

// P1-a（2026-10-13 缩批）：自动增强触发链路自 mic-button.js **搬入 hotkey.js 的 VoiceHotkeyHost**；
// 判据强度不变（仍逐项断言「产物含该链路」），只把断言点换成现行实现位置。
test('VOICE-P24 产物含 autoEnhance 触发链路 + i18n 键平衡（v3.2.17 +3 键 → 40）', () => {
  const client = readFileSync(join(__dirname, '..', 'lib', 'client.cjs'), 'utf8'); // 唯一 client 载体
  assert.ok(client.includes('autoEnhance'), '产物缺 autoEnhance 配置字段');
  assert.ok(client.includes('voiceAutoEnhanceOn'), '产物缺自动增强开 i18n 引用');
  assert.ok(client.includes('voiceAutoEnhanceOff'), '产物缺自动增强关 i18n 引用');
  assert.ok(client.includes('voiceAutoEnhanceTip'), '产物缺自动增强提示 i18n 引用');
  // 触发链路（P2 · UD-0016：现位于 VoiceHotkeyHost 的**官方路径**出口）：官方写回落地后按 autoEnhance 调用 enhance
  assert.ok(client.includes('VoiceHotkeyHost'), '产物缺热键通道组件（承载自动增强触发）');
  assert.ok(client.includes('autoEnhance === true'), '产物缺 autoEnhance 触发判定');
  assert.ok(client.includes("typeof enhance !== 'function'"), '产物缺 enhance 可用性守卫（自动触发调用）');
  assert.ok(client.includes('endedInFeedback'), '产物缺官方失败出口判定（失败时不得进入等写回）');
  // i18n 键平衡（P2：+4 键 → 44）
  const i18n = readFileSync(join(__dirname, '..', 'src', 'client', 'i18n.js'), 'utf8');
  const m = i18n.match(/module\.exports = \"([\s\S]*)\"\s*;?\s*$/);
  const body = m ? m[1] : i18n;
  const zh = body.split('const EN = {')[0] || '';
  const en = body.split('const EN = {')[1] || '';
  const z = (zh.match(/voice[A-Za-z]+:/g) || []).length;
  const e = (en.match(/voice[A-Za-z]+:/g) || []).length;
  assert.ok(z >= 44, 'ZH voice 键不足 44（实际 ' + z + '）');
  assert.equal(z, e, 'ZH/EN voice 键不平衡: ' + z + ' vs ' + e);
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHG-103（2026-10-15 · `G-5` 修复）：语音配置**模块级启动同步**
// ═══════════════════════════════════════════════════════════════════════════════
// 病历：`syncVoiceFromHost()` 此前**只在设置页 VoiceSection 挂载时**被调用
//   （`voice-section.js` 的 useEffect 是唯一调用点）⇒ **新 origin / 未进设置页**的会话里
//   `voiceCfgState` 始终是默认值（`hotkey: { enabled: false }`）⇒ 而 `VoiceHotkeyHost` 挂在
//   `conversation.input.right`（与设置页无关）按它决定装不装监听 ⇒ **热键静默失效**。
// 对照：增强模块 `src/client/state.js:366` **有**模块级 `syncConfigFromHost();`（两模块不对称）。
// 判据形态：
//   G5-01 模块级求值（**未进设置页**）⇒ 磁盘 hotkey.enabled=true 必须已同步进 voiceCfgState
//   G5-02 ⚠ **判别力**：磁盘 hotkey.enabled=**false** ⇒ 同步完成但值仍为 false
//         （用来区分「**配置未同步**」与「**配置同步了但开关本身是关的**」—— 二者若不区分即假锁）
//   G5-03 并发去重：模块级 + 设置页同时同步 ⇒ 只发 1 次 config/get（幂等·不互相覆盖）
//   G5-04 变异自证：删掉模块级调用 ⇒ G5-01 必红
//   G5-05 负控：设置页路径（显式调用）行为不变；已关的开关仍不得生效
//
// ⚠ 判别力说明（D-14 假锁病历）：只测 G5-01 是不够的 —— 若把「同步没发生」与
//   「同步发生了但磁盘上开关本来就是关的」混为一谈，则**变异版也会绿**。
//   故 G5-02 专门构造 enabled=false 的磁盘配置：修复版与变异版都必须得到 false，
//   但**理由不同**（前者=同步了且为关；后者=根本没同步）⇒ 与 G5-01 并读才能定位。

// 在沙箱里求值真实 state.js，host 返回给定的磁盘配置
function evalStateWithDisk(diskConfig, opts) {
  const o = opts || {};
  let src = require('../src/client/voice/state.js');
  if (o.dropModuleSync) {
    const anchor = '\nsyncVoiceFromHost();\n';
    if (!src.includes(anchor)) throw new Error('变异锚点须存在（模块级同步调用）');
    src = src.replace(anchor, '\n');
  }
  const lsBacking = new Map();
  const localStorage = {
    getItem: (k) => (lsBacking.has(k) ? lsBacking.get(k) : null),
    setItem: (k, v) => lsBacking.set(k, String(v)),
    removeItem: (k) => lsBacking.delete(k),
  };
  let calls = 0;
  const host = { call: () => { calls += 1; return Promise.resolve({ ok: true, config: diskConfig }); } };
  const fn = new Function('localStorage', 'host',
    src + '\nreturn { voiceCfgState, syncVoiceFromHost, mergeVoice };');
  return { api: fn(localStorage, host), lsBacking, calls: () => calls };
}

const settleAsync = () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));

test('VOICE-G5-01 模块级启动同步：**未进设置页**，磁盘 hotkey.enabled=true 也必须已同步', async () => {
  const disk = { version: 2, voice: { refine: { enabled: false }, vad: { enabled: true, silenceMs: 2000 }, hotkey: { enabled: true, combo: 'Alt+Backquote' }, autoEnhance: false } };
  const S = evalStateWithDisk(disk);
  await settleAsync();
  assert.equal(S.api.voiceCfgState.value.hotkey.enabled, true,
    '⚠ G-5：模块级求值（= 新 origin / 未进设置页）后磁盘 hotkey 必须已同步（旧实现此处为 false ⇒ 热键静默失效）');
  assert.equal(S.api.voiceCfgState.value.hotkey.combo, 'Alt+Backquote', '组合键同样须同步');
  assert.equal(S.api.voiceCfgState.synced, true, '同步须完成（synced 置真）');
  assert.equal(S.calls(), 1, '模块级须恰好发起 1 次 config/get');
});

test('VOICE-G5-02 判别力·配置同步了但开关本身是关的 ⇒ 必须仍为 false（不得与"未同步"混淆）', async () => {
  // ⚠ 该组是判别力的另一半：磁盘明确 hotkey.enabled=false。
  //   修复版：同步**发生了**（synced=true、发过 config/get）但值仍 false；
  //   变异版：同步**没发生**（synced 仍 false）值也是 false ⇒
  //   故必须同时断言「同步确实发生过」，否则本条对变异无判别力。
  const disk = { version: 2, voice: { refine: { enabled: false }, vad: { enabled: true, silenceMs: 2000 }, hotkey: { enabled: false, combo: '' }, autoEnhance: false } };
  const S = evalStateWithDisk(disk);
  await settleAsync();
  assert.equal(S.api.voiceCfgState.value.hotkey.enabled, false, '已关的开关 ⇒ 同步后仍须为 false（不得被默认值/同步动作打开）');
  assert.equal(S.api.voiceCfgState.synced, true, '⚠ 判别力锚点：需证明"同步确实发生过"（不同于"根本没同步"）');
  assert.equal(S.calls(), 1, '⚠ 判别力锚点：须确实发过一次 config/get');
});

test('VOICE-G5-03 并发去重（幂等）：模块级与设置页同时同步 ⇒ 只发 1 次 config/get，互不覆盖', async () => {
  const disk = { version: 2, voice: { refine: { enabled: false }, vad: { enabled: true, silenceMs: 2000 }, hotkey: { enabled: true, combo: 'Alt+Backquote' }, autoEnhance: false } };
  const S = evalStateWithDisk(disk);
  // 模块级已在途 ⇒ 再并发调 2 次（模拟设置页挂载）
  const p1 = S.api.syncVoiceFromHost();
  const p2 = S.api.syncVoiceFromHost();
  assert.equal(S.calls(), 1, '⚠ 在途期间重复调用**不得**再发 config/get（否则双份配置源/竞态覆盖）');
  assert.equal(p1, p2, '在途调用须复用同一个 promise');
  await settleAsync();
  assert.equal(S.api.voiceCfgState.value.hotkey.enabled, true, '并发后结果一致（未被覆盖回默认）');
  // settle 之后：新调用应可再次同步（设置页兼容路径不被破坏）
  const before = S.calls();
  S.api.syncVoiceFromHost();
  assert.equal(S.calls(), before + 1, 'settle 之后新调用须发新请求（不得永久锁死）');
});

test('VOICE-G5-V01 变异自证·正例必红：删掉模块级同步调用 ⇒ G5-01 判据必须失败', async () => {
  const disk = { version: 2, voice: { refine: { enabled: false }, vad: { enabled: true, silenceMs: 2000 }, hotkey: { enabled: true, combo: 'Alt+Backquote' }, autoEnhance: false } };
  const M = evalStateWithDisk(disk, { dropModuleSync: true });
  await settleAsync();
  // 变异后：模块级同步不存在 ⇒ 仍是默认 false ⇒ G5-01 的断言必红
  assert.equal(M.api.voiceCfgState.value.hotkey.enabled, false,
    '⚠ 变异后必须回到"未同步=默认 false"（若此处仍为 true，说明 G5-01 没有判别力）');
  assert.equal(M.calls(), 0, '变异后模块级不得发起 config/get');
  assert.equal(M.api.voiceCfgState.synced, false, '变异后 synced 仍为 false ⇒ 与"同步了但开关关"可区分');
});

test('VOICE-G5-V02 变异自证·负控必绿：同一变异下，**显式**调用仍能同步（设置页路径不受影响）', async () => {
  const disk = { version: 2, voice: { refine: { enabled: false }, vad: { enabled: true, silenceMs: 2000 }, hotkey: { enabled: true, combo: 'Alt+Backquote' }, autoEnhance: false } };
  const M = evalStateWithDisk(disk, { dropModuleSync: true });
  await settleAsync();
  assert.equal(M.api.voiceCfgState.value.hotkey.enabled, false, '前置：模块级已移除 ⇒ 尚未同步');
  // 负控：设置页那种显式调用必须仍然有效（本批只加"时机"，不改既有能力）
  await M.api.syncVoiceFromHost();
  await settleAsync();
  assert.equal(M.api.voiceCfgState.value.hotkey.enabled, true, '负控：显式 syncVoiceFromHost() 仍须同步成功（设置页路径未变）');
  assert.equal(M.api.voiceCfgState.synced, true, '负控：显式调用后 synced 置真');
});
