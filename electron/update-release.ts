import semver from 'semver';
import type { BuildInfo, UpdateChannel, UpdateRelease } from './update-contracts.js';

export const releaseRepository = 'TRL-X/route-studio';
export const latestReleaseAPI = `https://api.github.com/repos/${releaseRepository}/releases/latest`;
export const releasesAPI = `https://api.github.com/repos/${releaseRepository}/releases?per_page=100`;
export const stableReleaseURL = `https://github.com/${releaseRepository}/releases/latest`;

export function acceptsVersion(version: string, channel: UpdateChannel) {
  if (!semver.valid(version)) return false;
  const prerelease = semver.prerelease(version);
  return !prerelease || (channel === 'beta' && prerelease[0] === 'beta');
}

export function parseBuildInfo(value: unknown): BuildInfo | undefined {
  if (!value || typeof value !== 'object') return;
  const { commit, builtAt } = value as Record<string, unknown>;
  if (
    typeof commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    typeof builtAt !== 'string' ||
    !Number.isFinite(Date.parse(builtAt))
  )
    return;
  return { commit, builtAt: new Date(builtAt).toISOString() };
}

export function releaseBuildInfo(notes: string) {
  return parseBuildInfo({
    commit: /^Build commit: ([a-f0-9]{40})$/m.exec(notes)?.[1],
    builtAt: /^Build time: (\S+)$/m.exec(notes)?.[1],
  });
}

function releaseVersion(value: unknown, channel: UpdateChannel) {
  if (!value || typeof value !== 'object') return null;
  const release = value as Record<string, unknown>;
  if (release.draft !== false || typeof release.tag_name !== 'string') return null;
  const version = semver.valid(release.tag_name);
  if (!version || !acceptsVersion(version, channel) || release.prerelease !== !!semver.prerelease(version))
    return null;
  return version;
}

function selectPublishedRelease(values: unknown[], channel: UpdateChannel) {
  const releases = values
    .flatMap((value) => {
      const version = releaseVersion(value, channel);
      return version ? [{ value, version }] : [];
    })
    .sort((a, b) => semver.rcompare(a.version, b.version));
  return releases[0];
}

export function selectManualRelease(
  values: unknown[],
  currentVersion: string,
  platform: string,
  arch: string,
  channel: UpdateChannel,
) {
  const release = selectPublishedRelease(values, channel);
  return release ? manualRelease(release.value, currentVersion, platform, arch, channel) : null;
}

function releaseAsset(value: Record<string, unknown>, name: string) {
  const baseURL = `https://github.com/${releaseRepository}/releases/download/${encodeURIComponent(value.tag_name as string)}/`;
  const url = `${baseURL}${name}`;
  if (
    !Array.isArray(value.assets) ||
    !value.assets.some((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const asset = item as Record<string, unknown>;
      return (
        asset.name === name &&
        asset.browser_download_url === url &&
        typeof asset.size === 'number' &&
        asset.size > 0
      );
    })
  )
    throw new Error('Matching release asset unavailable');
  return { url, baseURL };
}

export function automaticReleaseFeed(values: unknown[], currentVersion: string, platform: string) {
  if (!semver.valid(currentVersion) || !['win32', 'linux'].includes(platform))
    throw new Error('Invalid update target');
  const release = selectPublishedRelease(values, 'beta');
  if (!release || !semver.gt(release.version, currentVersion)) return null;
  const channel = semver.prerelease(release.version) ? 'beta' : 'latest';
  const value = release.value as Record<string, unknown>;
  const { baseURL } = releaseAsset(value, `${channel}${platform === 'linux' ? '-linux' : ''}.yml`);
  return { version: release.version, url: baseURL, channel };
}

export function manualRelease(
  value: unknown,
  currentVersion: string,
  platform: string,
  arch: string,
  channel: UpdateChannel = 'stable',
): UpdateRelease | null {
  if (!value || typeof value !== 'object') throw new Error('Invalid release');
  const release = value as Record<string, unknown>;
  const version = releaseVersion(value, channel);
  if (!version || !semver.valid(currentVersion)) throw new Error('Invalid version');
  if (!semver.gt(version, currentVersion)) return null;
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported architecture');
  const suffix =
    platform === 'darwin'
      ? `mac-${arch}.dmg`
      : platform === 'linux'
        ? `linux-${arch === 'x64' ? 'amd64' : arch}.deb`
        : null;
  if (!suffix) throw new Error('Installer unavailable');
  const name = `Route-Studio-${version}-${suffix}`;
  const { url } = releaseAsset(release, name);
  const notes = typeof release.body === 'string' ? release.body.slice(0, 20000) : '';
  return {
    version,
    notes,
    build: releaseBuildInfo(notes),
    downloadURL: url,
  };
}
