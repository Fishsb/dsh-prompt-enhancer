'use strict';
// 契约面收口批（2026-10-17）回归锁 —— 两个构建期 chunk 契约门**对称** + `decodeChunk` 单一事实源。
//
// 病历（本锁要防的形态）：
//   ① **契约门只存在于两半部的一半**：`build-client.mjs:83-97` 在构建期拒绝非字符串 chunk，
//      而 `build-host.mjs` **此前完全没有这道门**。两半部写**同一条**契约
//      （`module.exports = "<JSON 转义源码>"`）、用**同一种**注入
//      （`composed.replace(marker, chunk)`）⇒ 该不对称本身就是缺陷形态。
//   ② **同一契约手工多副本**：`test/**` 下曾有 **8 处** chunk 解码实现
//      （5 份 `decodeChunk` + 3 份内联/异名），**判别力不等**，实测：
//        · `test/filler.test.cjs` 那份**无守卫** ⇒ 裸 JS chunk 上抛的是
//          `TypeError: Cannot read properties of null (reading '1')` —— **不点名文件**、
//          也不是契约口径的裁决（实测复现）；
//        · `test/client-enhance-flow.test.cjs` 那份要求结尾恰为 `\n` ⇒ 在
//          `src/client/components/model-main-section.js`（以 `\r\n"` 结束）上 **NO-MATCH**。
//
// ⚠ 为什么必须单独锁：判据**存在** ≠ 判据**有牙**。门若被下一轮重构顺手删掉/改弱，
//   没有本锁则重归「只在一半有门 / 解码器各写一份」的旧状态。
// ⚠ 夹具策略与 `gate-gap-locks.test.cjs` / `dead-code-lib-gate.test.cjs` 同源（整仓副本 +
//   临时目录），**绝不碰真实工作区** —— 变异若留在真仓里会把"自证"变成"破坏"。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const EXCLUDE = new Set(['.git', 'node_modules', '.dsh-worktrees', 'test-reports', 'internal']);

// ⚠ 取具名成员解构（`require()` 一个 ESM 模块拿到命名空间对象，不可直接调用 —— 实测）。
const chunkDecode = require(path.join(ROOT, 'scripts', 'lib', 'chunk-decode.mjs'));
const { decodeChunkText, chunkWrapperLiteral } = chunkDecode;

/** 整仓副本（排除 .git/node_modules/报告/治理档）。 */
function mkFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !EXCLUDE.has(path.basename(src)) });
  return dir;
}
function withFixture(mutate, fn) {
  const dir = mkFixture();
  try { if (mutate) mutate(dir); return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const runScript = (dir, script, args = []) => {
  const p = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: p.status, out: String(p.stdout || '') + String(p.stderr || '') };
};
/** 把 chunk 文件改回**裸 JS**（= 本次事故的真实形态）。 */
function unwrapToBareJs(dir, rel) {
  const abs = path.join(dir, rel);
  fs.writeFileSync(abs, decodeChunkText(fs.readFileSync(abs, 'utf8'), rel), 'utf8');
}
/** 递归枚举某目录下的 chunk（与两个构建门同一口径）。 */
function listChunks(dir, relDir) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'vendor') walk(full); continue; }
      if (ent.name.endsWith('.js')) out.push(path.relative(dir, full));
    }
  };
  walk(path.join(dir, relDir));
  return out.sort();
}

// ─────────────── ① 两个构建期门**对称** ───────────────

test('CS-01 host 构建期契约门**在位**：源码面形态锁（两个半部都要有门）', () => {
  const host = fs.readFileSync(path.join(ROOT, 'scripts', 'build-host.mjs'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'scripts', 'build-client.mjs'), 'utf8');
  // 两处都必须在**源码面**就具备「导出形态是否 string」的判定 + 契约裁决（fail-closed）。
  // ⚠ 只锁**语义**（存在 string 形态判定 + 契约裁决），不锁两家逐字的写法差异：
  //   client 写 `filter(([, c]) => typeof c !== 'string')`（取违规集），
  //   host   写 `if (typeof value === 'string') continue;`（取通过集）—— 形态不同、判定等价。
  for (const [name, src] of [['build-host.mjs', host], ['build-client.mjs', client]]) {
    assert.match(src, /typeof\s+\w+\s*(?:!==|===)\s*'string'/,
      name + ' 必须有「导出形态是否 string」的判定（本批补的正是 host 侧的它）');
    assert.match(src, /chunk 契约/,
      name + ' 必须给出 chunk 契约违规的裁决（点名 + 抛错）');
  }
  // host 门必须**递归枚举**、不得写死文件名（将来新增自动入网）
  assert.match(host, /readdirSync/, 'build-host 的覆盖须为目录枚举（不得写死 5 个文件名）');
});

