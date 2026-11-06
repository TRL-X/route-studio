import { useEffect, useState, useSyncExternalStore } from 'react';
import { BluetoothSession } from '../../device/bluetooth-session';
import { DeviceSession } from '../../device/session';
import { FirmwareSession } from '../../device/firmware-session';

export function useDevices() {
  const [sessions] = useState(() => {
    const connection = new BluetoothSession();
    return { connection, device: new DeviceSession(connection), firmware: new FirmwareSession(connection) };
  });
  const connection = useSyncExternalStore(sessions.connection.subscribe, sessions.connection.snapshot);
  const device = useSyncExternalStore(sessions.device.subscribe, sessions.device.snapshot);
  const firmware = useSyncExternalStore(sessions.firmware.subscribe, sessions.firmware.snapshot);
  useEffect(
    () => () => {
      sessions.device.dispose();
      sessions.firmware.dispose();
      sessions.connection.dispose();
    },
    [sessions],
  );
  useEffect(() => {
    if (!device.busy && !firmware.busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [device.busy, firmware.busy]);
  return {
    device: { session: sessions.device, state: device },
    firmware: { session: sessions.firmware, state: firmware },
    connection: { session: sessions.connection, state: connection },
  };
}
export type ConnectionControls = ReturnType<typeof useDevices>['connection'];
