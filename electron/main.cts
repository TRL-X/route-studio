import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron';
import { readFile, open, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  appURL,
  developmentURL,
  extensions,
  isAppURL,
  maxFileBytes,
  resourcePath,
  validFilename,
} from './security.js';
import type { BluetoothChoice, DesktopFile, PairingRequest } from './contracts.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Linux Chromium requires this switch for Web Bluetooth. Keep normal web security enabled.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-experimental-web-platform-features');

const userDataPath = app.commandLine.getSwitchValue('user-data-dir');
if (userDataPath) app.setPath('userData', path.resolve(userDataPath));

const devURL = app.isPackaged ? undefined : developmentURL(process.env.ELECTRON_RENDERER_URL);
let window: BrowserWindow | null = null;
let dirty = false;
let language: 'en' | 'zh' = app.getPreferredSystemLanguages()[0]?.startsWith('zh') ? 'zh' : 'en';
let fileDialogOpen = false;
let closing = false;
let quitRequested = false;
let bluetoothDevices: BluetoothChoice[] = [];
let bluetoothCallback: ((id: string) => void) | undefined;
let pairingCallback: ((response: { confirmed: boolean; pin?: string }) => void) | undefined;
let bluetoothTimer: ReturnType<typeof setTimeout> | undefined;
let pairingTimer: ReturnType<typeof setTimeout> | undefined;

function trustedURL(value: string) {
  if (isAppURL(value)) return true;
  try {
    return !!devURL && new URL(value).origin === new URL(devURL).origin;
  } catch {
    return false;
  }
}

function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return (
    !!window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    trustedURL(event.senderFrame.url)
  );
}

async function copy() {
  return JSON.parse(
    await readFile(
      path.join(app.getAppPath(), 'src/i18n', `${language === 'zh' ? 'zh-CN' : 'en'}.desktop.json`),
      'utf8',
    ),
  );
}

function cancelBluetooth() {
  const select = bluetoothCallback;
  const pair = pairingCallback;
  bluetoothCallback = undefined;
  pairingCallback = undefined;
  bluetoothDevices = [];
  clearTimeout(bluetoothTimer);
  clearTimeout(pairingTimer);
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    select?.('');
    pair?.({ confirmed: false });
    window.webContents.send('desktop:bluetooth-devices', null);
    window.webContents.send('desktop:bluetooth-pairing', null);
  }
}

async function externalLink(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') await shell.openExternal(url.href);
  } catch (error) {
    console.error('Could not open external link', error);
  }
}

function createWindow() {
  dirty = false;
  closing = false;
  const current = new BrowserWindow({
    title: 'Route Studio',
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#f4f6f3',
    icon: path.join(app.getAppPath(), 'build/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window = current;
  current.once('ready-to-show', () => current.show());
  current.on('close', (event) => {
    if (!dirty || closing) return;
    event.preventDefault();
    if (fileDialogOpen) return;
    fileDialogOpen = true;
    void (async () => {
      const t = await copy();
      const { response } = await dialog.showMessageBox(current, {
        type: 'warning',
        message: t.closeTitle,
        detail: t.closeDetail,
        buttons: [t.cancel, t.discard],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response === 1) {
        closing = true;
        if (quitRequested) app.quit();
        else current.close();
      } else {
        quitRequested = false;
      }
    })()
      .catch(console.error)
      .finally(() => {
        fileDialogOpen = false;
      });
  });
  current.on('closed', () => {
    window = null;
    cancelBluetooth();
  });
  current.webContents.on('will-navigate', (event, url) => {
    if (!trustedURL(url)) {
      event.preventDefault();
      void externalLink(url);
    }
  });
  current.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) event.preventDefault();
  });
  current.webContents.setWindowOpenHandler(({ url }) => {
    void externalLink(url);
    return { action: 'deny' };
  });
  current.webContents.on('will-attach-webview', (event) => event.preventDefault());
  current.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) cancelBluetooth();
  });
  // Bluetooth is granted by the explicit device chooser below, not the generic permission handlers.
  current.webContents.session.setPermissionCheckHandler(() => false);
  current.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  current.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    if (!trustedURL(current.webContents.getURL())) {
      callback('');
      return;
    }
    if (!bluetoothCallback) {
      bluetoothCallback = callback;
      bluetoothTimer = setTimeout(cancelBluetooth, 60000);
    }
    bluetoothDevices = devices.map(({ deviceId, deviceName }) => ({ deviceId, deviceName }));
    current.webContents.send('desktop:bluetooth-devices', bluetoothDevices);
  });
  current.webContents.session.setBluetoothPairingHandler((details, callback) => {
    if (details.frame !== current.webContents.mainFrame || !trustedURL(details.frame.url)) {
      callback({ confirmed: false });
      return;
    }
    clearTimeout(pairingTimer);
    pairingCallback?.({ confirmed: false });
    pairingCallback = callback;
    pairingTimer = setTimeout(cancelBluetooth, 60000);
    const request: PairingRequest = {
      deviceId: details.deviceId,
      pairingKind: details.pairingKind,
      pin: details.pin,
    };
    current.webContents.send('desktop:bluetooth-pairing', request);
  });
  void current.loadURL(devURL ?? appURL);
}

