'use strict';
/**
 * ASR worker 发现面 —— win32 误杀宿主事故的回归判据（2026-10-09）
 *
 * 背景（本机 win32 实测，读数见 CHANGELOG 同批次条目）：
 *   `workerPidsByProcessScan()` 的 win32 分支只按**进程名**枚举
 *   （`Get-CimInstance Win32_Process -Filter "Name='node.exe'"`），而 posix 分支按
 *   **命令行**匹配 `asr-worker.cjs` —— 同一函数的两条腿判据不一致。
 *   后果不是"少发现"，而是"全都发现"：本机 5 个 node 进程（**含宿主自身**）全部进
 *   发现集，`sweepStaleWorkers()` 随后按"只留一个"把它们逐一 `process.kill()`
 *   ⇒ 宿主在插件 apply 后约 5 秒被自己杀掉。
 *   实测栈：`process.kill` 拦截 ⇒ `sweepStaleWorkers` ← `ensureWorker` ← `Timeout._onTimeout`
 *   （`lib/index.cjs` 的 5s 定时器）；现象是前端连接落空、界面永久停在"自动重连中"。
 *
 * 三条腿，缺一即假绿：
 *   WIN1 结构腿（CI 可见）：win32 枚举必须**按命令行**过滤，清扫循环必须**跳过自身**。
 *      ⚠ 这条是纯文本断言，之所以仍要它：上游 CI 只跑 ubuntu-latest，win32 分支**永远
 *      不被执行**，行为腿在 CI 上咬不到它 —— 这是 CI 唯一能看的信号。
 *   WIN2 反向行为腿（跨平台）：返回集不得含自身，也不得含命令行不含 `asr-worker.cjs` 的进程。
 *   WIN3 正向行为腿（跨平台）：命令行携带 worker 脚本路径的进程**必须**被发现
 *      —— 防"改成 `return []`"冒充修复：发现面归零同样是坏的，只是坏得安静。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const SRC = path.join(__dirname, '..', 'lib', 'asr-models.cjs');
const src = fs.readFileSync(SRC, 'utf8');
const m = require(SRC);

const WORKER = path.join(m.asrDir(), 'asr-worker.cjs');

/** 同步等待（node --test 的用例体是同步的，取材需要给替身进程一点启动时间）。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 取一张 pid → 命令行 的表（用于核对"被发现的是不是真 worker"）。
 * win32 走一次 CIM 查询（逐 pid 起 PowerShell 太慢）；posix 读 /proc/<pid>/cmdline。
 * @returns {Map<number,string>|null} 取不到（平台工具缺失/异常）时为 null
 */
function commandLines() {
  const table = new Map();
  try {
    if (process.platform === 'win32') {
      const ps = cp.spawnSync('powershell', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"],
        { encoding: 'utf8', timeout: 15000, windowsHide: true });
      for (const line of String(ps.stdout || '').split(/\r?\n/)) {
        const tab = line.indexOf('\t');
        if (tab <= 0) continue;
        const pid = Number(line.slice(0, tab).trim());
        if (pid > 0) table.set(pid, line.slice(tab + 1));
      }
    } else {
      for (const entry of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          table.set(Number(entry), fs.readFileSync('/proc/' + entry + '/cmdline', 'utf8').split('\0').join(' '));
        } catch (e) { /* 进程已退出/无权限 → 不登记 */ }
      }
    }
  } catch (e) { return null; }
  return table;
}

