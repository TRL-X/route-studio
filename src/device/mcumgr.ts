import { decode, encode } from 'cborg';

const serviceId = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
const characteristicId = 'da2e7828-fbce-4e01-ae9e-261174997c48';

export class UploadError extends Error {
  constructor(
    readonly key:
      | 'uploadProtocol'
      | 'uploadDeviceError'
      | 'uploadDisconnected'
      | 'uploadTimeout'
      | 'uploadExists'
      | 'uploadMismatch',
    readonly detail = '',
  ) {
    super(key);
  }
}

interface FsReply {
  rc?: number;
  err?: { group: number; rc: number };
  off?: number;
  len?: number;
  type?: string;
  output?: number;
}

export type FsRequest = (command: 0 | 1 | 2, fields: Record<string, unknown>) => Promise<FsReply>;

// Commands in FS group 8: file upload (write 0), status (read 1), checksum (read 2).
function requestClient(channel: BluetoothRemoteGATTCharacteristic, signal: AbortSignal): FsRequest {
  let sequence = 0;
  return async (command, fields) => {
    signal.throwIfAborted();
    const body = encode(fields);
    const frame = new Uint8Array(8 + body.length);
    const op = command === 0 ? 2 : 0;
    frame.set([0x08 | op, 0, body.length >>> 8, body.length & 255, 0, 8, sequence, command]);
    sequence = (sequence + 1) & 255;
    frame.set(body, 8);

    const lifetime = new AbortController();
    const active = AbortSignal.any([signal, lifetime.signal]);
    const timeout = setTimeout(() => lifetime.abort(new UploadError('uploadTimeout')), 60000);
    // Web Bluetooth does not expose the ATT MTU. 20-byte writes fit the minimum MTU.
    async function write() {
      for (let i = 0; i < frame.length; i += 20) {
        active.throwIfAborted();
        await channel.writeValueWithoutResponse(frame.subarray(i, i + 20));
      }
    }
    try {
      // Subscribe before writing: a notification can precede the last write's resolution.
      const response = new Promise<FsReply>((resolve, reject) => {
        const buffer = new Uint8Array(1024); // Arcap's SMP netbuf size.
        const header = new DataView(buffer.buffer);
        let received = 0;
        channel.addEventListener(
          'characteristicvaluechanged',
          () => {
            try {
              const fragment = channel.value;
              if (!fragment?.byteLength || received + fragment.byteLength > buffer.length)
                throw new UploadError('uploadProtocol');
              buffer.set(new Uint8Array(fragment.buffer, fragment.byteOffset, fragment.byteLength), received);
              received += fragment.byteLength;
              if (received < 8) return;
              const size = 8 + header.getUint16(2);
              if (
                buffer[0] !== frame[0] + 1 ||
                buffer[1] !== 0 ||
                header.getUint16(4) !== 8 ||
                buffer[6] !== frame[6] ||
                buffer[7] !== command ||
                size > buffer.length ||
                received > size
              )
                throw new UploadError('uploadProtocol');
              if (received < size) return;
              const reply = decode(buffer.subarray(8, size));
              if (!reply || typeof reply !== 'object' || Array.isArray(reply) || reply instanceof Uint8Array)
                throw new UploadError('uploadProtocol');
              resolve(reply);
            } catch {
              reject(new UploadError('uploadProtocol'));
            }
          },
          { signal: active },
        );
        active.addEventListener('abort', () => reject(active.reason), { once: true });
      });
      const [reply] = await Promise.all([response, write()]);
      return reply;
    } finally {
      clearTimeout(timeout);
      lifetime.abort();
    }
  };
}

export async function withBluetoothFs<T>(signal: AbortSignal, transfer: (request: FsRequest) => Promise<T>) {
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [serviceId] }] });
  signal.throwIfAborted();
  const gatt = device.gatt;
  if (!gatt) throw new UploadError('uploadDisconnected');
  const link = new AbortController();
  const active = AbortSignal.any([signal, link.signal]);
  const disconnect = () => gatt.disconnect();
  const lost = () => link.abort(new UploadError('uploadDisconnected'));
  signal.addEventListener('abort', disconnect);
  device.addEventListener('gattserverdisconnected', lost);
  try {
    const server = await gatt.connect();
    active.throwIfAborted();
    const service = await server.getPrimaryService(serviceId);
    const channel = await service.getCharacteristic(characteristicId);
    await channel.startNotifications();
    active.throwIfAborted();
    return await transfer(requestClient(channel, active));
  } finally {
    device.removeEventListener('gattserverdisconnected', lost);
    signal.removeEventListener('abort', disconnect);
    disconnect();
  }
}
