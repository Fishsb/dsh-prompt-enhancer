// One-time / maintenance helper: extract the enhance RPC handlers
// (enhance/progress, enhance, cancel) from the legacy host source into
// src/host/enhance-handlers.js and leave a build injection marker.
// Note: the chunk lives in enhance-handlers.js (pure text chunk); the M2
// service skeleton lives separately in src/host/enhance.js.
// Run: node scripts/extract-enhance.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'host', 'legacy', 'plugin-host.js');
const modulePath = join(root, 'src', 'host', 'enhance-handlers.js');

const src = readFileSync(legacyPath, 'utf8');

// Start: the progress-polling RPC comment that precedes the enhance handlers
// (after the update/apply removal note, before harness.handle('enhance/progress')).
const beginMarker = '    // v2.3（§7.3）：优化进度轮询 RPC';
const start = src.indexOf(beginMarker);
if (start === -1) throw new Error('enhance begin marker not found');

// End: close of the cancel handler (the last of the three enhance-family RPCs).
const cancelIdx = src.indexOf("harness.handle('cancel'", start);
if (cancelIdx === -1) throw new Error('cancel handler not found');
const endMarker = '    });';
const end = src.indexOf(endMarker, cancelIdx);
if (end === -1) throw new Error('cancel handler end not found');
const endPos = end + endMarker.length;

const chunk = src.slice(start, endPos);

// Sanity: the chunk must start with the progress RPC and end with the cancel close.
if (!chunk.startsWith(beginMarker)) throw new Error('chunk start mismatch');
if (!chunk.endsWith(endMarker)) throw new Error('chunk end mismatch');
if (chunk.indexOf("harness.handle('enhance'") === -1) throw new Error('enhance handler missing from chunk');
if (chunk.indexOf("harness.handle('enhance/progress'") === -1) throw new Error('progress handler missing from chunk');

const legacyWithout = src.slice(0, start) + '// @dsh-enhance-inject' + src.slice(endPos);

const moduleCode = `'use strict';\n// Extracted enhance RPC handlers (enhance/progress, enhance, cancel) from legacy host source.\n// build-host.mjs injects this chunk back into the generated host bundle.\nmodule.exports = ${JSON.stringify(chunk)};\n`;

writeFileSync(modulePath, moduleCode, 'utf8');
writeFileSync(legacyPath, legacyWithout, 'utf8');
console.log('host enhance extracted ->', modulePath, '(' + chunk.length + ' chars)');
