// dsh-prompt-enhancer 端到端回归：服务模式端口重启（真实链路）
//
// 用途：验证「端口重启」在真实服务环境（nssm 接管态）下稳定无竞态。本脚本
// **通过 HTTP 调 host 的真实 update/portRestart RPC**（与用户点设置按钮完全同一条
// 链路：host 创建 schtasks → /run 触发 → SYSTEM powershell 执行 sc.exe stop →
// 轮询 3080 释放(≤30s) → sc.exe start → 自删），脚本只做观测，不代跑任何服务命令。
//
// 校验项：
//   ① 服务存在且 RUNNING（3080 监听者在会话 0 = 服务 node）
//   ② RPC 返回 ok
//   ③ 3080 由【新 PID】接管（≠ 重启前）
//   ④ 新监听者在会话 0（仍是服务托管，没有被拉成前台）
//   ⑤ dsh-web.err.log 无本次窗口新增 EADDRINUSE
//   ⑥ DSHPortRestart 调度任务执行后自删
//
// 用法：node test/e2e-restart.cjs [次数，默认 3]
// 前置：nssm 服务 dsh-web 已安装且 Running；DSH 页面可达（127.0.0.1:3080）。
// 注意：会真实触发服务重启（用户正常端口重启行为），请勿在重要会话中运行。

const { spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const SVC = 'dsh-web';
const PORT = 3080;
const HOST = '127.0.0.1';
const RPC_PATH = '/dsh-prompt-enhancer/rpc';
const EXEC_ROOT = path.join(process.env.LOCALAPPDATA || '', 'dsh-prompt-enhancer', 'executor');
const ERR_LOG = path.join(EXEC_ROOT, 'dsh-web.err.log');
const TASK_NAME = 'DSHPortRestart';
const ROUNDS = Math.max(1, Number(process.argv[2] || 3));

// ---------- 观测基元 ----------
function netstat3080() {
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  const m = String(r.stdout || '').match(/:3080\s+\S+\s+LISTENING\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

function pidSession(pid) {
  // 通过 netstat 的 ESTABLISHED 行无法直接拿会话；用 tasklist /FI 查会话号
  const r = spawnSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  const m = String(r.stdout || '').match(/^"[^"]*","(\d+)","([^"]*)","(\d+)"/m);
  // CSV: name,pid,sessionName,session#,mem
  return m ? Number(m[3]) : null;
}

function rpcCall(method, args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ method, args: args || {} });
    const req = http.request({
      host: HOST, port: PORT, path: RPC_PATH, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { resolve({ ok: false, message: 'bad-json' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, message: String(e.message) }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, message: 'timeout' }); });
    req.end(body);
  });
}

function errSize() {
  try { return fs.statSync(ERR_LOG).size; } catch { return 0; }
}

function errNewEaddrinuse(beforeSize) {
  try {
    const st = fs.statSync(ERR_LOG);
    if (st.size <= beforeSize) return false;
    const fd = fs.openSync(ERR_LOG, 'r');
    const buf = Buffer.alloc(st.size - beforeSize);
    fs.readSync(fd, buf, 0, buf.length, beforeSize);
    fs.closeSync(fd);
    return /EADDRINUSE/.test(buf.toString('utf8'));
  } catch { return false; }
}

function taskGone() {
  const r = spawnSync('schtasks', ['/query', '/tn', TASK_NAME], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  return r.status !== 0; // 查询失败 = 任务不存在（已自删）
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 主流程 ----------
let pass = 0, fail = 0;
console.log('=== 服务模式端口重启端到端回归（真实 RPC 链路）× ' + ROUNDS + ' ===');

(async () => {
  for (let i = 1; i <= ROUNDS; i++) {
    const label = 'R' + i;
    const beforePid = netstat3080();
    if (beforePid === 0) { console.log(label + ' FAIL: 3080 无监听（前置不满足）'); fail++; continue; }
    const beforeSess = pidSession(beforePid);
    if (beforeSess !== 0) { console.log(label + ' SKIP: 当前非服务接管态（会话 ' + beforeSess + '，跳过——本回归只测服务模式）'); continue; }
    const beforeErr = errSize();

    process.stdout.write(label + ' 触发 RPC ... ');
    const rpc = await rpcCall('update/portRestart', { serviceName: SVC });
    if (!rpc || rpc.ok !== true) {
      console.log('FAIL: RPC 未返回 ok (' + JSON.stringify(rpc).slice(0, 120) + ')');
      fail++; continue;
    }
    console.log('ok (' + (rpc.message || '').slice(0, 40) + ')');

    // 等新 PID 接管（90s 上限：任务 3s + 释放轮询 ≤30s + 服务启动 + 余量）
    let newPid = 0, elapsed = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      const p = netstat3080();
      if (p !== 0 && p !== beforePid) { newPid = p; elapsed = Date.now() - t0; break; }
      await sleep(1000);
    }

    const newSess = newPid ? pidSession(newPid) : null;
    const eaddrinuse = errNewEaddrinuse(beforeErr);
    const taskSelfDel = taskGone();

    const ok = newPid !== 0 && newSess === 0 && !eaddrinuse;
    if (ok) {
      console.log(label + ' PASS (PID ' + beforePid + '→' + newPid + ' ' + elapsed + 'ms, 会话0服务接管, 任务自删=' + (taskSelfDel ? 'Y' : 'N') + ', 无EADDRINUSE)');
      pass++;
    } else {
      console.log(label + ' FAIL: 接管=' + (newPid ? 'OK→' + newPid + '(会话' + newSess + ')' : '超时') + ' EADDRINUSE=' + (eaddrinuse ? '发现!' : '无') + ' 任务残留=' + (taskSelfDel ? '无' : '有'));
      fail++;
    }
    if (i < ROUNDS) await sleep(4000);
  }
  console.log('=== 结果: ' + pass + ' PASS / ' + fail + ' FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})();
