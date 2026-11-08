import { DeviceError, abortable, delay, type SmpRequest } from './smp';
import { DeviceConnectionSession } from './connection-session';
import { transportSupported, type TransportKind, type DeviceMode } from './config';
import {
  FirmwareClient,
  FirmwareError,
  parseFirmware,
  sameHash,
  type FirmwareImage,
  type ImageState,
} from './firmware';

export type FirmwareMode = DeviceMode;
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
  transport: TransportKind;
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
    mode: 'application',
    transport: 'ble',
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
  readonly connectionSession: DeviceConnectionSession;
  private readonly ownsConnection: boolean;
  private readonly unsubscribe: () => void;
  private connectionTarget?: string;
  constructor(connectionSession?: DeviceConnectionSession) {
    this.ownsConnection = !connectionSession;
    this.connectionSession = connectionSession ?? new DeviceConnectionSession();
    this.unsubscribe = this.connectionSession.subscribe(() => this.syncConnection());
    this.syncConnection();
  }
  private syncConnection() {
    const connection = this.connectionSession.snapshot();
    const target = connection.target;
    const changed =
      connection.mode !== this.state.mode || (connection.connected && target !== this.connectionTarget);
    if (changed) {
      this.connectionTarget = target;
      this.attemptedBoot = false;
      this.originalHash = undefined;
    }
    this.publish({
      mode: connection.mode,
      transport: connection.transport,
      connected: connection.connected,
      remembered: connection.remembered,
      deviceName: connection.deviceName,
      ...(!connection.connected && { images: [] }),
      ...(changed && { phase: 'ready', off: 0, images: [], recoveryRestarted: false, error: undefined }),
    });
  }
  private stopRequested = false;
  private attemptedBoot = false;
  private originalHash?: Uint8Array;
  private disposed = false;
  private reconnect?: AbortController;
  private bootStartedAt?: number;
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
    if (this.state.busy || this.disposed || !this.connectionSession.claim('firmware')) return;
    this.publish({ busy, error: undefined });
    try {
      await action();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.publish({ error });
    } finally {
      this.publish({ busy: null, stopping: false });
      if (!this.state.pending) this.connectionSession.release('firmware');
    }
  }
  setMode = async (mode: FirmwareMode) => {
    if (this.state.mode === mode || this.state.pending || this.state.busy) return;
    if (!this.connectionSession.setMode(mode)) return;
    this.attemptedBoot = false;
    this.originalHash = undefined;
    this.publish({ images: [], phase: 'ready', off: 0, error: undefined, recoveryRestarted: false });
  };
  chooseAnother = () =>
    this.run('checking', async () => {
      if (this.state.pending) return;
      this.connectionSession.forget('firmware');
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
    this.connectionSession.release('firmware');
  };
  selectFile = (file: Pick<File, 'name' | 'size' | 'arrayBuffer'>) =>
    this.run('file', async () => {
      if (this.state.pending) return;
      // A failed selection must not leave a different file available for upload.
      this.publish({ image: undefined, filename: '', off: 0, phase: 'ready', recoveryRestarted: false });
      this.attemptedBoot = false;
      this.originalHash = undefined;
      if (
        !/\.bin$/i.test(file.name) ||
        file.size > this.connectionSession.snapshot().profile.maxFirmwareBytes
      )
        throw new FirmwareError('invalidFile');
      const image = await parseFirmware(
        new Uint8Array(await file.arrayBuffer()),
        this.connectionSession.snapshot().profile.maxFirmwareBytes,
      );
      this.publish({ image, filename: file.name });
      if (this.state.connected && this.state.mode === 'application') await this.readImages();
    });
  private client(signal?: AbortSignal) {
    const profile = this.connectionSession.snapshot().profile;
    const request = this.connectionSession.request('firmware');
    const bounded: SmpRequest = (group, command, op, fields, _version, options) =>
      request(group, command, op, fields, undefined, { ...options, ...(signal && { signal }) });
    return new FirmwareClient(
      bounded,
      profile.firmwareChunkBytes,
      profile,
      this.connectionSession.packetLimit(),
      this.state.mode === 'recovery',
    );
  }
  private open(signal?: AbortSignal) {
    return this.connectionSession.ensure('firmware', false, signal);
  }
  supported = () => transportSupported(this.state.transport);
  connect = () =>
    this.run('connecting', async () => {
      if (!this.state.connected) await this.open();
      if (this.state.mode === 'application') await this.readImages();
    });
  cancelConnection = () => {
    this.reconnect?.abort();
    this.connectionSession.cancelConnection();
    if (this.reconnect) this.connectionSession.disconnect('firmware');
  };
  disconnect = async () => {
    if (!this.state.busy && !this.state.pending) this.connectionSession.disconnect();
  };
  dispose = () => {
    this.disposed = true;
    this.stopRequested = true;
    this.reconnect?.abort();
    this.unsubscribe();
    this.connectionSession.release('firmware');
    if (this.ownsConnection) this.connectionSession.dispose();
    this.listeners.clear();
  };
  private async readImages(settling = false, signal?: AbortSignal) {
    const images = await this.client(signal).list();
    signal?.throwIfAborted();
    const image = this.state.image;
    this.publish({ images });
    if (!image) return;
    const target = images.find(
      (item) =>
        item.image === this.connectionSession.snapshot().profile.imageIndex &&
        item.active &&
        sameHash(item.hash, image.imageHash),
    );
    if (target) {
      this.publish({ phase: target.confirmed ? 'complete' : 'unconfirmed' });
    } else if (this.attemptedBoot) {
      const pending = images.some(
        (item) =>
          item.image === this.connectionSession.snapshot().profile.imageIndex &&
          item.pending &&
          sameHash(item.hash, image.imageHash),
      );
      const original = images.some(
        (item) =>
          item.image === this.connectionSession.snapshot().profile.imageIndex &&
          item.active &&
          sameHash(item.hash, this.originalHash),
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
    if (image.size > this.connectionSession.snapshot().profile.maxFirmwareBytes)
      throw new FirmwareError('invalidFile');
    this.stopRequested = false;
    if (this.state.mode === 'application') {
      await this.readImages();
      if (this.state.phase === 'complete' || this.state.phase === 'unconfirmed') return;
      const active = this.state.images.find(
        (item) => item.image === this.connectionSession.snapshot().profile.imageIndex && item.active,
      );
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
    if (this.state.mode === 'recovery') {
      this.publish({ phase: 'recovered' });
    } else {
      const images = await this.client().list();
      this.publish({ images });
      if (
        !images.some(
          (item) =>
            item.image === this.connectionSession.snapshot().profile.imageIndex &&
            !item.active &&
            sameHash(item.hash, image.imageHash),
        )
      ) {
        throw new FirmwareError('uploadMismatch');
      }
      this.publish({ phase: 'uploaded' });
    }
  }
  update = () =>
    this.run('connecting', async () => {
      if (this.state.mode !== 'application' || !this.state.image) return;
      if (!this.state.connected) await this.open();
      if (['ready', 'paused', 'reverted'].includes(this.state.phase)) {
        this.publish({ busy: 'uploading' });
        await this.uploadImage();
      }
      if (this.state.phase !== 'uploaded') return;
      if (this.connectionSession.snapshot().profile.activation === 'upload-only') return;
      this.publish({ busy: 'restarting' });
      await this.startTrial();
      await this.waitForBoot();
    });
  activate = () =>
    this.run('restarting', async () => {
      if (this.state.mode !== 'application' || this.state.phase !== 'uploaded') return;
      await this.startTrial();
      await this.waitForBoot();
    });
  continueWaiting = () =>
    this.run('connecting', async () => {
      if (this.state.mode !== 'application' || this.state.phase !== 'awaitingReconnect') return;
      this.bootStartedAt = Date.now();
      await this.waitForBoot();
    });
  private async waitForBoot() {
    this.publish({ busy: 'connecting' });
    const profile = this.connectionSession.snapshot().profile;
    const deadline = (this.bootStartedAt ?? Date.now()) + profile.bootWaitMs;
    const retries = new AbortController();
    this.reconnect = retries;
    try {
      await delay(Math.min(profile.bootInitialDelayMs, Math.max(0, deadline - Date.now())), retries.signal);
      while (Date.now() < deadline) {
        retries.signal.throwIfAborted();
        const attempt = new AbortController();
        const active = AbortSignal.any([retries.signal, attempt.signal]);
        const timer = setTimeout(
          () => attempt.abort(new DeviceError('timeout')),
          Math.min(profile.bootAttemptTimeoutMs, deadline - Date.now()),
        );
        try {
          if (!this.state.connected) await this.open(active);
          await abortable(this.readImages(true, active), active);
          if (this.snapshot().phase !== 'awaitingReconnect') return;
        } catch (error) {
          this.connectionSession.disconnect('firmware');
          retries.signal.throwIfAborted();
          // Unreachable endpoints are expected during the swap. Protocol and device errors are not.
          if (error instanceof DeviceError && !['timeout', 'disconnected'].includes(error.kind)) throw error;
        } finally {
          clearTimeout(timer);
        }
        await delay(Math.min(profile.bootRetryDelayMs, Math.max(0, deadline - Date.now())), retries.signal);
      }
      throw new FirmwareError('bootTimeout');
    } finally {
      this.reconnect = undefined;
    }
  }
  pause = () => {
    if (this.state.busy !== 'uploading') return;
    this.stopRequested = true;
    this.publish({ stopping: true });
  };
  private async reset() {
    try {
      await this.client().reset();
    } catch (error) {
      // A reboot can close the transport before its response is delivered.
      if (!(error instanceof DeviceError && ['disconnected', 'timeout'].includes(error.kind))) throw error;
    } finally {
      this.connectionSession.disconnect('firmware');
    }
  }
  testAndRestart = () => this.run('restarting', () => this.startTrial());
  private async startTrial() {
    if (!this.state.image || this.state.mode !== 'application' || this.state.phase !== 'uploaded') return;
    const images = await this.client().markTest(this.state.image.imageHash);
    if (
      !images.some(
        (item) =>
          item.image === this.connectionSession.snapshot().profile.imageIndex &&
          item.pending &&
          sameHash(item.hash, this.state.image!.imageHash),
      )
    ) {
      throw new FirmwareError('uploadMismatch');
    }
    this.attemptedBoot = true;
    this.publish({ phase: 'awaitingReconnect' });
    this.bootStartedAt = Date.now();
    await this.reset();
  }
  confirm = () =>
    this.run('confirming', async () => {
      if (this.state.mode !== 'application' || !this.state.image) return;
      await this.readImages();
      const active = this.state.images.find(
        (item) => item.image === this.connectionSession.snapshot().profile.imageIndex && item.active,
      );
      if (!active || !sameHash(active.hash, this.state.image.imageHash) || active.confirmed) return;
      await this.client().confirm(this.state.image.imageHash);
      await this.readImages();
      if (this.snapshot().phase !== 'complete') throw new FirmwareError('uploadMismatch');
    });
  restartPending = () =>
    this.run('restarting', async () => {
      if (this.state.mode !== 'application' || !this.state.image) return;
      await this.readImages();
      if (
        !this.state.images.some(
          (item) =>
            item.image === this.connectionSession.snapshot().profile.imageIndex &&
            item.pending &&
            sameHash(item.hash, this.state.image!.imageHash),
        )
      )
        return;
      this.attemptedBoot = true;
      this.publish({ phase: 'awaitingReconnect' });
      await this.reset();
    });
  restartRecovery = () =>
    this.run('restarting', async () => {
      if (this.state.mode !== 'recovery' || this.state.phase !== 'recovered') return;
      await this.reset();
      this.publish({ recoveryRestarted: true });
    });
}
