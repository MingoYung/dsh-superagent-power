import { apply } from '../bridge.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.DSH_HOME;
const disposers = [];
const runtime = { ready: Promise.resolve(), masterId: 'fixture-master', configured: () => true,
  executor: { activeCount() { try { return Number(readFileSync(join(home, 'active'), 'utf8')); } catch { return 0; } } },
  async stop() { await new Promise(resolve => setTimeout(resolve, 75)); writeFileSync(join(home, 'graceful-stop'), 'flushed'); },
};
await apply({ orchestrator: runtime, agents: { get() { return { status: 'idle' }; } },
  appExit() { void (async () => { for (const dispose of disposers.reverse()) await dispose(); process.exit(0); })(); },
  logger: console, effect(factory) { disposers.push(factory()); },
}, { homePath: home, profileName: process.argv[process.argv.indexOf('--profile') + 1], keyFile: join(home, 'plugins/superagent-power/control.key') });
