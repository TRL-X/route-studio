import semver from 'semver';
import type { UpdateRelease } from './update-contracts.js';

export const releaseRepository = 'TRL-X/route-studio';
export const latestReleaseAPI = `https://api.github.com/repos/${releaseRepository}/releases/latest`;

export function manualRelease(
  value: unknown,
  currentVersion: string,
  platform: string,
  arch: string,
): UpdateRelease | null {
  if (!value || typeof value !== 'object') throw new Error('Invalid release');
  const release = value as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string')
    throw new Error('Not a stable release');
  const version = semver.valid(release.tag_name);
  if (!version || semver.prerelease(version) || !semver.valid(currentVersion))
    throw new Error('Invalid version');
  if (!semver.gt(version, currentVersion)) return null;
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported architecture');
  const suffix =
    platform === 'darwin' ? `mac-${arch}.dmg` : platform === 'linux' ? `linux-${arch}.deb` : null;
  if (!suffix || !Array.isArray(release.assets)) throw new Error('Installer unavailable');
  const name = `Route-Studio-${version}-${suffix}`;
  const expectedURL = `https://github.com/${releaseRepository}/releases/download/${encodeURIComponent(release.tag_name)}/${name}`;
  const asset = release.assets.find((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const asset = item as Record<string, unknown>;
    return (
      asset.name === name &&
      asset.browser_download_url === expectedURL &&
      typeof asset.size === 'number' &&
      asset.size > 0
    );
  });
  if (!asset) throw new Error('Matching installer unavailable');
  return {
    version,
    notes: typeof release.body === 'string' ? release.body.slice(0, 20000) : '',
    downloadURL: expectedURL,
  };
}
