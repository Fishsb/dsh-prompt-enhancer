// One-time / maintenance helper: extract the update RPC handlers from the legacy
// host source into src/host/update.js and leave a build injection marker.
// Run: node scripts/extract-update.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'host', 'legacy', 'plugin-host.js');
const modulePath = join(root, 'src', 'host', 'update.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = "    harness.handle('update/check', async (args) => {";
const start = src.indexOf(beginMarker);
const envFailed = src.indexOf("'ENVCHECK_FAILED'", start);
if (start === -1 || envFailed === -1) throw new Error('update markers not found');
const closeIdx = src.indexOf('});', envFailed);
if (closeIdx === -1) throw new Error('update end not found');
const end = closeIdx + 3;

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-update-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted update RPC handlers from legacy host source.\n// build-host.mjs injects this chunk back into the generated root plugin-host.js.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('update extracted ->', modulePath);
