'use strict';
// scripts/enhance-verify.mjs —— 增强模块 L2 浏览器端到端门禁（AGENTS §6.2，f6fa822/e1f884c 事故回归）
// 用法: node scripts/enhance-verify.mjs [--url http://127.0.0.1:3080/?token=<token>]
// 前置: DSH web 运行中、插件已装、模型链可用（发起一次真实优化调用）。
// 平台: 跨平台（Windows / Linux / WSL / macOS）。浏览器发现见 findBrowser()——
//   Windows 用 Program Files / ProgramFiles(x86) / LOCALAPPDATA 候选；POSIX 用常见安装路径 +
//   PATH 查找；macOS 用 /Applications；WSL 额外探测 /mnt/<盘符> 下的 Windows 侧 Chrome/Edge。
//   找不到浏览器时报明确诊断（列出找过的位置 + 平台 + 建议装什么），不静默失败。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const URL_BASE = argOf('--url', 'http://127.0.0.1:3080');
let failures = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (d ? ' | ' + d : '')); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 浏览器发现（跨平台）────────────────────────────────────────────────────
// 本段只负责「怎么找到浏览器 / 怎么把路径交给它」；判定逻辑（断言什么、点哪里、
// 验什么）与其后各环与 Windows 版逐字一致，未做任何放宽。
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_WSL = (() => {
  if (IS_WIN || IS_MAC) return false;
  try { return /microsoft|wsl/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
})();
// WSL 常见形态：浏览器装在 Windows 侧（本机即如此，无 Linux 原生浏览器）。
// 用 /mnt/<盘符> 探测；镜像网络模式下 Windows 浏览器可直连 WSL 的 127.0.0.1。
function windowsMountRoots() {
  const out = [];
  try {
    for (const n of fs.readdirSync('/mnt')) {
      if (/^[a-z]$/i.test(n)) { try { if (fs.statSync('/mnt/' + n).isDirectory()) out.push('/mnt/' + n); } catch { /* ignore */ } }
    }
  } catch { /* 无 /mnt（非 WSL）*/ }
  return out;
}
// 显式候选路径（按平台）
function browserCandidates() {
  const out = [];
  const add = (p) => { if (p) out.push(p); };
  if (IS_WIN) {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad = process.env.LOCALAPPDATA || '';
    add(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    add(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    add(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    add(path.join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    add(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else if (IS_MAC) {
    add('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add('/Applications/Chromium.app/Contents/MacOS/Chromium');
    add('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    add('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  } else {
    add('/usr/bin/google-chrome');
    add('/usr/bin/google-chrome-stable');
    add('/usr/bin/chromium');
    add('/usr/bin/chromium-browser');
    add('/snap/bin/chromium');
    add('/usr/bin/microsoft-edge');
    add('/usr/bin/microsoft-edge-stable');
    add('/usr/bin/brave-browser');
  }
  if (IS_WSL) {
    for (const root of windowsMountRoots()) {
      add(path.join(root, 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));
      add(path.join(root, 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'));
      add(path.join(root, 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      add(path.join(root, 'Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  }
  return out;
}
// 候选是否"存在且可直接执行"——不只看 existsSync+isFile（后者会接受一个无执行位的同名文件，
// 进而在 spawn 时才失败，诊断反而变模糊）。实测：WSL 的 /mnt/c 下 chrome.exe/msedge.exe 的 X_OK 为真
// （9p 挂载 access=client，mode 显示 555），故该更严判据不会误伤 Windows 侧浏览器。
// ⚠ 若文件存在但无执行位，仍记进 tried 清单（诊断里要能看到"找过这里、但它不可执行"）。
function isRunnableFile(p) {
  try { if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return false; } catch { return false; }
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}
// PATH 查找（等价 which/where，不依赖外部命令——便于把「查过哪些」一并列出）
function whichIn(names) {
  const sep = IS_WIN ? ';' : ':';
  const dirs = (process.env.PATH || '').split(sep).filter(Boolean);
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  const found = [];
  for (const d of dirs) {
    for (const n of names) {
      for (const e of exts) {
        const p = path.join(d, n + e);
        if (isRunnableFile(p)) found.push(p);
      }
    }
  }
  return found;
}
const PATH_NAMES = IS_WIN
  ? ['chrome', 'msedge']
  : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'chrome'];
// 返回 { exe, tried }——tried 用于未找到时的明确诊断（列出找过哪些位置）
function findBrowser() {
  const tried = [];
  for (const p of browserCandidates()) {
    tried.push({ how: 'path', value: p });
    if (isRunnableFile(p)) return { exe: p, tried };
  }
  for (const p of whichIn(PATH_NAMES)) {
    tried.push({ how: 'PATH', value: p });
    return { exe: p, tried };
  }
  tried.push({ how: 'PATH', value: '$PATH 中查找: ' + PATH_NAMES.join(', '), note: '未命中' });
  return { exe: null, tried };
}
// WSL 下若选中的是 Windows 侧可执行文件（/mnt/<盘符>/...），--user-data-dir 这类
// 传给浏览器的**文件路径**必须是 Windows 视角——用 wslpath -w 转换。
// 本机实测（2026-10-12）：Windows Chrome + POSIX 路径 --user-data-dir=/tmp/xxx
// 会**静默不监听** CDP 端口（stderr 空、目标目录里只有一个空 err.log），
// 脚本于是卡在 /json/list 轮询里——判定逻辑外的真跨平台缺口。
// 注意：判据必须落在**二进制**上（exe 是 Windows 侧才转路径），不能落在被转的路径上。
function isWindowsBinary(p) { return IS_WSL && /^\/mnt\/[a-z]\//i.test(p); }
function browserNativePath(exe, p) {
  if (!isWindowsBinary(exe)) return p;
  try {
    const r = spawnSync('wslpath', ['-w', p], { encoding: 'utf8', timeout: 5000 });
    const s = String((r && r.stdout) || '').trim();
    if (s) return s;
  } catch { /* ignore */ }
  return p;
}
// 未找到浏览器：给出「找过什么 / 什么平台 / 该装什么」，绝不静默失败
function reportBrowserNotFound(tried) {
  console.error('FAIL | browser-found | 未找到可用浏览器（platform=' + process.platform + (IS_WSL ? ' / WSL' : '') + '）');
  console.error('      已按顺序尝试:');
  for (const t of tried) console.error('        [' + t.how + '] ' + t.value + (t.note ? '  (' + t.note + ')' : ''));
  if (IS_WIN) {
    console.error('      建议: 安装 Google Chrome 或使用系统自带 Microsoft Edge（本脚本二者皆可）。');
  } else if (IS_MAC) {
    console.error('      建议: brew install --cask google-chrome   （或 chromium / microsoft-edge）');
  } else {
    console.error('      建议: sudo apt install chromium-browser        # Debian/Ubuntu');
    console.error('            或 sudo snap install chromium            # 任意 snap 发行版');
    console.error('            或安装 google-chrome-stable / microsoft-edge-stable');
    if (IS_WSL) console.error('            或在 Windows 侧安装 Chrome/Edge —— 脚本会自动探测 /mnt/<盘符> 下的安装');
  }
}
// 定向回收**本脚本自己启动的**浏览器进程（次要项，2026-10-12）。
// 依据：只认本次唯一的 profile 目录名（mkdtemp 生成的 ev-XXXX）。
// 它同时以两种形态出现：WSL 侧路径（/tmp/ev-XXXX）与 Windows 侧路径（...\Temp\ev-XXXX）。
// ⚠ 安全约束：**只按这个唯一标记匹配**，命中数为 0 或工具不可用都直接放弃；
//   绝不按镜像名批量杀 chrome/msedge —— 那会误杀用户自己的浏览器。
function killOurBrowsers(profileArg, exe) {
  // 从路径里抽出 mkdtemp 生成的唯一标记。⚠ 不能用 path.basename：Windows 侧路径用反斜杠，
  // 在 Linux/WSL 上 basename 不按 \ 切分，会把整串当文件名 ⇒ 匹配不到任何进程（实测：清理无效）。
  const m = String(profileArg || '').match(/(ev-[A-Za-z0-9]+)[\\/]*$/);
  const marker = m ? m[1] : '';
  if (!marker || marker.length < 6) return;                 // 标记太弱 ⇒ 放弃，宁留残留不误杀
  try {
    // ⚠ 判据是「浏览器进程在哪个系统里」而不是「我们在哪个平台」：
    //   WSL 下 exe 是 /mnt/c/... 的 Windows 程序 ⇒ 进程在 Windows 侧，必须走 powershell；
    //   用 pgrep 在 WSL 里按标记搜是搜不到的（实测：清理无效、残留继续累积）。
    if (IS_WIN || isWindowsBinary(exe)) {
      const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\' or Name=\'msedge.exe\'" | '
        + 'Where-Object { $_.CommandLine -like \'*' + marker + '*\' } | '
        + 'ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }';
      spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 15000 });
      return;
    }
    // POSIX：浏览器由本机直接启动（非 WSL 跨侧）时按命令行定向清理
    const r = spawnSync('pgrep', ['-f', marker], { encoding: 'utf8', timeout: 5000 });
    for (const pid of String(r.stdout || '').split(/\s+/).filter(Boolean)) {
      const n = Number(pid);
      if (Number.isInteger(n) && n > 1 && n !== process.pid) { try { process.kill(n, 'SIGTERM'); } catch { /* ignore */ } }
    }
  } catch { /* 清理失败不影响判定 */ }
}
// ── 首页可达性 / 认证前置检查（装置层，2026-10-12 回修）──────────────────────
// 背景（独立复验 §2.2 查实）：DSH web 启用认证时，**不带 token** 访问首页会得到 **401 纯文本页**
// （无 SPA、无 slots、无插件）⇒ 脚本会在 plugin-mounted 环节失败，而旧文案写成「可对话页未就绪？」——
// 读者（含未来 agent）会把该红误读成**产品/插件**问题。本检查**不改变任何判定条件**，
// 只把「装置是否连上 / 是否通过认证」在读数里说清楚，使「装置没连上」不再伪装成「插件没挂载」。
// ⚠ 有意**不**自动去日志里挑最后一个 token 填进默认 URL：那是「猜」（可能取到过期会话的 token）。
const TOKEN_HINT = "grep -o 'token=[A-Za-z0-9_-]\\{8,\\}' ~/.dsh/logs/web-manual.log | tail -1 | cut -d= -f2";
async function probeHttp(url) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
    let body = '';
    try { body = String(await r.text()).slice(0, 200); } catch { /* ignore */ }
    return { status: r.status, body };
  } catch (e) { return { status: 0, body: '', err: String((e && e.message) || e) }; }
}
function printAuthGuidance(url) {
  // 只把 query 换成 token 占位，保留 scheme/host/port/path（否则会打出 "http://?token=..." 这种废指引）
  let base = String(url);
  try { const u = new URL(base); u.search = ''; base = u.toString(); } catch { /* 非法 URL 就按原样 */ }
  const withTok = base + (base.endsWith('/') ? '' : '') + '?token=<token>';
  console.log('  ✗ 该 DSH 实例要求 token 认证（HTTP 401）——未携带 token 时进不了 SPA ⇒ 插件不可能挂载。');
  console.log('    ⇒ 这是「装置没连上」，不是「插件没挂载」。');
  console.log('    请带 token 运行： node scripts/enhance-verify.mjs --url "' + withTok + '"');
  console.log('    取 token：       ' + TOKEN_HINT);
}
async function main() {
  const found = findBrowser();
  ok('browser-found', !!found.exe, found.exe ? found.exe : '未找到；诊断见下方');
  if (!found.exe) { reportBrowserNotFound(found.tried); process.exit(1); }
  const exe = found.exe;
  const port = 9400 + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
  const profileArg = browserNativePath(exe, profile);
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profileArg, '--no-first-run', '--no-sandbox', '--disable-gpu', URL_BASE], { stdio: 'ignore' });
  let ws;
  let seqForClose = 0; // finally 里给 Browser.close 用的独立请求 id（与主循环的 seq 解耦）
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

    // ── 前置检查：首页可达性 / 是否要求认证（只加诊断，不改判定）──────────────
    // 放在最早可能的时机：navigate 前先探一次；若 401 立即把「装置没连上」说清楚，
    // 之后即便 plugin-mounted 仍会 FAIL，读者也不会把它误读成产品问题。
    const pre = await probeHttp(URL_BASE);
    let authBlocked = false;
    if (pre.status === 401) { printAuthGuidance(URL_BASE); authBlocked = true; }
    else if (pre.status === 0) console.log('   [前置] 首页探测失败（' + (pre.err || '无响应') + '）——继续，后续读数会给出页面实况');
    else console.log('   [前置] 首页 HTTP=' + pre.status + '（200/303 = 正常继续）');

    await send('Page.navigate', { url: URL_BASE });
    await sleep(3500);

    // ── 就绪准备（装置层，非断言）──────────────────────────────────────────
    // 2026-10-12 实测：首屏可能是「工作区选择」页（composer 为 data-phase="inert"、
    // placeholder「选择一个工作区开始」）——此时 composer 槽位不渲染，插件按钮不会出现。
    // 本步只把页面推进到「可对话」态（点开工作区选择器），不改变任何被断言的内容。
    // 兼容：若本来就已经在对话页（enh-btn 已在），本步直接跳过。
    // ⚠ 2026-10-12 回修：原实现只匹配 innerText —— 但「选择工作区」**只在 WorkspaceChip 的 aria-label 上**
    //   （官方 client.js:16104），该按钮 innerText 是**工作区显示名**（`:16118`）⇒ 在「已选工作区但仍在
    //   选择态」的真选择页上连点都点不动，PREP 失效会把场面推给判别块。
    //   ⇒ 改为按**可访问名（aria-label / title / innerText）**识别，中英文案集合对齐官方。
    //   ⚠ 只扩大「识别」不扩大「点击面」：仍**只点可访问名确实指示工作区选择的那一个按钮**，
    //     不放宽到「点任意按钮」、也不按位置点。
    const PREP_EXPR = "(function(){if(document.querySelector('.dsh-enh-btn'))return 'READY';var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var acc=((b[i].getAttribute('aria-label')||'')+' '+(b[i].title||'')+' '+(b[i].innerText||'')).toLowerCase();if(/选择工作区|choose workspace|select workspace/.test(acc)){b[i].click();return 'PICKER_CLICKED';}}return 'WAIT';})()";
    let prepped = await ev(PREP_EXPR);
    for (let i = 0; i < 10 && prepped === 'PICKER_CLICKED' && !(await ev("!!document.querySelector('.dsh-enh-btn')")); i++) {
      await sleep(800);
    }
    if (prepped === 'PICKER_CLICKED') console.log('   [prep] 已驱动「工作区选择」→ 等 composer 就绪');

    let mounted = false;
    for (let i = 0; i < 20; i++) { mounted = await ev("!!document.querySelector('.dsh-enh-btn')"); if (mounted) break; await sleep(800); }
    // ⚠ 判定条件不变（仍 mounted === true 才 PASS）；这里只增加**失败时的判别信息**，
    //   使「401 认证页 / 工作区选择页 / 已进对话但插件未挂载」三类**一眼可分**——
    //   避免把「装置没连上」报成「插件没挂载」（独立复验 §7.3 blocker 1）。
    let mountDetail = 'composer 槽位已渲染';
    if (!mounted) {
      // 判别输入采集（装置层）。⚠ 2026-10-12 回修：**必须读可访问名（aria-label / title）**——
      //   DSH 官方库把「选择工作区」只写在 WorkspaceChip 的 aria-label 上
      //   （dsh-client-ui-conversation/lib/client.js:16104 `"aria-label": t("hero.chooseWorkspace")`），
      //   而该按钮的 innerText 是**工作区显示名**（`:16118 children: label ?? t("hero.chooseWorkspace")`）⇒
      //   在「已选工作区（chip 显示名字）但页面仍停在选择态」这个**最可能的真选择页形态**下，
      //   只匹配 innerText 会漏判 ⇒ 把装置问题报成 ③「疑似产品问题」（正是本回修要治的缺陷的镜像）。
      //   inert 优先取 DSH 自己的状态标记 `data-phase="inert"`（client.js:16286 定义），placeholder 仅作兜底。
      const pageDiag = await ev("(function(){var b=document.body;var c=document.querySelector('[data-composer-input]');var ph=c?(c.getAttribute('data-placeholder')||''):'';var ib=!!document.querySelector('[data-composer-input][data-phase=\"inert\"]')||/选择一个工作区开始|Choose a workspace to start/i.test(ph);var bs=document.querySelectorAll('button');var pb=false;for(var i=0;i<bs.length;i++){var acc=((bs[i].getAttribute('aria-label')||'')+' '+(bs[i].title||'')+' '+(bs[i].innerText||'')).toLowerCase();if(/选择工作区|choose workspace|select workspace/.test(acc)){pb=true;break;}}return JSON.stringify({href:location.href,title:document.title,txt:(b?(b.innerText||''):'').replace(/\\s+/g,' ').slice(0,160),hasCE:document.querySelectorAll('[contenteditable]').length,hasBtn:bs.length,inert:ib,pickerBtn:pb,phase:(c?(c.getAttribute('data-phase')||''):'')});})()");
      let d = {}; try { d = JSON.parse(String(pageDiag)); } catch { /* ignore */ }
      const txt = String(d.txt || '');
      const isAuthPage = pre.status === 401 || /authentication required|reopen the URL printed/i.test(txt);
      // ── ②PICKER：**结构位判据**（2026-10-12 收紧，替代原「body.innerText 前 160 字符」文本匹配）──
      // 必须**同时**满足：① composer 处于「未就绪」结构态（优先 `data-phase="inert"`；兜底比对
      // placeholder，中英两串都已对齐官方文案）；② 页面上确实存在「选择工作区」按钮——**按可访问名识别**
      // （aria-label / title / innerText 三者任一命中即可），不再只看 innerText。
      // 为什么必须收紧：旧实现只看 innerText —— 若**已进对话页**（真产品故障：插件未挂载）而首屏恰好含
      // 「选择工作区」字样，会被归成②并写「非产品问题」⇒ **把产品故障报成装置问题**（与本回修目的相反）。
      // 为什么不会漏判真 picker：真 picker 页恰是「composer inert + 选择器按钮」并存（本机实测的形态）。
      // 为什么结构位拿不到时归③：**有意的保守取向** —— 结构位为假即不判②，宁可把真 picker 疑成产品
      // （多一次人工判读），也不可把真产品故障放过；反向误判才是会掩盖故障的那种。
      const isPicker = d.inert === true && d.pickerBtn === true;
      // 文案兜底提示：文本像 picker 但结构位不支持 ⇒ 显式写出「按结构位归③」的理由，便于人工判读。
      const textHintsPicker = /选择工作区|Select workspace|Choose workspace|选择一个工作区开始/i.test(txt);
      const pickerDowngradeNote = (!isPicker && textHintsPicker)
        ? '［注意：首屏文本含「选择工作区」字样，但结构位（composer inert=' + String(d.inert === true) + ' + 选择器按钮=' + String(d.pickerBtn === true) + '）不支持 ⇒ 按保守取向归③，请重点排查产品/装配］'
        : '';
      // ⚠ 第三类必须再分「装置根本连不上」与「连上了但插件没挂载」——
      //   否则错端口/服务未启动会被误报成「疑似产品问题」，与本次回修的目的正相反。
      const isUnreachable = pre.status === 0;
      const cls = isAuthPage ? 'AUTH_401' : (isUnreachable ? 'UNREACHABLE' : (isPicker ? 'PICKER' : 'NOT_MOUNTED'));
      const label = isAuthPage
        ? '①装置未认证（401 页，非产品问题）：HTTP=' + pre.status + ' href=' + d.href + ' title=' + JSON.stringify(d.title) + ' 首屏=' + JSON.stringify(txt.slice(0, 80))
        : isUnreachable
          ? '①b装置不可达（服务未启动/端口错/被拦截，非产品问题）：首页探测 ' + (pre.err || 'status=0') + ' href=' + d.href + ' title=' + JSON.stringify(d.title) + ' 首屏=' + JSON.stringify(txt.slice(0, 80))
          : isPicker
            ? '②装置停在「工作区选择页」（自动选择未生效，非产品问题）：结构位 composer[data-phase=' + JSON.stringify(String(d.phase)) + ']=inert 且存在「选择工作区」按钮；href=' + d.href + ' title=' + JSON.stringify(d.title)
            : '③已进入页面但插件未挂载（**疑似**产品/装配问题，须结合上方 href/title/首屏与计数判读——本文案不能单独定案）：结构位 composer 未处于 inert 相位、未见「选择工作区」按钮；href=' + d.href + ' title=' + JSON.stringify(d.title) + ' 首屏=' + JSON.stringify(txt.slice(0, 80)) + ' contenteditable=' + d.hasCE + ' button=' + d.hasBtn + pickerDowngradeNote;
      mountDetail = label;
      console.log('   [判别] class=' + cls + ' status=' + pre.status + ' href=' + d.href);
      console.log('   [判别] title=' + JSON.stringify(d.title) + ' 首屏=' + JSON.stringify(txt.slice(0, 120)));
      console.log('   [判别] contenteditable=' + d.hasCE + ' button=' + d.hasBtn);
      console.log('   [判别] 结构位 inert=' + String(d.inert === true) + ' pickerBtn=' + String(d.pickerBtn === true) + ' composerPhase=' + JSON.stringify(String(d.phase || '')));
      if (authBlocked || isAuthPage) console.log('   [判别] ⇒ 属①：装置没连上（未认证）。请按上文提示带 token 运行。');
      else if (isUnreachable) console.log('   [判别] ⇒ 属①b：装置不可达（检查 DSH web 是否启动 / --url 端口是否正确）。');
      else if (isPicker) console.log('   [判别] ⇒ 属②：装置仍在工作区选择页（非产品问题）。');
      else console.log('   [判别] ⇒ 属③：页面已进入但插件未挂载 —— 这才需要怀疑产品/装配。' + pickerDowngradeNote);
    }
    ok('plugin-mounted', mounted === true, mountDetail);
    if (!mounted) throw new Error('no plugin');

    // ── 输入位寻址（装置层：只改「往哪读/往哪写」，兼容新旧两种 UI 形态）────
    // 新形态（当前 UI）：div[data-composer-input]（contenteditable 富文本输入位）
    // 旧形态（历史/兼容）：textarea，或任意 contenteditable
    const iife = (body) => '(function(){' + body + '})()';
    const SEL = 'var el=document.querySelector("[data-composer-input]")||document.querySelector("textarea");'
      + 'if(!el){var c=document.querySelectorAll("[contenteditable]");for(var i=0;i<c.length;i++){if(c[i].isContentEditable){el=c[i];break;}}}';
    const READ_EXPR = iife(SEL + 'return el?(el.tagName==="TEXTAREA"?el.value:(el.innerText||el.textContent||"")):"";');

    const DRAFT = '端到端验证：请把这句话整理得更清楚一些';
    // 写入：新形态走 execCommand('insertText')（能在 contenteditable 上驱动受控更新）；
    //       旧 textarea 走原生 value setter + input 事件；其余 contenteditable 走 textContent + input。
    const fillExpr = iife(SEL + 'if(!el)return "NO_TA";var d=' + JSON.stringify(DRAFT) + ';'
      + 'if(el.tagName==="TEXTAREA"){Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set.call(el,d);el.dispatchEvent(new Event("input",{bubbles:true}));}'
      + 'else{el.focus();try{document.execCommand("selectAll",false,null);}catch(e){}var okIns=false;try{okIns=document.execCommand("insertText",false,d);}catch(e){}'
      + 'if(!okIns){el.textContent=d;el.dispatchEvent(new Event("input",{bubbles:true}));}}'
      + 'var got=(el.tagName==="TEXTAREA"?el.value:(el.textContent||"")).trim();'   // 同步自检用 textContent（innerText 需重排，同 tick 仍是旧值）
      + 'return got===d?"OK":"MISMATCH:"+got.slice(0,40);');
    const st1 = await ev(fillExpr);
    // 时序（装置层）：contenteditable 经 execCommand 写入后浏览器在**下一帧**才落到 DOM 上，
    // 同 tick 回读恒为空串（2026-10-12 实测：+50ms 起内容正确且此后稳定）⇒ 同步自检不可靠。
    // 故沿用脚本原有的 300ms 静默后再做断言（该 sleep 在旧版里本来就在）。
    // ⚠ 断言口径未变：仍要求字段内容 **逐字等于** DRAFT（不是"非空"、不是"包含"）。
    await sleep(300);
    const filledNow = await ev(READ_EXPR);
    ok('draft-filled', filledNow === DRAFT, 'filled=' + JSON.stringify(String(filledNow).slice(0, 40)) + ' sync=' + String(st1).slice(0, 30));
    await sleep(300);
    const before = await ev(READ_EXPR);
    await ev("document.querySelector('.dsh-enh-btn').click()");
    console.log('clicked, waiting real model (<=150s)...');
    let after = before, done = false;
    for (let i = 0; i < 150; i++) {
      await sleep(1000);
      after = await ev(READ_EXPR);
      if (after && after !== DRAFT && after !== before) { done = true; break; }
    }
    ok('enhance-writeback', done === true, done ? '草稿已被优化结果替换（核心断言）' : '草稿 150s 未变化——即用户报告症状');
    if (done) {
      await sleep(600);
      await ev("document.querySelector('.dsh-enh-btn').click()"); // result 态点击 = 撤回
      await sleep(800);
      const restored = await ev(READ_EXPR);
      ok('undo-restore', restored === DRAFT, '撤回后草稿还原原文');
    }
  } finally {
    // ⚠ 必须 ws.close()：Node 22 的全局 WebSocket 未关闭会一直占住事件循环——
    //   只设 process.exitCode **不会**让进程退出（2026-10-12 独立复核实测：打印结论后 40s+ 仍存活）。
    //   该缺陷原已存在，但 HEAD 在 WSL 因找不到浏览器而立刻 exit 1，把它掩盖了；
    //   改动让 WSL 真能找到浏览器后即首次暴露 ⇒ 在同一文件内一并修掉（不涉及判定逻辑）。
    try { if (ws) ws.close(); } catch {}
    try { proc.kill(); } catch {}
    // 优雅关闭（次要项，2026-10-12）：proc.kill() 只杀 WSL 侧的中继进程，
    // **收不掉 Windows 侧真正的 chrome.exe**（实测跑一次驻留约 5 个）。优先用 CDP Browser.close 让
    // 浏览器自己退出（对任何平台都干净）；随后只对「命令行含本次唯一 profile 目录名」的进程做定向兜底，
    // ⚠ 绝不按进程名批量杀 chrome —— 那会误杀用户自己的浏览器。
    try {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ id: ++seqForClose, method: 'Browser.close' })); await sleep(1200); }
    } catch {}
    try { killOurBrowsers(profileArg, exe); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  console.log(failures ? ('✗ enhance-verify 未通过: ' + failures) : '✅ enhance-verify 通过');
  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error('ERROR ' + (e && e.message || e)); process.exit(2); });
