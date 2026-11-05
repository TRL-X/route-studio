import { describe, expect, it } from 'vitest';
import {
  anchorAtDistance,
  anchorDistance,
  anchorPoint,
  distanceMeters,
  distances,
  type RouteDocument,
} from '../../src/domain/model';
import {
  defaultResampleOptions as defaults,
  resampleRoute,
  ResampleError,
  MAX_RESAMPLED_POINTS,
  type ResampleOptions,
} from '../../src/domain/resample';
import { loadProject, saveProject } from '../../src/files/project';
import { exportTrack } from '../../src/files/export';
import { prepareRte, readRte } from '../../src/rte';

const degree = 180 / (Math.PI * 6_371_008.8);
function route(points: number[][]): RouteDocument {
  return {
    name: 'Resample test',
    vertices: points.map(([x, y = 0], i) => ({ id: 'v' + i, lon: x * degree, lat: y * degree })),
    elevation: [],
    stations: [],
    elevationReference: 1,
    declination: { mode: 'omit' },
  };
}
const at = (i: number, fraction = 0) => ({ vertexId: 'v' + i, fraction });
function checkShape(doc: RouteDocument, options = defaults) {
  const result = resampleRoute(doc, options);
  const { document: next, sourceDistances } = result;
  expect(result.maxSpacingM).toBeLessThanOrEqual(options.maxSpacingM + 1e-7);
  expect(result.maxDeviationM).toBeLessThanOrEqual(options.toleranceM + 1e-7);
  expect(next.vertices[0]).toEqual(doc.vertices[0]);
  expect(next.vertices.at(-1)).toEqual(doc.vertices.at(-1));
  expect(new Set(next.vertices.map((v) => v.id)).size).toBe(next.vertices.length);
  // Independently sample the continuous source, including interiors of original edges.
  const oldAxis = distances(doc.vertices);
  let j = 0;
  for (let k = 0; k <= 2000; k++) {
    const s = (oldAxis.at(-1)! * k) / 2000;
    while (j < sourceDistances.length - 2 && sourceDistances[j + 1] < s) j++;
    const old = anchorPoint(doc, anchorAtDistance(doc, s, oldAxis));
    const fraction = (s - sourceDistances[j]) / (sourceDistances[j + 1] - sourceDistances[j]);
    const point = anchorPoint(next, { vertexId: next.vertices[j].id, fraction });
    expect(distanceMeters(old, point)).toBeLessThanOrEqual(options.toleranceM + 1e-6);
  }
  return result;
}

