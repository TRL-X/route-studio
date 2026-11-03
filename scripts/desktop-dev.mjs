import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const compiled = spawnSync(npm, ['run', 'desktop:compile'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (compiled.status !== 0) process.exit(compiled.status ?? 1);

const server = await createServer({ server: { host: '127.0.0.1', port: 5173 } });
await server.listen();
const address = server.httpServer.address();
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${address.port}/` };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => void stop(code ?? 0));
child.on('error', (error) => {
  console.error(error);
  void stop(1);
});
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
