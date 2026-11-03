import { describe, expect, it } from 'vitest';
import { appendVertex, deleteVertex, insertVertex, moveVertex, updateStation } from '../../src/domain/edit';
import {
  anchorAtDistance,
  anchorDistance,
  anchorPoint,
  distances,
  emptyRoute,
  nearestAnchor,
  type Anchor,
  type RouteDocument,
  type Station,
} from '../../src/domain/model';

const at = (vertexId: string, fraction = 0): Anchor => ({ vertexId, fraction });
const point = (lon: number, lat = 0) => ({ lon, lat });

function route(): RouteDocument {
  return {
    name: 'Field test',
    vertices: [
      { id: 'a', ...point(0) },
      { id: 'b', ...point(1) },
      { id: 'c', ...point(4) },
    ],
    stations: [
      { id: 'start', kind: 'start', boundary: true, name: 'Start', anchor: at('a') },
      {
        id: 'water',
        kind: 'cp',
        boundary: true,
        name: 'Water',
        anchor: at('b', 0.5),
        location: point(2.55, 0.05),
      },
      { id: 'finish', kind: 'finish', boundary: true, name: 'Finish', anchor: at('c') },
    ],
    elevation: [
      { anchor: at('a'), height: 0 },
      { anchor: at('b', 0.5), height: 220 },
      { anchor: at('c'), height: 80 },
    ],
    elevationReference: 1,
    rte: {
      distanceDm: [0, 800, 3000],
      indexBlockSizes: [3],
      magneticDeclination: {
        declinationCdeg: 50,
        referenceLatE7: 0,
        referenceLonE7: 0,
        referenceDate: '2026-01-01',
      },
    },
  };
}

