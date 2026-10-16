'use strict';
// 门禁缺口批回归锁（2026-10-16）：三处「会掩盖问题」级的口径/判据缺口，逐条钉成机检。
//
// 病历（本锁要防的形态）：
//   ① `npm run build` 不含 sync-prompts ⇒ 只改 prompts/** 后跑 build，提示词改动从未进产物。
//      ⚠ 本批**实测复现且已定位归因**：该形态被既有 gate 的 prompts 环抓住（md 与 src/host/app.js
//        生成区不一致 ⇒ FAIL），故**不是**无判据的缺口；真正缺的是下面 ② 的产物面判据。
//   ② gate 的 prompts 环旧口径只比 «md ↔ src/host/app.js 生成区»，**不比 plugin-host.js**。
//      跑了 sync-prompts 但漏跑 build-host ⇒ 该环判绿，而**真正被装载的产物**里仍是旧提示词。
//      ⇒ 本批给该环补「产物面判据」：产物内同一生成区必须与刚算出的生成区逐字相同。
//   ③ scripts/build-host.mjs:88 把 JS 字符串长度（UTF-16 码元）标成 "bytes"（CJK 下差 ~10 万）。
//
// ⚠ 为什么必须单独锁：判据**存在** ≠ 判据**有牙**。「跑了 sync 漏跑 build」这一形态在修复前
//   实测为 exit 0（假绿），若只用一句注释记下，下一轮重构即可复长。
//   本文件把「② 必须变红 / 负控不得误报 / ③ 日志字节数必须与磁盘一致」钉成机检。
//
// ⚠ 夹具策略与 gate-chain-attribution.test.cjs 同源（整仓副本 + 临时目录），**绝不碰真实工作区**：
//   变异若留在真仓里会把「自证」变成「破坏」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const NL = String.fromCharCode(10);
const EXCLUDE = new Set(['.git', 'node_modules', '.dsh-worktrees', 'test-reports', 'internal']);

/** 整仓副本（排除 .git/node_modules/报告/治理档）；本锁判的是脚本行为，**不需要** git 元数据。 */
function mkFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-'));
  fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !EXCLUDE.has(path.basename(src)) });
  return dir;
}
function withFixture(fn) {
  const dir = mkFixture();
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const runScript = (dir, script, args = []) => {
  const p = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: p.status, out: String(p.stdout || '') + String(p.stderr || '') };
};
const PROMPT = path.join('prompts', 'enhance', 'discipline.md');
const readP = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const writeP = (dir, rel, s) => fs.writeFileSync(path.join(dir, rel), s, 'utf8');

/** 把夹具拉到「md / app.js 生成区 / 产物 三者一致」的干净态 */
function settle(dir) {
  assert.equal(runScript(dir, 'scripts/sync-prompts.mjs').code, 0, '夹具预置：sync-prompts 应成功');
  assert.equal(runScript(dir, 'scripts/build-host.mjs').code, 0, '夹具预置：build-host 应成功');
  const chk = runScript(dir, 'scripts/sync-prompts.mjs', ['--check']);
  assert.equal(chk.code, 0, '夹具预置：干净态下 prompts 环应绿：' + chk.out);
}

test('GAP-1 缺陷②变异自证：跑了 sync-prompts 而漏跑 build-host ⇒ prompts 环**必红**', () => {
  withFixture((dir) => {
    settle(dir);
    // 缺陷形态：改 md → 只跑 sync-prompts（app.js 生成区更新），**不跑** build-host
    writeP(dir, PROMPT, readP(dir, PROMPT) + NL + 'SENTINEL-GAP-2' + NL);
    const sync = runScript(dir, 'scripts/sync-prompts.mjs');
    assert.equal(sync.code, 0, '同步（写）调用应成功：' + sync.out);
    // 前置自检：缺陷形态**真的成立**——改动进了 app.js，但**没进**产物
    assert.ok(readP(dir, path.join('src', 'host', 'app.js')).includes('SENTINEL-GAP-2'),
      '夹具失效：改动应已进 src/host/app.js 生成区');
    assert.ok(!readP(dir, 'plugin-host.js').includes('SENTINEL-GAP-2'),
      '夹具失效：本形态下产物**不应**含该改动（否则验不到 ②）');
    // 判据：必须红，且归因指向「产物未同步」（不得只说「md 与生成区不一致」——那不是本形态的病因）
    const chk = runScript(dir, 'scripts/sync-prompts.mjs', ['--check']);
    assert.equal(chk.code, 1, '产物面判据必须判红（旧口径此处 exit 0 = 假绿）：' + chk.out);
    assert.match(chk.out, /产物未同步/, '归因须点明产物未同步：' + chk.out);
    assert.match(chk.out, /RING-STATE prompts FAIL/, '应输出 FAIL 契约行：' + chk.out);
  });
});

