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
}

/** Interpolate a draft on the same continuous horizontal distance axis used by the editor. */
export function interpolateMissingHeights(document: RouteDocument, maxSpan = Infinity): InterpolationResult {
  const { vertices, elevation } = document;
  const missing = elevation.reduce((count, sample) => count + Number(sample.height === null), 0);
  const unchanged = { document, filled: 0, remaining: missing };
  if (!missing || missing === elevation.length || !vertices.length) return unchanged;

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

  const updated = elevation.slice();
  let filled = 0;
  function fill(level: Level, height: number) {
    for (const i of level.missing) updated[i] = { ...elevation[i], height };
    filled += level.missing.length;
  }

  let previous: Level | undefined;
  const gap: Level[] = [];
  for (const level of [...levels.values()].sort((a, b) => a.distance - b.distance)) {
    if (level.ambiguous) {
      // An ambiguous observation cannot serve as either end of an interpolation.
      previous = undefined;
      gap.length = 0;
    } else if (level.height === undefined) {
      if (previous) gap.push(level);
    } else {
      if (previous && level.distance - previous.distance <= maxSpan) {
        for (const interior of gap) {
          const t = (interior.distance - previous.distance) / (level.distance - previous.distance);
          fill(interior, (1 - t) * previous.height! + t * level.height);
        }
      }
      fill(level, level.height);
      previous = level;
      gap.length = 0;
    }
  }
  return filled
    ? { document: { ...document, elevation: updated }, filled, remaining: missing - filled }
    : unchanged;
}
