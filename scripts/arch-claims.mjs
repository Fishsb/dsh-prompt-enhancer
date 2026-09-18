#!/usr/bin/env node
// scripts/arch-claims.mjs — 结构判据机检：**ADR 承诺 ↔ 代码现状**（P4 · 2026-09-19）
//
// 为什么要有它：本项目的贯穿性根因是「**无结构判据**」——架构决策写进 ADR 之后，
// 承诺有没有兑现、什么时候被后续决策取代，全靠人记。人记的东西会漂：ADR-197 的终局
// 曾被当成"待办"追，而 ADR-230 已把它的轨迹改过一轮却没人知道。本脚本把**每条 PE
// 架构决策**（= 分不分母，见下）的承诺翻成一条可执行断言，命令/期望/实测/判定一并输出。
//
// 分母出处（**不得自拟条数**）：`nav_graph mode=adrs` 全量 37 条中、锚点匹配
//   /pe-f\d|prompt-enhancer/ 的 **7 条** —— ADR-146(feature:pe-f06) ·
//   ADR-194/197/201/234(module:prompt-enhancer) · ADR-224/230(feature:pe-f01)。
//   采集命令与录制时间见 docs/internal/P4-状态归属-2026-09-19.md §一。
//   治理事件日志可读时脚本**自行交叉核对**这个多重集（S-2），不可读则记 SKIP（不记 PASS）。
//   ⚠ 新增一条 PE 决策（nav_decide）后**必须同步加一行判据**，否则 S-2 立即红——判据面随决策面走。
//
// 判据三档（**不可混算**——混算就是又一次代理指标当判据）：
//   REQUIRED 仓库内可机检、必须成立 —— 失败即**冲突**，exit 1
//   LOCAL    本地治理档 / 治理日志（gitignore，CI 与干净 clone 无此文件）—— 缺文件记 **SKIP**，不记 PASS
//   TARGET   终局目标、尚未达成 —— 必须写明**在册依据**（后续 ADR / 决策档），无依据即冲突
//
// 用法：node scripts/arch-claims.mjs [--check] [--json] [--md] [--write]
//   --check  REQUIRED 失败或文档投影漂移 → exit 1
//   --md     输出 Markdown 判据表（**投影，勿手抄**）
//   --write  把判据表写入治理档标记区（本地档；文件不存在则跳过）

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);

const DOC = 'docs/internal/P4-状态归属-2026-09-19.md';
const MARK_BEGIN = '<!-- ARCH-CLAIMS:BEGIN -->';
const MARK_END = '<!-- ARCH-CLAIMS:END -->';
const GOV_EVENTS = process.env.PE_NAV_EVENTS
  || path.join(process.env.PE_GOV_ROOT || 'D:\\FF', '.internal', 'events.jsonl');

const abs = (p) => path.join(ROOT, p);
const exists = (p) => fs.existsSync(abs(p));
const read = (p) => fs.readFileSync(abs(p), 'utf8');
const lines = (p) => read(p).split('\n').length;   // 口径：物理行 = split('\n').length
const occurrences = (s, re) => (s.match(re) || []).length;
const list = (p) => fs.readdirSync(abs(p));

