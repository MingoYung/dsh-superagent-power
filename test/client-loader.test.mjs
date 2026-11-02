import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
test('browser bundle loads using only the React platform seeds', () => {
  let exported;
  const sandbox = { window: { __ModuleLoader__: { load({ id, factory }) {
    assert.equal(id, '@local/superagent-power');
    exported = factory(name => {
      assert.ok(['react', 'react-dom'].includes(name), `Unmaterialized frontend dependency: ${name}`);
      return require(name);
    });
  } } } };
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox);
  assert.equal(typeof exported.apply, 'function'); assert.equal(typeof exported.PowerButton, 'function');
});
