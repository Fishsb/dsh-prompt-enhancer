'use strict';
// scripts/dead-code-gate.mjs —— 提交前死代码/断线接线门禁（f6fa822 半成品事故驱动）
// 用法: node scripts/dead-code-gate.mjs [--range A..B]   默认 HEAD~1..HEAD
// R1 diff 新增声明(src/**)全仓引用<2 → FAIL；R2 client chunk 未声明标识符 → FAIL
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 状态出口契约（P5）：本环的机读三态由**本环自己声明**，gate.mjs 只读结构不解释措辞。
import { emitRingState, installCrashGuard } from './lib/ring-state.mjs';
import * as libManifest from './lib/lib-manifest.mjs';
// D-10 修正批（2026-10-14）：剥注释器收敛到单一事实源（原内联「先块后行」会吞真实代码）。
import { codeOnly } from './lib/code-only.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
installCrashGuard('dead-code');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const RANGE = args.includes('--range') ? args[args.indexOf('--range') + 1] : 'HEAD~1..HEAD';
const ALLOW = new Set((args.includes('--allow') ? args[args.indexOf('--allow') + 1] : '').split(',').filter(Boolean));
let failures = 0;
const fail = (r, m) => { failures++; console.log('FAIL | ' + r + ' | ' + m); };
const pass = (r, m) => console.log('PASS | ' + r + ' | ' + m);
const git = (a) => { const r = spawnSync('git', ['-c', 'safe.directory=*', '-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 }); return r.status === 0 ? r.stdout : ''; };

/**
 * ⚠⚠ 单一事实源（P2 复核处置批 2026-10-13 · 处置 F1/F2）：`lib/` 侧的**全部手改 .cjs 模块**。
 *
 * 病历：R5 的 `TARGETS`（硬编码 12 件）与 R6 的 `INJECTION_FILES`（硬编码 4 件）此前**各写一份**，
 *   与 `arch-claims.mjs` 的 `PE_F01_LIB_MANIFEST`（13 件）**三份互不相等且无判据锁它们相等**
 *   ⇒ 新建 `lib/<新文件>.cjs` 并在入口接线后：**R5 不扫它、R6 不扫它、A230-1/A230-5 双绿**
 *   —— 死码与注入面复长**全链不可观测**（复核实证，见 F1/F2）。
 * ⇒ 现改为**从磁盘枚举派生**（与 `rpc-manifest.mjs` / `arch-claims.mjs` 的注册面枚举**同一规则**）：
 *   枚举 `lib/` 下全部 `.cjs`，**排除具名声明的构建产物** `client.cjs`（它由 build-client.mjs
 *   生成、非手改面，其防漂移由 `build-client --check` 负责）。排除项是**具名白名单**，不是通配
 *   ⇒ 任何**新**文件自动进入扫描面（这正是本批要修的失效形态）。
 *
 * ⚠ 本枚举**不覆盖什么**（如实声明）：
 *   ① 不扫 `test/**`（R5 的消费者语料**含** test/，但被扫的**目标**只有 lib/ 手改模块）；
 *   ② 不扫 `src/**`（其死码由 R4 的等值集 + build 装配链管）；
 *   ③ **动态后果（复核指出的关键一条）**：R5 判的是**导出面**——若某文件把导出**删掉**，
 *      其内部函数即**脱离 R5 视野**（`lib/net-proxy.cjs` 与 `lib/sys.cjs` 已发生，见 F3）。
 *      本枚举把**扫描面**补齐到全 `lib/`，但**不**改变「R5 只判导出面」这一边界；
 *      文件内私有函数的死码**仍需**另立判据（F3 的处置见本批 T2：直接删除已知隐形死码）。
 */
// ⚠ P2 窄复核处置批（2026-10-13 · 处置 F-1）：排除集与枚举**收敛到单一事实源**
//   `scripts/lib/lib-manifest.mjs`（此前四处副本，见该文件头部病历）。本处不再自持
//   `GENERATED_LIB` 字面量 —— 排除集由构建脚本写盘点派生，且由 `ARCH-C1` 判据锁死。
//   `libTargets()` 保留为**本文件的薄包装**（调同一事实源），R5/R6 行为不变。
const libTargets = () => libManifest.libHandwrittenTargets();

// ---- diff 新增行 ----
const addedByFile = new Map();
let curFile = null;
const diffArgs = RANGE === 'HEAD' ? ['diff', '--unified=0', 'HEAD'] : ['diff', '--unified=0', RANGE];
for (const line of git(diffArgs).split('\n')) {
  if (line.startsWith('+++ b/')) curFile = line.slice(6);
  else if (line.startsWith('+') && !line.startsWith('+++')) {
    if (!curFile) continue;
    if (!addedByFile.has(curFile)) addedByFile.set(curFile, []);
    addedByFile.get(curFile).push(line.slice(1));
  }
}

// ---- R1 新声明必须有引用 ----
{
  const declRe = /(?:^|\n)?\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=|\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\s*{/g;
  const declared = new Map();
  for (const [file, lines] of addedByFile) {
    if (!file.startsWith('src/')) continue;
    for (const rawLn of lines) {
      const ln = rawLn.trim();
      if (ln.startsWith('//') || ln.startsWith('*') || ln.startsWith('/*')) continue;
      declRe.lastIndex = 0;
      let m;
      while ((m = declRe.exec(ln))) {
        const name = m[1] || m[2] || m[3];
        if (name && !declared.has(name)) declared.set(name, file);
      }
    }
  }
  const corpus = [];
  const walkAll = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!/^(node_modules|\.git|dist|assets|release-notes)$/.test(ent.name)) walkAll(full); continue; }
      if (/\.(cjs|mjs|js|json)$/.test(ent.name)) corpus.push(full);
    }
  };
  walkAll(ROOT);
  let bad = 0;
  for (const [name, file] of declared) {
    const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g');
    let count = 0;
    outer: for (const f of corpus) {
      const txt = fs.readFileSync(f, 'utf8');
      let mm;
      while ((mm = re.exec(txt))) { count++; if (count >= 2) break outer; }
    }
    if (count < 2) { fail('R1', path.relative(ROOT, path.join(ROOT, file)) + ' 新声明 ' + name + ' 全仓无调用点'); bad++; }
  }
  if (!bad) pass('R1', declared.size + ' 个新声明全部有引用');
}

