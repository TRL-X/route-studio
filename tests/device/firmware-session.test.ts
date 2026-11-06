import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { connectBluetooth, DeviceError, type Fields, type SmpRequest } from '../../src/device/mcumgr';
import { connectSerial } from '../../src/device/serial';
import { FirmwareSession } from '../../src/device/firmware-session';
import { parseFirmware } from '../../src/device/firmware';
import { BluetoothSession } from '../../src/device/bluetooth-session';
import { DeviceSession } from '../../src/device/session';
import { Firmware as RoutePeer } from './firmware';

vi.mock('../../src/device/mcumgr', async (original) => ({
  ...(await original<typeof import('../../src/device/mcumgr')>()),
  connectBluetooth: vi.fn(),
}));
vi.mock('../../src/device/serial', () => ({ connectSerial: vi.fn() }));

async function setup(bluetooth?: BluetoothSession, routes?: RoutePeer) {
  const bytes = new Uint8Array(32 + 800 + 40);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x96f3b83d, true);
  view.setUint16(8, 32, true);
  view.setUint32(12, 800, true);
  bytes[20] = 2;
  view.setUint16(832, 0x6907, true);
  view.setUint16(834, 40, true);
  view.setUint16(836, 0x10, true);
  view.setUint16(838, 32, true);
  bytes.set(createHash('sha256').update(bytes.subarray(0, 832)).digest(), 840);
  const image = await parseFirmware(bytes);
  const oldHash = new Uint8Array(32).fill(7);
  const old = () => ({ slot: 0, version: '1.0.0', hash: oldHash, active: true, confirmed: true });
  const state = {
    images: [old()] as Fields[],
    off: 0,
    autoConfirm: false,
    rollback: false,
    loseUpload: false,
    rejectReset: false,
    omitUploaded: false,
    ignoreTest: false,
    lost: () => {},
    close: vi.fn(async () => {}),
    calls: [] as { group: number; cmd: number; op: string; fields: Fields; version?: number }[],
  };
  const request: SmpRequest = async (group, cmd, op, fields, version) => {
    state.calls.push({ group, cmd, op, fields, version });
    if (group === 64 || group === 8) {
      if (!routes) return { rc: 8 };
      try {
        return await routes.request(group, cmd, op, fields);
      } catch (error) {
        if (error instanceof DeviceError && error.kind === 'disconnected') state.lost();
        throw error;
      }
    }
    if (group === 1 && cmd === 0 && op === 'read') return { images: state.images };
    if (group === 1 && cmd === 1) {
      if (fields.off === state.off) state.off += (fields.data as Uint8Array).length;
      if (state.off === bytes.length && !state.omitUploaded)
        state.images = [old(), { slot: 1, version: image.version, hash: image.imageHash }];
      if (state.loseUpload) {
        state.loseUpload = false;
        state.lost();
        throw new DeviceError('disconnected');
      }
      return { off: state.off };
    }
    if (group === 1 && cmd === 0 && op === 'write') {
      if (fields.confirm === false) state.images[1].pending = !state.ignoreTest;
      else state.images.find((entry) => entry.active)!.confirmed = true;
      return { images: state.images };
    }
    if (group === 0 && cmd === 5) {
      if (state.rejectReset) return { rc: 8 };
      state.images = state.rollback
        ? [old()]
        : [
            {
              slot: 0,
              version: image.version,
              hash: image.imageHash,
              active: true,
              confirmed: state.autoConfirm,
            },
          ];
      state.lost();
      throw new DeviceError('disconnected');
    }
    throw new Error('Unexpected command');
  };
  vi.mocked(connectBluetooth).mockImplementation(async (_signal, lost) => {
    state.lost = lost;
    return {
      device: { id: 'test-device', name: 'Test device' } as BluetoothDevice,
      close: state.close,
      request,
    };
  });
  vi.mocked(connectSerial).mockImplementation(async (_signal, lost) => {
    state.lost = lost;
    return {
      port: {} as Awaited<ReturnType<typeof connectSerial>>['port'],
      name: 'Serial',
      close: state.close,
      request,
    };
  });
  const session = new FirmwareSession(bluetooth);
  const file = { name: 'firmware.bin', size: bytes.length, arrayBuffer: async () => bytes.buffer };
  await session.selectFile(file);
  return { session, state, image, file, old };
}