describe('route resampling', () => {
  it('adds and removes points on an irregular straight route, distributing the tail evenly', () => {
    const doc = route([[0], [0.1], [0.3], [0.5], [1], [2], [3], [98], [101]]);
    const before = structuredClone(doc);
    const result = checkShape(doc);
    const axis = distances(result.document.vertices);
    const spacings = axis.slice(1).map((s, i) => s - axis[i]);
    expect(Math.max(...spacings) - Math.min(...spacings)).toBeLessThan(1e-8);
    expect(result.document.vertices.length).toBe(10);
    expect(result.document.vertices.some((v) => v.id === 'v1')).toBe(false);
    expect(result.shortSegments).toEqual([]);
    expect(doc).toEqual(before);
  });

  it.each([
    [
      [0, 0],
      [36, 0],
      [36, 42],
    ],
    [
      [0, 0],
      [100, 0],
      [100, 3],
      [0, 3],
    ],
    [
      [0, 0],
      [30, 0],
      [50, 20],
      [70, -20],
      [100, 0],
    ],
    [
      [0, 0],
      [40, 40],
      [0, 40],
      [40, 0],
    ],
    [
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
      [0, 0],
    ],
  ])('bounds the complete shape for bends, hairpins, S curves, crossings and loops: %j', (...points) => {
    checkShape(route(points));
  });

  it('retains an excursion smaller than the shape tolerance and its separate visits', () => {
    const doc = route([[0], [30.25], [30], [60]]);
    doc.stations = [1, 2].map((i) => ({
      id: 's' + i,
      name: 'Pass',
      kind: 'poi',
      boundary: false,
      anchor: at(i, 0.5),
    }));
    const result = checkShape(doc);
    expect(result.document.vertices.some((v) => v.id === 'v1')).toBe(true);
    expect(result.document.vertices.some((v) => v.id === 'v2')).toBe(true);
    expect(result.lengthM).toBeCloseTo(60.5, 6);
    expect(anchorDistance(result.document, result.document.stations[1].anchor!)).toBeGreaterThan(
      anchorDistance(result.document, result.document.stations[0].anchor!),
    );
  });

  it('keeps a tiny closed loop instead of collapsing coincident endpoints', () => {
    const result = checkShape(
      route([
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
        [0, 0],
      ]),
    );
    expect(result.document.vertices.length).toBeGreaterThanOrEqual(4);
    expect(result.lengthM).toBeGreaterThan(1.5);
  });

  it('preserves every station, surveyed location and elevation observation including null and duplicates', () => {
    const doc = route([
      [0, 0],
      [10, 0],
      [20, 2],
      [100, 0],
      [0, 0],
    ]);
    doc.stations = [
      { id: 's', name: 'Start', kind: 'start', boundary: true, anchor: at(0) },
      {
        id: 'cp',
        name: 'Water',
        shortLabel: 'CP1',
        kind: 'cp',
        boundary: true,
        anchor: at(1, 0.2),
        location: { lat: 1, lon: 2 },
      },
      { id: 'poi', name: 'Nearby', kind: 'poi', boundary: false, anchor: at(1, 0.3) },
      { id: 'return', name: 'Return', kind: 'poi', boundary: false, anchor: at(3, 0.85) },
      {
        id: 'unknown',
        name: 'Unassigned',
        kind: 'poi',
        boundary: false,
        anchor: null,
        location: { lat: 3, lon: 4 },
      },
      { id: 'f', name: 'Finish', kind: 'finish', boundary: true, anchor: at(4) },
    ];
    doc.elevation = [at(0), at(1), at(1, 0.4), at(1, 0.4), at(2, 0.5), at(3), at(4)].map((anchor, i) => ({
      anchor,
      height: i === 2 ? null : i * 10,
    }));
    doc.rte = {
      distanceDm: [0, 100, 200, 1000, 2000],
      indexBlockSizes: [5],
      magneticDeclination: {
        declinationCdeg: 5,
        referenceLatE7: 0,
        referenceLonE7: 0,
        referenceDate: '2026-01-01',
      },
    };
    const result = checkShape(doc);
    const next = result.document;
    expect(next.elevation.map((s) => s.height)).toEqual(doc.elevation.map((s) => s.height));
    expect(next.elevationReference).toBe(doc.elevationReference);
    expect(next.rte).toEqual({ magneticDeclination: doc.rte.magneticDeclination });
    for (const [i, station] of next.stations.entries()) {
      expect({ ...station, anchor: null }).toEqual({ ...doc.stations[i], anchor: null });
      if (station.anchor)
        expect(
          distanceMeters(anchorPoint(next, station.anchor), anchorPoint(doc, doc.stations[i].anchor!)),
        ).toBeLessThan(1e-7);
    }
    for (const [i, sample] of next.elevation.entries()) {
      const j = next.vertices.findIndex((v) => v.id === sample.anchor.vertexId);
      const s =
        result.sourceDistances[j] +
        ((result.sourceDistances[j + 1] ?? result.sourceDistances[j]) - result.sourceDistances[j]) *
          sample.anchor.fraction;
      expect(s).toBeCloseTo(anchorDistance(doc, doc.elevation[i].anchor), 7);
    }
    expect(result.shortSegments.some((s) => s.reason === 'station')).toBe(true);
    expect(loadProject(saveProject(next))).toEqual(next);
    expect(exportTrack(next, 'gpx').bytes.length).toBeGreaterThan(0);
    expect(exportTrack(next, 'fit').bytes.length).toBeGreaterThan(0);
  });

  it('can still compile a complete resampled profile and boundaries to RTE', () => {
    const doc = route([[0], [12], [60]]);
    doc.stations = [
      { id: 's', name: 'Start', kind: 'start', boundary: true, anchor: at(0) },
      { id: 'f', name: 'Finish', kind: 'finish', boundary: true, anchor: at(2) },
    ];
    doc.elevation = [0, 1, 2].map((i) => ({ anchor: at(i), height: i * 10 }));
    const next = resampleRoute(doc, defaults).document;
    const device = readRte(prepareRte(next, { intervalM: 0, toleranceM: 0, smoothingM: 0 }).bytes);
    expect(device.stations.map((s) => s.name)).toEqual(['Start', 'Finish']);
    expect(device.elevation.map((s) => s.height)).toEqual([0, 10, 20]);
  });

  it('normalizes consecutive duplicate positions without losing their observations or endpoint identities', () => {
    const doc = route([[0], [0], [30], [30], [60], [60]]);
    doc.elevation = doc.vertices.map((v, i) => ({
      anchor: { vertexId: v.id, fraction: 0 },
      height: i % 2 ? null : i,
    }));
    const result = checkShape(doc);
    expect(result.minSpacingM).toBeGreaterThanOrEqual(defaults.minSpacingM);
    expect(result.document.elevation.map((s) => s.height)).toEqual([0, null, 2, null, 4, null]);
  });

  it('interpolates across the dateline and respects the maximum at high latitude', () => {
    const doc = route([[0], [10], [20]]);
    doc.vertices = [
      { id: 'v0', lat: 80, lon: 179.999 },
      { id: 'v1', lat: 80.0001, lon: -179.9995 },
      { id: 'v2', lat: 80, lon: -179.998 },
    ];
    const result = checkShape(doc);
    expect(result.document.vertices.every((p) => Math.abs(p.lon) > 179)).toBe(true);
  });

  it('retains exact original corners with zero tolerance', () => {
    const doc = route([
      [0, 0],
      [30, 0],
      [31, 1],
      [62, 1],
    ]);
    const result = checkShape(doc, { ...defaults, toleranceM: 0 });
    expect(result.document.vertices.some((p) => p.id === 'v1')).toBe(true);
    expect(result.document.vertices.some((p) => p.id === 'v2')).toBe(true);
  });

  it.each([
    { minSpacingM: 0 },
    { minSpacingM: 30 },
    { maxSpacingM: NaN },
    { toleranceM: -1 },
    { toleranceM: Infinity },
  ])('rejects invalid parameters: %j', (patch) => {
    expect(() => resampleRoute(route([[0], [10]]), { ...defaults, ...patch } as ResampleOptions)).toThrow(
      ResampleError,
    );
  });

  it('rejects degenerate routes, dangling anchors and excessive output before applying anything', () => {
    expect(() => resampleRoute(route([[0], [0]]), defaults)).toThrow('route');
    expect(() => resampleRoute(route([[0], [3_000_000]]), defaults)).toThrow('limit');
    const doc = route([[0], [30]]);
    doc.elevation = [{ anchor: at(9), height: null }];
    expect(() => resampleRoute(doc, defaults)).toThrow('route');
  });

  it('allows exactly the output limit across adjacent spans without counting a shared station twice', () => {
    const doc = route([[0], [0.1], [0.1 + (MAX_RESAMPLED_POINTS - 2) * 11]]);
    doc.stations = [{ id: 'cp', name: 'Near start', kind: 'cp', boundary: true, anchor: at(1) }];
    const result = resampleRoute(doc, defaults);
    expect(result.document.vertices.length).toBe(MAX_RESAMPLED_POINTS);
    expect(result.maxSpacingM).toBeLessThanOrEqual(20);
    expect(result.shortSegments).toHaveLength(1);
  });
});
