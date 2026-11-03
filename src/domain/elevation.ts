import { distances, type RouteDocument } from './model';

export interface InterpolationResult {
  document: RouteDocument;
  filled: number;
  remaining: number;
}

interface Level {
  distance: number;
  height?: number;
  ambiguous: boolean;
  missing: number[];
  endpointId?: string;
}

/** Fill short gaps by route distance, extending the nearest observation at either endpoint. */
export function interpolateMissingHeights(document: RouteDocument, maxSpan = 1_000): InterpolationResult {
  const { vertices, elevation } = document;
  let missing = elevation.reduce((count, sample) => count + Number(sample.height === null), 0);
  if (missing === elevation.length || !vertices.length) return { document, filled: 0, remaining: missing };

  const axis = distances(vertices);
  const indices = new Map(vertices.map((v, i) => [v.id, i]));
  const levels = new Map<number, Level>();
  for (const [index, sample] of elevation.entries()) {
    const i = indices.get(sample.anchor.vertexId)!;
    const left = axis[i];
    const right = axis[i + 1] ?? left;
    const f = sample.anchor.fraction;
    // Alternate anchors for the same vertex must produce the exact same position.
    const distance = f === 1 ? right : left + (right - left) * f;
    let level = levels.get(distance);
    if (!level) {
      level = { distance, ambiguous: false, missing: [] };
      levels.set(distance, level);
    }
    if (sample.height === null) level.missing.push(index);
    else if (level.height === undefined) level.height = sample.height;
    else if (level.height !== sample.height) level.ambiguous = true;
  }

  // Sparse profiles can omit the endpoint sample entirely. Append it only if it can be filled.
  for (const i of [0, vertices.length - 1]) {
    if (!levels.has(axis[i])) {
      levels.set(axis[i], { distance: axis[i], ambiguous: false, missing: [], endpointId: vertices[i].id });
      missing++;
    }
  }
  if (!missing) return { document, filled: 0, remaining: 0 };

  const updated = elevation.slice();
  let filled = 0;
  function fill(level: Level, height: number) {
    for (const i of level.missing) updated[i] = { ...elevation[i], height };
    filled += level.missing.length;
    if (level.endpointId !== undefined) {
      updated.push({ anchor: { vertexId: level.endpointId, fraction: 0 }, height });
      filled++;
    }
  }

  const ordered = [...levels.values()].sort((a, b) => a.distance - b.distance);
  for (let i = 0; i < ordered.length;) {
    const level = ordered[i];
    if (level.height !== undefined) {
      if (!level.ambiguous) fill(level, level.height);
      i++;
      continue;
    }
    const first = i;
    while (i < ordered.length && ordered[i].height === undefined) i++;
    const left = ordered[first - 1],
      right = ordered[i];
    const start = left?.distance ?? 0;
    const span = (right?.distance ?? axis[axis.length - 1]) - start;
    if (left?.ambiguous || right?.ambiguous || span > maxSpan) continue;
    for (let j = first; j < i; j++) {
      if (left && right) {
        const t = (ordered[j].distance - start) / span;
        fill(ordered[j], (1 - t) * left.height! + t * right.height!);
      } else {
        fill(ordered[j], (left ?? right).height!);
      }
    }
  }
  return filled
    ? { document: { ...document, elevation: updated }, filled, remaining: missing - filled }
    : { document, filled: 0, remaining: missing };
}
