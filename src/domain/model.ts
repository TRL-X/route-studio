import type { RteContext } from '../rte/context';

export interface Point {
  lat: number;
  lon: number;
}
export interface Vertex extends Point {
  id: string;
}
/** An outgoing edge identified by its first vertex. Its final endpoint has fraction 0 on the last vertex. */
export interface Anchor {
  vertexId: string;
  fraction: number;
}
export interface Sample {
  anchor: Anchor;
  height: number | null;
}
export interface Station {
  id: string;
  name: string;
  shortLabel?: string;
  kind: 'start' | 'finish' | 'cp' | 'poi';
  boundary: boolean;
  anchor: Anchor | null;
  location?: Point;
}
export interface RouteDocument {
  name: string;
  vertices: Vertex[];
  elevation: Sample[];
  stations: Station[];
  elevationReference: 0 | 1 | 2;
  rte?: RteContext;
}

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // LAN HTTP servers may expose getRandomValues without the secure-context UUID API.
  return (
    'id-' +
    [...crypto.getRandomValues(new Uint32Array(4))].map((word) => word.toString(16).padStart(8, '0')).join('')
  );
}
export const emptyRoute = (): RouteDocument => ({
  name: '',
  vertices: [],
  elevation: [],
  stations: [],
  elevationReference: 0,
});

const rad = Math.PI / 180;
export function lonDelta(from: number, to: number) {
  const delta = to - from;
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}
export function distanceMeters(a: Point, b: Point) {
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((lonDelta(a.lon, b.lon) * rad) / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function distances(vertices: Point[]) {
  let total = 0;
  return vertices.map((v, i) => (i ? (total += distanceMeters(vertices[i - 1], v)) : 0));
}
export function anchorPoint(
  doc: RouteDocument,
  anchor: Anchor,
  vertexIndices?: ReadonlyMap<string, number>,
): Point {
  const i = vertexIndices?.get(anchor.vertexId) ?? doc.vertices.findIndex((v) => v.id === anchor.vertexId);
  const a = doc.vertices[i];
  const b = doc.vertices[i + 1] ?? a;
  const lon = a.lon + lonDelta(a.lon, b.lon) * anchor.fraction;
  return {
    lat: a.lat + (b.lat - a.lat) * anchor.fraction,
    lon: lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon,
  };
}
export function anchorDistance(doc: RouteDocument, anchor: Anchor) {
  const axis = distances(doc.vertices);
  const i = doc.vertices.findIndex((v) => v.id === anchor.vertexId);
  return axis[i] + ((axis[i + 1] ?? axis[i]) - axis[i]) * anchor.fraction;
}
export function anchorAtDistance(doc: RouteDocument, meters: number, axis = distances(doc.vertices)): Anchor {
  let lo = 0,
    hi = axis.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (axis[mid] <= meters) lo = mid;
    else hi = mid - 1;
  }
  const span = axis[lo + 1] - axis[lo];
  return { vertexId: doc.vertices[lo].id, fraction: span > 0 ? Math.max(0, (meters - axis[lo]) / span) : 0 };
}
export function nearestAnchor(doc: RouteDocument, point: Point): Anchor {
  let anchor = { vertexId: doc.vertices[0].id, fraction: 0 };
  let best = Infinity;
  const scale = Math.cos(point.lat * rad);
  for (let i = 1; i < doc.vertices.length; i++) {
    const a = doc.vertices[i - 1],
      b = doc.vertices[i];
    const spanLon = lonDelta(a.lon, b.lon);
    const pointerLon = lonDelta(a.lon, point.lon);
    const dx = spanLon * scale,
      dy = b.lat - a.lat;
    const py = point.lat - a.lat;
    const length2 = dx * dx + dy * dy;
    // A segment can approach the pointer in the adjacent world copy even
    // when its start lies closer to this copy. Check both in that case.
    const offsets =
      Math.abs(pointerLon - spanLon) > 180
        ? [pointerLon, pointerLon + (pointerLon < 0 ? 360 : -360)]
        : [pointerLon];
    for (const offset of offsets) {
      const px = offset * scale;
      const f = length2 ? Math.min(1, Math.max(0, (px * dx + py * dy) / length2)) : 0;
      const d = (px - f * dx) ** 2 + (py - f * dy) ** 2;
      if (d < best) {
        best = d;
        anchor = f === 1 ? { vertexId: b.id, fraction: 0 } : { vertexId: a.id, fraction: f };
      }
    }
  }
  return anchor;
}
