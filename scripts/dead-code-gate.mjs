'use strict';
// scripts/dead-code-gate.mjs —— 提交前死代码/断线接线门禁（f6fa822 半成品事故驱动）
// 用法: node scripts/dead-code-gate.mjs [--range A..B]   默认 HEAD~1..HEAD
// R1 diff 新增声明(src/**)全仓引用<2 → FAIL；R2 client chunk 未声明标识符 → FAIL
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

console.log(failures ? ('\n✗ 门禁未通过（' + failures + ' 处）') : '\n✅ 死代码门禁通过');
process.exitCode = failures ? 1 : 0;
