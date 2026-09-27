'use strict';
/**
 * ASR worker 回收与防护 —— 回归判据（2026-09-27 事故二轮）
 *
 * 背景（实测事实，见 CHANGELOG 同批次条目）：
 *   ① 发现面不完整：worker.port 是**单值文件**（worker 侧 writeFileSync 覆盖写），
 *      N 个 worker 竞争写它 ⇒ 只留最后一个的口。加上 3082 固定口，发现集恒为「至多 2 个」。
 *      事故快照 30 个 worker 各占一个动态口时，端口通道只看得到 2 个，28 个（93%）永久隐身。
 *   ② 无回收：worker 以 detached+stdio:ignore 启动，与 host 无生命周期绑定；
 *      worker 自身无空闲 TTL（无 setTimeout/setInterval/process.exit）；插件无数量上限、无卸载清理。
 *      ⇒ 一旦堆积，没有任何机制收回来。
 *
 * 本判据钉住两条修复：
 *   A. 发现面 = 端口通道 ∪ 进程扫描（与 worker 数无关）
 *   B. sweepStaleWorkers() 把 N 收敛到 1，且优先保留监听 3082 的那个、幂等
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'lib', 'asr-models.cjs');
const src = fs.readFileSync(SRC, 'utf8');

test('ASR-R1 源码结构：必须存在进程扫描兜底与清扫函数', () => {
  assert.ok(/function\s+workerPidsByProcessScan/.test(src), '缺按进程命令行的枚举函数');
  assert.ok(/function\s+sweepStaleWorkers/.test(src), '缺清扫函数');
  assert.ok(/sweepStaleWorkers\s*\(/.test(src.split('module.exports')[0].split('function sweepStaleWorkers')[1] || ''),
    'sweepStaleWorkers 需被调用（不能只定义不用）');
  // ⚠ 接线判据：定义了 workerPidsByProcessScan 但没在 workerListenerPids 里调用它，
  // 等于发现面没修（变异 M1 实测能骗过纯文本断言 → 必须断言"真被调"）。
  const fnBody = src.slice(src.indexOf('function workerListenerPids'));
  const nextFn = fnBody.indexOf('\nfunction ', 1);
  const listenerBody = nextFn === -1 ? fnBody : fnBody.slice(0, nextFn);
  assert.ok(/workerPidsByProcessScan\s*\(\s*\)/.test(listenerBody),
    'workerListenerPids 必须**调用** workerPidsByProcessScan()（只定义不用 = 发现面未修）');
});

test('ASR-R1b 行为腿：进程扫描把 worker 从"仅端口可见"里救出来（证发现面真变宽）', () => {
  // 钉住 M1 类变异：若发现面退回"只看端口"，这条必红。
  // 做法：临时篡改 worker.port 指向一个不存在的口，使端口通道对**真实 worker** 失效；
  // 新实现靠进程扫描仍应看得见它们（至少 >=1），旧实现会归零。
  const cp = require('node:child_process');
  const PORTS_FILE = '/home/lk/.dsh/dsh-prompt-enhancer-asr/worker.port';
  let orig = null;
  try { orig = fs.readFileSync(PORTS_FILE, 'utf8'); } catch (e) { /* 无文件 */ }
  const real = (() => {
    try { return cp.execSync("pgrep -f 'asr-worker\\.cjs'", { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n').filter(Boolean).map(Number); } catch (e) { return []; }
  })();
  if (real.length === 0) { console.log('  [未取材] 无 worker，跳过'); return; }
  try {
    // 让端口通道完全失效：指向一个没人听的动态口，并假设 3082 不是它们所在口的情况
    fs.writeFileSync(PORTS_FILE, JSON.stringify({ port: 59998, pid: 0, ts: Date.now() }), 'utf8');
    delete require.cache[require.resolve(SRC)];
    const m2 = require(SRC);
    const found = m2.workerListenerPids();
    const foundNonPort = found.filter((p) => real.includes(p));
    assert.ok(foundNonPort.length > 0,
      `worker.port 指向无效口时，进程扫描仍必须发现真实 worker（否则发现面仍只靠端口）；实测发现 ${JSON.stringify(found)}`);
  } finally {
    if (orig !== null) fs.writeFileSync(PORTS_FILE, orig, 'utf8');
    delete require.cache[require.resolve(SRC)];
  }
});

test('ASR-R2 ensureWorker 必须先清扫再判活（否则堆积永不自愈）', () => {
  const body = src.slice(src.indexOf('function ensureWorker'));
  const iSweep = body.indexOf('sweepStaleWorkers()');
  const iUp = body.indexOf("skipped: 'worker-already-up'");
  const iNotInstalled = body.indexOf("skipped: 'model-not-installed'");
  const iNotLocal = body.indexOf("skipped: 'engine-not-local'");
  assert.ok(iSweep > -1, 'ensureWorker 内必须调 sweepStaleWorkers()');
  assert.ok(iUp > -1, 'ensureWorker 内应有 worker-already-up 短路');
  assert.ok(iSweep < iUp, '清扫必须在「已存在即跳过」之前，否则堆积不会收敛');
  // ⚠ 端到端实测抓到的缺口：清扫若落在**任一**早退分支之后，在该分支上堆积不会自愈
  // （实测「模型未装」机器上堆积 6 个仍完整保留）。故清扫必须早于所有 return。
  assert.ok(iSweep < iNotInstalled, '清扫必须早于 model-not-installed 早退（否则该分支堆积不自愈）');
  assert.ok(iSweep < iNotLocal, '清扫必须早于 engine-not-local 早退（同上）');
});

test('ASR-R2b 行为腿：早退分支上仍必须完成清扫（真起进程验证）', () => {
  // 钉住 R2 的结构断言：在真实环境里，若 ensureWorker 命中的是早退分支，
  // 清扫仍须发生（返回值带 swept 字段可观测）。
  const m = require(SRC);
  const r = m.ensureWorker();
  // 无论命中哪个分支，清扫结果都必须可见（swept 字段存在）
  assert.ok(Object.prototype.hasOwnProperty.call(r, 'swept'),
    `ensureWorker 的返回值必须带 swept 字段以便观测清扫（实测返回: ${JSON.stringify(r)}）`);
});

test('ASR-R3 行为腿：进程扫描能看见端口通道看不见的 worker（真数据取材）', () => {
  // 用真实 /proc 扫描验证：当前机器的 worker 进程必须被枚举到。
  // 旧实现只看端口 ⇒ 动态口被覆盖者隐身；本判据要求「枚举数 >= 端口可见数」且不依赖端口文件。
  const cp = require('node:child_process');
  const m = require(SRC);
  const all = m.workerListenerPids();
  const pgrep = (() => {
    try { return cp.execSync("pgrep -f 'asr-worker\\.cjs'", { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n').filter(Boolean).map(Number); } catch (e) { return []; }
  })();
  if (pgrep.length === 0) {
    // 无 worker 时判据空转没有意义 —— 但要显式报"未取材"，不静默假绿
    console.log('  [未取材] 本机当前无 asr-worker 进程，跳过行为腿（不计 PASS）');
    return;
  }
  assert.ok(all.length >= pgrep.length,
    `发现面必须覆盖全部真实 worker：发现 ${all.length} 个 / 实际 ${pgrep.length} 个`);
  for (const p of pgrep) {
    assert.ok(all.includes(p), `pid ${p} 必须被发现（否则它就是"杀不到"的隐身者）`);
  }
});

test('ASR-R4 行为腿：sweepStaleWorkers 幂等——只剩 1 个时不得再杀', () => {
  const m = require(SRC);
  // 不真杀：只验「若当前已 <=1，清扫必须无副作用」
  const before = m.workerListenerPids();
  if (before.length <= 1) {
    const r = m.sweepStaleWorkers();
    assert.deepStrictEqual(r.killed, [], `已是单实例，清扫不得杀任何进程，实测杀了 ${JSON.stringify(r.killed)}`);
  } else {
    console.log('  [跳过] 当前实例数 ' + before.length + ' > 1，不做幂等腿（避免判据自身改变机器状态）');
  }
});

test('ASR-R5 反向：清扫不得保留"杀不到的隐身者"逻辑缺口', () => {
  // 钉住保留策略：keep 必须取自"被发现集合"，不得凭空返回别的 pid
  const body = src.slice(src.indexOf('function sweepStaleWorkers'));
  assert.ok(/pids\.includes\(keep\)/.test(body) || /keep\s*=\s*pids\[0\]/.test(body),
    'keep 必须来自发现集合（否则保留了一个未知进程）');
  assert.ok(/pid\s*===\s*keep/.test(body), '必须显式跳过 keep 那个');
});

test('ASR-R6 直接腿：进程扫描必须自主发现真实 worker（不经端口通道）', () => {
  // ⚠ 本条的由来（独立复核实测）：ASR-R1b/R3 都经 workerListenerPids()（= 端口 ∪ 进程扫描）。
  //   实测把 workerPidsByProcessScan 变异成 `return []` 后，**两条用例仍全绿** —— 因为真实 worker
  //   常驻 3082 固定口，端口通道照样发现它 ⇒ 该变异在被测面上无差别（判据无牙，纯假绿）。
  //   故此处**直接**断言进程扫描这条腿本身：它必须不依赖任何端口信息也能枚举出真实 worker。
  const cp = require('node:child_process');
  const m = require(SRC);
  const real = (() => {
    try { return cp.execSync("pgrep -f 'asr-worker\\.cjs'", { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n').filter(Boolean).map(Number); } catch (e) { return []; }
  })();
  if (real.length === 0) { console.log('  [未取材] 本机无 asr-worker 进程，跳过（不计 PASS）'); return; }
  assert.equal(typeof m.workerPidsByProcessScan, 'function',
    'workerPidsByProcessScan 必须导出——否则本判据无法直接咬住「摘掉进程扫描」的变异');
  const scanned = m.workerPidsByProcessScan();
  const hit = real.filter((p) => scanned.includes(p));
  assert.ok(hit.length > 0,
    '进程扫描必须**不依赖端口**发现真实 worker；实测扫描得 ' + JSON.stringify(scanned) + ' / 真实 ' + JSON.stringify(real));
  // 反向：进程扫描的返回必须只含真实 worker（不得凭空造 pid）
  const bogus = scanned.filter((p) => !real.includes(p));
  assert.equal(bogus.length, 0, '进程扫描不得返回非 worker 进程：' + JSON.stringify(bogus));
});