test('BLE uses only standard image/OS commands and confirms only after reconnecting to the selected image', async () => {
  const { session, state } = await setup();
  await session.connect();
  await session.upload();
  expect(session.snapshot()).toMatchObject({ phase: 'uploaded', connected: true });
  await session.testAndRestart();
  expect(session.snapshot()).toMatchObject({
    phase: 'awaitingReconnect',
    connected: false,
    error: undefined,
  });
  expect(state.calls.some((call) => call.fields.confirm === true)).toBe(false);
  await session.check();
  expect(session.snapshot().phase).toBe('unconfirmed');
  await session.confirm();
  expect(session.snapshot()).toMatchObject({ phase: 'complete', busy: null });
  expect(state.calls.every((call) => call.group === 0 || call.group === 1)).toBe(true);
});

test('recognizes device confirmation without sending an extra confirm', async () => {
  const { session, state } = await setup();
  state.autoConfirm = true;
  await session.connect();
  await session.upload();
  await session.testAndRestart();
  await session.check();
  expect(session.snapshot().phase).toBe('complete');
  expect(state.calls.some((call) => call.fields.confirm === true)).toBe(false);
});

test('reports a return to the original image without claiming upgrade success', async () => {
  const { session, state } = await setup();
  state.rollback = true;
  await session.connect();
  await session.upload();
  await session.testAndRestart();
  await session.check();
  expect(session.snapshot().phase).toBe('reverted');
  await session.confirm();
  expect(state.calls.some((call) => call.fields.confirm === true)).toBe(false);
});

test('does not confirm a different image after a previously unconfirmed target disappears', async () => {
  const { session, state, image, old } = await setup();
  state.images = [{ slot: 0, version: image.version, hash: image.imageHash, active: true }];
  await session.connect();
  expect(session.snapshot().phase).toBe('unconfirmed');
  state.images = [old()];
  await session.confirm();
  expect(session.snapshot().phase).toBe('ready');
  expect(state.calls.some((call) => call.fields.confirm === true)).toBe(false);
});

test('does not overwrite another unconfirmed running image', async () => {
  const { session, state } = await setup();
  state.images[0].confirmed = false;
  await session.connect();
  await session.upload();
  expect(session.snapshot().error).toMatchObject({ code: 'unconfirmedImage' });
  expect(state.calls.some((call) => call.cmd === 1)).toBe(false);
});

test('resumes an interrupted upload from the offset returned by the same peer', async () => {
  const { session, state, image } = await setup();
  state.loseUpload = true;
  await session.connect();
  await session.upload();
  expect(session.snapshot()).toMatchObject({ phase: 'paused', connected: false });
  const off = state.off;
  await session.connect();
  await session.upload();
  expect(session.snapshot()).toMatchObject({ phase: 'uploaded', off: image.size });
  const uploads = state.calls.filter((call) => call.cmd === 1);
  expect(uploads.slice(0, 3).map((call) => call.fields.off)).toEqual([0, 0, off]);
});

test('a completed transfer must appear with the selected image hash before trial boot', async () => {
  const { session, state } = await setup();
  state.omitUploaded = true;
  await session.connect();
  await session.upload();
  expect(session.snapshot()).toMatchObject({ phase: 'paused', error: { code: 'uploadMismatch' } });
  await session.testAndRestart();
  expect(state.calls.some((call) => call.group === 0)).toBe(false);
});

test('reopening a firmware task preserves its error and does not perform device work', async () => {
  const { session, state } = await setup();
  state.omitUploaded = true;
  await session.connect();
  await session.upload();
  const snapshot = session.snapshot();
  expect(snapshot.error).toMatchObject({ code: 'uploadMismatch' });
  const changed = vi.fn();
  const unsubscribe = session.subscribe(changed);
  const calls = state.calls.length;
  const connections = vi.mocked(connectBluetooth).mock.calls.length;
  await session.setMode('ble');
  await session.setMode('usb');
  expect(session.snapshot()).toBe(snapshot);
  expect(changed).not.toHaveBeenCalled();
  expect(state.calls).toHaveLength(calls);
  expect(vi.mocked(connectBluetooth).mock.calls).toHaveLength(connections);
  unsubscribe();
});