ipcMain.handle('desktop:open', async (event): Promise<DesktopFile | null> => {
  if (!trustedSender(event) || fileDialogOpen) throw new Error('File dialog unavailable');
  fileDialogOpen = true;
  try {
    const t = await copy();
    const result = await dialog.showOpenDialog(window!, {
      title: t.open,
      properties: ['openFile'],
      filters: [{ name: t.routeFiles, extensions }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filename = result.filePaths[0];
    if (!validFilename(path.basename(filename))) throw new Error('Unsupported file');
    const file = await open(filename, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maxFileBytes) throw new Error('File exceeds 64 MiB');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('File changed while reading');
        offset += bytesRead;
      }
      return { name: path.basename(filename), bytes: new Uint8Array(bytes) };
    } finally {
      await file.close();
    }
  } finally {
    fileDialogOpen = false;
  }
});

ipcMain.handle('desktop:save', async (event, file: DesktopFile): Promise<boolean> => {
  if (!trustedSender(event) || fileDialogOpen) throw new Error('File dialog unavailable');
  if (
    !file ||
    !validFilename(file.name) ||
    !(file.bytes instanceof Uint8Array) ||
    file.bytes.byteLength > maxFileBytes
  )
    throw new Error('Invalid file');
  fileDialogOpen = true;
  try {
    const t = await copy();
    const extension = path.extname(file.name).slice(1).toLowerCase();
    const result = await dialog.showSaveDialog(window!, {
      title: t.save,
      defaultPath: file.name,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return false;
    const temporary = path.join(path.dirname(result.filePath), `.route-studio-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, file.bytes, { flag: 'wx' });
      await rename(temporary, result.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
    return true;
  } finally {
    fileDialogOpen = false;
  }
});

ipcMain.on('desktop:state', (event, state) => {
  if (
    !trustedSender(event) ||
    !state ||
    typeof state.dirty !== 'boolean' ||
    !['en', 'zh'].includes(state.language)
  )
    return;
  dirty = state.dirty;
  language = state.language;
  window!.setDocumentEdited(dirty);
});
ipcMain.on('desktop:bluetooth-select', (event, id) => {
  if (!trustedSender(event) || typeof id !== 'string' || !bluetoothCallback) return;
  if (id && !bluetoothDevices.some((device) => device.deviceId === id)) return;
  const callback = bluetoothCallback;
  bluetoothCallback = undefined;
  bluetoothDevices = [];
  clearTimeout(bluetoothTimer);
  window!.webContents.send('desktop:bluetooth-devices', null);
  callback(id);
});
ipcMain.on('desktop:bluetooth-response', (event, response) => {
  if (
    !trustedSender(event) ||
    !pairingCallback ||
    !response ||
    typeof response.confirmed !== 'boolean' ||
    (response.pin !== undefined && (typeof response.pin !== 'string' || !/^\d{1,16}$/.test(response.pin)))
  )
    return;
  const callback = pairingCallback;
  pairingCallback = undefined;
  clearTimeout(pairingTimer);
  window!.webContents.send('desktop:bluetooth-pairing', null);
  callback({ confirmed: response.confirmed, pin: response.pin });
});
ipcMain.on('desktop:bluetooth-cancel', (event) => {
  if (trustedSender(event)) cancelBluetooth();
});

app
  .whenReady()
  .then(() => {
    protocol.handle('app', async (request) => {
      const filename = resourcePath(path.join(app.getAppPath(), 'dist'), request.url);
      if (!filename || !['GET', 'HEAD'].includes(request.method))
        return new Response('Not found', { status: 404 });
      try {
        const response = await net.fetch(pathToFileURL(filename).href, { method: request.method });
        const headers = new Headers(response.headers);
        headers.set(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; worker-src 'self' blob:; font-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-src 'none'",
        );
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        {
          role: 'editMenu',
          submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
        },
        {
          role: 'viewMenu',
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { role: 'togglefullscreen' },
            ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
          ],
        },
        { role: 'windowMenu' },
      ]),
    );
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  quitRequested = true;
});
