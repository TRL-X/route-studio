import { expect, test } from 'vitest';
import { exampleRoute } from '../../src/domain/example';
import { ascent } from '../../src/domain/summary';

test('ascent follows anchor order and is unknown for incomplete coverage', () => {
  const route = exampleRoute();
  expect(ascent(route)).toBe(690);
  expect(ascent({ ...route, elevation: [...route.elevation].reverse() })).toBe(690);
  expect(ascent({ ...route, elevation: route.elevation.slice(1) })).toBeNull();
  expect(
    ascent({ ...route, elevation: route.elevation.map((s, i) => (i === 1 ? { ...s, height: null } : s)) }),
  ).toBeNull();
});
