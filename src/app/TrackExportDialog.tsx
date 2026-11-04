import { Callout, Heading } from '@radix-ui/themes';
import { useEffect, useState } from 'react';
import type { RouteDocument } from '../domain/model';
import type { TrackFormat } from '../files/export';
import { ExportFrame, type ExportControls } from './ExportFrame';
import { runIO, type IOResult } from './io';
import { strings } from './strings';

export function TrackExportDialog({
  doc,
  format,
  ...controls
}: ExportControls & { doc: RouteDocument; format: TrackFormat }) {
  const t = strings[controls.lang];
  const [job, setJob] = useState<{
    doc: RouteDocument;
    format: TrackFormat;
    result: Extract<IOResult, { type: 'track-file' | 'error' }>;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    runIO({ type: 'export', doc, format }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && (result.type === 'track-file' || result.type === 'error'))
          setJob({ doc, format, result });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setJob({
            doc,
            format,
            result: { type: 'error', en: strings.en.trackExportFailed, zh: strings.zh.trackExportFailed },
          });
      });
    return () => controller.abort();
  }, [doc, format]);
  const result = job?.doc === doc && job.format === format ? job.result : null;
  const file = result?.type === 'track-file' ? result : null;
  const error =
    result?.type === 'error'
      ? result.fileCode
        ? t.fileErrors[result.fileCode]
        : result[controls.lang]
      : null;
  const preview = file?.preview;
  return (
    <ExportFrame {...controls} format={format} bytes={file?.bytes}>
      {error ? (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      ) : !preview ? (
        <p role="status">{t.busy}</p>
      ) : (
        <section className="track-export-preview">
          <Heading as="h3" size="2">
            {t.exportPreview}
          </Heading>
          <p>
            {t.trackCounts
              .replace('{points}', preview.points.toLocaleString(controls.lang))
              .replace('{stations}', preview.stations.toLocaleString(controls.lang))}
          </p>
          <ul>
            {format === 'fit' ? (
              <li>{t.fitCourseTime}</li>
            ) : (
              <li>{t.xmlWaypoints.replace('{count}', String(preview.anchoredStations))}</li>
            )}
            {format === 'kml' ? (
              <li>{preview.absoluteKml ? t.kmlAbsolute : t.kmlFlat}</li>
            ) : (
              preview.missingHeights > 0 && (
                <li>{t.exportMissingHeights.replace('{count}', String(preview.missingHeights))}</li>
              )
            )}
            {preview.conflicts > 0 && (
              <li>{t.exportHeightConflicts.replace('{count}', String(preview.conflicts))}</li>
            )}
            {preview.unplaced.length > 0 && (
              <li>
                {(format === 'fit' ? t.fitOmitted : t.xmlOmitted).replace(
                  '{names}',
                  preview.unplaced.join(', '),
                )}
              </li>
            )}
            <li>{t.trackProjectFields}</li>
          </ul>
        </section>
      )}
    </ExportFrame>
  );
}
