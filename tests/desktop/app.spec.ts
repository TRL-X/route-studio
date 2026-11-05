import { selectOption } from '../controls';
import { openSettings as settings, setPreference } from '../preferences';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../../src/files/project';
import { strings } from '../../src/app/strings';
import { commandStrings, type CommandId } from '../../src/app/commands';
import type { Page } from '@playwright/test';
import type { UpdateMode, UpdateState } from '../../electron/update-contracts';

const root = fileURLToPath(new URL('../..', import.meta.url));
let desktop: ElectronApplication;
let directory: string;
let mainErrors: string[];
let child: ReturnType<ElectronApplication['process']> | undefined;
const gpx =
  '<gpx><trk><name>Desktop ridge</name><trkseg><trkpt lat="30" lon="105"><ele>10</ele></trkpt><trkpt lat="30.01" lon="105.01"><ele>20</ele></trkpt></trkseg></trk></gpx>';

async function launch({ disableWebGL = false, updates = false, appImage = '' } = {}) {
  if (updates) {
    await mkdir(path.join(directory, 'profile'), { recursive: true });
    await writeFile(path.join(directory, 'profile', 'updates.json'), JSON.stringify({ autoCheck: false }));
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key),
    ),
  ) as Record<string, string>;
  desktop = await _electron.launch({
    colorScheme: null,
    ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE } : {}),
    args: [
      ...(process.env.DESKTOP_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${path.join(directory, 'profile')}`,
      ...(updates ? [] : ['--disable-updates']),
    ],
    env: { ...env, ...(appImage ? { APPIMAGE: appImage } : {}) },
  });
  child = desktop.process();
  child.stderr?.on('data', (chunk: Buffer) => {
    const message = chunk.toString();
    if (message.includes('DESKTOP_UNCAUGHT')) mainErrors.push(message);
  });
  await desktop.evaluate(({ dialog }) => {
    // Turn main-process exception dialogs into explicit test failures instead of leaving a modal open.
    dialog.showErrorBox = (title, content) => process.stderr.write(`DESKTOP_UNCAUGHT ${title}: ${content}\n`);
  });
  const page = await desktop.firstWindow();
  await page.route('https://**/*', (route) => route.abort());
  if (disableWebGL) {
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = new Proxy(getContext, {
        apply(target, canvas, args) {
          if (args[0] === 'webgl2') return null;
          return Reflect.apply(target, canvas, args);
        },
      });
    });
    await page.reload();
  }
  await page.getByRole('button', { name: /^(Menu|菜单)$/ }).waitFor();
  if ((await page.locator('html').getAttribute('lang')) !== 'en') await setLanguage(page, 'en');
  return page;
}

async function setLanguage(page: Page, language: 'en' | 'zh') {
  await setPreference(page, /^(Interface language|界面语言)$/, language);
}

async function fileMenu(page: Page, language: 'en' | 'zh' = 'en') {
  const copy = commandStrings[language];
  await page.getByRole('button', { name: copy.menu, exact: true }).click();
  await page.getByRole('menuitem', { name: copy.file, exact: true }).click();
}

async function nativeCommand(command: CommandId) {
  await expect
    .poll(() =>
      desktop.evaluate(
        ({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(`command:${id}`)?.enabled,
        command,
      ),
    )
    .toBe(true);
  await desktop.evaluate(({ Menu, BrowserWindow }, id) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById(`command:${id}`)!;
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
  }, command);
}

test.beforeEach(async () => {
  // Runtime-skipped tests still run afterEach without launching their own app.
  child = undefined;
  mainErrors = [];
  directory = await mkdtemp(path.join(os.tmpdir(), 'route-studio-desktop-'));
});
test.afterEach(async () => {
  if (child?.exitCode === null) {
    await desktop.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy();
    });
    await desktop.close();
  }
  await rm(directory, { recursive: true, force: true });
  expect(mainErrors).toEqual([]);
});

test('starts with a blank route and no example command', async () => {
  const page = await launch();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
  await expect(page.locator('.rv-route')).toHaveAttribute('d', '');
  await expect(page.locator('.rv-station')).toHaveCount(0);
  expect(
    await desktop.evaluate(({ Menu }) =>
      Boolean(Menu.getApplicationMenu()?.getMenuItemById('command:example')),
    ),
  ).toBe(false);
  await fileMenu(page);
  await expect(page.getByRole('menuitem', { name: 'New route', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open example', exact: true })).toHaveCount(0);
});

async function simulateUpdates(mode: UpdateMode) {
  await desktop.evaluate(({ ipcMain, BrowserWindow }, mode) => {
    let state: UpdateState = { currentVersion: '0.1.0', mode, status: 'idle', autoCheck: true };
    const counters = { installed: 0, opened: 0 };
    Object.assign(globalThis, { updateTestCounters: counters });
    const publish = () => {
      BrowserWindow.getAllWindows()[0].webContents.send('desktop:update-state', state);
      return state;
    };
    for (const action of ['state', 'check', 'download', 'open', 'install', 'auto-check']) {
      ipcMain.removeHandler(`desktop:update-${action}`);
      ipcMain.handle(`desktop:update-${action}`, async (_event, value) => {
        if (action === 'check')
          state = {
            ...state,
            status: 'available',
            release: { version: '0.2.0', notes: 'Route editing improvements' },
          };
        if (action === 'download') {
          state = { ...state, status: 'downloading', percent: 25 };
          publish();
          await new Promise((resolve) => setTimeout(resolve, 200));
          state = { ...state, status: 'downloaded', percent: 100 };
        }
        if (action === 'open') counters.opened++;
        if (action === 'install') counters.installed++;
        if (action === 'auto-check') state = { ...state, autoCheck: value };
        return publish();
      });
    }
    publish();
  }, mode);
}

test('manual updates show release notes and a browser download without installation controls', async ({}, testInfo) => {
  const page = await launch();
  await simulateUpdates('manual');
  await nativeCommand('checkUpdates');
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(panel.getByRole('tab', { name: 'Software update' })).toHaveAttribute('data-state', 'active');
  await expect(panel.getByRole('status')).toContainText('0.2.0');
  await panel.getByText('Release notes', { exact: true }).click();
  await expect(panel.getByText('Route editing improvements')).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('manual-update.png') });
  await panel.getByRole('button', { name: 'Download new version', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Restart and install' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Download update', exact: true })).toHaveCount(0);
  await panel.getByRole('checkbox', { name: 'Automatically check for updates once a day' }).uncheck();
  await expect
    .poll(() => page.evaluate(async () => (await window.routeStudioDesktop!.getUpdateState()).autoCheck))
    .toBe(false);
  expect(
    await desktop.evaluate(
      () =>
        (globalThis as unknown as { updateTestCounters: { installed: number; opened: number } })
          .updateTestCounters,
    ),
  ).toEqual({ installed: 0, opened: 1 });
});

test('update installation waits for a successful project save and survives cancellation and disk errors', async () => {
  const page = await launch();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Keep this route');
  await name.press('Enter');
  await simulateUpdates('automatic');
  await nativeCommand('checkUpdates');
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await panel.getByRole('button', { name: 'Download update', exact: true }).click();
  await panel.getByRole('button', { name: 'Restart and install', exact: true }).click();
  await expect(panel.getByText('Save your project before restarting?')).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await expect(panel.getByRole('button', { name: 'Save and update' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Restart and install', exact: true }).click();
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' });
  });
  await panel.getByRole('button', { name: 'Save and update' }).click();
  await expect(panel.getByRole('alert')).toContainText('Saving was cancelled or could not finish');
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error('Disk unavailable');
    };
  });
  await panel.getByRole('button', { name: 'Save and update' }).click();
  await expect(panel.getByRole('alert')).toContainText('Saving was cancelled or could not finish');
  expect(
    await desktop.evaluate(
      () =>
        (globalThis as unknown as { updateTestCounters: { installed: number } }).updateTestCounters.installed,
    ),
  ).toBe(0);
  const target = path.join(directory, 'before-update.routeproj');
  await desktop.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, target);
  await panel.getByRole('button', { name: 'Save and update' }).click();
  await expect
    .poll(() =>
      desktop.evaluate(
        () =>
          (globalThis as unknown as { updateTestCounters: { installed: number } }).updateTestCounters
            .installed,
      ),
    )
    .toBe(1);
  expect(loadProject(await readFile(target, 'utf8')).name).toBe('Keep this route');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  await expect(name).toHaveValue('Keep this route');
});

test('update IPC rejects malformed requests and development builds cannot install', async () => {
  const page = await launch();
  expect(await page.evaluate(async () => (await window.routeStudioDesktop!.installUpdate(true)).mode)).toBe(
    'disabled',
  );
  expect(
    await page.evaluate(async () => {
      try {
        await window.routeStudioDesktop!.installUpdate('yes' as unknown as boolean);
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
});

test('packaged manual updater selects the matching asset and persists its preference', async ({}, testInfo) => {
  test.skip(
    !process.env.DESKTOP_EXECUTABLE || process.platform === 'win32',
    'Requires a packaged manual-update platform',
  );
  const page = await launch({ updates: true });
  const expectedURL = await desktop.evaluate(({ app, net, shell }) => {
    const arch = process.platform === 'darwin' && app.runningUnderARM64Translation ? 'arm64' : process.arch;
    const suffix =
      process.platform === 'darwin' ? `mac-${arch}.dmg` : `linux-${arch === 'x64' ? 'amd64' : arch}.deb`;
    const name = `Route-Studio-99.0.0-${suffix}`;
    const url = `https://github.com/TRL-X/route-studio/releases/download/v99.0.0/${name}`;
    net.fetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v99.0.0',
          draft: false,
          prerelease: false,
          body: 'Packaged update test',
          assets: [{ name, size: 100, browser_download_url: url }],
        }),
      );
    shell.openExternal = async (url) => {
      Object.assign(globalThis, { openedUpdateURL: url });
    };
    return url;
  });
  await nativeCommand('checkUpdates');
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(panel.getByRole('status')).toContainText('99.0.0');
  await panel.getByRole('button', { name: 'Download new version' }).click();
  await expect
    .poll(() =>
      desktop.evaluate(() => (globalThis as unknown as { openedUpdateURL: string }).openedUpdateURL),
    )
    .toBe(expectedURL);
  await panel.getByRole('checkbox', { name: 'Automatically check for updates once a day' }).check();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(path.join(directory, 'profile', 'updates.json'), 'utf8')).autoCheck,
    )
    .toBe(true);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
  await panel.screenshot({ path: testInfo.outputPath('packaged-manual-update.png') });
  await desktop.close();
  await launch();
  expect(await desktop.evaluate(({ app }) => app.getVersion())).not.toBe('99.0.0');
  expect(JSON.parse(await readFile(path.join(directory, 'profile', 'updates.json'), 'utf8')).autoCheck).toBe(
    true,
  );
});

