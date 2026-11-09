import { app, net, shell } from 'electron';
import { constants } from 'node:fs';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
  acceptsVersion,
  automaticReleaseFeed,
  latestReleaseAPI,
  manualRelease,
  parseBuildInfo,
  releaseBuildInfo,
  releaseRepository,
  releasesAPI,
  selectManualRelease,
  stableReleaseURL,
} from './update-release.js';
import { UpdateService, type UpdateBackend } from './update-service.js';
import type { UpdateMode, UpdatePreferences, UpdateState } from './update-contracts.js';

export async function createUpdates(options: {
  publish: (state: UpdateState) => void;
  canInstall: (discard: boolean) => 'busy' | 'unsaved' | null;
  setInstalling: (installing: boolean) => void;
}) {
  const preferencesPath = path.join(app.getPath('userData'), 'updates.json');
  const preferences: UpdatePreferences = { autoCheck: true, channel: 'stable' };
  try {
    const value = JSON.parse(await readFile(preferencesPath, 'utf8'));
    if (typeof value.autoCheck === 'boolean') preferences.autoCheck = value.autoCheck;
    if (value.channel === 'stable' || value.channel === 'beta') preferences.channel = value.channel;
    if (typeof value.lastChecked === 'number' && Number.isFinite(value.lastChecked) && value.lastChecked > 0)
      preferences.lastChecked = value.lastChecked;
  } catch {
    // Missing or damaged preferences must not prevent the editor from opening.
  }
  let currentBuild;
  try {
    currentBuild = parseBuildInfo(
      JSON.parse(await readFile(path.join(app.getAppPath(), 'package.json'), 'utf8')).buildInfo,
    );
  } catch {
    // Local and older builds may not contain provenance metadata.
  }
  let mode: UpdateMode =
    !app.isPackaged || app.commandLine.hasSwitch('disable-updates')
      ? 'disabled'
      : process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)
        ? 'automatic'
        : ['darwin', 'linux'].includes(process.platform)
          ? 'manual'
          : 'disabled';
  let backend: UpdateBackend = { check: async () => null };
  let service: UpdateService;
  const fetchRelease = async (url: string) => {
    const response = await net.fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (response.status === 404 && url === latestReleaseAPI) return null;
    if (!response.ok) throw new Error('Release feed unavailable');
    const body = await response.text();
    if (body.length > (url === releasesAPI ? 5 : 1) * 1024 * 1024) throw new Error('Release feed too large');
    return JSON.parse(body) as unknown;
  };
  const previewReleases = async () => {
    // Query stable separately: frequent previews can push it out of the releases list.
    const [releases, stable] = await Promise.all([fetchRelease(releasesAPI), fetchRelease(latestReleaseAPI)]);
    if (!Array.isArray(releases)) throw new Error('Invalid release feed');
    return [...releases, stable];
  };
  if (mode === 'manual') {
    backend = {
      check: async (channel) => {
        const arch =
          process.platform === 'darwin' && app.runningUnderARM64Translation ? 'arm64' : process.arch;
        if (channel === 'stable') {
          const release = await fetchRelease(latestReleaseAPI);
          return release ? manualRelease(release, app.getVersion(), process.platform, arch) : null;
        }
        return selectManualRelease(
          await previewReleases(),
          app.getVersion(),
          process.platform,
          arch,
          channel,
        );
      },
      open: async (release) => {
        if (!release.downloadURL) throw new Error('Installer unavailable');
        await shell.openExternal(release.downloadURL);
      },
    };
  } else if (mode === 'automatic') {
    try {
      await access(path.join(process.resourcesPath, 'app-update.yml'));
      // Do not instantiate MacUpdater: unsigned macOS builds only query release metadata.
      const { NsisUpdater, AppImageUpdater } = await import('electron-updater');
      const updater = process.platform === 'win32' ? new NsisUpdater() : new AppImageUpdater();
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      updater.logger = null;
      updater.on('error', () => {
        // Check/download errors also reject their promises. Install errors can arrive later.
        if (service?.snapshot().status === 'installing') {
          options.setInstalling(false);
          service.failInstall();
        }
      });
      backend = {
        check: async (channel) => {
          let expectedVersion: string | undefined;
          if (channel === 'beta') {
            // GitHubProvider picks by publication order. Pin the greatest eligible version so a
            // later-published stable release cannot hide an existing, newer mainline preview.
            const feed = automaticReleaseFeed(await previewReleases(), app.getVersion(), process.platform);
            if (!feed) return null;
            expectedVersion = feed.version;
            updater.setFeedURL({
              provider: 'generic',
              url: feed.url,
              channel: feed.channel,
              useMultipleRangeRequest: false,
            });
            updater.channel = feed.channel;
          } else {
            const [owner, repo] = releaseRepository.split('/');
            updater.setFeedURL({ provider: 'github', owner, repo });
            updater.channel = 'latest';
          }
          updater.allowPrerelease = channel === 'beta';
          // The channel setter enables downgrades. Switching back only accepts a newer stable build.
          updater.allowDowngrade = false;
          const result = await updater.checkForUpdates();
          if (!result) throw new Error('Update check unavailable');
          const info = result.updateInfo;
          if (!acceptsVersion(info.version, channel) || (expectedVersion && info.version !== expectedVersion))
            throw new Error('Invalid channel version');
          if (!result.isUpdateAvailable || !semver.gt(info.version, app.getVersion())) return null;
          const notes =
            typeof info.releaseNotes === 'string'
              ? info.releaseNotes
              : (info.releaseNotes?.map((item) => item.note).join('\n') ?? '');
          return { version: info.version, notes: notes.slice(0, 20000), build: releaseBuildInfo(notes) };
        },
        download: async (progress) => {
          const listener = (info: { percent: number }) => progress(info.percent);
          updater.on('download-progress', listener);
          try {
            await updater.downloadUpdate();
          } finally {
            updater.removeListener('download-progress', listener);
          }
        },
        prepareInstall: async () => {
          if (process.platform === 'linux') {
            const filename = process.env.APPIMAGE!;
            await access(filename, constants.W_OK);
            await access(path.dirname(filename), constants.W_OK);
          }
        },
        install: () => {
          options.setInstalling(true);
          try {
            updater.quitAndInstall(false, true);
          } catch (error) {
            options.setInstalling(false);
            throw error;
          }
        },
      };
    } catch {
      // An unpacked build or one without its updater dependencies/feed cannot install updates.
      mode = 'disabled';
    }
  }
  backend.openStable = () => shell.openExternal(stableReleaseURL);
  service = new UpdateService({
    ...options,
    mode,
    currentVersion: app.getVersion(),
    currentBuild,
    preferences,
    backend,
    persist: async (value) => {
      const temporary = `${preferencesPath}.tmp`;
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, preferencesPath);
    },
  });
  const startup = setTimeout(() => void service.check(false), 15000);
  const timer = setInterval(() => void service.check(false), 60 * 60 * 1000);
  startup.unref();
  timer.unref();
  app.once('will-quit', () => {
    clearTimeout(startup);
    clearInterval(timer);
  });
  return service;
}