// ---- R2 client chunk 未声明标识符 ----
{
  const B = String.fromCharCode(92);
  const KW = new Set('return,function,const,let,var,class,if,else,for,while,do,switch,case,default,break,continue,new,typeof,instanceof,in,of,delete,void,this,super,extends,import,export,from,as,try,catch,finally,throw,yield,async,await,static,get,set,null,true,false,undefined,module,exports,require,arguments,NaN'.split(','));
  const GLB = new Set(('React,Fragment,window,document,localStorage,sessionStorage,console,JSON,Math,Promise,setTimeout,setInterval,clearTimeout,clearInterval,Object,Array,String,Number,Boolean,RegExp,Date,Error,Symbol,Map,Set,isNaN,parseInt,parseFloat,host,configState,timerSvc,saveConfig,ZH,MEMORY_ROUNDS_MAX,SEEN_KEY_PREFIX,subscribeConfig,modeShortLabel,prettifyModel,dshEnhIdSeq,dshEnhId,makeT,sessionStores,postMessage,self,onmessage,requestAnimationFrame,cancelAnimationFrame,AudioContext,styles,Uint8Array,Int8Array,Uint16Array,Uint32Array,Float32Array,Float64Array,ArrayBuffer,DataView,ResizeObserver,MutationObserver,IntersectionObserver,CustomEvent,TextEncoder,TextDecoder,importScripts,RecordRTC,listening,ready,retry,stopping,settling,tagsText,releaseText,stopping,settling,not,FileReader,MediaStream,webkitAudioContext,location,navigator,fetch,AbortController,Blob,URL').split(','));
  // D-10 修正批（2026-10-14）：前两步（剥块注释 / 剥行注释）收敛到单一事实源 `codeOnly`
  //   —— 原内联顺序「先块后行」会因 `//` 注释里的 `/*` 吞掉其后真实代码。
  //   ⚠ **后四步（字符串 / 模板串 / 正则字面量置空）逐字未动** —— 本次只改「怎么剥注释」。
  const strip = (src) => codeOnly(src)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(new RegExp(B + '`[^' + B + '`]*', 'g'), '``')
    .replace(/([=:(\(\n]return\s)\/[^\/\n]+\/[gimsuy]*/g, '$1 0');
    const declaredOf = (code) => {
    const set = new Set();
    for (const m of code.matchAll(new RegExp('function\\s+([A-Za-z_$][\\w$]*)', 'g'))) set.add(m[1]);
    for (const m of code.matchAll(new RegExp('(const|let|var)\\s+([A-Za-z_$][\\w$]*)', 'g'))) set.add(m[2]);
    for (const m of code.matchAll(new RegExp('class\\s+([A-Za-z_$][\\w$]*)', 'g'))) set.add(m[1]);
    for (const m of code.matchAll(new RegExp('function\\s*[A-Za-z_$][\\w$]*\\s*\\(([^)]*)\\)', 'g'))) for (const p of m[1].split(',')) { const t = p.replace(/[{}]/g, '').split('=')[0].trim(); if (t) set.add(t); }
    for (const m of code.matchAll(new RegExp('(^|[,{])\\s*([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)\\s*{', 'g'))) { set.add(m[2]); for (const p of m[3].replace(/[{}]/g, '').split(',')) { const t = p.split('=')[0].trim(); if (t) set.add(t); } }
    for (const m of code.matchAll(new RegExp('\\(([^()]*)\\)\\s*=>', 'g'))) for (const p of m[1].replace(/[{}]/g, '').split(',')) { const t = p.split('=')[0].trim(); if (t) set.add(t); }
    // 解构捕获（对象/数组）—— indexOf 深度扫描，零转义陷阱
    for (const kw of ['const ', 'let ', 'var ']) {
      let pos = 0;
      while ((pos = code.indexOf(kw, pos)) !== -1) {
        let i = pos + kw.length;
        while (i < code.length && /\s/.test(code[i])) i++;
        if (i < code.length && (code[i] === '[' || code[i] === '{')) {
          const openCh = code[i], closeCh = openCh === '[' ? ']' : '}';
          let depth = 0, j = i;
          for (; j < code.length; j++) {
            if (code[j] === openCh) depth++;
            else if (code[j] === closeCh) { depth--; if (depth === 0) break; }
          }
          for (let part of code.slice(i + 1, j).split(',')) {
            const t = part.split('=')[0].replace(/[{}\[\]\s]/g, '');
            if (/^[A-Za-z_$][\w$]*$/.test(t)) set.add(t);
          }
          pos = j;
        } else pos = i;
      }
    }
    return set;
  };

  const chunks = [];
  // ⚠ 契约违反计数（读不出包裹的 chunk 数）：> 0 时**不得**再打 R2 的 PASS 行
  //   —— 同一条规则同时输出 PASS 与 FAIL 会让读者 grep `PASS | R2` 时得到假读数
  //   （本次事故的形态之一就是「读数看起来是绿的」）。
  let contractBad = 0;
  const collect = (dir) => {
    if (!fs.existsSync(dir)) { fail('R2', 'client chunk 目录缺位（无扫描面 ⇒ 不得判绿）: ' + path.relative(ROOT, dir)); contractBad++; return; }
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { collect(full); continue; }
      if (!ent.name.endsWith('.js')) continue;
      if (full.split(path.sep).includes('vendor')) continue;
      const raw = fs.readFileSync(full, 'utf8');
      const mm = raw.match(/module\.exports\s*=\s*"([\s\S]*)";?\s*$/);
      // ⚠⚠ H2 活例修复（2026-10-17 client chunk 契约收口批）：原实现是
      //   `strip(mm ? JSON.parse('"' + mm[1] + '"') : raw)` —— **解析不出包裹就静默回退到 raw 原文**。
      //   实测本次事故（CHG-143 的 correction.js 为裸 JS，无 `module.exports = "…"` 包裹）：
      //   `mm === null` ⇒ R2 拿 raw 当 chunk 源码 ⇒ **一段语法完整、自洽的裸 JS**
      //   ⇒ declaredOf 覆盖其全部引用 ⇒ R2 照常报 `PASS | 24 个 client chunk 无未声明标识符`
      //   ⇒ **门在扫，却对「读不出契约的 chunk」零鉴别力**（读者看见的 PASS 其实是空转）。
      //   ⇒ 现改为 **fail-closed**：读不出契约即 FAIL，不再拿未解码的原文冒充 chunk 源码。
      //     （口径先例：`sync-face.mjs` 「解析不到就算过 = 假绿」/ `arch-claims` S-5 退役说明。）
      if (!mm) { fail('R2', path.relative(ROOT, full) + ' 读不出 chunk 导出契约（module.exports = "<JSON 字符串>"）⇒ 不得以原文冒充 chunk 源码'); contractBad++; continue; }
      chunks.push({ rel: path.relative(ROOT, full), code: strip(JSON.parse('"' + mm[1] + '"')) });
    }
  };
  collect(path.join(ROOT, 'src', 'client'));
  const GLOBAL_DECL = new Set();
  for (const c of chunks) for (const id of declaredOf(c.code)) GLOBAL_DECL.add(id);
    let scanned = 0, bad = 0;
  for (const c of chunks) {
    scanned++;
    const declared = new Set([...declaredOf(c.code), ...GLOBAL_DECL]);
    const bare = c.code
      .replace(new RegExp('[.]' + B + 's*[A-Za-z_$][' + B + 'w$]*', 'g'), '.')
      .replace(new RegExp('[A-Za-z_$][' + B + 'w$]*' + B + 's*:', 'g'), '');
    for (const m of bare.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const id = m[0];
      if (id.length < 3 || KW.has(id) || GLB.has(id) || declared.has(id)) continue;
      if (ALLOW.has(id)) continue;
      const msg = c.rel + ' 使用了未声明的标识符 ' + id;
      if (c.rel.endsWith('updater-card.js')) console.log('WARN | R2 | ' + msg);
      else { fail('R2', msg); bad++; }
      break;
    }
  }
  // ⚠ 只在**无契约违反**时才打 PASS 行 —— 否则同规则双行（FAIL+PASS）会成为假读数源。
  if (!bad && !contractBad) pass('R2', scanned + ' 个 client chunk 无未声明标识符');
}
// ---- R3 产物清单 ↔ files 白名单一致（P1a 2026-09-19：幽灵声明是静默面）----
// 背景：`package.json.files` 里的条目若磁盘不存在，`npm pack` **不报错、静默跳过**；
// 而入口（main/exports）若不落在白名单内，安装后会缺文件却直到运行才炸。
// 本门把这三者（白名单 / 磁盘 / 入口声明）钉在一起，任何一处不一致即 FAIL。
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const covered = (rel) => files.some((f) => rel === f || rel.startsWith(String(f).replace(/\/$/, '') + '/'));
  let bad = 0;
  // A. 白名单每一条必须在磁盘存在（含目录）
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) { fail('R3', 'files 白名单含幽灵条目（磁盘不存在，npm pack 静默跳过）: ' + f); bad++; }
  }
  // B. 入口（main / exports）必须存在且被白名单覆盖；package.json 由 npm 强制包含，豁免
  const exportsVals = Object.values(pkg.exports || {}).map((v) => (typeof v === 'string' ? v : (v && v.default) || ''));
  const entries = [pkg.main, ...exportsVals].filter((x) => typeof x === 'string' && x && x.replace(/^\.\//, '') !== 'package.json');
  for (const e of entries) {
    const rel = e.replace(/^\.\//, '');
    if (!fs.existsSync(path.join(ROOT, rel))) { fail('R3', '入口声明指向不存在的文件: ' + e); bad++; continue; }
    if (!covered(rel)) { fail('R3', '入口未被 files 白名单覆盖（安装后会缺文件）: ' + e); bad++; }
  }
  // C. 运行必需产物必须在位（本插件宿主/客户端双半部的真实入口）
  for (const f of ['plugin-host.js', 'lib/index.cjs', 'lib/client.cjs']) {
    if (!fs.existsSync(path.join(ROOT, f))) { fail('R3', '运行必需产物缺失: ' + f); bad++; }
  }
  if (!bad) pass('R3', files.length + ' 条白名单全部在位，' + entries.length + ' 个入口声明均被覆盖');
}

// ---- R4 src/host 不得再长出死层（P1b 2026-09-19：RC-C「双架构无淘汰机制」的结构判据）----
// 背景：退役前 src/host 有 25 件，其中 18 件（995 物理行）是「从未接线的 M2 目标架构骨架」，
// 且互相 import 伪装成「有入边」，任何按入边判死的脚本都识别不出整个簇。本门改用**装配清单等值**：
// src/host 的磁盘文件集必须与 build-host.mjs 引用的清单完全一致——多一件即死层复长。
{
  const hostDir = path.join(ROOT, 'src', 'host');
  if (!fs.existsSync(hostDir)) fail('R4', 'src/host 目录缺失');
  else {
    const onDisk = fs.readdirSync(hostDir).filter((f) => f.endsWith('.js'));
    const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'build-host.mjs'), 'utf8');
    const referenced = new Set();
    for (const m of builder.matchAll(/['"](?:\.\.\/)*src\/host\/([A-Za-z0-9_.-]+\.js)['"]/g)) referenced.add(m[1]);
    referenced.add('app.js'); // bundle 骨架由构建器隐式装配
    const extra = onDisk.filter((f) => !referenced.has(f));
    const missing = [...referenced].filter((f) => !onDisk.includes(f));
    if (extra.length) fail('R4', 'src/host 出现装配清单外的文件（死层复长 / 双架构回归）: ' + extra.join(', '));
    if (missing.length) fail('R4', '装配清单声明的文件磁盘缺失: ' + missing.join(', '));
    if (!extra.length && !missing.length) pass('R4', 'src/host ' + onDisk.length + ' 件与 build-host 装配清单一致（无死层）');
  }
}

// ==== R5 lib/** 导出面必须有「生产活消费者」（P2-2 · 2026-10-13）====
// 背景（P2-1 实证）：`lib/index.cjs` 曾压着 315 行自指死簇（executor 生命周期整段，
//   簇外零调用点），而 **gate 五环全绿** —— 因为 R1 只扫 `src/`、R2 只扫 client chunk、
//   R4 只判 `src/host` 与装配清单等值 ⇒ **`lib/**` 当时完全没有任何死代码机检**。
//   本规则补这个盲区（属「会掩盖其他问题 / 让失败不可观测」类缺陷的修复）。
//
// ── 判据口径（**只判导出面，不做全文件级可达性分析**）────────────────────
// 对一个 `lib/*.cjs` 的**导出符号**，按引用来源分三档：
//   · USED          —— 存在**生产消费者**（`src/` · `lib/` · `scripts/` · `plugin-host.js`）
//                      ⇒ PASS（这是唯一"活"的定义）
//   · COVERED-ONLY  —— **只有 `test/**` 引用**（无生产消费者）⇒ **仍 PASS，另打 INFO 行**
//                      （口径：算"被覆盖"，**不算"被使用"**；两类分开报，不混为一谈）
//   · NO-CONSUMER   —— **全仓（含 `test/**`）零引用** ⇒ **FAIL**（真死码）
//
// ── 为什么只判 NO-CONSUMER 就够（"牙"在哪）────────────────────────────────
// P2-1 的死簇形态正是「零外部消费者」：簇内互相调用（自指）**不产生**任何文件外引用。
//   本规则对**任何新导出**都会问"文件外有没有人用" ⇒ 裸加无消费者导出**必然变红**。
//   变异自证见 P2-2 报告 §T1（临时加无消费者导出 ⇒ R5 FAIL ⇒ 还原 ⇒ PASS）。
//
// ── 明确的不覆盖项（如实声明，不冒充已覆盖）──────────────────────────────
//   ① **不判**「有生产消费者但该消费者自身路径不可达」（需 AST 可达性，勘察席已标未验证）；
//   ② **不判**同文件内私有函数的死码（本轮范围外）；
//   ③ **不判** `lib/client.cjs` —— 生成物（`npm run build` 产物）、54 行、无 `module.exports = {`
//      面、其面是浏览器侧 `window.__ModuleLoader__`（无静态消费者）⇒ 结构性不适用；
//   ④ **`--range` 不参与本规则**：R1 用 diff 是因为它判"**本次新增**声明"；R5 判的是
//      **整个 `lib/` 面的现状事实**，与本次提交改了什么无关 ⇒ 在 `HEAD`（工作树 vs HEAD）
//      与 `HEAD~1..HEAD`（提交区间）**两种模式下行为完全相同**。⚠ 这一差异是刻意的：
//      R5 若也随 diff 走，则"死码在更早的提交里加入"时本环会永远看不见它（正是 P2-1 的形态）。
//   ⑤ 引用判定用**词界正则**（`\b<name>\b`）而非 AST ⇒ 注释里的同名提及会计为引用。
//      本规则因此**偏保守**（宁漏不误报）；R1 的既有实现同口径。
//       ⇒ **故本环先用 `codeOnly()` 剥注释**（见下方 `hasRef`），否则"已删清单"式注释会被算成引用。
//
// ⚠⚠ **D-16 / R-2 扩面（P3-2e 判据工具修正批 2026-10-14 · 独立复核发现）**：
//   本环（R5）的读数是「**剥离器正确性**的直接函数」—— `codeOnly()` 少剥一段或吞掉一段，
//   三档归属（生产在用 / 仅测试覆盖 / 死码）就会跟着变。`:335` 的 `hasRef` 即此依赖点。
//   ⇒ 属**工具链单点**：**修剥离器**会**改变本环读数**（P3-2e 已实测：D-10 修正使 `win` 由
//     「仅测试覆盖」归位为「生产在用」，30/53 → 31/52）。
//   ⚠ 该单点**不止影响 R5** —— `arch-claims.mjs` 的 **`A197-x` 全族**同样以 `codeOnly()` 读数为准
//     （复核实测：`A197-5` 在 `532dc25` 上旧剥离器读 1 ⇒ PASS、**真值 2** ⇒ **假绿**）。
//     ⇒ `D-16` 原只给 R5 开的处方，**须扩到 `A197-x` 全族**（详见 `arch-claims.mjs` 的 `A197-5` 处注释）。
//   ⚠ **判定式与阈值不受影响**（本批一字未动）；本注记只声明**依赖关系**，供后续统一处置。
{
  // ⚠ P2 复核处置批（2026-10-13 · F1）：改为**从磁盘枚举派生**（`libTargets()`），
  //   不再硬编码 —— 与 `rpc-manifest.mjs` / `arch-claims.mjs` 收敛到同一枚举规则：
  //   `lib/` 全部 `.cjs` 减具名生成物 `client.cjs`。新文件**自动**进入扫描面。
  const TARGETS = libTargets();
  // 生产消费者面（**不含** test/）：src · lib · scripts · plugin-host.js
  const prodCorpus = [];
  const walkProd = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!/^(node_modules|\.git|dist|assets|release-notes)$/.test(ent.name)) walkProd(full); continue; }
      if (/\.(cjs|mjs|js)$/.test(ent.name)) prodCorpus.push(full);
    }
  };
  for (const d of ['src', 'lib', 'scripts']) { const full = path.join(ROOT, d); if (fs.existsSync(full)) walkProd(full); }
  const hostEntry = path.join(ROOT, 'plugin-host.js');
  if (fs.existsSync(hostEntry)) prodCorpus.push(hostEntry);
  // test 面（单独一类，只用于区分 COVERED-ONLY 与 NO-CONSUMER）
  const testCorpus = [];
  const testDir = path.join(ROOT, 'test');
  if (fs.existsSync(testDir)) {
    for (const ent of fs.readdirSync(testDir, { withFileTypes: true })) {
      if (ent.isDirectory()) continue;
      if (/\.(cjs|mjs|js)$/.test(ent.name)) testCorpus.push(path.join(testDir, ent.name));
    }
  }
  /** 解析 `module.exports = { … }` 的**值侧**符号名（支持 `k: v` 别名与 shorthand） */
  const parseExportNames = (code) => {
    const at = code.indexOf('module.exports = {');
    if (at < 0) return null;
    const begin = code.indexOf('{', at);
    let depth = 0; let end = -1;
    for (let i = begin; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return null;
    const body = code.slice(begin + 1, end).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const names = new Set();
    for (const seg of body.split(',')) {
      const t = seg.trim();
      if (!t) continue;
      const alias = t.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
      if (alias) { names.add(alias[2]); continue; }
      const plain = t.match(/^([A-Za-z_$][\w$]*)$/);
      if (plain) names.add(plain[1]);
    }
    return [...names];
  };
  // ── T3（P2-2 余账 · 2026-10-13）：语料面从「全文出现」收紧为「**引用形态**」──────
  // F-1 盲区（P2-2 报告）：旧口径用 `\b<name>\b` 判命中 ⇒ **名字被文本提及**（注释 /
  //   字符串 / 测试夹具里的字面量）也会算成"有消费者"。实证代价：P2-2 的自证装置
  //   把变异名写进测试文件 ⇒ R5 把变异体算成「仅测试覆盖」⇒ **假绿**（详见 P2-2 §2.4）。
  //
  // 收紧后的「引用」定义（**任一形态命中即算引用**）：
  //   (a) 调用形态 `name(`               —— 含 `require` 解构后的函数调用；
  //   (b) 成员形态 `.name` / `?.name`    —— `M.name` / `sys.name` 等取用（含测试 `M.foo`）；
  //   (c) **解构/导入形态** `{ … name … }` 出现在 `require(` / `import` / `const {` 附近；
  //   (d) 对象字面量键 `name:` 或 `name,` **位于 `{` 行内同行**（表驱动用法，如 REFINE_PROMPT 作属性值）。
  // ⚠ 仍**不判**同文件内私有函数的死码、不判对象字段（覆盖边界不变）。
  // ⚠ 收紧方向 = 更严（把"提及"从引用里剔除）⇒ **不是改浅**；不加宽任何既有约束。
  const refPattern = (name) => {
    const n = name.replace(/\$/g, '\\$');
    return new RegExp('(?:\\b' + n + '\\s*\\()' +                       // (a) 调用
      '|(?:[.?]\\s*' + n + '\\b)' +                                       // (b) 成员取用
      '|(?:\\{[^}]*\\b' + n + '\\b[^}]*\\})' +                        // (c) 解构/导入表
      '|(?:(?:^|[,{])\\s*' + n + '\\s*[:,])');                            // (d) 键位（对象字面量）
  };
  // 同一符号在**同文件内**的引用不计（自指不算活）——与 P2-1/P2-2 口径一致。
  const hasRef = (file, name) => {
    let txt = '';
    try { txt = fs.readFileSync(file, 'utf8'); } catch { return false; }
    // 剥注释：// 行注释与 /* */ 块注释（防"已删清单"式注释计入引用）
    // D-10 修正批（2026-10-14）：收敛到单一事实源 `codeOnly`（原「先块后行」会吞真实代码）。
    txt = codeOnly(txt);
    return refPattern(name).test(txt);
  };
  let r5bad = 0; let r5checked = 0; let r5covered = 0;
  const coveredRows = [];
  for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { fail('R5', rel + ' 缺失（R3 亦判，此处只提示）'); r5bad++; continue; }
    const names = parseExportNames(fs.readFileSync(abs, 'utf8'));
    if (!names) { fail('R5', rel + ' 未找到 `module.exports = {` 面（口径失效，须先对齐解析器）'); r5bad++; continue; }
    for (const name of names) {
      r5checked++;
      let prodHits = 0;
      for (const f of prodCorpus) {
        if (path.resolve(f) === path.resolve(abs)) continue;
        if (hasRef(f, name)) { prodHits++; break; }
      }
      if (prodHits > 0) continue;
      let testHits = 0;
      for (const f of testCorpus) { if (hasRef(f, name)) { testHits++; break; } }
      if (testHits > 0) { r5covered++; coveredRows.push(rel + ':' + name); continue; }
      fail('R5', rel + ' 导出 ' + name + ' 全仓（含 test/）无引用形态 ⇒ 死码');
      r5bad++;
    }
  }
  if (!r5bad) {
    pass('R5', r5checked + ' 个 lib 导出符号均有引用形态（' + (r5checked - r5covered) + ' 生产在用 · ' + r5covered + ' 仅测试覆盖）');
    if (coveredRows.length) console.log('INFO | R5 | 仅测试覆盖（口径：算"被覆盖"，不算"被使用"；T3 收紧后 = 有引用形态但只在 test/）：' + coveredRows.join(' '));
  }
}

