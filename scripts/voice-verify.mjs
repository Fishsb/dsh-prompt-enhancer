#!/usr/bin/env node
// scripts/voice-verify.mjs —— 语音模块真实环境一键验证（AGENTS.md §6.2 L3/L4/L5）
// 用法：
//   node scripts/voice-verify.mjs             # 主验证（语法/worker/识别冒烟/SYSTEM 上下文 modelOpenDir）
//   node scripts/voice-verify.mjs --port N    # 显式指定 worker 端口（默认读 worker.port / 扫描）
//   node scripts/voice-verify.mjs --sys-test  # SYSTEM 上下文自验证（由 schtasks /ru SYSTEM 调用，勿手动跑）
// 背景：2026-08-20 用户规则「不得只靠单测+用户重启自测」——本脚本固化真实环境验证手段：
//   - worker 健康/模型就绪（worker.port 动态端口）
//   - 正弦波识别冒烟（真实链路 readWave→decode→getResult）
//   - SYSTEM 上下文 modelOpenDir（schtasks /ru SYSTEM 完整复现服务模式，含 ps1 自删痕迹）
//
// ── 平台面（2026-10-12 消除环境硬依赖）──────────────────────────────────────
// 逐环说明「跑什么 / 什么平台 / 缺件时怎么办」：
//   R1 语法门        lib/asr.cjs + asr-worker.cjs —— 跨平台，**必跑**（缺文件 = FAIL）。
//                    lib/asr-models.cjs —— **P1 待删件**：存在则照跑，不存在则 **SKIP**（原因写明）。
//                    SKIP 不计入通过数、不报绿（见下方三态退出码）。
//   R2 worker 健康   HTTP GET /health + POST /rpc status —— 跨平台，**必跑**。
//                    端口来自 --port → worker.port → 扫描（**不再硬编码 3082**）。
//   R3 识别冒烟      POST /rpc transcribe（正弦波假音频）—— 跨平台，**必跑**。
//   R4 SYSTEM 上下文 schtasks /ru SYSTEM 复现服务模式（Session 0）—— **Windows-only**：
//                    该环判的是 Windows 服务模式（Session 0）下 explorer 打开的会话隔离问题，
//                    非 win32 无 schtasks、也无 Session 0 语义 ⇒ 非 Windows **明确 SKIP 并写原因**，
//                    **不拖垮整脚本**（R1–R3 照跑、各自出读数）。
//   --sys-test 入口  由 R4 的 schtasks 调起 ⇒ **Windows-only**；非 Windows 上给明确提示而非静默。
//
// ── 退出码（沿用 scripts/lib/gate-exit.mjs 的链级三态语义）──────────────────
//   0 = 全环真判过且通过 ／ 1 = 有 FAIL ／ 2 = **未判全**（有 SKIP 且无 FAIL）。
//   ⚠ 「跳过」与「通过」不得同形 —— 否则 SKIP 会被读成绿（本仓 2026-09-27 裁定的同一条纪律）。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// 三态退出码语义唯一出处（本仓 2026-09-27 裁定 A）——直接 import，避免本脚本自留一份副本后漂移。
import { GATE_EXIT } from './lib/gate-exit.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
// ── 三态退出码（语义唯一出处 = scripts/lib/gate-exit.mjs，此处只做本脚本的消费面）──
//   0 = 全环真判过且通过 ／ 1 = 有 FAIL ／ 2 = 未判全（有 SKIP 且无 FAIL）
//   ⚠ 0 与 2 必须可分：否则「跳过一环」与「判过一环」在只看退出码的消费方眼里完全同形（假绿）。
const EXIT = { ALL_PASS: GATE_EXIT.ALL_PASS, FAIL: GATE_EXIT.FAIL, NOT_FULLY_JUDGED: GATE_EXIT.NOT_FULLY_JUDGED };
const IS_WIN = process.platform === 'win32';
// 参数：--port N 显式指定 worker 端口（覆盖 worker.port 与扫描）
const argvPort = (() => {
  const i = process.argv.indexOf('--port');
  const v = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(v) && v > 0 && v < 65536 ? v : null;
})();
const RESULTS = [];
const asrHome = () =>
  process.env.DSH_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.dsh');
const asrDir = () => path.join(asrHome(), 'dsh-prompt-enhancer-asr');
// 注意：必须用函数动态计算——SYSTEM 上下文（--sys-test）注入 USERPROFILE 前，
// 顶层 const 会在 import 时缓存 systemprofile 路径导致写入错位（2026-08-20 实测坑）
const sysResultFile = () => path.join(asrDir(), '.voice-verify-sys.json');
const sysPsFile = () => path.join(asrDir(), '.tmp-open-models.ps1');

