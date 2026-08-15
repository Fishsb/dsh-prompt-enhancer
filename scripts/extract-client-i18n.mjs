// One-time / maintenance helper: extract the i18n dictionaries from the legacy
// client source into src/client/i18n.js and leave a build injection marker.
// Run: node scripts/extract-client-i18n.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'client', 'legacy', 'plugin-client.js');
const modulePath = join(root, 'src', 'client', 'i18n.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = 'const ZH = {';
const start = src.indexOf(beginMarker);
const stageDone = src.indexOf("stageDone: '✓',", start);
if (start === -1 || stageDone === -1) throw new Error('i18n markers not found');
const closeIdx = src.indexOf('};', stageDone);
if (closeIdx === -1) throw new Error('i18n end not found');
const end = closeIdx + 2;

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-client-i18n-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted i18n dictionaries from legacy client source.\n// build-client.mjs injects this chunk back into the generated client bundle.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('client i18n extracted ->', modulePath);
