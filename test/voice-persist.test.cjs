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
  const s = await asr.status({
    asr: { engine: 'cloud', cloud: { baseUrl: 'b', apiKey: 'k', model: 'm' } },
    refine: { enabled: true, baseUrl: 'r', apiKey: 'k', model: 'm' },
  });
  assert.equal(s.ok, true);
  assert.equal(s.asr.cloud.configured, true);
  assert.equal(s.refine.configured, true);
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
test('VOICE-P12 i18n voice 键 ZH/EN 平衡（31 键成对）', () => {
  const i18n = readFileSync(join(__dirname, '..', 'src', 'client', 'i18n.js'), 'utf8');
  const m = i18n.match(/module\.exports = \"([\s\S]*)\"\s*;?\s*$/);
  const body = m ? m[1] : i18n;
  const zh = body.split('const EN = {')[0] || '';
  const en = body.split('const EN = {')[1] || '';
  const z = (zh.match(/voice[A-Za-z]+:/g) || []).length;
  const e = (en.match(/voice[A-Za-z]+:/g) || []).length;
  assert.ok(z >= 31, 'ZH voice 键不足 31（实际 ' + z + '）');
  assert.equal(z, e, 'ZH/EN voice 键不平衡: ' + z + ' vs ' + e);
});