test('packaged app includes automatic updater dependencies', async () => {
  test.skip(!process.env.DESKTOP_EXECUTABLE, 'Requires a packaged app');
  await launch();
  const available = await desktop.evaluate(({ app }) => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const path = process.getBuiltinModule('node:path');
    const require = createRequire(path.join(app.getAppPath(), 'package.json'));
    const { NsisUpdater, AppImageUpdater } = require('electron-updater');
    return [typeof NsisUpdater, typeof AppImageUpdater];
  });
  expect(available).toEqual(['function', 'function']);
});

test('packaged automatic updater preserves install guards and saves before invoking the installer', async () => {
  test.skip(
    !process.env.DESKTOP_EXECUTABLE || process.platform === 'darwin',
    'Requires a packaged automatic-update platform',
  );
  const appImage = path.join(directory, 'Route-Studio.AppImage');
  await writeFile(appImage, 'permission-check fixture');
  const page = await launch({ updates: true, appImage: process.platform === 'linux' ? appImage : '' });
  const source = path.join(directory, 'update-route.gpx');
  await writeFile(source, gpx);
  await desktop.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, source);
  await nativeCommand('open');
  await expect(page.getByRole('heading', { name: 'Desktop ridge', exact: true })).toBeVisible();
  await desktop.evaluate(({ app }) => {
    // Playwright evaluates this callback without a dynamic-import hook.
    const { createRequire } = process.getBuiltinModule('node:module');
    const path = process.getBuiltinModule('node:path');
    const require = createRequire(path.join(app.getAppPath(), 'package.json'));
    const { NsisUpdater, AppImageUpdater } = require('electron-updater') as typeof import('electron-updater');
    const prototype = process.platform === 'win32' ? NsisUpdater.prototype : AppImageUpdater.prototype;
    prototype.checkForUpdates = async function () {
      if (this.autoDownload || this.autoInstallOnAppQuit || this.allowPrerelease || this.allowDowngrade)
        throw new Error('Unsafe update defaults');
      const updateInfo = {
        version: '99.0.0',
        releaseNotes: 'Packaged automatic update',
        files: [],
        path: '',
        sha512: '',
        releaseDate: '',
      };
      return { isUpdateAvailable: true, updateInfo, versionInfo: updateInfo };
    };
    prototype.downloadUpdate = async function () {
      this.emit('download-progress', {
        percent: 100,
        bytesPerSecond: 100,
        total: 100,
        transferred: 100,
        delta: 100,
      });
      return ['fixture'];
    };
    prototype.quitAndInstall = () => {
      Object.assign(globalThis, { installerInvoked: true });
    };
  });
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Guarded update');
  await name.press('Enter');
  await nativeCommand('checkUpdates');
  let panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await panel.getByRole('button', { name: 'Download update', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Restart and install' })).toBeVisible();
  expect(await page.evaluate(async () => (await window.routeStudioDesktop!.installUpdate(false)).error)).toBe(
    'unsaved',
  );
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await nativeCommand('export');
  await expect(page.getByRole('dialog', { name: 'Export route' })).toBeVisible();
  expect(await page.evaluate(async () => (await window.routeStudioDesktop!.installUpdate(true)).error)).toBe(
    'busy',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await nativeCommand('checkUpdates');
  panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  const target = path.join(directory, 'guarded-update.routeproj');
  await desktop.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, target);
  await panel.getByRole('button', { name: 'Restart and install' }).click();
  await panel.getByRole('button', { name: 'Save and update' }).click();
  await expect
    .poll(() =>
      desktop.evaluate(() => (globalThis as unknown as { installerInvoked: boolean }).installerInvoked),
    )
    .toBe(true);
  expect(loadProject(await readFile(target, 'utf8')).name).toBe('Guarded update');
});

test('synchronizes the editor appearance with native window chrome and dialogs', async () => {
  const page = await launch();
  for (const theme of ['dark', 'light', 'system']) {
    const panel = await settings(page);
    await selectOption(panel.getByLabel('Appearance', { exact: true }), theme);
    await panel.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => desktop.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(theme);
    const dark = await desktop.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
    expect(
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase(),
      ),
    ).toBe(dark ? '#111113' : '#ffffff');
  }
});