/** 线上 RPC 注册面派生（与 rpc-manifest.mjs 同一规则：扫插件双半部的 harness.handle） */
function liveMethods() {
  const grab = (f) => [...read(f).matchAll(/harness\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
  return { native: grab('lib/index.cjs'), bundled: grab('plugin-host.js') };
}

/** PE-F01 域边界表（ADR-230 的声明面；行范围 [起, 止]，均含端点，物理行口径） */
const PE_F01_DOMAINS = [
  ['D0', 1, 65], ['D1', 66, 386], ['D2', 387, 523], ['D3', 524, 580], ['D4', 581, 668],
  ['D5', 669, 702], ['D6', 703, 752], ['D7', 753, 782], ['D8', 783, 839],
];

/** 一条断言：kind ∈ 行为|结构|门禁|见证|索引|目标；fn 返回 {pass, actual} */
const A = (id, kind, detail, expect, fn) => ({ id, kind, detail, expect, fn });
const ok = (actual) => ({ pass: true, actual });
const no = (actual) => ({ pass: false, actual });
const assert = (cond, actual) => (cond ? ok(actual) : no(actual));

/** 门禁类断言：子进程跑既有门禁，退出码为判据（**不重复实现**对方规则） */
const gate = (id, scriptArgs, detail) => A(
  id, '门禁', detail, `exit 0（node ${scriptArgs.join(' ')}）`,
  () => {
    try {
      execFileSync(process.execPath, scriptArgs, { cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
      return ok('exit 0');
    } catch (e) {
      return no(`exit ${e.status === undefined ? 'ERR:' + String(e.message).slice(0, 60) : e.status}`);
    }
  },
);

/** 见证类断言：断言"更细的行为证据还在"——防止判据引用悬空（证据被删而声称仍验过） */
const witness = (id, file, cases, detail) => A(
  id, '见证', detail, `${file} 含 ${cases.join('/')}`,
  () => {
    if (!exists(file)) return no(`${file} 不存在（证据悬空）`);
    const src = read(file);
    const miss = cases.filter((c) => !src.includes(c));
    return miss.length ? no(`缺 ${miss.join(',')}`) : ok(`${cases.length}/${cases.length} 在册`);
  },
);

process.env.DSH_ENHANCER_NO_INDEX = '1';          // 与仓库其它 lib 测试同口径：不写进程索引
const indexMod = require(abs('lib/index.cjs'));

// ───────────────────────────── 判据表（1 ADR = 1 行） ─────────────────────────────

const CLAIMS = [
  {
    adr: 'ADR-146', anchor: 'feature:pe-f06', at: '2026-09-12', level: '已兑现',
    promise: 'RPC 入口显式来源边界（同源校验 / 跨站拒 / 无来源头放行 / 1MiB 上限）+ .cmd 值统一 cmdSafeValue 安全化',
    assertions: [
      A('A146-1', '行为', '来源栅栏四态（跨站 / 跨源 / Origin:null 拒；同源 / 无头放行）', '6/6 态正确', () => {
        const R = (h) => ({ headers: h || {} });
        const H = { host: '127.0.0.1:3080' };
        const cases = [
          [indexMod.isTrustedRpcRequest(R(H)), true, '无来源头'],
          [indexMod.isTrustedRpcRequest(R({ ...H, origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' })), true, '同源'],
          [indexMod.isTrustedRpcRequest(R({ ...H, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })), false, '跨站'],
          [indexMod.isTrustedRpcRequest(R({ ...H, origin: 'https://evil.example' })), false, '跨源'],
          [indexMod.isTrustedRpcRequest(R({ ...H, 'sec-fetch-site': 'cross-site' })), false, '仅跨站标记'],
          [indexMod.isTrustedRpcRequest(R({ origin: 'null' })), false, 'Origin:null'],
        ];
        const bad = cases.filter(([got, want]) => got !== want);
        return assert(!bad.length, bad.length ? `错 ${bad.map((c) => c[2]).join(',')}` : '6/6 态正确');
      }),
      A('A146-2', '行为', '1MiB 请求体上限', '超限 → __tooLarge；正常体照常解析', async () => {
        const { EventEmitter } = require('node:events');
        const lim = read('lib/index.cjs').match(/RPC_BODY_LIMIT\s*=\s*(\d+)\s*\*\s*(\d+)/);
        const size = lim ? Number(lim[1]) * Number(lim[2]) : 0;
        const req = new EventEmitter();
        req.destroy = () => {};
        const p = indexMod.readBody(req);
        req.emit('data', Buffer.alloc(1024 * 1024 + 1));
        const over = await p;
        const req2 = new EventEmitter();
        const p2 = indexMod.readBody(req2);
        req2.emit('data', Buffer.from('{"method":"config/get"}'));
        req2.emit('end');
        const normal = await p2;
        return assert(size === 1024 * 1024 && over.__tooLarge === true && normal.method === 'config/get',
          `上限 ${size} B｜超限 ${over.__tooLarge === true ? '__tooLarge' : '未短路'}｜正常体 ${normal.method === 'config/get' ? '解析成功' : '解析失败'}`);
      }),
      A('A146-3', '行为', 'cmdSafeValue：剥双引号 / 折 CRLF / 按需转义 %', '4/4 正确', () => {
        const c = indexMod.cmdSafeValue;
        const cases = [
          [c('a" & calc & "b'), 'a & calc & b', '剥双引号'],
          [c('a\r\nb'), 'a b', '折 CRLF'],
          [c('100%path%'), '100%path%', '默认不转义'],
          [c('100%path%', true), '100%%path%%', 'set 行转义'],
        ];
        const bad = cases.filter(([got, want]) => got !== want);
        return assert(!bad.length, bad.length ? `错 ${bad.map((x) => x[2]).join(',')}` : '4/4 正确');
      }),
      witness('A146-4', 'test/rpc-guard.test.cjs', ['RPCG-01', 'RPCG-02', 'RPCG-03', 'RPCG-04', 'RPCG-05'], '端到端冒烟证据仍在册（403/413/405/栅栏放行）'),
    ],
  },
  {
    adr: 'ADR-194', anchor: 'module:prompt-enhancer', at: '2026-09-12', level: '部分兑现',
    promise: '判定「需要架构重构，分期执行、不推倒重写」：①P0 死层退役 + 协议事实源由注册面派生；②P1 host 半部改原生模块；③P2 规范收敛；④P3 待验证',
    assertions: [
      A('A194-1', '结构', '①P0 死层退役（src/host 收敛）', '7 件 / 33 物理行', () => {
        const files = list('src/host');
        const n = files.reduce((a, f) => a + lines(`src/host/${f}`), 0);
        return assert(files.length === 7 && n === 33, `${files.length} 件 / ${n} 行`);
      }),
      A('A194-2', '结构', '①协议事实源改由注册面派生（废除 protocol.js）', 'src/protocol.js 不存在且 scripts/rpc-manifest.mjs 存在', () => {
        const gone = !exists('src/protocol.js');
        const born = exists('scripts/rpc-manifest.mjs');
        return assert(gone && born, `protocol.js ${gone ? '已废除' : '仍在'} / rpc-manifest.mjs ${born ? '在位' : '缺失'}`);
      }),
      A('A194-3', '结构', '①dead-code-gate 增可达性/一致性规则', '含 R1–R4 四规则', () => {
        const src = read('scripts/dead-code-gate.mjs');
        const rules = ['R1', 'R2', 'R3', 'R4'].filter((r) => src.includes(`'${r}'`) || src.includes(`[${r}]`) || new RegExp(`\\b${r}\\b`).test(src));
        return assert(rules.length === 4, `命中 ${rules.join('/')}`);
      }),
      A('A194-4', '索引', '④索引侧新建 PE-F07「宿主基础层与插件管理面」', `治理日志可读时含 PE-F07 节点（${GOV_EVENTS}）`, () => {
        if (!fs.existsSync(GOV_EVENTS)) return { skip: true, actual: '治理日志不可读（CI/干净 clone 预期）' };
        const hit = fs.readFileSync(GOV_EVENTS, 'utf8').split('\n').filter((l) => l.includes('PE-F07')).length;
        return assert(hit > 0, `日志内 PE-F07 出现 ${hit} 次`);
      }),
      A('A194-5', '目标', '②P1 host 半部改原生 Node 模块（真 require）', 'plugin-host.js 内 require( 计数 > 0', () => {
        const n = occurrences(read('plugin-host.js'), /require\(/g);
        return assert(n > 0, `require( = ${n}（bundle 载体无模块系统）`);
      }),
    ],
    pending: [{ id: 'A194-5', reason: '载体折叠未换：终局轨迹已由 ADR-197 §① 改判、并由 ADR-230 §四-3 坐实「无 require ⇒ 系统面逻辑必然留在 lib/」' }],
  },
  {
    adr: 'ADR-197', anchor: 'module:prompt-enhancer', at: '2026-09-12', level: '在册未达',
    promise: '终局目标架构：lib/index.js ≤120 行只做装配 + 领域逻辑分层 + 自建基础设施换官方缝 + 弃 chunk/marker/new Function 装配',
    assertions: [
      A('A197-1', '目标', '装配薄化：lib/index.cjs ≤ 120 行', '≤120 行', () => {
        const n = lines('lib/index.cjs');
        return assert(n <= 120, `${n} 行`);
      }),
      A('A197-2', '结构', '弃孤儿产物 plugin-client.js', '磁盘无、files 白名单无、构建不产出', () => {
        const disk = !exists('plugin-client.js');
        const whitelist = !JSON.stringify(require(abs('package.json')).files).includes('plugin-client.js');
        const builder = !read('scripts/build-client.mjs').includes("'plugin-client.js'");
        return assert(disk && whitelist && builder, `磁盘${disk ? '无' : '有'} / 白名单${whitelist ? '无' : '有'} / 构建${builder ? '不产出' : '仍产出'}`);
      }),
      A('A197-3', '目标', '弃 chunk/marker/new Function 装配', 'new Function 装配点 = 0', () => {
        const n = occurrences(read('lib/index.cjs'), /new Function\(/g);
        return assert(n === 0, `new Function = ${n} 处`);
      }),
      A('A197-4', '结构', '半部通信保留 HTTP（/rpc 兼容别名）', "RPC_PATH = '/dsh-prompt-enhancer/rpc'", () => {
        const m = read('lib/index.cjs').match(/RPC_PATH\s*=\s*'([^']+)'/);
        return assert(!!m && m[1] === '/dsh-prompt-enhancer/rpc', m ? m[1] : '未找到 RPC_PATH');
      }),
    ],
    pending: [
      { id: 'A197-1', reason: 'ADR-230 修订该轨迹：改为按 9 域分批（首批 D8），且换装载形态是拆分收益的前置项' },
      { id: 'A197-3', reason: '同上：载体折叠未换，chunk/new Function 装配仍在（ADR-230 §四-3）' },
    ],
  },
  {
    adr: 'ADR-201', anchor: 'module:prompt-enhancer', at: '2026-09-12', level: '已兑现',
    promise: '收缩为「提示词增强 + 语音识别」双核心并移除插件内重启：删 update/portRestart、update/makeShortcut，新增 update/install（BREAKING）',
    assertions: [
      A('A201-1', '结构', '线上注册面条数（与 test/rpc-contract.test.cjs 的数字锁交叉核）', '34 条', () => {
        const { native, bundled } = liveMethods();
        const all = new Set([...native, ...bundled]);
        return assert(all.size === 34, `${all.size} 条（原生 ${native.length} + bundle ${bundled.length}）`);
      }),
      A('A201-2', '结构', '删两个 RPC / 新增 update/install', 'portRestart、makeShortcut 缺席；install 在位', () => {
        const { native, bundled } = liveMethods();
        const all = new Set([...native, ...bundled]);
        const gone = !all.has('update/portRestart') && !all.has('update/makeShortcut');
        const born = all.has('update/install');
        return assert(gone && born, `portRestart/makeShortcut ${gone ? '已删' : '仍在'} / update/install ${born ? '在位' : '缺失'}`);
      }),
      A('A201-3', '结构', 'updater-host.cjs 瘦身上限', '≤ 855 行', () => {
        const n = lines('lib/updater-host.cjs');
        return assert(n <= 855, `${n} 行`);
      }),
      A('A201-4', '结构', '客户端重启 UI 已删', 'src/client 下无 portRestart / makeShortcut 引用', () => {
        const walk = (d) => fs.readdirSync(abs(d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
        const hits = walk('src/client').filter((f) => /portRestart|makeShortcut/.test(read(f)));
        return assert(!hits.length, hits.length ? `命中 ${hits.join(',')}` : '零引用');
      }),
      witness('A201-5', 'test/rpc-contract.test.cjs', ['34', 'update/portRestart'], '数字契约锁与「已删方法永不返回」证据在册'),
    ],
  },
  {
    adr: 'ADR-224', anchor: 'feature:pe-f01', at: '2026-09-18', level: '已兑现',
    promise: 'P1a+P1b 收敛：client 载体单一化（lib/client.cjs）+ M2 目标架构层整体退役 + 两条结构门禁 R3/R4 固化',
    assertions: [
      A('A224-1', '结构', 'client 唯一载体', 'exports["./client"] → lib/client.cjs 且文件在位', () => {
        const exp = require(abs('package.json')).exports['./client'];
        return assert(exp === './lib/client.cjs' && exists('lib/client.cjs'), `${exp} / 文件${exists('lib/client.cjs') ? '在位' : '缺失'}`);
      }),
      gate('A224-2', ['scripts/dead-code-gate.mjs'], '结构门禁整体通过（含 R3 产物清单 ↔ files 白名单、R4 src/host 等值集）'),
      A('A224-3', '结构', 'R3/R4 两条规则仍在位（防规则被静默删除而门禁仍 exit 0）', 'R3 + R4 均命中', () => {
        const src = read('scripts/dead-code-gate.mjs');
        const hit = ['R3', 'R4'].filter((r) => src.includes(r));
        return assert(hit.length === 2, `命中 ${hit.join('/')}`);
      }),
    ],
  },
  {
    adr: 'ADR-230', anchor: 'feature:pe-f01', at: '2026-09-18', level: '已兑现',
    promise: 'P3 装配契约：lib/index.cjs 按 9 域划界且 100% 覆盖；拆分按域分批；plugin-host.js 无 require 是结构约束（判据未声明入边 = 0 降级，不虚报）',
    assertions: [
      A('A230-1', '结构', '域边界表覆盖 100%（域表行数和 == 文件物理行数，且域连续无缝）', `域和 == ${lines('lib/index.cjs')} 且首域 1 起 / 末域止于末行`, () => {
        const n = lines('lib/index.cjs');
        const sum = PE_F01_DOMAINS.reduce((a, [, s, e]) => a + (e - s + 1), 0);
        let contig = PE_F01_DOMAINS[0][1] === 1;
        for (let i = 1; i < PE_F01_DOMAINS.length; i += 1) contig = contig && PE_F01_DOMAINS[i][1] === PE_F01_DOMAINS[i - 1][2] + 1;
        const tail = PE_F01_DOMAINS[PE_F01_DOMAINS.length - 1][2];
        return assert(sum === n && contig && tail === n, `域和 ${sum} vs 实测 ${n}｜连续 ${contig}｜末域止 ${tail}`);
      }),
      A('A230-2', '结构', '载体约束事实：plugin-host.js 内无模块系统', 'require( 计数 == 0', () => {
        const n = occurrences(read('plugin-host.js'), /require\(/g);
        return assert(n === 0, `${n}`);
      }),
      A('A230-3', '索引', 'P3 决策档在位且三项拍板已回写', '档存在且含三项拍板行', () => {
        // ⚠ CI 首跑实证（run 35397066749）：`docs/internal` 整目录在干净 clone 里不存在，
        //   先 list() 再判空会 ENOENT 抛错 → 记为冲突（假冲突）。必须先判目录存在。
        if (!exists('docs/internal')) return { skip: true, actual: 'docs/internal 整目录缺位（本地治理档，CI/干净 clone 预期无）' };
        const f = list('docs/internal').find((x) => x.startsWith('P3-装配契约'));
        if (!f) return { skip: true, actual: 'P3 决策档缺位（本地治理档）' };
        const src = read(`docs/internal/${f}`);
        const hit = ['拍板结果', 'D8 诊断面', '不立项'].filter((k) => src.includes(k));
        return assert(hit.length === 3, `${f} 命中 ${hit.length}/3`);
      }),
      gate('A230-4', ['scripts/rpc-manifest.mjs', '--check'], 'RPC 契约面不受本轮影响（派生事实源一致）'),
    ],
  },
  {
    adr: 'ADR-234', anchor: 'module:prompt-enhancer', at: '2026-09-18', level: '已兑现',
    promise: 'P4：结构判据机检化（分母由模型派生、判据表为投影、四档语义含 SKIP/在册未达/在册缺陷）+ 四条结构门禁收敛为 `npm run gate` 并首次进 CI + RC-F 收敛基线（10 个状态面 / 在册缺陷 D-1）',
    assertions: [
      A('B234-1', '结构', '四条结构门禁收敛为一条命令（顺序即依赖序）', 'gate 串行链 = dead-code → rpc-manifest → sync-prompts → arch-claims，后两者带 --check', () => {
        const g = require(abs('package.json')).scripts.gate;
        const order = ['dead-code-gate.mjs', 'rpc-manifest.mjs', 'sync-prompts.mjs', 'arch-claims.mjs'];
        const idx = order.map((s) => g.indexOf(s));
        const asc = idx.every((v, i) => v > -1 && (i === 0 || v > idx[i - 1]));
        const flags = /rpc-manifest\.mjs --check/.test(g) && /sync-prompts\.mjs --check/.test(g) && /arch-claims\.mjs --check/.test(g);
        return assert(asc && flags, `四门禁在位 ${idx.filter((v) => v > -1).length}/4｜顺序 ${asc}｜--check ${flags}`);
      }),
      A('B234-2', '结构', '门禁进 CI 且判据之间不得互相遮蔽（失败仍出读数）', 'Structure gates 跑 npm run gate 且与 Run tests 两步均 if: always()', () => {
        const ci = read('.github/workflows/ci.yml');
        const step = /- name: Structure gates[\s\S]{0,400}?run: npm run gate/.test(ci);
        const gateAlways = /- name: Structure gates[\s\S]{0,300}?if: always\(\)/.test(ci);
        const testsAlways = /- name: Run tests[\s\S]{0,160}?if: always\(\)/.test(ci);
        return assert(step && gateAlways && testsAlways, `步骤 ${step}｜gate always ${gateAlways}｜tests always ${testsAlways}`);
      }),
      A('B234-3', '结构', '判据表是投影（三种模式 + 治理档标记区），治理档缺位不判漂移', '脚本含 --check/--md/--write 与标记对', () => {
        const src = read('scripts/arch-claims.mjs');
        const modes = ['--check', '--md', '--write'].filter((m) => src.includes(`'${m}'`));
        const marks = src.includes('ARCH-CLAIMS:BEGIN') && src.includes('ARCH-CLAIMS:END');
        const skipGuard = /if \(!exists\(DOC\)\) return null/.test(src);
        return assert(modes.length === 3 && marks && skipGuard, `模式 ${modes.length}/3｜标记 ${marks}｜缺档守卫 ${skipGuard}`);
      }),
      A('B234-4', '索引', 'D-1 的处置形态是**判据**而非一次性修复（S-5 在位 + 两副本无已退役件）', '本脚本含 S-5 且两处清单源文件不含 plugin-client.js', () => {
        const src = read('scripts/arch-claims.mjs');
        const clean = ['src/host/pure.js', 'src/client/updater.js'].every((f) => !read(f).includes('plugin-client.js'));
        return assert(src.includes("'S-5'") && clean, `S-5 规则在位 ${src.includes("'S-5'")}｜两副本洁净 ${clean}`);
      }),
    ],
  },
];

// ───────────────────────── 结构性判据（分母与在册性，不属任何单条 ADR） ─────────────────────────

const PE_ADR_SET = CLAIMS.map((c) => c.adr).sort();

/** 在册缺陷台账：机检发现的**非 ADR 面**问题——必须写明处置指向，否则 S-4 记冲突（防"发现了但没人管"）。
 *  当前为空：唯一一条 D-1（`UPDATE_MANIFEST` 含已退役 `plugin-client.js`，使 `update/pull` 在本仓不可能成功）
 *  已于 2026-09-19 按用户拍板方案 A 修复（两处副本 + 注释条数 + U30 断言 + 重建产物），并把「这一类」固化为判据 **S-5**
 *  ——一次性修复会复长，判据才会拦住下一次。 */
const DEFECTS = [];

const STRUCTURAL = [
  A('S-1', '结构', '分母完整性：判据表覆盖的 ADR 集合 == 声明的 PE 决策集（出处 nav_graph mode=adrs）', '7 条且逐条对应', () => {
    // 声明面（出处：`nav_graph mode=adrs`，锚点匹配 /pe-f\d|prompt-enhancer/，采集 2026-09-19）。
    // 新增 PE 决策必须同步加行，否则 S-1（本处）与 S-2（治理日志交叉核对）都会红。
    const declared = ['ADR-146', 'ADR-194', 'ADR-197', 'ADR-201', 'ADR-224', 'ADR-230', 'ADR-234'].sort();
    const same = declared.length === PE_ADR_SET.length && declared.every((x, i) => x === PE_ADR_SET[i]);
    return assert(same, `${PE_ADR_SET.length} 条：${PE_ADR_SET.join(',')}`);
  }),
  A('S-2', '索引', '分母交叉核对：治理日志内 PE 锚点的多重集 == 判据表锚点多重集', `日志可读时 ${CLAIMS.length} 条锚点逐一对应`, () => {
    if (!fs.existsSync(GOV_EVENTS)) return { skip: true, actual: '治理日志不可读（CI/干净 clone 预期）' };
    const anchors = fs.readFileSync(GOV_EVENTS, 'utf8').split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.kind === 'decide' && /pe-f\d|prompt-enhancer/.test(String(e.anchor || '')))
      .map((e) => e.anchor);
    const want = CLAIMS.map((c) => c.anchor).sort();
    const got = anchors.sort();
    return assert(got.length === want.length && got.every((x, i) => x === want[i]), `日志 ${got.length} 条 vs 表 ${want.length} 条`);
  }),
  A('S-3', '结构', '在册性：每条 TARGET（未达）断言必须写明依据', '每条 TARGET 均有 pending 依据', () => {
    const targets = CLAIMS.flatMap((c) => c.assertions.filter((a) => a.kind === '目标').map((a) => ({ adr: c.adr, id: a.id, why: (c.pending || []).find((p) => p.id === a.id) })));
    const bare = targets.filter((t) => !t.why || !t.why.reason);
    return assert(!bare.length, bare.length ? `无依据：${bare.map((t) => t.id).join(',')}` : `${targets.length} 条 TARGET 全部在册`);
  }),
  A('S-4', '结构', '在册缺陷台账：每条缺陷必须写明处置指向与证据（防"发现了但没人管"）', '每条缺陷含 disposition + evidence', () => {
    const bare = DEFECTS.filter((d) => !d.disposition || !(d.evidence || []).length || !d.owner);
    return assert(!bare.length, bare.length ? `条目不全：${bare.map((d) => d.id).join(',')}` : `${DEFECTS.length} 条在册缺陷均有处置指向`);
  }),

  // ── 状态归属判据（RC-F：同一状态多处持有 ⇒ 让副本可机检） ──────────────────────────

  A('S-5', '结构', '发布物清单一致：两处 `UPDATE_MANIFEST` 副本相等、逐项 ⊆ `package.json` files 白名单、注释条数 == 数组长度', '两副本相等 + 无白名单外条目 + 注释与实际同数', () => {
    const wl = require(abs('package.json')).files;
    const legal = (n) => wl.includes(n) || wl.some((w) => n.startsWith(w + '/'));
    const grabArr = (f, name) => {
      const m = read(f).match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
      return m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : null;
    };
    const host = grabArr('src/host/pure.js', 'UPDATE_MANIFEST');
    const client = grabArr('src/client/updater.js', 'UPDATER_MANIFEST');
    if (!host || !client) return no(`清单未解析到（host ${!!host} / client ${!!client}）`);
    const cm = read('src/host/pure.js').match(/全部 (\d+) 个文件/);
    const outside = host.filter((n) => !legal(n));
    const same = host.join() === client.join();
    const cnt = cm ? Number(cm[1]) === host.length : false;
    return assert(same && !outside.length && cnt,
      `host ${host.length} 项 / client ${client.length} 项｜副本相等 ${same}｜白名单外 ${outside.length ? outside.join(',') : '无'}｜注释称 ${cm ? cm[1] : '?'} 实为 ${host.length}`);
  }),
  A('S-6', '结构', '重启探测名单自洽：`RESTART_FILES` 逐项磁盘在位 + ⊆ 发布物白名单 + 含两个装配链入口', '逐项在位且合法，且含 plugin-host.js 与 lib/index.cjs', () => {
    const m = read('lib/index.cjs').match(/const RESTART_FILES = \[([^\]]*)\]/);
    if (!m) return no('未解析到 RESTART_FILES');
    const arr = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    const wl = require(abs('package.json')).files;
    const legal = (n) => wl.includes(n) || wl.some((w) => n.startsWith(w + '/'));
    const missing = arr.filter((f) => !exists(f));
    const outside = arr.filter((f) => !legal(f));
    const entries = arr.includes('plugin-host.js') && arr.includes('lib/index.cjs');
    return assert(!missing.length && !outside.length && entries,
      `${arr.length} 项｜缺文件 ${missing.length ? missing.join(',') : '无'}｜白名单外 ${outside.length ? outside.join(',') : '无'}｜入口齐 ${entries}`);
  }),
  A('S-7', '结构', 'i18n 全局平衡：`ZH` 与 `EN` 顶层键集相等且非空', '两语言键集完全相同（0 差异）', () => {
    const raw = read('src/client/i18n.js');
    const lit = raw.match(/^module\.exports\s*=\s*"([\s\S]*)"\s*;?\s*$/m);
    if (!lit) return no('未解析到 i18n 字符串字面量');
    const src = lit[1].replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const iZ = src.indexOf('const ZH');
    const iE = src.indexOf('const EN');
    if (iZ < 0 || iE <= iZ) return no('未定位到 ZH/EN 两个表');
    const keys = (block) => { const o = []; const re = /^\s{2}([A-Za-z0-9_]+)\s*:/gm; let x; while ((x = re.exec(block)) !== null) o.push(x[1]); return o; };
    const KZ = keys(src.slice(iZ, iE));
    const KE = keys(src.slice(iE));
    const onlyZ = KZ.filter((k) => !KE.includes(k));
    const onlyE = KE.filter((k) => !KZ.includes(k));
    return assert(KZ.length > 0 && !onlyZ.length && !onlyE.length,
      `ZH ${KZ.length} 键 / EN ${KE.length} 键｜仅 ZH ${onlyZ.length ? onlyZ.join(',') : '无'}｜仅 EN ${onlyE.length ? onlyE.join(',') : '无'}`);
  }),
];

// ───────────────────────────────── 执行 ─────────────────────────────────

const RUN = [];
async function run(list_, tier) {
  for (const a of list_) {
    let r;
    try { r = await a.fn(); } catch (e) { r = { pass: false, actual: `抛错 ${String(e.message).slice(0, 70)}` }; }
    RUN.push({ tier, ...a, ...r });
  }
}
for (const c of CLAIMS) await run(c.assertions.map((a) => ({ ...(a.kind === '目标' ? { target: true } : {}), claim: c.adr, ...a })), 'CLAIM');
await run(STRUCTURAL, 'STRUCT');

const conflicts = RUN.filter((r) => !r.skip && r.pass === false && !r.target);
const skips = RUN.filter((r) => r.skip);
const pendingTargets = RUN.filter((r) => r.target && r.pass === false);
const passed = RUN.filter((r) => !r.skip && r.pass === true);

const ICON = (r) => (r.skip ? '⤫' : r.pass ? '✓' : r.target ? '⧗' : '✗');
const fmt = (r) => `  ${ICON(r)} ${r.id} ${r.kind}  ${r.detail}\n      期望 ${r.expect}\n      实测 ${r.actual}${r.skip ? '' : ''}`;

function textReport() {
  const out = [];
  out.push('结构判据机检 · ADR 承诺 ↔ 代码现状（P4 · 口径：物理行 = split(\'\\n\').length）');
  out.push(`分母：PE 架构决策 ${CLAIMS.length} 条（ADR-146 · 194 · 197 · 201 · 224 · 230）`);
  out.push('');
  for (const c of CLAIMS) {
    const rows = RUN.filter((r) => r.claim === c.adr);
    out.push(`${c.adr} @${c.anchor} · ${c.at} · [${c.level}] ${c.promise}`);
    for (const r of rows) out.push(fmt(r));
    const p = (c.pending || []).filter((x) => rows.some((r) => r.id === x.id && !r.pass));
    for (const x of p) out.push(`      ↳ 在册依据 ${x.id}：${x.reason}`);
    out.push('');
  }
  out.push('结构性判据（分母 / 在册性）');
  for (const r of RUN.filter((x) => x.tier === 'STRUCT')) out.push(fmt(r));
  out.push('');
  out.push(`⚠ 在册缺陷 ${DEFECTS.length} 条（非 ADR 面，机检发现；有处置指向但**尚未处置**）`);
  for (const d of DEFECTS) {
    out.push(`  ⚠ ${d.id} @${d.at} · ${d.surface}`);
    out.push(`      发现 ${d.finding}`);
    out.push(`      证据 ${d.evidence.join('｜')}`);
    out.push(`      处置 ${d.disposition}（owner=${d.owner}）`);
  }
  out.push('');
  out.push(`汇总：通过 ${passed.length} · 冲突 ${conflicts.length} · SKIP ${skips.length} · 在册未达 ${pendingTargets.length} · 在册缺陷 ${DEFECTS.length}`);
  if (skips.length) out.push(`  SKIP 明细：${skips.map((s) => s.id).join(', ')}（本地治理档/日志缺位——不记 PASS）`);
  return out.join('\n');
}

function mdReport() {
  const out = [];
  out.push('| ADR | 锚点 | 承诺 | 判据 | 档 | 期望 | 实测 | 判定 |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const r of RUN) {
    const c = CLAIMS.find((x) => x.adr === r.claim);
    out.push(`| ${r.claim || '—'} | \`${c ? c.anchor : '—'}\` | ${c ? c.promise.slice(0, 46) + (c.promise.length > 46 ? '…' : '') : '（结构性）'} | ${r.id} ${r.kind}：${r.detail} | ${r.skip ? 'SKIP' : r.pass ? (r.target ? '在册未达' : 'PASS') : r.target ? '在册未达' : '冲突'} | ${r.expect} | ${r.actual} | ${ICON(r)} |`);
  }
  out.push('');
  out.push(`> 生成：\`node scripts/arch-claims.mjs --md\`（**投影，勿手抄**）｜通过 ${passed.length} · 冲突 ${conflicts.length} · SKIP ${skips.length} · 在册未达 ${pendingTargets.length} · 在册缺陷 ${DEFECTS.length}`);
  out.push('');
  out.push('**在册缺陷（非 ADR 面；有处置指向但尚未处置）**');
  out.push('');
  out.push('| # | 状态面 | 发现 | 证据 | 处置 |');
  out.push('|---|---|---|---|---|');
  for (const d of DEFECTS) out.push(`| ${d.id} | ${d.surface} | ${d.finding} | ${d.evidence.join('<br>')} | ${d.disposition} |`);
  return out.join('\n');
}

if (has('--write')) {
  if (exists(DOC)) {
    const src = read(DOC);
    const i = src.indexOf(MARK_BEGIN);
    const j = src.indexOf(MARK_END);
    if (i >= 0 && j > i) {
      fs.writeFileSync(abs(DOC), src.slice(0, i + MARK_BEGIN.length) + '\n\n' + mdReport() + '\n\n' + src.slice(j), 'utf8');
      console.log(`✓ 判据表已写入 ${DOC} 标记区`);
    } else console.log(`✗ ${DOC} 缺标记 ${MARK_BEGIN} / ${MARK_END}，未写入`);
  } else console.log(`✗ ${DOC} 不存在（跳过写入）`);
} else if (has('--md')) {
  console.log(mdReport());
} else if (has('--json')) {
  console.log(JSON.stringify({
    peAdrSet: PE_ADR_SET,
    summary: { pass: passed.length, conflict: conflicts.length, skip: skips.length, pendingTarget: pendingTargets.length, defects: DEFECTS.length },
    defects: DEFECTS,
    rows: RUN.map(({ fn, ...r }) => r),
  }, null, 1));
} else {
  console.log(textReport());
}

if (has('--check')) {
  const drift = (() => {
    if (!exists(DOC)) return null;                       // 本地治理档缺位 → 不判漂移（SKIP）
    const src = read(DOC);
    const i = src.indexOf(MARK_BEGIN);
    const j = src.indexOf(MARK_END);
    if (i < 0 || j < 0) return '缺标记区';
    return src.slice(i + MARK_BEGIN.length, j).trim() === mdReport().trim() ? null : '判据表与投影不一致（跑 --write 重新生成）';
  })();
  if (drift === '缺标记区') console.log(`⚠ ${DOC} 缺标记区，文档漂移未判（本地档可重建）`);
  else if (drift) console.log(`✗ 文档漂移：${drift}`);
  if (conflicts.length) {
    console.log(`✗ 结构判据冲突 ${conflicts.length} 条：${conflicts.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }
  if (drift && drift !== '缺标记区') process.exit(1);
  console.log(`✓ 结构判据一致：断言 ${passed.length} 通过 · 冲突 0 · SKIP ${skips.length}（本地档/日志缺位）· 在册未达 ${pendingTargets.length} · 在册缺陷 ${DEFECTS.length}（${DEFECTS.map((d) => d.id).join(',')}——有处置指向、尚未处置）`);
}