// ==== R6 注入面复长哨兵（P2-2 · T2 · 2026-10-13）====
// 背景（P2-1 的 F-2 盲区点名）：`.cmd` / schtasks **命令注入面**的三条锚定判据
//   （`A146-3` · `RPCG-02` · `RPCG-04` 末两条）随执行器退役**全部消失** ⇒ 该面自此
//   **再无任何判据在看**。当前无活代码故非活缺陷，**但复长不会报警**。本规则是那个哨兵。
//
// ── 形态选择：源码锚定式（选项 ①），不是缺席式（②）──────────────────────
// 理由：②（"该面已退役且若复长须伴随安全化判据"）**无法机检"若复长"这个条件** ——
//   它必然退化成「现在没有 ⇒ 恒过」= **恒真判据（同 A201-3 假绿）**，正是本批禁止的形态。
//   ① 则把哨兵做在**可证伪的形态**上：直接断言源码里**不得出现未安全化的命令拼接**，
//   一旦有人把 `.cmd` / schtasks / shell 命令拼回来，**立刻变红** ⇒ 哨兵真能报警。
//
// ── 判据内容（两条，都是"出现即 FAIL"）──────────────────────────────────
//   (a) 系统面文件**不得**出现 `.cmd` 文件生成 / schtasks 计划任务调用；
//   (b) **不得**出现"shell 赋值 + 字符串拼接"的裸拼形态（`'set "X=' + …`），
//       其正确形态是经 `cmdSafeValue()` 一类安全化函数转义 —— 出现裸拼即 FAIL
//       （即：要么用安全化函数，要么它根本不该在）。
//
// ⚠ **这不是"现在没有所以过"**：判据读的是**源码中真的没有该形态**这一可证伪事实，
//   变异自证见 P2-2 报告 §T2（临时加回 `'set "X=' + v` ⇒ R6 FAIL ⇒ 还原 ⇒ PASS）。
{
  // ⚠ P2 复核处置批（2026-10-13 · F2）：同 R5，改为**从同一枚举器派生**——
  //   原硬编码 4 件与 R5 的 12 件、A230-1 的 13 件三份互不相等；新文件里复长注入面
  //   （`schtasks` / 裸拼 `set`）此前**全链不可观测**。现扫描面 = 全部 `lib/` 手改模块。
  const INJECTION_FILES = libTargets();
  const cmdGen = /(?:schtasks|['"]\.cmd['"])/;
  const bareSet = /['"]set\s+["']?\s*[A-Z_][A-Z0-9_]*\s*=\s*['"]\s*\+/;
  let r6bad = 0; let r6checked = 0;
  for (const rel of INJECTION_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    r6checked++;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*(\/\/|\*|\/\*)/.test(ln)) continue; // 注释行不计（防"已删清单"式误报）
      if (cmdGen.test(ln)) { fail('R6', rel + ':' + (i + 1) + ' 命令/任务生成面复长（.cmd 生成或 schtasks 调用）: ' + ln.trim().slice(0, 80)); r6bad++; }
      if (bareSet.test(ln)) { fail('R6', rel + ':' + (i + 1) + ' 裸拼 shell 赋值（未经 cmdSafeValue 一类安全化）: ' + ln.trim().slice(0, 80)); r6bad++; }
    }
  }
  if (!r6bad) pass('R6', r6checked + ' 个系统面文件的注入点已退役且无裸拼复长（哨兵在位）');
}

// ==== R7 chunk 导出契约（源码层）+ 产物可求值性（产物层）====
// 病历（2026-10-17 · 线上事故收口批 · 承 CHG-143）：
//   `src/client/voice/correction.js` 以**裸 JS**提交（无 `module.exports = "…"` 包裹），而其余
//   23 个 client chunk 都写该包裹 ⇒ `build-client.mjs` 的 `body.replace(marker, chunk)` 拿到的是
//   **对象** ⇒ 字符串化成 `[object Object]` 注进 `lib/client.cjs` ⇒ 浏览器求值抛
//   `Unexpected identifier 'Object'` ⇒ **整个 client 半部装载失败**。
//
// ⚠ 它为何穿过了既有全部判据（本环实读定性，详见收口批报告 §⑥）：
//   ① **既有的 `bundle-smoke` 靶子是 `plugin-host.js`（host 半部）**，client 半部**无对等判据**
//      ⇒ 属**覆盖缺口**（情形 2）；
//   ② 本环 R2 **枚举了全部 client chunk**（触点存在）却写 `mm ? JSON.parse(…) : raw`
//      —— **解析不出包裹就静默回退到原文** ⇒ 裸 JS chunk 与正常 chunk 同形通过
//      ⇒ 属**触发点缺失**（情形 1），⚠ 且正是 `H2` 的又一活例（判据在扫、却被分支跳过而空转报 PASS）。
//   ⇒ 故本规则的落点是**两层一起**：源码层的**触发点修复**（R2 已改 fail-closed）+ 本条的
//     **显式契约断言**（源码层）与**产物可求值断言**（产物层，补 R2 不覆盖的那一面）。
//
// ⚠ **host 面同族核查（实读，非推断）**：`src/host/**` 的 5 个 chunk **写的是同一契约**
//   （逐个 `require` 实测导出形态全为 `string`）+ `build-host.mjs` 用**同一 `body.replace(marker, chunk)` 注入**
//   ⇒ **同族** ⇒ 一并纳入本规则（覆盖 `src/client` + `src/host` 两面）。
//   两者**产物层**的既有覆盖不同（如实登记）：
//     · host：产物 `plugin-host.js` 是**裸 JS**，`[object Object]` 直接落在语法面 ⇒ 既有
//       `node --check`（CI Syntax check / sync-runtime 2.5 环）+ `bundle-smoke` 已能咬住（本环实测：必红）；
//     · client：产物 `lib/client.cjs` 的 body 被 `JSON.stringify` 内嵌在**字符串字面量**里 ⇒
//       `node --check` **天然无感**（实测 exit 0）且无等价的 bundle-smoke ⇒ **这才是缺口**。
//   本规则两面都断言，故任一面回归都被咬住（不依赖"另一面已有别的门"这一外部事实）。
//
// 覆盖面无硬编码：递归枚举 `src/{client,host}/**.js` ⇒ **将来新增的 chunk 自动入网**（同 R5/R6 的派生纪律）。
// fail-closed：目录缺位 / 清单为空 / 目标产物缺位 ⇒ 全部 FAIL，**不得静默回退或判绿**
//   （口径先例：`sync-face.mjs`「解析不到就算过 = 假绿」/ `arch-claims` 的 S-5 退役说明）。
{
  const req = createRequire(import.meta.url);
  const problems = [];
  const FACES = [
    { name: 'client', dir: path.join(ROOT, 'src', 'client'), artifact: path.join(ROOT, 'lib', 'client.cjs'), rel: 'src/client' },
    { name: 'host', dir: path.join(ROOT, 'src', 'host'), artifact: path.join(ROOT, 'plugin-host.js'), rel: 'src/host' },
  ];
  let totalChunks = 0;
  for (const face of FACES) {
    const files = [];
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) { if (ent.name !== 'vendor') walk(full); continue; }
        if (ent.name.endsWith('.js')) files.push(full);
      }
    };
    // ── 源码层：**每个** chunk 的导出形态必须 = string（不是「某文件合格」）──
    if (!fs.existsSync(face.dir)) problems.push(face.rel + ' chunk 目录缺位（无扫描面 ⇒ 不得判绿）');
    else {
      walk(face.dir);
      if (files.length === 0) problems.push(face.rel + ' chunk 清单解析为空（不得据此判绿）');
      totalChunks += files.length;
      for (const f of files.sort()) {
        const rel = path.relative(ROOT, f);
        let v;
        try { v = req(f); } catch (e) {
          // 裸 JS chunk 若在定义期就引用宿主全局会在此抛错 —— 同样属契约违反（fail-closed，不吞）
          problems.push(rel + ' 载入失败（导出契约违反 / 定义期抛错）: ' + String(e && e.message).slice(0, 120));
          continue;
        }
        if (typeof v !== 'string') problems.push(rel + ' 导出形态违反：实得 ' + typeof v + '（须为 string —— `module.exports = "<JSON 转义源码>"`）');
        else if (v.length === 0) problems.push(rel + ' 导出空字符串（chunk 无内容）');
      }
    }
    // ── 产物层：产物必须可求值（client 复用 bundle-smoke 对 host 的同款做法）──
    if (!fs.existsSync(face.artifact)) { problems.push(face.name + ' 产物缺位: ' + path.relative(ROOT, face.artifact)); continue; }
    const src = fs.readFileSync(face.artifact, 'utf8');
    const contamination = (src.match(/\[object Object\]/g) || []).length;
    if (contamination > 0) problems.push(path.relative(ROOT, face.artifact) + ' 含 ' + contamination + ' 处 [object Object]（chunk 被对象字符串化注入 ⇒ 求值必抛）');
    if (face.name === 'client') {
      // client 载体：外层 new Function(src) 只做装载，真正的 body 求值在 factory 内 ⇒ 必须调到 factory
      let captured = null;
      let loaderOk = true;
      try { new Function('window', src)({ __ModuleLoader__: { load(o) { captured = o; } } }); }
      catch (e) { loaderOk = false; problems.push('lib/client.cjs 整体求值失败: ' + String(e && e.message).slice(0, 120)); }
      if (loaderOk) {
        if (!captured || typeof captured.factory !== 'function') problems.push('lib/client.cjs 未注册 factory（__ModuleLoader__.load 未被调用）');
        else {
          try {
            const ReactStub = new Proxy({}, { get: () => (() => null) });
            captured.factory((name) => (name === 'react' ? ReactStub : {}));
          } catch (e) {
            // 内层 body 求值失败 —— 这正是浏览器装载时的失败点（[object Object] 在此抛 Unexpected identifier）
            problems.push('lib/client.cjs factory 求值失败（浏览器同款装载点）: ' + String(e && e.message).slice(0, 120));
          }
        }
      }
    } else {
      // host 载体：产物是裸 JS（lib/index.cjs 以 new Function('harness', BODY) 求值）⇒ 直接判语法
      try { new Function('harness', src); }
      catch (e) { problems.push('plugin-host.js 求值失败（lib/index.cjs 同款装载点）: ' + String(e && e.message).slice(0, 120)); }
    }
  }
  for (const p of problems) fail('R7', p);
  if (!problems.length) pass('R7', totalChunks + ' 个 chunk（client+host，含将来新增）导出形态均为 string｜'
    + 'lib/client.cjs 浏览器同款求值 PARSE OK（污染 0 处）｜plugin-host.js 求值 PARSE OK（污染 0 处）');
}

console.log(failures ? ('\n✗ 门禁未通过（' + failures + ' 处）') : '\n✅ 死代码门禁通过');
// 状态行与下面的退出码**同源同处**产出：不另算一遍，免出第二个裁决点。
emitRingState('dead-code', failures ? 'FAIL' : 'PASS',
  failures ? failures + ' 处 FAIL（R1–R7）' : 'R1–R7 全过');
process.exitCode = failures ? 1 : 0;