// 三态记录：PASS / FAIL / SKIP。SKIP **不计入通过数**，且链级落 2（未判全）——不得报绿。
function record(status, name, detail) {
  RESULTS.push({ name, status, detail: detail || '' });
  console.log(status + ' | ' + name + (detail ? ' | ' + detail : ''));
}
function check(name, ok, detail) { record(ok ? 'PASS' : 'FAIL', name, detail); }
function skip(name, reason) { record('SKIP', name, '原因: ' + reason); }

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

// worker 端口发现（**不再硬编码 3082**；本仓纪律：worker 端口动态，实际端口写 worker.port 文件）
// 优先级：--port N > $DSH_HOME/dsh-prompt-enhancer-asr/worker.port > 常见候选扫描（按 /health 探活）
// ⚠ 与生产口径对齐（lib/asr.cjs:27-31）：**worker.port 里的端口要先过健康校验**——
//   文件可能指向一个已死的 pid（多实例/崩溃残留），按「文件即真」会读到一个死口而错过真正在跑的
//   worker。故「文件端口不健康」不是终点，而是降级到扫描（并把原因记进 tried，保持诊断可读）。
// 返回 { port, source, tried }；全部落空时 port=null，由调用方报 FAIL 并给出诊断（不静默退化到某个固定端口）。
function readPortFile() {
  const f = path.join(asrDir(), 'worker.port');
  try {
    if (!fs.existsSync(f)) return { file: f, err: '文件不存在' };
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (o && Number.isInteger(o.port) && o.port > 0) return { file: f, port: o.port, pid: o.pid };
    return { file: f, err: '无有效 port 字段: ' + JSON.stringify(o).slice(0, 80) };
  } catch (e) { return { file: f, err: String((e && e.message) || e) }; }
}
// 候选扫描：3082（ASR 默认）/3081（执行器）与 worker.port 同段的常见值；命中仍以 /health 为准
const SCAN_PORTS = [3082, 3081, 3083, 3092, 3093];
// 扫描用的**短超时探活**：本机实测（2026-10-12）——对一个**关闭**的回环端口发请求不会立刻 ECONNREFUSED，
// 而是挂到超时才回（实测单口 15s）。若 5 个候选逐个走满 httpReq 的 15s，仅探测就要 ~75s，会把脚本拖垮
// （正是本任务要消除的"环境依赖拖垮整脚本"）。⇒ 探测层用 2s 短超时（真 worker 的 /health 是轻量只读，
// 秒级余量充足）；**探测只决定"用哪个端口"，不承担判定职责**——判定仍由下方各环以默认 15s 完成。
// ⚠ 已保证判定口径不因提速而放宽：worker.port 存在但探测未过时，仍**回退使用该端口**（见下方返回），
//   ⇒ 即使一个"活着但正忙"的 worker 未能及时响应探测，各判定环仍会以完整 15s 拿到真实读数（不会误判为无 worker）。
const PROBE_TIMEOUT_MS = 2000;
async function probeHealth(port) {
  const r = await httpReq(port, 'GET', '/health', undefined, PROBE_TIMEOUT_MS);
  return r.status === 200 && r.json && r.json.ok === true;
}
async function discoverWorkerPort() {
  const tried = [];
  if (argvPort) { tried.push('--port ' + argvPort + '（显式指定，不做探活）'); return { port: argvPort, source: '--port', tried }; }
  const pf = readPortFile();
  const pfLabel = pf.file + (pf.port ? ' => ' + pf.port + (pf.pid ? ' (pid ' + pf.pid + ')' : '') : ' (' + pf.err + ')');
  if (pf.port) {
    if (await probeHealth(pf.port)) { tried.push(pfLabel + ' 健康'); return { port: pf.port, source: 'worker.port', tried }; }
    tried.push(pfLabel + ' **不健康**（死口/未响应）⇒ 降级扫描');
  } else {
    tried.push(pfLabel);
  }
  for (const p of SCAN_PORTS) {
    if (p === pf.port) continue; // 上面已探过，不重复
    if (await probeHealth(p)) { tried.push('扫描命中 ' + p); return { port: p, source: 'scan', tried }; }
  }
  tried.push('扫描未命中: ' + SCAN_PORTS.join(', '));
  // 兜底：若 worker.port 有端口但全都不健康，仍返回该端口——让调用方按真实探测结果报 FAIL，
  // 而不是报「未找到 worker」（文件明明在，说"没找到"会误导）。
  if (pf.port) return { port: pf.port, source: 'worker.port(不健康)', tried };
  return { port: null, source: null, tried };
}

