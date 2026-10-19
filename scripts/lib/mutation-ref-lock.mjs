// scripts/lib/mutation-ref-lock.mjs —— `甲-7` 静态锁：变异自证的基准不得是浮动的 `HEAD`
//
// ═══════════════════════════════════════════════════════════════════════════════
// 这一条锁挡的是什么（先读这段，再读代码）
// ═══════════════════════════════════════════════════════════════════════════════
//
// 病历（`CHG-272` 实测，`CHG-273` 治定）：`test/correction-status.test.cjs` 的三条
// 「真实文件级回退变异自证」（`D-V1`/`C-V1`/`C-V2`）曾用 `git show HEAD:<path>` 取
// 「缺陷原形」当基准。而 `HEAD` 是**浮动**的 —— 那次修复一提交，`HEAD` 就变成了修复
// 本身 ⇒ 取到**修好**形态 ⇒ 前置断言「HEAD 仍是缺陷原形」先破 ⇒ 判据**恒红**。
// 现象：**提交前全绿、提交后红**，而五环门禁全绿、`FIX-SRC` 也不红（它只比对夹具字节）。
//
// ⇒ 本锁判的就是那个姿势：**取基准时，ref 实参不得是浮动的 `HEAD`**。
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠⚠ 覆盖边界（**比「全绿」重要，别跳过这一节**）
// ═══════════════════════════════════════════════════════════════════════════════
//
// **它抓得住**（规则 R1–R3，见 RULES）：
//   ① 直接传字面量：`chunkAtRef('x.js', 'HEAD')` / `gitAt('HEAD')` / `show('HEAD')`
//   ② 不传 ref ⇒ 走函数默认值，而该函数的默认值**在本文件内**可被解析为浮动 ref
//      （`function f(rel, ref) { … (ref || 'HEAD') … }` 或 `ref = 'HEAD'`）
//   ③ 通过局部常量间接传：`const BASE = 'HEAD'; chunkAtRef('x.js', BASE)`
//      （单层解析；见 R3）
//
// **它抓不住**（如实登记，⛔ 不要以为锁了就万事大吉）：
//   ④ **多层间接**：`const A = 'HEAD'; const B = A; f(B)` —— 只解析**单层**常量。
//   ⑤ **拼接构造**：`'HE' + 'AD'` / `['HEAD'].join('')` / `String.fromCharCode(72,69,65,68)`
//      —— 本锁是**字面量模式匹配**，不做字符串求值。
//   ⑥ **跨文件默认值**：默认 ref 定义在**另一个文件**里（本文件看不到），只能靠 R2 的
//      「同文件内默认值」判定，跨文件不解析。
//   ⑦ **非 `HEAD` 的浮动 ref**：`'main'` / `'origin/main'` / `'HEAD~1'` / `'@{u}'` ——
//      这些**也会随提交漂移**，但本锁按设计**只盯 `HEAD` 这一个字面量**
//      （理由：`HEAD` 是仓内唯一真实出现过的形态；盯住它可以零假阳性，见 R4）。
//   ⑧ **从 git 之外取「当前提交」**：例如读 `package.json` 的 version 当基准、读
//      `process.env.GIT_COMMIT` —— 那是另一类漂移，本锁不管。
//   ⑨ **`HEAD~N` 的语义漂移**：`HEAD~1` 不随提交变化**这一说法是错的**（它永远指"上一
//      个提交"，提交一次就换了对象）。⛔ 但本锁**不拦 `HEAD~N`** —— 因为 `dead-code-gate`
//      的 `--range HEAD~1..HEAD` 等**合法用途**正是这个形态，拦了就是假阳性。
//      ⇒ **结论：`HEAD~N` 那条路本锁不管，靠人载**（`PROJECT.md` `C-41` 已写明）。
//
// ⚠ **一句话**：本锁挡的是「**把浮动 `HEAD` 当不动的基准**」这个**具体姿势**，
//   ⛔ 不是「所有历史漂移问题」。能绕过去的写法在上面 ④–⑨ 逐条列了。
//
// ═══════════════════════════════════════════════════════════════════════════════
// 允许清单（ALLOW）—— 每条必须带理由，⛔ 不得为了变绿往里塞
// ═══════════════════════════════════════════════════════════════════════════════
//
// 仓内**存在合法**的 `HEAD` 用法：那与「缺陷原形基准」是两件事。逐处列出见 ALLOW。
// ⚠ 匹配粒度 = **`文件:行号` + 该行必须含 `must` 子串**（双重约束，防止行号漂移后误放行）。
//
// 设计约束（作业书硬要求，逐条落实）：
//   · **假阳性与漏报一样糟** ⇒ 每条允许项必须有理由，且匹配到具体行 + 上下文子串。
//   · **fail-closed** ⇒ 扫描面为空 / 文件数异常少 / 解析退化 ⇒ 抛错（调用方判红）。
//     见 `assertScanSurfaceHealthy()`。
//   · **自证双向** ⇒ `selfTest()` 在内存里造违规/合法样本，两个方向都必须判对。

