// release.mjs — v3.2.1-t（架构调整·发布全自动）
// 一条命令完成发布：bump 版本 → build（含版本注入）→ --check 漂移校验 → 全量测试
// → npm pack → git commit/tag → 推 GitHub → 创建 Release + 上传 tgz。
// tgz 永远等于当前代码（消除「发布后改动不入包」的历史问题）。
//
// 用法（需要 GITHUB_TOKEN 环境变量，GitHub Personal Access Token）：
//   GITHUB_TOKEN=xxx node scripts/release.mjs                 # patch 版（3.2.2 → 3.2.3）
//   GITHUB_TOKEN=xxx node scripts/release.mjs --minor          # minor 版（3.2.x → 3.3.0）
//   GITHUB_TOKEN=xxx node scripts/release.mjs --major          # major 版（3.x → 4.0.0）
//   GITHUB_TOKEN=xxx node scripts/release.mjs --version 3.5.0  # 指定版本
//   node scripts/release.mjs --dry-run                         # 只检查不发布（无需 token）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;
const PKG = join(root, 'package.json');
const REPO = 'Fishsb/dsh-prompt-enhancer';
const TOKEN = process.env.GITHUB_TOKEN || '';

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root });
}
function runNode(script, args) {
  run(NODE, [join(root, 'scripts', script), ...args]);
}
function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', cwd: root }).trim();
}
// npm-cli.js 解析：优先仓库内 node_modules/npm（旧路径），缺失时回退 node 同级全局 npm
// （v3.2.3 修复：本机 node_modules/npm 不存在，硬编码路径 MODULE_NOT_FOUND 曾阻塞发布；
// 不跑 `npm root -g`——Windows 下 execFileSync 无法直接执行 .cmd，且 PATH 布局不可靠）
function resolveNpmCli() {
  const local = join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(local)) return local;
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('npm-cli.js not found: 仓库 node_modules/npm 与 node 同级全局 npm 均缺失');
}
const NPM_CLI = resolveNpmCli();
function http(url, opts) {
  const u = new URL(url);
  const http = u.protocol === 'http:' ? require('node:http') : require('node:https');
  return new Promise((resolve, reject) => {
    const req = http.request(u, {
      method: opts.method || 'GET',
      headers: { authorization: 'token ' + TOKEN, 'user-agent': 'dsh-release', 'content-type': 'application/json', ...(opts.headers || {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

// ---- 1. 版本计算 ----
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const cur = JSON.parse(readFileSync(PKG, 'utf8')).version;
const seg = cur.split('.').map(Number);
let next = null;
const vi = args.indexOf('--version');
if (vi !== -1 && args[vi + 1]) next = args[vi + 1];
else if (args.includes('--major')) next = (seg[0] + 1) + '.0.0';
else if (args.includes('--minor')) next = seg[0] + '.' + (seg[1] + 1) + '.0';
else next = seg[0] + '.' + seg[1] + '.' + (seg[2] + 1);
if (!/^\d+\.\d+\.\d+$/.test(next)) { console.error('非法版本号: ' + next); process.exit(1); }
const tag = 'v' + next;
console.log('发布 ' + cur + ' → ' + next + '（tag ' + tag + '）' + (dryRun ? ' [dry-run]' : ''));

// ---- 2. 构建 + 漂移校验 ----
console.log('== build + 版本注入 ==');
runNode('build-host.mjs', []);
runNode('build-client.mjs', []);
console.log('== 漂移校验（源码 ↔ 产物）==');
runNode('build-host.mjs', ['--check']);
runNode('build-client.mjs', ['--check']);

// ---- 3. 全量测试 ----
console.log('== 全量测试 ==');
try { run(NODE, ['--test', ...sh('node', ['-e', "console.log(require('node:fs').readdirSync('test').filter(f=>f.endsWith('.test.cjs')).map(f=>'test/'+f).join(' '))"]).split(' ')]); }
catch (e) { console.error('测试失败，中止发布'); process.exit(1); }

if (dryRun) {
  console.log('[dry-run] 校验通过，未做任何写操作。');
  process.exit(0);
}

// ---- 4. bump 版本 + pack ----
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
pkg.version = next;
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
runNode('build-host.mjs', []); // 产物同步注入新版本
runNode('build-client.mjs', []);
console.log('== npm pack ==');
const packOut = sh(NODE, [NPM_CLI, 'pack', '--pack-destination', '.']).split('\n').pop().trim();
const tgz = join(root, packOut);
if (!existsSync(tgz)) { console.error('npm pack 失败'); process.exit(1); }
console.log('产物: ' + packOut + ' (' + statSync(tgz).size + 'B)');

// ---- 5. git commit + tag ----
console.log('== git commit + tag ==');
sh('git', ['add', '-A']);
sh('git', ['commit', '-m', 'release: v' + next + '（自动发布 ' + new Date().toISOString().slice(0, 10) + '）']);
sh('git', ['tag', tag]);
sh('git', ['push', 'https://' + TOKEN + '@github.com/' + REPO + '.git', 'main']);
sh('git', ['push', 'https://' + TOKEN + '@github.com/' + REPO + '.git', tag]);

// ---- 6. GitHub Release + 资产 ----
console.log('== GitHub Release ==');
// 正文优先取 release-notes/<版本>.md（UTF-8 直传）；缺失时回退通用文案。
// 不要发布后用命令行手工改正文——非 UTF-8 通道会把中文转成 ? 乱码（v3.3.1 教训），
// 需要修正时用 scripts/sync-release-notes.mjs 重同步。
const notesFile = join(root, 'release-notes', next + '.md');
const notesBody = existsSync(notesFile)
  ? readFileSync(notesFile, 'utf8')
  : '自动发布 v' + next + '（build --check 校验 + 全量测试通过）。详见 CHANGELOG.md。';
console.log(existsSync(notesFile) ? '正文: release-notes/' + next + '.md' : '正文: 通用文案（未找到 release-notes/' + next + '.md）');
const rel = await http('https://api.github.com/repos/' + REPO + '/releases', {
  method: 'POST',
  body: { tag_name: tag, name: tag, body: notesBody, draft: false, prerelease: false },
});
if (rel.status >= 300) { console.error('Release 创建失败: ' + rel.status + ' ' + rel.body.slice(0, 300)); process.exit(1); }
const release = JSON.parse(rel.body);
console.log('Release: ' + release.html_url);

console.log('== 上传 tgz 资产 ==');
const up = await http('https://uploads.github.com/repos/' + REPO + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(packOut), {
  method: 'POST',
  // v3.2.3 修复：必须显式 content-length——Node 不设该头时走 chunked 传输，
  // GitHub uploads API 拒绝（400 Bad Content-Length），tgz 资产会传不上
  headers: { 'content-type': 'application/octet-stream', 'content-length': statSync(tgz).size },
  body: readFileSync(tgz),
});
if (up.status >= 300) { console.error('资产上传失败: ' + up.status + ' ' + up.body.slice(0, 300)); process.exit(1); }
const asset = JSON.parse(up.body);
console.log('资产: ' + asset.browser_download_url);

console.log('== 上传 .sha256 资产 ==');
// v3.3.2（供应链加固）：发布同步上传 .sha256——更新器哈希门禁的备用可信通道
// （主通道为 GitHub API 资产 digest；两通道均不经 ghproxy 类镜像）
const { createHash } = require('node:crypto');
const sha256 = createHash('sha256').update(readFileSync(tgz)).digest('hex');
const shaName = packOut + '.sha256';
const shaBody = sha256 + '  ' + packOut + '\n';
const upSha = await http('https://uploads.github.com/repos/' + REPO + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(shaName), {
  method: 'POST',
  headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(shaBody) },
  body: shaBody,
});
if (upSha.status >= 300) { console.error('.sha256 资产上传失败: ' + upSha.status + ' ' + upSha.body.slice(0, 300)); process.exit(1); }
console.log('sha256: ' + sha256);

// ---- 7. 收尾 ----
console.log('');
console.log('✅ 发布完成：' + tag);
console.log('   安装命令：dsh plugin --profile web add github:' + REPO + '#' + tag);