test('GAP-2 缺陷②负控：完整跑完 build（md→app.js→产物）⇒ **不得误报**，绿', () => {
  withFixture((dir) => {
    settle(dir);
    writeP(dir, PROMPT, readP(dir, PROMPT) + NL + 'SENTINEL-NC' + NL);
    assert.equal(runScript(dir, 'scripts/sync-prompts.mjs').code, 0);
    assert.equal(runScript(dir, 'scripts/build-host.mjs').code, 0, '补跑 build-host 后应回到一致态');
    assert.ok(readP(dir, 'plugin-host.js').includes('SENTINEL-NC'), '补跑后改动应已进产物');
    const chk = runScript(dir, 'scripts/sync-prompts.mjs', ['--check']);
    assert.equal(chk.code, 0, '完整管线后不得误报：' + chk.out);
    assert.match(chk.out, /RING-STATE prompts PASS/, '应输出 PASS 契约行：' + chk.out);
  });
});

test('GAP-3 缺陷②负控：无任何改动（原样仓）⇒ 绿；且真实工作区同样绿', () => {
  withFixture((dir) => {
    settle(dir);
    const chk = runScript(dir, 'scripts/sync-prompts.mjs', ['--check']);
    assert.equal(chk.code, 0, '原样仓不得误报：' + chk.out);
  });
  // 真实工作区（非副本）同判：本批改动不得把真仓判红
  const real = runScript(ROOT, path.join('scripts', 'sync-prompts.mjs'), ['--check']);
  assert.equal(real.code, 0, '真实工作区应绿（本批未改 prompts 内容面）：' + real.out);
});

test('GAP-4 缺陷②负控：**手改产物**生成区 / 产物缺位 ⇒ 必红（fail-closed）', () => {
  withFixture((dir) => {
    settle(dir);
    // 甲：手改产物内生成区（不改 md / 不改 app.js）
    const prod = readP(dir, 'plugin-host.js').replace('const DISCIPLINE_PROMPT = [',
      "const DISCIPLINE_PROMPT = [" + NL + "  'TAMPERED-BY-HAND',");
    writeP(dir, 'plugin-host.js', prod);
    const a = runScript(dir, 'scripts/sync-prompts.mjs', ['--check']);
    assert.equal(a.code, 1, '手改产物应被判红：' + a.out);
    assert.match(a.out, /产物未同步/, '归因须指向产物：' + a.out);

    // 乙：产物缺位 ⇒ 取证不能 ⇒ 判红（不猜「大概没过时」）
    settle(dir);
    fs.rmSync(path.join(dir, 'plugin-host.js'));
    const b = runScript(dir, 'scripts/sync-prompts.mjs', ['--check']);
    assert.equal(b.code, 1, '产物缺位应 fail-closed 判红：' + b.out);
    assert.match(b.out, /缺位/, '归因须说明产物缺位：' + b.out);
  });
});