import fs from 'node:fs';
import path from 'node:path';

/** 浮动 ref 的唯一目标（见覆盖边界 ⑦：只盯 `HEAD`，不盯 `main`/`HEAD~N` 等）。 */
const FLOATING_REF = 'HEAD';

/**
 * 允许清单：仓内**合法**的 `HEAD` 用法。
 *
 * 匹配规则：`{ file, line, must }` —— 该文件该行**必须**含 `must` 子串才算命中放行。
 * ⚠ 为什么要 `must`：单纯按行号放行，一旦文件上方增删行，行号漂移就会**误放行**
 *   一条其实违规的用法（假阴性）；带 `must` 后，漂移会变成「放行不生效 ⇒ 判红」，
 *   属**安全方向**的失败。
 */
export const ALLOW = [
  {
    file: 'test/dead-code-lib-gate.test.cjs',
    line: 124,
    must: "runGate(dir, ['--range', 'HEAD'])",
    why: '断言 `R5 不随 --range 变化` —— 它**故意**用 `--range HEAD` 与默认区间对比，证明两者读数相同。此处 `HEAD` = "当前提交"，是被测对象的**语义前提**，不是"缺陷原形基准"。',
  },
];

/**
 * 扫描面**之外**的 `HEAD` 用法（逐处登记，供 `grep` 覆盖核对）。
 *
 * ⚠ 为什么它们不进 ALLOW：**扫描面只有 `test/**`**（变异自证只存在于测试面）。
 *   把它们塞进 ALLOW 会让 `allAllowUsed` 永远为 false（永远有未命中的允许项），
 *   从而丧失「允许清单是否过期」这一信号。⇒ 分开登记、分开校验。
 *
 * ⚠ 为什么扫描面不含 `scripts/**`：本仓 `scripts/` 里**没有任何变异自证**
 *   （`settings-text-audit-mutations.mjs` 的 "mutations" 指 **UI 文案变异装置**，
 *   它的 `HEAD_LIT` 是个字符串常量名，与 git ref 无关 —— 实测 `grep HEAD` 命中 5 处
 *   全是该常量）。⇒ 把 scripts/ 纳入扫描面只会引入噪声，不会多抓一个真问题。
 */
export const OUT_OF_SURFACE = [
  {
    file: 'scripts/arch-claims.mjs',
    line: 1174,
    must: "execFileSync('git', ['rev-parse', '--short', 'HEAD']",
    why: '取 `--write` 当时的 HEAD 记进投影（A-2），是**元数据**不是判据基准；且只在 --write 时出现、不进逐字比对区。',
  },
  {
    file: 'scripts/dead-code-gate.mjs',
    line: 19,
    must: "args.includes('--range') ? args[args.indexOf('--range') + 1] : 'HEAD~1..HEAD'",
    why: 'diff 区间的**默认值**（`HEAD~1..HEAD`）。gate 用它判「本次新增了什么」，不是「拿 HEAD 当不动的基准」。',
  },
  {
    file: 'scripts/dead-code-gate.mjs',
    line: 55,
    must: "RANGE === 'HEAD' ? ['diff', '--unified=0', 'HEAD']",
    why: '`--range HEAD` 模式：判「工作树 vs HEAD」的**现状**（R5 等非 diff 判据用）。同样是把 HEAD 当「当前提交」读，不是当不变基准。',
  },
];

