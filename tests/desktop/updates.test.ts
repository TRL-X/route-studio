import { describe, expect, it, vi } from 'vitest';
import {
  acceptsVersion,
  automaticReleaseFeed,
  manualRelease,
  releaseBuildInfo,
  selectManualRelease,
} from '../../electron/update-release';
import { checkInterval, UpdateService, type UpdateBackend } from '../../electron/update-service';
import type { UpdateChannel, UpdateMode } from '../../electron/update-contracts';

const release = { version: '0.2.0', notes: 'New release' };
function setup(mode: UpdateMode = 'automatic', backend: Partial<UpdateBackend> = {}) {
  const install = vi.fn();
  const open = vi.fn(async () => {});
  const check = vi.fn(async (_channel: UpdateChannel) => release);
  const persist = vi.fn(async () => {});
  const guard = { value: null as 'busy' | 'unsaved' | null };
  let now = checkInterval;
  const service = new UpdateService({
    currentVersion: '0.1.0',
    mode,
    preferences: { autoCheck: true, channel: 'stable' },
    backend: {
      check,
      download: async (progress) => {
        progress(42);
      },
      install,
      open,
      ...backend,
    },
    publish: vi.fn(),
    persist,
    canInstall: (discard) => (guard.value === 'unsaved' && discard ? null : guard.value),
    now: () => now,
  });
  return {
    service,
    install,
    open,
    check,
    persist,
    guard,
    advance: () => {
      now += checkInterval;
    },
  };
}

