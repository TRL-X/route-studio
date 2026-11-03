import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import FitParser, { readFitMessages } from 'fit-file-parser';
import { emptyRoute, type RouteDocument } from '../../src/domain/model';
import { exportTrack } from '../../src/files/export';
import { parseRoutes } from '../../src/files';
import { parseFitRoutes } from '../../src/files/fit';

const readXml = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
function loop(): RouteDocument {
  const at = (vertexId: string, fraction = 0) => ({ vertexId, fraction });
  return {
    name: '山脊 & <谷>',
    elevationReference: 1,
    vertices: [
      { id: 'a', lat: 0, lon: 179.99 },
      { id: 'b', lat: 0, lon: -179.99 },
      { id: 'c', lat: 0, lon: 179.99 },
    ],
    elevation: [
      { anchor: at('b', 0.5), height: -3 },
      { anchor: at('a'), height: 0 },
      { anchor: at('b'), height: 10 },
      { anchor: at('c'), height: 0 },
    ],
    stations: [
      { id: 's', name: 'Trailhead', kind: 'start', boundary: true, anchor: at('a') },
      {
        id: 'c',
        name: '返回 CP',
        kind: 'cp',
        boundary: true,
        anchor: at('b', 0.5),
        location: { lat: 0.001, lon: -180 },
      },
      { id: 'f', name: 'Valley gate', kind: 'finish', boundary: true, anchor: at('c') },
      {
        id: 'p',
        name: 'Off trail',
        kind: 'poi',
        boundary: false,
        anchor: null,
        location: { lat: 0.2, lon: 180 },
      },
      { id: 'u', name: 'Unplaced', kind: 'poi', boundary: false, anchor: null },
    ],
  };
}

describe('track file export', () => {
  it.each(['gpx', 'kml'] as const)(
    'writes a named %s line with independent heights and physical landmarks',
    (format) => {
      const doc = loop();
      const before = structuredClone(doc);
      const { bytes, preview } = exportTrack(doc, format);
      expect(preview).toMatchObject({
        points: 4,
        stations: 4,
        anchoredStations: 3,
        missingHeights: 0,
        unplaced: ['Unplaced'],
      });
      const xml = readXml(bytes);
      expect(xml).toContain('山脊 &amp; &lt;谷&gt;');
      const [route] = parseRoutes(xml, 'loop.' + format);
      const restored = route.open();
      expect(restored.name).toBe(doc.name);
      expect(restored.stations.map((s) => [s.kind, s.name])).toEqual([
        ['start', 'Trailhead'],
        ['cp', '返回 CP'],
        ['poi', 'Off trail'],
        ['finish', 'Valley gate'],
      ]);
      expect(restored.elevation.map((s) => s.height)).toEqual([0, 10, -3, 0]);
      expect(Math.abs(restored.vertices[2].lon)).toBe(180);
      expect(restored.stations.find((s) => s.name === '返回 CP')?.location).toEqual({
        lat: 0.001,
        lon: -180,
      });
      expect(restored.stations.some((s) => s.name === 'Off trail')).toBe(true);
      expect(doc).toEqual(before);
      if (format === 'gpx') {
        expect(xml).not.toContain('lon="180"');
        const root = new XMLParser({ ignoreAttributes: false }).parse(xml).gpx;
        expect(root['@_xmlns']).toBe('http://www.topografix.com/GPX/1/1');
        expect(root['@_version']).toBe('1.1');
      } else expect(xml).toContain('<altitudeMode>absolute</altitudeMode>');
    },
  );

  it('omits conflicting or missing GPX elevations, and exports incomplete or non-MSL KML in 2D', () => {
    const doc = loop();
    doc.elevation[0].height = null;
    doc.elevation.push({ anchor: { vertexId: 'a', fraction: 1 }, height: 20 });
    const gpx = exportTrack(doc, 'gpx');
    expect(gpx.preview).toMatchObject({ conflicts: 1, missingHeights: 2 });
    expect(
      parseRoutes(readXml(gpx.bytes), 'a.gpx')[0]
        .open()
        .elevation.map((s) => s.height),
    ).toEqual([0, null, null, 0]);
    for (const route of [doc, { ...loop(), elevationReference: 2 as const }]) {
      const kml = exportTrack(route, 'kml');
      expect(kml.preview.absoluteKml).toBe(false);
      expect(readXml(kml.bytes)).toContain('<altitudeMode>clampToGround</altitudeMode>');
      expect(
        parseRoutes(readXml(kml.bytes), 'a.kml')[0]
          .open()
          .elevation.every((s) => s.height === null),
      ).toBe(true);
    }
  });

  it('encodes a complete FIT Course with a distinct record for each anchored visit', async () => {
    const doc = loop();
    doc.stations.splice(2, 0, {
      id: 'water',
      name: 'Water',
      kind: 'poi',
      boundary: false,
      anchor: { vertexId: 'a', fraction: 0.5 },
    });
    const { bytes, preview } = exportTrack(doc, 'fit');
    expect(preview).toMatchObject({ points: 5, stations: 4, unplaced: ['Off trail', 'Unplaced'] });
    expect(readFitMessages(bytes).messages.map((m) => m.globalMessageNumber)).toEqual([
      0, 31, 19, 21, 20, 20, 20, 20, 20, 32, 32, 32, 32, 21,
    ]);
    const fit = await new FitParser({ strict: true, force: false }).parseAsync(bytes.buffer);
    expect(fit.file_ids?.[0].type).toBe('course');
    expect(fit.events?.map((e) => e.event_type)).toEqual(['start', 'stop_disable_all']);
    expect(fit.laps?.[0].total_distance).toBe(fit.records?.at(-1)?.distance);
    expect(fit.records?.map((r) => r.altitude)).toEqual([0, undefined, 10, -3, 0]);
    expect(fit.course_points?.map((c) => c.timestamp)).toEqual(
      [0, 1, 3, 4].map((i) => fit.records![i].timestamp),
    );
    const [choice] = await parseFitRoutes(bytes.buffer, 'loop.fit');
    const restored = choice.open();
    expect(restored.name).toBe(doc.name);
    expect(restored.stations.map((s) => s.kind)).toEqual(['start', 'poi', 'cp', 'finish']);
    expect(restored.stations[0].name).toBe('Trailhead');
    expect(restored.stations.at(-1)?.name).toBe('Valley gate');
    expect(restored.stations[2]).toMatchObject({
      anchor: { vertexId: restored.vertices[3].id, fraction: 0 },
      location: { lat: expect.closeTo(0.001, 6), lon: -180 },
    });
  });

  it('reports invalid exports without returning a damaged file', () => {
    for (const format of ['gpx', 'kml', 'fit'] as const)
      expect(() => exportTrack(emptyRoute(), format)).toThrow('export-no-line');
    const doc = loop();
    doc.stations[0].name = 'tab\u0001';
    expect(() => exportTrack(doc, 'gpx')).toThrow('export-xml-name');
    doc.name = '路'.repeat(86);
    expect(() => exportTrack(doc, 'fit')).toThrow('fit-export-name');
    doc.name = 'Route';
    doc.elevation[0].height = -501;
    expect(() => exportTrack(doc, 'fit')).toThrow('fit-export-range');
  });
});
