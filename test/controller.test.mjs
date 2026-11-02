import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { PowerController } from '../controller.js';
import { request } from '../transport.js';
const base = resolve('work/test-runs'); await mkdir(base, { recursive: true });
const logger = { warn() {} };
async function fixture(t) {
  const homePath = await mkdtemp(join(base, 'sa-'));
  const config = { homePath, profileName: 'fixture', port: 48342, nodePath: process.execPath,
    cliPath: fileURLToPath(new URL('./fixture-cli.mjs', import.meta.url)), startTimeoutMs: 5000, stopTimeoutMs: 5000 };
  const controller = new PowerController(config, logger);
  t.after(() => controller.close()); await controller.initialize();
  return { controller, config, homePath };
}
async function settle(controller, phase) {
  await controller.operation;
  assert.equal(controller.snapshot().phase, phase, JSON.stringify(controller.snapshot()));
}
test('off has no worker; simultaneous setters cannot spawn twice; shutdown flushes before exit', async t => {
  const { controller: c, homePath } = await fixture(t);
  assert.equal(c.state.phase, 'off'); assert.equal(c.child, null);
  const revision = c.state.revision;
  const first = c.set({ enabled: true, revision });
  await assert.rejects(c.set({ enabled: true, revision }), /正在切换/);
  await first; await settle(c, 'on');
  const pid = c.state.pid; assert.ok(pid > 0);
  await c.set({ enabled: true, revision: c.state.revision }); await settle(c, 'on');
  assert.equal(c.state.pid, pid);
  await c.set({ enabled: false, revision: c.state.revision }); await settle(c, 'off');
  assert.equal(await readFile(join(homePath, 'graceful-stop'), 'utf8'), 'flushed');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(JSON.parse(await readFile(c.stateFile, 'utf8')).enabled, false);
});
test('busy shutdown needs explicit intent and rejects stale UI commands', async t => {
  const { controller: c, homePath } = await fixture(t);
  await c.set({ enabled: true, revision: c.state.revision }); await settle(c, 'on');
  await writeFile(join(homePath, 'active'), '1'); await c.get();
  await assert.rejects(c.set({ enabled: false, revision: c.state.revision - 1 }), /其他会话/);
  await assert.rejects(c.set({ enabled: false, revision: c.state.revision }), /任务正在运行/);
  assert.equal(JSON.parse(await readFile(c.stateFile, 'utf8')).enabled, true);
  await c.set({ enabled: false, revision: c.state.revision, allowBusy: true }); await settle(c, 'off');
});
test('control pipe rejects unauthenticated stop requests', async t => {
  const { controller: c } = await fixture(t);
  await c.set({ enabled: true, revision: c.state.revision }); await settle(c, 'on');
  await assert.rejects(request(c.pipe, 'f'.repeat(64), 'stop', { allowBusy: true }), { code: 'UNAUTHORIZED' });
  assert.equal((await c.get()).phase, 'on');
});
test('desktop close stops worker and next desktop launch remembers enabled choice', async t => {
  const { controller: c, config } = await fixture(t);
  await c.set({ enabled: true, revision: c.state.revision }); await settle(c, 'on');
  const oldPid = c.state.pid;
  await c.close();
  assert.throws(() => process.kill(oldPid, 0), { code: 'ESRCH' });
  assert.equal(JSON.parse(await readFile(c.stateFile, 'utf8')).enabled, true);
  const next = new PowerController(config, logger); t.after(() => next.close());
  await next.initialize(); await settle(next, 'on'); assert.notEqual(next.state.pid, oldPid);
  await next.set({ enabled: false, revision: next.state.revision }); await settle(next, 'off');
});
test('another controller cannot claim the same global state', async t => {
  const { config, controller: c } = await fixture(t);
  await c.set({ enabled: true, revision: c.state.revision }); await settle(c, 'on');
  const duplicate = new PowerController(config, logger);
  await assert.rejects(duplicate.initialize(), { code: 'EADDRINUSE' });
  await duplicate.close();
  assert.equal((await c.get()).phase, 'on', 'Failed duplicate must not stop the current owner');
});
test('occupied service port blocks startup without killing or replacing its owner', async t => {
  const { controller: c } = await fixture(t);
  const listener = createServer(socket => socket.end());
  await new Promise(resolve => listener.listen(c.config.port, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  await c.set({ enabled: true, revision: c.state.revision }); await settle(c, 'error');
  assert.match(c.state.error, /占用/); assert.equal(c.child, null); assert.equal(listener.listening, true);
});
test('IPC disconnect cleans up a worker instead of orphaning it', async t => {
  const { controller: c, homePath } = await fixture(t);
  await c.set({ enabled: true, revision: c.state.revision }); await settle(c, 'on');
  const child = c.child; child.disconnect();
  await new Promise(resolve => child.once('exit', resolve));
  assert.equal(await readFile(join(homePath, 'graceful-stop'), 'utf8'), 'flushed');
  assert.equal(c.state.phase, 'error');
});
