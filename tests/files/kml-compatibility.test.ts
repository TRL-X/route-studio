import { describe, expect, it } from 'vitest';
import { parseRoutes } from '../../src/files';
import { exportTrack } from '../../src/files/export';

const kml = (content: string) =>
  `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>${content}</Document></kml>`;
const track = (mode = '') => `<gx:Track>${mode && `<altitudeMode>${mode}</altitudeMode>`}
  <when>2020-01-01T00:00:00Z</when><when>2020-01-01T00:00:01Z</when>
  <gx:coord>0 0 100</gx:coord><gx:coord>0.01 0 200</gx:coord></gx:Track>`;
const line = (name: string, coordinates = '0,0 0.01,0') =>
  `<Placemark><name>${name}</name><LineString><coordinates>${coordinates}</coordinates></LineString></Placemark>`;
const marker = (name: string, coordinates: string, kind = '') =>
  `<Placemark><name>${name}</name>${kind && `<ExtendedData><Data name="route-studio-kind"><value>${kind}</value></Data></ExtendedData>`}<Point><coordinates>${coordinates}</coordinates></Point></Placemark>`;

describe('KML MultiTrack altitude modes', () => {
  it('keeps the parent absolute altitude reference through import and export', () => {
    const source = kml(`<Placemark><MultiGeometry><gx:MultiTrack>
      <altitudeMode>absolute</altitudeMode>${track()}${track()}
      </gx:MultiTrack></MultiGeometry></Placemark>`);
    const choices = parseRoutes(source, 'absolute.kml');
    expect(choices).toHaveLength(2);
    for (const choice of choices) {
      expect(choice.hasUnconfirmedHeights).toBe(false);
      const doc = choice.open();
      expect(doc.elevationReference).toBe(1);
      expect(doc.elevation.map((sample) => sample.height)).toEqual([100, 200]);
      expect(exportTrack(doc, 'kml').preview.absoluteKml).toBe(true);
    }
  });

  it.each(['relativeToGround', 'clampToGround', 'relativeToSeaFloor', 'clampToSeaFloor'])(
    'does not offer parent %s heights as absolute elevation',
    (mode) => {
      const tag = mode.endsWith('SeaFloor') ? 'gx:altitudeMode' : 'altitudeMode';
      const source = kml(
        `<Placemark><gx:MultiTrack><${tag}>${mode}</${tag}>${track()}</gx:MultiTrack></Placemark>`,
      );
      const [choice] = parseRoutes(source, 'relative.kml');
      expect(choice.hasUnconfirmedHeights).toBe(false);
      expect(choice.open(true).elevation.map((sample) => sample.height)).toEqual([null, null]);
    },
  );

  it('applies a MultiTrack mode to its tracks while retaining explicit standalone track modes', () => {
    const source = kml(`<Placemark><MultiGeometry>
      <gx:MultiTrack><altitudeMode>clampToGround</altitudeMode>${track('absolute')}</gx:MultiTrack>
      ${track('absolute')}
      </MultiGeometry></Placemark>`);
    const choices = parseRoutes(source, 'modes.kml');
    expect(choices[0].open().elevationReference).toBe(1);
    expect(choices[1].open(true).elevation.map((sample) => sample.height)).toEqual([null, null]);
  });

  it('retains track-specific modes when the MultiTrack mode is omitted', () => {
    const source = kml(
      `<Placemark><gx:MultiTrack>${track('absolute')}${track()}</gx:MultiTrack></Placemark>`,
    );
    const choices = parseRoutes(source, 'omitted.kml');
    expect(choices[0].open().elevationReference).toBe(1);
    expect(choices[1].hasUnconfirmedHeights).toBe(true);
  });
});

