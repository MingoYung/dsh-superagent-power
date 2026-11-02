// This companion runs INSIDE the existing Super-agent process; no helper daemon.
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { pipeName, sameToken } from './transport.js';

export const name = 'superagent-power-bridge';
export const inject = ['orchestrator', 'agents', 'appExit'];

export async function apply(ctx, config) {
  const runtime = ctx.orchestrator;
  await runtime.ready;
  const token = readFileSync(config.keyFile, 'utf8').trim();
  if (token.length < 32) throw new Error('Super-agent control key is invalid');
  const pipe = pipeName(config.homePath, config.profileName || 'superagent');
  let stopping = false;
  const sockets = new Set();
  function snapshot() {
    const master = ctx.agents.get(runtime.masterId);
    const active = runtime.executor.activeCount() + (master && master.status !== 'idle' ? 1 : 0);
    return { pid: process.pid, memoryMB: Math.round(process.memoryUsage().rss / 1048576), active,
      configured: runtime.configured(), stopping, profile: config.profileName || 'superagent' };
  }
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    try {
      // Stop admission, cancel owned agents, drain effects, stop jobs/subagents,
      // flush sessions, close SQLite, release the official directory lock.
      await runtime.stop();
    } catch (error) {
      ctx.logger.error('Super-agent cleanup failed: %s', String(error));
    } finally {
      // The CLI's native bounded teardown closes the remaining profile services.
      ctx.appExit(0);
      if (process.connected) process.disconnect();
    }
  }
  const server = createServer(socket => {
    sockets.add(socket); socket.setTimeout(3000, () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let text = '', handled = false;
    socket.on('data', data => {
      if (handled) return;
      text += data;
      if (text.length > 4096) { handled = true; socket.destroy(); return; }
      const end = text.indexOf('\n');
      if (end < 0) return;
      handled = true;
      const send = value => socket.end(JSON.stringify(value) + '\n');
      try {
        const message = JSON.parse(text.slice(0, end));
        if (!sameToken(message.token, token)) return send({ ok: false, code: 'UNAUTHORIZED', error: '控制认证失败' });
        if (message.command === 'status') return send({ ok: true, value: snapshot() });
        if (message.command !== 'stop') return send({ ok: false, error: '未知控制请求' });
        const state = snapshot();
        if (state.active > 0 && message.allowBusy !== true) return send({ ok: false, code: 'BUSY', error: '任务正在运行，请先确认中断当前任务再关闭。' });
        send({ ok: true, value: { ...state, stopping: true } });
        void shutdown();
      } catch { send({ ok: false, error: '无效控制请求' }); }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => { server.removeListener('error', reject); resolve(); });
  });
  server.on('error', error => ctx.logger.warn('Super-agent control: %s', String(error)));
  // Managed launches have IPC. A crashed/closed Desktop cannot orphan a worker.
  const disconnected = () => { void shutdown(); };
  if (process.connected) process.on('disconnect', disconnected);
  ctx.effect(() => () => {
    process.removeListener('disconnect', disconnected);
    for (const socket of sockets) socket.destroy();
    return new Promise(resolve => server.close(resolve));
  }, 'superagent-power: close control pipe');
  if (process.env.DSH_SUPERAGENT_MANAGED === '1' && !process.connected) void shutdown();
}
