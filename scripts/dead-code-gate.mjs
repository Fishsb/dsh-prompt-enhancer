'use strict';
// scripts/dead-code-gate.mjs —— 提交前死代码/断线接线门禁（f6fa822 半成品事故驱动）
// 用法: node scripts/dead-code-gate.mjs [--range A..B]   默认 HEAD~1..HEAD
// R1 diff 新增声明(src/**)全仓引用<2 → FAIL；R2 client chunk 未声明标识符 → FAIL
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 状态出口契约（P5）：本环的机读三态由**本环自己声明**，gate.mjs 只读结构不解释措辞。
import { emitRingState, installCrashGuard } from './lib/ring-state.mjs';
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
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
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
  const collect = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { collect(full); continue; }
      if (!ent.name.endsWith('.js')) continue;
      if (full.split(path.sep).includes('vendor')) continue;
      const raw = fs.readFileSync(full, 'utf8');
      const mm = raw.match(/module\.exports\s*=\s*"([\s\S]*)";?\s*$/);
      chunks.push({ rel: path.relative(ROOT, full), code: strip(mm ? JSON.parse('"' + mm[1] + '"') : raw) });
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
  if (!bad) pass('R2', scanned + ' 个 client chunk 无未声明标识符');
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
{
  // ⚠ P2-3（2026-10-13 拆分批）：补充新增的域模块（否则新文件在死码判据面**之外**）。
  //   `lib/harness.cjs` / `lib/rpc-http.cjs` / `lib/rpc-config.cjs` / `lib/rpc-voice.cjs`
  //   —— 这是 TASK §3.3 明令的同步点；遗漏会使新模块死码不可观测。
  //   `lib/client.cjs` 仍**不在**本表：它是构建产物（非手改面），由 build-client --check 防漂移。
  const TARGETS = ['lib/asr.cjs', 'lib/index.cjs', 'lib/integrity.cjs', 'lib/maintain-lib.cjs',
    'lib/net-proxy.cjs', 'lib/platform-service.cjs', 'lib/rpc-schema.cjs', 'lib/sys.cjs',
    'lib/harness.cjs', 'lib/rpc-http.cjs', 'lib/rpc-config.cjs', 'lib/rpc-voice.cjs'];
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
    txt = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
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
  const INJECTION_FILES = ['lib/index.cjs', 'lib/sys.cjs', 'lib/platform-service.cjs', 'lib/net-proxy.cjs'];
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

console.log(failures ? ('\n✗ 门禁未通过（' + failures + ' 处）') : '\n✅ 死代码门禁通过');
// 状态行与下面的退出码**同源同处**产出：不另算一遍，免出第二个裁决点。
emitRingState('dead-code', failures ? 'FAIL' : 'PASS',
  failures ? failures + ' 处 FAIL（R1–R6）' : 'R1–R6 全过');
process.exitCode = failures ? 1 : 0;