test('native commands share editor history and stay disabled while a dialog is open', async () => {
  const page = await launch();
  const source = path.join(directory, 'native-menu.gpx');
  await writeFile(source, gpx);
  await desktop.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, source);
  await nativeCommand('open');
  await expect(page.getByRole('heading', { name: 'Desktop ridge', exact: true })).toBeVisible();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  const route = page.locator('.rv-route');
  const originalPath = await route.getAttribute('d');
  await name.fill('Uncommitted native edit');
  await nativeCommand('new');
  const replacement = page.getByRole('dialog', { name: 'Open another route?', exact: true });
  await expect(replacement).toBeVisible();
  await replacement.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(name).toHaveValue('Uncommitted native edit');
  await expect(name).toBeFocused();
  await expect(route).toHaveAttribute('d', originalPath!);

  await name.fill('First edit');
  await name.press('Enter');
  await name.fill('Native menu edit');
  await name.press('Enter');
  await page.getByRole('heading', { name: 'Native menu edit', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveValue('First edit');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(name).toHaveValue('Native menu edit');
  await nativeCommand('undo');
  await expect(name).toHaveValue('First edit');
  await nativeCommand('redo');
  await expect(name).toHaveValue('Native menu edit');
  await nativeCommand('settings');
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('command:open')!.enabled),
    )
    .toBe(false);
  await desktop.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById('command:new')!;
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
  });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(name).toHaveValue('Native menu edit');
  await page.keyboard.press('ControlOrMeta+,');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await nativeCommand('export');
  await expect(page.getByRole('dialog', { name: 'Export route', exact: true })).toBeVisible();
  const filename = page.getByLabel('File name');
  await filename.press('End');
  await filename.pressSequentially('X');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(filename).toHaveValue('Native menu edit');
});

