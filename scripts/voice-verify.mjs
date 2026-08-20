#!/usr/bin/env node
// scripts/voice-verify.mjs —— 语音模块真实环境一键验证（AGENTS.md §6.2 L3/L4/L5）
// 用法：
//   node scripts/voice-verify.mjs             # 主验证（语法/worker/识别冒烟/SYSTEM 上下文 modelOpenDir）
//   node scripts/voice-verify.mjs --sys-test  # SYSTEM 上下文自验证（由 schtasks /ru SYSTEM 调用，勿手动跑）
// 背景：2026-08-20 用户规则「不得只靠单测+用户重启自测」——本脚本固化真实环境验证手段：
//   - worker 健康/模型就绪（worker.port 动态端口）
//   - 正弦波识别冒烟（真实链路 readWave→decode→getResult）
//   - SYSTEM 上下文 modelOpenDir（schtasks /ru SYSTEM 完整复现服务模式，含 ps1 自删痕迹）

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const RESULTS = [];
const asrHome = () =>
  process.env.DSH_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.dsh');
const asrDir = () => path.join(asrHome(), 'dsh-prompt-enhancer-asr');
// 注意：必须用函数动态计算——SYSTEM 上下文（--sys-test）注入 USERPROFILE 前，
// 顶层 const 会在 import 时缓存 systemprofile 路径导致写入错位（2026-08-20 实测坑）
const sysResultFile = () => path.join(asrDir(), '.voice-verify-sys.json');
const sysPsFile = () => path.join(asrDir(), '.tmp-open-models.ps1');

function check(name, ok, detail) {
  RESULTS.push({ name, ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

function run(cmd, args, opts) {
  return spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 15000 }, opts || {}));
}

// 生成 1s 440Hz 正弦波 wav（16k mono 16bit）——免第三方库
function sineWavDataUrl(seconds) {
  const sr = 16000;
  const n = sr * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sr));
    data.writeInt16LE(v, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return 'data:audio/wav;base64,' + Buffer.concat([header, data]).toString('base64');
}

// worker 端口读取
function workerPort() {
  try {
    const f = path.join(asrDir(), 'worker.port');
    if (fs.existsSync(f)) {
      const o = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (o && o.port) return o.port;
    }
  } catch (e) { /* ignore */ }
  return 3082;
}

