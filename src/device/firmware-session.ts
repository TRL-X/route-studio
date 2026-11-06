import { DeviceError, type SmpRequest } from './mcumgr';
import { BluetoothSession } from './bluetooth-session';
import { connectSerial, type SerialConnection } from './serial';
import {
  FirmwareClient,
  FirmwareError,
  MAX_FIRMWARE_SIZE,
  parseFirmware,
  sameHash,
  type FirmwareImage,
  type ImageState,
} from './firmware';

export type FirmwareMode = 'ble' | 'usb';
export type FirmwarePhase =
  | 'ready'
  | 'paused'
  | 'uploaded'
  | 'awaitingReconnect'
  | 'unconfirmed'
  | 'complete'
  | 'recovered'
  | 'reverted'
  | 'unknown';
export interface FirmwareSnapshot {
  mode: FirmwareMode;
  busy: 'file' | 'connecting' | 'uploading' | 'checking' | 'restarting' | 'confirming' | null;
  connected: boolean;
  remembered: boolean;
  deviceName: string;
  filename: string;
  image?: FirmwareImage;
  images: ImageState[];
  phase: FirmwarePhase;
  off: number;
  stopping: boolean;
  recoveryRestarted: boolean;
  pending: boolean;
  error?: unknown;
}

export class FirmwareSession {
  private state: FirmwareSnapshot = {
    mode: 'ble',
    busy: null,
    connected: false,
    remembered: false,
    deviceName: '',
    filename: '',
    images: [],
    phase: 'ready',
    off: 0,
    stopping: false,
    recoveryRestarted: false,
    pending: false,
  };
  private listeners = new Set<() => void>();
  private connection?: { request: SmpRequest; close: () => void | Promise<void> };
  private readonly bluetooth: BluetoothSession;
  private readonly ownsBluetooth: boolean;
  private readonly unsubscribe: () => void;
  private bluetoothTarget?: string;
  constructor(bluetooth?: BluetoothSession) {
    this.ownsBluetooth = !bluetooth;
    this.bluetooth = bluetooth ?? new BluetoothSession();
    this.unsubscribe = this.bluetooth.subscribe(() => this.syncBluetooth());
    this.syncBluetooth();
  }
  private syncBluetooth() {
    if (this.state.mode !== 'ble') return;
    const connection = this.bluetooth.snapshot();
    const target = this.bluetooth.rememberedDevice()?.id;
    const changed = connection.connected && target !== this.bluetoothTarget;
    if (changed) {
      this.bluetoothTarget = target;
      this.attemptedBoot = false;
      this.originalHash = undefined;
    }
    this.publish({
      connected: connection.connected,
      remembered: connection.remembered,
      deviceName: connection.deviceName,
      ...(!connection.connected && { images: [] }),
      ...(changed && { phase: 'ready', off: 0, images: [], recoveryRestarted: false, error: undefined }),
    });
  }
  private previousSerial?: SerialConnection['port'];
  private lifetime = new AbortController();
  private stopRequested = false;
  private expectedReset = false;
  private attemptedBoot = false;
  private originalHash?: Uint8Array;
  private disposed = false;
  private closing: Promise<void> = Promise.resolve();
  private reconnect?: AbortController;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private publish(values: Partial<FirmwareSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...values };
    this.state.pending = ['paused', 'uploaded', 'awaitingReconnect', 'unconfirmed', 'unknown'].includes(
      this.state.phase,
    );
    this.listeners.forEach((listener) => listener());
  }
  private async run(busy: NonNullable<FirmwareSnapshot['busy']>, action: () => Promise<void>) {
    if (this.state.busy || this.disposed || !this.bluetooth.claim('firmware')) return;
    this.publish({ busy, error: undefined });
    try {
      await action();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.publish({ error });
    } finally {
      this.publish({ busy: null, stopping: false });
      if (!this.state.pending) this.bluetooth.release('firmware');
    }
  }
  setMode = async (mode: FirmwareMode) => {
    if (this.state.mode === mode || this.state.pending) return;
    await this.run('checking', async () => {
      if (this.state.mode === 'usb') await this.closeSerial();
      this.attemptedBoot = false;
      this.originalHash = undefined;
      this.publish({
        mode,
        connected: false,
        deviceName: '',
        images: [],
        phase: 'ready',
        off: 0,
        error: undefined,
        recoveryRestarted: false,
        remembered: !!this.previousSerial,
      });
      this.syncBluetooth();
    });
  };
  chooseAnother = () =>
    this.run('checking', async () => {
      if (this.state.pending) return;
      if (this.state.mode === 'ble') this.bluetooth.forget('firmware');
      else {
        await this.closeSerial();
        this.previousSerial = undefined;
      }
      this.attemptedBoot = false;
      this.originalHash = undefined;
      this.publish({
        remembered: false,
        deviceName: '',
        images: [],
        phase: 'ready',
        off: 0,
        recoveryRestarted: false,
      });
    });
  abandon = () => {
    if (this.state.busy) return;
    this.attemptedBoot = false;
    this.originalHash = undefined;
    this.publish({
      image: undefined,
      filename: '',
      phase: 'ready',
      off: 0,
      recoveryRestarted: false,
      error: undefined,
    });
    this.bluetooth.release('firmware');
  };
  selectFile = (file: Pick<File, 'name' | 'size' | 'arrayBuffer'>) =>
    this.run('file', async () => {
      if (this.state.pending) return;
      // A failed selection must not leave a different file available for upload.
      this.publish({ image: undefined, filename: '', off: 0, phase: 'ready', recoveryRestarted: false });
      this.attemptedBoot = false;
      this.originalHash = undefined;
      if (!/\.bin$/i.test(file.name) || file.size > MAX_FIRMWARE_SIZE) throw new FirmwareError('invalidFile');
      const image = await parseFirmware(new Uint8Array(await file.arrayBuffer()));
      this.publish({ image, filename: file.name });
      if (this.state.connected && this.state.mode === 'ble') await this.readImages();
    });
  private client() {
    if (this.state.mode === 'ble') return new FirmwareClient(this.bluetooth.request('firmware', 1));
    if (!this.connection) throw new DeviceError('disconnected');
    return new FirmwareClient(this.connection.request);
  }
  private async open() {
    if (this.state.mode === 'ble') {
      await this.bluetooth.ensure('firmware');
      return;
    }
    this.lifetime = new AbortController();
    const signal = this.lifetime.signal;
    const lost = () => {
      if (signal.aborted || signal !== this.lifetime.signal) return;
      const link = this.connection;
      this.connection = undefined;
      if (link) this.closing = Promise.resolve(link.close()).catch(() => {});
      this.publish({
        connected: false,
        ...(!this.expectedReset && { error: new DeviceError('disconnected') }),
      });
    };
    if (this.previousSerial) await this.closing;
    const link = await connectSerial(signal, lost, this.previousSerial);
    if (signal.aborted || this.disposed) {
      await link.close();
      signal.throwIfAborted();
      return;
    }
    this.previousSerial = link.port;
    this.connection = link;
    this.publish({ connected: true, remembered: true, deviceName: link.name });
  }
  connect = () =>
    this.run('connecting', async () => {
      if (!this.state.connected) await this.open();
      if (this.state.mode === 'ble') await this.readImages();
    });
  cancelConnection = () => {
    this.reconnect?.abort();
    if (this.reconnect) this.bluetooth.disconnect('firmware');
    if (this.state.mode === 'ble') this.bluetooth.cancelConnection();
    else this.lifetime.abort();
  };
  private closeSerial = async () => {
    const link = this.connection;
    this.connection = undefined;
    this.lifetime.abort();
    if (this.state.mode === 'usb') this.publish({ connected: false });
    if (link) this.closing = Promise.resolve(link.close()).catch(() => {});
    await this.closing;
  };
  disconnect = async () => {
    if (this.state.busy || this.state.pending) return;
    if (this.state.mode === 'ble') this.bluetooth.disconnect();
    else await this.closeSerial();
  };
  dispose = () => {
    this.disposed = true;
    this.stopRequested = true;
    this.reconnect?.abort();
    this.unsubscribe();
    this.bluetooth.release('firmware');
    if (this.ownsBluetooth) this.bluetooth.dispose();
    void this.closeSerial();
    this.listeners.clear();
  };
  private async readImages(settling = false) {
    const images = await this.client().list();
    const image = this.state.image;
    this.publish({ images });
    if (!image) return;
    const target = images.find(
      (item) => item.image === 0 && item.active && sameHash(item.hash, image.imageHash),
    );
    if (target) {
      this.publish({ phase: target.confirmed ? 'complete' : 'unconfirmed' });
    } else if (this.attemptedBoot) {
      const pending = images.some(
        (item) => item.image === 0 && item.pending && sameHash(item.hash, image.imageHash),
      );
      const original = images.some(
        (item) => item.image === 0 && item.active && sameHash(item.hash, this.originalHash),
      );
      this.publish({ phase: pending || settling ? 'awaitingReconnect' : original ? 'reverted' : 'unknown' });
    } else if (['complete', 'unconfirmed'].includes(this.state.phase)) {
      this.publish({ phase: 'ready' });
    }
  }
  check = () =>
    this.run(this.state.connected ? 'checking' : 'connecting', async () => {
      if (!this.state.connected) await this.open();
      await this.readImages();
    });
  upload = () => this.run('uploading', () => this.uploadImage());
  private async uploadImage() {
    const image = this.state.image;
    if (!image || !this.state.connected || this.attemptedBoot) return;
    this.stopRequested = false;
    if (this.state.mode === 'ble') {
      await this.readImages();
      if (this.state.phase === 'complete' || this.state.phase === 'unconfirmed') return;
      const active = this.state.images.find((item) => item.image === 0 && item.active);
      this.originalHash = active?.hash?.slice();
      if (active && !active.confirmed) throw new FirmwareError('unconfirmedImage');
    }
    this.publish({ phase: 'paused', off: 0 });
    const complete = await this.client().upload(
      image,
      (off) => this.publish({ off }),
      () => this.stopRequested,
    );
    if (!complete) return;
    if (this.state.mode === 'usb') {
      this.publish({ phase: 'recovered' });
    } else {
      const images = await this.client().list();
      this.publish({ images });
      if (!images.some((item) => item.image === 0 && !item.active && sameHash(item.hash, image.imageHash))) {
        throw new FirmwareError('uploadMismatch');
      }
      this.publish({ phase: 'uploaded' });
    }
  }
  update = () =>
    this.run('connecting', async () => {
      if (this.state.mode !== 'ble' || !this.state.image) return;
      if (!this.state.connected) await this.open();
      if (['ready', 'paused', 'reverted'].includes(this.state.phase)) {
        this.publish({ busy: 'uploading' });
        await this.uploadImage();
      }
      if (this.state.phase !== 'uploaded') return;
      this.publish({ busy: 'restarting' });
      await this.startTrial();
      this.publish({ busy: 'connecting' });
      const retries = new AbortController();
      this.reconnect = retries;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          retries.signal.throwIfAborted();
          await new Promise<void>((resolve, reject) => {
            const aborted = () => {
              clearTimeout(timer);
              reject(retries.signal.reason);
            };
            const timer = setTimeout(() => {
              retries.signal.removeEventListener('abort', aborted);
              resolve();
            }, 750);
            retries.signal.addEventListener('abort', aborted, { once: true });
          });
          if (this.disposed) return;
          try {
            if (!this.state.connected) await this.open();
            await this.readImages(true);
            if (this.snapshot().phase !== 'awaitingReconnect') return;
          } catch (error) {
            if (attempt === 2 || retries.signal.aborted) throw error;
          }
        }
      } finally {
        this.reconnect = undefined;
      }
    });
  pause = () => {
    if (this.state.busy !== 'uploading') return;
    this.stopRequested = true;
    this.publish({ stopping: true });
  };
  private async reset() {
    this.expectedReset = true;
    try {
      await this.client().reset();
    } catch (error) {
      // A reboot can close the transport before its response is delivered.
      if (!(error instanceof DeviceError && ['disconnected', 'timeout'].includes(error.kind))) throw error;
    } finally {
      if (this.state.mode === 'ble') this.bluetooth.disconnect('firmware');
      else await this.closeSerial();
      this.expectedReset = false;
    }
  }
  testAndRestart = () => this.run('restarting', () => this.startTrial());
  private async startTrial() {
    if (!this.state.image || this.state.mode !== 'ble' || this.state.phase !== 'uploaded') return;
    const images = await this.client().markTest(this.state.image.imageHash);
    if (
      !images.some(
        (item) => item.image === 0 && item.pending && sameHash(item.hash, this.state.image!.imageHash),
      )
    ) {
      throw new FirmwareError('uploadMismatch');
    }
    this.attemptedBoot = true;
    this.publish({ phase: 'awaitingReconnect' });
    await this.reset();
  }
  confirm = () =>
    this.run('confirming', async () => {
      if (this.state.mode !== 'ble' || !this.state.image) return;
      await this.readImages();
      const active = this.state.images.find((item) => item.image === 0 && item.active);
      if (!active || !sameHash(active.hash, this.state.image.imageHash) || active.confirmed) return;
      await this.client().confirm();
      await this.readImages();
      if (this.snapshot().phase !== 'complete') throw new FirmwareError('uploadMismatch');
    });
  restartPending = () =>
    this.run('restarting', async () => {
      if (this.state.mode !== 'ble' || !this.state.image) return;
      await this.readImages();
      if (
        !this.state.images.some(
          (item) => item.image === 0 && item.pending && sameHash(item.hash, this.state.image!.imageHash),
        )
      )
        return;
      this.attemptedBoot = true;
      this.publish({ phase: 'awaitingReconnect' });
      await this.reset();
    });
  restartRecovery = () =>
    this.run('restarting', async () => {
      if (this.state.mode !== 'usb' || this.state.phase !== 'recovered') return;
      await this.reset();
      this.publish({ recoveryRestarted: true });
    });
}
