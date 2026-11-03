import { limit, MAX_NODES } from '../rte/check';
import { msg } from '../rte/messages';
import {
  anchorAtDistance,
  anchorPoint,
  distances,
  type Anchor,
  type Point,
  type RouteDocument,
} from './model';

interface Location {
  anchor: Anchor;
  position: number;
  added: boolean;
  query: number;
}

/** Sample along the route for a complete new profile from a single DEM. */
export function planTerrain(doc: RouteDocument) {
  const points: Point[] = [];
  const queryDistances: number[] = [];
  const { vertices, elevation } = doc;
  limit(vertices.length <= MAX_NODES && elevation.length <= MAX_NODES, msg('compiler.nodeLimit'));
  if (!vertices.length) return { points, queryDistances, apply: () => doc };
  const axis = distances(vertices);
  const indices = new Map(vertices.map((vertex, index) => [vertex.id, index]));
  const byPosition = new Map<number, Location>();
  function location(anchor: Anchor, position: number, added: boolean) {
    let level = byPosition.get(position);
    if (!level) {
      level = { anchor, position, added, query: -1 };
      byPosition.set(position, level);
    }
    return level;
  }
  const original = elevation.map(({ anchor }) => {
    const i = indices.get(anchor.vertexId)!;
    const right = axis[i + 1] ?? axis[i];
    const position = anchor.fraction === 1 ? right : axis[i] + (right - axis[i]) * anchor.fraction;
    return location(anchor, position, false);
  });
  function addVertex(i: number) {
    location({ vertexId: vertices[i].id, fraction: 0 }, axis[i], true);
  }
  if (!elevation.length) vertices.forEach((_, i) => addVertex(i));
  else {
    addVertex(0);
    addVertex(vertices.length - 1);
  }

  const levels = [...byPosition.values()].sort((a, b) => a.position - b.position);
  const baseCount = elevation.length + levels.reduce((n, level) => n + Number(level.added), 0);
  limit(baseCount <= MAX_NODES, msg('compiler.nodeLimit'));
  // Coarsen very long routes before allocating additional samples.
  const routeLength = axis[axis.length - 1];
  const spacing = baseCount === MAX_NODES ? Infinity : Math.max(60, routeLength / (MAX_NODES - baseCount));
  const additions: Location[] = [];
  function plan(level: Location) {
    if (level.added) additions.push(level);
    level.query = points.length;
    points.push(anchorPoint(doc, level.anchor, indices));
    queryDistances.push(level.position);
  }
  for (const [i, right] of levels.entries()) {
    const left = levels[i - 1];
    if (left) {
      const length = right.position - left.position;
      const divisions = Math.ceil(length / spacing);
      for (let part = 1; part < divisions; part++) {
        const position = left.position + length * (part / divisions);
        plan({ position, anchor: anchorAtDistance(doc, position, axis), added: true, query: -1 });
      }
    }
    plan(right);
  }

  function apply(heights: readonly (number | null)[]): RouteDocument {
    if (heights.length !== points.length) throw new RangeError('Unexpected terrain sample count.');
    for (const value of heights) {
      if (!Number.isFinite(value))
        throw new RangeError('Complete terrain coverage is required for replacement.');
    }
    const updated = elevation.map((sample, i) => ({ ...sample, height: heights[original[i].query] }));
    // Appending new samples keeps existing indices stable for editor selections.
    for (const level of additions) {
      updated.push({ anchor: level.anchor, height: heights[level.query] });
    }
    return { ...doc, elevation: updated, elevationReference: 1 };
  }
  return { points, queryDistances, apply };
}
