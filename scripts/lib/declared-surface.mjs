// scripts/lib/declared-surface.mjs —— 「声明面三面相等」判据的单一事实源（治理面落地批 · 甲-1）
//
// 由来（正本 §12.13.2 甲-1）：`peerDependencies` ↔ `dsh.client.inject` 逐项相等是**红线**
//   （`AGENTS.md` §五），但**无任何机械判据**（实测 `grep -rn "peerDependencies" scripts/ test/`
//   零命中，范围 = 工作区 `scripts/` + `test/`）。后果不是小错：宿主 compatibility 门
//   （`dsh-app-boot/lib/index.js` `evaluatePluginCompatibility`）**只审 `peerDependencies` 里
//   `@deepseek-ai/dsh*` 命名空间**，任一不满足即 **deny 整个 bundle** ⇒ profile 启动阶段
//   `skipping profile bundle`、插件 UI 全无且**客户端零提示**（失败不可观测）。
//
// 为什么抽成模块（与 `lib-manifest.mjs` / `chunk-decode.mjs` 同一先例）：
//   纯函数可**内存变异自证**（`test/governance-landing-locks.test.cjs`），无需整仓夹具
//   ⇒ 变异自证成本从"每次复制整仓"降到"构造两个对象"，回归锁才跑得起、留得住。
//
// ⚠ **判据边界（如实写明，⛔ 不得让判据看起来比实际更强）**：
//   · 本模块只判**三面集合逐名相等**（红线原文形态）。它**不判**：
//     ‑ 名字**是否实存/可解析**；‑ **semver 区间是否覆盖目标运行时**。
//     这两条属 `C-31`「待验证的依赖名不得留在声明面」，是**人载 + 外部环境实算**（须实际跑
//     npm/查远端），**不在本模块的机检面**。
//   · **命名空间边界**：宿主 compatibility 门**只审 `@deepseek-ai/dsh*`**。本模块对**全集合**
//     判相等（红线原文如此），但**命名空间外的名字宿主不审** ⇒ 本模块的"通过"在那类名字上
//     **不代表**"宿主认可其可解析"。⇒ 返回值里显式给出 `outsideNamespace`，使该边界**可见**。
//   · **fail-closed**：任一面读不到（缺对象 / 非数组 / 缺 root 条目 / 某面为空）⇒ `ok:false`
//     且 `reason` 写明哪一面，**绝不"读不到就算过"**。

/** 宿主 compatibility 门实际审的命名空间（边界可见化用；不是判据的一部分）。 */
export const HOST_AUDITED_NS = /^@deepseek-ai\/dsh/;

const sortedKeys = (o) => Object.keys(o).sort();
const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const diff = (a, b) => a.filter((x) => !b.includes(x));

/**
 * 三面相等对照（**纯函数**，不做任何磁盘 IO ⇒ 可内存变异自证）。
 *
 * @param {object} pkg   `package.json` 的解析对象（须含 `peerDependencies` 与 `dsh.client.inject`）
 * @param {object} lock  `package-lock.json` 的解析对象（须含 `packages[""].peerDependencies`）
 * @returns {{ok:boolean, reason:string, peer:string[], inject:string[], lockPeer:string[],
 *            outsideNamespace:string[], legs:string[]}}
 */
export function compareDeclaredSurface(pkg, lock) {
  const fail = (reason, extra = {}) => ({
    ok: false, reason,
    peer: extra.peer || [], inject: extra.inject || [], lockPeer: extra.lockPeer || [],
    outsideNamespace: extra.outsideNamespace || [], legs: extra.legs || [],
  });

  if (!pkg || typeof pkg !== 'object') return fail('package.json 不可解析或不是对象');
  if (!pkg.peerDependencies || typeof pkg.peerDependencies !== 'object') {
    return fail('package.json 无 peerDependencies 对象（声明面缺位 ⇒ 无从对照，不判绿）');
  }
  const injectRaw = pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject;
  if (!Array.isArray(injectRaw)) return fail('package.json 的 dsh.client.inject 不是数组（读不到 ⇒ 不判绿）');

  if (!lock || typeof lock !== 'object') return fail('package-lock.json 不可解析或不是对象');
  const rootEntry = lock.packages && lock.packages[''];
  if (!rootEntry || typeof rootEntry !== 'object') return fail('package-lock.json 无 root 条目（packages[""]）⇒ 镜像面缺位，不判绿');
  if (!rootEntry.peerDependencies || typeof rootEntry.peerDependencies !== 'object') {
    return fail('package-lock.json root 条目无 peerDependencies ⇒ 镜像面读不到，不判绿');
  }

  const peer = sortedKeys(pkg.peerDependencies);
  const inject = injectRaw.slice().sort();
  const lockPeer = sortedKeys(rootEntry.peerDependencies);
  const outsideNamespace = peer.filter((n) => !HOST_AUDITED_NS.test(n));

  if (!peer.length || !inject.length || !lockPeer.length) {
    return fail(`某面为空（peer ${peer.length} / inject ${inject.length} / lock-root ${lockPeer.length}）⇒ 不判绿`,
      { peer, inject, lockPeer, outsideNamespace });
  }

  const legs = [];
  if (!setEq(peer, inject)) legs.push(`peer↔inject 差：仅 peer [${diff(peer, inject).join(',') || '无'}] / 仅 inject [${diff(inject, peer).join(',') || '无'}]`);
  if (!setEq(peer, lockPeer)) legs.push(`peer↔lock-root 差：仅 peer [${diff(peer, lockPeer).join(',') || '无'}] / 仅 lock [${diff(lockPeer, peer).join(',') || '无'}]`);

  return {
    ok: legs.length === 0,
    reason: legs.length ? '三面不等：' + legs.join('；') : '三面逐名相等',
    peer, inject, lockPeer, outsideNamespace, legs,
  };
}
