import { Choice } from '../../ui/Choice';
import { Table, Button, Heading, Callout, Flex, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';
import { CircleCheck, ShieldAlert } from 'lucide-react';
import { declinationSettings } from '../../domain/declination';
import type { DeviceControls } from '../device/useDeviceRoutes';
import { DeviceUpload } from '../device/DeviceUpload';
import { ConnectionSettings } from '../device/ConnectionSettings';
import type { LookupState } from '../declination/useDeclinationLookup';
import en from '../../i18n/en.export.json';
import zh from '../../i18n/zh-CN.export.json';
import { ExportFrame, type ExportControls } from './ExportFrame';
import { TrackExportPreview } from './TrackExportPreview';
import type { ExportFormat } from '../../files/export';
import type { RteTarget } from '../../rte';
import type { RouteDocument } from '../../domain/model';
import type { ExportPreview } from '../../rte';
import { exportChoices, type ExportOptions, type ProfilePoint } from '../../rte/processing';
import { runIO, type IOResult } from '../../workers/io';
import { strings, type Copy } from '../../i18n/index';

type ExportResult = Extract<IOResult, { type: 'binary' | 'track-file' | 'error' }>;
type ExportError = Extract<IOResult, { type: 'error' }>;

function CurveComparison({ preview, t }: { preview: ExportPreview; t: Copy }) {
  const curves = [preview.sourceCurve, preview.outputCurve];
  const heights = curves.flat().map((p) => p[1]);
  const low = Math.min(...heights),
    high = Math.max(...heights);
  function trace(points: ProfilePoint[]) {
    return points
      .map(
        ([s, h], i) =>
          (i ? 'L' : 'M') +
          ((s / (preview.totalM * 10)) * 500).toFixed(2) +
          ' ' +
          (95 - ((h - low) / Math.max(1, high - low)) * 90).toFixed(2),
      )
      .join(' ');
  }
  return (
    <div className="export-plot">
      <div className="curve-legend">
        <span>{t.currentProject}</span>
        <span>{t.outputRte}</span>
      </div>
      <small>{Number((high / 10).toFixed(1))} m</small>
      <svg viewBox="0 0 500 100" preserveAspectRatio="none" role="img" aria-label={t.compareProfiles}>
        <path className="project-line" d={trace(curves[0])} />
        <path className="output-line" d={trace(curves[1])} />
      </svg>
      <small>{Number((low / 10).toFixed(1))} m</small>
      <div className="plot-axis">
        <small>0 km</small>
        <small>{(preview.totalM / 1000).toFixed(3)} km</small>
      </div>
    </div>
  );
}

export function ExportDialog({
  doc,
  format,
  lang,
  projectGain,
  lookup,
  onEditProperties,
  options,
  onOptions,
  name,
  onName,
  onFormat,
  onClose,
  onLocate,
  onDownload,
  saving,
  saveError,
  send,
}: ExportControls & {
  send?: { device: DeviceControls; onManage: () => void; onStart?: () => void };
  doc: RouteDocument;
  format: ExportFormat;
  projectGain: number | null;
  lookup: LookupState;
  onEditProperties: () => void;
  options: ExportOptions;
  onOptions: (v: ExportOptions) => void;
  onLocate: (error: ExportError & { target: Exclude<RteTarget, { type: 'declination' }> }) => void;
}) {
  const t = strings[lang];
  const copy = { en, zh }[lang];
  const uploading = !!send?.device.state.busy;
  const settingsLocked = !!saving || uploading || !!send?.device.state.pending;
  const mag = declinationSettings(doc);
  const [job, setJob] = useState<{
    doc: RouteDocument;
    format: ExportFormat;
    options: ExportOptions;
    result: ExportResult;
  } | null>(null);
  const [showPlot, setShowPlot] = useState(false);
  const [limit, setLimit] = useState(20);
  useEffect(() => {
    if (format === 'rte' && lookup.pending) return;
    const controller = new AbortController();
    runIO(
      format === 'rte' ? { type: 'compile', doc, options } : { type: 'export', doc, format },
      controller.signal,
    )
      .then((result) => {
        if (
          !controller.signal.aborted &&
          (result.type === 'binary' || result.type === 'track-file' || result.type === 'error')
        )
          setJob({ doc, format, options, result });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setJob({
            doc,
            format,
            options,
            result: {
              type: 'error',
              en: format === 'rte' ? strings.en.checkFailed : strings.en.trackExportFailed,
              zh: format === 'rte' ? strings.zh.checkFailed : strings.zh.trackExportFailed,
            },
          });
      });
    return () => controller.abort();
  }, [doc, format, options, lookup.pending]);
  const result =
    (format !== 'rte' || !lookup.pending) &&
    job?.doc === doc &&
    job.format === format &&
    job.options === options
      ? job.result
      : null;
  const ready = result?.type === 'binary' ? result : null;
  const trackFile = result?.type === 'track-file' ? result : null;
  const error = result?.type === 'error' ? result : null;
  const magneticError = error?.target?.type === 'declination';
  const preview = ready?.preview;
  const display = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 1 });
  const changeOption = (key: keyof ExportOptions, value: string) => {
    setLimit(20);
    onOptions({ ...options, [key]: Number(value) });
  };
  return (
    <ExportFrame
      format={format}
      lang={lang}
      name={send ? doc.name : name}
      onName={onName}
      onFormat={onFormat}
      onClose={onClose}
      onDownload={onDownload}
      saving={saving}
      sendMode={!!send}
      sending={uploading}
      saveError={saveError}
      bytes={ready?.bytes ?? trackFile?.bytes}
      extraAction={
        send ? (
          <DeviceUpload
            bytes={ready?.bytes}
            device={send.device}
            lang={lang}
            onManage={send.onManage}
            onStart={send.onStart}
          />
        ) : undefined
      }
    >
      {send && !send.device.state.connected && !send.device.state.pending && (
        <ConnectionSettings session={send.device.session.connectionSession} lang={lang} />
      )}
      {format === 'rte' && (
        <>
          <details>
            <summary>{t.processingOptions}</summary>
            <div className="export-options">
              <label>
                {t.profileSampling}
                <Choice
                  disabled={settingsLocked}
                  value={options.intervalM}
                  onValueChange={(value) => changeOption('intervalM', value)}
                  options={[
                    { value: 0, label: t.keepSamples },
                    ...exportChoices.intervalM.slice(1).map((n) => ({ value: n, label: `${n} m` })),
                  ]}
                />
              </label>
              <label>
                {t.geomSimplify}
                <Choice
                  disabled={settingsLocked}
                  value={options.toleranceM}
                  onValueChange={(value) => changeOption('toleranceM', value)}
                  options={[
                    { value: 0, label: t.off },
                    ...exportChoices.toleranceM.slice(1).map((n) => ({ value: n, label: `${n} m` })),
                  ]}
                />
              </label>
              <label>
                {t.smoothWindow}
                <Choice
                  disabled={settingsLocked}
                  value={options.smoothingM}
                  onValueChange={(value) => changeOption('smoothingM', value)}
                  options={[
                    { value: 0, label: t.off },
                    ...exportChoices.smoothingM.slice(1).map((n) => ({ value: n, label: `${n} m` })),
                  ]}
                />
              </label>
            </div>
            {options.smoothingM > 0 && <small>{t.smoothingNote}</small>}
          </details>
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              {t.magTitle} ·{' '}
              {mag.mode === 'auto' ? t.magAuto : mag.mode === 'manual' ? t.magManual : t.magOmit}
              {preview?.declinationCdeg !== undefined &&
                ' · ' + (preview.declinationCdeg / 100).toFixed(2) + '°'}
            </Text>
            <Text size="1" color="gray">
              {copy.magneticSummary}
            </Text>
            <Button variant="surface" color="gray" onClick={onEditProperties} disabled={settingsLocked}>
              {copy.editProperties}
            </Button>
          </Flex>
        </>
      )}
      <Text size="2" weight="medium" color={error ? 'red' : 'blue'} asChild>
        <Flex align="center" gap="2" role="status">
          {error ? <ShieldAlert size={16} /> : ready || trackFile ? <CircleCheck size={16} /> : null}
          {error
            ? t.needsRepair
            : ready || trackFile
              ? t.exportReady
              : format === 'rte' && lookup.pending
                ? t.magPending
                : t.busy}
        </Flex>
      </Text>
      {error && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{error.fileCode ? t.fileErrors[error.fileCode] : error[lang]}</Callout.Text>
          {magneticError && (
            <Button variant="soft" color="gray" onClick={onEditProperties}>
              {t.showIssue}
            </Button>
          )}
          {error.target && error.target.type !== 'declination' && (
            <Button
              variant="soft"
              color="gray"
              onClick={() => {
                const target = error.target;
                if (target && target.type !== 'declination') onLocate({ ...error, target });
              }}
            >
              {t.showIssue}
            </Button>
          )}
        </Callout.Root>
      )}
      {trackFile && format !== 'rte' && (
        <TrackExportPreview format={format} lang={lang} preview={trackFile.preview} />
      )}
      {preview && (
        <>
          <section className="export-preview">
            <header>
              <Heading as="h3" size="2">
                {t.exportPreview}
              </Heading>
              <small>
                {(preview.totalM / 1000).toLocaleString(lang, { maximumFractionDigits: 4 })} km ·{' '}
                {t.stageCount.replace('{count}', display(preview.stages))}
              </small>
            </header>
            <Table.Root size="1">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>{t.metric}</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>{t.currentProject}</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>{t.outputRte}</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {[
                  [t.geometryPoints, display(doc.vertices.length), display(preview.vertices)],
                  [t.profileSamples, display(doc.elevation.length), display(preview.samples)],
                  [
                    t.gain,
                    projectGain === null ? '—' : display(projectGain) + ' m',
                    display(preview.ascentM) + ' m',
                  ],
                ].map(([label, project, out]) => (
                  <Table.Row key={label}>
                    <Table.RowHeaderCell scope="row">{label}</Table.RowHeaderCell>
                    <Table.Cell>{project}</Table.Cell>
                    <Table.Cell>{out}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </section>
          <details open={showPlot} onToggle={(e) => setShowPlot(e.currentTarget.open)}>
            <summary>{t.compareProfiles}</summary>
            {showPlot && <CurveComparison preview={preview} t={t} />}
          </details>
          {!!options.intervalM && <small>{t.gridReport.replace('{step}', String(options.intervalM))}</small>}
          {preview.shared.length > 0 && (
            <details className="shared-records">
              <summary>{t.sharedReport.replace('{count}', display(preview.shared.length))}</summary>
              <ul>
                {preview.shared.slice(0, limit).map(({ meters, height }) => (
                  <li key={meters}>
                    {display(meters)} m → {display(height)} m
                  </li>
                ))}
              </ul>
              {limit < preview.shared.length && (
                <Button variant="soft" color="gray" onClick={() => setLimit(limit + 20)}>
                  {t.showMore}
                </Button>
              )}
            </details>
          )}
        </>
      )}
    </ExportFrame>
  );
}
