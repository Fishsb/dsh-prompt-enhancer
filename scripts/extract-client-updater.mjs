// One-time / maintenance helper: extract updater/env metadata from the legacy
// client source into src/client/updater.js and leave a build injection marker.
// Run: node scripts/extract-client-updater.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'client', 'legacy', 'plugin-client.js');
const modulePath = join(root, 'src', 'client', 'updater.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = "const UPDATER_DEFAULT_REPO = 'Fishsb/dsh-prompt-enhancer';";
const start = src.indexOf(beginMarker);
const noPort = src.indexOf("'no-port': 'envExecPortNoPort',", start);
if (start === -1 || noPort === -1) throw new Error('updater metadata markers not found');
const closeIdx = src.indexOf('};', noPort);
if (closeIdx === -1) throw new Error('updater metadata end not found');
const end = closeIdx + 2;

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-client-updater-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted updater/env metadata from legacy client source.\n// build-client.mjs injects this chunk back into the generated client bundle.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('client updater metadata extracted ->', modulePath);