describe('KML landmark association', () => {
  it('keeps distant landmarks from other routes as unassigned points of interest', () => {
    const source = kml(`<Folder>${line('A')}${marker('A water', '0.005,0')}</Folder>
      <Folder>${line('B', '120,30 120.01,30')}
      ${marker('B water', '120.005,30')}${marker('B start', '120,30', 'start')}</Folder>`);
    const [a, b] = parseRoutes(source, 'routes.kml').map((choice) => choice.open());
    expect(a.stations[0]).toMatchObject({ name: 'Start', kind: 'start' });
    expect(a.stations.find((station) => station.name === 'A water')).toMatchObject({
      kind: 'cp',
      boundary: true,
      anchor: { vertexId: a.vertices[0].id, fraction: 0.5 },
    });
    for (const name of ['B water', 'B start']) {
      expect(a.stations.find((station) => station.name === name)).toMatchObject({
        kind: 'poi',
        boundary: false,
        anchor: null,
      });
    }
    expect(a.stations.find((station) => station.name === 'B water')?.location).toEqual({
      lon: 120.005,
      lat: 30,
    });
    expect(b.stations[0]).toMatchObject({ name: 'B start', kind: 'start' });
    expect(b.stations.find((station) => station.name === 'B water')?.anchor).not.toBeNull();
  });

  it('uses nearby container context to distinguish overlapping routes without deleting landmarks', () => {
    const source = kml(`<Folder>${line('A')}</Folder>
      <Folder>${line('B')}${marker('B checkpoint', '0.005,0')}</Folder>`);
    const [a, b] = parseRoutes(source, 'overlap.kml').map((choice) => choice.open());
    expect(a.stations.find((station) => station.name === 'B checkpoint')).toMatchObject({
      kind: 'poi',
      boundary: false,
      anchor: null,
    });
    expect(b.stations.find((station) => station.name === 'B checkpoint')).toMatchObject({
      kind: 'cp',
      boundary: true,
      anchor: { vertexId: b.vertices[0].id, fraction: 0.5 },
    });
  });

  it('associates waypoints in a shared sibling folder with each nearby route', () => {
    const source = kml(`<Folder>${line('A')}</Folder><Folder>${line('B')}</Folder>
      <Folder><name>Shared waypoints</name>${marker('Water', '0.005,0.001')}</Folder>`);
    for (const choice of parseRoutes(source, 'shared.kml')) {
      const doc = choice.open();
      expect(doc.stations.find((station) => station.name === 'Water')).toMatchObject({
        kind: 'cp',
        boundary: true,
        anchor: { vertexId: doc.vertices[0].id, fraction: 0.5 },
      });
    }
  });

  it('uses geographic candidates before container ancestry', () => {
    const source = kml(`<Folder>${line('Distant', '1,1 1.01,1')}${marker('Shared water', '0.005,0')}</Folder>
      <Folder>${line('Nearby')}</Folder>`);
    const [distant, nearby] = parseRoutes(source, 'geography.kml').map((choice) => choice.open());
    expect(distant.stations.find((station) => station.name === 'Shared water')?.anchor).toBeNull();
    expect(nearby.stations.find((station) => station.name === 'Shared water')).toMatchObject({
      kind: 'cp',
      anchor: { vertexId: nearby.vertices[0].id, fraction: 0.5 },
    });
  });

  it('keeps far landmarks unassigned even in a single route and with explicit endpoint roles', () => {
    const source = kml(`<Folder>${line('A')}${marker('CP1', '0.005,0')}
      ${marker('CP2', '0.005,1')}${marker('Remote finish', '1,1', 'finish')}
      ${marker('Middle start', '0.005,0', 'start')}</Folder>`);
    const doc = parseRoutes(source, 'single.kml')[0].open();
    for (const name of ['CP2', 'Remote finish', 'Middle start']) {
      expect(doc.stations.find((station) => station.name === name)).toMatchObject({
        kind: 'poi',
        boundary: false,
        anchor: null,
      });
    }
    expect(doc.stations.at(-1)).toMatchObject({ name: 'Finish', kind: 'finish' });
    expect(doc.stations.find((station) => station.name === 'CP1')?.anchor).not.toBeNull();
  });
});
