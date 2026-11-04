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
  setDocumentState: (dirty, language) => ipcRenderer.send('desktop:state', { dirty, language }),
  onBluetoothDevices: (listener) => subscribe('desktop:bluetooth-devices', listener),
  selectBluetoothDevice: (id) => ipcRenderer.send('desktop:bluetooth-select', id),
  onBluetoothPairing: (listener) => subscribe('desktop:bluetooth-pairing', listener),
  respondBluetoothPairing: (response) => ipcRenderer.send('desktop:bluetooth-response', response),
  cancelBluetooth: () => ipcRenderer.send('desktop:bluetooth-cancel'),
};

contextBridge.exposeInMainWorld('routeStudioDesktop', api);
