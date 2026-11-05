import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyMacApp(appPath) {
  // Check integrity, not Gatekeeper trust: ad-hoc signatures are valid here.
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });
}

export function verifyMacArtifacts(directory, version, arch) {
  if (process.platform !== 'darwin') throw new Error('macOS signature verification requires macOS');
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported macOS architecture');
  const root = path.resolve(directory);
  const appName = 'Route Studio.app';
  const artifactName = `Route-Studio-${version}-mac-${arch}`;
  verifyMacApp(path.join(root, arch === 'arm64' ? 'mac-arm64' : 'mac', appName));

  const temporary = mkdtempSync(path.join(tmpdir(), 'route-studio-signatures-'));
  const mountPoint = path.join(temporary, 'dmg');
  let mounted = false;
  try {
    const extracted = path.join(temporary, 'zip');
    execFileSync('/usr/bin/ditto', ['-x', '-k', path.join(root, `${artifactName}.zip`), extracted]);
    verifyMacApp(path.join(extracted, appName));

    mkdirSync(mountPoint);
    execFileSync('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-noautoopen',
      '-mountpoint',
      mountPoint,
      path.join(root, `${artifactName}.dmg`),
    ]);
    mounted = true;
    verifyMacApp(path.join(mountPoint, appName));
  } finally {
    // If detaching fails, leave the temporary directory intact instead of deleting a mounted tree.
    if (mounted) execFileSync('/usr/bin/hdiutil', ['detach', mountPoint]);
    rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`Verified macOS signatures: ${artifactName} (app, ZIP, DMG)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory = 'release', arch = process.arch] = process.argv.slice(2);
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  verifyMacArtifacts(directory, version, arch);
}
