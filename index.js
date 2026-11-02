import { homedir } from 'node:os';
import { join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { PowerController } from './controller.js';
import { TYPERT_REMOTE } from './remote.js';
export { TYPERT_REMOTE };
export const name = 'superagent-power';
export const inject = ['typert'];
const initializers = [];
export class SuperagentPowerService extends TypertRemoteService {
  constructor(ctx, controller) {
    super(ctx, 'superagentPower');
    for (const initialize of initializers) initialize.call(this);
    this.controller = controller;
  }
  get() { return this.controller.get(); }
  set(request) { return this.controller.set(request); }
}
for (const name of ['get', 'set']) Remote({ name })(SuperagentPowerService.prototype[name], {
  kind: 'method', name, private: false, static: false, addInitializer(fn) { initializers.push(fn); },
});
export async function apply(ctx, config = {}) {
  const homePath = config.homePath || process.env.DSH_HOME || join(homedir(), '.dsh');
  const controller = new PowerController({ homePath, profileName: 'superagent', port: 3082,
    nodePath: 'C:/Program Files/nodejs/node.exe', cliPath: join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/lib/bin.js'), ...config }, ctx.logger);
  // Register cleanup before initialization so a failed boot releases the mutex.
  ctx.effect(() => () => controller.close(), 'superagent-power: stop worker and release owner');
  await controller.initialize();
  ctx.typert.register({ package: TYPERT_REMOTE.package, face: 'host', schemas: [], invocations: TYPERT_REMOTE.descriptors,
    model: { services: [{ key: 'superagentPower', exportName: 'SuperagentPowerService', tags: [], types: [], members: [
      { kind: 'method', name: 'get', signature: 'get(request: {}): Promise<State>' },
      { kind: 'method', name: 'set', signature: 'set(request: Set): Promise<State>' },
    ] }], events: [], objects: [] } });
  new SuperagentPowerService(ctx, controller);
}
