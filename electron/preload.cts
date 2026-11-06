import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { DesktopAPI } from './contracts.js';

function subscribe<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: DesktopAPI = {
  platform: process.platform,
  getZoomFactor: () => webFrame.getZoomFactor(),
  setTheme: (theme) => ipcRenderer.send('desktop:theme', theme),
  openFile: () => ipcRenderer.invoke('desktop:open'),
  saveFile: (file) => ipcRenderer.invoke('desktop:save', file),
  setDocumentState: (dirty, language, busy, transferBusy) =>
    ipcRenderer.send('desktop:state', { dirty, language, busy, transferBusy }),
  getUpdateState: () => ipcRenderer.invoke('desktop:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:update-check'),
  setUpdateAutoCheck: (enabled) => ipcRenderer.invoke('desktop:update-auto-check', enabled),
  downloadUpdate: () => ipcRenderer.invoke('desktop:update-download'),
  openUpdateDownload: () => ipcRenderer.invoke('desktop:update-open'),
  installUpdate: (discard) => ipcRenderer.invoke('desktop:update-install', discard),
  onUpdateState: (listener) => subscribe('desktop:update-state', listener),
  setCommandState: (state) => ipcRenderer.send('desktop:commands', state),
  onCommand: (listener) => subscribe('desktop:command', listener),
  onBluetoothDevices: (listener) => subscribe('desktop:bluetooth-devices', listener),
  selectBluetoothDevice: (id) => ipcRenderer.send('desktop:bluetooth-select', id),
  onBluetoothPairing: (listener) => subscribe('desktop:bluetooth-pairing', listener),
  respondBluetoothPairing: (response) => ipcRenderer.send('desktop:bluetooth-response', response),
  cancelBluetooth: () => ipcRenderer.send('desktop:bluetooth-cancel'),
  onSerialPorts: (listener) => subscribe('desktop:serial-ports', listener),
  selectSerialPort: (id) => ipcRenderer.send('desktop:serial-select', id),
  cancelSerial: () => ipcRenderer.send('desktop:serial-cancel'),
};

contextBridge.exposeInMainWorld('routeStudioDesktop', api);
