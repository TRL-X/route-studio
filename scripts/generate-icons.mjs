// Use the same SVG artwork for the toolbar, favicon, and desktop icon formats.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIconsTool } from 'app-builder-lib/out/toolsets/icons.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const logo = await readFile(path.join(root, 'src/assets/logo.svg'), 'utf8');
// Center the wide mark without stretching it. The opaque plate keeps app icons
// legible against both light and dark browser chrome, desktops, and docks.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="64" y="64" width="896" height="896" rx="192" fill="#25272b" />
  ${logo.replace(/<svg\b[^>]*>/, '<svg x="126" y="364" width="772" height="296" viewBox="0 0 821 315" fill="none">')}
</svg>
`;
const iconPath = path.join(root, 'build/icon.svg');
const output = path.join(root, 'build/icons');
await mkdir(output, { recursive: true });
await mkdir(path.join(root, 'public'), { recursive: true });
await writeFile(iconPath, icon);
await writeFile(path.join(root, 'public/favicon.svg'), icon);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'route-studio-icons-'));
try {
  // Reuse the SVG rasterizer shipped with the pinned electron-builder toolchain.
  await runIconsTool({ inputFile: iconPath, outputFormat: 'set', outDir: temporary });
  await copyFile(path.join(temporary, '512x512.png'), path.join(output, 'icon.png'));
  await runIconsTool({ inputFile: iconPath, outputFormat: 'ico', outDir: output });
  await runIconsTool({ inputFile: iconPath, outputFormat: 'icns', outDir: output });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
