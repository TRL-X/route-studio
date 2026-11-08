import { afterEach, describe, expect, test, vi } from 'vitest';
import { DeviceConnectionSession } from '../../src/device/connection-session';
import { DeviceSession } from '../../src/device/session';
import { FirmwareSession } from '../../src/device/firmware-session';

afterEach(() => vi.unstubAllGlobals());

describe.each(['ble', 'usb'] as const)('%s device selection', (transport) => {
  function setup() {
    const choose = vi.fn();
    vi.stubGlobal('navigator', {
      bluetooth: { requestDevice: choose },
      serial: { requestPort: choose },
    });
    vi.stubGlobal('window', {});
    const connection = new DeviceConnectionSession();
    connection.select(transport);
    return { choose, connection };
  }

  test.each(
    (['connection', 'routes', 'firmware', 'recovery'] as const).filter(
      (task) => task !== 'recovery' || transport === 'usb',
    ),
  )('cancelling the chooser leaves %s idle without an error', async (task) => {
    const { choose, connection } = setup();
    if (task === 'recovery') connection.setMode('recovery');
    const session =
      task === 'connection'
        ? connection
        : task === 'routes'
          ? new DeviceSession(connection)
          : new FirmwareSession(connection);
    choose.mockRejectedValue(new DOMException('No device selected', 'NotFoundError'));
    try {
      await session.connect();
      expect(choose).toHaveBeenCalledOnce();
      expect(connection.snapshot()).toMatchObject({
        busy: null,
        connected: false,
        remembered: false,
        task: null,
        error: undefined,
      });
      expect(session.snapshot()).toMatchObject({ busy: null, connected: false, error: undefined });

      // A second attempt must be allowed after cancellation released the connection/task lock.
      await session.connect();
      expect(choose).toHaveBeenCalledTimes(2);
      expect(session.snapshot().error).toBeUndefined();
    } finally {
      session.dispose();
      connection.dispose();
    }
  });

  test('still reports permission failures from the chooser', async () => {
    const { choose, connection } = setup();
    const error = new DOMException('Permission denied', 'SecurityError');
    choose.mockRejectedValue(error);
    try {
      await connection.connect();
      expect(connection.snapshot()).toMatchObject({ busy: null, connected: false, error });
    } finally {
      connection.dispose();
    }
  });

  test('still reports NotFoundError after a device has been selected', async () => {
    const { choose, connection } = setup();
    const error = new DOMException('Device service or port unavailable', 'NotFoundError');
    const fail = vi.fn().mockRejectedValue(error);
    const disconnect = vi.fn();
    choose.mockResolvedValue(
      transport === 'ble'
        ? Object.assign(new EventTarget(), {
            gatt: {
              connect: async () => ({ getPrimaryService: fail }),
              disconnect,
            },
          })
        : { open: fail },
    );
    try {
      await connection.connect();
      expect(fail).toHaveBeenCalledOnce();
      expect(connection.snapshot()).toMatchObject({ busy: null, connected: false, error });
      if (transport === 'ble') expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      connection.dispose();
    }
  });
});