test('ASR-WIN1 结构腿：win32 枚举必须按命令行过滤，清扫必须跳过自身（CI 唯一可见的信号）', () => {
  // 钉住本次事故的**确切形状**：win32 分支若退回"只按进程名"，本断言必红。
  // ⚠ 必须在 workerPidsByProcessScan 的**函数体内**断言：workerListenerPids 里也有
  //   一处 `platform === 'win32'`（端口通道），截错函数会得到一条永远为真的假绿。
  const fnStart = src.indexOf('function workerPidsByProcessScan');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const scanBody = src.slice(fnStart, fnEnd === -1 ? src.length : fnEnd);
  const winBody = scanBody.slice(scanBody.indexOf("if (process.platform === 'win32')"));
  assert.ok(/\$_\.CommandLine\s+-like/.test(winBody),
    'win32 枚举必须按命令行（$_.CommandLine）过滤 worker，不得只按进程名 Name=\'node.exe\' 枚举全部 node 进程');
  assert.ok(/pid\s*!==\s*process\.pid/.test(winBody),
    'win32 枚举必须排除自身 pid（发现面永不把宿主列为候选 worker）');
  // 纵深防御腿：即便发现面将来再退化，清扫也不得把宿主自己交出去。
  const sweep = src.slice(src.indexOf('function sweepStaleWorkers'));
  const loop = sweep.slice(0, sweep.indexOf('return { killed, kept: keep }'));
  assert.ok(/pid\s*===\s*keep\s*\|\|\s*pid\s*===\s*process\.pid/.test(loop),
    'sweepStaleWorkers 的 kill 循环必须同时跳过 keep 与 process.pid');
});

test('ASR-WIN2 反向行为腿：扫描不得把非 worker 进程（含宿主自身）当 worker', () => {
  const scanned = m.workerPidsByProcessScan();
  assert.ok(!scanned.includes(process.pid),
    `进程扫描不得返回自身 pid ${process.pid}（返回它 = 清扫会杀掉宿主自己）；实测 ${JSON.stringify(scanned)}`);

  const table = commandLines();
  if (table === null) {
    console.log('  [未取材] 本机取不到进程命令行表，只做自身排除腿');
    return;
  }
  // 反向：返回的每个 pid 的命令行都必须含 asr-worker.cjs（取不到命令行的视为已退出，跳过）
  const bogus = scanned.filter((pid) => table.has(pid) && !table.get(pid).includes('asr-worker.cjs'));
  assert.equal(bogus.length, 0,
    `进程扫描不得返回非 worker 进程：实测 ${JSON.stringify(bogus)}（扫描共 ${JSON.stringify(scanned)}）`);
});

test('ASR-WIN3 正向行为腿：命令行携带 worker 脚本路径的进程必须被发现（防 return [] 假修复）', () => {
  // 用一个"命令行签名与 worker 相同"的替身进程取材：两条腿（/proc 与 CIM）都以
  // 「命令行里出现 worker 脚本路径」为判据，替身因此对被测量是等价的，且不必加载模型。
  // 替身寿命给足（180s）：win32 每次扫描都要起一次 PowerShell，机器繁忙时单次可达数秒，
  // 寿命短会让"还没扫到"冒充"扫不到"（实测：20s 寿命在全量套件里被本用例自己耗光）。
  const decoy = cp.spawn(process.execPath, ['-e', 'setTimeout(function () {}, 180000)', WORKER], {
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    let found = [];
    let slow = false;
    // 至多扫 3 次。区分两种"没扫到"：枚举本身超时（win32 走 PowerShell，模块内头寸 5s，
    // 繁忙时会 ETIMEDOUT ⇒ stdout 为空 ⇒ 返回 []，这是环境而非判据的读数）与
    // 枚举正常但漏掉替身（真失败）。据此决定是重试还是立即判红。
    for (let i = 0; i < 3; i++) {
      sleepSync(800);
      const t0 = Date.now();
      found = m.workerPidsByProcessScan();
      slow = Date.now() - t0 >= 4800;
      if (found.includes(decoy.pid)) break;
      if (!slow) break;
    }
    if (slow && !found.includes(decoy.pid)) {
      console.log('  [未取材] 本机进程枚举单次耗时 >=4.8s（win32 PowerShell 头寸 5s 被占满），'
        + '本次读数 [] 不能区分"漏发现"与"枚举超时"，不计 PASS');
      return;
    }
    assert.ok(found.includes(decoy.pid),
      `命令行携带 ${WORKER} 的进程必须被发现（pid ${decoy.pid}）；实测 ${JSON.stringify(found)}`);
  } finally {
    try { decoy.kill(); } catch (e) { /* 已退出 */ }
    sleepSync(200);
  }
});
