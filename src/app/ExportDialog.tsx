import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CircleCheck, ShieldAlert, X } from 'lucide-react';
import { declinationSettings } from '../domain/declination';
import { DeclinationFields } from './DeclinationFields';
import { useDeclinationLookup } from './useDeclinationLookup';
import type { RteTarget } from '../rte';
import type { RouteDocument } from '../domain/model';
import type { ExportPreview } from '../rte';
import { exportChoices, type ExportOptions, type ProfilePoint } from '../rte/processing';
import { runIO, type IOResult } from './io';
import { strings, type Copy, type Lang } from './strings';

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
}: {
  doc: RouteDocument;
  lang: Lang;
  projectGain: number | null;
  change: (doc: RouteDocument) => void;
  dispatch: Parameters<typeof useDeclinationLookup>[1];
  options: ExportOptions;
  onOptions: (v: ExportOptions) => void;
  name: string;
  onName: (v: string) => void;
  onClose: () => void;
  onLocate: (error: ExportError & { target: Exclude<RteTarget, { type: 'declination' }> }) => void;
  onDownload: (bytes: Uint8Array<ArrayBuffer>, name: string) => void;
}) {
  const t = strings[lang],
    ref = useRef<HTMLDialogElement>(null);
  const lookup = useDeclinationLookup(doc, dispatch);
  const mag = declinationSettings(doc);
  const magDetails = useRef<HTMLDetailsElement>(null);
  const [job, setJob] = useState<{ doc: RouteDocument; options: ExportOptions; result: ExportResult } | null>(
    null,
  );
  const [showPlot, setShowPlot] = useState(false);
  const [limit, setLimit] = useState(20);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
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
  const baseName = name
    .trim()
    .replace(/\.rte$/i, '')
    .trim();
  const invalidName = !baseName || /[\\/:*?"<>|\u0000-\u001f]/.test(baseName);
  const changeOption = (key: keyof ExportOptions, value: string) => {
    setLimit(20);
    onOptions({ ...options, [key]: Number(value) });
  };
  return (
    <dialog
      className="export-dialog"
      ref={ref}
      aria-labelledby="export-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <small>Route Studio</small>
          <h2 id="export-title">{t.exportTitle}</h2>
        </div>
        <button className="icon" aria-label={t.close} onClick={onClose}>
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
            <span>.rte</span>
          </span>
        </label>
        {invalidName && (
          <small id="export-filename-error" role="alert">
            {t.invalidExportName}
          </small>
        )}
        <details>
          <summary>{t.processingOptions}</summary>
          <div className="export-options">
            <label>
              {t.profileSampling}
              <select value={options.intervalM} onChange={(e) => changeOption('intervalM', e.target.value)}>
                <option value={0}>{t.keepSamples}</option>
                {exportChoices.intervalM.slice(1).map((n) => (
                  <option key={n} value={n}>
                    {n} m
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.geomSimplify}
              <select value={options.toleranceM} onChange={(e) => changeOption('toleranceM', e.target.value)}>
                <option value={0}>{t.off}</option>
                {exportChoices.toleranceM.slice(1).map((n) => (
                  <option key={n} value={n}>
                    {n} m
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.smoothWindow}
              <select value={options.smoothingM} onChange={(e) => changeOption('smoothingM', e.target.value)}>
                <option value={0}>{t.off}</option>
                {exportChoices.smoothingM.slice(1).map((n) => (
                  <option key={n} value={n}>
                    {n} m
                  </option>
                ))}
              </select>
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
        <div className="export-state" role="status" data-error={!!error}>
          {error ? <ShieldAlert size={16} /> : ready ? <CircleCheck size={16} /> : null}
          {error ? t.needsRepair : ready ? t.exportReady : lookup.pending ? t.magPending : t.busy}
        </div>
        {error && (
          <div className="field-issue" role="alert">
            <p>{error[lang]}</p>
            {error.target && error.target.type !== 'declination' && (
              <button
                className="sub-action"
                onClick={() => {
                  const target = error.target;
                  if (target && target.type !== 'declination') onLocate({ ...error, target });
                }}
              >
                {t.showIssue}
              </button>
            )}
          </div>
        )}
        {preview && (
          <>
            <section className="export-preview">
              <header>
                <h3>{t.exportPreview}</h3>
                <small>
                  {(preview.totalM / 1000).toLocaleString(lang, { maximumFractionDigits: 4 })} km ·{' '}
                  {t.stageCount.replace('{count}', display(preview.stages))}
                </small>
              </header>
              <table>
                <thead>
                  <tr>
                    <th>{t.metric}</th>
                    <th>{t.currentProject}</th>
                    <th>{t.outputRte}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [t.geometryPoints, display(doc.vertices.length), display(preview.vertices)],
                    [t.profileSamples, display(doc.elevation.length), display(preview.samples)],
                    [
                      t.gain,
                      projectGain === null ? '—' : display(projectGain) + ' m',
                      display(preview.ascentM) + ' m',
                    ],
                  ].map(([label, project, out]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      <td>{project}</td>
                      <td>{out}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <details open={showPlot} onToggle={(e) => setShowPlot(e.currentTarget.open)}>
              <summary>{t.compareProfiles}</summary>
              {showPlot && <CurveComparison preview={preview} t={t} />}
            </details>
            {!!options.intervalM && (
              <small>{t.gridReport.replace('{step}', String(options.intervalM))}</small>
            )}
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
                  <button className="sub-action" onClick={() => setLimit(limit + 20)}>
                    {t.showMore}
                  </button>
                )}
              </details>
            )}
          </>
        )}
      </div>
      <footer>
        <small>
          {t.fileSize} · {ready ? display(ready.bytes.byteLength / 1024) + ' KiB' : '—'}
        </small>
        <button
          className="primary"
          disabled={!ready || invalidName}
          onClick={() => {
            if (ready) onDownload(ready.bytes, baseName);
          }}
        >
          <ArrowDownToLine />
          {t.downloadRte}
        </button>
      </footer>
    </dialog>
  );
}
