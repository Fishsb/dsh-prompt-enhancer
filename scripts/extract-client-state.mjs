// One-time / maintenance helper: extract client config/state logic from the
// legacy client source into src/client/state.js and leave a build marker.
// Run: node scripts/extract-client-state.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'client', 'legacy', 'plugin-client.js');
const modulePath = join(root, 'src', 'client', 'state.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = 'const configState = { value: { ...CONFIG_DEFAULTS }, listeners: new Set(), fresh: true };';
const start = src.indexOf(beginMarker);
const initCall = src.indexOf('loadConfigFromStorage();', start);
if (start === -1 || initCall === -1) throw new Error('client state markers not found');
const end = initCall + 'loadConfigFromStorage();'.length;

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-client-state-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted client config/state logic from legacy client source.\n// build-client.mjs injects this chunk back into the generated client bundle.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('client state extracted ->', modulePath);
