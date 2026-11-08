import { DeviceError, PacketDecoder, smpRequest, delay, type SmpRequest } from './smp';
import { DEFAULT_PROFILE, type ConnectionProfile } from './config';
import type { SerialPort } from './serial-types';

const maxPacketBytes = 65533;
const encoder = new TextEncoder();
const closingPorts = new WeakMap<SerialPort, Promise<void>>();

export function serialCrc16(bytes: Uint8Array) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}

export function encodeSerialPacket(packet: Uint8Array): Uint8Array[] {
  if (packet.length > maxPacketBytes) throw new DeviceError('protocol');
  const bytes = new Uint8Array(packet.length + 4);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, packet.length + 2);
  bytes.set(packet, 2);
  view.setUint16(bytes.length - 2, serialCrc16(packet));
  const lines: Uint8Array[] = [];
  // A serial frame has two marker bytes, at most 124 Base64 characters, and a newline.
  for (let offset = 0; offset < bytes.length; offset += 93) {
    const payload = btoa(String.fromCharCode(...bytes.subarray(offset, offset + 93)));
    lines.push(encoder.encode(`${offset === 0 ? '\x06\x09' : '\x04\x14'}${payload}\n`));
  }
  return lines;
}

export class SerialDecoder {
  constructor(private readonly maximum = maxPacketBytes) {}
  private line: number[] = [];
  private packet?: Uint8Array;
  private received = 0;
  private dropping = false;

  push(bytes: Uint8Array): Uint8Array[] {
    const packets: Uint8Array[] = [];
    for (const byte of bytes) {
      if (byte !== 10) {
        if (this.dropping) continue;
        this.line.push(byte);
        if (this.line.length > 127) {
          if (this.line[0] === 6 || this.line[0] === 4) throw new DeviceError('protocol');
          this.line = [];
          this.dropping = true;
        }
        continue;
      }
      if (this.dropping) {
        this.dropping = false;
        continue;
      }
      const line = this.line;
      this.line = [];
      const initial = line[0] === 6 && line[1] === 9;
      const continuation = line[0] === 4 && line[1] === 20;
      if (!initial && !continuation) continue;
      const text = String.fromCharCode(...line.slice(2));
      if (
        !text.length ||
        text.length > 124 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)
      )
        throw new DeviceError('protocol');
      let data = Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
      if (initial) {
        if (this.packet || data.length < 2) throw new DeviceError('protocol');
        const length = (data[0] << 8) | data[1];
        if (length < 10 || length - 2 > this.maximum) throw new DeviceError('protocol');
        this.packet = new Uint8Array(length);
        this.received = 0;
        data = data.subarray(2);
      }
      if (!this.packet || this.received + data.length > this.packet.length) throw new DeviceError('protocol');
      this.packet.set(data, this.received);
      this.received += data.length;
      if (this.received === this.packet.length) {
        if (serialCrc16(this.packet) !== 0) throw new DeviceError('protocol');
        packets.push(this.packet.slice(0, -2));
        this.packet = undefined;
        this.received = 0;
      }
    }
    return packets;
  }
}

export interface SerialConnection {
  port: SerialPort;
  name: string;
  request: SmpRequest;
  close: () => Promise<void>;
}