test('CS-02 host 门变异自证：任一 host chunk 改回裸 JS ⇒ **必红**且点名 marker', () => {
  withFixture((dir) => unwrapToBareJs(dir, path.join('src', 'host', 'models.js')), (dir) => {
    const r = runScript(dir, path.join('scripts', 'build-host.mjs'), ['--check']);
    assert.equal(r.code, 1, 'host chunk 契约违反必须 exit 1（若为 0 则该门是恒真判据 = 假绿）');
    // 点名 marker（本例 = models 的注入标记）与**实得类型**
    assert.match(r.out, /@dsh-models-inject/, '门必须点名违规 chunk 的 marker');
    assert.match(r.out, /src\/host\/models\.js/, '门必须点名违规 chunk 的文件');
    assert.match(r.out, /实得 object/, '门必须给出实得类型（不是只说"违反了"）');
  });
});

test('CS-03 host 门覆盖面：新增**未装配**的非字符串文件也入网（无硬编码）', () => {
  withFixture((dir) => {
    fs.writeFileSync(path.join(dir, 'src', 'host', 'brandnew.js'), "'use strict';\nmodule.exports = {};\n", 'utf8');
  }, (dir) => {
    const r = runScript(dir, path.join('scripts', 'build-host.mjs'), ['--check']);
    assert.equal(r.code, 1, '新增的非字符串 chunk 必须入网（否则覆盖面是硬编码的）');
    assert.match(r.out, /brandnew\.js/, '必须点名新增文件（证明是目录枚举而非固定清单）');
  });
});

test('CS-04 host 门 fail-closed：src/host 目录缺位 ⇒ 不得静默判绿', () => {
  withFixture((dir) => { fs.rmSync(path.join(dir, 'src', 'host'), { recursive: true, force: true }); }, (dir) => {
    const r = runScript(dir, path.join('scripts', 'build-host.mjs'), ['--check']);
    assert.equal(r.code, 1, '扫描面缺位必须非 0 退出（不得"没有就不判"）');
  });
});

test('CS-05 两门对拍：同一变异形态下，client 门与 host 门**都得给出裁决**（对称性）', () => {
  // client 侧（既有门）：改回裸 JS ⇒ 必红
  withFixture((dir) => unwrapToBareJs(dir, path.join('src', 'client', 'voice', 'recorder.js')), (dir) => {
    const r = runScript(dir, path.join('scripts', 'build-client.mjs'), ['--check']);
    assert.equal(r.code, 1, 'client 既有门必须仍判红（本批不得改弱它）');
    assert.match(r.out, /chunk 契约违反/, 'client 门仍须给出契约裁决');
  });
  // host 侧（本批补的门）：同一形态 ⇒ 同样判红
  withFixture((dir) => unwrapToBareJs(dir, path.join('src', 'host', 'pure.js')), (dir) => {
    const r = runScript(dir, path.join('scripts', 'build-host.mjs'), ['--check']);
    assert.equal(r.code, 1, 'host 门必须与 client 门同形判红');
    assert.match(r.out, /chunk 契约违反/, 'host 门须给出与 client 同形的契约裁决');
  });
});

// ─────────────── ② `decodeChunk` 单一事实源 ───────────────

test('CS-06 单一事实源：test/ 面**不得**再出现任何内联 chunk 解码实现', () => {
  // ⚠ 判定前先剥注释行：本批的迁移注释里**引用**了旧正则原文（病历性说明），
  //   那是溯源信息、不是副本；只有**代码行**里的解码腿才算副本。
  // ⚠ 本文件自身豁免：CS-08/CS-09 必须**持有**旧正则才能对拍判别力（否则空转）。
  const SELF = path.basename(__filename);
  const dir = path.join(ROOT, 'test');
  const offenders = [];
  const stripCommentLines = (src) => src.split('\n')
    .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.name.endsWith('.cjs') && !ent.name.endsWith('.mjs')) continue;
      if (ent.name === SELF) continue;
      const src = stripCommentLines(fs.readFileSync(full, 'utf8'));
      // 内联解码的两种真实代码形态：
      //   ① raw.match(/module\.exports ... "([\s\S]*)"/) —— 自带包裹正则
      //   ② JSON.parse('"' + … + '"')            —— 自做 JSON 转义还原
      if (/\.match\(\s*\/module\\?\.exports/.test(src)) offenders.push(path.relative(ROOT, full) + '（自带包裹正则）');
      if (/JSON\.parse\(\s*'"'\s*\+/.test(src)) offenders.push(path.relative(ROOT, full) + '（自做 JSON 还原）');
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [],
    'test/ 面不得再自带 chunk 解码副本（收敛到 scripts/lib/chunk-decode.mjs）：' + offenders.join(', '));
});

