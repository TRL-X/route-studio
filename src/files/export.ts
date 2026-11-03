import {
  anchorPoint,
  distances,
  type Anchor,
  type Point,
  type RouteDocument,
  type Station,
} from '../domain/model';
import { RouteFileError } from './errors';
import { writeTrackXml } from './export-xml';
import { writeFitCourse } from './export-fit';

export type TrackFormat = 'gpx' | 'kml' | 'fit';
export type ExportFormat = 'rte' | TrackFormat;
export interface ExportPoint extends Point {
  distance: number;
  height: number | null;
}
export interface ExportStation {
  name: string;
  kind: Station['kind'];
  location: Point;
  record?: ExportPoint;
}
export interface TrackExportPreview {
  points: number;
  stations: number;
  unplaced: string[];
  missingHeights: number;
  conflicts: number;
  absoluteKml: boolean;
  anchoredStations: number;
}

// Build one ordered line from the geometry and the independently anchored samples.
// Only FIT needs additional records at cues that lie between geometry vertices.
export function exportTrack(doc: RouteDocument, format: TrackFormat) {
  const axis = distances(doc.vertices);
  if (doc.vertices.length < 2 || !(axis.at(-1)! > 0)) throw new RouteFileError('export-no-line');
  const indices = new Map(doc.vertices.map((v, i) => [v.id, i]));
  const byPosition = new Map<number, ExportPoint>();
  function trackPoint(anchor: Anchor) {
    const index = indices.get(anchor.vertexId)!;
    const position = index + anchor.fraction;
    let point = byPosition.get(position);
    if (!point) {
      const vertex = Number.isInteger(position);
      const location = vertex ? doc.vertices[position] : anchorPoint(doc, anchor, indices);
      const distance = vertex
        ? axis[position]
        : axis[index] + (axis[index + 1] - axis[index]) * anchor.fraction;
      point = { lat: location.lat, lon: location.lon, distance, height: null };
      byPosition.set(position, point);
    }
    return point;
  }
  for (const vertex of doc.vertices) trackPoint({ vertexId: vertex.id, fraction: 0 });
  const conflicts = new Set<ExportPoint>();
  for (const sample of doc.elevation) {
    const point = trackPoint(sample.anchor);
    if (sample.height === null || conflicts.has(point)) continue;
    if (point.height !== null && point.height !== sample.height) {
      point.height = null;
      conflicts.add(point);
    } else point.height = sample.height;
  }
  const stations: ExportStation[] = [];
  const unplaced: string[] = [];
  let anchoredStations = 0;
  for (const station of doc.stations) {
    const record = format === 'fit' && station.anchor ? trackPoint(station.anchor) : undefined;
    const location =
      station.location ?? record ?? (station.anchor && anchorPoint(doc, station.anchor, indices));
    if (!location || (format === 'fit' && !record)) {
      unplaced.push(station.name || station.kind);
      continue;
    }
    if (station.anchor) anchoredStations++;
    stations.push({ name: station.name, kind: station.kind, location, record });
  }
  const points = [...byPosition.entries()].sort(([a], [b]) => a - b).map(([, point]) => point);
  const missingHeights = points.filter((p) => p.height === null).length;
  const absoluteKml = doc.elevationReference === 1 && missingHeights === 0;
  const preview: TrackExportPreview = {
    points: points.length,
    stations: stations.length,
    unplaced,
    missingHeights,
    conflicts: conflicts.size,
    absoluteKml,
    anchoredStations,
  };
  const bytes =
    format === 'fit'
      ? writeFitCourse(doc.name, points, stations)
      : new TextEncoder().encode(writeTrackXml(format, doc.name, points, stations, absoluteKml));
  return { bytes, preview };
}
