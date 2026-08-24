'use strict';
// scripts/enhance-verify.mjs —— 增强模块 L2 浏览器端到端门禁（AGENTS §6.2，f6fa822/e1f884c 事故回归）
// 用法: node scripts/enhance-verify.mjs [--url http://127.0.0.1:3080]
// 前置: DSH web 运行中、插件已装、模型链可用（发起一次真实优化调用）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const URL_BASE = argOf('--url', 'http://127.0.0.1:3080');
let failures = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (d ? ' | ' + d : '')); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findEdge() {
  const pf86 = process.env['ProgramFiles(x86)'] || '';
  const lad = process.env.LOCALAPPDATA || '';
  const cand = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe', (process.env.ProgramFiles || 'C:\\Program Files') + '\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', lad + '\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
  return cand.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}
async function main() {
  const exe = findEdge();
  ok('browser-found', !!exe);
  if (!exe) process.exit(1);
  const port = 9400 + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'ev-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-sandbox', '--disable-gpu', URL_BASE], { stdio: 'ignore' });
  let ws;
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try { const l = await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json()); target = l.find((t) => t.type === 'page'); } catch {}
      if (!target) await sleep(750);
    }
    ok('cdp-target', !!target);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
    let seq = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    await send('Page.enable');
    await send('Page.navigate', { url: URL_BASE });
    await sleep(3500);
    let mounted = false;
    for (let i = 0; i < 20; i++) { mounted = await ev("!!document.querySelector('.dsh-enh-btn')"); if (mounted) break; await sleep(800); }
    ok('plugin-mounted', mounted === true);
    if (!mounted) throw new Error('no plugin');
    const DRAFT = '端到端验证：请把这句话整理得更清楚一些';
    const fillExpr = '(function(){var ta=document.querySelector("textarea");if(!ta){var c=document.querySelectorAll("[contenteditable]");for(var i=0;i<c.length;i++){if(c[i].isContentEditable){ta=c[i];break;}}}if(!ta)return "NO_TA";var d=' + JSON.stringify(DRAFT) + ';if(ta.tagName==="TEXTAREA"){Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set.call(ta,d);}else{ta.textContent=d;}ta.dispatchEvent(new Event("input",{bubbles:true}));return "OK";})()';
    const st1 = await ev(fillExpr);
    ok('draft-filled', st1 === 'OK', String(st1));
    await sleep(300);
    const before = await ev('(function(){var ta=document.querySelector("textarea");return ta?(ta.tagName==="TEXTAREA"?ta.value:ta.textContent):"";})()');
    await ev("document.querySelector('.dsh-enh-btn').click()");
    console.log('clicked, waiting real model (<=150s)...');
    let after = before, done = false;
    for (let i = 0; i < 150; i++) {
      await sleep(1000);
      after = await ev('(function(){var ta=document.querySelector("textarea");return ta?(ta.tagName==="TEXTAREA"?ta.value:ta.textContent):"";})()');
      if (after && after !== DRAFT && after !== before) { done = true; break; }
    }
    ok('enhance-writeback', done === true, done ? '草稿已被优化结果替换（核心断言）' : '草稿 150s 未变化——即用户报告症状');
    if (done) {
      await sleep(600);
      await ev("document.querySelector('.dsh-enh-btn').click()"); // result 态点击 = 撤回
      await sleep(800);
      const restored = await ev('(function(){var ta=document.querySelector("textarea");return ta?(ta.tagName==="TEXTAREA"?ta.value:ta.textContent):"";})()');
      ok('undo-restore', restored === DRAFT, '撤回后草稿还原原文');
    }
  } finally {
    try { proc.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  console.log(failures ? ('✗ enhance-verify 未通过: ' + failures) : '✅ enhance-verify 通过');
  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error('ERROR ' + (e && e.message || e)); process.exit(2); });
