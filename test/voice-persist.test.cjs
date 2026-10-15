// voice 语音识别模块契约测试（v3.2.5 · P1）
// 覆盖：① voice/* RPC schema 校验行为（lib/rpc-schema.cjs）
//       ② rpc-schema 单一事实源 = lib/rpc-schema.cjs（P1b 2026-09-19：死层副本已删，不得复活）
//       ③ lib/rpc-voice.cjs 注册 voice/status（CHG-117：voice/transcribe 已退役，防回流）
//       ④ lib/client.cjs 产物含 voice 逻辑（构建注入防漂移）+ vendor RecordRTC 注入
//       ⑤ lib/asr.cjs sanitizeVoiceCfg 行为（CHG-117：filler 面；transcribe 已退役）
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

// CHG-117（2026-10-16 · 规整改造批）：原 VOICE-P02/P03/P04 三条 **随 RPC 退役删除**
//   （判据对象 = `voice/transcribe` 的入参校验；该 RPC 自「自建采集链退役」后**已无调用方**，
//    `CHG-115` `I-1`；且其调官方 `transcribe()` 漏传 `AbortSignal` 必失败 `I-3` ⇒ 整条死链）。
//   ⚠ 取而代之是**更强**的锁：该 RPC **不得回流**（schema / 注册面 / 产物调用点 三面）。
//   ⚠ 这**不是**改浅：判据从"旧物的行为正确"升级为"旧物不许复活"。
test('VOICE-P02r voice/transcribe 已退役 ⇒ 三面均不得回流（CHG-117）', () => {
  assert.equal(libSchema.schemas['voice/transcribe'], undefined, 'schema 不得回流');
  const reg = readFileSync(join(__dirname, '..', 'lib', 'rpc-voice.cjs'), 'utf8');
  assert.ok(!reg.includes("harness.handle('voice/transcribe'"), 'RPC 注册面不得回流');
  const client = readFileSync(join(__dirname, '..', 'lib', 'client.cjs'), 'utf8');
  assert.equal(client.includes("host.call('voice/transcribe'"), false, '产物不得出现该调用点');
});

// ---- 2. rpc-schema 单一事实源（P1b：双份同步已终结）----
test('VOICE-P05 rpc-schema 单一事实源：lib 副本含 voice/*，死层副本不得复活', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'rpc-schema.cjs'), 'utf8');
  assert.ok(src.includes("'voice/status'"), 'lib/rpc-schema.cjs 缺 voice/status');
  // CHG-117：原两条「voice/transcribe 须存在 + 缺 required」断言**随 RPC 退役删除**
  //   （它们锁的是"旧物应存在"；现由 VOICE-P02r 的"不得回流"锁接替）。
  assert.ok(!src.includes("'voice/transcribe'"), 'CHG-117：voice/transcribe 的 schema 不得回流');
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
test('VOICE-P06 voice/status RPC 注册（CHG-117：voice/transcribe 已退役）+ 入口接线', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'rpc-voice.cjs'), 'utf8');
  assert.ok(src.includes("harness.handle('voice/status'"), '未注册 voice/status');
  // CHG-117：原「须注册 voice/transcribe」断言**随 RPC 退役删除**（同样的"旧物应存在"类）；
  //   判据强度由 VOICE-P02r 的"不得回流"锁承接，未削弱。
  assert.ok(!src.includes("harness.handle('voice/transcribe'"), 'CHG-117：voice/transcribe 注册面不得回流');
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
  // ⚠ CHG-117：该锁是"旧物不许复活"类（盘点 N-1）—— **必须保留**，不得因 RPC 删除而删。
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
  // CHG-117：`refine` 父键 → `filler`（只留 `enabled`；六子键全删）⇒ 本判据同步改名。
  const clean = asr.sanitizeVoiceCfg({
    filler: { enabled: false, mode: 'bogus', maxTokens: 99999 },   // 六子键应被丢弃
    vad: { enabled: 'x' },
    hotkey: { enabled: 'x', combo: 123 },
    autoEnhance: 'x',
  });
  assert.equal(clean.filler.enabled, false);   // 显式 false 保留
  assert.equal(clean.filler.mode, undefined, 'CHG-117：mode 子键已删，不得回流');
  assert.equal(clean.filler.maxTokens, undefined, 'CHG-117：maxTokens 子键已删，不得回流');
  assert.equal(clean.filler.apiKey, undefined, 'CHG-117：apiKey 子键已删（不可逆，用户授权）');
  assert.equal(clean.refine, undefined, 'CHG-117：旧父键 refine 不得回流');
  assert.equal(clean.vad.enabled, true);       // 非 false 即 true
  assert.equal(clean.hotkey.enabled, false);   // 非 true 即 false
  assert.equal(clean.hotkey.combo, '');        // 非字符串回退空串
  assert.equal(clean.autoEnhance, false);      // 非 true 即 false
  // 缺省（未给 filler）⇒ 默认 **开**（用户裁定 4；与 client 侧 `mergeVoice` 同形）
  assert.equal(asr.sanitizeVoiceCfg({}).filler.enabled, true, '缺省应为开');
  // P1-a：asr.cloud / asr.local 已退役 —— 净化结果不得再出现这两段
  assert.equal(clean.asr, undefined, 'asr.cloud/local 面应已退役');
});

