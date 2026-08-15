// One-time / maintenance helper: extract the PURE section from the legacy host
// source into src/host/pure.js and leave a build injection marker in legacy.
// Run: node scripts/extract-pure.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'host', 'legacy', 'plugin-host.js');
const purePath = join(root, 'src', 'host', 'pure.js');

const src = readFileSync(legacyPath, 'utf8');
const begin = '// ==PURE-BEGIN==';
const end = '// ==PURE-END==';
const start = src.indexOf(begin);
const endIdx = src.indexOf(end);
if (start === -1 || endIdx === -1 || endIdx < start) {
  throw new Error('PURE markers not found in legacy source');
}
const pureEnd = endIdx + end.length;
const pureChunk = src.slice(start, pureEnd);
const legacyWithoutPure = src.slice(0, start) + '// @dsh-pure-inject' + src.slice(pureEnd);

const pureModule = `'use strict';\n// Extracted PURE section from legacy host source.\n// This file is the single source of truth for the PURE chunk; build-host.mjs\n// injects it back into the generated root plugin-host.js.\nmodule.exports = ${JSON.stringify(pureChunk)};\n`;

writeFileSync(purePath, pureModule, 'utf8');
writeFileSync(legacyPath, legacyWithoutPure, 'utf8');
console.log('PURE extracted ->', purePath);
console.log('legacy updated with injection marker');
