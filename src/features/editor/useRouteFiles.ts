import { useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { ImportElevationAssessment } from '../../domain/elevation-repair';
import type { RouteDocument } from '../../domain/model';
import { saveProject } from '../../files/project';
import type { ExportFormat } from '../../files/export';
import { both, strings, type Localized } from '../../i18n';
import { saveFile } from '../../platform/files';
import { runIO, type Choice as TrackChoice, type IOResult } from '../../workers/io';

export interface Replacement {
  doc: RouteDocument;
  source: string;
  elevationAssessment?: ImportElevationAssessment | null;
}

interface ImportChoice {
  list: TrackChoice[];
  file: File;
  index: number;
  accept: boolean;
}

export function routeFilename(name: string) {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .slice(0, 100) || 'route'
  );
}

function fileError(result: Extract<IOResult, { type: 'error' }>): Localized {
  const key = result.fileCode;
  return key && Object.hasOwn(strings.en.fileErrors, key)
    ? { en: strings.en.fileErrors[key], zh: strings.zh.fileErrors[key] }
    : result;
}

export function useRouteFiles({
  doc,
  currentDoc,
  dirty,
  protectRecovered,
  onReplace,
  onSaved,
  onNotice,
  onProblem,
}: {
  doc: RouteDocument;
  currentDoc: RefObject<RouteDocument>;
  dirty: boolean;
  protectRecovered: boolean;
  onReplace: (next: Replacement) => void;
  onSaved: (doc: RouteDocument, confirmed: boolean) => void;
  onNotice: (notice: Localized) => void;
  onProblem: (problem: Localized) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pickingFile, setPickingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [fileSaveError, setFileSaveError] = useState<Localized | null>(null);
  const [pending, setPending] = useState<{ next: Replacement; recovered: boolean } | null>(null);
  const [choices, setChoices] = useState<ImportChoice | null>(null);
  const ioLock = useRef(false);
  const saveLock = useRef(false);

  function replace(next: Replacement) {
    onReplace(next);
    setPending(null);
  }

  function requestReplace(next: Replacement) {
    if (dirty || protectRecovered) setPending({ next, recovered: protectRecovered });
    else replace(next);
  }

  async function openFile(file: File, index?: number, accept?: boolean) {
    if (ioLock.current) return;
    ioLock.current = true;
    setBusy(true);
    setChoices(null);
    try {
      const result = await runIO({ type: 'read', file, choice: index, accept });
      if (result.type === 'error') onProblem(fileError(result));
      else if (result.type === 'choices') setChoices({ file, list: result.choices, index: 0, accept: true });
      else if (result.type === 'document')
        requestReplace({
          doc: result.doc,
          source: file.name,
          elevationAssessment: result.elevationAssessment,
        });
    } catch {
      onProblem(both('readFailed'));
    } finally {
      setBusy(false);
      ioLock.current = false;
    }
  }

  async function pickDesktopFile() {
    setPickingFile(true);
    try {
      const file = await window.routeStudioDesktop!.openFile();
      if (file) await openFile(new File([file.bytes], file.name));
    } catch {
      onProblem(both('readFailed'));
    } finally {
      setPickingFile(false);
    }
  }

  async function save({ showProblem = true } = {}): Promise<boolean> {
    if (saveLock.current) return false;
    saveLock.current = true;
    setSavingFile(true);
    try {
      if (!(await saveFile(saveProject(doc), routeFilename(doc.name) + '.routeproj', 'application/json')))
        return false;
      const confirmed = !!window.routeStudioDesktop;
      flushSync(() => onSaved(doc, confirmed));
      onNotice(both(confirmed ? 'desktopProjectDone' : 'projectDone'));
      return currentDoc.current === doc;
    } catch {
      if (showProblem) onProblem(both('fileSaveFailed'));
      return false;
    } finally {
      saveLock.current = false;
      flushSync(() => setSavingFile(false));
    }
  }

  async function saveExport(format: ExportFormat, bytes: Uint8Array<ArrayBuffer>, name: string) {
    if (saveLock.current) return false;
    saveLock.current = true;
    setSavingFile(true);
    setFileSaveError(null);
    const types = {
      rte: 'application/octet-stream',
      fit: 'application/octet-stream',
      gpx: 'application/gpx+xml',
      kml: 'application/vnd.google-earth.kml+xml',
    };
    try {
      if (!(await saveFile(bytes, routeFilename(name) + '.' + format, types[format]))) return false;
      const key = window.routeStudioDesktop ? 'desktopFormatDone' : 'formatDone';
      onNotice({
        en: strings.en[key].replace('{format}', format.toUpperCase()),
        zh: strings.zh[key].replace('{format}', format.toUpperCase()),
      });
      return true;
    } catch {
      setFileSaveError(both('fileSaveFailed'));
      return false;
    } finally {
      saveLock.current = false;
      setSavingFile(false);
    }
  }

  return {
    busy,
    pickingFile,
    savingFile,
    fileSaveError,
    setFileSaveError,
    pending,
    setPending,
    choices,
    setChoices,
    replace,
    requestReplace,
    openFile,
    pickDesktopFile,
    save,
    saveExport,
  };
}
