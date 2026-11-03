'use strict';

// 客户端 UI 组件普通模块（构建期由客户端运行时内联）。
// 迁移只改变代码载体；组件行为、可见文案、类名与 ARIA 关联不变。
function createCollapsibleSection(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const React = d.React;
  const dshEnhId = d.dshEnhId;
function CollapsibleSection(props) {
  // v2.4.3：默认展开（需求：模型配置栏打开即见完整内容）
  const [open, setOpen] = React.useState(true);
  // 2026-08-16（方案「设置界面样式与交互对齐官方」）：稳定 id + aria 关联
  // （head 按钮 aria-controls → body region）
  const ids = React.useState(() => ({ head: dshEnhId('dsh-cfg-sec-head'), body: dshEnhId('dsh-cfg-sec-body') }))[0];
  return React.createElement('div', { className: 'dsh-cfg-sec' },
    React.createElement('button', {
      type: 'button',
      id: ids.head,
      className: 'dsh-cfg-sec-head',
      onClick: () => setOpen(!open),
      'aria-expanded': open,
      'aria-controls': ids.body,
    },
      React.createElement('span', { className: 'dsh-cfg-chev' + (open ? ' dsh-cfg-chev-open' : '') }, '▸'),
      React.createElement('span', { className: 'dsh-cfg-sec-title' }, props.title),
      props.summary ? React.createElement('span', { className: 'dsh-cfg-sec-summary' }, props.summary) : null,
    ),
    open ? React.createElement('div', { id: ids.body, role: 'region', 'aria-labelledby': ids.head, className: 'dsh-cfg-sec-body' }, props.children) : null,
  );
}

// 模型配置区块（v23：主模型/兜底整合为单一模型链——所有行同构，无主/兜之分；
// 测试结果块内固定单点集中显示，行结构测试前后不变）

  return CollapsibleSection;
}

module.exports = { createCollapsibleSection };
