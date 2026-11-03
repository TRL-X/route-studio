import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowDownToLine, X } from 'lucide-react';
import type { ExportFormat } from '../files/export';
import { strings, type Lang } from './strings';

export interface ExportControls {
  lang: Lang;
  name: string;
  onName: (name: string) => void;
  onClose: () => void;
  onDownload: (bytes: Uint8Array<ArrayBuffer>, name: string) => void;
  saving?: boolean;
  saveError?: string | null;
}

export function ExportFrame({
  format,
  lang,
  name,
  onName,
  onClose,
  onDownload,
  bytes,
  children,
  extraAction,
  saving,
  saveError,
}: ExportControls & {
  format: ExportFormat;
  bytes?: Uint8Array<ArrayBuffer>;
  children: ReactNode;
  extraAction?: ReactNode;
}) {
  const t = strings[lang];
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const baseName = name
    .trim()
    .replace(/\.(rte|fit|gpx|kml)$/i, '')
    .trim();
  const invalidName = !baseName || /[\\/:*?"<>|\u0000-\u001f]/.test(baseName);
  return (
    <dialog
      className="export-dialog"
      ref={ref}
      aria-labelledby="export-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
    >
      <header>
        <div>
          <small>Route Studio</small>
          <h2 id="export-title">{t.exportFormatTitle.replace('{format}', format.toUpperCase())}</h2>
        </div>
        <button className="icon" aria-label={t.close} onClick={onClose} disabled={saving}>
          <X />
        </button>
      </header>
      <div className="export-body">
        <label className="export-field">
          {t.exportFilename}
          <span className="export-name">
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              maxLength={100}
              aria-invalid={invalidName}
              aria-describedby={invalidName ? 'export-filename-error' : undefined}
            />
            <span>.{format}</span>
          </span>
        </label>
        {invalidName && (
          <small id="export-filename-error" role="alert">
            {t.invalidExportName}
          </small>
        )}
        {children}
        {saveError && <p role="alert">{saveError}</p>}
      </div>
      <footer>
        <small>
          {t.fileSize} ·{' '}
          {bytes
            ? (bytes.byteLength / 1024).toLocaleString(lang, { maximumFractionDigits: 1 }) + ' KiB'
            : '—'}
        </small>
        <button
          className="button"
          disabled={!bytes || invalidName || saving}
          onClick={() => {
            if (bytes) onDownload(bytes, baseName);
          }}
        >
          <ArrowDownToLine />
          {t.downloadFormat.replace('{format}', format.toUpperCase())}
        </button>
        {extraAction}
      </footer>
    </dialog>
  );
}
