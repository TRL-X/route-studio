import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron';
import { readFile, open, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createUpdates } from './updates.cjs';
import type { UpdateService } from './update-service.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  appURL,
  developmentURL,
  extensions,
  hasSupportedExtension,
  isAppURL,
  maxFileBytes,
  resourcePath,
  validFilename,
} from './security.js';
import type { BluetoothChoice, DesktopFile, PairingRequest, SerialChoice } from './contracts.js';
import {
  commandDefinitions,
  commandGroups,
  commandIds,
  type CommandId,
  type DesktopCommandState,
} from './commands.js';

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
let documentStateKnown = false;
let activityBusy = true;
let transferBusy = false;
let updates: UpdateService | undefined;
let bluetoothDevices: BluetoothChoice[] = [];
let bluetoothCallback: ((id: string) => void) | undefined;
let pairingCallback: ((response: { confirmed: boolean; pin?: string }) => void) | undefined;
let bluetoothTimer: ReturnType<typeof setTimeout> | undefined;
let pairingTimer: ReturnType<typeof setTimeout> | undefined;
let serialPorts: SerialChoice[] = [];
let serialCallback: ((id: string) => void) | undefined;
let serialTimer: ReturnType<typeof setTimeout> | undefined;
let commandState: DesktopCommandState = {
  language,
  enabled: Object.fromEntries(commandIds.map((id) => [id, false])) as Record<CommandId, boolean>,
};
let menuVersion = 0;

async function updateCommandMenu() {
  const version = ++menuVersion;
  const labels: Record<string, string> = JSON.parse(
    await readFile(
      path.join(
        app.getAppPath(),
        'src/i18n',
        `${commandState.language === 'zh' ? 'zh-CN' : 'en'}.commands.desktop.json`,
      ),
      'utf8',
    ),
  );
  if (version !== menuVersion) return;
  const item = (id: CommandId): Electron.MenuItemConstructorOptions => ({
    id: `command:${id}`,
    label: labels[id],
    accelerator: commandDefinitions.find((command) => command.id === id)?.accelerator,
    type: commandDefinitions.find((command) => command.id === id)?.type,
    checked: commandState.checked?.[id] ?? false,
    enabled: commandState.enabled[id],
    click: () => {
      if (
        !commandState.enabled[id] ||
        fileDialogOpen ||
        !window ||
        window.isDestroyed() ||
        window.webContents.isDestroyed() ||
        !trustedURL(window.webContents.getURL())
      )
        return;
      window.webContents.send('desktop:command', id);
    },
  });
  const groups: Electron.MenuItemConstructorOptions[] = commandGroups.map((group) => {
    const submenu: Electron.MenuItemConstructorOptions[] = commandDefinitions
      .filter((command) => command.group === group)
      .flatMap(({ id, separatorBefore }) =>
        separatorBefore ? [{ type: 'separator' }, item(id)] : [item(id)],
      );
    if (group === 'file' && process.platform !== 'darwin')
      submenu.push({ type: 'separator' }, item('settings'));
    if (group === 'edit')
      submenu.push(
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      );
    if (group === 'view')
      submenu.push(
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
      );
    return { label: labels[group], submenu };
  });
  if (process.platform === 'darwin')
    groups.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        item('settings'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  Menu.setApplicationMenu(Menu.buildFromTemplate([...groups, { role: 'windowMenu' }]));
}

function disableCommands() {
  commandState = {
    language,
    enabled: Object.fromEntries(commandIds.map((id) => [id, false])) as Record<CommandId, boolean>,
  };
  void updateCommandMenu().catch(console.error);
}

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

function cancelSerial() {
  const callback = serialCallback;
  serialCallback = undefined;
  serialPorts = [];
  clearTimeout(serialTimer);
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    callback?.('');
    window.webContents.send('desktop:serial-ports', null);
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
  transferBusy = false;
  documentStateKnown = false;
  activityBusy = true;
  closing = false;
  const current = new BrowserWindow({
    title: 'Route Studio',
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: nativeTheme.shouldUseDarkColors ? '#111113' : '#ffffff',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ededed' : '#242424',
      height: 48,
    },
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 17 } }
      : { autoHideMenuBar: true }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#ffffff',
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
  const nativeSession = current.webContents.session;
  current.webContents.on('render-process-gone', () => {
    documentStateKnown = false;
    transferBusy = false;
    cancelSerial();
  });
  current.once('ready-to-show', () => current.show());
  current.on('close', (event) => {
    if (transferBusy) {
      event.preventDefault();
      quitRequested = false;
      return;
    }
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
    nativeSession.off('select-serial-port', selectSerial);
    nativeSession.off('serial-port-added', serialAdded);
    nativeSession.off('serial-port-removed', serialRemoved);
    window = null;
    cancelBluetooth();
    cancelSerial();
    disableCommands();
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
    if (isMainFrame && !isInPlace) {
      transferBusy = false;
      cancelBluetooth();
      cancelSerial();
      disableCommands();
    }
  });
  // Serial access still requires selection in the explicit port chooser.
  current.webContents.session.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      permission === 'serial' &&
      contents === current.webContents &&
      details.isMainFrame &&
      trustedURL(details.requestingUrl ?? origin) &&
      trustedURL(origin),
  );
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
  const portChoice = ({ portId, portName, displayName }: Electron.SerialPort): SerialChoice => ({
    portId,
    portName,
    displayName,
  });
  const selectSerial = (
    event: Electron.Event,
    ports: Electron.SerialPort[],
    contents: Electron.WebContents,
    callback: (id: string) => void,
  ) => {
    event.preventDefault();
    if (contents !== current.webContents || !trustedURL(contents.getURL())) {
      callback('');
      return;
    }
    cancelSerial();
    serialCallback = callback;
    serialPorts = ports.map(portChoice);
    serialTimer = setTimeout(cancelSerial, 60000);
    contents.send('desktop:serial-ports', serialPorts);
  };
  const serialAdded = (_event: Electron.Event, port: Electron.SerialPort, contents: Electron.WebContents) => {
    if (!serialCallback || contents !== current.webContents) return;
    serialPorts = [...serialPorts.filter((item) => item.portId !== port.portId), portChoice(port)];
    contents.send('desktop:serial-ports', serialPorts);
  };
  const serialRemoved = (
    _event: Electron.Event,
    port: Electron.SerialPort,
    contents: Electron.WebContents,
  ) => {
    if (!serialCallback || contents !== current.webContents) return;
    serialPorts = serialPorts.filter((item) => item.portId !== port.portId);
    contents.send('desktop:serial-ports', serialPorts);
  };
  current.webContents.session.on('select-serial-port', selectSerial);
  current.webContents.session.on('serial-port-added', serialAdded);
  current.webContents.session.on('serial-port-removed', serialRemoved);
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
    // The native picker supplies this path. Save-name restrictions would reject
    // existing files with valid platform-specific names (for example '?' on macOS).
    if (!hasSupportedExtension(filename)) throw new Error('Unsupported file');
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

