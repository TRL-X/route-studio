import { distanceMeters, lonDelta } from '../domain/model';
import { check, limit, MAX_NODES, quantize } from './check';
import { msg } from './messages';
import type { Geometry } from './records';

export const exportChoices = {
  intervalM: [0, 10, 20],
  toleranceM: [0, 2, 5],
  smoothingM: [0, 10, 30, 50],
} as const;

export type ExportOptions = { [K in keyof typeof exportChoices]: (typeof exportChoices)[K][number] };

export function validateExportOptions(options: ExportOptions) {
  for (const key of Object.keys(exportChoices) as (keyof ExportOptions)[]) {
    const choices: readonly number[] = exportChoices[key];
    check(choices.includes(options[key]), msg('compiler.invalidExportOptions'));
  }
}

export const defaultExportOptions: ExportOptions = { intervalM: 10, toleranceM: 2, smoothingM: 10 };

// Continuous source distances and heights in dm. Only the final device nodes are rounded.
export type ProfilePoint = [distance: number, height: number];

export function sampleProfile(
  source: ProfilePoint[],
  positions: Iterable<number>,
  total: number,
  options: ExportOptions,
) {
  const step = options.intervalM * 10;
  if (step) limit(Math.ceil(total / step) + 1 <= MAX_NODES, msg('compiler.nodeLimit'));
  const bins = new Set(positions);
  if (step) for (let s = 0; s < total; s += step) bins.add(s);
  bins.add(total);
  limit(bins.size <= MAX_NODES, msg('compiler.boundaryNodeLimit'));

  // Prefix integrals give a distance-weighted mean even for irregular source sampling.
  const area = [0];
  if (options.smoothingM)
    for (let i = 1; i < source.length; i++) {
      const [s, h] = source[i];
      const [prev, prevH] = source[i - 1];
      area.push(area[i - 1] + ((s - prev) * (h + prevH)) / 2);
    }
  const first = source[0][0],
    last = source.at(-1)![0];
  function value(s: number, integral: boolean) {
    let lo = 0,
      hi = source.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (source[mid][0] <= s) lo = mid;
      else hi = mid - 1;
    }
    const [x, h] = source[lo],
      next = source[lo + 1];
    const height = next ? h + ((s - x) * (next[1] - h)) / (next[0] - x) : h;
    return integral ? area[lo] + ((s - x) * (h + height)) / 2 : height;
  }
  const levels = new Map<number, number>();
  for (const bin of bins) {
    const s = bin === total ? last : Math.max(first, Math.min(bin, last));
    const radius = options.smoothingM * 5;
    const left = Math.max(first, s - radius),
      right = Math.min(last, s + radius);
    const height = right > left ? (value(right, true) - value(left, true)) / (right - left) : value(s, false);
    levels.set(bin, quantize(height));
  }
  return levels;
}

/** Bound displacement at the same reference distance and keep all required nodes. */
export function simplifyGeometry(nodes: Geometry[], pinned: Set<number>, tolerance: number) {
  if (!tolerance) return nodes;
  const coords = nodes.map(([lat, lon]) => ({ lat: lat / 1e7, lon: lon / 1e7 }));
  const keep = new Uint8Array(nodes.length);
  const spans: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (!pinned.has(nodes[i][2])) continue;
    keep[i] = 1;
    if (i > start) spans.push([start, i]);
    start = i;
  }
  while (spans.length) {
    const [left, right] = spans.pop()!;
    if (right - left < 2) continue;
    const a = coords[left],
      b = coords[right],
      distance = nodes[right][2] - nodes[left][2];
    let split = -1;
    // Avoid introducing long shortcuts or collapsing a loop to one coordinate.
    if (distance > 250 * 10 || (a.lat === b.lat && a.lon === b.lon)) {
      split = (left + right) >>> 1;
    } else {
      let worst = tolerance;
      for (let i = left + 1; i < right; i++) {
        const f = (nodes[i][2] - nodes[left][2]) / distance;
        const at = { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + lonDelta(a.lon, b.lon) * f };
        const offset = distanceMeters(at, coords[i]);
        if (offset > worst) {
          worst = offset;
          split = i;
        }
      }
    }
    if (split !== -1) {
      keep[split] = 1;
      spans.push([left, split], [split, right]);
    }
  }
  return nodes.filter((_, i) => keep[i]);
}

/** Keep ordered local extrema for display. Statistics and encoding use the full profiles. */
export function previewCurve(points: ProfilePoint[]): ProfilePoint[] {
  if (points.length <= 512) return points;
  const curve: ProfilePoint[] = [points[0]];
  const total = points.at(-1)![0];
  let i = 1;
  while (i < points.length - 1) {
    const column = Math.floor((points[i][0] / total) * 250);
    let low = i,
      high = i;
    do {
      if (points[i][1] < points[low][1]) low = i;
      if (points[i][1] > points[high][1]) high = i;
      i++;
    } while (i < points.length - 1 && Math.floor((points[i][0] / total) * 250) === column);
    curve.push(points[Math.min(low, high)]);
    if (low !== high) curve.push(points[Math.max(low, high)]);
  }
  curve.push(points.at(-1)!);
  return curve;
}
