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
