import { expect, test } from 'vitest';
import { planFullTerrain } from '../../src/domain/elevation-repair';
import { distanceMeters, type RouteDocument, type Sample } from '../../src/domain/model';
import { planTerrain } from '../../src/domain/terrain';
import { readRte, writeRte } from '../../src/rte';
import { MAX_NODES } from '../../src/rte/check';

const sample = (vertexId: string, height: number | null, fraction = 0): Sample => ({
  anchor: { vertexId, fraction },
  height,
});
function route(elevation: Sample[]): RouteDocument {
  return {
    name: 'Bent route',
    vertices: [
      { id: 'a', lat: 0, lon: 0 },
      { id: 'b', lat: 0, lon: 0.002 },
      { id: 'c', lat: 0.002, lon: 0.002 },
    ],
    elevation,
    elevationReference: 0,
    stations: [
      { id: '1', kind: 'start', name: 'Start', boundary: true, anchor: { vertexId: 'a', fraction: 0 } },
      { id: '2', kind: 'finish', name: 'Finish', boundary: true, anchor: { vertexId: 'c', fraction: 0 } },
    ],
  };
}

test('generates an exportable profile from an empty route profile, following both legs of the path', () => {
  const doc = route([]);
  const plan = planFullTerrain(doc);
  expect(plan.points.length).toBeGreaterThan(doc.vertices.length);
  for (const [i, point] of plan.points.entries()) {
    expect(point.lat === 0 || point.lon === 0.002).toBe(true);
    if (i) expect(distanceMeters(plan.points[i - 1], point)).toBeLessThanOrEqual(60);
  }
  const values = plan.points.map((_, i) => i - 3);
  const result = plan.preview(values).document!;
  expect(result.vertices).toBe(doc.vertices);
  const exported = readRte(writeRte(result));
  expect(exported.elevationReference).toBe(1);
  expect(exported.elevation.map((s) => s.height)).toEqual(values);
});

test('replaces every original sample in place and queries coincident anchors only once', () => {
  const doc = route([sample('c', null), sample('a', 0, 1), sample('a', -4), sample('b', 28)]);
  doc.elevationReference = 2;
  const plan = planFullTerrain(doc);
  const values = plan.points.map((_, i) => i);
  const result = plan.preview(values).document!;
  const corner = plan.points.findIndex((point) => point.lat === 0 && point.lon === 0.002);
  expect(corner).toBeGreaterThan(0);
  expect(plan.points.filter((point) => point.lat === 0 && point.lon === 0.002)).toHaveLength(1);
  expect(result.elevation.slice(0, 4).map((s) => s.anchor)).toEqual(doc.elevation.map((s) => s.anchor));
  expect(result.elevation.slice(0, 4).map((s) => s.height)).toEqual([values.at(-1), corner, 0, corner]);
  expect(result.elevationReference).toBe(1);
  expect(doc.elevation.map((s) => s.height)).toEqual([null, 0, -4, 28]);
});

test('requires a finite height for every query before constructing a replacement', () => {
  const doc = route([sample('b', 3)]);
  const plan = planTerrain(doc);
  expect(() => plan.apply([])).toThrow(RangeError);
  const values = plan.points.map(() => -5);
  for (const missing of [null, NaN, Infinity]) {
    expect(() => plan.apply([missing, ...values.slice(1)])).toThrow(/coverage/);
  }
  expect(doc.elevation).toEqual([sample('b', 3)]);
});

test('coarsens sampling near the node limit while reserving both endpoints', () => {
  const doc = route(Array<Sample>(MAX_NODES - 5).fill(sample('b', 3)));
  const plan = planTerrain(doc);
  expect(plan.points[0]).toEqual({ lat: 0, lon: 0 });
  expect(plan.points.at(-1)).toEqual({ lat: 0.002, lon: 0.002 });
  // One query serves all the existing samples at b. The rest will add new samples.
  expect(doc.elevation.length + plan.points.length - 1).toBeLessThanOrEqual(MAX_NODES);
  expect(plan.points.length).toBeGreaterThan(3);
  doc.elevation.push(...Array<Sample>(4).fill(sample('b', 3)));
  expect(() => planTerrain(doc)).toThrow(/limit|maximum|million/i);
});
