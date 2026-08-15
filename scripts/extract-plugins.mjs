// One-time / maintenance helper: extract the plugin management RPC handlers from
// the legacy host source into src/host/plugins.js and leave a build injection marker.
// Run: node scripts/extract-plugins.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'host', 'legacy', 'plugin-host.js');
const modulePath = join(root, 'src', 'host', 'plugins.js');

const src = readFileSync(legacyPath, 'utf8');
const beginMarker = "    harness.handle('plugins/inventory', async (args) => {";
const start = src.indexOf(beginMarker);
const undefineErr = src.indexOf("herr('[enhance] undefine failed', e);", start);
if (start === -1 || undefineErr === -1) throw new Error('plugins markers not found');
const closeIdx = src.indexOf('});', undefineErr);
if (closeIdx === -1) throw new Error('plugins end not found');
const end = closeIdx + 3;

const chunk = src.slice(start, end);
const legacyWithout = src.slice(0, start) + '// @dsh-plugins-inject' + src.slice(end);

const moduleCode = `'use strict';\n// Extracted plugin management RPC handlers from legacy host source.\n// build-host.mjs injects this chunk back into the generated root plugin-host.js.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('plugins extracted ->', modulePath);
