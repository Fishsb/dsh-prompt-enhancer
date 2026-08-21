#!/usr/bin/env node
// scripts/asr-deploy.mjs — 本地 ASR worker 部署脚本（P2）
// 用途：把 lib/asr-worker.cjs 部署到 $DSH_HOME/dsh-prompt-enhancer-asr/，
//       安装 sherpa-onnx（若缺）、校验模型（SenseVoice int8 228MB）、启动 worker（3082）。
// 用法：node scripts/asr-deploy.mjs [--check] [--start] [--force-model]
//   --check：仅校验部署状态（worker/包/模型），不部署不启动
//   --start：部署后启动 worker（spawn detached + 健康检查）
// 设计对齐 updater executor 模式；worker 目录部署清单化（防「漏复制 MODULE_NOT_FOUND」教训）。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const checkOnly = process.argv.includes('--check');
const doStart = process.argv.includes('--start');

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const ASR_DIR = join(DSH_HOME, 'dsh-prompt-enhancer-asr');
const WORKER_SRC = join(repoRoot, 'lib', 'asr-worker.cjs');
const WORKER_DST = join(ASR_DIR, 'asr-worker.cjs');
const SHERPA_DIR = join(ASR_DIR, 'node_modules', 'sherpa-onnx');
const MODEL_DIR = join(ASR_DIR, 'models', 'sense-voice');
const MODEL_ONNX = join(MODEL_DIR, 'model.int8.onnx');
const TOKENS = join(MODEL_DIR, 'tokens.txt');
const PORT = 3082;

const fail = (msg) => { console.error('❌ ' + msg); process.exit(1); };

// 找 node/npm（PATH 优先，回退 managed）
function nodeBin() {
  const p = process.env.NODE || 'node';
  return p;
}

function checkStatus() {
  const ok = {};
  ok.workerFile = existsSync(WORKER_DST);
  ok.sherpaPkg = existsSync(join(SHERPA_DIR, 'index.js'));
  ok.modelOnnx = existsSync(MODEL_ONNX);
  ok.tokens = existsSync(TOKENS);
  // worker 存活探测
  ok.workerUp = false;
  try {
    const { execSync } = requireChild();
    const out = execSync('curl -s --max-time 2 http://127.0.0.1:' + PORT + '/health 2>/dev/null || echo NO', { encoding: 'utf8' });
    ok.workerUp = out.includes('"ok":true') || out.includes('"ok": true');
  } catch (e) { /* down */ }
  return ok;
}

function requireChild() {
  return { execSync: (cmd, o) => { const r = spawnSync(cmd, { shell: true, encoding: 'utf8', ...o }); if (r.error) throw r.error; return r; } };
}

const st = checkStatus();
console.log('=== 本地 ASR worker 状态 ===');
console.log('worker 文件   : ' + (st.workerFile ? '✓' : '✗'));
console.log('sherpa-onnx   : ' + (st.sherpaPkg ? '✓' : '✗（需安装）'));
console.log('模型 int8     : ' + (st.modelOnnx ? '✓' : '✗（需下载 228MB）'));
console.log('tokens.txt    : ' + (st.tokens ? '✓' : '✗'));
console.log('worker 进程   : ' + (st.workerUp ? '✓ 运行中 :' + PORT : '✗ 未运行'));

if (checkOnly) {
  process.exit(st.workerFile && st.sherpaPkg && st.modelOnnx && st.tokens && st.workerUp ? 0 : 1);
}

// 部署
mkdirSync(ASR_DIR, { recursive: true });
// v3.2.16（部署修复）：worker 文件必须始终覆盖同步——旧条件「目标不存在或目录为空才复制」
// 导致 v3.2.7+ 多模型支持（DSH_ASR_MODEL/DSH_ASR_MODEL_TYPE）从未更新到已装环境，
// 模型切换永远加载 sense-voice（旧 worker 硬编码 models/sense-voice）。
copyFileSync(WORKER_SRC, WORKER_DST);
console.log('✓ worker 已复制到 ' + ASR_DIR);
if (!st.sherpaPkg) {
  console.log('安装 sherpa-onnx（npm install，约 30-60s）…');
  const r = spawnSync(nodeBin(), [join(homedir(), '.workbuddy', 'binaries', 'node', 'versions', '22.22.2', 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'install', 'sherpa-onnx', '--prefix', ASR_DIR, '--no-fund', '--no-audit'], { encoding: 'utf8' });
  if (r.status !== 0) fail('sherpa-onnx 安装失败：' + (r.stderr || r.stdout || '').slice(0, 300));
  console.log('✓ sherpa-onnx 已安装');
}
if (!st.modelOnnx || !st.tokens) {
  fail('模型缺失：请先下载 SenseVoice int8 到 ' + MODEL_DIR + '（228MB，见 README 或运行模型下载脚本）');
}
if (doStart) {
  // 2026-08-20（桌面端随机端口·多实例）：3082 已健康（可能是另一 DSH 实例的 worker，同 DSH_HOME 可共享）→ 复用跳过启动
  if (st.workerUp) {
    console.log('✓ worker 已在运行（:' + PORT + '）——复用，跳过启动（多实例共享，避免端口冲突）');
  } else {
    // v3.2.16（模型持久化）：worker 首次启动携带配置中的当前模型（voice.asr.local.model）——
    // 避免 DSH 重启后 worker 默认 sense-voice 与设置页已切换的模型不一致。
    let modelId = null;
    try {
      const cfg = JSON.parse(readFileSync(join(DSH_HOME, 'dsh-prompt-enhancer.config.json'), 'utf8'));
      const m = cfg && cfg.voice && cfg.voice.asr && cfg.voice.asr.local && cfg.voice.asr.local.model;
      if (typeof m === 'string' && m && /^[A-Za-z0-9._-]{1,64}$/.test(m)) modelId = m;
    } catch (e) { /* 无配置/损坏 → 默认 sense-voice */ }
    // 启动 worker（detached；3082 被占时 worker 自身动态 fallback + 写 worker.port）
    const child = spawn(nodeBin(), [WORKER_DST], { detached: true, stdio: 'ignore', env: { ...process.env, ...(modelId ? { DSH_ASR_MODEL: modelId } : {}) } });
    child.unref();
    console.log('✓ worker 已启动（pid ' + child.pid + '），健康检查…');
    // 8s 内探测
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 8000) {
      const r = spawnSync('curl', ['-s', '--max-time', '1', 'http://127.0.0.1:' + PORT + '/health'], { encoding: 'utf8' });
      if (r.stdout && r.stdout.includes('"ok"')) { up = true; break; }
      spawnSync(nodeBin(), ['-e', 'setTimeout(()=>{},500)']);
    }
    console.log(up ? '✓ worker 健康检查通过' : '⚠️ worker 启动中/未就绪（稍后重试或查日志；3082 被占时已动态换端口，host 会读 worker.port）');
  }
}
console.log('=== 部署完成 ===');
