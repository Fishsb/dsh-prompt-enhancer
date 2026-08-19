#!/usr/bin/env node
// scripts/vendor-recordrtc.mjs
// RecordRTC vendor 转义工具：读官方原码 → 生成字符串 chunk（对齐现有 chunk 机制）。
// 用法：node scripts/vendor-recordrtc.mjs [--check]
//  --check：仅校验生成物与源码一致（防漂移，构建链调用）
// 产出：src/client/vendor/recordrtc.chunk.js（module.exports = "<JSON.stringify 转义源码>"）
// ⚠️ chunk 为 GENERATED 生成物，禁手改（同 plugin-client.js 红线）；升级=换原码重跑本工具。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcFile = join(root, 'src', 'client', 'vendor', 'recordrtc.js');
const outFile = join(root, 'src', 'client', 'vendor', 'recordrtc.chunk.js');
const check = process.argv.includes('--check');

const src = readFileSync(srcFile, 'utf8');
// JSON.stringify 转义：安全处理引号/反斜杠/换行/${} 等一切元字符（与 build-client 最终嵌入同策略）
const chunk = 'module.exports = ' + JSON.stringify(src) + ';\n';

if (check) {
  let ok = false;
  try { ok = readFileSync(outFile, 'utf8') === chunk; } catch (e) { /* missing */ }
  console.log(ok ? '[vendor-recordrtc] OK（chunk 与源码一致）' : '[vendor-recordrtc] DRIFT：chunk 过期，重跑 node scripts/vendor-recordrtc.mjs');
  process.exit(ok ? 0 : 1);
}
writeFileSync(outFile, chunk, 'utf8');
console.log('[vendor-recordrtc] 生成 ' + outFile + '（' + chunk.length + ' B，源码 ' + src.length + ' B）');