test('an explicitly rejected restart can be retried without permanently confirming the image', async () => {
  const { session, state } = await setup();
  await session.connect();
  await session.upload();
  state.rejectReset = true;
  await session.testAndRestart();
  expect(session.snapshot()).toMatchObject({ phase: 'awaitingReconnect', error: { kind: 'device' } });
  await session.check();
  expect(session.snapshot().phase).toBe('awaitingReconnect');
  state.rejectReset = false;
  await session.restartPending();
  await session.check();
  expect(session.snapshot().phase).toBe('unconfirmed');
});

test('does not restart when the device does not mark the selected image pending', async () => {
  const { session, state } = await setup();
  state.ignoreTest = true;
  await session.connect();
  await session.upload();
  await session.testAndRestart();
  expect(session.snapshot()).toMatchObject({ phase: 'uploaded', error: { code: 'uploadMismatch' } });
  expect(state.calls.some((call) => call.group === 0)).toBe(false);
});

test('a late disconnect callback from an old connection cannot clear the new connection', async () => {
  const { session, state } = await setup();
  await session.connect();
  const oldLost = state.lost;
  await session.disconnect();
  await session.connect();
  oldLost();
  expect(session.snapshot()).toMatchObject({ connected: true, error: undefined });
});

test('USB recovery works without image-list/test/confirm support and tracks restart separately', async () => {
  const { session, state } = await setup();
  await session.setMode('usb');
  await session.connect();
  await session.upload();
  expect(session.snapshot()).toMatchObject({ phase: 'recovered', recoveryRestarted: false });
  await session.disconnect();
  expect(session.snapshot()).toMatchObject({ phase: 'recovered', recoveryRestarted: false });
  await session.connect();
  await session.restartRecovery();
  expect(session.snapshot()).toMatchObject({ phase: 'recovered', connected: false, recoveryRestarted: true });
  expect(
    state.calls.every((call) => (call.group === 1 && call.cmd === 1) || (call.group === 0 && call.cmd === 5)),
  ).toBe(true);
});

test('a rejected USB reset does not claim a restart was requested successfully', async () => {
  const { session, state } = await setup();
  await session.setMode('usb');
  await session.connect();
  await session.upload();
  state.rejectReset = true;
  await session.restartRecovery();
  expect(session.snapshot()).toMatchObject({ recoveryRestarted: false, error: { kind: 'device' } });
});

test('a failed file selection removes the previously valid image', async () => {
  const { session } = await setup();
  await session.selectFile({ name: 'bad.hex', size: 2, arrayBuffer: async () => new ArrayBuffer(2) });
  expect(session.snapshot()).toMatchObject({
    image: undefined,
    filename: '',
    error: { code: 'invalidFile' },
  });
});

test('closing a late connection after cancellation never starts a transfer', async () => {
  const { session, state } = await setup();
  let resolve!: (value: Awaited<ReturnType<typeof connectBluetooth>>) => void;
  vi.mocked(connectBluetooth).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = session.connect();
  session.cancelConnection();
  resolve({ device: { id: 'late' } as BluetoothDevice, close: state.close, request: vi.fn() });
  await pending;
  expect(state.close).toHaveBeenCalled();
  expect(session.snapshot()).toMatchObject({ connected: false, busy: null });
  expect(state.calls).toHaveLength(0);
});

test('shares one Bluetooth connection and isolates unsupported route capabilities from firmware', async () => {
  const bluetooth = new BluetoothSession();
  const { session, state } = await setup(bluetooth);
  const routes = new DeviceSession(bluetooth);
  const before = vi.mocked(connectBluetooth).mock.calls.length;
  await bluetooth.connect();
  expect(state.calls).toHaveLength(0);
  await routes.connect();
  const routeError = routes.snapshot().error;
  expect(routeError).toMatchObject({ kind: 'device', rc: 8 });
  expect(bluetooth.snapshot()).toMatchObject({ connected: true, error: undefined, task: null });
  await session.connect();
  expect(session.snapshot()).toMatchObject({ connected: true, error: undefined });
  expect(routes.snapshot().error).toBe(routeError);
  expect(vi.mocked(connectBluetooth).mock.calls.length - before).toBe(1);
  expect(state.close).not.toHaveBeenCalled();
  expect(state.calls.map((call) => [call.group, call.version])).toEqual([
    [64, 2],
    [1, 1],
  ]);
});

