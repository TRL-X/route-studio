import { connectBluetooth, DeviceError, type DeviceConnection, type SmpRequest } from './mcumgr';

export type DeviceTask = 'routes' | 'firmware';
export interface BluetoothSnapshot {
  connected: boolean;
  remembered: boolean;
  deviceName: string;
  busy: 'connecting' | null;
  task: DeviceTask | null;
  error?: unknown;
}

/** Owns the Bluetooth transport and reserves device operations across panels. */
export class BluetoothSession {
  private state: BluetoothSnapshot = {
    connected: false,
    remembered: false,
    deviceName: '',
    busy: null,
    task: null,
  };
  private listeners = new Set<() => void>();
  private connection?: DeviceConnection;
  private previous?: BluetoothDevice;
  private lifetime = new AbortController();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(values: Partial<BluetoothSnapshot>) {
    this.state = { ...this.state, ...values };
    this.listeners.forEach((listener) => listener());
  }
  claim(task: DeviceTask) {
    if (this.state.busy || (this.state.task && this.state.task !== task)) return false;
    this.update({ task });
    return true;
  }
  release(task: DeviceTask) {
    if (this.state.task === task) this.update({ task: null });
  }
  private allowed(task?: DeviceTask) {
    return !this.state.task || this.state.task === task;
  }
  request(task: DeviceTask, version: 1 | 2): SmpRequest {
    return (group, command, op, fields) => {
      if (!this.connection) return Promise.reject(new DeviceError('disconnected'));
      if (this.state.task !== task) return Promise.reject(new DeviceError('device', 0, 10));
      return this.connection.request(group, command, op, fields, version);
    };
  }
  async ensure(task?: DeviceTask, chooseAnother = false) {
    if (!this.allowed(task) || this.state.busy) throw new DeviceError('device', 0, 10);
    if (this.connection && !chooseAnother) return;
    this.drop();
    this.lifetime = new AbortController();
    const signal = this.lifetime.signal;
    this.update({ busy: 'connecting', error: undefined });
    try {
      // Start selection before awaiting so it retains the browser's user gesture.
      const link = await connectBluetooth(
        signal,
        () => {
          if (signal.aborted || signal !== this.lifetime.signal) return;
          this.drop();
          this.update({ error: new DeviceError('disconnected') });
        },
        chooseAnother ? undefined : this.previous,
      );
      if (signal.aborted || signal !== this.lifetime.signal) {
        link.close();
        signal.throwIfAborted();
        throw new DOMException('Connection cancelled', 'AbortError');
      }
      this.connection = link;
      this.previous = link.device;
      this.update({ connected: true, remembered: true, deviceName: link.device.name || link.device.id });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.update({ error });
      throw error;
    } finally {
      if (signal === this.lifetime.signal) this.update({ busy: null });
    }
  }
  connect = async (chooseAnother = false) => {
    if (this.state.task || this.state.busy) return;
    await this.ensure(undefined, chooseAnother).catch(() => {});
  };
  cancelConnection = () => {
    if (this.state.busy === 'connecting') this.lifetime.abort();
  };
  private drop() {
    const link = this.connection;
    this.connection = undefined;
    this.lifetime.abort();
    link?.close();
    this.update({ connected: false });
  }
  disconnect = (task?: DeviceTask) => {
    if (!this.allowed(task)) return;
    this.drop();
    this.update({ error: undefined });
  };
  forget(task: DeviceTask) {
    if (!this.allowed(task)) return;
    this.drop();
    this.previous = undefined;
    this.update({ remembered: false, deviceName: '', error: undefined });
  }
  rememberedDevice = () => this.previous;
  dispose = () => {
    this.drop();
    this.listeners.clear();
  };
}
