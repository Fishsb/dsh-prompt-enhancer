'use strict';

// 目标模式运行期回归锁：真正执行 client apply()，覆盖上一轮只做“工厂可加载”
// 而漏掉的隐式依赖（styles facade / storage 注入 / timer 晚绑定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { CONFIG_KEY } = require('../src/client/constants-module.cjs');
const { createClientApp } = require('../src/client/app-module.cjs');

function createReactHarness() {
  const hooks = [];
  let index = 0;
  let dirty = false;
  let pendingEffects = [];

  const React = {
    Fragment: 'fragment',
    createElement(type, props) {
      const children = Array.from(arguments).slice(2).flat(9)
        .filter((v) => v !== null && v !== undefined && v !== false);
      return {
        type,
        props: Object.assign({}, props || {}, children.length
          ? { children: children.length === 1 ? children[0] : children }
          : {}),
      };
    },
    useState(initial) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = hooks[i];
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next;
        dirty = true;
      }];
    },
    useRef(initial) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = { current: initial };
      return hooks[i];
    },
    useEffect(fn, deps) {
      const i = index++;
      const prev = hooks[i];
      const changed = !prev
        || !deps
        || !prev.deps
        || deps.length !== prev.deps.length
        || deps.some((v, j) => v !== prev.deps[j]);
      if (!changed) return;
      if (prev && typeof prev.cleanup === 'function') prev.cleanup();
      hooks[i] = { deps, cleanup: null };
      pendingEffects.push({ i, fn });
    },
    useCallback(fn) { return fn; },
  };

  function renderOnce(Component, props) {
    index = 0;
    dirty = false;
    pendingEffects = [];
    const tree = Component(props);
    for (const item of pendingEffects) {
      const cleanup = item.fn();
      hooks[item.i].cleanup = typeof cleanup === 'function' ? cleanup : null;
    }
    return tree;
  }

  function render(Component, props) {
    let tree = renderOnce(Component, props);
    let guard = 0;
    while (dirty && guard < 8) {
      tree = renderOnce(Component, props);
      guard += 1;
    }
    return tree;
  }

  function unmount() {
    for (const hook of hooks) {
      if (hook && typeof hook.cleanup === 'function') hook.cleanup();
    }
  }

  return { React, render, unmount };
}

function makeDocument() {
  const appended = [];
  const documentStub = {
    head: { appendChild(el) { appended.push(el); return el; } },
    body: {},
    querySelector(selector) {
      if (selector === 'style[data-plugin-css="dsh-voice-prompt-enhancer"]') {
        return appended.find((el) => el.dataset && el.dataset.pluginCss === 'dsh-voice-prompt-enhancer') || null;
      }
      return null;
    },
    createElement(tag) {
      return { tagName: tag, dataset: {}, textContent: '' };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return { documentStub };
}

function makeWindow() {
  return { __ModuleLoader__: null };
}

function makeTimer() {
  const calls = [];
  const timeoutFns = [];
  const intervalFns = [];
  return {
    calls,
    timeoutFns,
    intervalFns,
    timeout(fn, ms) { calls.push({ type: 'timeout', ms }); timeoutFns.push(fn); return () => {}; },
    interval(fn, ms) { calls.push({ type: 'interval', ms }); intervalFns.push(fn); return () => {}; },
  };
}

function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function makeHost() {
  return {
    calls: [],
    call(method, args) {
      this.calls.push({ method, args });
      if (method === 'enhance') return new Promise(() => {});
      if (method === 'config/get') return Promise.resolve({ ok: true, config: null });
      if (method === 'config/set') return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true });
    },
  };
}

function makeSlots() {
  const entries = [];
  const slots = {
    inject(name, fn) {
      entries.push({ name, entry: fn() });
    },
    register(meta, component) {
      return { meta, component };
    },
  };
  return { slots, entries };
}

function makeCtx(slots, timer) {
  const cleanups = [];
  const locale = {
    register() { return () => {}; },
    bind() { return (key) => key; },
  };
  return {
    cleanups,
    ctx: {
      get(name) {
        if (name === 'slots') return slots;
        if (name === 'locale') return locale;
        if (name === 'timer') return timer;
        return undefined;
      },
      effect(fn) {
        const cleanup = fn();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      },
    },
  };
}

async function withBrowserGlobals(fn) {
  const saved = {
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    window: globalThis.window,
  };
  const { documentStub } = makeDocument();
  const windowStub = makeWindow();
  globalThis.document = documentStub;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, config: null }) });
  globalThis.window = windowStub;
  delete globalThis.localStorage;
  try {
    return await fn({ documentStub, windowStub });
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete globalThis[key];
      else globalThis[key] = saved[key];
    }
  }
}

