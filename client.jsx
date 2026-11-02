import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { TYPERT_REMOTE } from './remote.js';
export const name = 'superagent-power-client';
export const inject = ['slots', 'remote'];

const CSS = `
.dsh-sa-btn{display:inline-flex;align-items:center;gap:5px;flex:none;box-sizing:border-box;height:26px;padding:2px 8px;border:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
.dsh-sa-btn:hover,.dsh-sa-btn[aria-expanded=true]{background:rgba(128,128,128,.14)}
.dsh-sa-dot{width:6px;height:6px;border-radius:50%;background:#8b9199;flex:none}
.dsh-sa-btn[data-phase=on] .dsh-sa-dot{background:#50c9a5;box-shadow:0 0 6px #50c9a544}
.dsh-sa-btn[data-phase=starting] .dsh-sa-dot,.dsh-sa-btn[data-phase=stopping] .dsh-sa-dot{background:#d4a45c;animation:dsh-sa-pulse 1.2s ease-in-out infinite}
.dsh-sa-btn[data-phase=error] .dsh-sa-dot{background:#de7869}
@keyframes dsh-sa-pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.dsh-sa-dot{animation:none!important}}
.dsh-sa-panel{position:fixed;z-index:2147483000;box-sizing:border-box;width:300px;max-width:calc(100vw - 24px);padding:16px;border:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:14px;background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#222);box-shadow:0 8px 32px #0003;font:13px/1.5 inherit;font-family:inherit;font-size:13px;line-height:1.5}
body[data-ds-dark-theme] .dsh-sa-panel{background:var(--dsw-static-neutral-850,#252525);color:var(--dsw-alias-label-primary,#eee)}
.dsh-sa-head,.dsh-sa-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-sa-head{font-size:14px;font-weight:600;margin-bottom:4px}
.dsh-sa-badge{font-size:10px;font-weight:400;padding:1px 5px;margin-left:8px;border-radius:4px;background:#80808020;color:var(--dsw-alias-label-tertiary,#999)}
.dsh-sa-close{background:none;border:0;color:inherit;cursor:pointer;font:20px/1 inherit;padding:0 3px}
.dsh-sa-help{color:var(--dsw-alias-label-tertiary,#898b91);font-size:12px;margin:0 0 15px}
.dsh-sa-row{padding:12px 0;border-top:.5px solid #80808028;border-bottom:.5px solid #80808028}
.dsh-sa-control{border:0;border-radius:7px;padding:6px 14px;background:#259b85;color:#fff;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dsh-sa-control[data-on=true]{background:#80808022;color:inherit}
.dsh-sa-control:disabled{opacity:.5;cursor:default}
.dsh-sa-details{font-size:12px;margin:10px 0 0;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-sa-error{font-size:12px;color:#d57464;margin:10px 0 0;overflow-wrap:anywhere}
.dsh-sa-link{display:inline-block;margin-top:12px;color:#3cbda3;text-decoration:none;font-size:12px}
.dsh-sa-btn:focus-visible,.dsh-sa-panel button:focus-visible,.dsh-sa-link:focus-visible{outline:2px solid #38a9b2;outline-offset:3px}
@media(max-width:1400px){.dsh-sa-btn{padding:2px 6px;gap:4px}.dsh-sa-word{display:none}}
`;
const names = { off: '已关闭', on: '已开启', starting: '启动中…', stopping: '关闭中…', error: '异常' };
const compact = { off: '关', on: '开', starting: '启动', stopping: '关闭', error: '异常' };
function unwrap(response) {
  if (response?.ok === false) throw new Error(response.error?.message || '无法连接全局开关');
  const state = response?.ok === true ? response.value : response;
  if (!state || !(state.phase in names)) throw new Error('全局开关返回了无效状态');
  return state;
}
// One store per renderer; session switches never create independent preferences.
export function createStore(remote) {
  let value = { state: null, error: '', saving: false }, epoch = 0, timer, running = false, closed = false;
  const listeners = new Set();
  const publish = patch => { value = { ...value, ...patch }; for (const listener of listeners) listener(); };
  const refresh = async () => {
    if (closed || running || value.saving || !listeners.size || document.hidden) return;
    running = true; const generation = epoch;
    try {
      const state = unwrap(await remote.get({}));
      if (!closed && generation === epoch) publish({ state });
    } catch (error) { if (!closed && generation === epoch) publish({ error: error.message }); }
    finally { running = false; }
  };
  const tick = () => {
    clearTimeout(timer);
    if (!listeners.size || closed) return;
    void refresh().finally(() => {
      if (listeners.size && !closed) timer = setTimeout(tick, ['starting', 'stopping'].includes(value.state?.phase) ? 600 : 5000);
    });
  };
  const focus = () => { tick(); };
  const store = {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) { window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); tick(); }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { clearTimeout(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); }
      };
    },
    async set(enabled, allowBusy) {
      if (!value.state || value.saving) return;
      epoch++; publish({ saving: true, error: '' });
      try { publish({ state: unwrap(await remote.set({ enabled, revision: value.state.revision, allowBusy })) }); }
      catch (error) { publish({ error: error.message }); }
      finally { publish({ saving: false }); tick(); }
    },
    refresh,
    close() { closed = true; clearTimeout(timer); listeners.clear(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); },
  };
  return store;
}
export function PowerButton({ store }) {
  const { state, error, saving } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [open, setOpen] = useState(false), [armed, setArmed] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, visibility: 'hidden' });
  const button = useRef(null), panel = useRef(null);
  const busy = saving || ['starting', 'stopping'].includes(state?.phase);
  const isOn = Boolean(state?.pid);
  useEffect(() => { setArmed(false); }, [state?.phase, open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current?.getBoundingClientRect(), height = panel.current?.offsetHeight || 220;
      if (!rect) return;
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 312)),
        top: Math.max(12, rect.top >= height + 20 ? rect.top - height - 8 : Math.min(rect.bottom + 8, window.innerHeight - height - 12)), visibility: 'visible' });
    };
    const outside = event => { if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); } };
    place(); const observer = new ResizeObserver(place); observer.observe(panel.current);
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  async function toggle() {
    if (isOn && state.active > 0 && !armed) { setArmed(true); return; }
    await store.set(!isOn, armed); setArmed(false);
  }
  const info = error || state?.error;
  return <>
    <button ref={button} type="button" className="dsh-sa-btn" data-phase={state?.phase}
      aria-label={`Super-agent 全局：${state ? names[state.phase] : '连接中'}`} aria-haspopup="dialog" aria-expanded={open}
      title={`Super-agent 全局开关 · ${state ? names[state.phase] : '连接中'} · 所有会话共用`}
      onClick={() => { setOpen(!open); void store.refresh(); }}><span className="dsh-sa-dot" aria-hidden="true"/>Sup<span className="dsh-sa-word">{state ? compact[state.phase] : '…'}</span></button>
    {open && createPortal(<section ref={panel} role="dialog" aria-label="Super-agent 全局开关" className="dsh-sa-panel" style={position} onKeyDown={e => { if (e.key === 'Enter') e.stopPropagation(); }}>
      <div className="dsh-sa-head"><span>Super-agent<span className="dsh-sa-badge">全局</span></span><button type="button" className="dsh-sa-close" aria-label="关闭全局开关面板" onClick={() => { setOpen(false); button.current?.focus(); }}>×</button></div>
      <p className="dsh-sa-help">所有会话共用同一个开关</p>
      <div className="dsh-sa-row"><span aria-live="polite">{state ? names[state.phase] : '正在读取…'}</span>
        <button type="button" className="dsh-sa-control" data-on={isOn} disabled={!state || busy} onClick={() => void toggle()}>{busy ? '请稍候…' : armed ? '中断任务并关闭' : isOn ? '关闭' : state?.phase === 'error' ? '重试开启' : '开启'}</button></div>
      <p className="dsh-sa-details">{isOn ? `后台约 ${state.memoryMB} MB · 运行中 ${state.active} 个任务` : state?.phase === 'off' ? '后台进程已退出，不再占用该进程的内存。' : '正在确认后台进程状态…'}</p>
      {state?.phase === 'on' && !state.configured && <p className="dsh-sa-details">服务已启动，业务配置仍需在管理页完成。</p>}
      <p className="dsh-sa-help" style={{ margin: '10px 0 0' }}>关闭会停止监听与后台任务，保留配置和记录。下次启动 DSH 沿用此开关。</p>
      {armed && <p role="alert" className="dsh-sa-error">正在运行的任务会被中断；记录将保留。再次点击确认关闭。</p>}
      {info && <p role="alert" className="dsh-sa-error">{info}</p>}
      {state?.phase === 'on' && <a className="dsh-sa-link" href={`http://127.0.0.1:${state.port}/`} target="_blank" rel="noreferrer">打开后台 · 侧栏 Super-agent ↗</a>}
    </section>, document.body)}
  </>;
}
export async function apply(ctx) {
  await ctx.remote.$mount(TYPERT_REMOTE);
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.pluginCss = 'superagent-power'; style.textContent = CSS; document.head.appendChild(style); return () => style.remove(); });
  ctx.inject(['remote.superagentPower'], child => {
    const store = createStore(child.remote.superagentPower);
    child.effect(() => () => store.close());
    child.slots.inject('conversation.input.left', () => child.slots.register({ name: 'conversation.input.left', id: 'local-superagent-power', order: 71, inject: () => ({ store }) }, PowerButton));
  });
}
export default { name, inject, apply };
