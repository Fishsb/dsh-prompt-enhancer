// One-time / maintenance helper: extract the diagnostics block from the legacy
// host source into src/host/diagnostics.js and leave a build injection marker.
// Run: node scripts/extract-diagnostics.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'host', 'legacy', 'plugin-host.js');
const modulePath = join(root, 'src', 'host', 'diagnostics.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = '// —— v14 诊断日志：环形缓冲（最近 300 行），供 logs/last RPC 读取 ——';
const start = src.indexOf(beginMarker);
const errCall = src.indexOf('console.error(line);', start);
if (start === -1 || errCall === -1) throw new Error('diagnostics markers not found');
const endIdx = src.indexOf('}', errCall);
if (endIdx === -1) throw new Error('diagnostics end not found');
const end = endIdx + 1;
const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-diagnostics-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted diagnostics block from legacy host source.\n// build-host.mjs injects this chunk back into the generated root plugin-host.js.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('diagnostics extracted ->', modulePath);
