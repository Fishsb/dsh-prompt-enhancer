// One-time / maintenance helper: extract the models/config cache block from the
// legacy host source into src/host/models.js and leave a build injection marker.
// Run: node scripts/extract-models.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'host', 'legacy', 'plugin-host.js');
const modulePath = join(root, 'src', 'host', 'models.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = '// v20：内置兜底链硬编码指向 DeepSeek 官方模型（provider=deepseek-official）。';
const start = src.indexOf(beginMarker);
const retChain = src.indexOf('return chain;', start);
if (start === -1 || retChain === -1) throw new Error('models markers not found');
const endIdx = src.indexOf('}', retChain);
if (endIdx === -1) throw new Error('models end not found');
const end = endIdx + 1;

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-models-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted models/config cache block from legacy host source.\n// build-host.mjs injects this chunk back into the generated root plugin-host.js.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('models extracted ->', modulePath);
