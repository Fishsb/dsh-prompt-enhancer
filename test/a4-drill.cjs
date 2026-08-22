'use strict';
// A4 救援模式真实链路演练（方案 §5.3 五步 · 批次二验证义务）：
//   隔离 DSH_HOME + 假 dsh bin（按 profile 现态合成 dump 输出，模拟官方 --dump-config 语义）
//   + bringUp/一致性自检注入（绝不触碰真实服务与真实 nssm 日志）。
// 场景：
//   演练1 精准禁用（a 档）：坏宿主包（bundles 有条目、目录缺失）→ 干跑闸门拦截 →
//         patch 静态 disabled + bundles 移除（依赖声明保留）→ 闸门转绿 → 注入拉起成功 → 报告落位。
//   演练2 二分定位（c 档）：同毒环境从零重来 → 自动逐半禁用秒级判定 → 收敛元凶 → 终态闸门通过。
//   演练3 快照回退（b 档）：历史干净快照存在时整份恢复（含 exactHomePatch 删除语义）。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-drill-'));
const fakeHome = path.join(tmp, 'dsh-home');
const PROFILE = 'web';
const profileDir = path.join(fakeHome, 'profiles', PROFILE);
const runtimeDir = path.join(profileDir, 'node_modules', 'dsh-prompt-enhancer');

process.env.DSH_ENHANCER_NO_INDEX = '1';
process.env.DSH_HOME = fakeHome;

// ---- 假 dsh bin 内核：按 profile 现态合成 dump 输出（模拟官方 --dump-config 语义）----
const inner = path.join(tmp, 'fake-dsh-inner.cjs');
// 假 dsh bin：node 脚本直启（DSH_BIN 优先被 resolveDshBin 采纳；DSH_BIN_NODE_SCRIPT=1
// 让 dumpCompose 经当前 node 直启——Windows spawnSync 无 shell 不能直启 .cmd，Node≥18 EINVAL）
process.env.DSH_BIN = inner;
process.env.DSH_BIN_NODE_SCRIPT = '1';
fs.writeFileSync(inner, [
  "const fs=require('node:fs'),path=require('node:path');",
  "const i=process.argv.indexOf('--profile');const prof=process.argv[i+1]||'web';",
  "const dir=path.join(process.env.DSH_HOME,'profiles',prof);",
  "let ids=[];",
  "try{const t=fs.readFileSync(path.join(dir,'cordis.patch.yml'),'utf8');",
  "  const re=/^\\s*-\\s*id:\\s*\"([^\"]+)\"[\\s\\S]*?disabled:\\s*true/gm;let x;",
  "  while((x=re.exec(t)))ids.push(x[1]);}catch(e){}",
  "console.log('== '+prof+' ==');",
  "try{const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));",
  "  for(const b of (pkg.dsh&&pkg.dsh.profile&&pkg.dsh.profile.bundles)||[]){",
  "    if(!ids.includes(b))console.log('  - name: \"'+b+'\"');}}catch(e){}",
].join('\n'), 'utf8');

// ---- 可注入 io：脚本化应答 + 输出留档 ----
function scriptedIo(answers) {
  const lines = [];
  const queue = answers.slice();
  return {
    out: (s) => { if (s !== undefined && s !== '') lines.push(String(s)); },
    ask: async () => {
      const a = queue.shift();
      return a === undefined ? '' : a;
    },
    lines,
  };
}

function writeProfile({ withBadHost }) {
  // 基座可解析桩（真实环境由 dsh-install 根提供；假环境本地补齐）
  const baseDir = path.join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-base');
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'package.json'), '{"name":"@deepseek-ai/dsh-base","main":"index.js"}', 'utf8');
  fs.writeFileSync(path.join(baseDir, 'index.js'), 'module.exports=1;', 'utf8');
  fs.mkdirSync(path.join(profileDir, 'node_modules', 'good-plugin'), { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'p', dependencies: { 'good-plugin': '*', 'bad-host': '*' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'good-plugin'].concat(withBadHost ? ['bad-host'] : []) } },
  }), 'utf8');
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '# patch\n[]\n', 'utf8');
  // good-plugin 可解析；bad-host 故意无目录（模拟装了一半/被剪枝的坏宿主）
  fs.writeFileSync(path.join(profileDir, 'node_modules', 'good-plugin', 'package.json'), '{"name":"good-plugin","main":"index.js"}', 'utf8');
  fs.writeFileSync(path.join(profileDir, 'node_modules', 'good-plugin', 'index.js'), 'module.exports=1;', 'utf8');
}

const M = require(path.join(root, 'lib', 'maintain-lib.cjs'));
const sys = require(path.join(root, 'lib', 'sys.cjs'));
const updater = require(path.join(root, 'lib', 'updater-host.cjs'));

// 干跑统一走假 dsh（node 脚本直启）+ 双根=profile 目录 + 裸包名 extraNames 补录
// （extractEntryNames 保守口径只收含 '/' 的名字——与生产 runRescue 的 thirdParties 补录同源）
const gate = () => M.dryRunAll({
  profile: PROFILE, roots: [profileDir], dshBin: inner, dshBinIsNodeScript: true,
  extraNames: ['good-plugin', 'bad-host'],
});

