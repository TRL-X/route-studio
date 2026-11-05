import { expect, test, vi } from 'vitest';
import { connectBluetooth, DeviceError } from '../../src/device/mcumgr';
import { DeviceSession } from '../../src/device/session';
import { Firmware } from './firmware';
vi.mock('../../src/device/mcumgr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/device/mcumgr')>()),
  connectBluetooth: vi.fn(),
}));
function setup() {
  const firmware = new Firmware();
  vi.mocked(connectBluetooth).mockImplementation(async (_signal, lost) => ({
    device: { id: 'arcap', name: 'AR Cap' } as BluetoothDevice,
    close: vi.fn(),
    request: async (...args) => {
      try {
        return await firmware.request(...args);
      } catch (error) {
        if (error instanceof DeviceError && error.kind === 'disconnected') lost();
        throw error;
      }
    },
  }));
  return { firmware, session: new DeviceSession() };
}
test('does capacity preflight before creating a transaction', async () => {
  const { firmware, session } = setup();
  await session.connect();
  firmware.freeBytes = 4096;
  await session.send(new Uint8Array(10));
  expect(session.snapshot()).toMatchObject({ busy: null, pending: false, error: { rc: 5 } });
  expect(firmware.calls.some((c) => c.cmd === 2 && c.group === 64)).toBe(false);
});
test('retains pending transfer after disconnect and prevents switching devices', async () => {
  const { firmware, session } = setup();
  await session.connect();
  firmware.lose = 'write';
  await session.send(new Uint8Array(1000));
  expect(session.snapshot()).toMatchObject({ pending: true, connected: false, busy: null });
  const calls = vi.mocked(connectBluetooth).mock.calls.length;
  await session.connect(true);
  expect(vi.mocked(connectBluetooth).mock.calls).toHaveLength(calls);
  await session.connect();
  expect(vi.mocked(connectBluetooth).mock.calls.at(-1)?.[2]?.id).toBe('arcap');
  session.cancel();
  await vi.waitFor(() =>
    expect(session.snapshot()).toMatchObject({ pending: false, progress: { state: 'cancelled' } }),
  );
});
test('refreshes after a stale delete but never silently retries the deletion', async () => {
  const { firmware, session } = setup();
  firmware.items = [{ id: 1, name: 'A', size: 100, total_dm: 10, state: 'ready', error: 0, in_use: false }];
  await session.connect();
  const rev = session.snapshot().catalog!.rev;
  firmware.rev++;
  await session.delete(1, rev);
  expect(session.snapshot()).toMatchObject({ busy: null, catalog: { rev: firmware.rev }, error: { rc: 11 } });
  expect(firmware.calls.filter((c) => c.cmd === 5)).toHaveLength(1);
  expect(firmware.items).toHaveLength(1);
});

test('connects and sends in one action, retaining the bytes chosen before connection', async () => {
  vi.useFakeTimers();
  try {
    const { firmware, session } = setup();
    const data = new Uint8Array([1, 2, 3]);
    const sending = session.send(data);
    expect(session.snapshot().busy).toBe('connecting');
    data.fill(9);
    await vi.runAllTimersAsync();
    await sending;
    expect(session.snapshot()).toMatchObject({ busy: null, connected: true, progress: { state: 'ready' } });
    expect(firmware.received).toEqual(new Uint8Array([1, 2, 3]));
    await session.delete(firmware.id, firmware.rev);
    expect(session.snapshot().progress).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test('one action reconnects the original device and resumes without another PREPARE', async () => {
  vi.useFakeTimers();
  try {
    const { firmware, session } = setup();
    firmware.lose = 'write';
    await session.send(new Uint8Array(1000));
    expect(session.snapshot()).toMatchObject({ pending: true, connected: false });
    const resumed = session.resume();
    await vi.runAllTimersAsync();
    await resumed;
    expect(session.snapshot()).toMatchObject({ pending: false, progress: { state: 'ready' } });
    expect(vi.mocked(connectBluetooth).mock.calls.at(-1)?.[2]?.id).toBe('arcap');
    expect(firmware.calls.filter((c) => c.group === 64 && c.cmd === 2)).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test('cancelling device selection never starts a deferred upload', async () => {
  const { firmware, session } = setup();
  vi.mocked(connectBluetooth).mockImplementationOnce(
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  const sending = session.send(new Uint8Array(10));
  session.cancelConnection();
  await sending;
  expect(session.snapshot()).toMatchObject({ busy: null, connected: false, pending: false });
  expect(firmware.calls).toHaveLength(0);
  await session.connect();
  expect(firmware.calls.every((c) => c.op === 'read')).toBe(true);
});
