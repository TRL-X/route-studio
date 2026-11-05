import { geometryChanged } from './edit';
import {
  anchorPoint,
  distanceMeters,
  distances,
  lonDelta,
  newId,
  type Anchor,
  type Point,
  type RouteDocument,
  type Vertex,
} from './model';

export interface ResampleOptions {
  minSpacingM: number;
  maxSpacingM: number;
  toleranceM: number;
}
export const defaultResampleOptions: ResampleOptions = {
  minSpacingM: 2,
  maxSpacingM: 20,
  toleranceM: 0.5,
};
export const MAX_RESAMPLED_POINTS = 100_000;
export type ResampleErrorCode = 'options' | 'route' | 'limit';
export class ResampleError extends Error {
  constructor(public code: ResampleErrorCode) {
    super(code);
  }
}
export type ShortSegmentReason = 'station' | 'shape' | 'endpoint';
export interface ShortSegment {
  index: number;
  startM: number;
  endM: number;
  spacingM: number;
  reason: ShortSegmentReason;
}
export interface ResampleResult {
  document: RouteDocument;
  sourceDistances: number[];
  originalLengthM: number;
  lengthM: number;
  minSpacingM: number;
  maxSpacingM: number;
  maxDeviationM: number;
  shortSegments: ShortSegment[];
}

export function validResampleOptions(options: ResampleOptions) {
  return (
    Object.values(options).every(Number.isFinite) &&
    options.minSpacingM > 0 &&
    options.maxSpacingM >= options.minSpacingM &&
    options.toleranceM >= 0
  );
}

