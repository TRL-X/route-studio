import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { newId, nearestAnchor, type RouteDocument } from '../domain/model';
import { RouteFileError } from './errors';

export interface RouteChoice {
  name: string;
  pointCount: number;
  hasUnconfirmedHeights: boolean;
  open(useUnconfirmedHeights?: boolean): RouteDocument;
}

type XmlElement = Record<string, unknown>;
type Position = { lat: number; lon: number };
type TrackPoint = Position & { height: number | null };
type Landmark = { name: string; location: Position };
type Line = {
  name: string;
  points: TrackPoint[];
  heights: 'unknown-reference' | 'sea-level' | 'unconfirmed' | 'unavailable';
};

function object(value: unknown): XmlElement {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as XmlElement) : {};
}

function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  const content = typeof value === 'string' ? value : object(value)['#text'];
  return typeof content === 'string' ? content.trim() : '';
}

function number(value: unknown): number | null {
  const raw = text(value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function point(rawLat: unknown, rawLon: unknown, rawHeight: unknown): TrackPoint {
  const lat = number(rawLat);
  const lon = number(rawLon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new RouteFileError('invalid-coordinates');
  }
  return { lat, lon, height: number(rawHeight) };
}

function gpxPoint(value: unknown): TrackPoint {
  const node = object(value);
  return point(node['@_lat'], node['@_lon'], node.ele);
}

function readGpx(root: XmlElement, fallback: string) {
  const lines: Line[] = [];
  const landmarks = list(root.wpt).map((node) => {
    const { lat, lon } = gpxPoint(node);
    return { name: text(object(node).name), location: { lat, lon } };
  });

  for (const entry of list(root.trk)) {
    const track = object(entry);
    const name = text(track.name) || fallback;
    const segments = list(track.trkseg);
    segments.forEach((segment, index) => {
      lines.push({
        name: segments.length > 1 ? `${name} · ${index + 1}` : name,
        points: list(object(segment).trkpt).map(gpxPoint),
        heights: 'unknown-reference',
      });
    });
  }
  for (const entry of list(root.rte)) {
    const route = object(entry);
    lines.push({
      name: text(route.name) || fallback,
      points: list(route.rtept).map(gpxPoint),
      heights: 'unknown-reference',
    });
  }
  return { lines, landmarks };
}

function kmlPoints(value: unknown): TrackPoint[] {
  const raw = text(value);
  if (!raw) return [];
  return raw.split(/\s+/).map((tuple) => {
    const parts = tuple.split(',');
    if (parts.length > 3) throw new RouteFileError('invalid-coordinates');
    return point(parts[1], parts[0], parts[2]);
  });
}

// A stationary run has one route position. Preserve a single known height,
// or leave a gap for the editor if its source measurements disagree.
function mergeStationaryPoints(points: TrackPoint[]): TrackPoint[] {
  const result: TrackPoint[] = [];
  let index = 0;
  while (index < points.length) {
    const first = points[index++];
    let height = first.height;
    let conflicting = false;
    while (index < points.length && points[index].lat === first.lat && points[index].lon === first.lon) {
      const next = points[index++].height;
      if (next === null) continue;
      if (height !== null && height !== next) conflicting = true;
      height = next;
    }
    result.push({ ...first, height: conflicting ? null : height });
  }
  return result;
}

function readKml(root: XmlElement, fallback: string) {
  const lines: Line[] = [];
  const landmarks: Landmark[] = [];

  function geometry(node: XmlElement, name: string) {
    for (const value of list(node.Point)) {
      const points = kmlPoints(object(value).coordinates);
      if (points.length !== 1) throw new RouteFileError('invalid-coordinates');
      const { lat, lon } = points[0];
      landmarks.push({ name, location: { lat, lon } });
    }

    for (const tag of ['LineString', 'Track']) {
      for (const item of list(node[tag])) {
        const line = object(item);
        const mode = text(line.altitudeMode);
        const points =
          tag === 'LineString'
            ? kmlPoints(line.coordinates)
            : list(line.coord)
                .filter((coord) => text(coord))
                .map((coord) => {
                  const [lon, lat, height] = text(coord).split(/\s+/);
                  return point(lat, lon, height);
                });

        // An omitted altitudeMode is common in GPS exports with usable third ordinates.
        // Accept those only after confirmation. Explicit ground-relative heights are offsets.
        const heights = mode === 'absolute' ? 'sea-level' : mode === '' ? 'unconfirmed' : 'unavailable';
        lines.push({ name: name || fallback, points, heights });
      }
    }
    for (const child of [...list(node.MultiGeometry), ...list(node.MultiTrack)])
      geometry(object(child), name);
  }

  function container(node: XmlElement) {
    for (const entry of list(node.Placemark)) {
      const placemark = object(entry);
      geometry(placemark, text(placemark.name));
    }
    for (const child of [...list(node.Document), ...list(node.Folder)]) container(object(child));
  }
  container(root);
  return { lines, landmarks };
}

function openLine(line: Line, landmarks: Landmark[], useUnconfirmedHeights: boolean): RouteDocument {
  const keepHeights =
    line.heights !== 'unavailable' && (line.heights !== 'unconfirmed' || useUnconfirmedHeights);
  const vertices = line.points.map(({ lat, lon }) => ({
    id: newId(),
    lat,
    lon,
  }));
  const elevation = line.points.map(({ height }, i) => ({
    anchor: { vertexId: vertices[i].id, fraction: 0 },
    height: keepHeights ? height : null,
  }));
  const doc: RouteDocument = {
    name: line.name,
    vertices,
    elevation,
    stations: [],
    elevationReference: line.heights === 'sea-level' ? 1 : 0,
  };
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  doc.stations.push({
    id: newId(),
    name: 'Start',
    kind: 'start',
    boundary: true,
    anchor: { vertexId: first.id, fraction: 0 },
  });
  for (const [index, mark] of landmarks.entries()) {
    doc.stations.push({
      id: newId(),
      name: mark.name || `POI ${index + 1}`,
      kind: 'poi',
      boundary: false,
      location: mark.location,
      anchor: nearestAnchor(doc, mark.location),
    });
  }
  doc.stations.push({
    id: newId(),
    name: 'Finish',
    kind: 'finish',
    boundary: true,
    anchor: { vertexId: last.id, fraction: 0 },
  });
  return doc;
}

export function parseRoutes(xml: string, filename: string): RouteChoice[] {
  let parsed: XmlElement;
  try {
    // GPX and KML do not require a DTD. Reject external and custom entities.
    if (/<!DOCTYPE\s/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error();
    parsed = object(
      new XMLParser({
        ignoreAttributes: false,
        removeNSPrefix: true,
        parseTagValue: false,
        parseAttributeValue: false,
      }).parse(xml),
    );
  } catch {
    throw new RouteFileError('invalid-xml');
  }

  const fallback = filename.replace(/\.(gpx|kml)$/i, '') || filename;
  let result;
  if (Object.hasOwn(parsed, 'gpx')) result = readGpx(object(parsed.gpx), fallback);
  else if (Object.hasOwn(parsed, 'kml')) result = readKml(object(parsed.kml), fallback);
  else throw new RouteFileError('unsupported-format');

  const choices = result.lines
    .filter((line) => line.points.length > 0)
    .map((source) => {
      const line = { ...source, points: mergeStationaryPoints(source.points) };
      return {
        name: line.name,
        pointCount: line.points.length,
        hasUnconfirmedHeights: line.heights === 'unconfirmed' && line.points.some((p) => p.height !== null),
        open: (useUnconfirmedHeights = false) => openLine(line, result.landmarks, useUnconfirmedHeights),
      };
    });
  if (choices.length === 0) throw new RouteFileError('no-routes');
  return choices;
}