test('title bar controls remain usable beside native buttons when resizing and zooming', async () => {
  const page = await launch();
  for (const [width, height, zoom] of [
    [800, 600, 0.5],
    [800, 600, 0.8],
    [800, 600, 1],
    [800, 600, 1.25],
    [800, 600, 1.5],
    [800, 600, 3],
    [1440, 960, 1],
  ]) {
    const targetWidth = await desktop.evaluate(
      ({ BrowserWindow, screen }, size) => {
        const win = BrowserWindow.getAllWindows()[0];
        const area = screen.getDisplayMatching(win.getBounds()).workAreaSize;
        const [minWidth, minHeight] = win.getMinimumSize();
        const width = Math.max(minWidth, Math.min(size[0], area.width));
        const height = Math.max(minHeight, Math.min(size[1], area.height));
        win.webContents.setZoomFactor(size[2]);
        win.setSize(width, height);
        return width;
      },
      [width, height, zoom],
    );
    await expect
      .poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0]))
      .toBe(targetWidth);
    for (const language of ['en', 'zh'] as const) {
      const t = strings[language];
      const copy = commandStrings[language];
      await setLanguage(page, language);
      await expect(page.getByRole('button', { name: copy.export, exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const safe = navigator.windowControlsOverlay?.getTitlebarAreaRect();
            if (!safe) return ['Native control safe area is missing'];
            const header = document.querySelector('.topbar')!.getBoundingClientRect();
            const drag = document.querySelector('.titlebar-drag-space')!.getBoundingClientRect();
            const problems: string[] = [];
            if (safe.width <= 0 || safe.height <= 0) problems.push('Native control safe area is missing');
            if (Math.abs(header.height - safe.height) > 1)
              problems.push('Title bar height does not match native controls');
            if (drag.width * window.routeStudioDesktop!.getZoomFactor() < 32)
              problems.push('No usable space to drag the window');
            let previousRight = safe.x;
            for (const element of document.querySelectorAll(
              '.topbar .brand, .topbar button, .topbar select',
            )) {
              const rect = element.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;
              const name = element.getAttribute('aria-label') ?? element.textContent;
              if (rect.left < previousRight - 1) problems.push(`${name} overlaps the previous control`);
              if (rect.right > safe.x + safe.width + 1)
                problems.push(`${name} overlaps native window buttons`);
              if (rect.top < safe.y - 1 || rect.bottom > safe.y + safe.height + 1)
                problems.push(`${name} is outside the title bar`);
              previousRight = rect.right;
            }
            return problems;
          }),
        )
        .toEqual([]);

      await fileMenu(page, language);
      await expect(page.getByRole('menuitem', { name: t.new, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitem', { name: t.new, exact: true })).not.toBeVisible();
      await page.getByRole('button', { name: copy.export, exact: true }).click();
      const preview = page.getByRole('dialog');
      await selectOption(preview.getByLabel(t.exportFormat), 'gpx');
      await expect(preview).toBeVisible();
      await preview.getByRole('button', { name: t.close, exact: true }).click();
      await expect(preview).not.toBeVisible();
      if (zoom === 3) {
        await page.evaluate(() => window.scrollTo(document.body.scrollWidth, document.body.scrollHeight));
        await expect
          .poll(() =>
            page.evaluate(() => {
              const header = document.querySelector('.topbar')!.getBoundingClientRect();
              return {
                scrolled: scrollX > 0 && scrollY > 0,
                left: Math.round(header.x),
                top: Math.round(header.y),
              };
            }),
          )
          .toEqual({ scrolled: true, left: 0, top: 0 });
        await fileMenu(page, language);
        await expect(page.getByRole('menuitem', { name: t.new, exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
  }
});

test('loads secure bundled assets, uses the import worker, saves natively and recovers after restart', async () => {
  let page = await launch();
  expect(page.url()).toBe('app://route-studio/');
  expect(
    await page.evaluate(() => ({
      secure: isSecureContext,
      node: typeof (window as unknown as { require?: unknown }).require,
      bridge: !!window.routeStudioDesktop,
    })),
  ).toEqual({ secure: true, node: 'undefined', bridge: true });
  const source = path.join(directory, '山脊.gpx');
  const target = path.join(directory, '路线.routeproj');
  await writeFile(source, gpx);
  await desktop.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, source);
  await nativeCommand('open');
  await expect(page.getByRole('heading', { name: 'Desktop ridge', exact: true })).toBeVisible();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Saved desktop route');
  await name.press('Enter');
  await page.getByRole('heading', { name: 'Saved desktop route', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveValue('Desktop ridge');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(name).toHaveValue('Saved desktop route');
  await desktop.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, target);
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByText('Project saved.', { exact: true })).toBeVisible();
  expect(loadProject(await readFile(target, 'utf8')).name).toBe('Saved desktop route');
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
  // Close and reopen with the same isolated profile to exercise IndexedDB persistence.
  await desktop.close();
  page = await launch();
  await expect(page.getByRole('heading', { name: 'Saved desktop route', exact: true })).toBeVisible();
  await expect(page.getByText('Draft recovered', { exact: true })).toBeVisible();

  const exported = path.join(directory, '路线.gpx');
  await desktop.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, exported);
  await page.getByRole('button', { name: commandStrings.en.export, exact: true }).click();
  await selectOption(page.getByLabel('Choose export format'), 'gpx');
  await page.getByRole('button', { name: 'Download GPX', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await readFile(exported, 'utf8')).toContain('Saved desktop route');
});

test('cancelled or failed native saves retain unsaved edits and the close reminder', async () => {
  const page = await launch();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Unsaved route');
  await name.press('Enter');
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' });
  });
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  // A cancelled save also completes asynchronously; wait before requesting a close.
  await expect(page.locator('.shell')).not.toHaveAttribute('inert', '');
  await expect(page.getByText('Project saved.', { exact: true })).not.toBeVisible();
  await desktop.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBox = async (
      windowOrOptions: Electron.BaseWindow | Electron.MessageBoxOptions,
      options?: Electron.MessageBoxOptions,
    ) => {
      (globalThis as unknown as { closePrompt: string }).closePrompt = (
        options ?? (windowOrOptions as Electron.MessageBoxOptions)
      ).message;
      return { response: 0, checkboxChecked: false };
    };
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect
    .poll(() => desktop.evaluate(() => (globalThis as unknown as { closePrompt: string }).closePrompt))
    .toBe('Close without saving a project?');
  await expect(name).toHaveValue('Unsaved route');
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error('Disk unavailable');
    };
  });
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save the file.');
});

