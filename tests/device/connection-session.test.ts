import { afterEach, expect, test, vi } from 'vitest';
import { connectBluetooth, DeviceError, type SmpRequest } from '../../src/device/mcumgr';
import { connectSerial } from '../../src/device/serial';
import { DeviceConnectionSession } from '../../src/device/connection-session';
import { DeviceSession } from '../../src/device/session';
import { defaultProfile, validateProfile } from '../../src/device/config';
import { Firmware } from './firmware';

vi.mock('../../src/device/mcumgr', async (original) => ({
  ...(await original<typeof import('../../src/device/mcumgr')>()),
  connectBluetooth: vi.fn(),
}));
vi.mock('../../src/device/serial', () => ({ connectSerial: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(reply: unknown = { buf_size: 1024, buf_count: 4 }) {
  const close = vi.fn();
  const request = vi.fn<SmpRequest>(async () => {
    if (reply instanceof Error) throw reply;
    return reply as Record<string, unknown>;
  });
  vi.mocked(connectBluetooth).mockResolvedValue({ device: { id: 'ble' } as BluetoothDevice, close, request });
  vi.mocked(connectSerial).mockResolvedValue({
    port: {} as never,
    name: 'USB',
    close: vi.fn(async () => close()),
    request,
  });
  return { connection: new DeviceConnectionSession(), request, close };
}
test('uses v2 for both normal transports, v1 for recovery, with device-reported capacity', async () => {
  const { connection, request } = setup();
  await connection.connect();
  expect(connection.snapshot().parameters).toEqual({ bufferBytes: 1024, bufferCount: 4, source: 'device' });
  connection.select('usb');
  await connection.connect();
  connection.setMode('recovery');
  await connection.connect();
  expect(request.mock.calls.map((call) => call[4])).toEqual([2, 2, 1]);
  expect(connection.snapshot()).toMatchObject({ mode: 'recovery', transport: 'usb', connected: true });
  connection.dispose();
});
test('only an explicit unsupported response uses a profile fallback', async () => {
  const { connection } = setup({ rc: 8 });
  await connection.connect();
  expect(connection.snapshot().parameters).toEqual({ bufferBytes: 1024, source: 'profile' });
  connection.setMode('recovery');
  await connection.connect();
  expect(connection.snapshot().parameters).toEqual({ bufferBytes: 256, source: 'profile' });
  connection.dispose();
});
test.each([
  new DeviceError('timeout'),
  { buf_size: 1024, buf_count: 0 },
  { buf_size: '1024', buf_count: 4 },
  { rc: 4 },
])('does not disguise a failed/invalid capability query as unsupported (%s)', async (reply) => {
  const { connection, close } = setup(reply);
  await connection.connect();
  expect(connection.snapshot()).toMatchObject({ connected: false, parameters: undefined });
  expect(connection.snapshot().error).toBeDefined();
  expect(close).toHaveBeenCalled();
});
test('locks the profile and endpoint across a disconnected pending task', async () => {
  const { connection } = setup();
  await connection.connect();
  connection.claim('firmware');
  connection.disconnect('firmware');
  expect(connection.configure({ protocolVersion: 1 })).toBe(false);
  expect(connection.select('usb')).toBe(false);
  expect(connection.setMode('recovery')).toBe(false);
  await connection.ensure('firmware');
  expect(connection.snapshot().profile.protocolVersion).toBe(2);
  connection.dispose();
});
test('bounds hung connections and closes a late result without publishing it', async () => {
  vi.useFakeTimers();
  const { connection, close } = setup();
  let finish!: (value: Awaited<ReturnType<typeof connectBluetooth>>) => void;
  vi.mocked(connectBluetooth).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  connection.configure({ connectTimeoutMs: 100 });
  const pending = connection.connect();
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(connection.snapshot()).toMatchObject({ connected: false, busy: null, error: { kind: 'timeout' } });
  finish({ device: { id: 'late' } as BluetoothDevice, close, request: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(close).toHaveBeenCalled();
  expect(connection.snapshot().connected).toBe(false);
});
test('transfers and deletes routes over USB using the same shared connection', async () => {
  vi.useFakeTimers();
  const peer = new Firmware();
  const { connection } = setup();
  vi.mocked(connectSerial).mockResolvedValue({
    port: {} as never,
    name: 'USB',
    close: vi.fn(),
    request: peer.request,
  });
  connection.select('usb');
  const routes = new DeviceSession(connection);
  const sending = routes.send(new Uint8Array(1200).fill(7));
  await vi.runAllTimersAsync();
  await sending;
  expect(routes.snapshot()).toMatchObject({ transport: 'usb', pending: false, progress: { state: 'ready' } });
  expect(peer.received).toEqual(new Uint8Array(1200).fill(7));
  await routes.delete(peer.id, peer.rev);
  expect(peer.items).toHaveLength(0);
  routes.dispose();
  connection.dispose();
});
test('persists separate profiles and refuses invalid or unsupported settings', () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key),
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  const { connection } = setup();
  connection.configure({ protocolVersion: 1, bleWritePayloadBytes: 244 });
  connection.select('usb');
  expect(connection.snapshot().profile.protocolVersion).toBe(2);
  connection.setMode('recovery');
  expect(connection.snapshot().profile.protocolVersion).toBe(1);
  connection.select('ble');
  expect(connection.snapshot().profile.bleWritePayloadBytes).toBe(244);
  for (const invalid of [
    { baudRate: 0 },
    { protocolVersion: 3 },
    { bleWritePayloadBytes: 513 },
    { serialFraming: 'raw', dataBits: 7 },
    { mystery: true },
    { routeV1Errors: { '2': 0 } },
  ])
    expect(() => validateProfile(invalid, 'application-ble')).toThrow();
  expect(defaultProfile('recovery-usb').bootWaitMs).toBe(300000);
});

test('a pending task refuses a different device returned during reconnect', async () => {
  const { connection, request } = setup();
  await connection.connect();
  connection.claim('firmware');
  connection.disconnect('firmware');
  const close = vi.fn();
  vi.mocked(connectBluetooth).mockResolvedValueOnce({
    device: { id: 'different' } as BluetoothDevice,
    close,
    request,
  });
  await expect(connection.ensure('firmware')).rejects.toMatchObject({ kind: 'protocol' });
  expect(close).toHaveBeenCalled();
  expect(connection.snapshot()).toMatchObject({ connected: false, task: 'firmware', target: 'ble:ble' });
});

test('retains session profiles across transport changes when persistent storage is unavailable', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('Storage disabled');
    },
  });
  const { connection } = setup();
  connection.configure({ protocolVersion: 1 });
  connection.select('usb');
  expect(connection.snapshot().profile.protocolVersion).toBe(2);
  connection.select('ble');
  expect(connection.snapshot()).toMatchObject({ profile: { protocolVersion: 1 }, settingsSaved: false });
});
