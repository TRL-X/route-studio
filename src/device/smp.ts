import { decode, encode } from 'cborg';
import { DEFAULT_PROFILE, type ConnectionProfile } from './config';
export type Fields = Record<string, unknown>;
export type SmpRequest = (
  group: number,
  command: number,
  op: 'read' | 'write',
  fields: Fields,
  protocolVersion?: 1 | 2,
  options?: RequestOptions,
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

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) late?.(value);
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export function packetBytes(fields: Fields) {
  return 8 + encode(fields).length;
}
// Fit the actual encoded request, including the first chunk's metadata.
export function fitData(fields: Fields, data: Uint8Array, limit: number): Uint8Array {
  let low = 0,
    high = data.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (packetBytes({ ...fields, data: data.subarray(0, mid) }) <= limit) low = mid;
    else high = mid - 1;
  }
  if (!low) throw new DeviceError('protocol');
  return data.slice(0, low);
}
export function smpRequest(
  exchange: (frame: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>,
  signal: AbortSignal,
  invalidate: (error: unknown) => void,
  profile: Readonly<ConnectionProfile> = DEFAULT_PROFILE,
): SmpRequest {
  let sequence = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return (group, command, operation, fields, version = profile.protocolVersion, options = {}) => {
    const execute = async () => {
      signal.throwIfAborted();
      options.signal?.throwIfAborted();
      const body = encode(fields);
      if (body.length + 8 > profile.maxTxPacketBytes) throw new DeviceError('protocol');
      const frame = new Uint8Array(body.length + 8);
      frame.set([
        ((version - 1) << 3) | (operation === 'write' ? 2 : 0),
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
      const active = AbortSignal.any([signal, lifetime.signal, ...(options.signal ? [options.signal] : [])]);
      const timer = setTimeout(
        () => lifetime.abort(new DeviceError('timeout')),
        options.timeoutMs ?? profile.requestTimeoutMs,
      );
      try {
        const reply = await abortable(exchange(frame, active), active);
        if (
          reply.length < 8 ||
          reply.length > profile.maxRxPacketBytes ||
          reply[0] !== frame[0] + 1 ||
          reply[1] !== 0 ||
          reply[4] !== frame[4] ||
          reply[5] !== frame[5] ||
          reply[6] !== frame[6] ||
          reply[7] !== frame[7] ||
          new DataView(reply.buffer, reply.byteOffset, reply.byteLength).getUint16(2) !== reply.length - 8
        )
          throw new DeviceError('protocol');
        try {
          return record(decode(reply.subarray(8), { allowBigInt: true }));
        } catch {
          throw new DeviceError('protocol');
        }
      } catch (error) {
        invalidate(error);
        throw error;
      } finally {
        clearTimeout(timer);
        lifetime.abort();
      }
    };
    const next = tail.then(execute);
    tail = next.catch(() => {});
    return next;
  };
}
// BLE and raw serial are ordered streams, with packet length in the SMP header.
export class PacketDecoder {
  private readonly buffer: Uint8Array;
  private received = 0;
  private expected = 8;
  constructor(private readonly maximum: number) {
    this.buffer = new Uint8Array(maximum);
  }
  get pendingBytes() {
    return this.received;
  }
  push(bytes: Uint8Array): Uint8Array[] {
    const packets: Uint8Array[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      const count = Math.min(this.expected - this.received, bytes.length - offset);
      this.buffer.set(bytes.subarray(offset, offset + count), this.received);
      this.received += count;
      offset += count;
      if (this.received === 8) {
        this.expected = 8 + ((this.buffer[2] << 8) | this.buffer[3]);
        if (this.expected > this.maximum) throw new DeviceError('protocol');
      }
      if (this.received === this.expected) {
        packets.push(this.buffer.slice(0, this.expected));
        this.received = 0;
        this.expected = 8;
      }
    }
    return packets;
  }
}
