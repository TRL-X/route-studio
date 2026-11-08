import { TextField, IconButton, Button, Flex, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { Modal } from '../../ui/Modal';
import { ArrowDownToLine, X } from 'lucide-react';
import type { ExportFormat } from '../../files/export';
import { punctuation, strings, type Lang } from '../../i18n/index';
import { Choice } from '../../ui/Choice';
import en from '../../i18n/en.export.json';
import zh from '../../i18n/zh-CN.export.json';

export interface ExportControls {
  lang: Lang;
  name: string;
  onName: (name: string) => void;
  onFormat: (format: ExportFormat) => void;
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
  onFormat,
  onClose,
  onDownload,
  bytes,
  children,
  extraAction,
  saving,
  saveError,
  sendMode = false,
  sending = false,
}: ExportControls & {
  format: ExportFormat;
  bytes?: Uint8Array<ArrayBuffer>;
  children: ReactNode;
  extraAction?: ReactNode;
  sendMode?: boolean;
  sending?: boolean;
}) {
  const t = strings[lang];
  const copy = { en, zh }[lang];
  const baseName = name
    .trim()
    .replace(/\.(rte|fit|gpx|kml)$/i, '')
    .trim();
  const invalidName = !baseName || /[\\/:*?"<>|\u0000-\u001f]/.test(baseName);
  return (
    <Modal
      className="export-dialog"
      maxWidth="560px"
      title={sendMode ? copy.sendTitle : copy.title}
      onClose={onClose}
      busy={saving}
    >
      <IconButton
        variant="ghost"
        color="gray"
        className="dialog-close"
        aria-label={sending ? copy.hide : t.close}
        onClick={onClose}
        disabled={saving}
      >
        <X />
      </IconButton>
      <Flex direction="column" gap="4" minHeight="0" overflowY="auto" pb="4">
        {sendMode ? (
          <Text size="2" color="gray">
            {copy.routeName}
            {punctuation[lang].colon}
            {name}
          </Text>
        ) : (
          <>
            <label>
              <Text as="div" size="2" color="gray" mb="1">
                {t.exportFormat}
              </Text>
              <Choice
                aria-label={t.exportFormat}
                value={format}
                disabled={saving}
                onValueChange={(next) => onFormat(next as ExportFormat)}
                options={(['rte', 'gpx', 'kml', 'fit'] as const).map((value) => ({
                  value,
                  label: value.toUpperCase(),
                }))}
              />
            </label>
            <label>
              <Text as="div" size="2" color="gray" mb="1">
                {t.exportFilename}
              </Text>
              <TextField.Root
                value={name}
                disabled={saving}
                onChange={(e) => onName(e.target.value)}
                maxLength={100}
                aria-invalid={invalidName}
                aria-describedby={invalidName ? 'export-filename-error' : undefined}
              >
                <TextField.Slot side="right">.{format}</TextField.Slot>
              </TextField.Root>
            </label>
            {invalidName && (
              <Text size="2" color="red" id="export-filename-error" role="alert">
                {t.invalidExportName}
              </Text>
            )}
          </>
        )}
        {children}
        {saveError && <p role="alert">{saveError}</p>}
      </Flex>
      <Flex asChild justify="end" align="center" wrap="wrap" gap="3" pt="3" flexShrink="0">
        <footer>
          <Text size="2" color="gray" mr="auto">
            {t.fileSize}
            {punctuation[lang].colon}
            {bytes
              ? (bytes.byteLength / 1024).toLocaleString(lang, { maximumFractionDigits: 1 }) + ' KiB'
              : '—'}
          </Text>
          {!sendMode && (
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
          )}
          {extraAction}
        </footer>
      </Flex>
    </Modal>
  );
}
