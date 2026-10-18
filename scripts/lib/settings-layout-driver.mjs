// scripts/lib/settings-layout-driver.mjs —— 设置页布局量测的**浏览器内**求值程序（单一事实源）
//
// 为什么单独成文件：这段代码在**浏览器里**跑（不是 Node）；本模块把函数体原样序列化成字符串，
// 由 scripts/settings-layout-audit.mjs 注入页面后执行，再经 --dump-dom 取回读数。
// 它只用**真实 chunk 源码** + **真实 CSS** 构造 DOM，不重写任何布局规则。
//
// ⚠ 与生产逐字同源的两处：① CSS 取自 src/client/styles.js；② DOM 结构由 src/client/**.js 的
//   解码后源码执行产出（React 由最小 shim 顶替：只做元素构造/状态，不参与布局）。
// ⚠ 本文件**不实现**任何“挤压判据”：判据在 Node 侧（scripts/settings-layout-audit.mjs 的 cmp()），
//   浏览器只负责产出读数（宽度 / scrollWidth / clientWidth / 行高 / 计算后的 overflow 等）。

/** 浏览器内执行体（函数原文序列化后注入；不依赖 Node 任何 API）。 */
function browserDriver() {
  var P = JSON.parse(document.getElementById('payload').textContent);

  function flatten(a, out) {
    out = out || [];
    for (var i = 0; i < a.length; i++) {
      if (Array.isArray(a[i])) flatten(a[i], out);
      else if (a[i] !== null && a[i] !== undefined && a[i] !== false) out.push(a[i]);
    }
    return out;
  }

  // ── 最小 React shim ──────────────────────────────────────────────
  var React = {
    Fragment: '__FRAG__',
    createElement: function (type, props) {
      var kids = [];
      for (var i = 2; i < arguments.length; i++) {
        var k = arguments[i];
        if (Array.isArray(k)) kids = kids.concat(flatten(k));
        else kids.push(k);
      }
      return { t: type, p: props || {}, k: kids.filter(function (x) { return x !== null && x !== undefined && x !== false; }) };
    },
    useState: function (init) { return [typeof init === 'function' ? init() : init, function () {}]; },
    useRef: function (init) { return { current: init }; },
    useEffect: function () { return undefined; },
    useCallback: function (fn) { return fn; },
    useMemo: function (fn) { return fn(); },
    Children: {
      toArray: function (c) {
        if (c === null || c === undefined) return [];
        if (Array.isArray(c)) return flatten(c);
        return [c];
      },
    },
  };

  var ATTRS = /^(aria-|data-|role$|title$|id$|placeholder$|tabIndex$|min$|max$|step$|maxLength$|rows$|colSpan$)/;
  function applyProps(el, props) {
    Object.keys(props).forEach(function (k) {
      if (k === 'children') return;
      var v = props[k];
      if (k === 'style' && v && typeof v === 'object') {
        Object.keys(v).forEach(function (sk) {
          var cssKey = sk.indexOf('--') === 0 ? sk : sk.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
          try { el.style.setProperty(cssKey, String(v[sk])); } catch (e) { /* 非法样式值忽略 */ }
        });
        return;
      }
      if (k === 'className') { el.setAttribute('class', String(v)); return; }
      if (k === 'htmlFor') { el.setAttribute('for', String(v)); return; }
      if (k === 'value') { el.setAttribute('value', String(v)); el.value = String(v); return; }
      if (k === 'type' || k === 'min' || k === 'max' || k === 'step') { if (v !== undefined && v !== null) el.setAttribute(k, String(v)); return; }
      if (k === 'disabled' || k === 'readOnly') { if (v) el.setAttribute(k === 'readOnly' ? 'readonly' : 'disabled', ''); return; }
      if (ATTRS.test(k)) { if (v === undefined || v === null || v === false) return; el.setAttribute(k, v === true ? '' : String(v)); return; }
      if (/^on[A-Z]/.test(k)) return;
    });
  }

  function render(vnode, parent) {
    if (vnode === null || vnode === undefined || vnode === false || vnode === true) return;
    if (typeof vnode === 'string' || typeof vnode === 'number') { parent.appendChild(document.createTextNode(String(vnode))); return; }
    if (Array.isArray(vnode)) { for (var i = 0; i < vnode.length; i++) render(vnode[i], parent); return; }
    if (typeof vnode.t === 'function') {
      var kids = vnode.k || [];
      var props = Object.assign({}, vnode.p);
      if (kids.length) props.children = kids.length === 1 ? kids[0] : kids;
      render(vnode.t(props), parent);
      return;
    }
    if (vnode.t === '__FRAG__') { var fk = vnode.k || []; for (var j = 0; j < fk.length; j++) render(fk[j], parent); return; }
    var el = document.createElement(vnode.t);
    applyProps(el, vnode.p || {});
    var ks = vnode.k || [];
    for (var m = 0; m < ks.length; m++) render(ks[m], el);
    parent.appendChild(el);
  }

  // ── 数据桩（只给**数据**，不替代布局代码）──
  function makeHost(scn) {
    return {
      call: function (op) {
        if (op === 'models/list') return Promise.resolve(scn.loadFail ? { ok: false } : { ok: true, providers: scn.providers || [] });
        if (op === 'models/current') return Promise.resolve({ ok: true, provider: 'deepseek-official', model: 'deepseek-v4-flash' });
        if (op === 'voice/status') return Promise.resolve(scn.status || { ok: true, speech: { available: true, providers: [{ provider: 'a' }] }, filler: { configured: true } });
        if (op === 'template/default') return Promise.resolve({ ok: true, catalog: { standard: ['T1', 'T2'] } });
        if (op === 'models/test') return Promise.resolve(scn.testState ? { ok: true, latencyMs: scn.testState.ms, ttftMs: 1200, tokensPerSecond: 99.9, estimatedBaseSeconds: 3599, estimatedLiteSeconds: 3599 } : { ok: false });
        if (op === 'models/stats') return Promise.resolve(scn.testState ? { ok: true, ttftMs: 1200, tokensPerSecond: 99.9, estimatedBaseSeconds: 3599, estimatedLiteSeconds: 3599 } : { ok: false });
        return Promise.resolve({ ok: false });
      },
    };
  }

  // ── 运行时装配（注入顺序与 build-client.mjs 一致）──
  function buildRuntime(scn, overrides) {
    var SRC = P.chunks;
    var host = makeHost(scn);
    var saveStatus = scn.save || { phase: 'idle' };
    var lsBacking = new Map();
    var localStorageStub = {
      getItem: function (k) { return lsBacking.has(k) ? lsBacking.get(k) : null; },
      setItem: function (k, val) { lsBacking.set(k, String(val)); },
      removeItem: function (k) { lsBacking.delete(k); },
    };
    var stateFactory = new Function('localStorage', 'host', SRC['src/client/voice/state.js']
      + '\n;return { normalizeVadSilenceMs: normalizeVadSilenceMs, vadSilenceMsOf: vadSilenceMsOf, vadRequiredQuiet: vadRequiredQuiet, VOICE_CFG_DEFAULTS: VOICE_CFG_DEFAULTS, voiceCfgState: voiceCfgState, mergeVoice: mergeVoice, saveVoiceCfg: saveVoiceCfg, subscribeVoiceConfig: subscribeVoiceConfig, syncVoiceFromHost: syncVoiceFromHost };');
    var S = stateFactory(localStorageStub, host);
    S.voiceCfgState.value = JSON.parse(JSON.stringify(scn.voice));

    var i18nFactory = new Function(SRC['src/client/i18n.js'] + '\n;return { ZH: ZH, EN: EN };');
    var dicts = i18nFactory();
    // overrides 形态：{ kind: 'zh' | 'en' | 'worst' | 'path' }
    //   zh    = 当前 ZH 值（基线）；
    //   en    = **英文侧**同一批键（英文普遍更长 ⇒ 只测 ZH 会漏掉“英文把控件挤没”）；
    //   worst = 每键的**最长现实取值**（开/关两态、含数字读数、多态分支里最长的那一支）；
    //   path  = 病态超长（只用于证明“任取长度都不挤压”的构造保证）。
    var kind = (overrides && overrides.kind) || 'zh';
    var dict = kind === 'en' ? dicts.EN : dicts.ZH;
    var over = kind === 'worst' ? P.realisticMax : (kind === 'path' ? makePathological() : {});
    var ZH = Object.assign({}, dict, over);
    var t = function (k) { return ZH[k] !== undefined ? ZH[k] : k; };
    function makePathological() {
      var o = {};
      Object.keys(P.realisticMax).forEach(function (k) { o[k] = '超长文案超长文案超长文案超长文案超长文案超长文案超长文案超长文案超长文案超长文案超长文案超长文案超长文案'; });
      return o;
    }

    var constantsFactory = new Function(SRC['src/client/constants.js']
      + '\n;return { CONFIG_DEFAULTS: CONFIG_DEFAULTS, DEFAULT_MODEL_CHAIN: DEFAULT_MODEL_CHAIN, MODE_OPTIONS: MODE_OPTIONS, MODE_VALUES: MODE_VALUES, MODE_BUDGET_OPTIONS: MODE_BUDGET_OPTIONS, MODE_TIMEOUT_OPTIONS: MODE_TIMEOUT_OPTIONS, MODE_MAXTOKENS_OPTIONS: MODE_MAXTOKENS_OPTIONS, MODE_OUTPUTLIMIT_OPTIONS: MODE_OUTPUTLIMIT_OPTIONS, MODE_PARAMS_DEFAULT: MODE_PARAMS_DEFAULT, MODE_BUDGET_DEFAULT: MODE_BUDGET_DEFAULT, modeShortLabel: modeShortLabel, modeLabel: modeLabel, TEMPLATE_BUILTIN_KEYS: TEMPLATE_BUILTIN_KEYS, TEMPLATE_CUSTOM_MAX: TEMPLATE_CUSTOM_MAX, TEMPLATE_TEXT_MAX: TEMPLATE_TEXT_MAX, TEMPLATE_NAME_MAX: TEMPLATE_NAME_MAX, customPickIndex: customPickIndex };');
    var C = constantsFactory();
    var mhFactory = new Function(SRC['src/client/model-helpers.js'] + '\n;return { buildCandidates: buildCandidates };');
    var MH = mhFactory();

    var dSnap = Object.assign({ installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 0, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 0, lastSessionFailed: false, feedbackMessage: '', stopMissed: 0, startClicks: 0, stopClicks: 0, vadHeardSpeech: false, vadQuietFrames: 0, vadThreshold: 0, vadNoiseFloor: 0, vadSkipped: 0 }, scn.diag || {});
    var fSnap = Object.assign({ runs: 0, cleaned: 0, removedTotal: 0, skipped: 0, lastRemoved: [], legacyChecked: false, legacyCleaned: false }, scn.filler || {});
    var cSnap = Object.assign({ runs: 0, ok: 0, changed: 0, failed: 0, skipped: 0, lastCode: '', lastSkipReason: '' }, scn.correction || {});
    var officialVoiceBridge = { snapshot: function () { return dSnap; }, subscribe: function () { return function () {}; }, yieldToOfficialIfPresent: function () { return false; } };
    var noop = function () { return function () {}; };
    var configState = { value: JSON.parse(JSON.stringify(scn.cfg)), fresh: false, hostSync: true, unsupported: false };

    var compCode = [
      SRC['src/client/components/collapsible-section.js'],
      SRC['src/client/components/marquee-select.js'],
      SRC['src/client/components/model-main-section.js'],
      SRC['src/client/components/fallback-row.js'],
      SRC['src/client/components/model-config-tab.js'],
      SRC['src/client/components/params-tab.js'],
      SRC['src/client/components/model-plugins-section.js'],
      SRC['src/client/voice/voice-section.js'],
    ].join('\n');
    var NAMES = ['React', 'ZH', 'EN', 't', 'makeT', 'host', 'configState', 'saveConfig', 'subscribeConfig', 'subscribeSaveStatus', 'saveStatus',
      'voiceCfgState', 'saveVoiceCfg', 'subscribeVoiceConfig', 'syncVoiceFromHost', 'vadSilenceMsOf', 'normalizeVadSilenceMs',
      'voiceHotkeyDisplay', 'officialVoiceBridge', 'fillerSnapshot', 'correctionSnapshot', 'subscribeFiller', 'subscribeCorrection',
      'dshEnhId', 'timerSvc', 'getLastDraft', 'buildCandidates', 'DEFAULT_MODEL_CHAIN', 'MODE_OPTIONS', 'MODE_VALUES',
      'MODE_BUDGET_OPTIONS', 'MODE_TIMEOUT_OPTIONS', 'MODE_MAXTOKENS_OPTIONS', 'MODE_OUTPUTLIMIT_OPTIONS', 'MODE_PARAMS_DEFAULT',
      'MODE_BUDGET_DEFAULT', 'modeShortLabel', 'modeLabel', 'TEMPLATE_BUILTIN_KEYS', 'TEMPLATE_CUSTOM_MAX', 'TEMPLATE_TEXT_MAX',
      'TEMPLATE_NAME_MAX', 'customPickIndex'];
    var makeT = function (props) { return (props && typeof props.t === 'function') ? props.t : t; };
    var idSeq = 0;
    var values = [React, ZH, dicts.EN, t, makeT, host, configState, function () {}, noop, noop, saveStatus,
      S.voiceCfgState, function () {}, noop, function () {}, S.vadSilenceMsOf, S.normalizeVadSilenceMs,
      function (c) { return String(c || ''); }, officialVoiceBridge,
      function () { return fSnap; }, function () { return cSnap; }, noop, noop,
      function (p) { idSeq += 1; return (p || 'x') + '-' + idSeq; }, null, function () { return ''; }, MH.buildCandidates,
      C.DEFAULT_MODEL_CHAIN, C.MODE_OPTIONS, C.MODE_VALUES, C.MODE_BUDGET_OPTIONS, C.MODE_TIMEOUT_OPTIONS, C.MODE_MAXTOKENS_OPTIONS,
      C.MODE_OUTPUTLIMIT_OPTIONS, C.MODE_PARAMS_DEFAULT, C.MODE_BUDGET_DEFAULT, C.modeShortLabel, C.modeLabel,
      C.TEMPLATE_BUILTIN_KEYS, C.TEMPLATE_CUSTOM_MAX, C.TEMPLATE_TEXT_MAX, C.TEMPLATE_NAME_MAX, C.customPickIndex];
    var compFactory = new Function(NAMES.join(', '), compCode + '\n;return { ModelPluginsSection: ModelPluginsSection, ModelConfigTab: ModelConfigTab, ParamsTab: ParamsTab };');
    var api = compFactory.apply(null, values);
    return { api: api, t: t };
  }

  // ── 量测（只读数，不判定）──
  function measureScenario(scn, overrides) {
    var root = document.getElementById('root');
    root.innerHTML = '';
    // 2026-10-18（R2 · 判据 A 的多宽度要求）：装置须能在**指定 row1 宽**下量测。
    //   row1 = root - 30（真机实测恒定偏移：宿主 padding 链 root 564 → row1 534）。
    //   ⚠ 只在装置里设 #root 宽，不改任何插件规则；row1 实测宽另行记账（见 out.row1W）。
    if (P.row1W) { root.style.width = (P.row1W + 30) + 'px'; } else { root.style.width = ''; }
    var rt = buildRuntime(scn, overrides);
    // 按场景选 tab：'params' / 'models' ⇒ 直接渲染该 tab 的真实组件；
    // （tab 状态由真实组件持有，而 shim 的 useState 只取初值 ⇒ 不伪造 UI 状态，直接进组件面）
    var tree;
    if (scn.tab === 'params') {
      tree = React.createElement('div', { className: 'dsh-plg-root' },
        React.createElement('h2', { className: 'dsh-plg-title' }, rt.t('navModelPlugins')),
        React.createElement('p', { className: 'dsh-plg-intro' }, rt.t('secPluginsIntro')),
        React.createElement(rt.api.ParamsTab, { t: rt.t }));
    } else if (scn.tab === 'models') {
      tree = React.createElement('div', { className: 'dsh-plg-root' },
        React.createElement('h2', { className: 'dsh-plg-title' }, rt.t('navModelPlugins')),
        React.createElement('p', { className: 'dsh-plg-intro' }, rt.t('secPluginsIntro')),
        React.createElement(rt.api.ModelConfigTab, { t: rt.t }));
    } else {
      tree = React.createElement(rt.api.ModelPluginsSection, { t: rt.t });
    }
    render(tree, root);
    void root.offsetWidth;

    var ROW_SEL = '.dsh-plg-row, .dsh-plg-row-duo, .dsh-plg-field, .dsh-cfg-sec-head, .dsh-plg-testarea-head, .dsh-vi-section > div, .dsh-plg-col';
    var rows = [].slice.call(root.querySelectorAll(ROW_SEL));
    var seen = [];
    var sec = root.querySelector('.dsh-vi-section');
    var row1El = sec ? sec.children[0] : null;
    var r1 = row1El ? row1El.getBoundingClientRect() : null;
    var out = { id: scn.id, rows: [], texts: [], rootOverflow: null, visibleText: '',
      row1W: r1 ? Math.round(r1.width * 100) / 100 : null,
      row1H: r1 ? Math.round(r1.height * 100) / 100 : null,
      rootW: Math.round(root.getBoundingClientRect().width * 100) / 100 };
    rows.forEach(function (row, idx) {
      if (seen.indexOf(row) !== -1) return;
      seen.push(row);
      var cs = getComputedStyle(row);
      var rr = row.getBoundingClientRect();
      var controls = [].slice.call(row.querySelectorAll('input, select, textarea, button, .dsh-plg-mselect')).map(function (c) {
        var cr = c.getBoundingClientRect();
        var cc = getComputedStyle(c);
        var mw = parseFloat(cc.minWidth);
        return {
          tag: c.tagName.toLowerCase(), cls: String(c.className || ''),
          w: Math.round(cr.width * 100) / 100, h: Math.round(cr.height * 100) / 100,
          // 下限读数（"任何文案长度下都不会窄于它"的判据基元）
          minW: isFinite(mw) ? Math.round(mw * 100) / 100 : 0,
          flex: cc.flex,
          // 2026-10-18（R2 装置缺陷修复）：边界读数——装置未注入宿主 token 时 border 整条失效
          //   （computed 为 0px / none），这正是「读数比真机少 2px」的成因 => 必须可读、可前后对照。
          borderW: cc.borderTopWidth, borderStyle: cc.borderTopStyle, borderColor: cc.borderTopColor,
        };
      });
      var texts = [].slice.call(row.querySelectorAll('span, label, p, button, h2, h3, li, div')).filter(function (e) {
        var own = '';
        for (var n = 0; n < e.childNodes.length; n++) { if (e.childNodes[n].nodeType === 3) own += e.childNodes[n].nodeValue; }
        return own.trim().length > 0;
      }).map(function (e) {
        var r = e.getBoundingClientRect();
        var cst = getComputedStyle(e);
        var ell = (e.scrollWidth > e.clientWidth + 1) && (cst.textOverflow === 'ellipsis' || cst.overflowX === 'hidden' || cst.overflowX === 'clip');
        return {
          tag: e.tagName.toLowerCase(), cls: String(e.className || ''),
          text: (e.textContent || '').slice(0, 90),
          w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
          scrollW: e.scrollWidth, clientW: e.clientWidth,
          overflowX: cst.overflowX, whiteSpace: cst.whiteSpace, textOverflow: cst.textOverflow,
          // 两种越界都算缺陷：① 被裁掉（ellipsis/clip/hidden）② 溢出到盒子外（visible 但内容更宽）
          //   ⇒ 统一按"内容比盒子宽"记账，由 Node 侧分级判据决定它算 REAL 还是 PATH。
          ellipsis: ell || (e.scrollWidth > e.clientWidth + 1),
        };
      });
      out.rows.push({
        idx: idx, cls: String(row.className || ''), w: Math.round(rr.width * 100) / 100, h: Math.round(rr.height * 100) / 100,
        display: cs.display, flexWrap: cs.flexWrap, flexDirection: cs.flexDirection, gt: cs.gridTemplateColumns || '',
        controls: controls, texts: texts,
      });
      texts.forEach(function (x) { out.texts.push(Object.assign({ row: idx }, x)); });
    });
    // ── 全量几何快照（2026-10-18 R2：判据 E 要求逐项可对比，含静音行）──
    //   只读数、不判定；每项给 x/y/w/h 与中心 y（cy）。
    function box(el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var cs2 = getComputedStyle(el);
      return {
        x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100,
        w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
        cy: Math.round((r.y + r.height / 2) * 100) / 100,
        borderW: cs2.borderTopWidth, borderStyle: cs2.borderTopStyle, borderColor: cs2.borderTopColor,
        pad: cs2.padding, minW: cs2.minWidth, flex: cs2.flex,
      };
    }
    var geom = { row1: box(row1El) };
    if (row1El) {
      var kids = [].slice.call(row1El.children);
      geom.chips = [].slice.call(row1El.querySelectorAll('button.dsh-plg-tgl')).map(function (c, i) { return { idx: i, text: String(c.textContent || '').slice(0, 24), cls: String(c.className || ''), box: box(c) }; });
      var hot = kids.length ? kids[kids.length - 1] : null;
      // 2026-10-18（R2 · 判据 B）：输入框**可读性**原始读数——显示值 / scW / clW / title。
      //   判据：scrollWidth <= clientWidth + 1 ⇒ 当前串**完整可见**；否则必须靠 title/悬停看全。
      if (hot && hot.children.length >= 2) {
        var inpEl = hot.children[1];
        var inpCS = getComputedStyle(inpEl);
        geom.inputRead = {
          value: String(inpEl.value || ''),
          title: inpEl.getAttribute('title') || '',
          aria: inpEl.getAttribute('aria-label') || '',
          scrollW: inpEl.scrollWidth, clientW: inpEl.clientWidth,
          contentW: Math.round((inpEl.getBoundingClientRect().width - parseFloat(inpCS.paddingLeft) * 2 - parseFloat(inpCS.borderLeftWidth) * 2) * 100) / 100,
          fullyVisible: inpEl.scrollWidth <= inpEl.clientWidth + 1,
        };
      }
      geom.hotCol = box(hot);
      if (hot && hot.children.length >= 3) {
        geom.hotLabel = box(hot.children[0]);
        geom.hotInput = box(hot.children[1]);
        geom.hotClear = box(hot.children[2]);
        geom.hotKids = [].slice.call(hot.children).map(function (c) { return { tag: c.tagName.toLowerCase(), cls: String(c.className || ''), text: String(c.textContent || '').slice(0, 24), title: c.getAttribute('title') || '', aria: c.getAttribute('aria-label') || '', box: box(c) }; });
      }
      geom.row1Kids = kids.map(function (c) { return { tag: c.tagName.toLowerCase(), cls: String(c.className || ''), box: box(c) }; });
    }
    if (sec) {
      geom.sectionKids = [].slice.call(sec.children).map(function (c) { return { tag: c.tagName.toLowerCase(), cls: String(c.className || ''), box: box(c) }; });
      var sil = sec.querySelector('.dsh-vi-silence-row');
      geom.silenceRow = box(sil);
      if (sil) {
        geom.silenceChip = box(sil.querySelector('button.dsh-plg-tgl'));
        geom.slider = box(sil.querySelector('.dsh-vi-slider'));
        geom.readout = box(sil.querySelector('.dsh-plg-muted'));
        geom.silenceKids = [].slice.call(sil.children).map(function (c) { return { tag: c.tagName.toLowerCase(), cls: String(c.className || ''), box: box(c) }; });
      }
    }
    geom.cards = [].slice.call(root.querySelectorAll('.dsh-cfg-sec')).map(function (c, i) { return { idx: i, w: Math.round(c.getBoundingClientRect().width * 100) / 100, box: box(c) }; });
    geom.root = box(root);
    out.geom = geom;
    out.rootOverflow = { scrollW: root.scrollWidth, clientW: root.clientWidth };
    out.visibleText = String(root.innerText || '').replace(/\s+/g, ' ');
    return out;
  }

  var results = { scenarios: [], errors: [] };
  (P.scenarios || []).forEach(function (scn) {
    try {
      var base = measureScenario(scn, { kind: 'zh' });
      var en = measureScenario(scn, { kind: 'en' });
      var worst = measureScenario(scn, { kind: 'worst' });
      var pathological = measureScenario(scn, { kind: 'path' });
      results.scenarios.push({ id: scn.id, base: base, en: en, worst: worst, pathological: pathological });
    } catch (e) {
      results.errors.push({ id: scn.id, err: String((e && e.message) || e) + ' @ ' + String(((e && e.stack) || '').split('\n')[1] || '') });
    }
  });

  var el = document.createElement('script');
  el.type = 'application/json';
  el.id = 'result';
  el.textContent = JSON.stringify(results);
  document.body.appendChild(el);
}

/** 注入页面用的脚本文本（自执行形态）。 */
export const DRIVER = '(' + browserDriver.toString() + ')();';
