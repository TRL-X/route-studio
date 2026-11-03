import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import chinese from '../../src/i18n/zh-CN.rte.json' with { type: 'json' };
import { english } from '../../src/i18n/en-US.rte';
import { readRte, writeRte, validateForRte, RteError } from '../../src/rte';
import { readSections, writeSections, fileCrc, viewOf } from '../../src/rte/wire';
import { readCbor, writeCbor, type Value } from '../../src/rte/cbor';
import { geomLayout, indexLayout, pack, unpack, indexBlocks, type Geometry } from '../../src/rte/records';

/** Normative Appendix B, TRL-X/route-specification @ 6918eb7aa438186589a516f8caccb03b960c6c0e. */
const vector = (id: string) => new Uint8Array(readFileSync(new URL(`./vectors/${id}.rte`, import.meta.url)));

describe('RTE 1.0', () => {
  test('both diagnostic catalogs cover the same keys and interpolation parameters', () => {
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    const tokens = (template: string) => (template.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      expect(tokens(chinese[key]), key).toEqual(tokens(english[key]));
    }
  });

  test('formats nested labels and preserves station names containing placeholder syntax', () => {
    const doc = readRte(vector('c'));
    doc.stations[1].name = '{label}';
    doc.stations[1].anchor = null;
    const stationLabel = chinese['field.namedStation'].replace('{name}', '{label}');
    expect(() => validateForRte(doc)).toThrow(
      expect.objectContaining({
        message: 'Anchor station “{label}” to a route segment.',
        messageZh: chinese['compiler.anchorRequired'].replace('{label}', stationLabel),
        target: { type: 'station', id: doc.stations[1].id },
      }),
    );
  });

  test.each(['a', 'b', 'c'])('Appendix B vector %s survives a project save and reopen', (id) => {
    const bytes = vector(id);
    const doc = readRte(bytes);
    expect(doc.rte?.distanceDm).toEqual([0, 10000, 20000]);
    expect(doc.elevation.map((e) => e.height)).toEqual([100, 120, 90, 140]);
    expect(doc.elevation[1].anchor).toEqual({ vertexId: doc.vertices[0].id, fraction: 0.5 });
    expect(doc.rte?.magneticDeclination?.validUntil !== undefined).toBe(id === 'a');
    expect(doc.rte?.magneticDeclination !== undefined).toBe(id !== 'c');
    expect(writeRte(JSON.parse(JSON.stringify(doc)))).toEqual(bytes);
  });

  test('retains noncanonical GIDX blocks and original geometry/elevation distances after renaming', () => {
    const sections = readSections(vector('a'));
    const geom = unpack(sections.GEOM, geomLayout) as Geometry[];
    // A simplified representation may greatly underestimate true traversed distance.
    geom[1][1] = 11;
    geom[2][1] = 22;
    sections.GEOM = pack(geom, geomLayout);
    sections.GIDX = pack(indexBlocks(geom, [2, 2]), indexLayout);
    const doc = readRte(writeSections(sections));
    doc.name += ' renamed';
    const result = readSections(writeRte(doc));
    for (const type of ['GIDX', 'GEOM', 'ELEV'] as const) expect(result[type]).toEqual(sections[type]);
    expect(readRte(writeRte(doc)).stations).toEqual(doc.stations);
  });

  test('editing elevation and adding an interior boundary retains independent sampling and inserts both nodes', () => {
    const doc = readRte(vector('b'));
    doc.stations.push({
      id: 'new CP',
      name: 'Aid',
      kind: 'cp',
      boundary: true,
      anchor: { vertexId: doc.vertices[1].id, fraction: 0.6 },
      location: { lat: 1, lon: -2 },
    });
    doc.elevation[1].height = -0.05;
    const result = readRte(writeRte(doc));
    expect(result.rte?.distanceDm).toEqual([0, 10000, 16000, 20000]);
    expect(result.elevation.map((s) => s.height)).toEqual([100, -0.1, 90, 120, 140]);
    expect(result.stations.find((s) => s.name === 'Aid')?.location).toEqual({ lat: 1, lon: -2 });
  });

  test('compiler derives distance after geometry changes and crosses the antimeridian on the short arc', () => {
    const doc = readRte(vector('c'));
    delete doc.rte;
    doc.vertices[0].lon = 179;
    doc.vertices[1].lon = -179;
    doc.vertices[2].lon = -178;
    doc.stations.push({
      id: 'extra',
      name: 'Dateline',
      kind: 'poi',
      boundary: true,
      anchor: { vertexId: doc.vertices[0].id, fraction: 0.5 },
    });
    const next = readRte(writeRte(doc));
    expect(next.vertices.some((v) => v.lon === -180)).toBe(true);
    expect(next.rte?.distanceDm?.at(-1)).toBeGreaterThan(3000000);
    expect(next.stations.find((s) => s.name === 'Dateline')?.location?.lon).toBe(-180);
  });

  test('allows incomplete editing but identifies the sample blocking RTE generation', () => {
    const doc = readRte(vector('c'));
    doc.elevation[1].height = null;
    expect(() => validateForRte(doc)).toThrow(/sample 2/);
    try {
      writeRte(doc);
      throw Error('unreachable');
    } catch (e) {
      expect(e).toBeInstanceOf(RteError);
      expect((e as RteError).messageZh).toBe(chinese['compiler.missingHeight'].replace('{number}', '2'));
      expect((e as RteError).target).toEqual({ type: 'sample', index: 1 });
    }
  });

  test('reports editor selections for invalid coordinates and detached stations', () => {
    const route = readRte(vector('b'));
    const station = route.stations[1];
    station.anchor = null;
    expect(() => validateForRte(route)).toThrow(
      expect.objectContaining({
        target: { type: 'station', id: station.id },
      }),
    );
    route.vertices[1].lat = 91;
    expect(() => validateForRte(route)).toThrow(
      expect.objectContaining({
        target: { type: 'vertex', id: route.vertices[1].id },
      }),
    );
  });

  test('each colliding elevation sample reports its editable index', () => {
    const route = readRte(vector('c'));
    route.elevation.push({ ...route.elevation[0], height: 1 });
    expect(() => validateForRte(route)).toThrow(
      expect.objectContaining({
        target: { type: 'sample', index: 4 },
      }),
    );
  });

  test('strict export offers a precision retry and the optional export takes the nearest original sample', () => {
    const doc = readRte(vector('b'));
    doc.rte!.distanceDm = [0, 1024, 2048];
    const first = doc.vertices[0].id;
    doc.elevation[1] = { anchor: { vertexId: first, fraction: 0.5 + 1 / 4096 }, height: 125 };
    doc.elevation.push({ anchor: { vertexId: first, fraction: 0.5 - 1 / 8192 }, height: 110 });
    const before = structuredClone(doc);
    expect(() => writeRte(doc)).toThrow(
      expect.objectContaining({
        canResample: true,
        target: { type: 'sample', index: 4 },
      }),
    );
    const output = readRte(writeRte(doc, { resampleElevation: true }));
    expect(output.elevation.map((s) => s.height)).toEqual([100, 110, 90, 140]);
    expect(doc).toEqual(before);
    // For an exact tie the earlier position wins regardless of editor array order.
    doc.elevation[4].anchor.fraction = 0.5 - 1 / 4096;
    doc.elevation.reverse();
    expect(readRte(writeRte(doc, { resampleElevation: true })).elevation[1].height).toBe(110);
  });

  test('resampling keeps the true endpoint height even when a nearby sample is nearer its device bin', () => {
    const doc = readRte(vector('c'));
    delete doc.rte;
    doc.vertices = [
      { id: 'origin', lat: 0, lon: 0 },
      { id: 'end', lat: 0, lon: ((10.043 / 6371008.8) * 180) / Math.PI },
    ];
    const origin = { vertexId: 'origin', fraction: 0 };
    const end = { vertexId: 'end', fraction: 0 };
    doc.stations = [
      { ...doc.stations[0], anchor: origin },
      { ...doc.stations.at(-1)!, anchor: end },
    ];
    doc.elevation = [
      { anchor: origin, height: 10 },
      { anchor: { vertexId: 'origin', fraction: 10.001 / 10.043 }, height: 50 },
      { anchor: end, height: 20 },
    ];
    expect(() => writeRte(doc)).toThrow(expect.objectContaining({ canResample: true }));
    const output = readRte(writeRte(doc, { resampleElevation: true }));
    expect(output.rte!.distanceDm).toEqual([0, 100]);
    expect(output.elevation.map((s) => s.height)).toEqual([10, 20]);
  });

  test('even optional resampling rejects conflicting measurements at identical positions and missing data', () => {
    const doc = readRte(vector('c'));
    const near = { vertexId: doc.vertices[0].id, fraction: 0.50001 };
    doc.elevation.push({ anchor: near, height: 119 });
    doc.elevation.push({ anchor: near, height: 118 });
    for (const resampleElevation of [false, true]) {
      expect(() => writeRte(doc, { resampleElevation })).toThrow(
        expect.objectContaining({
          canResample: false,
          target: { type: 'sample', index: 5 },
        }),
      );
    }
    doc.elevation[5].height = null;
    expect(() => writeRte(doc)).toThrow(
      expect.objectContaining({ canResample: false, target: { type: 'sample', index: 5 } }),
    );
  });

  test('maintains full unsigned 32-bit station IDs through field edits', () => {
    const doc = readRte(vector('a'));
    for (let i = 0; i < doc.stations.length; i++)
      doc.stations[i].id = String(4294967295 - doc.stations.length + i + 1);
    const roundTrip = readRte(writeRte(doc));
    expect(roundTrip.stations.map((s) => s.id)).toEqual(doc.stations.map((s) => s.id));
    roundTrip.stations[1].name = 'renamed CP';
    expect(readRte(writeRte(roundTrip)).stations).toEqual(roundTrip.stations);
  });

  test('assigns endpoint POI IDs around imported start and finish IDs', () => {
    const doc = readRte(vector('b'));
    for (let i = 0; i < doc.stations.length; i++) doc.stations[i].id = String((i + 1) * 1000);
    const start = doc.stations[0];
    const finish = doc.stations.at(-1)!;
    doc.stations.push(
      { ...start, kind: 'poi', boundary: false, id: 'start aid', name: 'Start aid' },
      { ...finish, kind: 'poi', boundary: false, id: 'finish aid', name: 'Finish aid' },
    );
    const output = readRte(writeRte(doc));
    expect(output.stations[0].id).toBe(start.id);
    expect(output.stations.at(-1)!.id).toBe(finish.id);
    expect(output.stations).toHaveLength(doc.stations.length);
  });

  test('ignores validated META extensions and rejects reserved keys', () => {
    const sections = readSections(vector('a'));
    const root = readCbor(sections.META) as Map<number, Value>;
    root.set(128, new Map([[3, 'extension data']]));
    sections.META = writeCbor(root);
    expect(writeRte(readRte(writeSections(sections)))).toEqual(vector('a'));
    root.set(6, false);
    sections.META = writeCbor(root);
    expect(() => readRte(writeSections(sections))).toThrow(/reserved key 6/);
  });

  test('distinguishes ignorable and critical sections after whole-file CRC validation', () => {
    // Add a fifth entry and shift the four known sections to their new aligned positions.
    const original = vector('c');
    const data = new Uint8Array(original.length + 21);
    data.set(original.subarray(0, 106));
    const view = viewOf(data);
    view.setUint16(12, 5, true);
    view.setUint32(8, data.length, true);
    for (let i = 18; i < 106; i += 22) view.setUint32(i + 6, view.getUint32(i + 6, true) + 20, true);
    data.set(original.subarray(108), 128);
    data.set(new TextEncoder().encode('INFO'), 106);
    view.setUint32(112, data.length - 1, true);
    view.setUint32(116, 1, true);
    view.setUint32(14, fileCrc(data), true);
    expect(writeRte(readRte(data))).toEqual(original);
    view.setUint16(110, 1, true);
    view.setUint32(14, fileCrc(data), true);
    expect(() => readRte(data)).toThrow(/critical section INFO/);
    data[data.length - 1] = 1;
    expect(() => readRte(data)).toThrow(/checksum/);
  });

  test('validates cumulative heights and index bounds even when the checksum is valid', () => {
    const sections = readSections(vector('c'));
    viewOf(sections.ELEV).setUint32(24, 3, true);
    expect(() => readRte(writeSections(sections))).toThrow(/cumulative ascent/);
    sections.ELEV = readSections(vector('c')).ELEV;
    viewOf(sections.GIDX).setInt32(28, 5, true);
    expect(() => readRte(writeSections(sections))).toThrow(/GIDX/);
  });
});
