// One-time / maintenance helper: extract model helper functions from the legacy
// client source into src/client/model-helpers.js and leave a build marker.
// Run: node scripts/extract-client-model-helpers.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'client', 'legacy', 'plugin-client.js');
const modulePath = join(root, 'src', 'client', 'model-helpers.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = 'function buildCandidates(providers, customModels, order) {';
const start = src.indexOf(beginMarker);
if (start === -1) throw new Error('buildCandidates not found');

// Simple brace counter to find the end of the function.
let depth = 0;
let end = -1;
for (let i = start; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}
if (end === -1) throw new Error('buildCandidates end not found');

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-client-model-helpers-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted model helper functions from legacy client source.\n// build-client.mjs injects this chunk back into the generated client bundle.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('client model helpers extracted ->', modulePath);