// node 原生 http 请求（不用 curl——curl -d 按 form 编码会把 base64 的 '+' 转空格，破坏 wav）
// timeoutMs 可选：仅"端口发现"的探活用短超时，**各判定环一律用默认 15000**（判定口径不因探测提速而放宽）。
function httpReq(port, method, p, body, timeoutMs) {
  return new Promise((resolve) => {
    const http = require('node:http');
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: p,
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
      timeout: timeoutMs || 15000,
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
    // 解耦 P1 待删件：asr-models.cjs 不存在时不得让 --sys-test 崩，而是把「缺件」写成一条明确读数。
    // 该入口本身 Windows-only（由 R4 的 schtasks 调起），此处只保证缺件时也留下可读证据。
    const amPath = path.join(repoRoot, 'lib', 'asr-models.cjs');
    if (!fs.existsSync(amPath)) {
      out.steps.push({ name: 'modelOpenDir', ok: false, detail: 'SKIP: lib/asr-models.cjs 不存在（P1 已退役该文件）；--sys-test 无被判对象' });
      try { fs.writeFileSync(sysResultFile(), JSON.stringify(out), 'utf8'); } catch (e2) { /* ignore */ }
      // ⚠ 退出码 2（未判全），**不得用 0**——本入口非 Windows 分支同样是 2（见文件末尾）。
      //   若此处退 0，「跳过」与「全绿」在只看退出码的调用方眼里就同形（正是 :41 要防的形态）。
      process.exit(EXIT.NOT_FULLY_JUDGED);
    }
    const am = require(amPath);
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
  console.log('平台: ' + process.platform + (IS_WIN ? '（R4 SYSTEM 环可跑）' : '（R4 SYSTEM 环 Windows-only ⇒ 将 SKIP）'));

  // 1. 语法（跨平台必跑）
  //    lib/asr.cjs + asr-worker.cjs 是判据本体，缺件即 FAIL。
  //    lib/asr-models.cjs 是 **P1 待删件** ⇒ 存在则照跑，不存在则 SKIP（原因写明），不得报绿。
  const syn = run(process.execPath, ['--check', path.join(repoRoot, 'lib', 'asr.cjs')]);
  const synW = run(process.execPath, ['--check', path.join(repoRoot, 'lib', 'asr-worker.cjs')]);
  check('语法 lib/asr.cjs + lib/asr-worker.cjs', syn.status === 0 && synW.status === 0,
    syn.stderr ? String(syn.stderr).slice(0, 120) : (synW.stderr ? String(synW.stderr).slice(0, 120) : ''));
  const asrModelsPath = path.join(repoRoot, 'lib', 'asr-models.cjs');
  if (fs.existsSync(asrModelsPath)) {
    const synM = run(process.execPath, ['--check', asrModelsPath]);
    check('语法 lib/asr-models.cjs（P1 待删件，存在则判）', synM.status === 0,
      synM.stderr ? String(synM.stderr).slice(0, 120) : '');
  } else {
    skip('语法 lib/asr-models.cjs（P1 待删件，存在则判）',
      'lib/asr-models.cjs 不存在 —— 本脚本已解耦该待删件：它退役后此环自动 SKIP 而非把整脚本判死');
  }

  // 2. worker 端口发现（--port > worker.port > 扫描；不再硬编码 3082）
  const disc = await discoverWorkerPort();
  if (!disc.port) {
    check('worker 端口发现', false, '未找到 worker（来源: ' + disc.tried.join(' ; ') + '）');
    check('worker health', false, '无端口可探 —— worker 未运行或未写 worker.port');
    check('worker 模型就绪 modelReady', false, '无端口可探');
    check('正弦波识别冒烟', false, '无端口可探');
  } else {
    console.log('   worker 端口 = ' + disc.port + '（来源: ' + disc.source + '）');
    // worker 健康（GET /health）+ 模型就绪（POST /rpc status）
    const port = disc.port;
    const health = await httpGet(port, '/health');
    check('worker health (port ' + port + ' / 来源 ' + disc.source + ')', health.status === 200 && health.json && health.json.ok === true,
      health.json ? JSON.stringify(health.json).slice(0, 80) : 'worker 未响应 (status=' + health.status + ')');
    const st = await httpPost(port, '/rpc', { method: 'status' });
    check('worker 模型就绪 modelReady', !!st.json && st.json.ok === true && st.json.modelReady === true,
      st.json ? 'modelReady=' + st.json.modelReady + ' modelFile=' + st.json.modelFile : 'status 失败');

    // 3. 正弦波识别冒烟（真实链路：readWave→decode→getResult）
    const tr = await httpPost(port, '/rpc', { method: 'transcribe', args: { audioBase64: sineWavDataUrl(1) } });
    check('正弦波识别冒烟', !!tr.json && tr.json.ok === true && typeof tr.json.text === 'string',
      tr.json ? 'text=' + JSON.stringify(tr.json.text).slice(0, 40) : 'transcribe 失败 (status=' + tr.status + ')');
  }

  // 4. SYSTEM 上下文 modelOpenDir（schtasks /ru SYSTEM 完整复现服务模式）—— **Windows-only**
  //    该环判的是 Windows 服务模式（Session 0）下 explorer 打开的**会话隔离**问题：
  //    schtasks /ru SYSTEM 是 Windows 独有机制，Session 0 亦是 Windows 概念 ⇒ 非 win32 无可判对象。
  //    非 win32 明确 SKIP 并写原因，**其余环照跑**（不 return、不 throw、不拖垮整脚本）。
  if (!IS_WIN) {
    skip('SYSTEM 上下文 modelOpenDir',
      'Windows-only：该环用 schtasks /ru SYSTEM 复现 Session 0 服务模式；当前平台 ' + process.platform +
      ' 无 schtasks、亦无 Session 0 语义 ⇒ 本机无可自动复现的判据（该环只在 Windows 有可判对象；当前平台无 ⇒ 属未判全，不代跑、不报绿）');
  } else {
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
            const steps = o.steps || [];
            // 解耦件：--sys-test 在 asr-models.cjs 缺件时写的是「ok:false + SKIP 说明」——
            // 那不是服务模式判据失败，是「无可判对象」，故 SKIP（不得当 PASS 冒充已判）。
            // ⚠ **失败优先**（与 gate-exit.mjs 的 verdictOf 同口径）：只要存在任何**真实失败**
            //   （非 SKIP 的 ok:false），整环就是 FAIL —— 不得因为同一批里有一条 SKIP 就把真实失败吞掉。
            const isSkipStep = (s) => !s.ok && String(s.detail || '').startsWith('SKIP');
            const realFails = steps.filter((s) => !s.ok && !isSkipStep(s));
            const allSkip = steps.length > 0 && steps.every(isSkipStep);
            if (realFails.length) { sysOk = false; }         // 真实失败优先，绝不被 SKIP 掩盖
            else if (allSkip) { sysOk = null; }              // 整批皆是「无被判对象」⇒ SKIP
            else { sysOk = steps.length > 0 && steps.every((s) => s.ok); }
            sysDetail = steps.map((s) => s.name + '=' + (s.ok ? 'PASS' : (isSkipStep(s) ? 'SKIP' : 'FAIL'))).join(', ');
            break;
          }
        } catch (e) { /* 未就绪继续轮询 */ }
      }
    }
    run('schtasks', ['/delete', '/tn', tn, '/f']);
    if (sysOk === null) {
      skip('SYSTEM 上下文 modelOpenDir', 'lib/asr-models.cjs 已退役 ⇒ --sys-test 无被判对象（' + sysDetail + '）');
    } else {
      check('SYSTEM 上下文 modelOpenDir', okCreate && sysOk, (okCreate ? '' : '任务创建失败 ') + sysDetail);
    }
    try { fs.unlinkSync(sysResultFile()); } catch (e) { /* ignore */ }
  }

  // 汇总（三态：SKIP 不计入通过数，且不落 0）
  const pass = RESULTS.filter((r) => r.status === 'PASS');
  const fails = RESULTS.filter((r) => r.status === 'FAIL');
  const skips = RESULTS.filter((r) => r.status === 'SKIP');
  console.log('');
  console.log('== 结果: ' + pass.length + '/' + RESULTS.length + ' 通过' +
    (skips.length ? '，' + skips.length + ' 跳过（未判全）' : '') +
    (fails.length ? '，' + fails.length + ' 失败' : '') +
    ' =' + (fails.length ? ' ❌ 有 ' + fails.length + ' 项失败' : (skips.length ? ' ⏭ 未判全（有环 SKIP，不报绿）' : ' ✅')));
  if (skips.length) for (const s of skips) console.log('   ⏭ SKIP | ' + s.name + ' | ' + s.detail);
  process.exit(fails.length ? EXIT.FAIL : (skips.length ? EXIT.NOT_FULLY_JUDGED : EXIT.ALL_PASS));
}

if (process.argv.includes('--sys-test')) {
  if (!IS_WIN) {
    // 非 Windows 上给明确提示而非静默（本入口由 R4 的 schtasks 调起，Windows-only）
    console.error('SKIP | --sys-test | 该入口 Windows-only：它模拟 nssm 服务模式（Session 0）并由 schtasks /ru SYSTEM 调起。');
    console.error('       当前平台 ' + process.platform + ' 无 schtasks / Session 0 语义 ⇒ 无可判对象，不代跑、不报绿。');
    process.exit(EXIT.NOT_FULLY_JUDGED);
  }
  sysTest();
} else main().catch((e) => { console.error('FATAL:', e && e.message); process.exit(EXIT.FAIL); });
