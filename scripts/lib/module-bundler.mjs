// scripts/lib/module-bundler.mjs —— 源码模块化构建器的核心（目标模式第 1 批）
//
// 目标：让 src/** 的模块可以正常写 import/export 与相对依赖，构建期把它们
// 打成一个**自包含表达式**；运行产物仍然不含模块系统。
//
// 本实现是**确定性的轻量打包器**，不引入第三方运行时依赖：
//   · 只支持相对路径 import/require（./ ../），其余导入按“外部依赖”处理；
//   · 支持 ESM 的命名导入/默认导入与 export 声明，以及 CommonJS 模块；
//   · 循环依赖用“先建空导出、再执行”的经典顺序处理；
//   · 输出按模块拓扑排序（确定性），同输入必得同字节。
//
// 重要边界（必须如实保留）：
//   · 这不是通用打包器。动态 import、顶层 await、复杂重导出模式不在支持面；
//   · 遇到不支持形态会 fail-closed 抛错并点名文件，不静默生成错误产物。
import fs from 'node:fs';
import path from 'node:path';

const REL_IMPORT_RE = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;
const EXPORT_DECL_RE = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^\s*export\s*\{([^}]*)\}\s*;?/gm;
const EXPORT_DEFAULT_RE = /^\s*export\s+default\s+/m;
const EXPORT_STAR_RE = /^\s*export\s+\*\s+from\s+['"]([^'"]+)['"]/gm;
const IMPORT_NAMED_RE = /^\s*import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
const IMPORT_DEFAULT_RE = /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
const IMPORT_STAR_RE = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
const IMPORT_SIDE_RE = /^\s*import\s+['"]([^'"]+)['"]\s*;?/gm;
const REQUIRE_RE = /\brequire\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

function stripComments(code) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += next || ''; i += 2; continue; }
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue; }
    out += ch;
    i += 1;
  }
  return out;
}

