import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

await rm('dist-electron', { recursive: true, force: true });
const require = createRequire(import.meta.url);
const compiler = path.resolve(
  path.dirname(require.resolve('typescript/package.json')),
  require('typescript/package.json').bin.tsc,
);
const result = spawnSync(process.execPath, [compiler, '-p', 'electron/tsconfig.json'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
