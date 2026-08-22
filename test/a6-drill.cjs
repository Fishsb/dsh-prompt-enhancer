'use strict';
// L3 拦截演练（方案 §七 A4/A6 出口标准）：装坏插件在安装期被拦截 + 快照生成。
// 隔离：DSH_HOME 指向临时目录，绝不触碰真实运行环境与真实执行器。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a6-drill-'));
const fakeHome = path.join(tmp, 'dsh-home');
const runtimeDir = path.join(fakeHome, 'profiles', 'web', 'node_modules', 'dsh-prompt-enhancer');
fs.mkdirSync(path.join(runtimeDir, 'lib'), { recursive: true });
// 旧版本现场（将被覆盖的目标）
fs.writeFileSync(path.join(runtimeDir, 'package.json'), JSON.stringify({ name: 'dsh-prompt-enhancer', version: '3.3.1' }));
fs.writeFileSync(path.join(runtimeDir, 'plugin-host.js'), '// OLD GOOD\nmodule.exports=1;\n');

function makeTgz(name, version, hostBody) {
  const pkg = path.join(tmp, name.replace(/\.tgz$/, ''), 'package');
  fs.mkdirSync(path.join(pkg, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-prompt-enhancer', version }));
  fs.writeFileSync(path.join(pkg, 'plugin-host.js'), hostBody);
  fs.writeFileSync(path.join(pkg, 'lib', 'index.cjs'), "module.exports=1;\n");
  const out = path.join(tmp, name);
  // Windows 自带 bsdtar（与 installStagedTarball 同款调用面）
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
    ['-czf', out.replace(/\\/g, '/'), '-C', path.dirname(pkg), 'package'], { stdio: 'ignore' });
  return out;
}

global.harness = { handle() {}, on() {} };
process.env.DSH_HOME = fakeHome;
const mod = require(path.join(root, 'lib', 'index.cjs'));

// ---- 演练 1：坏包（语法损坏）→ 安装期拦截，旧现场不动 ----
const badTgz = makeTgz('bad.tgz', '9.9.9-bad', 'const x = {;');
const badRes = mod.installStagedTarball(badTgz, 'web');
assert.equal(badRes.ok, false, '坏包必须被拒绝');
assert.equal(badRes.code, 'STAGED_SYNTAX_CHECK_FAILED', '拒绝码=' + badRes.code);
assert.equal(fs.readFileSync(path.join(runtimeDir, 'plugin-host.js'), 'utf8'), '// OLD GOOD\nmodule.exports=1;\n', '旧产物不得被覆盖');
console.log('✓ 演练1 坏包安装期拦截（STAGED_SYNTAX_CHECK_FAILED），运行环境未被污染');
console.log('   message:', badRes.message);

// ---- 演练 2：好包 → 安装成功 + rescue 快照生成 ----
const goodTgz = makeTgz('good.tgz', '9.9.9-good', '// NEW GOOD\nmodule.exports=2;\n');
const goodRes = mod.installStagedTarball(goodTgz, 'web');
assert.equal(goodRes.ok, true, '好包应成功: ' + (goodRes.message || ''));
assert.equal(fs.readFileSync(path.join(runtimeDir, 'plugin-host.js'), 'utf8').includes('NEW GOOD'), true);
const rescueRoot = path.join(fakeHome, 'rescue');
const snaps = fs.readdirSync(rescueRoot).filter((d) => /^\d{8}-\d{6}(-\d+)?$/.test(d));
assert.ok(snaps.length >= 1, '应生成 rescue 快照');
const meta = JSON.parse(fs.readFileSync(path.join(rescueRoot, snaps[0], 'meta.json'), 'utf8'));
assert.equal(meta.reason.indexOf('staged-install pre') === 0, true);
console.log('✓ 演练2 好包安装成功，快照落位:', snaps[0], '（' + meta.files.length + ' files，reason=' + meta.reason + '）');
console.log('   message:', goodRes.message);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
console.log('✅ A5+A6 真实链路演练全部通过（隔离临时 DSH_HOME，未触真实环境）');