describe('update lifecycle', () => {
  it('switches channels, persists the selection and immediately checks even with automatic checks disabled', async () => {
    const { service, check, persist } = setup();
    await service.check();
    await service.setAutoCheck(false);
    await service.setChannel('beta');
    expect(check.mock.calls.map((call) => call[0])).toEqual(['stable', 'beta']);
    expect(persist).toHaveBeenLastCalledWith({
      autoCheck: false,
      channel: 'beta',
      lastChecked: checkInterval,
    });
    expect(service.snapshot()).toMatchObject({ channel: 'beta', status: 'available' });
  });

  it('invalidates a downloaded preview before checking stable and cannot install the abandoned download', async () => {
    const check = vi.fn().mockResolvedValueOnce(release).mockResolvedValueOnce(null);
    const { service, install } = setup('automatic', { check });
    await service.setChannel('beta');
    await service.download();
    expect(service.snapshot().status).toBe('downloaded');
    await service.setChannel('stable');
    await service.install(true);
    expect(install).not.toHaveBeenCalled();
    expect(service.snapshot()).toMatchObject({
      channel: 'stable',
      status: 'current',
      release: undefined,
      percent: undefined,
    });
  });

  it('does not switch during an in-flight check or download', async () => {
    let finish!: () => void;
    const { service } = setup('automatic', {
      download: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    await service.check();
    const downloading = service.download();
    await service.setChannel('beta');
    expect(service.snapshot()).toMatchObject({
      channel: 'stable',
      status: 'downloading',
      error: 'channelBusy',
    });
    finish();
    await downloading;
  });

  it('keeps the previous channel when saving fails and never checks the unpersisted channel', async () => {
    const { service, persist, check } = setup();
    persist.mockRejectedValueOnce(new Error('Disk full'));
    await service.setChannel('beta');
    expect(service.snapshot()).toMatchObject({ channel: 'stable', error: 'preferences', release: undefined });
    expect(check).not.toHaveBeenCalled();
    await expect(service.setChannel('nightly' as 'beta')).rejects.toThrow('Invalid update channel');
  });

  it('throttles automatic attempts, respects opt-out and permits explicit checks', async () => {
    const { service, check, advance, persist } = setup();
    await service.check(false);
    await service.check(false);
    expect(check).toHaveBeenCalledTimes(1);
    await service.check();
    expect(check).toHaveBeenCalledTimes(2);
    advance();
    await service.setAutoCheck(false);
    await service.check(false);
    expect(check).toHaveBeenCalledTimes(2);
    await service.setAutoCheck(true);
    await service.check(false);
    expect(check).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenLastCalledWith({
      autoCheck: true,
      channel: 'stable',
      lastChecked: checkInterval * 2,
    });
  });

  it('does not overlap checks or lose a downloaded update to a later check', async () => {
    let finish!: (value: typeof release) => void;
    const check = vi.fn(
      () =>
        new Promise<typeof release>((resolve) => {
          finish = resolve;
        }),
    );
    const { service } = setup('automatic', { check });
    const first = service.check();
    await service.check();
    await service.setChannel('beta');
    expect(service.snapshot().channel).toBe('stable');
    expect(check).toHaveBeenCalledTimes(1);
    finish(release);
    await first;
    await service.download();
    await service.check();
    expect(service.snapshot().status).toBe('downloaded');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('never downloads or installs on manual and disabled platforms', async () => {
    for (const mode of ['manual', 'disabled'] as const) {
      const download = vi.fn(async () => {});
      const { service, install, open, check } = setup(mode, { download });
      await service.check();
      await service.download();
      await service.install(true);
      await service.open();
      expect(download).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(mode === 'manual' ? 1 : 0);
      expect(check).toHaveBeenCalledTimes(mode === 'manual' ? 1 : 0);
    }
  });

  it('reports a failed check without calling the downloader and retries later', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(release);
    const download = vi.fn(async () => {});
    const { service } = setup('automatic', { check, download });
    await service.check(false);
    expect(service.snapshot()).toMatchObject({ status: 'error', error: 'check' });
    await service.download();
    expect(download).not.toHaveBeenCalled();
    await service.check(false);
    expect(check).toHaveBeenCalledTimes(1);
    await service.check();
    expect(service.snapshot()).toMatchObject({ status: 'available', error: undefined });
  });

  it('keeps failed downloads retryable and only installs a completed download', async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error('Checksum mismatch'))
      .mockResolvedValue(undefined);
    const { service, install } = setup('automatic', { download });
    await service.check();
    await service.download();
    await service.install(true);
    expect(install).not.toHaveBeenCalled();
    expect(service.snapshot()).toMatchObject({ status: 'error', error: 'download' });
    await service.download();
    expect(service.snapshot()).toMatchObject({ status: 'downloaded', percent: 100, error: undefined });
    await service.install(false);
    await service.install(false);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('blocks busy operations even when discarding, and requires explicit consent for unsaved edits', async () => {
    const { service, guard, install } = setup();
    await service.check();
    await service.download();
    guard.value = 'busy';
    await service.install(true);
    expect(service.snapshot().error).toBe('busy');
    guard.value = 'unsaved';
    await service.install(false);
    expect(service.snapshot().error).toBe('unsaved');
    expect(install).not.toHaveBeenCalled();
    await service.install(true);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('rechecks activity after asynchronous permission checks and recovers from install failures', async () => {
    let ready!: () => void;
    const { service, guard, install } = setup('automatic', {
      prepareInstall: () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    });
    await service.check();
    await service.download();
    const attempt = service.install(false);
    guard.value = 'busy';
    ready();
    await attempt;
    expect(install).not.toHaveBeenCalled();
    guard.value = null;
    const next = service.install(false);
    ready();
    await next;
    service.failInstall();
    expect(service.snapshot()).toMatchObject({ status: 'downloaded', error: 'install' });
  });

  it('never invokes the installer when the AppImage is not writable', async () => {
    const { service, install } = setup('automatic', {
      prepareInstall: async () => {
        throw new Error('Read-only directory');
      },
    });
    await service.check();
    await service.download();
    await service.install(false);
    expect(install).not.toHaveBeenCalled();
    expect(service.snapshot()).toMatchObject({ status: 'downloaded', error: 'install' });
  });
});

describe('manual release selection', () => {
  function published(version: string, platform = 'mac', arch = 'arm64') {
    const name = `Route-Studio-${version}-${platform}-${arch}.${platform === 'mac' ? 'dmg' : 'deb'}`;
    return {
      tag_name: `v${version}`,
      draft: false,
      prerelease: version.includes('-'),
      body: '<script>plain text</script>',
      assets: [
        {
          name,
          size: 10,
          browser_download_url: `https://github.com/TRL-X/route-studio/releases/download/v${version}/${name}`,
        },
      ],
    };
  }
  it('keeps stable isolated, orders previews numerically and accepts a newer stable after a preview', () => {
    const releases = [
      published('0.2.0-beta.9'),
      published('0.1.3'),
      published('0.2.0-beta.12'),
      published('0.3.0-alpha.1'),
      { ...published('0.3.0-beta.1'), draft: true },
    ];
    expect(selectManualRelease(releases, '0.1.2', 'darwin', 'arm64', 'stable')?.version).toBe('0.1.3');
    expect(selectManualRelease(releases, '0.1.3', 'darwin', 'arm64', 'beta')?.version).toBe('0.2.0-beta.12');
    expect(selectManualRelease(releases, '0.2.0-beta.12', 'darwin', 'arm64', 'stable')).toBeNull();
    expect(
      selectManualRelease([...releases, published('0.2.0')], '0.2.0-beta.12', 'darwin', 'arm64', 'beta')
        ?.version,
    ).toBe('0.2.0');
    expect(
      manualRelease(published('0.2.0-beta.12', 'linux', 'amd64'), '0.1.3', 'linux', 'x64', 'beta')
        ?.downloadURL,
    ).toContain('v0.2.0-beta.12/Route-Studio-0.2.0-beta.12-linux-amd64.deb');
    expect(acceptsVersion('0.2.0-alpha.1', 'beta')).toBe(false);
    expect(acceptsVersion('0.2.0-beta.1', 'stable')).toBe(false);
  });

  it('extracts validated build provenance without treating release notes as markup', () => {
    const commit = 'a'.repeat(40);
    const builtAt = '2026-11-09T08:00:00.000Z';
    const value = { ...published('0.2.0-beta.1'), body: `Build commit: ${commit}\nBuild time: ${builtAt}` };
    expect(manualRelease(value, '0.1.3', 'darwin', 'arm64', 'beta')?.build).toEqual({ commit, builtAt });
    expect(releaseBuildInfo('Build commit: main\nBuild time: nonsense')).toBeUndefined();
  });

  it.each(['win32', 'linux'])(
    'pins the newest eligible automatic feed on %s regardless of publication order',
    (platform) => {
      const metadata = (version: string) => {
        const name = `${version.includes('-') ? 'beta' : 'latest'}${platform === 'linux' ? '-linux' : ''}.yml`;
        return {
          ...published(version),
          assets: [
            {
              name,
              size: 100,
              browser_download_url: `https://github.com/TRL-X/route-studio/releases/download/v${version}/${name}`,
            },
          ],
        };
      };
      const preview = metadata('0.2.0-beta.12');
      const feed = automaticReleaseFeed(
        [metadata('0.1.3'), preview, metadata('0.2.0-beta.9')],
        '0.1.3',
        platform,
      );
      expect(feed).toEqual({
        version: '0.2.0-beta.12',
        channel: 'beta',
        url: 'https://github.com/TRL-X/route-studio/releases/download/v0.2.0-beta.12/',
      });
      expect(automaticReleaseFeed([metadata('0.2.0'), preview], '0.2.0-beta.12', platform)?.channel).toBe(
        'latest',
      );
      expect(automaticReleaseFeed([metadata('0.1.3'), preview], '0.2.0-beta.12', platform)).toBeNull();
      preview.assets[0].browser_download_url = 'https://evil.test/beta.yml';
      expect(() => automaticReleaseFeed([preview], '0.1.3', platform)).toThrow();
      expect(() => automaticReleaseFeed([{ ...preview, assets: [] }], '0.1.3', platform)).toThrow();
    },
  );
  it('compares semantic versions and selects the exact platform and architecture', () => {
    expect(manualRelease(published('0.10.0'), '0.9.0', 'darwin', 'arm64')).toMatchObject({
      version: '0.10.0',
      downloadURL: expect.stringContaining('mac-arm64.dmg'),
    });
    expect(manualRelease(published('0.2.0', 'mac', 'x64'), '0.1.0', 'darwin', 'x64')?.downloadURL).toContain(
      'mac-x64.dmg',
    );
    expect(
      manualRelease(published('0.2.0', 'linux', 'amd64'), '0.1.0', 'linux', 'x64')?.downloadURL,
    ).toContain('linux-amd64.deb');
    expect(
      manualRelease(published('0.2.0', 'linux', 'arm64'), '0.1.0', 'linux', 'arm64')?.downloadURL,
    ).toContain('linux-arm64.deb');
    expect(() => manualRelease(published('0.2.0', 'linux', 'arm64'), '0.1.0', 'linux', 'x64')).toThrow();
    expect(manualRelease(published('0.1.0'), '0.2.0', 'darwin', 'arm64')).toBeNull();
    expect(manualRelease(published('0.2.0'), '0.2.0', 'darwin', 'arm64')).toBeNull();
    expect(() => manualRelease(published('0.2.0'), '0.1.0', 'darwin', 'x64')).toThrow();
  });
  it('rejects drafts, prereleases, malformed metadata and substituted download URLs', () => {
    for (const patch of [
      { draft: true },
      { prerelease: true },
      { tag_name: 'v0.2.0-beta.1' },
      { tag_name: 'banana' },
      { assets: [] },
    ]) {
      expect(() => manualRelease({ ...published('0.2.0'), ...patch }, '0.1.0', 'darwin', 'arm64')).toThrow();
    }
    const release = published('0.2.0');
    release.assets[0].browser_download_url = 'https://evil.test/payload.dmg';
    expect(() => manualRelease(release, '0.1.0', 'darwin', 'arm64')).toThrow();
  });
});
