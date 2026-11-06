import { useEffect, useState, useSyncExternalStore } from 'react';
import { FirmwareSession } from '../../device/firmware-session';

export function useFirmware() {
  const [session] = useState(() => new FirmwareSession());
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (!state.busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [state.busy]);
  return { session, state };
}
export type FirmwareControls = ReturnType<typeof useFirmware>;
