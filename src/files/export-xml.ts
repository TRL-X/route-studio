import type { Point } from '../domain/model';
import { RouteFileError } from './errors';
import type { ExportPoint, ExportStation } from './export';

function xmlText(text: string) {
  // XML 1.0 cannot represent these characters, even as character references.
  if (/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(text))
    throw new RouteFileError('export-xml-name');
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;');
}
// GPX coordinates and elevations are xs:decimal, which excludes scientific notation.
const degrees = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 9 });
function gpxPosition({ lat, lon }: Point) {
  const longitude = degrees.format(lon);
  return `lat="${degrees.format(lat)}" lon="${longitude === '180' ? '-180' : longitude}"`;
}

export function writeTrackXml(
  format: 'gpx' | 'kml',
  name: string,
  points: ExportPoint[],
  stations: ExportStation[],
  absolute: boolean,
) {
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const routeName = `<name>${xmlText(name)}</name>`;
  if (format === 'gpx') {
    const waypoints = stations.map(
      (s) => `<wpt ${gpxPosition(s.location)}><name>${xmlText(s.name)}</name><type>${s.kind}</type></wpt>`,
    );
    const track = points.map((p) => {
      const height = p.height === null ? '' : `<ele>${degrees.format(p.height)}</ele>`;
      return `<trkpt ${gpxPosition(p)}>${height}</trkpt>`;
    });
    return (
      declaration +
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Route Studio">\n' +
      waypoints.join('\n') +
      '\n<trk>' +
      routeName +
      '<trkseg>\n' +
      track.join('\n') +
      '\n</trkseg></trk>\n</gpx>\n'
    );
  }
  const markers = stations.map(
    (s) =>
      `<Placemark><name>${xmlText(s.name)}</name><ExtendedData><Data name="route-studio-kind"><value>${s.kind}</value></Data></ExtendedData><Point><coordinates>${s.location.lon},${s.location.lat}</coordinates></Point></Placemark>`,
  );
  const coordinates = points.map((p) => (absolute ? `${p.lon},${p.lat},${p.height}` : `${p.lon},${p.lat}`));
  return (
    declaration +
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
    routeName +
    '\n<Placemark>' +
    routeName +
    '<LineString><altitudeMode>' +
    (absolute ? 'absolute' : 'clampToGround') +
    '</altitudeMode><coordinates>\n' +
    coordinates.join('\n') +
    '\n</coordinates></LineString></Placemark>\n' +
    markers.join('\n') +
    '\n</Document></kml>\n'
  );
}
