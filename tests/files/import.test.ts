import { describe, expect, it } from 'vitest';
import { parseRoutes } from '../../src/files';

describe('GPX', () => {
  const gpx = `<?xml version="1.0"?>
    <gpx xmlns="http://www.topografix.com/GPX/1/1">
    <trk><name>North &amp; South</name>
      <trkseg><trkpt lat="20" lon="110"><ele>-12</ele></trkpt><trkpt lat="20" lon="112"><ele>0</ele></trkpt></trkseg>
      <trkseg><trkpt lat="21" lon="110"/><trkpt lat="22" lon="110"/></trkseg>
    </trk>
    <rte><name>Alternative</name><rtept lat="30" lon="110"/><rtept lat="30" lon="111"/></rte>
    <wpt lat="20.1" lon="111"><name>Water</name></wpt></gpx>`;

  it('offers segments and planned routes separately, preserving source heights and landmarks', () => {
    const choices = parseRoutes(gpx, 'race.gpx');
    expect(choices.map((item) => item.name)).toEqual([
      'North & South · 1',
      'North & South · 2',
      'Alternative',
    ]);
    const doc = choices[0].open();
    expect(choices[0].pointCount).toBe(2);
    expect(doc.elevation.map((s) => s.height)).toEqual([-12, 0]);
    expect(doc.stations.map((s) => s.kind)).toEqual(['start', 'poi', 'finish']);
    expect(doc.stations[1].location).toEqual({ lat: 20.1, lon: 111 });
    expect(doc.stations[1].anchor?.vertexId).toBe(doc.vertices[0].id);
    expect(doc.stations[1].anchor?.fraction).toBeCloseTo(0.5);
    expect(choices[1].open().elevation.map((s) => s.height)).toEqual([null, null]);
  });
});

describe('KML', () => {
  const kml = (geometry: string) => `<kml><Document><Folder><Placemark><name>Course</name>
    <MultiGeometry>${geometry}<Point><coordinates>2,1.2</coordinates></Point></MultiGeometry>
    </Placemark></Folder></Document></kml>`;
  const line = (mode = '') => `<LineString>${mode && `<altitudeMode>${mode}</altitudeMode>`}
    <coordinates>2,1,-1.5 2,2,0</coordinates></LineString>`;

  it('uses KML absolute heights, asks for ambiguous ones and excludes explicit ground offsets', () => {
    const choices = parseRoutes(
      kml(line('absolute') + line() + line('relativeToGround') + line('clampToGround')),
      'race.kml',
    );
    expect(choices).toHaveLength(4);
    expect(choices.map((item) => item.hasUnconfirmedHeights)).toEqual([false, true, false, false]);
    expect(choices[0].open().elevationReference).toBe(1);
    expect(choices[0].open().elevation.map((s) => s.height)).toEqual([-1.5, 0]);
    expect(choices[1].open().elevation.map((s) => s.height)).toEqual([null, null]);
    expect(choices[1].open(true).elevation.map((s) => s.height)).toEqual([-1.5, 0]);
    expect(choices[2].open(true).elevation.map((s) => s.height)).toEqual([null, null]);
    expect(choices[3].open(true).elevation.map((s) => s.height)).toEqual([null, null]);
  });

  it('recognizes namespaced track coordinates', () => {
    const course = parseRoutes(
      kml('<gx:Track><gx:coord>2 1 4</gx:coord><gx:coord>2 3 5</gx:coord></gx:Track>'),
      'a.kml',
    )[0];
    expect(course.open(true).vertices.map((v) => v.lat)).toEqual([1, 3]);
  });

  it('merges stationary samples and makes conflicting heights editable as gaps', () => {
    const geometry =
      '<LineString><altitudeMode>absolute</altitudeMode><coordinates>2,1 2,1,3 2,2,7 2,2,8 2,2,7 2,1,9</coordinates></LineString>';
    const doc = parseRoutes(kml(geometry), 'a.kml')[0].open();
    expect(doc.elevation.map((sample) => sample.height)).toEqual([3, null, 9]);
    expect(doc.vertices.map((v) => v.lat)).toEqual([1, 2, 1]);
  });
});

describe('invalid imports', () => {
  it.each([
    ['<gpx><trk></gpx>', 'invalid-xml'],
    ['<!DOCTYPE gpx [<!ENTITY x "oops">]><gpx/>', 'invalid-xml'],
    ['<log/>', 'unsupported-format'],
    ['<gpx><trk/></gpx>', 'no-routes'],
    ['<gpx><rte><rtept lon="10"/></rte></gpx>', 'invalid-coordinates'],
    [
      '<kml><Placemark><LineString><coordinates>1,91</coordinates></LineString></Placemark></kml>',
      'invalid-coordinates',
    ],
  ])('rejects %s with %s', (xml, code) => {
    expect(() => parseRoutes(xml, 'race')).toThrowError(expect.objectContaining({ code }));
  });
});
