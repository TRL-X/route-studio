import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  declinationSettings,
  manualDeclination,
  midpointReference,
  withDeclination,
} from '../../src/domain/declination';
import { automaticDeclination, emptyRoute } from '../../src/domain/model';
import { moveVertex } from '../../src/domain/edit';
import { loadProject, saveProject, parseRoutes } from '../../src/files';
import { readRte, validateForRte, writeRte } from '../../src/rte';

const vector = (id: string) =>
  new Uint8Array(readFileSync(new URL('../rte/vectors/' + id + '.rte', import.meta.url)));
const date = '2026-11-03';

describe('route magnetic declination', () => {
  it.each(['a', 'b', 'c'])('preserves imported references in RTE and in old projects (%s)', (id) => {
    const bytes = vector(id);
    const doc = loadProject(saveProject(readRte(bytes)));
    const fields = declinationSettings(doc);
    expect(fields.mode).toBe(id === 'c' ? 'omit' : 'manual');
    expect(writeRte(doc)).toEqual(bytes);
    expect(writeRte(withDeclination(doc, fields))).toEqual(bytes);
  });

  it('starts new routes and geographic imports in auto mode, with an editable UTC date', () => {
    const expected = automaticDeclination();
    expect(emptyRoute().declination).toEqual(expected);
    for (const [file, xml] of [
      ['test.gpx', '<gpx><rte><rtept lat="0" lon="0"/><rtept lat="0" lon="1"/></rte></gpx>'],
      [
        'test.kml',
        '<kml><Placemark><LineString><coordinates>0,0 1,0</coordinates></LineString></Placemark></kml>',
      ],
    ])
      expect(parseRoutes(xml, file)[0].open().declination).toEqual(expected);
    expect(midpointReference(emptyRoute(), date)).toBeUndefined();
  });

  it('interpolates halfway along the reference axis, including across the antimeridian', () => {
    const doc = readRte(vector('a'));
    doc.vertices = [
      { id: 'a', lat: 0, lon: 175 },
      { id: 'b', lat: 0, lon: 179 },
      { id: 'c', lat: 0, lon: -177 },
    ];
    doc.rte!.distanceDm = [0, 100, 300];
    expect(midpointReference(doc, date)?.referenceLonE7).toBe(-1800000000);
    delete doc.rte;
    expect(midpointReference(doc, date)?.referenceLonE7).toBe(1790000000);
  });

  it.each([
    [-3.5, -350],
    [-1.125, -113],
    [-1.005, -101],
    [0, 0],
  ])('writes manual %s degrees and preserves it after moving the route', (degrees, cdeg) => {
    const doc = readRte(vector('a'));
    const manual = { ...manualDeclination(doc.rte!.magneticDeclination), degrees };
    const moved = moveVertex(withDeclination(doc, manual), 'v1', { lat: 1, lon: 2 });
    expect(readRte(writeRte(loadProject(saveProject(moved)))).rte?.magneticDeclination).toEqual({
      ...doc.rte!.magneticDeclination,
      declinationCdeg: cdeg,
    });
    expect(
      readRte(writeRte(withDeclination(moved, { mode: 'omit' }))).rte?.magneticDeclination,
    ).toBeUndefined();
  });

  it('saves unfinished manual fields but requires complete, valid metadata for export', () => {
    const doc = readRte(vector('a'));
    const fields = manualDeclination(doc.rte?.magneticDeclination);
    for (const patch of [
      { degrees: null },
      { degrees: 181 },
      { lat: null },
      { lon: -181 },
      { date: '2025-02-29' },
      { validFrom: '' },
      { validUntil: '' },
      { validUntil: '2000-01-01' },
    ]) {
      const next = withDeclination(doc, { ...fields, ...patch });
      expect(loadProject(saveProject(next))).toEqual(next);
      expect(() => writeRte(next)).toThrow();
    }
  });

  it('only exports a confirmed result for the current midpoint and date', () => {
    const doc = readRte(vector('b'));
    const result = { ...midpointReference(doc, date)!, declinationCdeg: -45 };
    const automatic = { ...automaticDeclination(date), result };
    const next = loadProject(saveProject(withDeclination(doc, automatic)));
    expect(readRte(writeRte(next)).rte?.magneticDeclination).toEqual(result);
    expect(readRte(writeRte({ ...next, name: 'Renamed' })).rte?.magneticDeclination).toEqual(result);
    const moved = moveVertex(next, 'v2', { lat: 1, lon: 2 });
    expect(moved.declination).toEqual(automaticDeclination(date));
    for (const stale of [
      moved,
      { ...moved, declination: automatic },
      withDeclination(next, { ...automatic, date: '2026-11-04' }),
    ])
      expect(() => validateForRte(stale)).toThrow(/declination result/);
  });
});
