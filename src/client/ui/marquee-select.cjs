'use strict';

// 客户端 UI 组件普通模块（构建期由客户端运行时内联）。
// 迁移只改变代码载体；组件行为、可见文案、类名与 ARIA 关联不变。
function createMarqueeSelect(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const React = d.React;
  const window = d.window !== undefined ? d.window : (typeof globalThis !== 'undefined' ? globalThis.window || null : null);
  const document = d.document !== undefined ? d.document : (typeof globalThis !== 'undefined' ? globalThis.document || null : null);
function MarqueeOption(props) {
  const ref = React.useRef(null);
  const innerRef = React.useRef(null);
  const [distance, setDistance] = React.useState(0);
  React.useEffect(function () {
    const outer = ref.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const next = Math.max(0, inner.scrollWidth - outer.clientWidth);
    setDistance(function (prev) { return prev === next ? prev : next; });
  }, [props.label, props.hovered]);
  const marquee = props.hovered && distance > 0;
  return React.createElement('li', {
    role: 'option',
    'aria-selected': props.selected,
    'aria-disabled': props.disabled || undefined,
    'data-active': props.active ? 'true' : undefined,
    onMouseEnter: props.onHover,
    onMouseDown: function (e) {
      e.preventDefault();
      if (!props.disabled) props.onPick();
    },
  },
    React.createElement('span', {
      ref: ref,
      className: 'dsh-plg-mselect-option-text' + (marquee ? ' dsh-plg-mselect-option-text-marquee' : ''),
    },
      React.createElement('span', {
        ref: innerRef,
        className: 'dsh-plg-mselect-option-text-inner',
        style: marquee ? { '--dsh-mselect-distance': distance + 'px' } : undefined,
      }, props.label),
    ),
  );
}

function MarqueeSelect(props) {
  const textRef = React.useRef(null);
  const innerTextRef = React.useRef(null);
  const rootRef = React.useRef(null);
  const [distance, setDistance] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const options = React.Children.toArray(props.children);
  const selectedIndex = options.findIndex(function (c) {
    return c && c.props && String(c.props.value) === String(props.value);
  });
  const label = selectedIndex >= 0 && options[selectedIndex].props && options[selectedIndex].props.children != null
    ? String(options[selectedIndex].props.children)
    : String(props.value == null ? '' : props.value);

  // 闭合态：选中项/数据/容器宽度变化后测量溢出距离；CSS 注入或布局稳定后再补测一次（rAF），未溢出时 distance = 0
  React.useEffect(function () {
    function measure() {
      const outer = textRef.current;
      const inner = innerTextRef.current;
      if (!outer || !inner) return;
      const next = Math.max(0, inner.scrollWidth - outer.clientWidth);
      setDistance(function (prev) { return prev === next ? prev : next; });
    }
    measure();
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measure) : 0;
    return function () { if (raf) cancelAnimationFrame(raf); };
  }, [label, props.value, props.className, options.length]);

  // 窗口尺寸变化时同步更新滚动距离
  React.useEffect(function () {
    function update() {
      const outer = textRef.current;
      const inner = innerTextRef.current;
      if (!outer || !inner) return;
      setDistance(Math.max(0, inner.scrollWidth - outer.clientWidth));
    }
    window.addEventListener('resize', update);
    return function () { window.removeEventListener('resize', update); };
  }, []);

  // 容器尺寸变化（CSS 注入/折叠展开/弹性宽度调整）时重新测量
  React.useEffect(function () {
    const outer = textRef.current;
    if (!outer || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(function () {
      const o = textRef.current;
      const i = innerTextRef.current;
      if (!o || !i) return;
      setDistance(Math.max(0, i.scrollWidth - o.clientWidth));
    });
    ro.observe(outer);
    return function () { ro.disconnect(); };
  }, []);

  // 点击外部关闭下拉
  React.useEffect(function () {
    if (!open) return;
    function onDocMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return function () { document.removeEventListener('mousedown', onDocMouseDown); };
  }, [open]);

  // 打开时把高亮定位到当前选中项
  React.useEffect(function () {
    if (open) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, props.value]);

  function choose(value) {
    if (props.onChange) props.onChange({ target: { value: value } });
    setOpen(false);
  }

  function toggle() {
    if (props.disabled) return;
    setOpen(function (v) { return !v; });
  }

  function onTriggerKeyDown(e) {
    if (props.disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function onListKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(function (i) { return Math.min(i + 1, options.length - 1); });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(function (i) { return Math.max(i - 1, 0); });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt && opt.props && !opt.props.disabled) choose(opt.props.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  const marquee = distance > 0;
  return React.createElement('span', {
    ref: rootRef,
    className: 'dsh-plg-mselect' + (props.className ? ' ' + props.className : ''),
    'data-disabled': props.disabled ? 'true' : undefined,
  },
    React.createElement('div', {
      id: props.id,
      role: 'combobox',
      tabIndex: props.disabled ? -1 : 0,
      'aria-expanded': open,
      'aria-haspopup': 'listbox',
      'aria-label': props['aria-label'],
      'aria-describedby': props['aria-describedby'],
      // 2026-08-18（用户需求）：下拉框 hover 提示（如思考开关）——title 透传给 trigger
      title: props.title,
      className: 'dsh-plg-mselect-trigger',
      onClick: toggle,
      onKeyDown: onTriggerKeyDown,
    },
      React.createElement('span', { className: 'dsh-plg-mselect-visual', 'aria-hidden': true },
        React.createElement('span', {
          ref: textRef,
          className: 'dsh-plg-mselect-text' + (marquee ? ' dsh-plg-mselect-text-marquee' : ''),
        },
          React.createElement('span', {
            ref: innerTextRef,
            className: 'dsh-plg-mselect-text-inner',
            style: marquee ? { '--dsh-mselect-distance': distance + 'px' } : undefined,
          }, label),
        ),
      ),
      // v3.1.7（用户反馈·下拉箭头点击不弹出·修正）：箭头移入 trigger 内 + CSS pointer-events:auto。
      // **注意不能给箭头绑 onClick toggle**——箭头在 trigger 内，点击箭头会同时触发：①箭头自身
      // onClick toggle、②事件冒泡到 trigger onClick toggle → 两次 toggle = 状态不变（弹不出来）。
      // 正确做法：箭头只靠 pointer-events:auto 接收点击 → 事件冒泡到 trigger → onClick toggle 一次。
      React.createElement('span', {
        className: 'dsh-plg-mselect-arrow',
        'aria-hidden': true,
      }),
    ),
    open
      ? React.createElement('ul', {
          className: 'dsh-plg-mselect-list',
          role: 'listbox',
          onKeyDown: onListKeyDown,
        },
          options.map(function (opt, i) {
            const disabled = !!(opt.props && opt.props.disabled);
            return React.createElement(MarqueeOption, {
              key: opt.key != null ? opt.key : String(i),
              label: opt.props && opt.props.children != null ? String(opt.props.children) : String(opt.props.value),
              disabled: disabled,
              selected: i === selectedIndex,
              active: i === activeIndex,
              hovered: i === activeIndex,
              onHover: function () { setActiveIndex(i); },
              onPick: function () { if (!disabled) choose(opt.props.value); },
            });
          })
        )
      : null,
  );
}


  return MarqueeSelect;
}

module.exports = { createMarqueeSelect };
