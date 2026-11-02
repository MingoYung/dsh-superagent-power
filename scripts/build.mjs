import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'lib'), { recursive: true });
const common = { absWorkingDir: root, bundle: true, logLevel: 'info' };
await build({ ...common, entryPoints: ['index.js'], outfile: 'lib/index.js',
  format: 'esm', platform: 'node', target: 'node24', external: ['@deepseek-ai/*'] });
await build({ ...common, entryPoints: ['client.jsx'], outfile: 'lib/client.js',
  format: 'cjs', platform: 'browser', target: 'chrome120', minify: true,
  // The browser loader supplies only React platform seeds. Bundle remote-info.
  external: ['react', 'react-dom'],
  banner: { js: 'window.__ModuleLoader__.load({id:"@local/superagent-power",factory:function(require){var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' } });
