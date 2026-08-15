// One-time / maintenance helper: extract client constants/config defaults from
// the legacy client source into src/client/constants.js and leave a marker.
// Run: node scripts/extract-client-constants.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'client', 'legacy', 'plugin-client.js');
const modulePath = join(root, 'src', 'client', 'constants.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = "const CONFIG_KEY = 'dsh.enhance.config.v2';";
const endMarker = 'const MEMORY_ROUNDS_MAX = 4;';
const start = src.indexOf(beginMarker);
const endIdx = src.indexOf(endMarker, start);
if (start === -1 || endIdx === -1) throw new Error('client constants markers not found');
const end = endIdx + endMarker.length;

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-client-constants-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted client constants/config defaults from legacy client source.\n// build-client.mjs injects this chunk back into the generated client bundle.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('client constants extracted ->', modulePath);
