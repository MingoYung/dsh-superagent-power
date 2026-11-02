import { spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { readFile, writeFile, mkdir, rename, unlink, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pipeName, request, absent } from './transport.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
export async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => {}); }
}
async function portBusy(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = busy => { socket.destroy(); resolve(busy); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(true));
  });
}

export class PowerController {
  constructor(config, logger = console) {
    this.config = config; this.logger = logger;
    this.directory = join(config.homePath, 'plugins', 'superagent-power');
    this.stateFile = join(this.directory, 'state.json');
    this.keyFile = join(this.directory, 'control.key');
    this.pipe = pipeName(config.homePath, config.profileName);
    this.state = { enabled: false, phase: 'off', revision: 0, pid: null, memoryMB: 0, active: 0, configured: false, error: '' };
    this.busy = false; this.closing = false; this.owns = false; this.child = null; this.operation = Promise.resolve();
  }
  snapshot() { return { ...this.state, port: this.config.port }; }
  update(patch) { Object.assign(this.state, patch); this.state.revision++; }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try { await writeFile(this.keyFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    this.token = (await readFile(this.keyFile, 'utf8')).trim();
    if (this.token.length !== 64) throw new Error('Super-agent 控制密钥无效');
    this.owner = createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => {
      this.owner.once('error', reject);
      this.owner.listen(pipeName(this.config.homePath, this.config.profileName, 'owner'), () => { this.owner.removeListener('error', reject); resolve(); });
    });
    this.owns = true;
    this.owner.on('error', error => this.logger.warn(String(error)));
    let saved;
    try {
      saved = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (saved.version !== 1 || typeof saved.enabled !== 'boolean') throw new Error('Super-agent 开关文件格式无效');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const live = await this.probe();
    this.state.enabled = saved?.enabled ?? Boolean(live);
    if (!saved) await this.persist(this.state.enabled);
    if (live) this.adopt(live);
    if (this.state.enabled && !live) this.begin(() => this.start(), 'starting');
    if (!this.state.enabled && live) {
      // Preserve running work on first adoption; explicit UI stop is required.
      this.update({ error: '检测到已运行的 Super-agent；点击关闭可停止它。' });
    }
    return this.snapshot();
  }
  persist(enabled) { return atomicJson(this.stateFile, { version: 1, enabled }); }
  async probe() {
    try { return await request(this.pipe, this.token); }
    catch (error) { if (absent(error)) return null; throw error; }
  }
  adopt(live) {
    const phase = live.stopping ? 'stopping' : 'on';
    const changed = this.state.phase !== phase || this.state.pid !== live.pid || this.state.active !== live.active;
    Object.assign(this.state, { phase, pid: live.pid, memoryMB: live.memoryMB, active: live.active, configured: live.configured });
    if (changed) this.state.revision++;
  }
  async get() {
    if (this.closing || this.busy) return this.snapshot();
    try {
      const live = await this.probe();
      if (this.busy || this.closing) return this.snapshot();
      if (live) this.adopt(live);
      else if (processAlive(this.state.pid)) this.update({ phase: 'error', error: '后台进程仍在，但控制接口已断开；未将它误报为关闭。' });
      else if (this.state.pid || this.state.phase === 'on') this.update({ phase: this.state.enabled ? 'error' : 'off', pid: null, active: 0, memoryMB: 0, error: this.state.enabled ? 'Super-agent 已退出，点击重试可重新启动。' : '' });
    } catch (error) { this.update({ phase: 'error', error: error.message }); }
    return this.snapshot();
  }
  begin(run, phase) {
    this.busy = true; this.update({ phase, error: '' });
    this.operation = Promise.resolve().then(run).catch(error => {
      this.update({ phase: 'error', error: error.message });
      this.logger.warn(`superagent-power: ${error.message}`);
    }).finally(() => { this.busy = false; });
  }
  async set({ enabled, revision, allowBusy = false }) {
    if (this.closing) throw new Error('DSH 正在关闭');
    if (typeof enabled !== 'boolean') throw new TypeError('enabled 必须为布尔值');
    if (this.busy) throw new Error('正在切换全局状态，请稍后再试。');
    if (revision !== this.state.revision) throw new Error('其他会话已更新状态，请刷新后重试。');
    this.busy = true;
    try {
      const live = await this.probe();
      if (!enabled && live?.active > 0 && !allowBusy) {
        this.adopt(live);
        throw new Error('任务正在运行，请确认中断当前任务再关闭。');
      }
      // A durable command is recorded before any process state changes.
      await this.persist(enabled);
      this.state.enabled = enabled;
      this.begin(() => enabled ? this.start() : this.stop(allowBusy), enabled ? 'starting' : 'stopping');
      return this.snapshot();
    } catch (error) { this.busy = false; throw error; }
  }
  async start() {
    const existing = await this.probe();
    if (existing) { if (existing.stopping) throw new Error('上一个 Super-agent 正在退出，请稍后重试。'); this.adopt(existing); return; }
    if (this.child && this.child.exitCode === null) throw new Error('后台进程仍在启动或无响应，未重复启动。');
    if (await portBusy(this.config.port)) throw new Error(`端口 ${this.config.port} 被其他进程占用，未启动第二个 Super-agent。`);
    const logPath = join(this.directory, 'worker.log');
    const log = await open(logPath, 'w');
    const env = { ...process.env, DSH_HOME: this.config.homePath, DSH_SUPERAGENT_MANAGED: '1' };
    delete env.NODE_CHANNEL_FD; delete env.NODE_UNIQUE_ID; delete env.ELECTRON_RUN_AS_NODE;
    if (this.config.proxy) { env.HTTP_PROXY = this.config.proxy; env.HTTPS_PROXY = this.config.proxy; }
    let child;
    try {
      child = spawn(this.config.nodePath, [this.config.cliPath, '--profile', this.config.profileName, '--no-open'], {
        cwd: this.config.cwd || this.config.homePath, windowsHide: true, detached: false,
        stdio: ['ignore', log.fd, log.fd, 'ipc'], env,
      });
    } finally { await log.close(); }
    this.child = child;
    let launchError = null;
    child.on('error', error => { launchError = error; });
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null;
        if (!this.busy && !this.closing) this.update({ phase: this.state.enabled ? 'error' : 'off', pid: null, active: 0, memoryMB: 0,
          error: this.state.enabled ? `Super-agent 已退出（${code ?? signal}），点击重试。` : '' });
      }
    });
    this.update({ pid: child.pid || null });
    const deadline = Date.now() + (this.config.startTimeoutMs || 60000);
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode) throw new Error('Super-agent 启动失败，请查看开关插件的 worker.log。');
      const live = await this.probe();
      if (live) { this.adopt(live); return; }
      await delay(250);
    }
    throw new Error('启动超过 60 秒；未重复启动。请查看 worker.log，或点击关闭。');
  }
  async stop(allowBusy) {
    const live = await this.probe();
    if (live) {
      this.update({ pid: live.pid });
      await request(this.pipe, this.token, 'stop', { allowBusy });
      const deadline = Date.now() + (this.config.stopTimeoutMs || 60000);
      while (Date.now() < deadline) {
        let alive = true;
        try { process.kill(live.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
        if (!alive) break;
        await delay(200);
      }
      try { process.kill(live.pid, 0); throw new Error('Super-agent 尚未退出，未将它误报为关闭。稍后可再次关闭。'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    } else if (this.child && this.child.exitCode === null) {
      // Closing IPC asks the bridge to tear down once startup reaches it.
      // Never use taskkill /F or terminate unrelated node processes.
      if (this.child.connected) this.child.disconnect();
      throw new Error('后台进程尚未提供控制接口，已断开托管连接；请等待退出后重试。');
    } else if (processAlive(this.state.pid)) {
      throw new Error('后台进程仍在，但控制接口不可用；未强制结束进程，也未标记为关闭。');
    }
    this.update({ phase: 'off', pid: null, memoryMB: 0, active: 0, configured: false, error: '' });
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    if (!this.owns) return;
    try { await this.operation; await this.stop(true); }
    finally {
      if (this.child?.connected) this.child.disconnect();
      if (this.owner?.listening) await new Promise(resolve => this.owner.close(resolve));
    }
  }
}
