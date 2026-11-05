import { decode, encode } from 'cborg';

const serviceId = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
const characteristicId = 'da2e7828-fbce-4e01-ae9e-261174997c48';
export type Fields = Record<string, unknown>;
export type SmpRequest = (
  group: number,
  command: number,
  op: 'read' | 'write',
  fields: Fields,
) => Promise<Fields>;

export class DeviceError extends Error {
  constructor(
    readonly kind: 'protocol' | 'timeout' | 'disconnected' | 'device' | 'version',
    readonly group = 0,
    readonly rc = 0,
  ) {
    super(kind);
  }
}

export function record(value: unknown): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array)
    throw new DeviceError('protocol');
  return value as Fields;
}

export function checked(reply: Fields): Fields {
  if (reply.err !== undefined) {
    const err = record(reply.err);
    if (!Number.isInteger(err.group) || !Number.isInteger(err.rc)) throw new DeviceError('protocol');
    if (err.rc !== 0) throw new DeviceError('device', err.group as number, err.rc as number);
  }
  if (reply.rc !== undefined) {
    if (!Number.isInteger(reply.rc)) throw new DeviceError('protocol');
    if (reply.rc !== 0) throw new DeviceError('device', 0, reply.rc as number);
  }
  return reply;
}

// One in-flight request per connection. A failed frame invalidates the connection,
// so a partial write or late notification cannot become the next response.
export function requestClient(
  channel: BluetoothRemoteGATTCharacteristic,
  signal: AbortSignal,
  invalidate: (error: unknown) => void,
): SmpRequest {
  let sequence = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const request: SmpRequest = async (group, command, operation, fields) => {
    signal.throwIfAborted();
    const body = encode(fields);
    if (body.length + 8 > 1024) throw new DeviceError('protocol');
    const frame = new Uint8Array(8 + body.length);
    const op = operation === 'write' ? 2 : 0;
    frame.set([
      0x08 | op,
      0,
      body.length >>> 8,
      body.length & 255,
      group >>> 8,
      group & 255,
      sequence,
      command,
    ]);
    sequence = (sequence + 1) & 255;
    frame.set(body, 8);
    const lifetime = new AbortController();
    const active = AbortSignal.any([signal, lifetime.signal]);
    const timeout = setTimeout(() => lifetime.abort(new DeviceError('timeout')), 60000);
    try {
      const response = new Promise<Fields>((resolve, reject) => {
        const buffer = new Uint8Array(1024);
        const header = new DataView(buffer.buffer);
        let received = 0;
        channel.addEventListener(
          'characteristicvaluechanged',
          () => {
            try {
              const fragment = channel.value;
              if (!fragment?.byteLength || received + fragment.byteLength > buffer.length)
                throw new DeviceError('protocol');
              buffer.set(new Uint8Array(fragment.buffer, fragment.byteOffset, fragment.byteLength), received);
              received += fragment.byteLength;
              if (received < 8) return;
              const size = 8 + header.getUint16(2);
              if (
                buffer[0] !== frame[0] + 1 ||
                buffer[1] !== 0 ||
                header.getUint16(4) !== group ||
                buffer[6] !== frame[6] ||
                buffer[7] !== command ||
                size > buffer.length ||
                received > size
              )
                throw new DeviceError('protocol');
              if (received === size) resolve(record(decode(buffer.subarray(8, size), { allowBigInt: true })));
            } catch {
              reject(new DeviceError('protocol'));
            }
          },
          { signal: active },
        );
        active.addEventListener('abort', () => reject(active.reason), { once: true });
      });
      const write = async () => {
        // Web Bluetooth does not expose ATT MTU; these fit the minimum MTU.
        for (let i = 0; i < frame.length; i += 20) {
          active.throwIfAborted();
          await channel.writeValueWithoutResponse(frame.subarray(i, i + 20));
        }
      };
      const [reply] = await Promise.all([response, write()]);
      return reply;
    } catch (error) {
      invalidate(error);
      throw error;
    } finally {
      clearTimeout(timeout);
      lifetime.abort();
    }
  };
  return (...args) => {
    const next = tail.then(() => request(...args));
    tail = next.catch(() => {});
    return next;
  };
}

export interface DeviceConnection {
  device: BluetoothDevice;
  request: SmpRequest;
  close: () => void;
}

export async function connectBluetooth(
  signal: AbortSignal,
  onLost: () => void,
  previous?: BluetoothDevice,
): Promise<DeviceConnection> {
  signal.throwIfAborted();
  const cancelSelection = () => window.routeStudioDesktop?.cancelBluetooth();
  signal.addEventListener('abort', cancelSelection, { once: true });
  let device: BluetoothDevice;
  try {
    device = previous ?? (await navigator.bluetooth.requestDevice({ filters: [{ services: [serviceId] }] }));
  } finally {
    signal.removeEventListener('abort', cancelSelection);
  }
  signal.throwIfAborted();
  const gatt = device.gatt;
  if (!gatt) throw new DeviceError('disconnected');
  const link = new AbortController();
  const active = AbortSignal.any([signal, link.signal]);
  const close = () => {
    device.removeEventListener('gattserverdisconnected', lost);
    signal.removeEventListener('abort', close);
    link.abort(new DeviceError('disconnected'));
    gatt.disconnect();
  };
  const lost = () => {
    close();
    onLost();
  };
  device.addEventListener('gattserverdisconnected', lost);
  signal.addEventListener('abort', close, { once: true });
  try {
    const server = await gatt.connect();
    active.throwIfAborted();
    const service = await server.getPrimaryService(serviceId);
    const channel = await service.getCharacteristic(characteristicId);
    await channel.startNotifications();
    active.throwIfAborted();
    return { device, close, request: requestClient(channel, active, lost) };
  } catch (error) {
    close();
    throw error;
  }
}
