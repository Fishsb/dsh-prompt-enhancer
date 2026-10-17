#!/usr/bin/env node
// scripts/settings-text-audit-mutations.mjs —— 本批「变异自证 + 负控必绿」装置
//
// 为什么要单独一支（承 AGENTS「判据不得恒红/恒绿」纪律）：
//   ① 变异自证（正例必红）：把本批修的三件事逐个**故意做坏**，对应判据必须变红；
//   ② 负控必绿：不改任何文件（只复制一份 pristine 树）⇒ 判据必须全绿。
//   ⚠ 每例都在**全新 pristine 副本**里跑（不污染工作区）；副本含 .git（S-8 的 git ls-files --eol 需要）
//     与 docs/（card / arch 环的扫描面）；node_modules 用软链（依赖是环境，不是被测面）。
//   ⚠ 「剥环境噪声」：判定只认脚本自己的 PASS/FAIL 行与退出码，不解析 node 的 warning 行。
//
// 用法：node scripts/settings-text-audit-mutations.mjs [--keep]
// 退出码：0 = 全部符合预期；1 = 有不符合项
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const KEEP = process.argv.includes('--keep');
const NODE = process.execPath;
const HEAD_LIT = 'module.exports = "';

function makePristine(tag) {
  const dir = path.join(os.tmpdir(), 'pe-audit-' + tag + '-' + process.pid + '-' + Math.random().toString(36).slice(2, 7));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync('bash', ['-lc',
    'cd ' + JSON.stringify(REPO) + ' && tar -cf - --exclude=node_modules --exclude=.git/index.lock . | tar -xf - -C ' + JSON.stringify(dir)
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('副本创建失败：' + (r.stderr || r.stdout));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

function decodeIn(root, rel) {
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const i = raw.indexOf(HEAD_LIT);
  const end = raw.lastIndexOf('";');
  if (i < 0 || end < 0) throw new Error('chunk 包裹读不出：' + rel);
  return { raw, i, end, src: JSON.parse('"' + raw.slice(i + HEAD_LIT.length, end) + '"') };
}

// 只改 chunk 的**字符串字面量内部**，前缀/尾缀原样保留（字节级安全的既有做法）
function patchChunk(root, rel, edits) {
  const { raw, i, end, src } = decodeIn(root, rel);
  let out = src;
  for (const pair of edits) {
    const from = pair[0], to = pair[1];
    if (!out.includes(from)) throw new Error('变异锚点未命中：' + JSON.stringify(String(from).slice(0, 60)) + ' @ ' + rel);
    out = out.split(from).join(to);
  }
  const lit = JSON.stringify(out);
  fs.writeFileSync(path.join(root, rel), raw.slice(0, i + HEAD_LIT.length) + lit.slice(1, -1) + raw.slice(end), 'utf8');
}

function runAudit(root) {
  const r = spawnSync(NODE, [path.join(root, 'scripts/settings-layout-audit.mjs'), '--root', root], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  const out = String(r.stdout || '');
  let verdict = 'UNKNOWN';
  if (/PASS \| squeeze-audit/.test(out)) verdict = 'PASS';
  else if (/FAIL \| squeeze-audit/.test(out)) verdict = 'FAIL';
  else if (/scenario-error|result-extract|browser-found/.test(out)) verdict = 'ERROR';
  const m = out.match(/REAL（zh\/en × 最长现实取值）: (\d+) 条/);
  return { verdict, real: m ? m[1] : '?', out };
}

function runTest(root, file, pattern) {
  const r = spawnSync(NODE, ['--test', path.join(root, file)], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  const out = String(r.stdout || '');
  const lines = out.split('\n').filter((l) => l.includes(pattern));
  const failed = lines.some((l) => /^not ok/.test(l) || /^# Subtest:.*\nnot ok/.test(l)) || (lines.length === 0 && r.status !== 0);
  const pass = lines.some((l) => /^ok /.test(l));
  return { verdict: failed ? 'RED' : (pass ? 'GREEN' : 'UNKNOWN'), line: lines.join(' / ').slice(0, 240) };
}

const CASES = [];
const expectCase = (name, kind, fn) => CASES.push({ name, kind, fn });

expectCase('M1 超长文案（40 字）塞进 label 列', 'FAIL', async (root) => {
  await patchChunk(root, 'src/client/i18n.js', [["cfgMaxTokens: '回复长度上限'", "cfgMaxTokens: '" + '超长文案'.repeat(10) + "'"]]);
  return runAudit(root);
});

expectCase('M2 超长文案塞进固定宽开关（不换行控件）', 'FAIL', async (root) => {
  await patchChunk(root, 'src/client/i18n.js', [["voiceAutoEnhance: '自动增强'", "voiceAutoEnhance: '" + '超长文案'.repeat(10) + "'"]]);
  return runAudit(root);
});

expectCase('M3 关闭态（0 档）改回渲染长句读数', 'RED', async (root) => {
  await patchChunk(root, 'src/client/voice/voice-section.js', [["vadOn ? (silenceSec + ' ' + t('voiceVadSilenceUnit')) : ''", "vadOn ? (silenceSec + ' ' + t('voiceVadSilenceUnit')) : t('voiceSilenceOff')"]]);
  return runTest(root, 'test/vad-silence.test.cjs', 'VADSIL-P14e');
});

expectCase('M4 删掉 startMissed 异常分支文案', 'RED', async (root) => {
  // 行为判据：该态改报正常分支 ⇒ VTP-C 必红（文本层查子串抓不到这种形态）
  await patchChunk(root, 'src/client/voice/voice-section.js', [["else if (snap.startMissed > 0 && snap.sessionsStarted === 0) { text = t('voiceOfficialStartMissed'); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }", "else if (snap.startMissed > 0 && snap.sessionsStarted === 0) { text = t('voiceOfficialArmed'); }"]]);
  return runTest(root, 'test/voice-text-position.test.cjs', 'VTP-C');
});

expectCase('M5 删掉 abandon 异常分支文案', 'RED', async (root) => {
  // 行为判据（VTP-C 求值真实分支链）：删掉该分支后降级态落到别的键 ⇒ 必红。
  await patchChunk(root, 'src/client/voice/voice-section.js', [["else if (snap.abandonReason) { text = t('voiceOfficialAbandon'); cls = 'dsh-plg-note dsh-plg-upd-outdated'; }", "else if (snap.abandonReason) { text = t('voiceOfficialArmed'); }"]]);
  return runTest(root, 'test/voice-text-position.test.cjs', 'VTP-C');
});

expectCase('M6 挤压根因回退：读数规则删掉 + 关闭态长句回来', 'FAIL', async (root) => {
  await patchChunk(root, 'src/client/styles.js', [["  '.dsh-plg-row > .dsh-plg-muted{flex:none;white-space:nowrap;max-width:40%;overflow:hidden;text-overflow:ellipsis}',\n", '']]);
  await patchChunk(root, 'src/client/voice/voice-section.js', [["vadOn ? (silenceSec + ' ' + t('voiceVadSilenceUnit')) : ''", "vadOn ? (silenceSec + ' ' + t('voiceVadSilenceUnit')) : t('voiceSilenceOff')"]]);
  return runAudit(root);
});

expectCase('M7 label 列改回内容定宽', 'FAIL', async (root) => {
  await patchChunk(root, 'src/client/styles.js', [["'.dsh-plg-label{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);flex:none;width:120px;min-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'", "'.dsh-plg-label{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);flex:none;min-width:96px}'"]]);
  return runAudit(root);
});

expectCase('M8 文案 bug 回归（主谓同词）', 'RED', async (root) => {
  // 本批修法是「只改值、不改键名、不新增键」⇒ 回归的形态是**把谓词键的值改回与主语同词**
  //   （不是换键）。这正是用户当初看到「清口水词：清口水词」的那一态。
  await patchChunk(root, 'src/client/i18n.js', [["voiceRefineEnabled: '这次没有口水词'", "voiceRefineEnabled: '清口水词'"]]);
  return runTest(root, 'test/voice-text-audit.test.cjs', 'VTX-A');
});

expectCase('N0 负控·不动任何文件', 'GREEN', async (root) => {
  const a = runAudit(root);
  const b = runTest(root, 'test/vad-silence.test.cjs', 'VADSIL-P14e');
  const c = runTest(root, 'test/official-bridge.test.cjs', 'OVB-W03');
  const d = runTest(root, 'test/voice-text-audit.test.cjs', 'VTX-A');
  const e = runTest(root, 'test/voice-text-position.test.cjs', 'VTP-');
  const verdict = [a.verdict, b.verdict, c.verdict, d.verdict, e.verdict].every((v) => v === 'PASS' || v === 'GREEN') ? 'GREEN' : 'RED';
  return { verdict, real: a.real, line: 'audit=' + a.verdict + ' P14e=' + b.verdict + ' W03=' + c.verdict + ' VTP=' + e.verdict };
});

async function main() {
  let bad = 0;
  for (const c of CASES) {
    const root = makePristine(c.name.split(' ')[0]);
    let res;
    try { res = await c.fn(root); } catch (e) { res = { verdict: 'ERROR', line: String((e && e.message) || e) }; }
    const ok = res.verdict === c.kind;
    if (!ok) bad++;
    console.log((ok ? 'PASS' : 'FAIL') + ' | ' + c.name + ' | 期望 ' + c.kind + ' 实得 ' + res.verdict + (res.real && res.real !== '?' ? '（REAL=' + res.real + '）' : '') + (ok ? '' : ' | ' + (res.line || '')));
    if (!KEEP) fs.rmSync(root, { recursive: true, force: true });
    else console.log('      副本保留：' + root);
  }
  console.log('');
  console.log(bad === 0 ? '✓ 变异自证 + 负控全部符合预期（' + CASES.length + ' 例）' : '✗ ' + bad + ' 例不符合预期');
  process.exitCode = bad === 0 ? 0 : 1;
}

main().catch((e) => { console.error('FAIL | mutation-harness | ' + ((e && e.stack) || e)); process.exitCode = 1; });