// P1-a（2026-10-13 缩批）：status 改**委托官方 `ctx.speechToText.snapshot()`** ⇒ 本判据改判
// 「委托面 + refine 就绪态」；判据强度不变（仍逐项严格等号 + 结构断言）。
// ⚠ 测试环境未注入 speechToText ⇒ speech.available=false 且带 SPEECH_SERVICE_UNAVAILABLE
//   （这正是「取不到服务时不 park、而是显式降级」的判据）。
test('VOICE-P10 status 组装：委托官方 speechToText + filler configured 判定', async () => {
  // CHG-117：`filler` 无模型/凭据 ⇒ 「就绪」= **开关是否开**（语义收窄，仍逐项严格等号）
  const s = await asr.status({ filler: { enabled: true } });
  assert.equal(s.ok, true);
  assert.equal(s.filler.configured, true, '开关开 → 就绪');
  const s2 = await asr.status({ filler: { enabled: false } });
  assert.equal(s2.filler.configured, false, '开关关 → 未就绪');
  assert.equal(s2.refine, undefined, 'CHG-117：旧父键 refine 不得回流');
  // 缺省（未给 filler）⇒ 默认开 ⇒ 就绪
  assert.equal((await asr.status({})).filler.configured, true, '缺省（默认开）→ 就绪');
  // 委托面结构（未注入服务 ⇒ available=false + 明确 error；注入后 providers/selection 来自官方 snapshot）
  assert.equal(typeof s.speech.available, 'boolean');
  assert.ok(Array.isArray(s.speech.providers), 'providers 须为数组');
  assert.equal(s.speech.available, false, '测试环境未注入 speechToText ⇒ available=false');
  assert.equal(s.speech.error, 'SPEECH_SERVICE_UNAVAILABLE', '须显式降级而非静默');
});