// node 原生 http 请求（不用 curl——curl -d 按 form 编码会把 base64 的 '+' 转空格，破坏 wav）
function httpReq(port, method, p, body) {
  return new Promise((resolve) => {
    const http = require('node:http');
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: p,
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }); }
        catch (e) { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null }); });
    req.on('error', () => resolve({ status: 0, json: null }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function httpGet(port, p) { return httpReq(port, 'GET', p); }
async function httpPost(port, p, body) { return httpReq(port, 'POST', p, body); }

// ============ SYSTEM 上下文自验证（--sys-test，由 schtasks /ru SYSTEM 调用） ============
function sysTest() {
  // 模拟 nssm 服务环境：USERPROFILE 由主流程经 --sys-user 传入并强制注入
  // （SYSTEM 任务的 USERPROFILE 默认为 systemprofile，`||` 不会覆盖——必须显式设置）
  const ui = process.argv.indexOf('--sys-user');
  if (ui > -1 && process.argv[ui + 1]) {
    process.env.USERPROFILE = process.argv[ui + 1];
    process.env.HOME = process.argv[ui + 1];
  }
  const out = { ts: Date.now(), steps: [] };
  try {
    const am = require(path.join(repoRoot, 'lib', 'asr-models.cjs'));
    const r = am.modelOpenDir();
    out.steps.push({ name: 'modelOpenDir', ok: r.ok === true, detail: JSON.stringify(r) });
    // 等任务执行完（ps1 打开 explorer + 自删），检查自删痕迹
    setTimeout(() => {
      out.steps.push({ name: 'ps1SelfDeleted', ok: !fs.existsSync(sysPsFile()), detail: sysPsFile() });
      fs.writeFileSync(sysResultFile(), JSON.stringify(out), 'utf8');
      process.exit(0);
    }, 4000);
  } catch (e) {
    out.steps.push({ name: 'exception', ok: false, detail: String((e && e.message) || e) });
    try { fs.writeFileSync(sysResultFile(), JSON.stringify(out), 'utf8'); } catch (e2) { /* ignore */ }
    process.exit(1);
  }
}

// ============ 主验证流程 ============
async function main() {
  console.log('== voice-verify: 语音模块真实环境验证 ==');
  console.log('时间: ' + new Date().toLocaleString());

  // 1. 语法
  const syn = run(process.execPath, ['--check', path.join(repoRoot, 'lib', 'asr.cjs')]);
  const synW = run(process.execPath, ['--check', path.join(repoRoot, 'lib', 'asr-worker.cjs')]);
  const synM = run(process.execPath, ['--check', path.join(repoRoot, 'lib', 'asr-models.cjs')]);
  check('语法 lib/asr*.cjs', syn.status === 0 && synW.status === 0 && synM.status === 0,
    syn.stderr ? String(syn.stderr).slice(0, 120) : '');

  // 2. worker 健康（GET /health）+ 模型就绪（POST /rpc status）
  const port = workerPort();
  const health = await httpGet(port, '/health');
  check('worker health (port ' + port + ')', health.status === 200 && health.json && health.json.ok === true,
    health.json ? JSON.stringify(health.json).slice(0, 80) : 'worker 未响应 (status=' + health.status + ')');
  const st = await httpPost(port, '/rpc', { method: 'status' });
  check('worker 模型就绪 modelReady', !!st.json && st.json.ok === true && st.json.modelReady === true,
    st.json ? 'modelReady=' + st.json.modelReady + ' modelFile=' + st.json.modelFile : 'status 失败');

  // 3. 正弦波识别冒烟（真实链路：readWave→decode→getResult）
  const tr = await httpPost(port, '/rpc', { method: 'transcribe', args: { audioBase64: sineWavDataUrl(1) } });
  check('正弦波识别冒烟', !!tr.json && tr.json.ok === true && typeof tr.json.text === 'string',
    tr.json ? 'text=' + JSON.stringify(tr.json.text).slice(0, 40) : 'transcribe 失败 (status=' + tr.status + ')');

  // 4. SYSTEM 上下文 modelOpenDir（schtasks /ru SYSTEM 完整复现服务模式）
  try {
    fs.unlinkSync(sysResultFile());
  } catch (e) { /* ignore */ }
  const tn = 'voice-verify-sys';
  const selfScript = fileURLToPath(import.meta.url);
  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  // --sys-user 传给 SYSTEM 上下文：模拟 nssm 注入 USERPROFILE（SYSTEM 任务默认为 systemprofile）
  const trCmd = process.execPath + ' ' + selfScript + ' --sys-test --sys-user ' + userHome;
  const mk = run('schtasks', ['/create', '/tn', tn, '/tr', trCmd, '/sc', 'once', '/st', '00:00', '/ru', 'SYSTEM', '/f']);
  const okCreate = mk.status === 0;
  let sysOk = false;
  let sysDetail = '';
  if (okCreate) {
    run('schtasks', ['/run', '/tn', tn]);
    // 轮询结果文件（SYSTEM 任务启动 + 内部 schtasks 链 + ps1 执行约需 10-15s）
    for (let i = 0; i < 40; i++) {
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},500)'], { timeout: 2000 });
      try {
        if (fs.existsSync(sysResultFile())) {
          const o = JSON.parse(fs.readFileSync(sysResultFile(), 'utf8'));
          sysOk = Array.isArray(o.steps) && o.steps.length > 0 && o.steps.every((s) => s.ok);
          sysDetail = (o.steps || []).map((s) => s.name + '=' + (s.ok ? 'PASS' : 'FAIL')).join(', ');
          break;
        }
      } catch (e) { /* 未就绪继续轮询 */ }
    }
  }
  run('schtasks', ['/delete', '/tn', tn, '/f']);
  check('SYSTEM 上下文 modelOpenDir', okCreate && sysOk, (okCreate ? '' : '任务创建失败 ') + sysDetail);
  try { fs.unlinkSync(sysResultFile()); } catch (e) { /* ignore */ }

  // 汇总
  const fails = RESULTS.filter((r) => !r.ok);
  console.log('');
  console.log('== 结果: ' + (RESULTS.length - fails.length) + '/' + RESULTS.length + ' 通过 =' + (fails.length === 0 ? ' ✅' : ' ❌ 有 ' + fails.length + ' 项失败'));
  process.exit(fails.length === 0 ? 0 : 1);
}

if (process.argv.includes('--sys-test')) sysTest();
else main().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1); });
