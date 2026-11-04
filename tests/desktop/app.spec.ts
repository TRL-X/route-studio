import { selectOption } from '../controls';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../../src/files/project';
import { strings } from '../../src/app/strings';

const root = fileURLToPath(new URL('../..', import.meta.url));
let desktop: ElectronApplication;
let directory: string;
let mainErrors: string[];
let child: ReturnType<ElectronApplication['process']>;
const gpx =
  '<gpx><trk><name>Desktop ridge</name><trkseg><trkpt lat="30" lon="105"><ele>10</ele></trkpt><trkpt lat="30.01" lon="105.01"><ele>20</ele></trkpt></trkseg></trk></gpx>';

async function launch({ disableWebGL = false } = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key),
    ),
  ) as Record<string, string>;
  desktop = await _electron.launch({
    ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE } : {}),
    args: [
      ...(process.env.DESKTOP_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${path.join(directory, 'profile')}`,
    ],
    env,
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
  await selectOption(page.getByLabel('Interface language'), 'en');
  return page;
}

test.beforeEach(async () => {
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

test('synchronizes the editor appearance with native window chrome and dialogs', async () => {
  const page = await launch();
  for (const theme of ['dark', 'light', 'system']) {
    await selectOption(page.getByLabel('Appearance', { exact: true }), theme);
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
      await selectOption(page.locator('.language [role="combobox"]'), language);
      await expect(page.getByRole('button', { name: t.export, exact: true })).toBeVisible();
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

      await page.getByRole('button', { name: t.file, exact: true }).click();
      await expect(page.getByRole('menuitem', { name: t.new, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitem', { name: t.new, exact: true })).not.toBeVisible();
      await page.getByRole('button', { name: t.exportFormat, exact: true }).click();
      const exportTitle = t.exportFormatTitle.replace('{format}', 'GPX');
      await page.getByRole('menuitem', { name: `${exportTitle}…`, exact: true }).click();
      const preview = page.getByRole('dialog', { name: exportTitle, exact: true });
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
        await page.getByRole('button', { name: t.file, exact: true }).click();
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
  await page.getByRole('button', { name: 'Open', exact: true }).click();
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
  await page.getByRole('button', { name: 'Choose export format', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export GPX…', exact: true }).click();
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
  await expect.poll(() => child.exitCode).toBe(0);
});

for (const disableWebGL of [false, true]) {
  const graphics = disableWebGL ? 'without WebGL' : 'with default graphics';
  test(`saves personal basemap settings across desktop restarts ${graphics} without including the Key in projects`, async () => {
    let page = await launch({ disableWebGL });
    const tiles = /https:\/\/t[0-7]\.tianditu\.gov\.cn\//;
    await page.route(tiles, (route) => route.fulfill({ status: 403, body: 'Denied' }));
    await page.getByRole('button', { name: 'Basemap: OpenFreeMap', exact: true }).click();
    let panel = page.getByRole('dialog', { name: 'Basemap settings' });
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
    panel = page.getByRole('dialog', { name: 'Basemap settings' });
    await expect(panel.getByLabel('API Key', { exact: true })).toHaveValue('desktop-personal-test-key');
    await expect(panel.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
    await expect(panel.getByLabel('Show basemap')).toBeChecked();
  });
}
