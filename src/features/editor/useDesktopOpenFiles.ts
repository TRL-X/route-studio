import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OpenFileRequest } from '../../../electron/contracts';
import { both, type Localized } from '../../i18n';

export function useDesktopOpenFiles({
  blocked,
  openFile,
  onProblem,
}: {
  blocked: boolean;
  openFile: (file: File) => Promise<void>;
  onProblem: (problem: Localized) => void;
}) {
  const api = window.routeStudioDesktop;
  const [revision, refresh] = useState(0);
  const [request, setRequest] = useState<OpenFileRequest | null>(null);
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);
  const current = useRef({ blocked, openFile, onProblem });
  useLayoutEffect(() => {
    current.current = { blocked, openFile, onProblem };
  });

  // Subscribe before the initial pull. Startup requests stay in the main process
  // while draft recovery runs, and can be claimed again after a renderer reload.
  useEffect(() => api?.onOpenFiles(() => refresh((value) => value + 1)), [api]);
  useEffect(() => {
    if (!api || blocked || request || reading) return;
    let active = true;
    void api.getOpenFiles().then(
      (next) => {
        if (active) setRequest(next);
      },
      () => {
        if (active) current.current.onProblem(both('readFailed'));
      },
    );
    return () => {
      active = false;
    };
  }, [api, blocked, request, reading, revision]);

  async function choose(index: number) {
    if (!api || !request || readingRef.current || current.current.blocked) return;
    readingRef.current = true;
    // Commit a field's pending edit before locking the editor or capturing its
    // dirty state. This also covers OS opens while a name is still being typed.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    setReading(true);
    try {
      const file = await api.readOpenFile(request.id, index);
      await current.current.openFile(new File([file.bytes], file.name));
    } catch {
      current.current.onProblem(both('readFailed'));
    } finally {
      // Track selection and replacement confirmation now belong to useRouteFiles;
      // their blocked state prevents the next request from interrupting them.
      api.finishOpenFiles(request.id);
      setRequest(null);
      readingRef.current = false;
      setReading(false);
      refresh((value) => value + 1);
    }
  }

  useEffect(() => {
    if (request?.names.length === 1 && !blocked) void choose(0);
  }, [request, blocked]);

  function cancel() {
    if (!api || !request || readingRef.current) return;
    api.finishOpenFiles(request.id);
    setRequest(null);
    refresh((value) => value + 1);
  }

  return {
    selection: request && request.names.length > 1 && !blocked && !reading ? request : null,
    reading,
    choose,
    cancel,
  };
}
