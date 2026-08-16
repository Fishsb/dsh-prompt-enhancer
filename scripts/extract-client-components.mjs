// One-time / maintenance helper: extract the React UI components from the
// legacy client source into src/client/components/*.js and leave build
// injection markers. Each chunk is the exact text between two consecutive
// component anchors, so build-client.mjs can inject it back verbatim.
// Run: node scripts/extract-client-components.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const legacyPath = join(root, 'src', 'client', 'legacy', 'plugin-client.js');
const componentsDir = join(root, 'src', 'client', 'components');

const src = readFileSync(legacyPath, 'utf8');

// Anchor sequence: each component starts at its function declaration; the
// last segment ends where the CSS array begins.
const ANCHORS = [
  ['enhance-button', 'function EnhanceButton(props) {'],
  ['enhance-bar', 'function EnhanceBar(props) {'],
  ['updater-card', 'function UpdaterCard(props) {'],
  ['plugins-section', 'function PluginsSection(props) {'],
  ['collapsible-section', 'function CollapsibleSection(props) {'],
  ['model-main-section', 'function ModelMainSection(props) {'],
  ['fallback-row', 'function FallbackRow(props) {'],
  ['model-config-tab', 'function ModelConfigTab(props) {'],
  ['params-tab', 'function ParamsTab(props) {'],
  ['model-plugins-section', 'function ModelPluginsSection(props) {'],
  ['__css__', 'const CSS = ['],
];

// Locate all anchors first (positions are stable while scanning).
const positions = [];
for (const [name, anchor] of ANCHORS) {
  const idx = src.indexOf(anchor);
  if (idx === -1) throw new Error('anchor not found: ' + anchor);
  positions.push({ name, anchor, idx });
}

// Build segments: [anchor_i, anchor_{i+1}) — the chunk belongs to segment i.
const segments = [];
for (let i = 0; i < positions.length - 1; i++) {
  const seg = {
    name: positions[i].name,
    start: positions[i].idx,
    end: positions[i + 1].idx,
  };
  if (seg.end <= seg.start) throw new Error('segment out of order: ' + seg.name);
  const chunk = src.slice(seg.start, seg.end);
  // The segment must contain the next anchor once and no later anchor.
  if (!chunk.includes(positions[i].anchor)) throw new Error('chunk start mismatch: ' + seg.name);
  if (chunk.includes(positions[i + 1].anchor)) throw new Error('chunk contains next anchor: ' + seg.name);
  // Rough brace sanity: a component body should not end with more opens
  // than closes (function declaration adds exactly one open).
  const opens = (chunk.match(/\{/g) || []).length;
  const closes = (chunk.match(/\}/g) || []).length;
  if (closes - opens > 1) throw new Error('brace imbalance (closes>opens+1): ' + seg.name);
  seg.chunk = chunk;
  segments.push(seg);
}

// Rewrite the legacy file from the last segment backwards so earlier
// positions stay valid. Markers carry a trailing newline so the intermediate
// legacy file stays syntactically valid (a bare // marker would swallow the
// following marker / const CSS = [ line); build-client.mjs replaces the
// marker+newline pair with the chunk text, restoring the original bytes.
let out = src;
mkdirSync(componentsDir, { recursive: true });
for (let i = segments.length - 1; i >= 0; i--) {
  const seg = segments[i];
  const marker = '// @dsh-client-comp-' + seg.name + '-inject\n';
  out = out.slice(0, seg.start) + marker + out.slice(seg.end);
  const moduleCode = `'use strict';\n// Extracted React component chunk from legacy client source.\n// build-client.mjs injects this chunk back into the generated client bundle.\nmodule.exports = ${JSON.stringify(seg.chunk)};\n`;
  writeFileSync(join(componentsDir, seg.name + '.js'), moduleCode, 'utf8');
  console.log('component extracted ->', seg.name + '.js (' + seg.chunk.length + ' chars)');
}

writeFileSync(legacyPath, out, 'utf8');
console.log('legacy client updated with', segments.length, 'injection markers');
