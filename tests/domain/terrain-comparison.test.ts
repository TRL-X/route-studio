import { expect, test } from 'vitest';
import { localDifferenceSections, type ProfileReading } from '../../src/domain/terrain-comparison';

function readings(heights: (number | null)[], distances = heights.map((_, i) => i * 20)): ProfileReading[] {
  return heights.map((height, i) => ({ height, distance: distances[i] }));
}

// Give the unaffected part of the route enough observations to establish a zero median offset.
function compareWithBaseline(source: ProfileReading[], terrain?: ProfileReading[]) {
  const end = source.at(-1)?.distance ?? 0;
  const baseline = Array.from({ length: source.length + 1 }, (_, i) => ({
    distance: end + 1 + i,
    height: 0,
  }));
  return localDifferenceSections(
    [...source, ...baseline],
    [...(terrain ?? source.map((s) => ({ ...s, height: 0 }))), ...baseline],
  ).map((s) => [s.startM, s.endM]);
}

test('a route-wide offset is not highlighted; only departures from the sample median are', () => {
  const source = readings([130, 130, 100, 90, 130, 130, 130]);
  expect(localDifferenceSections(source, readings(Array(7).fill(100)))).toEqual([{ startM: 40, endM: 60 }]);
  // Extra terrain posts are not additional votes when calculating the offset.
  expect(
    localDifferenceSections(
      readings([20, 30, 40], [0, 10, 20]),
      readings([0, 900, 10, 900, 20], [0, 5, 10, 15, 20]),
    ),
  ).toEqual([]);
});

test('groups nearby peaks across a shallow dip and stops below half the threshold or at a sign change', () => {
  const source = readings([22, 19, 10, 27, 9, 23, -15, 24, null, 25]);
  expect(compareWithBaseline(source)).toEqual([
    [0, 60],
    [100, 100],
    [140, 140],
    [180, 180],
  ]);
});

test('bounds a dip by the distance between peaks, and breaks for sparse sampling or missing terrain', () => {
  expect(
    compareWithBaseline(readings([24, 18, 23, 18, 22, 26, 30], [0, 20, 90, 115, 181, 381, 582])),
  ).toEqual([
    [0, 90],
    [181, 381],
    [582, 582],
  ]);
  expect(compareWithBaseline(readings([25, 25, 25, 25, 25]), readings([0, null, 0, NaN, 0]))).toEqual([
    [0, 0],
    [40, 40],
    [80, 80],
  ]);
  expect(compareWithBaseline(readings([35, 40], [0, 80]), readings([0, null, 0], [0, 40, 80]))).toEqual([
    [0, 0],
    [80, 80],
  ]);
});

test('contradictory readings at one position produce an isolated marker, not a continuous section', () => {
  expect(compareWithBaseline(readings([40, 45, -60, 50], [0, 20, 20, 40]))).toEqual([
    [0, 0],
    [20, 20],
    [40, 40],
  ]);
  expect(compareWithBaseline(readings([40, null, 45, 50], [0, 20, 20, 40]))).toEqual([
    [0, 0],
    [20, 20],
    [40, 40],
  ]);
});

test('one or no paired observations provide no local evidence', () => {
  expect(localDifferenceSections([], [])).toEqual([]);
  expect(localDifferenceSections(readings([30, null]), readings([0, 10]))).toEqual([]);
  expect(localDifferenceSections(readings([45]), readings([NaN]))).toEqual([]);
});
