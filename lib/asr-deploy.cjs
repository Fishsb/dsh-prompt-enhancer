'use strict';
/**
 * dsh-prompt-enhancer — lib/asr-deploy.cjs（本地 ASR 运行时部署，RPC voice/deployRuntime）
 *
 * #4 修复（2026-08-21）：本地引擎依赖独立运行时目录 $DSH_HOME/dsh-prompt-enhancer-asr
 * （asr-worker.cjs + node_modules/sherpa-onnx[node 版] + models/），该目录不会随插件自动初始化
 * ——普通用户装插件后 worker 起不来 → voice/status 恒报 installed:false（"✗ 本地引擎未安装"）。
 * 本模块提供：
 *   checkRuntime()  诊断缺失项（worker 文件 / sherpa-onnx 包 / worker 存活）
 *   startDeploy()   复制 worker + npm install sherpa-onnx（若缺）+ ensureWorker 启动（异步，不阻塞 host）
 *   deployStatus()  部署进度查询（前端轮询）
 * 逻辑对齐 scripts/asr-deploy.mjs；复用 asr-models 的 asrDir/isWorkerUp/ensureWorker。
 */
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const asrModels = require('./asr-models.cjs');

const state = { running: false, step: '', error: null, done: false, at: 0, launch: null };

/** 运行时诊断：worker 文件 / sherpa-onnx 包 / worker 存活 */
function checkRuntime() {
  const dir = asrModels.asrDir();
  return {
    workerFile: existsSync(path.join(dir, 'asr-worker.cjs')),
    sherpaPkg: existsSync(path.join(dir, 'node_modules', 'sherpa-onnx', 'index.js')),
    workerUp: asrModels.isWorkerUp(),
  };
}

/** 解析 npm-cli.js：npm_execpath > NPM_CLI env > managed node 兜底；全缺返回 null（fallback shell npm） */
function npmCli() {
  const candidates = [];
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) candidates.push(process.env.npm_execpath);
  if (process.env.NPM_CLI && existsSync(process.env.NPM_CLI)) candidates.push(process.env.NPM_CLI);
  const managed = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions', '22.22.2', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(managed)) candidates.push(managed);
  return candidates.find(Boolean) || null;
}

function deployStatus() {
  return Object.assign({ ok: true }, state, { runtime: checkRuntime() });
}

function startDeploy() {
  if (state.running) return { ok: true, running: true };
  const rt = checkRuntime();
  if (rt.workerFile && rt.sherpaPkg) {
    state.done = true; state.step = 'already-deployed'; state.error = null; state.launch = null;
    return { ok: true, skipped: 'already-deployed' };
  }
  state.running = true; state.error = null; state.done = false; state.at = Date.now(); state.launch = null;
  const dir = asrModels.asrDir();
  try { mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  // 1) 复制 worker（始终覆盖同步，防多模型支持未更新到已装环境）
  try {
    copyFileSync(path.join(__dirname, 'asr-worker.cjs'), path.join(dir, 'asr-worker.cjs'));
    state.step = 'worker-copied';
  } catch (e) {
    state.running = false; state.done = true;
    state.error = '复制 worker 失败: ' + String((e && e.message) || e);
    return { ok: false, error: state.error };
  }
  // 2) sherpa-onnx 已装 → 直接收尾（ensureWorker 启动）
  if (rt.sherpaPkg) return finishDeploy();
  // 3) npm install sherpa-onnx（异步 spawn，非阻塞 host；二进制 ~30-60s）
  state.step = 'npm-install';
  const cli = npmCli();
  let child;
  try {
    child = cli
      ? spawn(process.execPath, [cli, 'install', 'sherpa-onnx', '--prefix', dir, '--no-fund', '--no-audit'], { stdio: ['ignore', 'ignore', 'pipe'] })
      : spawn('npm', ['install', 'sherpa-onnx', '--prefix', dir, '--no-fund', '--no-audit'], { shell: true, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    state.running = false; state.done = true;
    state.error = '启动 npm 失败: ' + String((e && e.message) || e);
    return { ok: false, error: state.error };
  }
  child.on('error', (e) => {
    state.running = false; state.done = true;
    state.error = 'npm 启动失败: ' + String((e && e.message) || e);
  });
  child.on('close', (code) => {
    if (code !== 0) {
      state.running = false; state.done = true;
      state.error = 'npm install sherpa-onnx 失败（code ' + code + '），请检查网络后重试';
      return;
    }
    state.step = 'sherpa-installed';
    finishDeploy();
  });
  return { ok: true, started: true };
}

function finishDeploy() {
  state.running = false; state.done = true;
  try {
    state.launch = asrModels.ensureWorker() || null;
  } catch (e) {
    state.launch = { ok: false, error: String((e && e.message) || e) };
  }
  state.step = state.launch && state.launch.launched ? 'worker-started' : 'deployed';
  return { ok: true, ...(state.launch || {}) };
}

module.exports = { checkRuntime, deployStatus, startDeploy };