export async function connectSerial(
  signal: AbortSignal,
  onLost: () => void,
  previous?: SerialPort,
  profile: Readonly<ConnectionProfile> = DEFAULT_PROFILE,
): Promise<SerialConnection> {
  signal.throwIfAborted();
  if (!navigator.serial) throw new Error('Web Serial is unavailable');
  const cancelSelection = () => window.routeStudioDesktop?.cancelSerial();
  signal.addEventListener('abort', cancelSelection, { once: true });
  let port: SerialPort;
  try {
    port = previous ?? (await navigator.serial.requestPort({ filters: profile.usbFilters }));
  } catch (error) {
    // Normalize chooser dismissal before opening the port so real connection failures still surface.
    if (error instanceof DOMException && error.name === 'NotFoundError')
      throw new DOMException(error.message, 'AbortError');
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelSelection);
  }
  signal.throwIfAborted();
  await closingPorts.get(port);
  signal.throwIfAborted();
  await port.open({
    baudRate: profile.baudRate,
    bufferSize: profile.serialBufferBytes,
    flowControl: profile.flowControl,
    dataBits: profile.dataBits,
    stopBits: profile.stopBits,
    parity: profile.parity,
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  const lifetime = new AbortController();
  let pending: { resolve: (frame: Uint8Array) => void; reject: (error: unknown) => void } | undefined;
  let closing: Promise<void> | undefined;
  let readTask: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    lifetime.abort(new DeviceError('disconnected'));
    signal.removeEventListener('abort', aborted);
    port.removeEventListener('disconnect', lost);
    pending?.reject(lifetime.signal.reason);
    pending = undefined;
    closing = (async () => {
      await Promise.allSettled([reader?.cancel(), writer?.abort()]);
      await readTask;
      reader?.releaseLock();
      writer?.releaseLock();
      await port.close();
    })();
    closingPorts.set(port, closing);
    void closing
      .finally(() => {
        if (closingPorts.get(port) === closing) closingPorts.delete(port);
      })
      .catch(() => {});
    return closing;
  };
  const fail = (error: unknown) => {
    if (lifetime.signal.aborted) return;
    pending?.reject(error);
    pending = undefined;
    void close().catch(() => {});
    onLost();
  };
  const lost = () => fail(new DeviceError('disconnected'));
  const aborted = () => {
    pending?.reject(signal.reason);
    void close().catch(() => {});
  };
  try {
    signal.throwIfAborted();
    const signals = {
      ...(profile.dtr !== 'preserve' && { dataTerminalReady: profile.dtr === 'assert' }),
      ...(profile.flowControl !== 'hardware' &&
        profile.rts !== 'preserve' && { requestToSend: profile.rts === 'assert' }),
    };
    if (Object.keys(signals).length) await port.setSignals?.(signals);
    signal.throwIfAborted();
    if (!port.readable || !port.writable) throw new DeviceError('disconnected');
    reader = port.readable.getReader();
    writer = port.writable.getWriter();
    signal.addEventListener('abort', aborted, { once: true });
    port.addEventListener('disconnect', lost);
    const parser =
      profile.serialFraming === 'raw'
        ? new PacketDecoder(profile.maxRxPacketBytes)
        : new SerialDecoder(profile.maxRxPacketBytes);
    readTask = (async () => {
      try {
        while (!lifetime.signal.aborted) {
          const { value, done } = await reader!.read();
          if (done) {
            if (!lifetime.signal.aborted) lost();
            break;
          }
          for (const frame of parser.push(value)) {
            if (!pending) throw new DeviceError('protocol');
            pending.resolve(frame);
            pending = undefined;
          }
        }
      } catch (error) {
        fail(error instanceof DeviceError ? error : new DeviceError('protocol'));
      }
    })();
    const request = smpRequest(
      async (frame, active) => {
        const response = new Promise<Uint8Array>((resolve, reject) => {
          pending = { resolve, reject };
          active.addEventListener('abort', () => reject(active.reason), { once: true });
        });
        const write = async () => {
          for (const line of profile.serialFraming === 'raw' ? [frame] : encodeSerialPacket(frame)) {
            active.throwIfAborted();
            await writer!.write(line);
            if (profile.fragmentDelayMs) await delay(profile.fragmentDelayMs, active);
          }
        };
        const [reply] = await Promise.all([response, write()]);
        return reply;
      },
      AbortSignal.any([signal, lifetime.signal]),
      fail,
      profile,
    );
    const info = port.getInfo();
    const name =
      info.usbVendorId !== undefined && info.usbProductId !== undefined
        ? `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${info.usbProductId.toString(16).padStart(4, '0')}`
        : 'Serial';
    return { port, name, request, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