test('GAP-5 缺陷③：build 日志的字节数必须等于磁盘实字节（字符数不得冒充 bytes）', () => {
  withFixture((dir) => {
    const b = spawnSync(process.execPath, ['scripts/build-host.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(b.status, 0, 'build-host 应成功：' + String(b.stderr || ''));
    const log = String(b.stdout || '') + String(b.stderr || '');
    const m = log.match(/plugin-host\.js written \((\d+) chars \/ (\d+) bytes/);
    assert.ok(m, '日志须同时给出 chars 与 bytes（旧形态只给一个数并标成 bytes）：' + log);
    const [, chars, bytes] = m.map(Number);
    const onDisk = fs.statSync(path.join(dir, 'plugin-host.js')).size;
    const utf8 = Buffer.byteLength(fs.readFileSync(path.join(dir, 'plugin-host.js'), 'utf8'), 'utf8');
    assert.equal(bytes, onDisk, '日志字节数必须等于磁盘实字节（缺陷③正是此处失实）');
    assert.equal(bytes, utf8, '日志字节数必须等于 utf8 实字节');
    // 判别力：CJK 产物下字符数必须**确实不同于**字节数，否则本断言在该产物上无从区分（夹具自检）
    assert.notEqual(chars, bytes, '夹具失效：本产物 chars 应 ≠ bytes（否则区分不了缺陷③）');
    assert.ok(bytes > chars, '本产物字节数应大于字符数（CJK 多字节）');

    // 客户端产物同源口径（同一缺陷的另一落点）
    const c = spawnSync(process.execPath, ['scripts/build-client.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(c.status, 0, 'build-client 应成功：' + String(c.stderr || ''));
    const clog = String(c.stdout || '') + String(c.stderr || '');
    const cm = clog.match(/lib\/client\.cjs written \((\d+) chars \/ (\d+) bytes/);
    assert.ok(cm, 'client 日志须同时给出 chars 与 bytes：' + clog);
    assert.equal(Number(cm[2]), fs.statSync(path.join(dir, 'lib', 'client.cjs')).size,
      'client 日志字节数必须等于磁盘实字节');
  });
});

test('GAP-6 缺陷③源码面防回归：不得再出现 `X.length + \' bytes\'` 的字符数冒充形态', () => {
  // 行为断言（GAP-5）已锁日志；本条再锁**源码形态**，因为 `.length` 在别处的新日志里很容易被顺手写下。
  for (const rel of [path.join('scripts', 'build-host.mjs'), path.join('scripts', 'build-client.mjs')]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /\.length\s*\+\s*['"]\s*bytes/,
      rel + ' 不得再把 .length 标成 bytes（缺陷③复发形态）');
    assert.match(src, /Buffer\.byteLength\(/, rel + ' 应以 Buffer.byteLength 取得真字节数');
  }
});

// ───────────────────────── 门禁缺口批 2（F1 · 2026-10-16）：同步面前置覆盖面 ─────────────────────────
//
// 病历（部署批 §7-F1）：`package.json` **在** `sync-runtime.mjs` 的同步面内（会被 `cpSync`
//   覆盖到运行环境），而「三处同刻一致」与双 `--check` **都只覆盖代码产物**
//   ⇒ 改 `exports["./client"]` / `files` 等清单字段时**全链零红**，运行环境已被静默改写。
//
// ⚠ 判据落点：`scripts/lib/sync-face.mjs`（**从同步脚本文面量派生**的面 + md5 对照）。
//   本组把「覆盖面真的从 :117 派生 / 变异必红 / 负控必绿 / 有意不纳入有据」钉成机检。
const syncFace = require(path.join(ROOT, 'scripts', 'lib', 'sync-face.mjs'));

test('GAP-7 F1 覆盖面：同步面清单**从 sync-runtime 字面量派生**，且非产物面含 package.json', () => {
  const face = syncFace.deriveSyncFace(ROOT);
  // 派生面必须与同步脚本实名清单一致（含 package.json —— 病历点名的正是它）
  for (const f of ['plugin-host.js', 'package.json', 'README.md', 'README.en.md', 'cordis.patch.yml']) {
    assert.ok(face.files.includes(f), '同步面应含 ' + f + '（派生读数：' + face.files.join(',') + '）');
  }
  assert.deepEqual(face.dirs, ['prompts', 'assets'], '目录级同步面应派生为 prompts/assets');
  const n = syncFace.syncFaceNonArtifact(ROOT);
  assert.ok(n.included.includes('package.json'), 'package.json 必须纳入**非产物**覆盖面（F1 的病灶）');
  assert.ok(!n.included.includes('plugin-host.js'), '产物不得混进非产物覆盖面（它已由双 --check 覆盖）');
  assert.deepEqual(n.artifacts, ['plugin-host.js'], '产物分类应唯一位于 artifacts');
  assert.deepEqual(n.excludedDirs, ['prompts', 'assets'], '有意不纳入的目录面须逐条可读');
});

test('GAP-8 F1 变异自证：改一处 package.json ⇒ 该前置**必红**（源↔运行环境漂移可见）', () => {
  withFixture((dir) => {
    // 造一个"运行环境"= 原样复制（部署后态）；先把同步面拉到两边一致
    const rt = path.join(dir, '_rt');
    fs.mkdirSync(rt, { recursive: true });
    const n = syncFace.syncFaceNonArtifact(dir);
    for (const rel of n.included) fs.copyFileSync(path.join(dir, rel), path.join(rt, rel));
    assert.equal(syncFace.compareSyncFace(dir, rt).ok, true, '预置：两边一致时不得报漂移（负控在同一夹具内成立）');

    // 变异：改 package.json 一个**清单字段**（不是版本号——F1 的病正是清单字段改而无声）
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.ok(Array.isArray(pj.files) && pj.files.length > 0, '夹具前提：package.json 应有 files 清单');
    pj.files = pj.files.slice(0, -1);            // 删一项发布白名单
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pj, null, 2) + NL, 'utf8');

    const c = syncFace.compareSyncFace(dir, rt);
    assert.equal(c.ok, false, 'package.json 清单字段已变 ⇒ 该前置必须判红（修复前此形态全链零红）');
    const row = c.rows.find((r) => r.file === 'package.json');
    assert.equal(row.state, 'drift', 'package.json 应记为 drift（源↔运行环境 md5 不同）');
    // 判别力自证：其余未动文件必须仍 match（否则是"整片报红"，无判别力）
    assert.ok(c.rows.filter((r) => r.file !== 'package.json').every((r) => r.state === 'match'),
      '未改动的文件不得连带报红（否则本对照无判别力）');
    // 同口径复核：md5 必须与 md5sum 同值（复用既有算法，不新造）
    const { execFileSync } = require('node:child_process');
    const real = execFileSync('md5sum', [path.join(dir, 'package.json')], { encoding: 'utf8' }).split(/\s+/)[0];
    assert.equal(row.treeMd5, real, '本模块 md5 应与 md5sum 同值（同一算法，不新造机制）');
  });
});

test('GAP-9 F1 负控：不动任何文件 ⇒ **必绿**（含：运行环境缺件不得被判失败）', () => {
  withFixture((dir) => {
    const rt = path.join(dir, '_rt');
    fs.mkdirSync(rt, { recursive: true });
    const n = syncFace.syncFaceNonArtifact(dir);
    for (const rel of n.included) fs.copyFileSync(path.join(dir, rel), path.join(rt, rel));
    const c = syncFace.compareSyncFace(dir, rt);
    assert.equal(c.ok, true, '不动任何文件时不得误报：' + syncFace.summarizeSyncFace(dir, rt));
    assert.ok(c.rows.every((r) => r.state === 'match'), '全部条目应为 match');
    // 负控的另一半：**空运行环境**（= 本批"未部署"实况）⇒ 记 absent，**不判失败**
    const empty = path.join(dir, '_rt-empty');
    fs.mkdirSync(empty, { recursive: true });
    const e = syncFace.compareSyncFace(dir, empty);
    assert.equal(e.ok, true, '运行环境缺件不得判失败（部署可合法未跑；本批明令不部署）');
    assert.equal(e.absent.length, n.included.length, '缺件须逐条登记（可见，不是静默跳过）');
  });
  // 真实工作区负控：本批不得把真仓判红
  assert.equal(syncFace.compareSyncFace(ROOT).ok, true,
    '真实工作区应无漂移：' + syncFace.summarizeSyncFace(ROOT));
});

test('GAP-10 F1 fail-closed：同步脚本缺位 / 清单改名 ⇒ 派生**抛错**，不得静默回退到硬编码清单', () => {
  withFixture((dir) => {
    // 甲：脚本缺位
    fs.rmSync(path.join(dir, 'scripts', 'sync-runtime.mjs'));
    assert.throws(() => syncFace.deriveSyncFace(dir), /不在位/,
      '同步脚本缺位时必须抛错（「解析不到就算过」是假绿）');
    // 乙：清单字面量改名（派生锚点消失）
    fs.writeFileSync(path.join(dir, 'scripts', 'sync-runtime.mjs'), 'const deployFiles = [];', 'utf8');
    assert.throws(() => syncFace.deriveSyncFace(dir), /未能|解析/,
      '字面量改名后必须抛错，不得凭记忆硬编码一份清单');
  });
});