function upperBound(axis: number[], value: number) {
  let lo = 0,
    hi = axis.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (axis[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Node extends Point {
  s: number;
  original?: Vertex;
  reason?: ShortSegmentReason;
}

/** Resample geometry while retaining the ordered source-distance correspondence for every anchor. */
export function resampleRoute(doc: RouteDocument, options: ResampleOptions): ResampleResult {
  if (!validResampleOptions(options)) throw new ResampleError('options');
  const { vertices } = doc;
  if (
    vertices.length < 2 ||
    vertices.some(
      (p) =>
        !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180,
    )
  )
    throw new ResampleError('route');
  const axis = distances(vertices);
  const total = axis.at(-1)!;
  if (!(total > 0)) throw new ResampleError('route');
  if (Math.ceil(total / options.maxSpacingM) + 1 > MAX_RESAMPLED_POINTS) throw new ResampleError('limit');
  const indices = new Map(vertices.map((v, i) => [v.id, i]));
  if (indices.size !== vertices.length) throw new ResampleError('route');
  function sourceDistance(anchor: Anchor) {
    const i = indices.get(anchor.vertexId);
    if (i === undefined || !Number.isFinite(anchor.fraction) || anchor.fraction < 0 || anchor.fraction > 1)
      throw new ResampleError('route');
    return axis[i] + ((axis[i + 1] ?? axis[i]) - axis[i]) * anchor.fraction;
  }
  function node(s: number, reason?: ShortSegmentReason): Node {
    const i = s === 0 ? 0 : Math.min(vertices.length - 1, upperBound(axis, s) - 1);
    if (s === axis[i]) return { ...vertices[i], s, original: vertices[i], reason };
    const fraction = (s - axis[i]) / (axis[i + 1] - axis[i]);
    return { ...anchorPoint(doc, { vertexId: vertices[i].id, fraction }, indices), s, reason };
  }
  const pinned = new Map<number, Node>([
    [0, node(0, 'endpoint')],
    [total, node(total, 'endpoint')],
  ]);
  for (const station of doc.stations) {
    if (!station.anchor) continue;
    const s = sourceDistance(station.anchor);
    if (!pinned.has(s)) pinned.set(s, node(s, 'station'));
  }
  // Keep sharp turns even when the whole feature fits inside the deviation tolerance.
  // Skip coincident neighbours without deleting any of their observations.
  const distinct = vertices.map((_, i) => i).filter((i) => !i || axis[i] > axis[i - 1]);
  const visits = new Map<string, number>();
  for (let j = 0; j < distinct.length; j++) {
    const i = distinct[j],
      p = vertices[i];
    if (j > 0 && j < distinct.length - 1) {
      const a = vertices[distinct[j - 1]],
        b = vertices[distinct[j + 1]];
      const cos = Math.cos((p.lat * Math.PI) / 180);
      const ax = lonDelta(a.lon, p.lon) * cos,
        ay = p.lat - a.lat;
      const bx = lonDelta(p.lon, b.lon) * cos,
        by = b.lat - p.lat;
      if (ax * bx + ay * by <= Math.hypot(ax, ay) * Math.hypot(bx, by) * 1e-12 && !pinned.has(axis[i]))
        pinned.set(axis[i], node(axis[i], 'shape'));
    }
    const key = `${p.lat}/${p.lon === 180 ? -180 : p.lon}`;
    const previous = visits.get(key);
    if (previous !== undefined && j - previous > 2) {
      // Two diagonals must not replace a small closed loop with an out-and-back line.
      for (const k of [previous, previous + 1, j - 1, j]) {
        const s = axis[distinct[k]];
        if (!pinned.has(s)) pinned.set(s, node(s, 'shape'));
      }
    }
    visits.set(key, j);
  }
  // Validate all samples, including missing heights, before doing any expensive work.
  const sampleDistances = doc.elevation.map((sample) => sourceDistance(sample.anchor));
  const boundaries = [...pinned.values()].sort((a, b) => a.s - b.s);
  let plannedPoints = boundaries.length;
  if (plannedPoints > MAX_RESAMPLED_POINTS) throw new ResampleError('limit');
  const pending: [Node, Node][] = boundaries.slice(1).map((b, i) => [boundaries[i], b]);
  const output = new Map<number, Node>();
  let checks = 0;
  let maxDeviationM = 0;
  const rad = Math.PI / 180;
  const radius = 6_371_008.8;
  function spend(count = 1) {
    // Bound pathological dense zigzags as well as output size; the worker remains cancellable.
    checks += count;
    if (checks > 10_000_000) throw new ResampleError('limit');
  }
  function inspect(a: Node, b: Node): { split?: Node; deviation: number } {
    const first = upperBound(axis, a.s),
      stop = upperBound(axis, b.s);
    const dx = lonDelta(a.lon, b.lon),
      dy = b.lat - a.lat;
    // A constant longitude scale bounds the spherical distance throughout the latitude band.
    let nearestEquator = Math.min(Math.abs(a.lat), Math.abs(b.lat));
    let minLat = Math.min(a.lat, b.lat),
      maxLat = Math.max(a.lat, b.lat);
    for (let i = first; i < stop && axis[i] < b.s; i++) {
      spend();
      minLat = Math.min(minLat, vertices[i].lat);
      maxLat = Math.max(maxLat, vertices[i].lat);
      nearestEquator = Math.min(nearestEquator, Math.abs(vertices[i].lat));
    }
    const cos = minLat <= 0 && maxLat >= 0 ? 1 : Math.cos(nearestEquator * rad);
    let worst = 0,
      split: Node | undefined,
      reversal: Node | undefined;
    let previous: Node = a;
    let previousX = 0,
      previousY = 0;
    for (let i = first; i < stop && axis[i] < b.s; i++) {
      spend();
      const p = vertices[i],
        f = (axis[i] - a.s) / (b.s - a.s);
      const x = lonDelta(a.lon, p.lon),
        y = p.lat - a.lat;
      const error = Math.hypot((x - dx * f) * cos, y - dy * f) * rad * radius;
      if (error > worst) {
        worst = error;
        split = node(axis[i], 'shape');
      }
      // A short excursion must not disappear simply because it is within the tolerance.
      if ((x - previousX) * dx * cos * cos + (y - previousY) * dy < -1e-22)
        reversal ??= previous.s > a.s ? previous : node(axis[i], 'shape');
      previous = node(axis[i], 'shape');
      previousX = x;
      previousY = y;
    }
    if ((dx - previousX) * dx * cos * cos + (dy - previousY) * dy < -1e-22)
      reversal ??= previous.s > a.s ? previous : undefined;
    if (reversal) return { split: reversal, deviation: worst };
    if (split && (worst > options.toleranceM + 1e-8 || (dx === 0 && dy === 0)))
      return { split, deviation: worst };
    if (distanceMeters(a, b) > options.maxSpacingM + 1e-8)
      return { split: node(a.s + (b.s - a.s) / 2, 'shape'), deviation: worst };
    return { deviation: worst };
  }

  while (pending.length) {
    const [a, b] = pending.pop()!;
    const length = b.s - a.s;
    const lower = Math.max(1, Math.ceil(length / options.maxSpacingM));
    const upper = Math.floor(length / options.minSpacingM);
    const target = (options.minSpacingM + options.maxSpacingM) / 2;
    const count = upper >= lower ? Math.max(lower, Math.min(upper, Math.round(length / target))) : lower;
    if (plannedPoints + count - 1 > MAX_RESAMPLED_POINTS) throw new ResampleError('limit');
    spend(count);
    const candidates: Node[] = [a];
    for (let i = 1; i < count; i++) candidates.push(node(a.s + (length * i) / count));
    candidates.push(b);
    const splits: Node[] = [];
    let deviation = 0;
    for (let i = 1; i < candidates.length; i++) {
      const checked = inspect(candidates[i - 1], candidates[i]);
      if (checked.split) splits.push(checked.split);
      deviation = Math.max(deviation, checked.deviation);
    }
    if (splits.length) {
      plannedPoints += splits.length;
      if (plannedPoints > MAX_RESAMPLED_POINTS) throw new ResampleError('limit');
      // Rebalance around newly required corners instead of leaving tiny grid fragments beside them.
      const refined = [a, ...splits, b];
      for (let i = 1; i < refined.length; i++) {
        if (!(refined[i].s > refined[i - 1].s)) throw new ResampleError('limit');
        pending.push([refined[i - 1], refined[i]]);
      }
    } else {
      plannedPoints += count - 1;
      maxDeviationM = Math.max(maxDeviationM, deviation);
      for (const p of candidates) output.set(p.s, p);
    }
  }

  const nodes = [...output.values()].sort((a, b) => a.s - b.s);
  const nextVertices = nodes.map((p) => p.original ?? { id: newId(), lat: p.lat, lon: p.lon });
  const sourceDistances = nodes.map((p) => p.s);
  function remap(s: number): Anchor {
    const i = Math.min(nodes.length - 1, upperBound(sourceDistances, s) - 1);
    const span = sourceDistances[i + 1] - sourceDistances[i];
    return { vertexId: nextVertices[i].id, fraction: span > 0 ? (s - sourceDistances[i]) / span : 0 };
  }
  const document = geometryChanged({
    ...doc,
    vertices: nextVertices,
    stations: doc.stations.map((station) =>
      station.anchor ? { ...station, anchor: remap(sourceDistance(station.anchor)) } : station,
    ),
    elevation: doc.elevation.map((sample, i) => ({ ...sample, anchor: remap(sampleDistances[i]) })),
  });
  let minSpacingM = Infinity,
    maxSpacingM = 0,
    lengthM = 0;
  const shortSegments: ShortSegment[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const spacingM = distanceMeters(nodes[i - 1], nodes[i]);
    minSpacingM = Math.min(minSpacingM, spacingM);
    maxSpacingM = Math.max(maxSpacingM, spacingM);
    lengthM += spacingM;
    if (spacingM < options.minSpacingM - 1e-8) {
      const reasons = [nodes[i - 1].reason, nodes[i].reason];
      shortSegments.push({
        index: i - 1,
        startM: nodes[i - 1].s,
        endM: nodes[i].s,
        spacingM,
        reason: reasons.includes('station')
          ? 'station'
          : reasons.includes('shape')
            ? 'shape'
            : reasons.includes('endpoint')
              ? 'endpoint'
              : 'shape',
      });
    }
  }
  return {
    document,
    sourceDistances,
    originalLengthM: total,
    lengthM,
    minSpacingM,
    maxSpacingM,
    maxDeviationM,
    shortSegments,
  };
}
