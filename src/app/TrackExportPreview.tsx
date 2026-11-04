import { Heading } from '@radix-ui/themes';
import type { TrackFormat, TrackExportPreview as Preview } from '../files/export';
import { strings, type Lang } from './strings';

export function TrackExportPreview({
  preview,
  format,
  lang,
}: {
  preview: Preview;
  format: TrackFormat;
  lang: Lang;
}) {
  const t = strings[lang];
  return (
    <section className="track-export-preview">
      <Heading as="h3" size="2">
        {t.exportPreview}
      </Heading>
      <p>
        {t.trackCounts
          .replace('{points}', preview.points.toLocaleString(lang))
          .replace('{stations}', preview.stations.toLocaleString(lang))}
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
            {(format === 'fit' ? t.fitOmitted : t.xmlOmitted).replace('{names}', preview.unplaced.join(', '))}
          </li>
        )}
        <li>{t.trackProjectFields}</li>
      </ul>
    </section>
  );
}
