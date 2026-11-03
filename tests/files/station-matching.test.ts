import { describe, expect, it } from 'vitest';
import { parseRoutes } from '../../src/files';
import { anchorDistance, type RouteDocument } from '../../src/domain/model';
import { stationPassages } from '../../src/domain/projection';
import { readRte, writeRte } from '../../src/rte';

// A course passes close to the landmark twice. The first visit is closer
// geographically, but only the second comes between checkpoints 13 and 15.
const course = [
  [-0.01, 0],
  [0.01, 0],
  [0.012, 0.006],
  [0.008, 0.01],
  [0, 0.00012],
  [-0.012, 0.006],
];
const marker = [0, 0.00002];
const stops = [
  ['CP14', marker],
  ['CP15', course[5]],
  ['CP13', course[3]],
] as const;

type Mark = readonly [string, number[]];
function gpx(marks: readonly Mark[], route = course) {
  const waypoints = marks
    .map(([name, [lon, lat]]) => `<wpt lon="${lon}" lat="${lat}"><name>${name}</name></wpt>`)
    .join('');
  const points = route.map(([lon, lat]) => `<trkpt lon="${lon}" lat="${lat}"><ele>10</ele></trkpt>`).join('');
  return parseRoutes(`<gpx>${waypoints}<trk><trkseg>${points}</trkseg></trk></gpx>`, 'route.gpx')[0].open();
}
function station(doc: RouteDocument, name: string) {
  return doc.stations.find((s) => s.name === name)!;
}
function distance(doc: RouteDocument, name: string) {
  return anchorDistance(doc, station(doc, name).anchor!);
}

describe('imported endpoint landmarks', () => {
  it('uses the closer end of an open route even when the landmark names describe the opposite direction', () => {
    // The ends are less than 100 m apart, so each mark is in range of both.
    const doc = gpx(
      [
        ['Finish hill', [0, 0.0001]],
        ['Start plaza', [0.0007, 0]],
      ],
      [
        [0, 0],
        [0.0007, 0],
      ],
    );
    const exported = readRte(writeRte({ ...doc, declination: { mode: 'omit' } }));
    expect(exported.stations).toMatchObject([
      {
        kind: 'start',
        name: 'Start · Finish hill',
        boundary: true,
        location: { lon: 0, lat: 0.0001 },
        anchor: { vertexId: exported.vertices[0].id, fraction: 0 },
      },
      {
        kind: 'finish',
        name: 'Finish · Start plaza',
        boundary: true,
        location: { lon: 0.0007, lat: 0 },
        anchor: { vertexId: exported.vertices.at(-1)!.id, fraction: 0 },
      },
    ]);
  });

  it('consumes only endpoint names within 100 m and keeps source numbering for unnamed checkpoints', () => {
    const doc = gpx(
      [
        ['起點', [0.000899, 0]], // Just under 100 m from the start.
        ['START gate', [0.0009, 0]], // Just over 100 m.
        ['Starter', [0, 0]],
        ['', [0.005, 0]],
        ['终点', [0.01, 0]],
      ],
      [
        [0, 0],
        [0.01, 0],
      ],
    );
    expect(doc.stations.map((s) => [s.kind, s.name])).toEqual([
      ['start', '起點'],
      ['cp', 'START gate'],
      ['cp', 'Starter'],
      ['cp', 'CP 4'],
      ['finish', '终点'],
    ]);
  });

  it('assigns start and finish names independently on a closed route', () => {
    const doc = gpx(
      [
        ['起点东门', [0.0001, 0]],
        ['起点', [0, 0]],
        ['終點', [0, 0.0001]],
      ],
      [
        [0, 0],
        [0.01, 0],
        [0, 0],
      ],
    );
    expect(doc.stations).toMatchObject([
      { kind: 'start', name: '起点东门', location: { lon: 0.0001, lat: 0 } },
      { kind: 'finish', name: '終點', location: { lon: 0, lat: 0.0001 } },
    ]);
  });

  it.each(['起终点', '起終點', 'Start / Finish'])(
    'reuses a shared KML marker named %s for both visits',
    (name) => {
      const xml = `<kml><Document><Placemark><LineString><coordinates>180,0 179.99,0 -180,0</coordinates></LineString></Placemark>
      <Placemark><name>${name}</name><Point><coordinates>180,0.0001</coordinates></Point></Placemark></Document></kml>`;
      const doc = parseRoutes(xml, 'loop.kml')[0].open();
      expect(doc.stations).toMatchObject([
        {
          kind: 'start',
          name,
          anchor: { vertexId: doc.vertices[0].id },
          location: { lon: 180, lat: 0.0001 },
        },
        {
          kind: 'finish',
          name,
          anchor: { vertexId: doc.vertices.at(-1)!.id },
          location: { lon: 180, lat: 0.0001 },
        },
      ]);
    },
  );
});