test('CS-07 共享解码器 fail-closed 且**点名声**：裸 JS / 空文件 / 无包裹 三种形态', () => {
  // 裸 JS
  assert.throws(() => decodeChunkText('var A = 1;\nfunction f() {}\n', 'SENTINEL-BARE.js'),
    (e) => e instanceof Error && e.message.includes('SENTINEL-BARE.js') && /chunk wrapper mismatch/.test(e.message),
    '裸 JS 必须抛契约错误并点名文件（旧 filler 实现抛的是不点名的 TypeError —— 实测）');
  // 空文件
  assert.throws(() => decodeChunkText('', 'SENTINEL-EMPTY.js'),
    (e) => e.message.includes('SENTINEL-EMPTY.js'), '空文件必须点名');
  // 无包裹（普通 JS 模块）
  assert.throws(() => decodeChunkText("'use strict';\nmodule.exports = { a: 1 };\n", 'SENTINEL-OBJ.js'),
    (e) => e.message.includes('SENTINEL-OBJ.js'), '对象导出必须点名');
  // 负控：合法包裹必须解出且**不抛**
  const ok = decodeChunkText('module.exports = "var x = 1;";\n', 'SENTINEL-OK.js');
  assert.equal(ok, 'var x = 1;', '合法包裹必须正确解出（负控）');
});

test('CS-08 判别力**只升不降**：旧 `client-enhance-flow` 正则的覆盖洞不得复发', () => {
  // 病历：旧变体要求结尾恰为 `\n`，在 `model-main-section.js`（以 `\r\n"` 结束）上 NO-MATCH。
  // 共享解码器必须能解出它 —— 这是本批实测发现的**真实覆盖洞**，锁住防回归。
  const rel = path.join('src', 'client', 'components', 'model-main-section.js');
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const OLD = /module\.exports\s*=\s*"([\s\S]*)";?\s*\n$/;
  assert.equal(raw.match(OLD), null, '夹具前提：该 chunk 在旧正则下应 NO-MATCH（否则本断言空转）');
  const now = decodeChunkText(raw, rel);
  assert.ok(now.length > 0, '共享解码器必须能解出该 chunk（判别力上升的证据）');
});

test('CS-09 取值等价：共享解码器与旧实现口径在**全部** chunk 上逐字同值', () => {
  const chunks = [...listChunks(ROOT, path.join('src', 'client')), ...listChunks(ROOT, path.join('src', 'host'))];
  assert.ok(chunks.length >= 29, '扫描面应含 client+host 全部 chunk（实测 29 件），实得 ' + chunks.length);
  const OLD_LOOSE = /module\.exports\s*=\s*"([\s\S]*)";?\s*$/;
  for (const rel of chunks) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = raw.match(OLD_LOOSE);
    assert.ok(m, rel + ' 应为包裹形态（本批不得放宽）');
    assert.equal(decodeChunkText(raw, rel), JSON.parse('"' + m[1] + '"'),
      rel + ' 共享解码器取值必须与旧实现逐字相同（本批不得改浅既有断言）');
  }
});

test('CS-10 行首锚定仍生效：头部注释里的 decoy 包裹不得把解码带偏', () => {
  // 依据：official-bridge 那份旧实现特意用行首锚定，注释里可能含代码样文本。
  const decoy = '// module.exports = "DECOY"\nconst A = 1;\nmodule.exports = "REAL";\n';
  assert.equal(decodeChunkText(decoy, 'SENTINEL-DECOY.js'), 'REAL',
    '行首锚定必须取到**真**包裹，而不是注释里的 decoy');
  assert.equal(chunkWrapperLiteral(decoy), 'REAL', '捕获组须为真包裹内容');
});

test('CS-11 负控：真实工作区不动 ⇒ 两个构建门与全部受影响测试**必绿**', () => {
  // 两门负控（真实工作区）
  for (const s of ['build-host.mjs', 'build-client.mjs']) {
    const r = runScript(ROOT, path.join('scripts', s), ['--check']);
    assert.equal(r.code, 0, s + ' --check 在未改动的真实工作区必须绿：' + r.out);
  }
  // 共享解码器在真实仓上可用（真值非空）
  const real = decodeChunkText(fs.readFileSync(path.join(ROOT, 'src', 'host', 'pure.js'), 'utf8'), 'src/host/pure.js');
  assert.ok(real.length > 0, '真实仓的 host chunk 必须可解出');
});

// ─────────────── ③ host 侧无门时期的历史产物是否干净（只读核） ───────────────

test('CS-12 历史产物只读核：现有 plugin-host.js **不得**含对象字符串化污染', () => {
  // 由来：`build-host.mjs` 此前无门 ⇒ 需排查"host 侧是否也曾在无门状态下构建过"。
  // 判据：产物内 `[object Object]` 出现次数 = 0（若 >0 说明曾把对象注入产物）。
  const prod = fs.readFileSync(path.join(ROOT, 'plugin-host.js'), 'utf8');
  const hits = (prod.match(/\[object Object\]/g) || []).length;
  assert.equal(hits, 0, 'plugin-host.js 不得含 [object Object]（本批只读核，未改该产物）');
  // 并且当前门上马后，产物仍可被 `lib/index.cjs` 同款方式求值
  assert.doesNotThrow(() => new Function('harness', prod), 'plugin-host.js 必须可求值（装载点同款）');
});