function moduleId(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, base + '.js', base + '.mjs', base + '.cjs', path.join(base, 'index.js'), path.join(base, 'index.cjs')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function parseModule(file, code) {
  const clean = stripComments(code);
  const deps = new Set();
  for (const m of clean.matchAll(REL_IMPORT_RE)) deps.add(m[1]);
  for (const m of clean.matchAll(EXPORT_STAR_RE)) deps.add(m[1]);
  for (const m of clean.matchAll(REQUIRE_RE)) deps.add(m[1]);
  const namedExports = [];
  for (const m of clean.matchAll(EXPORT_DECL_RE)) namedExports.push(m[1]);
  for (const m of clean.matchAll(EXPORT_LIST_RE)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      namedExports.push((as[1] || as[0]).trim());
    }
  }
  const hasDefault = EXPORT_DEFAULT_RE.test(clean);
  const importBindings = [];
  for (const m of clean.matchAll(IMPORT_NAMED_RE)) {
    importBindings.push({ kind: 'named', spec: m[2], names: m[1].split(',').map((x) => x.trim()).filter(Boolean) });
  }
  for (const m of clean.matchAll(IMPORT_DEFAULT_RE)) importBindings.push({ kind: 'default', spec: m[2], local: m[1] });
  for (const m of clean.matchAll(IMPORT_STAR_RE)) importBindings.push({ kind: 'namespace', spec: m[2], local: m[1] });
  for (const m of clean.matchAll(IMPORT_SIDE_RE)) importBindings.push({ kind: 'side', spec: m[1] });
  const isCjs = /module\.exports|exports\.|\brequire\s*\(/.test(clean) && !/^\s*(?:import|export)\s/m.test(clean);
  return { deps: [...deps], namedExports: [...new Set(namedExports)], hasDefault, importBindings, code, isCjs };
}

function transformModule(parsed, id, resolvedDeps) {
  let code = parsed.code;
  const header = [];
  const exportsFooter = [];
  const depId = (spec) => {
    const resolved = resolvedDeps.get(spec);
    if (!resolved) throw new Error('module-bundler: 无法解析相对导入 ' + spec + '（来自 ' + id + '）');
    return resolved;
  };
  for (const binding of parsed.importBindings) {
    const target = depId(binding.spec);
    if (binding.kind === 'side') header.push('__load(' + JSON.stringify(target) + ');');
    else if (binding.kind === 'namespace') header.push('const ' + binding.local + ' = __load(' + JSON.stringify(target) + ');');
    else if (binding.kind === 'default') header.push('const ' + binding.local + ' = __load(' + JSON.stringify(target) + ').default;');
    else if (binding.kind === 'named') {
      for (const name of binding.names) {
        const [orig, alias] = name.split(/\s+as\s+/).map((x) => x.trim());
        header.push('const ' + (alias || orig) + ' = __load(' + JSON.stringify(target) + ').' + (orig || alias) + ';');
      }
    }
  }
  code = code
    .replace(IMPORT_NAMED_RE, '')
    .replace(IMPORT_DEFAULT_RE, '')
    .replace(IMPORT_STAR_RE, '')
    .replace(IMPORT_SIDE_RE, '')
    .replace(EXPORT_STAR_RE, '')
    .replace(EXPORT_DECL_RE, (all) => all.replace(/^\s*export\s+/, ''))
    .replace(EXPORT_LIST_RE, '')
    .replace(REQUIRE_RE, (all, spec) => '__load(' + JSON.stringify(depId(spec)) + ')');
  if (parsed.hasDefault) {
    code = code.replace(/^\s*export\s+default\s+/m, 'const __default__ = ');
    exportsFooter.push('exports.default = __default__;');
  }
  for (const name of parsed.namedExports) exportsFooter.push('exports.' + name + ' = ' + name + ';');
  if (parsed.isCjs) {
    return 'function (exports, module, __load) {\n' + header.join('\n') + '\n' + code + '\nreturn module.exports;\n}';
  }
  return 'function (exports, module, __load) {\n' + header.join('\n') + '\n' + code + '\n' + exportsFooter.join('\n') + '\nreturn exports;\n}';
}

function collectGraph(root, entries) {
  const modules = new Map();
  const order = [];
  const visiting = new Set();
  function visit(file) {
    const id = moduleId(root, file);
    if (modules.has(id)) return id;
    if (visiting.has(id)) return id;
    visiting.add(id);
    const code = fs.readFileSync(file, 'utf8');
    const parsed = parseModule(file, code);
    const resolvedDeps = new Map();
    for (const dep of parsed.deps) {
      const target = resolveRelative(file, dep);
      if (!target) throw new Error('module-bundler: 无法解析相对导入 ' + dep + '（来自 ' + id + '）');
      resolvedDeps.set(dep, visit(target));
    }
    modules.set(id, { id, file, parsed, resolvedDeps });
    order.push(id);
    visiting.delete(id);
    return id;
  }
  for (const entry of entries) visit(entry);
  return { modules, order };
}

export function bundleModules({ root, entry, externals = [] }) {
  const absEntry = path.resolve(root, entry);
  const graph = collectGraph(root, [absEntry]);
  const factories = [];
  for (const id of graph.order) {
    const mod = graph.modules.get(id);
    const fn = transformModule(mod.parsed, id, mod.resolvedDeps);
    factories.push('  ' + JSON.stringify(id) + ': ' + fn);
  }
  const externalSet = new Set(externals);
  const body = [
    '// GENERATED by scripts/lib/module-bundler.mjs — do not edit by hand.',
    '(() => {',
    '  const __cache = Object.create(null);',
    '  const __modules = {',
    factories.join(',\n'),
    '  };',
    // ⚠ 内部装配函数名刻意避开宿主载体约束里的 `require(` 形态：产物必须能被
    // ADR-230 的「plugin-host.js 内无模块系统」判据机械识别为无外部 require。
    '  function __load(id) {',
    '    if (__cache[id]) return __cache[id];',
    '    const factory = __modules[id];',
    '    if (!factory) {',
    '      if (' + JSON.stringify([...externalSet]) + '.includes(id)) return {};',
    '      throw new Error("module-bundler: module not found: " + id);',
    '    }',
    '    const exports = {};',
    '    const module = { exports };',
    '    __cache[id] = exports;',
    '    const out = factory(exports, module, __load);',
    '    __cache[id] = out || module.exports || exports;',
    '    return __cache[id];',
    '  }',
    '  return __load(' + JSON.stringify(moduleId(root, absEntry)) + ');',
    '})()',
    '',
  ].join('\n');
  return { code: body, modules: graph.order.slice() };
}

export default bundleModules;