test('opens device routes from the native menu without a local route', async () => {
  const page = await launch();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Menu', exact: true });
  expect(
    await menu
      .getByRole('menuitem')
      .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label') || item.textContent)),
  ).toEqual(['File', 'Edit', 'Route', 'View', 'Device…', 'Check for updates…', 'Settings…']);
  expect(
    await menu
      .getByRole('menuitem', { name: 'Device…', exact: true })
      .evaluate((item) => [
        item.previousElementSibling?.getAttribute('role'),
        item.nextElementSibling?.getAttribute('role'),
      ]),
  ).toEqual(['separator', 'separator']);
  await page.keyboard.press('Escape');
  await nativeCommand('deviceRoutes');
  const manager = page.getByRole('dialog', { name: 'Device', exact: true });
  await expect(manager).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Connect device', exact: true })).toBeEnabled();
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
});

test('device chooser updates discovery results and cancels without selecting a device', async () => {
  const page = await launch();
  await desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const callback = (id: string) => {
      (globalThis as unknown as { selectedDevice: string }).selectedDevice = id;
    };
    win.webContents.emit('select-bluetooth-device', { preventDefault() {} }, [], callback);
  });
  const chooser = page.getByRole('dialog', { name: 'Choose a Bluetooth device' });
  await expect(chooser).toBeVisible();
  await desktop.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.emit(
      'select-bluetooth-device',
      { preventDefault() {} },
      [{ deviceId: 'device-1', deviceName: 'Arcap' }],
      () => {},
    );
  });
  await selectOption(chooser.getByRole('combobox'), 'device-1');
  await chooser.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(chooser).not.toBeVisible();
  expect(
    await desktop.evaluate(() => (globalThis as unknown as { selectedDevice: string }).selectedDevice),
  ).toBe('');
});