/** 待扫描目录（相对仓库根）。只扫测试面 —— 变异自证只存在于 `test/**`。 */
const SCAN_DIRS = ['test'];

/**
 * 扫描面健康度下限（**fail-closed 的核心**）。
 * ⚠ 这两个数是"异常少"的判据，不是"期望值"：本仓现有 34 个测试文件，
 *   下限取它的一半再留余量 ⇒ **掉到 17 以下就说明扫描面出了问题**（目录搬了/权限变了/
 *   后缀改了），此时**必须红**，⛔ 不许"扫到的少所以违规也少"地判绿。
 */
const MIN_FILES = 17;
const MIN_BYTES = 100 * 1024; // 100 KiB：34 个测试文件总量级远在此之上

/**
 * 解析规则（每条都给"为什么这么写"）。
 *
 * R1 —— **ref 位置上的字面量 `'HEAD'`**：`f(rel, 'HEAD')` / `f('HEAD')` / `git('show','HEAD:x')`
 *   形态：调用实参或数组元素里出现 `'HEAD'` / `"HEAD"`（或模板串 `` `HEAD` ``），
 *   且**不在允许清单内**。这是最直接的违规姿势（`CHG-272` 就是这一种）。
 *   排除：`'HEAD~1..HEAD'` / `'HEAD:src/x'` 这类**非纯 HEAD** 字符串（它们是区间/路径表达式，
 *   不是"取原形的 ref"；且 `HEAD~` 见覆盖边界 ⑨）。
 *
 * R2 —— **函数默认值里的浮动 ref**：本文件内定义 `function f(rel, ref) { …(ref || 'HEAD')… }`
 *   或 `ref = 'HEAD'`，且该函数**被调用时未传 ref** ⇒ 等价于 R1（默认值会落到调用点）。
 *
 * R3 —— **单层常量间接**：`const BASE = 'HEAD'` / `const BASE = "HEAD"`，然后 `f(rel, BASE)`。
 *   ⚠ 只解析**单层**（覆盖边界 ④ 已写明多层不追）。
 */