// CHG-117：`>= 37` 为**下界**锁；实测 87 键仍满足（refine→filler 改名 + 移除 3 键未触及下界）
test('VOICE-P12 i18n voice 键 ZH/EN 平衡（>=37 键成对，v3.2.9 快捷键 +6）', () => {
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
// CHG-117（2026-10-16）：原 `VOICE-P18 refine chain 模式（基座模型 + llm 调用 + 降级）`
//   **随 `refineText` 实现删除**一并删除 —— 判据对象（被删函数）已不存在。
//   ⚠ 这不是"判据变松"：该能力**整体退役**（不调模型）；取而代之的判据在
//     `test/filler.test.cjs`（清口水词的规则行为 + 误删防护 + 变异自证 + 负控）。
//   ⚠ 若将来需要"清口水词"的等价强度判据，应在 filler 测试面补齐（不在本文件复活旧对象）。
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
  // ⚠ CHG-117：`host.call` 现在会收到**两种**方法（`config/get` 同步 + `config/set` 旧键清理）
  //   ⇒ 计数必须**按方法分开**，否则判据名说"config/get 次数"而实测把 set 也算进来（读数说反话）。
  //   ⚠ 这是**加固**（方法级），不是放宽：原本的"总次数"语义被替换成更精确的同名判据。
  let calls = 0;      // config/get 次数（判据名要求的那个）
  let setCalls = 0;   // config/set 次数（旧键清理）
  const host = { call: (m) => {
    if (m === 'config/set') { setCalls += 1; return Promise.resolve({ ok: true }); }
    calls += 1;
    return Promise.resolve({ ok: true, config: diskConfig });
  } };
  const fn = new Function('localStorage', 'host',
    src + '\nreturn { voiceCfgState, syncVoiceFromHost, mergeVoice };');
  return { api: fn(localStorage, host), lsBacking, calls: () => calls, setCalls: () => setCalls };
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
  assert.equal(S.calls(), 1, '模块级须恰好发起 1 次 config/get（⚠ 按方法计：config/set 与旧键清理不计入）');
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
  assert.equal(S.calls(), 1, '⚠ 判别力锚点：须确实发过一次 config/get（按方法计）');
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

// ═══════════════════════════════════════════════════════════════════════════════
// CHG-104（2026-10-15 · `G-6` 修复）：语音配置同步的**有界重试**
// ═══════════════════════════════════════════════════════════════════════════════
// 由来：`G-5` 建的模块级同步**无重试** ⇒ 若页面加载早于宿主就绪，首次同步失败后
//   配置整页保持默认 ⇒ 热键静默失效，**表象与 `G-5` 完全相同**（现场验收假阴性）。
// 对齐：增强模块 `syncConfigFromHost()`（`src/client/state.js:307-308/313-353`）自带
//   有界重试 —— `HOST_SYNC_MAX_ATTEMPTS = 10` / `HOST_SYNC_RETRY_MS = 2000`，
//   三条失败路径（host 不可用 `:326` / `!r.ok` `:329` / `.catch` `:352`）**均**进重试，
//   计数达上限（`:316`）则**终止**。本组断言语音侧**同款**行为。
// 判据：
//   G6-01 首次失败 → 重试成功 ⇒ **终态** synced=true 且目标字段生效（断言终态，不只看次数）
//   G6-02 重试**耗尽** ⇒ 有界终止：不再发起新请求，且 synced 置真（不得静默永远悬着）
//   G6-03 首次即成功 ⇒ **不得**多余请求（断言请求次数 === 1）
//   G6-V01 变异（重试退回只试一次）⇒ G6-01 **必红**
//   G6-V02 负控：同一变异下「首次即成功」路径行为不变
//
// ⚠ 判别力说明（D-14 假锁病历）：**必须能区分「重试起作用」与「本来就会成功」**。
//   若 host 从未失败，重试代码根本不执行 ⇒ 该组对重试的存在与否**无判别力**。
//   故 G6-01 让 host **真实失败若干次**（返回 !ok），再在后续尝试成功 ⇒
//   只有「确实重试了」才能得到 synced=true；变异版（只试一次）必然停在未同步。
//   计时器用**伪 timerSvc** 确定性驱动（不真等 2s）。

// 可注入 timerSvc 的沙箱（用于确定性驱动重试），host 按给定脚本逐次响应
function evalStateWithRetry(script, opts) {
  const o = opts || {};
  let src = require('../src/client/voice/state.js');
  if (o.dropRetry) {
    // 变异：把重试计数上限压成 1 ⇒ 等价于「只试一次」（不改判定逻辑，只改上限）
    src = src.replace('const VOICE_HOST_SYNC_MAX_ATTEMPTS = 10;', 'const VOICE_HOST_SYNC_MAX_ATTEMPTS = 1;');
  }
  const lsBacking = new Map();
  const localStorage = {
    getItem: (k) => (lsBacking.has(k) ? lsBacking.get(k) : null),
    setItem: (k, v) => lsBacking.set(k, String(v)),
    removeItem: (k) => lsBacking.delete(k),
  };
  // ⚠ CHG-117：同 evalStateWithDisk —— 按方法分离计数（get 计 retry 步进；set 计旧键清理）
  const out = { calls: 0, setCalls: 0, pending: [], fired: 0 };
  const host = {
    call: (m) => {
      if (m === 'config/set') { out.setCalls += 1; return Promise.resolve({ ok: true }); }
      out.calls += 1;
      const step = script[Math.min(out.calls - 1, script.length - 1)];
      if (step === 'throw') return Promise.reject(new Error('boom'));
      if (step === 'ok') return Promise.resolve({ ok: true, config: { version: 2, voice: { hotkey: { enabled: true, combo: 'Alt+Backquote' }, vad: { enabled: true }, autoEnhance: false, refine: { enabled: false } } } });
      return Promise.resolve({ ok: false });   // 'fail'
    },
  };
  // 伪 timerSvc：收集，由用例显式驱动（确定性，不真等）
  const timerSvc = {
    timeout: (fn) => { out.pending.push(fn); return out.pending.length; },
    interval: (fn) => { out.pending.push(fn); return out.pending.length; },
  };
  const fn = new Function('localStorage', 'host', 'timerSvc',
    src + '\nreturn { voiceCfgState, syncVoiceFromHost };');
  const api = fn(localStorage, host, timerSvc);
  return { api, out, lsBacking };
}

const settle3 = () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r))).then(() => new Promise((r) => setImmediate(r)));

