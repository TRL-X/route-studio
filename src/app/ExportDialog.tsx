import { Choice } from './Choice';
import { Table, Button, Heading, Callout, Flex, Text } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, ShieldAlert } from 'lucide-react';
import { declinationSettings } from '../domain/declination';
import { DeclinationFields } from './DeclinationFields';
import { DeviceUpload } from './DeviceUpload';
import { useDeclinationLookup } from './useDeclinationLookup';
import { ExportFrame, type ExportControls } from './ExportFrame';
import type { RteTarget } from '../rte';
import type { RouteDocument } from '../domain/model';
import type { ExportPreview } from '../rte';
import { exportChoices, type ExportOptions, type ProfilePoint } from '../rte/processing';
import { runIO, type IOResult } from './io';
import { strings, type Copy } from './strings';

type ExportResult = Extract<IOResult, { type: 'binary' | 'error' }>;
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
  lang,
  projectGain,
  change,
  dispatch,
  options,
  onOptions,
  name,
  onName,
  onClose,
  onLocate,
  onDownload,
  saving,
  saveError,
}: ExportControls & {
  doc: RouteDocument;
  projectGain: number | null;
  change: (doc: RouteDocument) => void;
  dispatch: Parameters<typeof useDeclinationLookup>[1];
  options: ExportOptions;
  onOptions: (v: ExportOptions) => void;
  onLocate: (error: ExportError & { target: Exclude<RteTarget, { type: 'declination' }> }) => void;
}) {
  const t = strings[lang];
  const lookup = useDeclinationLookup(doc, dispatch);
  const mag = declinationSettings(doc);
  const magDetails = useRef<HTMLDetailsElement>(null);
  const [job, setJob] = useState<{ doc: RouteDocument; options: ExportOptions; result: ExportResult } | null>(
    null,
  );
  const [showPlot, setShowPlot] = useState(false);
  const [limit, setLimit] = useState(20);
  useEffect(() => {
    if (lookup.pending) return;
    const controller = new AbortController();
    runIO({ type: 'compile', doc, options }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && (result.type === 'binary' || result.type === 'error'))
          setJob({ doc, options, result });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setJob({
            doc,
            options,
            result: { type: 'error', en: strings.en.checkFailed, zh: strings.zh.checkFailed },
          });
      });
    return () => controller.abort();
  }, [doc, options, lookup.pending]);
  const result = !lookup.pending && job?.doc === doc && job.options === options ? job.result : null;
  const ready = result?.type === 'binary' ? result : null;
  const error = result?.type === 'error' ? result : null;
  const magneticError = error?.target?.type === 'declination';
  useEffect(() => {
    if (magneticError && magDetails.current) magDetails.current.open = true;
  }, [magneticError]);
  const preview = ready?.preview;
  const display = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 1 });
  const changeOption = (key: keyof ExportOptions, value: string) => {
    setLimit(20);
    onOptions({ ...options, [key]: Number(value) });
  };
  return (
    <ExportFrame
      format="rte"
      lang={lang}
      name={name}
      onName={onName}
      onClose={onClose}
      onDownload={onDownload}
      saving={saving}
      saveError={saveError}
      bytes={ready?.bytes}
      extraAction={<DeviceUpload bytes={ready?.bytes} t={t} />}
    >
      <details>
        <summary>{t.processingOptions}</summary>
        <div className="export-options">
          <label>
            {t.profileSampling}
            <Choice
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
      <details ref={magDetails} className="mag-export">
        <summary>
          {t.magTitle}{' '}
          <small>
            {mag.mode === 'auto' ? t.magAuto : mag.mode === 'manual' ? t.magManual : t.magOmit}
            {preview?.declinationCdeg !== undefined &&
              ' · ' + (preview.declinationCdeg / 100).toFixed(2) + '°'}
          </small>
        </summary>
        <DeclinationFields lang={lang} doc={doc} t={t} change={change} lookup={lookup} />
      </details>
      <Text size="2" weight="medium" color={error ? 'red' : 'blue'} asChild>
        <Flex align="center" gap="2" role="status">
          {error ? <ShieldAlert size={16} /> : ready ? <CircleCheck size={16} /> : null}
          {error ? t.needsRepair : ready ? t.exportReady : lookup.pending ? t.magPending : t.busy}
        </Flex>
      </Text>
      {error && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{error[lang]}</Callout.Text>
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