/** R1：匹配"纯 HEAD"字符串字面量（排除 HEAD~N / HEAD:path / 区间表达式）。 */
const RE_PURE_HEAD_LITERAL = /(['"`])HEAD\1/g;

/** R1b：HEAD 作为 args 数组元素的形态（`'show', 'HEAD:...'` 不算纯 HEAD，但 `'HEAD'` 算）。 */
const RE_ARG_HEAD = /\bHEAD\b/;

/**
 * L 类（合法）：**读"当前提交"**，不是"取缺陷原形当基准"。
 *   · `rev-parse` + `HEAD`：取当前提交标识（`arch-claims --write` 记 HEAD 属此类）
 *   · `HEAD~1..HEAD` / `HEAD~N`：diff 区间（`dead-code-gate` 默认值属此类）
 *   · `HEAD:<path>`：以当前提交的路径取文件内容（区间/前缀表达式，非纯 ref）
 * ⚠ 这三类**也会随提交变**，但它们**不是"基准"** —— 抗的是"浮动基准"这个姿势，
 *   不是"所有会变的东西"。详见头注「覆盖边界」。
 */
const RE_CURRENT_REV = /rev-parse[^\n]*HEAD|HEAD~\d|HEAD\^|HEAD:[^'"\s]/;

/** R2：函数参数默认值 / `(ref || 'HEAD')` 形态。 */
const RE_FN_DEFAULT = /(?:ref\s*=\s*|ref\s*\|\|\s*)(['"`])HEAD\1/;

/** R3：单层常量绑定。 */
const RE_CONST_HEAD = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])HEAD\2/;

/** 注释剔除（保留行号：把注释内容换成等长空格）。 */
export function stripCommentsKeepLines(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { mode = 'sq'; out += c; i += 1; continue; }
      if (c === '"') { mode = 'dq'; out += c; i += 1; continue; }
      if (c === '`') { mode = 'tpl'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } else { out += ' '; } i += 1; continue; }
    if (mode === 'block') {
      if (c === '*' && c2 === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' '); i += 1; continue;
    }
    // 字符串/模板内：原样保留（我们要判的正是字符串字面量），但要认出转义
    if (c === '\\') { out += c + (c2 === undefined ? '' : c2); i += 2; continue; }
    if (mode === 'sq' && c === "'") { mode = 'code'; out += c; i += 1; continue; }
    if (mode === 'dq' && c === '"') { mode = 'code'; out += c; i += 1; continue; }
    if (mode === 'tpl' && c === '`') { mode = 'code'; out += c; i += 1; continue; }
    out += c; i += 1;
  }
  return out;
}

/**
 * 扫描**一个文件的文本**，返回违规列表。纯函数（便于自证）。
 *
 * @param {string} relFile 相对路径（用于允许清单匹配与输出）
 * @param {string} raw 原文
 * @returns {{violations: Array<{file:string,line:number,rule:string,text:string,why:string}>, usedAllow: Set<string>}}
 */
export function scanSource(relFile, raw) {
  const code = stripCommentsKeepLines(raw);
  const lines = code.split('\n');
  const rawLines = raw.split('\n');
  const violations = [];
  const usedAllow = new Set();

  // ── 允许清单：按 文件 + 行号 + must 三重匹配，命中即标记该行豁免 ──
  const allowedLines = new Map(); // line → allowEntry
  for (const a of ALLOW) {
    if (a.file !== relFile) continue;
    const idx = a.line - 1;
    const rawLine = rawLines[idx] || '';
    if (rawLine.includes(a.must)) {
      allowedLines.set(a.line, a);
      usedAllow.add(a.file + ':' + a.line);
    }
    // ⚠ must 不命中 ⇒ **不放行**（安全方向的失败：可能因行号漂移，会让它判红）
  }

  // ── R3：先收集本文件的单层常量 ──
  const constNames = new Set();
  for (const ln of lines) {
    const m = ln.match(RE_CONST_HEAD);
    if (m) constNames.add(m[1]);
  }

  // ── R2：收集"默认值浮动"的函数名 ──
  const floatDefaultFns = new Set();
  const fnHdrRe = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
  let fm;
  while ((fm = fnHdrRe.exec(code)) !== null) {
    const fnName = fm[1];
    const params = fm[2];
    // 在函数体内找 `(ref || 'HEAD')` 或 `ref = 'HEAD'`
    const bodyStart = code.indexOf('{', fm.index);
    if (bodyStart < 0) continue;
    let depth = 0; let end = bodyStart;
    for (let k = bodyStart; k < code.length; k++) {
      if (code[k] === '{') depth++;
      else if (code[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    const body = code.slice(bodyStart, end);
    if (RE_FN_DEFAULT.test(body)) {
      // 该函数的 ref 参数名（第二个参数优先，否则找体里出现的 ref 类名字）
      const names = params.split(',').map((s) => s.trim().split(/[=\s]/)[0]).filter(Boolean);
      const refName = names[1] || 'ref';
      floatDefaultFns.add(fnName + '|' + refName);
    }
  }

  // ── 逐行判 R1 / R2 / R3 ──
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const codeLine = lines[i];
    const rawLine = rawLines[i] || '';
    if (allowedLines.has(lineNo)) continue;

    // L-class 合法形态：**读"当前提交"本身**，不是"取缺陷原形当基准"。
    //   · `rev-parse HEAD` / `['rev-parse','--short','HEAD']` —— 取当前提交标识（元数据）
    //   这些是仓内真实存在的合法用法（见 ALLOW），也是本锁**必须不误伤**的那一类。
    //   ⚠ 判定顺序纪律：先排除合法，再判违规 —— 否则 `rev-parse HEAD` 会被 R1 冤枉。
    const isCurrentRevRead = RE_CURRENT_REV.test(codeLine);

    // R1：纯 HEAD 字面量
    RE_PURE_HEAD_LITERAL.lastIndex = 0;
    if (!isCurrentRevRead && RE_PURE_HEAD_LITERAL.test(codeLine) && RE_ARG_HEAD.test(codeLine)) {
      violations.push({
        file: relFile, line: lineNo, rule: 'R1',
        text: rawLine.trim().slice(0, 160),
        why: 'ref 位置出现浮动 `HEAD` 字面量 ⇒ 一旦提交，基准就换成修好形态 ⇒ 判据会恒红或恒绿。',
      });
      continue;
    }

    // R2：调用了"默认值浮动"的函数、且未传第二个实参
    for (const key of floatDefaultFns) {
      const [fnName] = key.split('|');
      const callRe = new RegExp('\\b' + fnName.replace(/\$/g, '\\$') + '\\s*\\(([^)]*)\\)', 'g');
      let cm;
      while ((cm = callRe.exec(codeLine)) !== null) {
        const argsStr = cm[1];
        // 粗粒度计参：按逗号切，忽略嵌套（本仓形态足够）
        const args = argsStr.split(',').filter((s) => s.trim() !== '');
        if (args.length < 2) {
          violations.push({
            file: relFile, line: lineNo, rule: 'R2',
            text: rawLine.trim().slice(0, 160),
            why: '调用 ' + fnName + '() 时未传 ref ⇒ 落到该函数的浮动默认值 `HEAD`。',
          });
        }
      }
    }

    // R3：单层常量间接
    for (const cname of constNames) {
      const reUse = new RegExp('\\b' + cname.replace(/\$/g, '\\$') + '\\b');
      if (reUse.test(codeLine) && !RE_CONST_HEAD.test(codeLine)) {
        violations.push({
          file: relFile, line: lineNo, rule: 'R3',
          text: rawLine.trim().slice(0, 160),
          why: '经常量 `' + cname + '`（= 浮动 `HEAD`）间接传作 ref。',
        });
        break;
      }
    }
  }

  return { violations, usedAllow };
}

/**
 * **fail-closed 守卫**：扫描面不健康 ⇒ 抛错（调用方据此判红）。
 * ⛔ 绝不"扫到的少所以判绿"。
 */
export function assertScanSurfaceHealthy(surface, opts = {}) {
  const minFiles = opts.minFiles !== undefined ? opts.minFiles : MIN_FILES;
  const minBytes = opts.minBytes !== undefined ? opts.minBytes : MIN_BYTES;
  if (!surface || !Array.isArray(surface.files)) {
    throw new Error('扫描面缺失（fail-closed ⇒ 不得判绿）：未提供 files 数组');
  }
  if (surface.files.length === 0) {
    throw new Error('扫描面为空（fail-closed ⇒ 不得判绿）：0 个文件。'
      + '可能原因：目录被搬/后缀改了/权限不足 —— 这属"扫不到"，⛔ 不是"没有违规"。');
  }
  if (surface.files.length < minFiles) {
    throw new Error('扫描面异常少（fail-closed ⇒ 不得判绿）：只有 ' + surface.files.length
      + ' 个文件 < 下限 ' + minFiles + '。⛔ 不许"扫得少所以违规少"地判绿。');
  }
  if (typeof surface.totalBytes === 'number' && surface.totalBytes < minBytes) {
    throw new Error('扫描面总字节异常少（fail-closed ⇒ 不得判绿）：' + surface.totalBytes
      + ' B < 下限 ' + minBytes + ' B。解析退化或文件被截断时会出现这一形态。');
  }
  return true;
}

/**
 * 扫描整个仓库的测试面。**只读**（读文件），不启 git 子进程、不启浏览器。
 */
export function scanRepo(root) {
  const files = [];
  let totalBytes = 0;
  const violations = [];
  const usedAllow = new Set();

  for (const dir of SCAN_DIRS) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) { walk(p); continue; }
        if (!ent.name.endsWith('.cjs')) continue; // 只扫测试用例（fixtures/*.js 是缺陷原形，故意保留旧码）
        const raw = fs.readFileSync(p, 'utf8');
        const rel = path.relative(root, p).split(path.sep).join('/');
        files.push(rel);
        totalBytes += Buffer.byteLength(raw, 'utf8');
        const r = scanSource(rel, raw);
        violations.push(...r.violations);
        for (const u of r.usedAllow) usedAllow.add(u);
      }
    };
    walk(full);
  }

  return { files, totalBytes, violations, usedAllow, allAllowUsed: ALLOW.every((a) => usedAllow.has(a.file + ':' + a.line)) };
}