test('quitting with unsaved edits confirms once and exits without a destroyed-window exception', async () => {
  const page = await launch();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Quit regression');
  await name.press('Enter');
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
  await desktop.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    setImmediate(() => app.quit());
  });
  await expect.poll(() => child?.exitCode).toBe(0);
});

for (const disableWebGL of [false, true]) {
  const graphics = disableWebGL ? 'without WebGL' : 'with default graphics';
  test(`saves personal basemap settings across desktop restarts ${graphics} without including the Key in projects`, async () => {
    let page = await launch({ disableWebGL });
    const tiles = /https:\/\/t[0-7]\.tianditu\.gov\.cn\//;
    await page.route(tiles, (route) => route.fulfill({ status: 403, body: 'Denied' }));
    await page.getByRole('button', { name: 'Basemap: OpenFreeMap', exact: true }).click();
    let panel = page.getByRole('dialog', { name: 'Settings', exact: true });
    await selectOption(panel.getByLabel('Map provider'), 'tianditu');
    await panel.getByLabel('API Key', { exact: true }).fill('desktop-personal-test-key');
    await panel.getByRole('button', { name: 'Apply', exact: true }).click();
    // Map initialization can fail before any request on runners without WebGL2.
    // Persistence must still work; browser tests cover tile URLs and Key forwarding.
    await expect(page.getByText('Basemap unavailable', { exact: true })).toBeVisible();
    await expect(page.locator('.rv-graticule')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Basemap: Tianditu', exact: true })).toBeVisible();
    const project = path.join(directory, 'map-settings.routeproj');
    await desktop.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    }, project);
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await expect(page.getByText('Project saved.', { exact: true })).toBeVisible();
    expect(await readFile(project, 'utf8')).not.toContain('desktop-personal-test-key');
    await desktop.close();
    page = await launch({ disableWebGL });
    await page.getByRole('button', { name: 'Basemap: Tianditu', exact: true }).click();
    panel = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(panel.getByLabel('API Key', { exact: true })).toHaveValue('desktop-personal-test-key');
    await expect(panel.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
    await expect(panel.getByLabel('Show basemap')).toBeChecked();
  });
}