test('shares the same connection between route catalog and firmware inspection', async () => {
  const bluetooth = new BluetoothSession();
  const { session, state } = await setup(bluetooth, new RoutePeer());
  const routes = new DeviceSession(bluetooth);
  const before = vi.mocked(connectBluetooth).mock.calls.length;
  await routes.connect();
  await session.connect();
  await routes.refresh();
  expect(routes.snapshot().catalog).toBeDefined();
  expect(session.snapshot().images).toHaveLength(1);
  expect(vi.mocked(connectBluetooth).mock.calls.length - before).toBe(1);
  expect(state.close).not.toHaveBeenCalled();
});

test('selecting a new idle Bluetooth target clears results from the previous target', async () => {
  const bluetooth = new BluetoothSession();
  const { session, state, image } = await setup(bluetooth);
  const routes = new DeviceSession(bluetooth);
  state.images = [{ slot: 0, version: image.version, hash: image.imageHash, active: true, confirmed: true }];
  await routes.connect();
  await session.connect();
  expect(routes.snapshot().error).toBeDefined();
  expect(session.snapshot().phase).toBe('complete');
  const link = await vi.mocked(connectBluetooth).mock.results.at(-1)!.value;
  vi.mocked(connectBluetooth).mockResolvedValueOnce({
    ...link,
    device: { id: 'another-device', name: 'Another device' } as BluetoothDevice,
  });
  await bluetooth.connect(true);
  expect(routes.snapshot()).toMatchObject({ connected: true, error: undefined });
  expect(session.snapshot()).toMatchObject({ phase: 'ready', images: [], deviceName: 'Another device' });
});

test('reserves a disconnected route transaction against firmware, deletion, and target switching', async () => {
  const bluetooth = new BluetoothSession();
  const peer = new RoutePeer();
  const { session, state } = await setup(bluetooth, peer);
  const routes = new DeviceSession(bluetooth);
  peer.lose = 'write';
  await routes.send(new Uint8Array(1000));
  expect(bluetooth.snapshot()).toMatchObject({ connected: false, task: 'routes' });
  const before = state.calls.length;
  const connects = vi.mocked(connectBluetooth).mock.calls.length;
  await session.connect();
  await session.upload();
  await routes.delete(1, 0n);
  await bluetooth.connect(true);
  bluetooth.disconnect();
  expect(state.calls).toHaveLength(before);
  expect(vi.mocked(connectBluetooth).mock.calls).toHaveLength(connects);
  routes.cancel();
  await vi.waitFor(() => expect(routes.snapshot().pending).toBe(false));
  expect(bluetooth.snapshot().task).toBeNull();
  await session.connect();
  expect(session.snapshot().connected).toBe(true);
});

test('ending a disconnected route transaction unlocks USB recovery without changing remote bytes', async () => {
  const bluetooth = new BluetoothSession();
  const peer = new RoutePeer();
  const { session, state } = await setup(bluetooth, peer);
  const routes = new DeviceSession(bluetooth);
  peer.lose = 'write';
  await routes.send(new Uint8Array(1000).fill(3));
  expect(routes.snapshot()).toMatchObject({ connected: false, pending: true });
  expect(bluetooth.snapshot().task).toBe('routes');
  const bytes = peer.received.slice();
  const requestCount = state.calls.length;
  routes.abandon();
  expect(routes.snapshot()).toMatchObject({
    pending: false,
    progress: undefined,
    transferBytes: undefined,
    totalBytes: 0,
    cancelling: false,
    error: undefined,
  });
  expect(bluetooth.snapshot().task).toBeNull();
  await session.setMode('usb');
  await session.connect();
  expect(session.snapshot()).toMatchObject({ mode: 'usb', connected: true });
  expect(state.calls).toHaveLength(requestCount);
  expect(peer.received).toEqual(bytes);
});

