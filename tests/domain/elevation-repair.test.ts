import { expect, test } from 'vitest';
import {
  assessImportedElevation,
  fillShortElevationGaps,
  planFullTerrain,
} from '../../src/domain/elevation-repair';
import { anchorPoint, distances, emptyRoute, type RouteDocument } from '../../src/domain/model';

function route(heights: (number | null)[], longitude = heights.map((_, i) => i * 0.0005)): RouteDocument {
  return {
    ...emptyRoute(),
    vertices: longitude.map((lon, i) => ({ id: String(i), lon, lat: 0 })),
    elevation: heights.map((height, i) => ({ anchor: { vertexId: String(i), fraction: 0 }, height })),
  };
}

test('import diagnosis leaves complete, sparse and flat profiles alone, including zero and negative heights', () => {
  const doc = route([-10, 0, 0, 0], [0, 0.002, 0.004, 0.006]);
  expect(assessImportedElevation(doc)).toBeNull();
  doc.elevation.splice(1, 2);
  expect(assessImportedElevation(doc)).toBeNull();
  expect(assessImportedElevation(emptyRoute())).toBeNull();
  expect(assessImportedElevation(route([null]))).toBeNull();
});

test('import diagnosis recommends local fill for short gaps and omitted endpoints without mutating data', () => {
  const doc = route([null, -5, null, 30, null]);
  doc.elevation.pop();
  doc.elevation.reverse();
  const original = structuredClone(doc);
  expect(assessImportedElevation(doc)).toEqual({
    recommendation: 'fill',
    gaps: 3,
    fillableGaps: 3,
    hasKnownHeights: true,
  });
  expect(doc).toEqual(original);
  expect(assessImportedElevation(fillShortElevationGaps(doc).document)).toBeNull();
});

test.each([{ heights: [] }, { heights: [null, null, null] }])(
  'import diagnosis recommends online terrain for a missing profile $heights',
  ({ heights }) => {
    const doc = route(heights, [0, 0.0005, 0.001]);
    expect(assessImportedElevation(doc)).toEqual({
      recommendation: 'replace',
      gaps: 1,
      fillableGaps: 0,
      hasKnownHeights: false,
    });
  },
);

test('import diagnosis distinguishes partial repair from a complete local fill', () => {
  const doc = route([10, null, 30, null], [0, 0.0005, 0.001, 0.02]);
  expect(assessImportedElevation(doc)).toEqual({
    recommendation: 'replace',
    gaps: 2,
    fillableGaps: 1,
    hasKnownHeights: true,
  });
  expect(doc.elevation.map((s) => s.height)).toEqual([10, null, 30, null]);
});

test('import diagnosis does not promise a local fill next to conflicting observations', () => {
  const doc = route([10, null, 30]);
  doc.elevation.push({ ...doc.elevation[0], height: 15 });
  expect(assessImportedElevation(doc)).toMatchObject({
    recommendation: 'replace',
    fillableGaps: 0,
    hasKnownHeights: true,
  });
});

test('quick fill extends the endpoints and interpolates a 556 m gap, leaving a 1.6 km gap for review', () => {
  const doc = route([null, 0, null, 20, null, 70, null], [0, 0.0005, 0.003, 0.0055, 0.012, 0.0195, 0.0215]);
  doc.elevation.reverse();
  const original = structuredClone(doc);
  const result = fillShortElevationGaps(doc);
  const axis = distances(doc.vertices);
  expect(result.filled).toBe(3);
  expect(result.document.elevation.map((s) => s.height)).toEqual([
    70,
    70,
    null,
    20,
    expect.closeTo(10),
    0,
    0,
  ]);
  expect(result.remaining.map((s) => [s.startM, s.endM])).toEqual([[axis[3], axis[5]]]);
  expect(doc).toEqual(original);
  expect(fillShortElevationGaps(result.document).document).toBe(result.document);
});

test('long endpoint gaps remain wholly missing even if some samples are close to the only known height', () => {
  const doc = route([null, null, 12, null, null], [0, 0.009, 0.01, 0.011, 0.02]);
  const result = fillShortElevationGaps(doc);
  expect(result.document).toBe(doc);
  expect(result.filled).toBe(0);
  expect(result.remaining).toHaveLength(2);
});

test('the same 1,000 m limit applies at either end and between observations', () => {
  const metersPerDegree = distances(route([], [0, 1]).vertices)[1];
  for (const length of [999, 1001]) {
    const step = length / metersPerDegree;
    const doc = route([null, 0, null, 20, null], [0, step, 1.5 * step, 2 * step, 3 * step]);
    const result = fillShortElevationGaps(doc);
    if (length > 1000) {
      expect(result.document).toBe(doc);
      expect(result.remaining).toHaveLength(3);
    } else {
      expect(result.document.elevation.map((s) => s.height)).toEqual([0, 0, expect.closeTo(10), 20, 20]);
      expect(result.remaining).toEqual([]);
    }
  }
});

