import {
  distances,
  distanceMeters,
  projectSegment,
  type Anchor,
  type Point,
  type RouteDocument,
} from './model';

export interface StationPassage {
  anchor: Anchor;
  distance: number; // meters along the route
  offset: number; // lateral separation from the landmark, in meters
}

/** List stations in the order they are passed. Unassigned stations follow the finish. */
export function orderedStations(doc: RouteDocument, axis: number[]) {
  const indices = new Map(doc.vertices.map((vertex, i) => [vertex.id, i]));
  return doc.stations
    .map((station) => {
      const anchor = station.anchor;
      if (!anchor) return { station, meters: null };
      const i = indices.get(anchor.vertexId)!;
      const meters = axis[i] + ((axis[i + 1] ?? axis[i]) - axis[i]) * anchor.fraction;
      return { station, meters };
    })
    .sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity));
}

// Treat two nearby passes as alternatives within the precision of a GPS waypoint.
// Within a single pass keep only the closest point, regardless of vertex density.
const passTolerance = 25;
const metersPerDegree = (6_371_008.8 * Math.PI) / 180;

export function stationPassages(
  doc: RouteDocument,
  point: Point,
  axis = distances(doc.vertices),
): StationPassage[] {
  const vertices = doc.vertices;
  if (!vertices.length) return [];
  if (vertices.length === 1)
    return [
      {
        anchor: { vertexId: vertices[0].id, fraction: 0 },
        distance: 0,
        offset: distanceMeters(vertices[0], point),
      },
    ];

  const scale = Math.cos((point.lat * Math.PI) / 180);
  // Two scans avoid retaining a projection object per vertex of a long track.
  let best = Infinity;
  for (let i = 1; i < vertices.length; i++) {
    best = Math.min(best, projectSegment(vertices[i - 1], vertices[i], point, scale).distance2);
  }
  const radius = Math.sqrt(best) * metersPerDegree + passTolerance;
  const passages: StationPassage[] = [];
  let inside = false;
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i],
      b = vertices[i + 1];
    const projection = projectSegment(a, b, point, scale);
    const offset = Math.sqrt(projection.distance2) * metersPerDegree;
    if (offset > radius) {
      inside = false;
      continue;
    }
    // Even consecutive segments can be different visits (an out-and-back).
    // They belong to one visit only when their shared vertex is inside the search radius.
    const samePass = inside && distanceMeters(a, point) <= radius;
    inside = true;
    if (samePass && offset >= passages[passages.length - 1].offset) continue;
    const fraction = projection.fraction;
    const candidate = {
      anchor: fraction === 1 ? { vertexId: b.id, fraction: 0 } : { vertexId: a.id, fraction },
      distance: axis[i] + (axis[i + 1] - axis[i]) * fraction,
      offset,
    };
    if (samePass) passages[passages.length - 1] = candidate;
    else passages.push(candidate);
  }
  return passages;
}