test('freezes the firmware target, transport and file until a paused task is explicitly discarded', async () => {
  const bluetooth = new BluetoothSession();
  const { session, state, file } = await setup(bluetooth, new RoutePeer());
  const routes = new DeviceSession(bluetooth);
  await session.connect();
  state.loseUpload = true;
  await session.upload();
  const image = session.snapshot().image;
  const before = state.calls.length;
  await session.setMode('usb');
  await session.selectFile({ ...file, name: 'replacement.bin' });
  await session.chooseAnother();
  await routes.send(new Uint8Array(10));
  await bluetooth.connect(true);
  expect(session.snapshot()).toMatchObject({ mode: 'ble', image, filename: file.name, pending: true });
  expect(state.calls).toHaveLength(before);
  expect(bluetooth.snapshot().task).toBe('firmware');
  session.abandon();
  expect(session.snapshot()).toMatchObject({ image: undefined, phase: 'ready', pending: false });
  expect(bluetooth.snapshot().task).toBeNull();
  await session.setMode('usb');
  expect(session.snapshot().mode).toBe('usb');
});

test('USB recovery keeps Bluetooth connected but excludes route operations until discard', async () => {
  const bluetooth = new BluetoothSession();
  const { session, state } = await setup(bluetooth, new RoutePeer());
  const routes = new DeviceSession(bluetooth);
  await routes.connect();
  await session.setMode('usb');
  expect(bluetooth.snapshot().connected).toBe(true);
  await session.connect();
  state.loseUpload = true;
  await session.upload();
  expect(session.snapshot()).toMatchObject({ mode: 'usb', phase: 'paused', connected: false });
  expect(bluetooth.snapshot()).toMatchObject({ connected: true, task: 'firmware' });
  const before = state.calls.length;
  await routes.refresh();
  expect(state.calls).toHaveLength(before);
  session.abandon();
  await routes.refresh();
  expect(routes.snapshot().catalog).toBeDefined();
  expect(state.calls.length).toBeGreaterThan(before);
});

test('ending an unreachable trial boot releases USB recovery without mutating the target', async () => {
  const bluetooth = new BluetoothSession();
  const { session, state } = await setup(bluetooth);
  await session.connect();
  await session.upload();
  await session.testAndRestart();
  expect(session.snapshot()).toMatchObject({ phase: 'awaitingReconnect', pending: true });
  const before = state.calls.length;
  session.abandon();
  expect(state.calls).toHaveLength(before);
  expect(bluetooth.snapshot().task).toBeNull();
  expect(session.snapshot()).toMatchObject({ phase: 'ready', pending: false, image: undefined });
  await session.setMode('usb');
  expect(session.snapshot().mode).toBe('usb');
  expect(state.calls).toHaveLength(before);
});

test('one update action uploads, trial boots and reconnects without automatically confirming', async () => {
  vi.useFakeTimers();
  try {
    const bluetooth = new BluetoothSession();
    const { session, state } = await setup(bluetooth);
    const updating = session.update();
    await vi.runAllTimersAsync();
    await updating;
    expect(session.snapshot()).toMatchObject({
      phase: 'unconfirmed',
      connected: true,
      busy: null,
      pending: true,
    });
    expect(bluetooth.snapshot().task).toBe('firmware');
    expect(state.calls.some((call) => call.fields.confirm === true)).toBe(false);
    await session.confirm();
    expect(bluetooth.snapshot().task).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test('automatic boot checks do not report a premature rollback and leave explicit checking available', async () => {
  vi.useFakeTimers();
  try {
    const { session, state } = await setup();
    state.rollback = true;
    const updating = session.update();
    await vi.runAllTimersAsync();
    await updating;
    expect(session.snapshot()).toMatchObject({ phase: 'awaitingReconnect', busy: null });
    await session.check();
    expect(session.snapshot().phase).toBe('reverted');
  } finally {
    vi.useRealTimers();
  }
});

test('cancelling automatic reconnect does not start a later retry', async () => {
  vi.useFakeTimers();
  try {
    const { session } = await setup();
    const updating = session.update();
    await vi.advanceTimersByTimeAsync(1);
    expect(session.snapshot()).toMatchObject({ phase: 'awaitingReconnect', busy: 'connecting' });
    const before = vi.mocked(connectBluetooth).mock.calls.length;
    session.cancelConnection();
    await vi.runAllTimersAsync();
    await updating;
    expect(session.snapshot()).toMatchObject({ phase: 'awaitingReconnect', busy: null, error: undefined });
    expect(vi.mocked(connectBluetooth).mock.calls).toHaveLength(before);
  } finally {
    vi.useRealTimers();
  }
});
