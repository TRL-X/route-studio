import path from 'node:path';
import { access } from 'node:fs/promises';

const relative =
  process.platform === 'darwin'
    ? `release/mac${process.arch === 'arm64' ? '-arm64' : ''}/Route Studio.app/Contents/MacOS/Route Studio`
    : process.platform === 'win32'
      ? 'release/win-unpacked/Route Studio.exe'
      : 'release/linux-unpacked/route-studio';
const executable = path.resolve(relative);
await access(executable);
process.stdout.write(`DESKTOP_EXECUTABLE=${executable}\n`);
