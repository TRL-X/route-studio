import { afterEach, expect, test, vi } from 'vitest';
import { decode, encode } from 'cborg';
import { connectSerial, encodeSerialPacket, SerialDecoder, serialCrc16 } from '../../src/device/serial';
import type { SerialPort } from '../../src/device/serial-types';

class Port extends EventTarget implements SerialPort {
  controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly readable = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller;
    },
  });
  readonly writable = new WritableStream<Uint8Array>({
    write: (bytes) => {
      this.writes.push(bytes);
      for (const packet of this.decoder.push(bytes)) this.onRequest?.(packet);
    },
  });
  writes: Uint8Array[] = [];
  decoder = new SerialDecoder();
  onRequest?: (packet: Uint8Array) => void;
  open = vi.fn(async () => {});
  close = vi.fn(async () => {});
  setSignals = vi.fn(async () => {});
  getInfo = () => ({ usbVendorId: 1, usbProductId: 2 });
  respond(frame: Uint8Array, fields: Record<string, unknown>, mutate?: (packet: Uint8Array) => void) {
    const body = encode(fields);
    const reply = new Uint8Array(body.length + 8);
    reply.set(frame.subarray(0, 8));
    reply[0]++;
    new DataView(reply.buffer).setUint16(2, body.length);
    reply.set(body, 8);
    mutate?.(reply);
    for (const line of encodeSerialPacket(reply)) {
      // Serial reads can split either marker, Base64 data, or the terminating newline.
      for (let off = 0; off < line.length; off += 3) this.controller.enqueue(line.slice(off, off + 3));
    }
  }
}

function setup() {
  const port = new Port();
  const serial = { requestPort: vi.fn(async () => port) };
  vi.stubGlobal('navigator', { serial });
  vi.stubGlobal('window', {});
  const abort = new AbortController();
  const lost = vi.fn();
  return { port, serial, abort, lost };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('uses the standard CRC and bounded console framing', () => {
  expect(serialCrc16(new TextEncoder().encode('123456789'))).toBe(0x31c3);
  const echo = new Uint8Array([0, 0, 0, 4, 0, 0, 0, 0, 0xa1, 0x61, 0x64, 0x60]);
  const knownFrame = new TextEncoder().encode('\x06\x09AA4AAAAEAAAAAKFhZGAHPg==\n');
  expect(encodeSerialPacket(echo)).toEqual([knownFrame]);
  expect(new SerialDecoder().push(knownFrame)).toEqual([echo]);
  const packet = new Uint8Array(300).map((_, index) => index % 256);
  const lines = encodeSerialPacket(packet);
  expect(lines[0].slice(0, 2)).toEqual(new Uint8Array([6, 9]));
  expect(lines.slice(1).every((line) => line[0] === 4 && line[1] === 20)).toBe(true);
  expect(lines.every((line) => line.length <= 127 && line.at(-1) === 10)).toBe(true);
  const initial = Uint8Array.from(atob(new TextDecoder().decode(lines[0].slice(2, -1))), (v) =>
    v.charCodeAt(0),
  );
  expect(initial.slice(0, 2)).toEqual(new Uint8Array([1, 46]));
  const parser = new SerialDecoder();
  expect(lines.flatMap((line) => parser.push(line))).toEqual([packet]);
});

test('rejects CRC corruption and orphan continuations while ignoring console log lines', () => {
  const packet = new Uint8Array([1, 0, 0, 1, 0, 0, 0, 0, 0xa0]);
  const lines = encodeSerialPacket(packet);
  const line = lines[0];
  const bytes = Uint8Array.from(atob(new TextDecoder().decode(line.slice(2, -1))), (v) => v.charCodeAt(0));
  bytes[3] ^= 1;
  const corrupt = new TextEncoder().encode(`\x06\x09${btoa(String.fromCharCode(...bytes))}\n`);
  const parser = new SerialDecoder();
  expect(parser.push(new TextEncoder().encode('Booting…\n' + 'x'.repeat(2000) + '\n'))).toEqual([]);
  expect(() => parser.push(corrupt)).toThrowError('protocol');
  const orphan = lines[0].slice();
  orphan[0] = 4;
  orphan[1] = 20;
  expect(() => new SerialDecoder().push(orphan)).toThrowError('protocol');
});

test('serializes requests and reads fragmented replies using SMP v1', async () => {
  const { port, serial, abort, lost } = setup();
  const requests: Uint8Array[] = [];
  port.onRequest = (packet) => {
    requests.push(packet);
    port.respond(packet, { off: 512, padding: 'a'.repeat(300) });
  };
  const connection = await connectSerial(abort.signal, lost);
  const replies = await Promise.all([
    connection.request(1, 1, 'write', { off: 0, data: new Uint8Array(256), len: 512 }),
    connection.request(0, 5, 'write', {}),
  ]);
  expect(serial.requestPort).toHaveBeenCalledOnce();
  expect(port.open).toHaveBeenCalledWith({ baudRate: 115200, bufferSize: 4096, flowControl: 'none' });
  expect(port.setSignals).toHaveBeenCalledWith({ dataTerminalReady: true });
  expect(requests.map((p) => [p[0], p[5], p[6], p[7]])).toEqual([
    [2, 1, 0, 1],
    [2, 0, 1, 5],
  ]);
  expect(decode(requests[0].subarray(8))).toMatchObject({ off: 0, len: 512 });
  expect(replies.map((reply) => reply.off)).toEqual([512, 512]);
  expect(lost).not.toHaveBeenCalled();
  await connection.close();
  expect(port.close).toHaveBeenCalledOnce();
  expect(port.readable.locked).toBe(false);
  expect(port.writable.locked).toBe(false);
});

test('invalid response headers reject queued work and release the port', async () => {
  const { port, abort, lost } = setup();
  port.onRequest = (packet) =>
    port.respond(packet, {}, (reply) => {
      reply[6]++;
    });
  const connection = await connectSerial(abort.signal, lost);
  const result = await Promise.allSettled([
    connection.request(1, 0, 'read', {}),
    connection.request(1, 0, 'read', {}),
  ]);
  expect(result.every((reply) => reply.status === 'rejected')).toBe(true);
  expect(result[0]).toMatchObject({ status: 'rejected', reason: { kind: 'protocol' } });
  await connection.close();
  expect(lost).toHaveBeenCalledOnce();
  expect(port.close).toHaveBeenCalledOnce();
});

test('cancellation interrupts a pending read and releases stream locks', async () => {
  const { port, abort, lost } = setup();
  const connection = await connectSerial(abort.signal, lost);
  const pending = connection.request(1, 0, 'read', {});
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(port.writes.length).toBeGreaterThan(0));
  abort.abort();
  await rejected;
  await connection.close();
  expect(port.close).toHaveBeenCalledOnce();
  expect(port.readable.locked).toBe(false);
  expect(port.writable.locked).toBe(false);
  expect(lost).not.toHaveBeenCalled();
});