describe('geometry edits', () => {
  it('adds stable vertex and endpoint identities while extending a new route', () => {
    const first = appendVertex(emptyRoute(), point(5));
    const second = appendVertex(first, point(6));
    const third = appendVertex(second, point(7));
    const ids = third.vertices.map((v) => v.id);
    expect(new Set(ids).size).toBe(3);
    expect(third.stations.map((s) => [s.id, s.kind, s.anchor])).toEqual([
      [first.stations[0].id, 'start', at(ids[0])],
      [second.stations[1].id, 'finish', at(ids[2])],
    ]);
    expect(second.stations[1].anchor).toEqual(at(ids[1]));
    expect(third.elevation).toEqual(ids.map((id) => ({ anchor: at(id), height: null })));
  });

  it.each(['a', 'b', 'c'])('moves vertex %s without moving a station’s surveyed location', (id) => {
    const doc = route();
    const changed = moveVertex(doc, id, point(2, 1));
    expect(changed.vertices.find((v) => v.id === id)).toEqual({ id, ...point(2, 1) });
    expect(changed.stations).toEqual(doc.stations);
    expect(changed.elevation).toEqual(doc.elevation);
    expect(changed.rte).toEqual({ magneticDeclination: doc.rte!.magneticDeclination });
    expect(doc.rte!.distanceDm).toEqual([0, 800, 3000]);
    expect(doc.vertices).toEqual(route().vertices);
  });

  it('retains imported distances for no-op moves and station-only edits', () => {
    const doc = route();
    expect(moveVertex(doc, 'b', point(1))).toBe(doc);
    expect(moveVertex(doc, 'unknown', point(10))).toBe(doc);
    expect(updateStation(doc, 'water', { name: 'Aid 1' }).rte).toEqual(doc.rte);
  });

  it('splits an edge and preserves positions on each side, including the split itself', () => {
    const doc = route();
    const checkpoints: Station[] = [0.25, 0.5, 0.75].map((fraction, i) => ({
      id: 'poi-' + i,
      name: 'Waypoint',
      kind: 'poi',
      boundary: false,
      anchor: at('a', fraction),
    }));
    doc.stations.push(...checkpoints);
    doc.elevation.push(...checkpoints.map((s, i) => ({ anchor: s.anchor!, height: 10 * i })));

    const split = insertVertex(doc, at('a', 0.5));
    const id = split.vertices[1].id;
    expect(split.vertices.map((v) => v.id)).toEqual(['a', id, 'b', 'c']);
    const anchors = [at('a', 0.5), at(id), at(id, 0.5)];
    expect(split.stations.slice(-3).map((s) => s.anchor)).toEqual(anchors);
    expect(split.elevation.slice(-3).map((s) => s.anchor)).toEqual(anchors);
    for (const [i, anchor] of anchors.entries()) {
      expect(anchorPoint(split, anchor)).toEqual(anchorPoint(doc, checkpoints[i].anchor!));
    }
    expect(split.rte).toEqual({ magneticDeclination: doc.rte!.magneticDeclination });
    expect(insertVertex(doc, at('a'))).toBe(doc);
    expect(insertVertex(doc, at('c', 0.5))).toBe(doc);
  });

  it('merges interior segments in proportion to their lengths, preserving elevation and station anchors', () => {
    const doc = route();
    doc.elevation = [at('a', 0.5), at('b'), at('b', 0.5), at('c')].map((anchor, i) => ({
      anchor,
      height: i * 5,
    }));
    const merged = deleteVertex(doc, 'b');
    expect(merged.vertices.map((v) => v.id)).toEqual(['a', 'c']);
    for (const [i, sample] of merged.elevation.entries()) {
      const before = doc.elevation[i];
      expect(anchorPoint(merged, sample.anchor).lon).toBeCloseTo(anchorPoint(doc, before.anchor).lon, 10);
      expect(sample.height).toBe(before.height);
    }
    expect(merged.stations[1].anchor!.vertexId).toBe('a');
    expect(merged.stations[1].anchor!.fraction).toBeCloseTo(0.625);
    expect(merged.stations[1].location).toEqual(doc.stations[1].location);
    expect(merged.rte).toEqual({ magneticDeclination: doc.rte!.magneticDeclination });
    expect(deleteVertex(merged, 'a')).toBe(merged);
  });

  it('trims either endpoint and retains samples exactly on the new route boundary', () => {
    const doc = route();
    // An anchor with fraction 1 is a valid spelling of the following vertex.
    doc.elevation = [at('a'), at('a', 0.25), at('a', 1), at('b', 0.5), at('c')].map((anchor, height) => ({
      anchor,
      height,
    }));
    const trimStart = deleteVertex(doc, 'a');
    expect(trimStart.elevation).toEqual([
      { anchor: at('b'), height: 2 },
      { anchor: at('b', 0.5), height: 3 },
      { anchor: at('c'), height: 4 },
    ]);
    expect(trimStart.stations[0].anchor).toEqual(at('b'));
    const trimFinish = deleteVertex(doc, 'c');
    expect(trimFinish.elevation.map((s) => s.height)).toEqual([0, 1, 2]);
    expect(trimFinish.stations[2].anchor).toEqual(at('b'));
    expect(trimFinish.stations[1].anchor).toEqual(at('b'));
    expect(trimFinish.stations[1].location).toEqual(doc.stations[1].location);
  });
});

describe('route anchor geography', () => {
  it('projects, splits and interpolates the short segment across the antimeridian', () => {
    const doc = route();
    doc.vertices = [
      { id: 'west', ...point(179) },
      { id: 'east', ...point(-179) },
    ];
    doc.stations = [];
    doc.elevation = [];
    const axis = distances(doc.vertices);
    expect(axis[1]).toBeGreaterThan(220_000);
    expect(axis[1]).toBeLessThan(224_000);
    const half = nearestAnchor(doc, point(180, 0.1));
    expect(half).toEqual(at('west', 0.5));
    expect(anchorAtDistance(doc, axis[1] / 2)).toEqual(half);
    expect(anchorDistance(doc, half)).toBeCloseTo(axis[1] / 2);
    const split = insertVertex(doc, half);
    expect(Math.abs(split.vertices[1].lon)).toBe(180);
    expect(anchorPoint(doc, at('west', 0.75)).lon).toBe(-179.5);
  });

  it('finds the closest endpoint when the pointer is across the dateline from a long edge', () => {
    const doc = route();
    doc.vertices = [
      { id: 'start', ...point(0) },
      { id: 'finish', ...point(170) },
    ];
    expect(nearestAnchor(doc, point(-170))).toEqual(at('finish'));
    doc.vertices.reverse();
    expect(nearestAnchor(doc, point(-170))).toEqual(at('finish'));
  });
});