test('VOICE-G6-01 首次失败 → 重试成功 ⇒ 配置**最终生效**（断言终态）', async () => {
  // 判别力：host 前 2 次返回 !ok（真实失败），第 3 次成功。
  //   只有「确实重试了」才能到 ok ⇒ 终态 synced=true 且 hotkey 生效。
  const S = evalStateWithRetry(['fail', 'fail', 'ok']);
  await settle3();
  assert.equal(S.out.calls, 1, '首次只发 1 次请求（随后应安排重试）');
  assert.equal(S.api.voiceCfgState.synced, false, '前置：首次失败 ⇒ 尚未同步');
  assert.equal(S.out.pending.length, 1, '首次失败 ⇒ 必须**安排**一次重试（旧实现此处为 0）');
  // 驱动重试（每次重试间隔由伪 timerSvc 收集，逐次触发）
  S.out.pending.shift()(); await settle3();
  assert.equal(S.out.calls, 2, '第 2 次尝试已发起');
  assert.equal(S.api.voiceCfgState.value.hotkey.enabled, false, '第 2 次仍失败 ⇒ 仍未生效');
  S.out.pending.shift()(); await settle3();
  assert.equal(S.out.calls, 3, '第 3 次尝试已发起（重试确实在起作用）');
  // ⭐ 终态断言
  assert.equal(S.api.voiceCfgState.synced, true, '重试成功后 synced 必须为真（终态）');
  assert.equal(S.api.voiceCfgState.value.hotkey.enabled, true, '⚠ 终态：配置必须**最终生效**（hotkey 已启用）');
  assert.equal(S.out.pending.length, 0, '成功后不得再安排重试');
});

test('VOICE-G6-02 重试**耗尽** ⇒ 有界终止（不再发新请求，且不得静默永远悬着）', async () => {
  const S = evalStateWithRetry(['fail'], { });   // 永远失败
  await settle3();
  let guard = 0;
  while (S.out.pending.length > 0 && guard < 50) { S.out.pending.shift()(); await settle3(); guard += 1; }
  assert.ok(guard < 50, '⚠ 必须在有限步内终止（不得无限重试）');
  // 语音侧上限 = 增强模块同款 10
  assert.equal(S.out.calls, 10, '⚠ 请求次数须恰好等于既有实现的 HOST_SYNC_MAX_ATTEMPTS(=10)，不得自设阈值');
  assert.equal(S.out.pending.length, 0, '耗尽后不得再安排任何重试');
  assert.equal(S.api.voiceCfgState.synced, true, '⚠ 终止态必须可见（synced 置真）—— 不得静默永远悬着');
  // 再等也给不出新请求
  await settle3();
  assert.equal(S.out.calls, 10, '终止后不得再发起新请求');
});