test('CAP-01 产物 apply() 注入样式并按原顺序注册当前槽位', async () => {
  await withBrowserGlobals(({ documentStub, windowStub }) => {
    const bundle = fs.readFileSync(path.join(ROOT, 'lib', 'client.cjs'), 'utf8');
    let captured = null;
    const loaderWindow = {
      __ModuleLoader__: { load(def) { captured = def; } },
    };
    new Function('window', bundle)(loaderWindow);
    assert.ok(captured && typeof captured.factory === 'function', '产物必须向 __ModuleLoader__ 注册工厂');

    const harness = createReactHarness();
    const plugin = captured.factory((name) => (name === 'react' ? harness.React : {}));
    assert.deepEqual(plugin.inject, ['slots', 'locale', 'timer']);

    const { slots, entries } = makeSlots();
    const timer = makeTimer();
    const { ctx, cleanups } = makeCtx(slots, timer);
    assert.doesNotThrow(() => plugin.apply(ctx), 'apply() 不得因 styles/storage/timer 缺失而抛错');

    // 通过 querySelector 证明样式标签已挂载，并直接核对文本。
    const mounted = documentStub.querySelector('style[data-plugin-css="dsh-voice-prompt-enhancer"]');
    assert.ok(mounted, 'apply() 必须插入插件样式标签');
    assert.ok(String(mounted.textContent).includes('.dsh-enh-btn'), '样式标签必须承载既有 CSS');

    assert.deepEqual(entries.map((e) => e.entry.meta.name + ':' + e.entry.meta.id), [
      'settings.section:model-plugins',
      'conversation.input.right:prompt-enhance',
      'conversation.input.right:voice-hotkey',
      'conversation.input.dock:prompt-enhance-status',
    ], '槽位名称、ID 与注册顺序必须与当前装配图一致');

    for (const cleanup of cleanups) {
      assert.doesNotThrow(() => cleanup(), 'apply 注册的清理函数必须可安全执行');
    }
  });
});

test('CAP-02 普通模块装配：storage 走显式注入，timer 在 apply 后晚绑定生效', async () => {
  await withBrowserGlobals(({ documentStub, windowStub }) => {
    const harness = createReactHarness();
    const storage = makeStorage();
    const host = makeHost();
    const styles = { inserted: 0, insert(css) { this.inserted += 1; this.css = css; } };
    const timer = makeTimer();

    const app = createClientApp({
      React: harness.React,
      host,
      styles,
      window: windowStub,
      document: documentStub,
      navigator: {},
      MutationObserver: class { observe() {} disconnect() {} },
      storage,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      console: { log() {} },
    });
    // 启动时 state 模块会异步向 host 拉取 config/get；同步完成后 configState.value 才是真实对象。
    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {

    const { slots, entries } = makeSlots();
    const { ctx, cleanups } = makeCtx(slots, timer);
    app.apply(ctx);
    assert.equal(styles.inserted, 1, '样式 facade 必须由装配层提供并调用');

    const enhanceEntry = entries.find((e) => e.entry.meta.id === 'prompt-enhance');
    assert.ok(enhanceEntry, '必须注册增强按钮');
    const settingsEntry = entries.find((e) => e.entry.meta.id === 'model-plugins');
    assert.ok(settingsEntry, '必须注册设置页');
    const settingsHarness = createReactHarness();
    const tree = settingsHarness.render(settingsEntry.entry.component, { t: (key) => key });
    assert.ok(tree, '设置页组件必须能在真实装配依赖下渲染');
    assert.doesNotThrow(
      () => settingsEntry.entry.component({ t: (key) => key }),
      '语音热键显示函数必须由共享运行时显式导出（真实宿主曾因注入 undefined 整段崩溃）',
    );
    const EnhanceButton = enhanceEntry.entry.component;

    // 空输入点击 = 记忆开关：saveConfig 必须写入注入的 storage（而不是未定义的全局 localStorage）。
    const emptyHarness = createReactHarness();
    const emptyTree = emptyHarness.render(EnhanceButton, {
      sessionId: 'cap-storage',
      input: { draft: '', phase: '' },
      inputActions: { setDraft() {} },
      t: (key) => key,
    });
    assert.equal(emptyTree.type, 'button');
    emptyTree.props.onClick();
    assert.ok(storage.map.has(CONFIG_KEY), 'saveConfig 必须写入注入 storage');

    // 非空输入点击增强：组件工厂早已捕获 timerSvc；apply 后 timerRef 必须让它指向宿主 timer。
    timer.calls.length = 0;
    const timerHarness = createReactHarness();
    const props = {
      sessionId: 'cap-timer',
      input: { draft: 'hello', phase: '' },
      inputActions: { setDraft() {} },
      t: (key) => key,
    };
    const idleTree = timerHarness.render(EnhanceButton, props);
    assert.equal(idleTree.type, 'button');
    idleTree.props.onClick();
    const busyTree = timerHarness.render(EnhanceButton, props);
    assert.ok(String(busyTree.props.className).includes('dsh-enh-btn-busy'), '点击后必须进入增强忙态');
    // 进度轮询 effect 在忙态渲染时登记；直接驱动该回调证明它走的是宿主 timer，而非全局 setInterval。
    const probe = { hit: 0 };
    const realInterval = globalThis.setInterval;
    globalThis.setInterval = () => { probe.hit += 1; return 0; };
    try {
      timerHarness.render(EnhanceButton, props);
    } finally {
      globalThis.setInterval = realInterval;
    }
    assert.equal(probe.hit, 0, '进度轮询不得回落到全局 setInterval');
    assert.ok(timer.timeoutFns.length > 0 || timer.intervalFns.length > 0,
      '增强/保存链路必须经宿主 timer 代理（晚绑定生效）');

    timerHarness.unmount();
    emptyHarness.unmount();
    harness.unmount();
    for (const cleanup of cleanups) {
      try { cleanup(); } catch (e) { /* 清理失败不影响断言 */ }
    }
    });
  });
});
