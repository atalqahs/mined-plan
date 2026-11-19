// Bundles the Electron main process and preload script (CommonJS) into desktop-dist/.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src', import.meta.url));
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], alias: { '@': src }, sourcemap: false, logLevel: 'warning', legalComments: 'none' };
await build({ ...common, entryPoints: ['desktop/main.ts'], outfile: 'desktop-dist/main.cjs' });
await build({ ...common, entryPoints: ['desktop/preload.ts'], outfile: 'desktop-dist/preload.cjs' });
console.log('desktop-dist built');
