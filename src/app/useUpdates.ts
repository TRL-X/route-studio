import { useEffect, useRef, useState } from 'react';
import type { UpdateState } from '../../electron/update-contracts';

export function useUpdates() {
  const desktop = window.routeStudioDesktop;
  const [state, setState] = useState<UpdateState>();
  const [unavailable, setUnavailable] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let received = false;
    const unsubscribe = desktop.onUpdateState((next) => {
      received = true;
      revision.current++;
      setState(next);
      setUnavailable(false);
    });
    void desktop
      .getUpdateState()
      .then((next) => {
        if (active && !received) setState(next);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop]);
  async function run(operation: () => Promise<UpdateState>) {
    const started = revision.current;
    try {
      const next = await operation();
      // Event delivery can overtake an older IPC response (e.g. a preference change during a download).
      if (revision.current === started) setState(next);
      setUnavailable(false);
      return next;
    } catch {
      setUnavailable(true);
      return undefined;
    }
  }
  return {
    state,
    unavailable,
    check: () => run(() => desktop!.checkForUpdates()),
    download: () => run(() => desktop!.downloadUpdate()),
    open: () => run(() => desktop!.openUpdateDownload()),
    install: (discard: boolean) => run(() => desktop!.installUpdate(discard)),
    setAutoCheck: (enabled: boolean) => {
      setState((value) => value && { ...value, autoCheck: enabled });
      return run(() => desktop!.setUpdateAutoCheck(enabled));
    },
  };
}

export type UpdateControls = ReturnType<typeof useUpdates>;