describe('matching landmarks to route passages', () => {
  it('uses coherent numbered checkpoints, preserving landmark location and both endpoints', () => {
    const doc = gpx(stops);
    const cp = station(doc, 'CP14');
    expect(cp.location).toEqual({ lon: marker[0], lat: marker[1] });
    const candidates = stationPassages(doc, cp.location!);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].offset).toBeLessThan(candidates[1].offset);
    expect(cp.anchor).toEqual(candidates[1].anchor);
    expect(distance(doc, 'CP14')).toBeGreaterThan(distance(doc, 'CP13'));
    expect(distance(doc, 'CP14')).toBeLessThan(distance(doc, 'CP15'));
    expect(station(doc, 'Start').anchor?.vertexId).toBe(doc.vertices[0].id);
    expect(station(doc, 'Finish').anchor?.vertexId).toBe(doc.vertices.at(-1)?.id);
  });

  it('matches unordered KML placemarks even when the route traverses the numbered series in reverse', () => {
    const markers = stops
      .map(
        ([name, p]) =>
          `<Placemark><name>${name}</name><Point><coordinates>${p.join(',')}</coordinates></Point></Placemark>`,
      )
      .join('');
    const points = course
      .slice()
      .reverse()
      .map((p) => p.join(','))
      .join(' ');
    const xml = `<kml><Document>${markers}<Placemark><LineString><coordinates>${points}</coordinates></LineString></Placemark></Document></kml>`;
    const doc = parseRoutes(xml, 'route.kml')[0].open();
    expect(distance(doc, 'CP15')).toBeLessThan(distance(doc, 'CP14'));
    expect(distance(doc, 'CP14')).toBeLessThan(distance(doc, 'CP13'));
  });

  it('leaves a numbered station unassigned when either passage fits its sequence', () => {
    const doc = gpx([
      ['CP13', course[0]],
      ['CP14', marker],
      ['CP15', course[5]],
      ['Water', marker],
    ]);
    expect(station(doc, 'CP14').anchor).toBeNull();
    expect(station(doc, 'CP14').location).toEqual({ lon: marker[0], lat: marker[1] });
    // An unrelated placemark keeps its nearest pass and can be reassigned in the inspector.
    expect(station(doc, 'Water').anchor).toEqual(
      stationPassages(doc, station(doc, 'Water').location!)[0].anchor,
    );
  });

  it('falls back to nearest geography for duplicate or contradictory numbers', () => {
    const contradictory = gpx([['CP11', course[0]], ['CP12', course[5]], ...stops]);
    const duplicate = gpx([...stops, ['CP13', course[0]]]);
    for (const doc of [duplicate, contradictory]) {
      const point = station(doc, 'CP14');
      expect(point.anchor).toEqual(stationPassages(doc, point.location!)[0].anchor);
    }
  });

  it('detects two visits on adjacent outbound and returning segments with a distant turnaround', () => {
    const doc = gpx([]);
    doc.vertices = [
      { id: 'a', lat: 0, lon: -0.01 },
      { id: 'b', lat: 0, lon: 0.01 },
      { id: 'c', lat: 0, lon: -0.01 },
    ];
    const choices = stationPassages(doc, { lat: 0, lon: 0 });
    expect(choices.map((p) => p.anchor)).toEqual([
      { vertexId: 'a', fraction: 0.5 },
      { vertexId: 'b', fraction: 0.5 },
    ]);
  });
});
