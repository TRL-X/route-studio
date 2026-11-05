import { afterEach, expect, test, vi } from 'vitest';
import { encode } from 'cborg';
import { DeviceError, requestClient } from '../../src/device/mcumgr';

class Channel extends EventTarget {
  value?: DataView;
  pending = new Uint8Array();
  writes: Uint8Array[] = [];
  frames: Uint8Array[] = [];
  reply?: (frame: Uint8Array) => void;
  async writeValueWithoutResponse(bytes: Uint8Array) {
    this.writes.push(bytes.slice());
    const next = new Uint8Array(this.pending.length + bytes.length);
    next.set(this.pending);
    next.set(bytes, this.pending.length);
    this.pending = next;
    if (next.length >= 8 && next.length === 8 + new DataView(next.buffer).getUint16(2)) {
      this.pending = new Uint8Array();
      this.frames.push(next);
      this.reply?.(next);
    }
  }
  respond(frame: Uint8Array, body: Uint8Array) {
    const response = new Uint8Array(8 + body.length);
    response.set(frame.subarray(0, 8));
    response[0]++;
    new DataView(response.buffer).setUint16(2, body.length);
    response.set(body, 8);
    for (let offset = 0; offset < response.length; offset += 3) {
      // Nonzero byteOffset catches accidental use of the entire backing buffer.
      this.value = new DataView(response.buffer, offset, Math.min(3, response.length - offset));
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    }
  }
}
function setup() {
  const channel = new Channel();
  const lifetime = new AbortController();
  const invalidate = vi.fn((error) => lifetime.abort(error));
  const request = requestClient(
    channel as unknown as BluetoothRemoteGATTCharacteristic,
    lifetime.signal,
    invalidate,
  );
  return { channel, lifetime, invalidate, request };
}
afterEach(() => vi.useRealTimers());
test('serializes requests, reassembles early fragmented notifications and preserves uint64 CBOR', async () => {
  const { channel, request, invalidate } = setup();
  const rev = 0xfedcba9800000001n;
  channel.reply = (frame) => {
    const body = encode({ rev });
    channel.respond(frame, Uint8Array.from([0xbf, ...body.subarray(1), 0xff]));
  };
  const values = await Promise.all([
    request(64, 2, 'write', { req_id: new Uint8Array(16), size: 999 }),
    request(8, 1, 'read', { name: '/SD:/ROUTES/INBOX/123.TMP' }),
  ]);
  expect(values).toEqual([{ rev }, { rev }]);
  expect(channel.frames.map((f) => [f[0], f[5], f[6], f[7]])).toEqual([
    [0x0a, 64, 0, 2],
    [0x08, 8, 1, 1],
  ]);
  expect(channel.writes.every((w) => w.length <= 20)).toBe(true);
  expect(invalidate).not.toHaveBeenCalled();
});
test('a wrong response header invalidates the connection and rejects queued work', async () => {
  const { channel, request, invalidate } = setup();
  channel.reply = (frame) => {
    const wrong = frame.slice();
    wrong[5] = 8;
    channel.respond(wrong, encode({}));
  };
  const result = await Promise.allSettled([request(64, 0, 'read', {}), request(64, 1, 'read', {})]);
  expect(result.every((r) => r.status === 'rejected' && r.reason.kind === 'protocol')).toBe(true);
  expect(channel.frames).toHaveLength(1);
  expect(invalidate).toHaveBeenCalledOnce();
});
test('timeouts close the transport rather than accepting a late response as a retry', async () => {
  vi.useFakeTimers();
  const { request, invalidate } = setup();
  const done = expect(request(64, 0, 'read', {})).rejects.toMatchObject({ kind: 'timeout' });
  await vi.advanceTimersByTimeAsync(60000);
  await done;
  expect(invalidate).toHaveBeenCalledOnce();
});
test('disconnection rejects an outstanding request', async () => {
  const { channel, request, lifetime } = setup();
  channel.reply = () => lifetime.abort(new DeviceError('disconnected'));
  await expect(request(64, 0, 'read', {})).rejects.toMatchObject({ kind: 'disconnected' });
});
