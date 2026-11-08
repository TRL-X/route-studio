import { DeviceError } from './mcumgr';
import { DeviceConnectionSession } from './connection-session';
import { transportSupported, type TransportKind } from './config';
import { RouteClient, routeFailure, type Catalog, type RouteStatus } from './routes';
import { createUpload, terminalUpload, transferRoute, type UploadJob, type UploadProgress } from './upload';

export interface DeviceSnapshot {
  connected: boolean;
  transport: TransportKind;
  remembered: boolean;
  deviceName: string;
  busy: 'connecting' | 'refreshing' | 'uploading' | 'deleting' | null;
  status?: RouteStatus;
  catalog?: Catalog;
  progress?: UploadProgress;
  pending: boolean;
  totalBytes: number;
  transferBytes?: Uint8Array;
  completedId?: number;
  cancelling: boolean;
  error?: unknown;
}

// Shared by the send preview and device manager. Upload bytes stay fixed across views
// and reconnects; a pending transaction cannot be moved to a different device.
export class DeviceSession {
  private state: DeviceSnapshot = {
    connected: false,
    transport: 'ble',
    remembered: false,
    deviceName: '',
    busy: null,
    pending: false,
    cancelling: false,
    totalBytes: 0,
  };
  private listeners = new Set<() => void>();
  readonly connectionSession: DeviceConnectionSession;
  private readonly ownsConnection: boolean;
  private readonly unsubscribe: () => void;
  private connectionTarget?: string;
  constructor(connectionSession?: DeviceConnectionSession) {
    this.ownsConnection = !connectionSession;
    this.connectionSession = connectionSession ?? new DeviceConnectionSession();
    const sync = () => {
      const connection = this.connectionSession.snapshot();
      const target = connection.target;
      const changed =
        connection.connected && this.connectionTarget !== undefined && target !== this.connectionTarget;
      if (connection.connected) this.connectionTarget = target;
      this.update({
        connected: connection.connected && connection.mode === 'application',
        transport: connection.transport,
        remembered: connection.remembered,
        deviceName: connection.deviceName,
        ...(!connection.connected && { status: undefined, catalog: undefined }),
        ...(changed && {
          progress: undefined,
          transferBytes: undefined,
          completedId: undefined,
          totalBytes: 0,
          error: undefined,
        }),
      });
    };
    this.unsubscribe = this.connectionSession.subscribe(sync);
    sync();
  }
  private job?: UploadJob;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(values: Partial<DeviceSnapshot>) {
    this.state = { ...this.state, ...values };
    this.listeners.forEach((listener) => listener());
  }
  private client() {
    return new RouteClient(
      this.connectionSession.request('routes'),
      this.connectionSession.snapshot().profile,
      this.connectionSession.packetLimit(),
    );
  }
  private async run(busy: NonNullable<DeviceSnapshot['busy']>, action: () => Promise<void>) {
    if (this.state.busy || !this.connectionSession.claim('routes')) return;
    this.update({ busy, error: undefined });
    try {
      await action();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.update({ error });
    } finally {
      this.update({ busy: null });
      if (!this.job) this.connectionSession.release('routes');
    }
  }
  private async openConnection(chooseAnother = false) {
    if (chooseAnother)
      this.update({ progress: undefined, transferBytes: undefined, completedId: undefined, totalBytes: 0 });
    await this.connectionSession.ensure('routes', chooseAnother);
  }
  connect = (chooseAnother = false) =>
    this.run('connecting', async () => {
      if (chooseAnother && this.job) return;
      await this.openConnection(chooseAnother);
      await this.readCatalog();
    });
  supported = () => transportSupported(this.state.transport);
  cancelConnection = () => this.connectionSession.cancelConnection();
  disconnect = () => this.connectionSession.disconnect();
  dispose = () => {
    this.unsubscribe();
    this.connectionSession.release('routes');
    if (this.ownsConnection) this.connectionSession.dispose();
    this.listeners.clear();
  };
  private async readCatalog() {
    const client = this.client();
    const status = await client.status();
    this.update({ status, catalog: undefined });
    if (status.storage !== 'ready') throw routeFailure(status.error || 12);
    const catalog = await client.list();
    this.update({ catalog });
  }
  refresh = () => this.run('refreshing', () => this.readCatalog());
  delete = (id: number, rev: bigint) =>
    this.run('deleting', async () => {
      if (this.job) return;
      try {
        await this.client().delete(id, rev);
        if (id === this.state.completedId)
          this.update({ progress: undefined, transferBytes: undefined, completedId: undefined });
      } catch (error) {
        // Refresh an obsolete snapshot but never silently retry a destructive operation.
        await this.readCatalog().catch(() => {});
        throw error;
      }
      await this.readCatalog();
    });
  send = (bytes: Uint8Array) =>
    this.run(this.state.connected ? 'uploading' : 'connecting', async () => {
      if (this.job) return;
      // Freeze before the first await; exported bytes may be regenerated by the UI.
      const job = createUpload(bytes);
      this.update({
        transferBytes: job.bytes,
        completedId: undefined,
        progress: undefined,
        totalBytes: job.bytes.length,
      });
      if (!this.state.connected) await this.openConnection();
      this.update({ busy: 'uploading' });
      const status = await this.client().status();
      this.update({ status });
      if (status.storage !== 'ready') throw routeFailure(status.error || 12);
      if (!bytes.length || bytes.length > status.maxFileSize || status.count >= status.maxFiles)
        throw routeFailure(6);
      if (
        status.freeBytes <
        BigInt(bytes.length) + BigInt(this.connectionSession.snapshot().profile.routeReserveBytes)
      )
        throw routeFailure(5);
      this.job = job;
      this.update({ pending: true, progress: undefined, totalBytes: job.bytes.length });
      await this.upload();
    });
  resume = () =>
    this.run(this.state.connected ? 'uploading' : 'connecting', async () => {
      if (!this.job) return;
      if (!this.state.connected) await this.openConnection();
      this.update({ busy: 'uploading' });
      await this.upload();
    });
  cancel = () => {
    if (!this.job || this.job.remote?.state === 'verifying' || this.job.remote?.state === 'ready') return;
    this.job.cancelRequested = true;
    this.update({ cancelling: true });
    if (!this.state.busy) void this.resume();
  };
  abandon = () => {
    if (this.state.busy) return;
    this.job = undefined;
    this.update({
      pending: false,
      progress: undefined,
      transferBytes: undefined,
      totalBytes: 0,
      completedId: undefined,
      cancelling: false,
      error: undefined,
    });
    this.connectionSession.release('routes');
  };
  private async upload() {
    const job = this.job;
    if (!job) return;
    try {
      await transferRoute(this.client(), job, (progress) =>
        this.update({ progress, ...(progress.state === 'verifying' && { cancelling: false }) }),
      );
    } catch (error) {
      if (job.uploadId === undefined && error instanceof DeviceError && error.kind === 'device') {
        this.job = undefined;
        this.update({ pending: false, cancelling: false });
      }
      throw error;
    } finally {
      if (terminalUpload(job)) {
        this.job = undefined;
        this.update({
          pending: false,
          cancelling: false,
          completedId: job.remote!.state === 'ready' ? job.uploadId : undefined,
          ...(!['ready', 'cancelled'].includes(job.remote!.state) && { progress: undefined }),
        });
      }
    }
    // Upload success remains visible even if refreshing the catalog subsequently fails.
    await this.readCatalog();
  }
}