function profilePath() { return M.profilePaths(fakeHome, PROFILE); }

(async () => {
/* ================= 演练 1：精准禁用（a 档） ================= */
writeProfile({ withBadHost: true });
{
  const pre = gate();
  assert.equal(pre.ok, false, '前置：毒配置干跑必须失败');
  assert.equal(pre.layer, 'resolve', '失败层=' + pre.layer);
  assert.ok(pre.detail.includes('bad-host'), '指认 bad-host: ' + pre.detail);

  const io = scriptedIo(['a', 'bad-host']);           // 处置=a；手选禁用名（日志源为空→人选路径）
  const summary = await updater.runRescue(io, 'dsh-web-drill', PROFILE, {
    logPathsOverride: [],                              // 隔离：不读真实机器 nssm 日志
    bringUpImpl: async () => ({ ok: true, via: 'drill' }),
    consistencyCheckImpl: async () => {},
  });
  assert.equal(summary.action.mode, 'precise', JSON.stringify(summary.action));
  assert.deepEqual(summary.action.disabled, ['bad-host']);
  assert.equal(summary.gateOk, true, '处置后闸门必须转绿');
  assert.equal(summary.broughtUp.ok, true);
  assert.ok(fs.existsSync(summary.reportPath), 'rescue-report 落位');
  const report = JSON.parse(fs.readFileSync(summary.reportPath, 'utf8'));
  assert.ok(report.restoreGuide.length >= 3, '报告须附恢复指引（G7③）');
  // 只禁用不删除：patch 有静态 disabled 条目；bundles 移除；dependencies 保留
  assert.deepEqual(M.readPatchIds(profilePath().patchYml), ['bad-host']);
  const pkgAfter = JSON.parse(fs.readFileSync(profilePath().packageJson, 'utf8'));
  assert.ok(!pkgAfter.dsh.profile.bundles.includes('bad-host'));
  assert.equal(pkgAfter.dependencies['bad-host'], '*', '依赖声明必须保留（救援纪律一）');
  console.log('✓ 演练1 精准禁用：拦截→处置→闸门转绿→报告齐备');
}

/* ================= 演练 2：二分定位（c 档） ================= */
fs.rmSync(profileDir, { recursive: true, force: true });
writeProfile({ withBadHost: true });
{
  const io = scriptedIo(['c']);
  const summary = await updater.runRescue(io, 'dsh-web-drill', PROFILE, {
    logPathsOverride: [],
    bringUpImpl: async () => ({ ok: true, via: 'drill' }),
    consistencyCheckImpl: async () => {},
  });
  assert.equal(summary.action.mode, 'bisect', JSON.stringify(summary.action));
  assert.ok(summary.action.suspects.includes('bad-host'), '二分须收敛到 bad-host: ' + JSON.stringify(summary.action.suspects));
  assert.ok(!summary.action.suspects.includes('good-plugin'), '无辜者不得误伤');
  assert.equal(summary.gateOk, true, '终态闸门通过');
  console.log('✓ 演练2 二分定位：自动收敛元凶（' + summary.action.suspects.join(',') + '），'
    + (summary.action.rounds || '?') + ' 轮秒级判定');
}

/* ================= 演练 3：快照回退（b 档） ================= */
fs.rmSync(profileDir, { recursive: true, force: true });
writeProfile({ withBadHost: false });                  // 先制造"历史干净现场"
{
  const snap = sys.rescueSnapshot({ profileName: PROFILE, reason: 'a4-drill clean baseline' });
  assert.equal(snap.ok, true);
  // 破坏成毒态 + 新增 home patch（快照期不存在 → exactHomePatch 应删除）
  fs.rmSync(profileDir, { recursive: true, force: true });
  writeProfile({ withBadHost: true });
  fs.writeFileSync(profilePath().homePatchYml, '- bogus\n', 'utf8');
  const pre = gate();
  assert.equal(pre.ok, false, '毒态前置确认');

  const io = scriptedIo(['b', '', 'y']);               // b → 选份（回车=从最新开始）→ 确认 y（闸门不过自动退更旧）
  const summary = await updater.runRescue(io, 'dsh-web-drill', PROFILE, {
    logPathsOverride: [],
    bringUpImpl: async () => ({ ok: true, via: 'drill' }),
    consistencyCheckImpl: async () => {},
  });
  assert.equal(summary.action.mode, 'rollback', JSON.stringify(summary.action));
  assert.ok(summary.action.restored >= 1, '至少恢复一个文件');
  assert.equal(summary.gateOk, true, '回退后闸门转绿');
  const pkgRestored = JSON.parse(fs.readFileSync(profilePath().packageJson, 'utf8'));
  assert.ok(!pkgRestored.dsh.profile.bundles.includes('bad-host'), '回到干净 bundles');
  assert.ok(!fs.existsSync(profilePath().homePatchYml), 'exactHomePatch：快照期不存在的 home patch 已删');
  console.log('✓ 演练3 快照回退：整份恢复干净现场（含 home patch 忠实删除）');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
console.log('✅ A4 救援模式三档演练全部通过（隔离 DSH_HOME + 假 dsh bin + 注入拉起，未触真实服务）');
})().catch((e) => { console.error('✗ A4 演练失败:', e && e.stack || e); process.exit(1); });
