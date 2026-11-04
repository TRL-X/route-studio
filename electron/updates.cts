import { app, net, shell } from 'electron';
import { constants } from 'node:fs';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { latestReleaseAPI, manualRelease } from './update-release.js';
import { UpdateService, type UpdateBackend } from './update-service.js';
import type { UpdateMode, UpdatePreferences, UpdateState } from './update-contracts.js';

export async function createUpdates(options: {
  publish: (state: UpdateState) => void;
  canInstall: (discard: boolean) => 'busy' | 'unsaved' | null;
  setInstalling: (installing: boolean) => void;
}) {
  const preferencesPath = path.join(app.getPath('userData'), 'updates.json');
  let preferences: UpdatePreferences = { autoCheck: true };
  try {
    const value = JSON.parse(await readFile(preferencesPath, 'utf8'));
    if (typeof value.autoCheck === 'boolean') preferences.autoCheck = value.autoCheck;
    if (typeof value.lastChecked === 'number' && Number.isFinite(value.lastChecked) && value.lastChecked > 0)
      preferences.lastChecked = value.lastChecked;
  } catch {
    // Missing or damaged preferences must not prevent the editor from opening.
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
  if (mode === 'manual') {
    backend = {
      check: async () => {
        const response = await net.fetch(latestReleaseAPI, {
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        });
        if (!response.ok) throw new Error('Release feed unavailable');
        const body = await response.text();
        if (body.length > 1024 * 1024) throw new Error('Release feed too large');
        const arch =
          process.platform === 'darwin' && app.runningUnderARM64Translation ? 'arm64' : process.arch;
        return manualRelease(JSON.parse(body), app.getVersion(), process.platform, arch);
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
        check: async () => {
          const result = await updater.checkForUpdates();
          if (!result) throw new Error('Update check unavailable');
          const info = result.updateInfo;
          if (!semver.valid(info.version) || semver.prerelease(info.version))
            throw new Error('Invalid stable version');
          if (!result.isUpdateAvailable || !semver.gt(info.version, app.getVersion())) return null;
          const notes =
            typeof info.releaseNotes === 'string'
              ? info.releaseNotes
              : (info.releaseNotes?.map((item) => item.note).join('\n') ?? '');
          return { version: info.version, notes: notes.slice(0, 20000) };
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
  service = new UpdateService({
    ...options,
    mode,
    currentVersion: app.getVersion(),
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
