import { expect, test } from 'vitest';
import { interpolateMissingHeights } from '../../src/domain/elevation';
import { distances, emptyRoute, type RouteDocument, type Sample } from '../../src/domain/model';

const sample = (vertexId: string, height: number | null, fraction = 0): Sample => ({
  anchor: { vertexId, fraction },
  height,
});
function route(elevation: Sample[]): RouteDocument {
  return {
    ...emptyRoute(),
    vertices: [
      { id: 'a', lat: 0, lon: 0 },
      { id: 'b', lat: 0, lon: 0.001 },
      { id: 'c', lat: 0, lon: 0.004 },
    ],
    elevation,
  };
}

test('interpolates bracketed gaps by along-route distance in an unordered independent profile', () => {
  const doc = route([sample('a', null, 0.5), sample('c', 40), sample('a', 0), sample('b', null, 0.5)]);
  const result = interpolateMissingHeights(doc);
  expect(result).toMatchObject({ filled: 2, remaining: 0 });
  expect(result.document.elevation[0].height).toBeCloseTo(5, 10);
  expect(result.document.elevation[3].height).toBeCloseTo(25, 10);
  expect(result.document.elevation[2]).toBe(doc.elevation[2]);
  expect(doc.elevation[0].height).toBeNull();
  expect(interpolateMissingHeights(result.document).document).toBe(result.document);
});

test('uses the editor distance axis and preserves imported context when heights change', () => {
  const doc = route([sample('a', -20), sample('b', null), sample('c', 0)]);
  doc.rte = { distanceDm: [0, 300, 400], indexBlockSizes: [3] };
  const result = interpolateMissingHeights(doc);
  expect(result.document.elevation[1].height).toBeCloseTo(-15);
  expect(result.document.rte).toBe(doc.rte);
});

test('extends a known zero through both endpoint gaps and interpolates the interior', () => {
  const doc = route([
    sample('a', null),
    sample('a', 0, 0.2),
    sample('b', null),
    sample('b', 0, 0.8),
    sample('c', null),
  ]);
  const result = interpolateMissingHeights(doc);
  expect(result).toMatchObject({ filled: 3, remaining: 0 });
  expect(result.document.elevation.map((s) => s.height)).toEqual([0, 0, 0, 0, 0]);
  const unresolved = route([sample('a', null), sample('c', null)]);
  expect(interpolateMissingHeights(unresolved)).toEqual({ document: unresolved, filled: 0, remaining: 2 });
});

test('fills coincident samples and uses the observation on the corresponding side for each endpoint', () => {
  const doc = route([
    sample('a', null),
    sample('a', null, 0.25),
    sample('a', 14, 0.25),
    sample('b', 12),
    sample('c', null),
  ]);
  const result = interpolateMissingHeights(doc);
  expect(result).toMatchObject({ filled: 3, remaining: 0 });
  expect(result.document.elevation.map((s) => s.height)).toEqual([14, 14, 14, 12, 12]);
});

test('adds absent endpoint samples only within reach of the original observation', () => {
  const doc = route([sample('b', -4)]);
  const limit = distances(doc.vertices)[1];
  const result = interpolateMissingHeights(doc, limit);
  expect(result).toMatchObject({ filled: 1, remaining: 1 });
  expect(result.document.elevation).toEqual([doc.elevation[0], sample('a', -4)]);
  expect(interpolateMissingHeights(result.document, limit).document).toBe(result.document);
  expect(interpolateMissingHeights(doc, limit - 0.01).document).toBe(doc);
});

test('conflicting first and last observations cannot supply endpoint heights', () => {
  const doc = route([sample('a', null), sample('b', 0), sample('b', 2), sample('c', null)]);
  expect(interpolateMissingHeights(doc)).toEqual({ document: doc, filled: 0, remaining: 2 });
});

test('a conflicting observed height at one distance prevents interpolation on either side', () => {
  const doc = route([
    sample('a', 0),
    sample('a', null, 0.3),
    sample('b', -0.05),
    sample('b', null),
    sample('b', 0),
    sample('b', null, 0.1),
    sample('b', 10, 0.2),
    sample('b', null, 0.6),
    sample('c', 30),
  ]);
  const result = interpolateMissingHeights(doc);
  expect(result).toMatchObject({ filled: 1, remaining: 3 });
  expect(result.document.elevation[7].height).toBeCloseTo(20);
  expect(result.document.elevation[2]).toBe(doc.elevation[2]);
});

test('keeps distinct editor positions separate even within a single device decimeter', () => {
  const doc = route([
    sample('a', 0),
    sample('a', null, 0.00001),
    sample('a', null, 0.00002),
    sample('b', 1000),
  ]);
  const result = interpolateMissingHeights(doc);
  expect(result).toMatchObject({ filled: 3, remaining: 0 });
  expect(result.document.elevation[1].height).toBeCloseTo(0.01);
  expect(result.document.elevation[2].height).toBeCloseTo(0.02);
});
