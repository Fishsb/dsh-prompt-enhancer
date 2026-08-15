// One-time / maintenance helper: extract client helper/state functions from the
// legacy client source into src/client/helpers.js and leave a build marker.
// Run: node scripts/extract-client-helpers.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'client', 'legacy', 'plugin-client.js');
const modulePath = join(root, 'src', 'client', 'helpers.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = 'function errorKey(code) {';
const start = src.indexOf(beginMarker);
const enhanceButton = src.indexOf('function EnhanceButton(props) {', start);
if (start === -1 || enhanceButton === -1) throw new Error('client helpers markers not found');
const end = enhanceButton;

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-client-helpers-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted client helper/state functions from legacy client source.\n// build-client.mjs injects this chunk back into the generated client bundle.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('client helpers extracted ->', modulePath);
