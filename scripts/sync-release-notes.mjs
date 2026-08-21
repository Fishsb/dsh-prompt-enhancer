// sync-release-notes.mjs — 将 release-notes/<版本>.md 同步为对应 GitHub Release 正文
// 用途：发布后修正/重写 Release 说明（UTF-8 直传，避免命令行手工编辑把中文转码成 ? 乱码）。
// 用法（需要 GITHUB_TOKEN 环境变量）：
//   GITHUB_TOKEN=xxx node scripts/sync-release-notes.mjs            # 同步 package.json 当前版本
//   GITHUB_TOKEN=xxx node scripts/sync-release-notes.mjs 3.3.1      # 同步指定版本
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = 'Fishsb/dsh-prompt-enhancer';
const TOKEN = process.env.GITHUB_TOKEN || '';
if (!TOKEN) { console.error('需要 GITHUB_TOKEN 环境变量'); process.exit(1); }

const ver = process.argv[2] || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const notesFile = join(root, 'release-notes', ver + '.md');
if (!existsSync(notesFile)) { console.error('找不到 ' + notesFile); process.exit(1); }
const body = readFileSync(notesFile, 'utf8');
const tag = 'v' + ver;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      authorization: 'token ' + TOKEN,
      'user-agent': 'dsh-release',
      'content-type': 'application/json; charset=utf-8',
      accept: 'application/vnd.github+json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  return { status: res.status, json: res.status < 300 ? JSON.parse(text) : null, text };
}

const list = await api('https://api.github.com/repos/' + REPO + '/releases/tags/' + tag);
if (list.status === 404) { console.error(tag + ' 尚无 Release，请先发布'); process.exit(1); }
if (list.status >= 300) { console.error('查询 Release 失败: ' + list.status + ' ' + list.text.slice(0, 300)); process.exit(1); }

const patch = await api(list.json.url, { method: 'PATCH', body: JSON.stringify({ name: tag, body }) });
if (patch.status >= 300) { console.error('更新失败: ' + patch.status + ' ' + patch.text.slice(0, 300)); process.exit(1); }
console.log('✅ ' + tag + ' Release 正文已同步自 release-notes/' + ver + '.md');
console.log('   ' + patch.json.html_url);
