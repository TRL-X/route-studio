export interface DesktopFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface BluetoothChoice {
  deviceId: string;
  deviceName: string;
}

export interface PairingRequest {
  deviceId: string;
  pairingKind: 'confirm' | 'confirmPin' | 'providePin';
  pin?: string;
}

export interface DesktopAPI {
  readonly platform: string;
  getZoomFactor: () => number;
  setTheme: (theme: 'system' | 'light' | 'dark') => void;
  openFile: () => Promise<DesktopFile | null>;
  saveFile: (file: DesktopFile) => Promise<boolean>;
  setDocumentState: (dirty: boolean, language: 'en' | 'zh', busy: boolean) => void;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<UpdateState>;
  setUpdateAutoCheck: (enabled: boolean) => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  openUpdateDownload: () => Promise<UpdateState>;
  installUpdate: (discard: boolean) => Promise<UpdateState>;
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;
  setCommandState: (state: DesktopCommandState) => void;
  onCommand: (listener: (command: CommandId) => void) => () => void;
  onBluetoothDevices: (listener: (devices: BluetoothChoice[] | null) => void) => () => void;
  selectBluetoothDevice: (id: string) => void;
  onBluetoothPairing: (listener: (request: PairingRequest | null) => void) => () => void;
  respondBluetoothPairing: (response: { confirmed: boolean; pin?: string }) => void;
  cancelBluetooth: () => void;
}
import type { CommandId, DesktopCommandState } from './commands.js';
import type { UpdateState } from './update-contracts.js';