test('timeout invalidates the transport and rejects later operations', async () => {
  vi.useFakeTimers();
  const { abort, lost, port } = setup();
  const connection = await connectSerial(abort.signal, lost);
  const pending = expect(connection.request(1, 0, 'read', {})).rejects.toMatchObject({ kind: 'timeout' });
  await vi.advanceTimersByTimeAsync(60000);
  await pending;
  await connection.close();
  expect(lost).toHaveBeenCalledOnce();
  expect(port.close).toHaveBeenCalledOnce();
  await expect(connection.request(1, 0, 'read', {})).rejects.toMatchObject({ kind: 'disconnected' });
});

test('a signal cancelled while opening closes the newly opened port', async () => {
  const { port, abort, lost } = setup();
  port.open.mockImplementation(async () => {
    abort.abort();
  });
  await expect(connectSerial(abort.signal, lost)).rejects.toMatchObject({ name: 'AbortError' });
  expect(port.close).toHaveBeenCalledOnce();
});

test('a disconnected serial device rejects the request and closes without holding locks', async () => {
  const { port, abort, lost } = setup();
  const connection = await connectSerial(abort.signal, lost);
  const rejected = expect(connection.request(1, 0, 'read', {})).rejects.toMatchObject({
    kind: 'disconnected',
  });
  await vi.waitFor(() => expect(port.writes.length).toBeGreaterThan(0));
  port.dispatchEvent(new Event('disconnect'));
  await rejected;
  await connection.close();
  expect(lost).toHaveBeenCalledOnce();
  expect(port.close).toHaveBeenCalledOnce();
  expect(port.readable.locked).toBe(false);
  expect(port.writable.locked).toBe(false);
});

test('reconnecting waits for the previous port close before attempting to open', async () => {
  const { port, abort, lost } = setup();
  const connection = await connectSerial(abort.signal, lost);
  let finishClose!: () => void;
  port.close.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishClose = resolve;
      }),
  );
  const closing = connection.close();
  const reconnectAbort = new AbortController();
  const reconnect = connectSerial(reconnectAbort.signal, lost, port);
  const rejected = expect(reconnect).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
  expect(port.open).toHaveBeenCalledOnce();
  reconnectAbort.abort();
  finishClose();
  await closing;
  await rejected;
  expect(port.open).toHaveBeenCalledOnce();
});