test('VOICE-G6-03 首次即成功 ⇒ **不得**产生多余请求（断言请求次数）', async () => {
  const S = evalStateWithRetry(['ok']);
  await settle3();
  assert.equal(S.out.calls, 1, '⚠ 首次成功 ⇒ 恰好 1 次请求（多 1 次即属多余的重复同步）');
  assert.equal(S.out.pending.length, 0, '首次成功 ⇒ 不得安排任何重试定时器');
  assert.equal(S.api.voiceCfgState.synced, true, '首次成功 ⇒ 立即 synced');
  assert.equal(S.api.voiceCfgState.value.hotkey.enabled, true, '首次成功 ⇒ 配置立即生效');
});

test('VOICE-G6-V01 变异自证·正例必红：重试上限退回 1（只试一次）⇒ G6-01 判据必须失败', async () => {
  const S = evalStateWithRetry(['fail', 'fail', 'ok'], { dropRetry: true });
  await settle3();
  let guard = 0;
  while (S.out.pending.length > 0 && guard < 50) { S.out.pending.shift()(); await settle3(); guard += 1; }
  // 变异后：不重试 ⇒ 永远停在未同步 ⇒ G6-01 的终态断言必红
  assert.equal(S.api.voiceCfgState.value.hotkey.enabled, false,
    '⚠ 变异后必须停在"未同步"（若此处为 true ⇒ G6-01 没有判别力）');
  assert.equal(S.out.calls, 1, '变异后只应发 1 次请求（= 只试一次）');
});

test('VOICE-G6-V02 变异自证·负控必绿：同一变异下「首次即成功」路径**行为不得改变**', async () => {
  const S = evalStateWithRetry(['ok'], { dropRetry: true });
  await settle3();
  assert.equal(S.out.calls, 1, '负控：首次成功仍恰好 1 次请求');
  assert.equal(S.api.voiceCfgState.synced, true, '负控：首次成功仍 synced');
  assert.equal(S.api.voiceCfgState.value.hotkey.enabled, true, '负控：首次成功仍生效（与重试无关）');
  assert.equal(S.out.pending.length, 0, '负控：首次成功不得安排重试');
});

test('VOICE-G6-V03 负控：已关的开关在重试路径下**仍不得生效**（未改任何开关语义）', async () => {
  // 磁盘明确 hotkey.enabled=false；首次失败、重试成功 ⇒ 终态仍须为 false
  const lsBacking = new Map();
  const localStorage = { getItem: (k) => (lsBacking.has(k) ? lsBacking.get(k) : null), setItem: (k, v) => lsBacking.set(k, String(v)), removeItem: (k) => lsBacking.delete(k) };
  const pending = []; let calls = 0; let setCalls = 0;
  // ⚠ CHG-117：按方法分离计数（`config/get` 走重试步进；`config/set` 是旧键清理，不计入重试步进）
  const host = { call: (m) => {
    if (m === 'config/set') { setCalls += 1; return Promise.resolve({ ok: true }); }
    calls += 1;
    return calls === 1 ? Promise.resolve({ ok: false })
      : Promise.resolve({ ok: true, config: { version: 2, voice: { hotkey: { enabled: false, combo: '' }, vad: { enabled: true }, autoEnhance: false, refine: { enabled: false } } } });
  } };
  const timerSvc = { timeout: (fn) => { pending.push(fn); return 1; }, interval: (fn) => { pending.push(fn); return 1; } };
  const src = require('../src/client/voice/state.js');
  const api = new Function('localStorage', 'host', 'timerSvc', src + '\nreturn { voiceCfgState };')(localStorage, host, timerSvc);
  await settle3();
  pending.shift()(); await settle3();
  assert.equal(calls, 2, '前置：确实重试了一次（config/get，按方法计）');
  assert.equal(setCalls, 1, 'CHG-117：旧父键清理恰好写回 1 次 config/set（幂等：只清一次）');
  assert.equal(api.voiceCfgState.synced, true, '前置：重试已成功');
  assert.equal(api.voiceCfgState.value.hotkey.enabled, false, '负控：已关的开关 ⇒ 重试成功也仍须为 false');
});