test.each([0, 1, 2] as const)(
  'replaces heights of reference %s from one DEM along the bent route, preserving original sample identities',
  (reference) => {
    const doc = route([], [0, 0.002, 0.002]);
    doc.vertices[2].lat = 0.002;
    doc.stations = [
      { id: 'cp', kind: 'cp', anchor: { vertexId: '1', fraction: 0.5 }, boundary: true, name: 'Ridge' },
    ];
    doc.rte = { distanceDm: [0, 2224, 4448] };
    doc.elevationReference = reference;
    doc.elevation = [
      { anchor: { vertexId: '1', fraction: 0.5 }, height: 50 },
      { anchor: { vertexId: '0', fraction: 1 }, height: -13 },
      { anchor: { vertexId: '1', fraction: 0 }, height: 9000 },
      { anchor: { vertexId: '0', fraction: 0.5 }, height: null },
    ];
    const original = structuredClone(doc);
    const plan = planFullTerrain(doc);
    expect(plan.points.length).toBeGreaterThan(6);
    expect(plan.points.every((p) => p.lat === 0 || p.lon === 0.002)).toBe(true);
    expect(plan.points[0]).toEqual({ lat: 0, lon: 0 });
    expect(plan.points.at(-1)).toEqual({ lat: 0.002, lon: 0.002 });
    expect(plan.points.filter((p) => p.lat === 0 && p.lon === 0.002)).toHaveLength(1);
    const values = plan.points.map((_, i) => i - 2);
    const preview = plan.preview(values);
    expect(preview.missing).toBe(0);
    const next = preview.document!;
    expect(next.elevationReference).toBe(1);
    expect(next.vertices).toBe(doc.vertices);
    expect(next.stations).toBe(doc.stations);
    expect(next.rte).toBe(doc.rte);
    expect(next.elevation.slice(0, 4).map((s) => s.anchor)).toEqual(doc.elevation.map((s) => s.anchor));
    for (const sample of next.elevation) {
      const point = anchorPoint(next, sample.anchor);
      const i = plan.points.findIndex((p) => p.lon === point.lon && p.lat === point.lat);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(sample.height).toBe(values[i]);
    }
    for (let i = 1; i < preview.readings.length; i++) {
      expect(preview.readings[i].distance - preview.readings[i - 1].distance).toBeLessThanOrEqual(60.001);
      expect(preview.readings[i].distance).toBeGreaterThan(preview.readings[i - 1].distance);
    }
    expect(doc).toEqual(original);
  },
);

test('partial coverage can be previewed but cannot produce a replacement document', () => {
  const doc = route([8, 23, 33, 44]);
  const plan = planFullTerrain(doc);
  const preview = plan.preview([0, null, NaN, -5]);
  expect(preview.missing).toBe(2);
  expect(preview.document).toBeNull();
  expect(preview.readings.map((r) => r.height)).toEqual([0, null, null, -5]);
  const axis = distances(doc.vertices);
  expect(preview.sections.filter((s) => s.kind === 'uncovered')).toMatchObject([
    { startM: axis[1], endM: axis[2] },
  ]);
  expect(() => plan.preview([])).toThrow(RangeError);
  expect(planFullTerrain(emptyRoute()).preview([]).document).toBeNull();
  expect(doc.elevation.map((s) => s.height)).toEqual([8, 23, 33, 44]);
});

test('marks flat observations and original gaps without counting them as missing terrain', () => {
  const doc = route([0, 0, 0, 0, null, 12], [0, 0.002, 0.004, 0.006, 0.008, 0.01]);
  const plan = planFullTerrain(doc);
  expect(plan.sections.map((s) => s.kind)).toEqual(['flat', 'gap']);
  expect(plan.sections[0].endM).toBeCloseTo(distances(doc.vertices)[3]);
  const preview = plan.preview(plan.points.map((_, i) => 10 + i));
  expect(preview.sections.map((s) => s.kind)).toEqual(['flat', 'gap']);
  expect(preview.document!.elevation.every((s) => Number.isFinite(s.height))).toBe(true);
  expect(preview.missing).toBe(0);
});

test('uses only local shape discrepancies when the datum is unknown, and does not compare ellipsoid heights', () => {
  const doc = route([55, 55, 100, 55, 55]);
  const terrain = [5, 5, 5, 5, 5];
  const plan = planFullTerrain(doc);
  const result = plan.preview(terrain);
  expect(result.sections.filter((s) => s.kind === 'suspect')).toMatchObject([
    { startM: distances(doc.vertices)[2], endM: distances(doc.vertices)[2] },
  ]);
  expect(result.document!.elevation.map((s) => s.height)).toEqual(terrain);
  doc.elevationReference = 2;
  const other = planFullTerrain(doc).preview(terrain);
  expect(other.sections.filter((s) => s.kind === 'suspect')).toHaveLength(0);
  expect(other.document!.elevationReference).toBe(1);
});

test('starts with a missing or absent profile and rejects unsupported record counts before planning', () => {
  const doc = route([], [0, 0.001, 0.002]);
  const plan = planFullTerrain(doc);
  expect(plan.sections.map((s) => s.kind)).toEqual(['gap']);
  expect(plan.preview(plan.points.map(() => 0)).document!.elevation.every((s) => s.height === 0)).toBe(true);
  doc.elevation.length = 1_000_001;
  expect(() => planFullTerrain(doc)).toThrow(/limit|maximum|million/i);
});

test('conflicting colocated observations do not become interpolation anchors for quick fill', () => {
  const doc = route([0, null, 10, null, 20]);
  doc.elevation.push({ ...doc.elevation[2], height: 16 }, { ...doc.elevation[2], height: null });
  const result = fillShortElevationGaps(doc);
  expect(result.document).toBe(doc);
  expect(result.remaining).toHaveLength(3);
});
