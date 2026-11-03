import { automaticDeclination, newId, type Point, type RouteDocument, type Station } from '../domain/model';

export interface RouteChoice {
  name: string;
  pointCount: number;
  hasUnconfirmedHeights: boolean;
  open(useUnconfirmedHeights?: boolean): RouteDocument;
}

export type TrackPoint = Point & { height: number | null };
export type Line = {
  name: string;
  points: TrackPoint[];
  heights: 'unknown-reference' | 'sea-level' | 'unconfirmed' | 'unavailable';
};

// A stationary run has one route position. Preserve a single known height,
// or leave a gap for the editor if its source measurements disagree.
export function mergeStationaryPoints(points: TrackPoint[], vertexIndices?: number[]): TrackPoint[] {
  const result: TrackPoint[] = [];
  let index = 0;
  while (index < points.length) {
    const start = index;
    const first = points[index++];
    let height = first.height;
    let conflicting = false;
    while (index < points.length && points[index].lat === first.lat && points[index].lon === first.lon) {
      const next = points[index++].height;
      if (next === null) continue;
      if (height !== null && height !== next) conflicting = true;
      height = next;
    }
    if (vertexIndices) {
      for (let i = start; i < index; i++) vertexIndices.push(result.length);
    }
    result.push({ ...first, height: conflicting ? null : height });
  }
  return result;
}

export function documentFromLine(line: Line, useUnconfirmedHeights = false): RouteDocument {
  const keepHeights =
    line.heights !== 'unavailable' && (line.heights !== 'unconfirmed' || useUnconfirmedHeights);
  const vertices = line.points.map(({ lat, lon }) => ({
    id: newId(),
    lat,
    lon,
  }));
  const elevation = line.points.map(({ height }, i) => ({
    anchor: { vertexId: vertices[i].id, fraction: 0 },
    height: keepHeights ? height : null,
  }));
  const doc: RouteDocument = {
    name: line.name,
    declination: automaticDeclination(),
    vertices,
    elevation,
    stations: [],
    elevationReference: line.heights === 'sea-level' ? 1 : 0,
  };
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const start: Station = {
    id: newId(),
    name: 'Start',
    kind: 'start',
    boundary: true,
    anchor: { vertexId: first.id, fraction: 0 },
  };
  const finish: Station = {
    id: newId(),
    name: 'Finish',
    kind: 'finish',
    boundary: true,
    anchor: { vertexId: last.id, fraction: 0 },
  };
  doc.stations.push(start, finish);
  return doc;
}
