'use strict';
/**
 * ASR worker 监听者发现 —— Linux/WSL 通道回归判据（2026-09-27 事故）
 *
 * 事故：workerListenerPids() 原实现无条件 spawn `netstat -ano` 且只认 `LISTENING`。
 *   Linux 上 ①多数发行版不预装 net-tools（netstat 不存在）②netstat 输出 `LISTEN` 非 `LISTENING`。
 *   两者都使函数恒返回 [] ⇒ isWorkerUp() 恒 false ⇒ ensureWorker() 永不短路 ⇒ 每次 host 启动
 *   新增一个 ~420MB worker 且 restartWorker 杀旧循环杀 0 个 ⇒ 结构性泄漏。
 *   实测本机累积 30 个 worker = 9.6GB，压满 16G VM 的 swap（4096/4096）。
 *
 * 本判据的任务：在**不依赖真实端口/真实 netstat**的前提下，把两个解析通道钉死。
 * 用固定文本取材（真 ss/netstat 输出样例），故在任何平台/CI 上确定可跑。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const SRC = path.join(__dirname, '..', 'lib', 'asr-models.cjs');
const src = fs.readFileSync(SRC, 'utf8');

test('ASR-W1 源码必须按平台分派（不得无条件走 netstat -ano）', () => {
  // 结构腿：平台判定与两条 posix 通道都必须真在源码里
  assert.ok(/process\.platform\s*===\s*'win32'/.test(src), '缺少 win32 平台判定');
  assert.ok(/-ltnp/.test(src), 'posix 分支必须用 ss -ltnp（-p 才有 pid）');
  assert.ok(/-tlnp/.test(src), 'posix 需 netstat -tlnp 退路');
  assert.ok(/parseSsListenerPids/.test(src), '缺 ss 解析函数');
  assert.ok(/parseNettoolsListenerPids/.test(src), '缺 net-tools 解析函数');
});

test('ASR-W1b 行为腿：workerListenerPids 在 linux 上必须真调 ss（非只看源码串）', () => {
  // 为什么需要这条：仅做源码文本断言时，把整个 posix 分支换回 `netstat -ano` 仍能通过
  // （变异 M1 实测 pass 5/fail 0 = 假绿）。故这里注入 spawnSync 缝，**观测它到底调了谁**。
  const calls = [];
  const stubSpawn = (cmd, args) => {
    calls.push([cmd, Array.isArray(args) ? args.join(' ') : String(args)]);
    return { stdout: 'LISTEN 0 511 127.0.0.1:3082 0.0.0.0:* users:(("node",pid=721,fd=21))', status: 0 };
  };
  const up = withStub(stubSpawn, (mod) => mod.isWorkerUp());
  const cmds = calls.map(([c, a]) => c + ' ' + a);
  assert.ok(
    cmds.some((c) => c.startsWith('ss ') && c.includes('-ltnp')),
    `linux 分支必须调 \`ss -ltnp\`，实测调用序列: ${JSON.stringify(cmds)}`,
  );
  assert.ok(
    !cmds.some((c) => c.includes('netstat -ano')),
    `linux 分支不得调 \`netstat -ano\`（事故根因），实测: ${JSON.stringify(cmds)}`,
  );
  assert.strictEqual(up, true, '且必须判定为 worker 在跑（桩输出含 3082 监听）');
});

test('ASR-W1c 行为腿：ss 无果时必须退到 netstat -tlnp（退路可达）', () => {
  const calls = [];
  const stubSpawn = (cmd, args) => {
    calls.push([cmd, Array.isArray(args) ? args.join(' ') : String(args)]);
    if (cmd === 'ss') return { stdout: '', status: 0 };
    return { stdout: 'tcp 0 0 127.0.0.1:3082 0.0.0.0:* LISTEN 721/node', status: 0 };
  };
  const up = withStub(stubSpawn, (mod) => mod.isWorkerUp());
  const cmds = calls.map(([c, a]) => c + ' ' + a);
  assert.ok(cmds.some((c) => c.includes('netstat -tlnp')), `退路必须被真的走一遍，实测: ${JSON.stringify(cmds)}`);
  assert.strictEqual(up, true, '退路也要能判定 worker 在跑');
});

test('ASR-W2 posix 解析：真 ss -ltnp 行必须解析出 pid（端口在 pid 之前）', () => {
  // 抽样自本机真实输出
  const sample = [
    'LISTEN 0      511         127.0.0.1:3082       0.0.0.0:*    users:(("node",pid=721,fd=21))',
    'LISTEN 0      511         127.0.0.1:44891      0.0.0.0:*    users:(("node",pid=516825,fd=21))',
    'LISTEN 0      511             [::1]:3082          [::]:*    users:(("node",pid=999,fd=21))',
  ].join('\n');
  const get = extract('parseSsListenerPids');
  assert.deepStrictEqual(get(sample, new Set([3082])), [721, 999], '应解析出 3082 的两个监听者');
  assert.deepStrictEqual(get(sample, new Set([44891])), [516825], '动态口也要能解析（v4.8 双通道）');
});

test('ASR-W3 posix 解析反向：不该命中的必须不命中', () => {
  const get = extract('parseSsListenerPids');
  const sample = 'LISTEN 0 511 127.0.0.1:3082 0.0.0.0:* users:(("node",pid=721,fd=21))';
  assert.deepStrictEqual(get(sample, new Set([59999])), [], '未监听端口不得误报');
  // 30820/30821 不得被 :3082 命中（v4.8 已有的锚定要求，防串号误杀）
  const near = 'LISTEN 0 511 127.0.0.1:30820 0.0.0.0:* users:(("node",pid=888,fd=21))';
  assert.deepStrictEqual(get(near, new Set([3082])), [], '30820 不得被当作 3082');
  // 非 LISTEN 行（如 ESTAB）必须忽略
  const est = 'ESTAB 0 0 127.0.0.1:3082 127.0.0.1:12345 users:(("node",pid=777,fd=22))';
  assert.deepStrictEqual(get(est, new Set([3082])), [], '非 LISTEN 行不得计入');
});

test('ASR-W4 net-tools 退路解析：LISTEN + pid/N 形态', () => {
  const get = extract('parseNettoolsListenerPids');
  const sample = [
    'tcp        0      0 127.0.0.1:3082          0.0.0.0:*               LISTEN      721/node',
    'tcp        0      0 127.0.0.1:30820         0.0.0.0:*               LISTEN      888/node',
  ].join('\n');
  assert.deepStrictEqual(get(sample, new Set([3082])), [721], '应解析出 721');
  assert.deepStrictEqual(get(sample, new Set([])), [], '空端口集不得命中');
});

test('ASR-W5 关键：Linux 上 "LISTENING" 字样永不出现（事故根因的证据）', () => {
  // 本判据把"为什么原实现必然失效"钉成可复核的事实，防止有人改回 LISTENING 单判据。
  const get = extract('parseSsListenerPids');
  const linuxStyle = 'LISTEN 0 511 127.0.0.1:3082 0.0.0.0:* users:(("node",pid=721,fd=21))';
  assert.ok(!/LISTENING/.test(linuxStyle), 'Linux ss 输出不含 LISTENING');
  assert.deepStrictEqual(get(linuxStyle, new Set([3082])), [721], '必须认 LISTEN');
});

/** 从源码里取一个纯函数（剥注释后）求值 —— 无需执行整模块的副作用 */
function extract(name) {
  const body = src.slice(src.indexOf('function ' + name));
  const end = body.indexOf('\nfunction ', 1);
  const fn = end === -1 ? body : body.slice(0, end);
  // eslint-disable-next-line no-new-func
  return new Function(fn + '\nreturn ' + name + ';')();
}

/**
 * 加载整个模块，但把 node:child_process 的 spawnSync 换成桩 —— 用来观测"真实调了哪个命令"。
 * 为什么不用 extract()：extract 只验证解析函数，证明不了 workerListenerPids 真的调了它
 * （变异 M1/M4 实测能骗过纯文本断言）。
 *
 * ⚠ 关键：插件是**在函数体内惰性** `require('node:child_process')` 的（见源码），
 * 所以桩必须在**调用期间**保持挂载，而不是只在 require 模块时。故返回 {mod, done}，
 * 调用方跑完再 done() 卸载。
 */
function loadWithStub(stubSpawn) {
  const Module = require('node:module');
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'node:child_process' || request === 'child_process') {
      return { spawnSync: stubSpawn, spawn: () => ({ unref() {} }) };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve(SRC)];
  const mod = require(SRC);
  return { mod, done: () => { Module._load = origLoad; } };
}

/** 便捷包装：挂桩 → 调用 → 卸载（异常也保证卸载） */
function withStub(stubSpawn, fn) {
  const { mod, done } = loadWithStub(stubSpawn);
  try {
    return fn(mod);
  } finally {
    done();
  }
}
