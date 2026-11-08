import { connectBluetooth, type DeviceConnection } from './mcumgr';
import { connectSerial, type SerialConnection } from './serial';
import { DeviceError, checked, abortable, packetBytes, type SmpRequest } from './smp';
import {
  loadProfile,
  saveProfile,
  validateProfile,
  profileKey,
  type ConnectionProfile,
  type ProfileKey,
  type DeviceMode,
  type TransportKind,
} from './config';

export type DeviceTask = 'routes' | 'firmware';
export interface DeviceConnectionSnapshot {
  mode: DeviceMode;
  transport: TransportKind;
  profile: ConnectionProfile;
  connected: boolean;
  remembered: boolean;
  deviceName: string;
  target?: string;
  busy: 'connecting' | null;
  task: DeviceTask | null;
  parameters?: { bufferBytes: number; bufferCount?: number; source: 'device' | 'profile' };
  error?: unknown;
  settingsSaved: boolean;
}
type Link = DeviceConnection | SerialConnection;
const portIds = new WeakMap<object, string>();
function portId(port: object) {
  let id = portIds.get(port);
  if (!id) {
    id = `usb:${crypto.randomUUID()}`;
    portIds.set(port, id);
  }
  return id;
}

/** One active endpoint; task ownership survives disconnects and freezes its profile. */
export class DeviceConnectionSession {
  private state: DeviceConnectionSnapshot = {
    mode: 'application',
    transport: 'ble',
    profile: loadProfile('application-ble'),
    connected: false,
    remembered: false,
    deviceName: '',
    busy: null,
    task: null,
    settingsSaved: true,
  };
  private profiles = new Map<ProfileKey, { profile: ConnectionProfile; saved: boolean }>();
  private listeners = new Set<() => void>();
  private connection?: Link;
  private previous?: Link;
  private normalTransport: TransportKind = 'ble';
  private lifetime = new AbortController();
  private disposed = false;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(values: Partial<DeviceConnectionSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...values };
    this.listeners.forEach((listener) => listener());
  }
  claim(task: DeviceTask) {
    if (
      this.disposed ||
      this.state.busy ||
      (this.state.task && this.state.task !== task) ||
      (task === 'routes' && this.state.mode !== 'application')
    )
      return false;
    this.update({ task });
    return true;
  }
  release(task: DeviceTask) {
    if (this.state.task === task) this.update({ task: null });
  }
  private allowed(task?: DeviceTask) {
    return !this.state.task || this.state.task === task;
  }
  configure = (value: unknown) => {
    if (this.state.task || this.state.busy || this.state.connected) return false;
    const key = profileKey(this.state.mode, this.state.transport);
    const profile = validateProfile(value, key);
    this.previous = undefined;
    this.update({
      profile,
      parameters: undefined,
      remembered: false,
      target: undefined,
      deviceName: '',
      settingsSaved: saveProfile(key, profile),
    });
    return true;
  };
  select = (transport: TransportKind, mode: DeviceMode = 'application') => {
    if (this.state.task || this.state.busy) return false;
    if (mode === 'recovery') transport = 'usb';
    if (mode === this.state.mode && transport === this.state.transport) return true;
    this.profiles.set(profileKey(this.state.mode, this.state.transport), {
      profile: this.state.profile,
      saved: this.state.settingsSaved,
    });
    this.drop();
    this.previous = undefined;
    const key = profileKey(mode, transport);
    const selected = this.profiles.get(key) ?? { profile: loadProfile(key), saved: true };
    if (mode === 'application') this.normalTransport = transport;
    this.update({
      mode,
      transport,
      profile: selected.profile,
      settingsSaved: selected.saved,
      remembered: false,
      deviceName: '',
      target: undefined,
      error: undefined,
      parameters: undefined,
    });
    return true;
  };
  setMode(mode: DeviceMode) {
    return this.select(mode === 'recovery' ? 'usb' : this.normalTransport, mode);
  }
  packetLimit = () =>
    Math.min(
      this.state.profile.maxTxPacketBytes,
      this.state.parameters?.bufferBytes ?? this.state.profile.fallbackBufferBytes,
    );
  request(task: DeviceTask): SmpRequest {
    return (group, command, op, fields, _version, options) => {
      if (!this.connection) return Promise.reject(new DeviceError('disconnected'));
      if (this.state.task !== task) return Promise.reject(new DeviceError('device', 0, 10));
      if (packetBytes(fields) > this.packetLimit()) return Promise.reject(new DeviceError('protocol'));
      return this.connection.request(group, command, op, fields, this.state.profile.protocolVersion, options);
    };
  }
  async ensure(task?: DeviceTask, chooseAnother = false, external?: AbortSignal) {
    if (this.disposed || !this.allowed(task) || this.state.busy) throw new DeviceError('device', 0, 10);
    if (this.connection && !chooseAnother) return;
    this.drop();
    this.lifetime = new AbortController();
    const lifetime = this.lifetime;
    const signal = external ? AbortSignal.any([lifetime.signal, external]) : lifetime.signal;
    const profile = this.state.profile;
    const timer = setTimeout(() => lifetime.abort(new DeviceError('timeout')), profile.connectTimeoutMs);
    this.update({ busy: 'connecting', error: undefined });
    let link: Link | undefined;
    try {
      const lost = () => {
        if (signal.aborted || lifetime !== this.lifetime) return;
        this.drop();
        this.update({ error: new DeviceError('disconnected') });
      };
      // Start the chooser synchronously, while the browser user gesture is active.
      const previous = chooseAnother ? undefined : this.previous;
      const opening: Promise<Link> =
        this.state.transport === 'ble'
          ? connectBluetooth(
              signal,
              lost,
              previous && 'device' in previous ? previous.device : undefined,
              profile.protocolVersion,
              profile,
            )
          : connectSerial(signal, lost, previous && 'port' in previous ? previous.port : undefined, profile);
      link = await abortable(opening, signal, (late) => {
        void Promise.resolve(late.close()).catch(() => {});
      });
      signal.throwIfAborted();
      let parameters: DeviceConnectionSnapshot['parameters'] = {
        bufferBytes: profile.fallbackBufferBytes,
        source: 'profile',
      };
      if (profile.queryParameters) {
        try {
          const reply = checked(
            await abortable(link.request(0, 6, 'read', {}, profile.protocolVersion, { signal }), signal),
          );
          if (
            !Number.isInteger(reply.buf_size) ||
            (reply.buf_size as number) < 8 ||
            (reply.buf_size as number) > 65535 ||
            !Number.isInteger(reply.buf_count) ||
            (reply.buf_count as number) < 1 ||
            (reply.buf_count as number) > 65535
          )
            throw new DeviceError('protocol');
          parameters = {
            bufferBytes: reply.buf_size as number,
            bufferCount: reply.buf_count as number,
            source: 'device',
          };
        } catch (error) {
          // Only an explicit SMP ENOTSUP permits fallback. Never hide a timeout or malformed reply.
          if (!(
            error instanceof DeviceError &&
            error.kind === 'device' &&
            error.group === 0 &&
            error.rc === 8
          ))
            throw error;
        }
      }
      signal.throwIfAborted();
      const target = 'device' in link ? `ble:${link.device.id}` : portId(link.port);
      if (task && !chooseAnother && this.state.target && target !== this.state.target)
        throw new DeviceError('protocol');
      this.connection = link;
      this.previous = link;
      this.update({
        connected: true,
        remembered: true,
        target,
        parameters,
        deviceName: 'device' in link ? link.device.name || link.device.id : link.name,
      });
    } catch (error) {
      lifetime.abort();
      if (link) void Promise.resolve(link.close()).catch(() => {});
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.update({ error });
      throw error;
    } finally {
      clearTimeout(timer);
      if (lifetime === this.lifetime) this.update({ busy: null });
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
    if (link) void Promise.resolve(link.close()).catch(() => {});
    this.update({ connected: false, parameters: undefined });
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
    this.update({ remembered: false, target: undefined, deviceName: '', error: undefined });
  }
  dispose = () => {
    this.drop();
    this.disposed = true;
    this.listeners.clear();
  };
}
