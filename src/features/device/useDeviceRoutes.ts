import { useEffect, useState, useSyncExternalStore } from 'react';
import { DeviceSession } from '../../device/session';

export function useDeviceRoutes() {
  const [session] = useState(() => new DeviceSession());
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => () => session.dispose(), [session]);
  return { session, state };
}
export type DeviceControls = ReturnType<typeof useDeviceRoutes>;
