import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import semver from 'semver';

export async function verifyRelease(directory, version, platform, arch) {
  if (!semver.valid(version)) throw new Error('Invalid release version');
  const prerelease = semver.prerelease(version);
  if (prerelease && prerelease[0] !== 'beta') throw new Error('Unsupported release channel');
  const extensions = { mac: ['dmg', 'zip'], win: ['exe'], linux: ['AppImage', 'deb'] }[platform];
  if (!extensions || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported release target');
  const names = extensions.map((extension) => {
    // electron-builder uses each Linux package format's architecture name.
    const artifactArch =
      platform === 'linux' && arch === 'x64' ? (extension === 'deb' ? 'amd64' : 'x86_64') : arch;
    return `Route-Studio-${version}-${platform}-${artifactArch}.${extension}`;
  });
  for (const name of names) {
    const file = await stat(path.join(directory, name));
    if (!file.isFile() || !file.size) throw new Error(`Empty or missing installer: ${name}`);
  }
  if (platform === 'mac') return;
  const channel = prerelease ? 'beta' : 'latest';
  const manifestName = `${channel}${platform === 'win' ? '' : '-linux'}.yml`;
  const manifest = load(await readFile(path.join(directory, manifestName), 'utf8'));
  if (!manifest || manifest.version !== version || !Array.isArray(manifest.files) || !manifest.files.length)
    throw new Error(`Invalid update manifest: ${manifestName}`);
  const automaticInstaller = names[0];
  if (!manifest.files.some((file) => file.url === automaticInstaller))
    throw new Error(`Missing update target: ${automaticInstaller}`);
  for (const file of manifest.files) {
    if (!file || typeof file.url !== 'string' || !names.includes(file.url))
      throw new Error(`Unexpected file in ${manifestName}`);
    const filename = path.join(directory, file.url);
    const info = await stat(filename);
    if (info.size !== file.size) throw new Error(`Size mismatch: ${file.url}`);
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    if (hash.digest('base64') !== file.sha512) throw new Error(`Checksum mismatch: ${file.url}`);
  }
  if (platform === 'win') {
    const blockmap = await stat(path.join(directory, `${automaticInstaller}.blockmap`));
    if (!blockmap.isFile() || !blockmap.size) throw new Error('Missing NSIS blockmap');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory = 'release', platform, arch] = process.argv.slice(2);
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const targets = platform
    ? [[platform, arch]]
    : [
        ['mac', 'arm64'],
        ['mac', 'x64'],
        ['win', 'x64'],
        ['linux', 'x64'],
      ];
  for (const [platform, arch] of targets) await verifyRelease(directory, version, platform, arch);
  console.log(`Verified release ${version}: ${targets.map((target) => target.join('/')).join(', ')}`);
}
