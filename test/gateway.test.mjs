import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import * as plugin from '../lib/index.js';
const require = createRequire(new URL('../package.json', import.meta.url));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { Context, Service } = await load('@deepseek-ai/cordis');
const { HostConnectionService } = await load('@deepseek-ai/dsh-client-connection');
const clientGateway = await load('@deepseek-ai/dsh-api-gateway/client');
const Gateway = await load('@deepseek-ai/dsh-api-gateway');
const RemoteAccess = await load('@deepseek-ai/dsh-api-remote-access');
const Typert = await load('@deepseek-ai/dsh-typert-registry');

test('native Gateway validates global methods and denies an unprivileged peer', async t => {
  const base = resolve('work/test-runs'); await mkdir(base, { recursive: true });
  const homePath = await mkdtemp(join(base, 'gateway-'));
  const host = new Context(); t.after(() => host.fiber.dispose());
  await host.plugin(Typert.default || Typert);
  await host.plugin(RemoteAccess.default || RemoteAccess);
  await host.plugin({ name: 'connection-fixture', apply(ctx) { new HostConnectionService(ctx, ['localhost'], {}); } });
  await host.plugin(Gateway.default || Gateway);
  await host.plugin(plugin, { homePath, profileName: 'fixture', port: 48343, nodePath: process.execPath,
    cliPath: fileURLToPath(new URL('./fixture-cli.mjs', import.meta.url)) });
  const owner = host.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' });
  let peer = owner;
  const handler = host.connection.createSharedFetchHandler('/api');
  let serial = 0;
  const client = new Context(); t.after(() => client.fiber.dispose());
  await client.plugin(Typert.default || Typert);
  await client.plugin({ name: 'carrier-fixture', apply(ctx) {
    class Carrier extends Service {
      constructor(c) { super(c, 'connection'); this.interactions = 'none'; this.isLoopback = true;
        this.rpc = { open() { throw new Error('unary only'); }, async call(channel, endpoint, payload, signal) {
          const response = await handler.fetch(new Request(`http://localhost${channel}/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId: `sa-${++serial}`, method: endpoint, payload }), signal }), peer);
          return (await response.json()).result;
        } };
      }
    } new Carrier(ctx);
  } });
  await client.plugin(clientGateway.default || clientGateway);
  await client.remote.$mount(plugin.TYPERT_REMOTE);
  const before = await client.remote.superagentPower.get({});
  assert.equal(before.ok, true, JSON.stringify(before)); assert.equal(before.value.phase, 'off');
  const invalid = await client.remote.superagentPower.set({ enabled: 'true', revision: 0 });
  assert.equal(invalid.ok, false); assert.equal(invalid.error.code, 'gateway/input-invalid');
  const enabled = await client.remote.superagentPower.set({ enabled: true, revision: before.value.revision });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  await host.superagentPower.controller.operation;
  assert.equal((await client.remote.superagentPower.get({})).value.phase, 'on');
  peer = host.connection.createPeer({ principal: { kind: 'untrusted-fixture', id: 'guest' }, interactions: 'none' });
  const denied = await client.remote.superagentPower.set({ enabled: false, revision: host.superagentPower.controller.state.revision });
  assert.equal(denied.ok, false); assert.equal(denied.error.code, 'remote-access/denied');
  await peer.dispose(); peer = owner;
  const state = await client.remote.superagentPower.get({});
  const stopped = await client.remote.superagentPower.set({ enabled: false, revision: state.value.revision });
  assert.equal(stopped.ok, true); await host.superagentPower.controller.operation;
  assert.equal((await client.remote.superagentPower.get({})).value.phase, 'off');
  await owner.dispose();
});