function updateAppearance() {
  if (!window || window.isDestroyed()) return;
  const color = nativeTheme.shouldUseDarkColors ? '#111113' : '#ffffff';
  window.setBackgroundColor(color);
  if (process.platform !== 'darwin') {
    window.setTitleBarOverlay({
      color,
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ededed' : '#242424',
    });
  }
}
nativeTheme.on('updated', updateAppearance);
ipcMain.on('desktop:theme', (event, theme) => {
  if (!trustedSender(event) || !['system', 'light', 'dark'].includes(theme)) return;
  nativeTheme.themeSource = theme;
  updateAppearance();
});

ipcMain.on('desktop:state', (event, state) => {
  if (
    !trustedSender(event) ||
    !state ||
    typeof state.dirty !== 'boolean' ||
    typeof state.busy !== 'boolean' ||
    (state.transferBusy !== undefined && typeof state.transferBusy !== 'boolean') ||
    !['en', 'zh'].includes(state.language)
  )
    return;
  dirty = state.dirty;
  activityBusy = state.busy;
  transferBusy = state.transferBusy ?? false;
  documentStateKnown = true;
  language = state.language;
  window!.setDocumentEdited(dirty);
});
ipcMain.on('desktop:commands', (event, state: DesktopCommandState) => {
  if (
    !trustedSender(event) ||
    !state ||
    !['en', 'zh'].includes(state.language) ||
    !state.enabled ||
    commandIds.some((id) => typeof state.enabled[id] !== 'boolean') ||
    Object.keys(state.enabled).length !== commandIds.length ||
    (state.checked !== undefined &&
      (!state.checked ||
        typeof state.checked !== 'object' ||
        Array.isArray(state.checked) ||
        Object.entries(state.checked).some(
          ([id, checked]) => !commandIds.includes(id as CommandId) || typeof checked !== 'boolean',
        )))
  )
    return;
  commandState = {
    language: state.language,
    enabled: { ...state.enabled },
    checked: { ...state.checked },
  };
  void updateCommandMenu().catch(console.error);
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
ipcMain.on('desktop:serial-select', (event, id) => {
  if (!trustedSender(event) || typeof id !== 'string' || !serialCallback) return;
  if (id && !serialPorts.some((port) => port.portId === id)) return;
  const callback = serialCallback;
  serialCallback = undefined;
  serialPorts = [];
  clearTimeout(serialTimer);
  window!.webContents.send('desktop:serial-ports', null);
  callback(id);
});
ipcMain.on('desktop:serial-cancel', (event) => {
  if (trustedSender(event)) cancelSerial();
});

for (const action of ['state', 'check', 'auto-check', 'download', 'open', 'install'] as const) {
  ipcMain.handle(`desktop:update-${action}`, (event, value: unknown) => {
    if (!trustedSender(event) || !updates) throw new Error('Updates unavailable');
    switch (action) {
      case 'state':
        return updates.snapshot();
      case 'check':
        return updates.check();
      case 'download':
        return updates.download();
      case 'open':
        return updates.open();
      case 'auto-check':
      case 'install':
        if (typeof value !== 'boolean') throw new Error('Invalid update request');
        return action === 'install' ? updates.install(value) : updates.setAutoCheck(value);
    }
  });
}

app
  .whenReady()
  .then(async () => {
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
    disableCommands();
    updates = await createUpdates({
      publish: (state) => {
        if (
          window &&
          !window.isDestroyed() &&
          !window.webContents.isDestroyed() &&
          trustedURL(window.webContents.getURL())
        )
          window.webContents.send('desktop:update-state', state);
      },
      canInstall: (discard) => {
        if (
          !documentStateKnown ||
          activityBusy ||
          fileDialogOpen ||
          bluetoothCallback ||
          pairingCallback ||
          serialCallback ||
          !window ||
          window.isDestroyed() ||
          window.webContents.isDestroyed()
        )
          return 'busy';
        return dirty && !discard ? 'unsaved' : null;
      },
      setInstalling: (installing) => {
        closing = installing;
      },
    });
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
