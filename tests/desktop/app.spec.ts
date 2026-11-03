import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../../src/files/project';

const root = fileURLToPath(new URL('../..', import.meta.url));
let desktop: ElectronApplication;
let directory: string;
let mainErrors: string[];
let child: ReturnType<ElectronApplication['process']>;
const gpx =
  '<gpx><trk><name>Desktop ridge</name><trkseg><trkpt lat="30" lon="105"><ele>10</ele></trkpt><trkpt lat="30.01" lon="105.01"><ele>20</ele></trkpt></trkseg></trk></gpx>';

async function launch() {
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
  await page.getByLabel('Interface language').selectOption('en');
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
  await page.getByRole('button', { name: 'Export GPX…', exact: true }).click();
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
  await chooser.getByRole('listbox').selectOption('device-1');
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