/**
 * ⭐ 双向自证（内存构造，⛔ 不落盘）：违规样本必须判违规，合法样本必须判合法。
 * 返回逐例读数，供测试断言。
 */
export function selfTest() {
  const cases = [];

  // ── 违规样本（都必须被判违规） ──
  cases.push({
    name: 'V1 直接传 HEAD 字面量',
    expect: 'violate',
    src: "const s = gitShow('src/x.js', 'HEAD');\n",
  });
  cases.push({
    name: 'V2 单引号 HEAD 作首参',
    expect: 'violate',
    src: "const s = chunkAtRef('HEAD');\n",
  });
  cases.push({
    name: 'V3 经单层常量间接',
    expect: 'violate',
    src: "const BASE = 'HEAD';\nconst s = gitShow('src/x.js', BASE);\n",
  });
  cases.push({
    name: 'V4 函数默认值浮动 + 调用未传 ref',
    expect: 'violate',
    src: "function at(rel, ref) {\n  const r = run(['show', (ref || 'HEAD') + ':' + rel]);\n  return r;\n}\nat('src/x.js');\n",
  });
  cases.push({
    name: 'V5 注释掉的 HEAD 不豁免真实违规（同行）',
    expect: 'violate',
    src: "const s = gitShow('src/x.js', 'HEAD'); // 这里也可以写 HEAD\n",
  });

  // ── 合法样本（都必须判合法） ──
  cases.push({
    name: 'L1 当前提交对照：rev-parse HEAD（非基准）',
    expect: 'ok',
    src: "const rev = execFileSync('git', ['rev-parse', '--short', 'HEAD']);\n",
  });
  cases.push({
    name: 'L2 diff 区间 HEAD~1..HEAD',
    expect: 'ok',
    src: "const R = 'HEAD~1..HEAD';\nconst out = git(['diff', '--unified=0', R]);\n",
  });
  cases.push({
    name: 'L3 HEAD 作路径前缀（show HEAD:src/x）',
    expect: 'ok',
    src: "const s = git(['show', 'HEAD:src/x.js']);\n",
  });
  cases.push({
    name: 'L4 纯注释里的 HEAD（无代码用法）',
    expect: 'ok',
    src: "// 曾经用 git show HEAD:<path> 当基准，现已改为冻结夹具\nconst s = readFixture('x.js');\n",
  });
  cases.push({
    name: 'L5 基线读固化夹具（无 git 引用）',
    expect: 'ok',
    src: "function defectFormAt(name) {\n  return decode(fs.readFileSync(path.join(DIR, name), 'utf8'));\n}\nconst s = defectFormAt('voice-section.js');\n",
  });

  const results = cases.map((c) => {
    let got;
    let err = null;
    try {
      const r = scanSource('__selftest__/' + c.name.replace(/\s+/g, '-') + '.cjs', c.src);
      got = r.violations.length > 0 ? 'violate' : 'ok';
    } catch (e) {
      got = 'error';
      err = String(e && e.message);
    }
    return { name: c.name, expect: c.expect, got, pass: got === c.expect, err };
  });

  return { results, allPass: results.every((r) => r.pass) };
}
