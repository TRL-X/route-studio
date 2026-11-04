import { TextField, IconButton, Button } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
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
  const baseName = name
    .trim()
    .replace(/\.(rte|fit|gpx|kml)$/i, '')
    .trim();
  const invalidName = !baseName || /[\\/:*?"<>|\u0000-\u001f]/.test(baseName);
  return (
    <Modal
      className="export-dialog"
      title={t.exportFormatTitle.replace('{format}', format.toUpperCase())}
      onClose={onClose}
      busy={saving}
    >
      <IconButton
        variant="ghost"
        color="gray"
        className="dialog-close"
        aria-label={t.close}
        onClick={onClose}
        disabled={saving}
      >
        <X />
      </IconButton>
      <div className="export-body">
        <label className="export-field">
          {t.exportFilename}
          <TextField.Root
            value={name}
            onChange={(e) => onName(e.target.value)}
            maxLength={100}
            aria-invalid={invalidName}
            aria-describedby={invalidName ? 'export-filename-error' : undefined}
          >
            <TextField.Slot side="right">.{format}</TextField.Slot>
          </TextField.Root>
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
        <Button
          variant="surface"
          color="gray"

          disabled={!bytes || invalidName || saving}
          onClick={() => {
            if (bytes) onDownload(bytes, baseName);
          }}
        >
          <ArrowDownToLine />
          {t.downloadFormat.replace('{format}', format.toUpperCase())}
        </Button>
        {extraAction}
      </footer>
    </Modal>
  );
}
