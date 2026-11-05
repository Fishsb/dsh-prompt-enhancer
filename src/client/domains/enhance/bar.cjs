'use strict';

// 增强错误提示普通组件（构建期由客户端运行时内联）。
// 仅改变代码载体；会话解析、错误消费与可见行为不变。
function createEnhanceBar(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const React = d.React;
  const makeT = d.makeT;
  const subscribe = d.subscribe;
  const storeFor = d.storeFor;
  const notify = d.notify;
  const releaseStoreIfIdle = d.releaseStoreIfIdle;
  const errorKey = d.errorKey;

function EnhanceBar(props) {
  const t = makeT(props);
  const useSessionHook = typeof props.useSession === 'function' ? props.useSession : null;
  const useInputHook = typeof props.useInput === 'function' ? props.useInput : null;
  const sessionSnap = useSessionHook ? useSessionHook((s) => s) : null;
  const inputSnap = useInputHook ? useInputHook((s) => s) : null;
  const sessionId = (sessionSnap && sessionSnap.sessionId) || (props.session && props.session.sessionId) || props.sessionId;
  const input = inputSnap || props.input || {};
  const draft = typeof input.draft === 'string' ? input.draft : '';
  const inputActions = props.inputActions;

  const [, setVersion] = React.useState(0);
  React.useEffect(() => subscribe(sessionId, () => setVersion((v) => v + 1)), [sessionId]);
  React.useEffect(() => () => {
    releaseStoreIfIdle(sessionId);
  }, [sessionId]);

  React.useEffect(() => {
    const s = storeFor(sessionId);
    if (s.phase === 'result' && draft !== s.enhanced && draft !== s.backup) {
      s.phase = 'idle';
      s.enhanced = '';
      s.error = null;
      notify(sessionId);
    }
  }, [draft, sessionId]);

  if (!inputActions || sessionId === undefined) return null;
  const s = storeFor(sessionId);
  if (s.error === null) return null;

  const errText = t(errorKey(s.error));
  return React.createElement('div', { className: 'dsh-enh-bar dsh-enh-bar-error', role: 'status' },
    React.createElement('span', null, t('errorPrefix') + errText),
    React.createElement('button', {
      type: 'button',
      className: 'dsh-enh-bar-btn',
      onClick: () => { s.error = null; notify(sessionId); },
    }, t('dismiss')),
  );
}

  return EnhanceBar;
}

module.exports = { createEnhanceBar };
