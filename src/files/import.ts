import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  automaticDeclination,
  distanceMeters,
  distances,
  lonDelta,
  newId,
  type Anchor,
  type RouteDocument,
  type Station,
  type Vertex,
} from '../domain/model';
import { stationPassages, type StationPassage } from '../domain/projection';
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

interface NumberedMark {
  index: number;
  number: number;
  passes: StationPassage[];
}

// XML order does not define route order. Use an explicit series such as CP1,
// CP2, CP3 only when single-pass landmarks establish its direction on this route.
function matchSeries(marks: NumberedMark[], anchors: (Anchor | null)[]) {
  if (marks.length < 3 || new Set(marks.map((m) => m.number)).size !== marks.length) return;
  const ordered = marks.sort((a, b) => a.number - b.number);
  const fixed = ordered.filter((mark) => mark.passes.length === 1);
  if (fixed.length < 2) return;
  const direction = fixed.at(-1)!.passes[0].distance - fixed[0].passes[0].distance;
  if (direction === 0) return;
  if (direction < 0) ordered.reverse();

  // Earliest feasible visit for every prefix, latest for every suffix.
  // Their intersection gives exactly the visits consistent with the whole series.
  const earliest: number[] = [];
  let previous = -Infinity;
  for (const mark of ordered) {
    const first = mark.passes.find((pass) => pass.distance >= previous);
    if (!first) return; // Numbering is inconsistent with the course.
    previous = first.distance;
    earliest.push(previous);
  }
  let next = Infinity;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const { passes, index } = ordered[i];
    const allowed = passes.filter(
      (pass) => pass.distance >= (earliest[i - 1] ?? -Infinity) && pass.distance <= next,
    );
    anchors[index] = allowed.length === 1 ? allowed[0].anchor : null;
    next = allowed.at(-1)!.distance;
  }
}

function matchLandmarks(doc: RouteDocument, landmarks: Landmark[]): (Anchor | null)[] {
  const axis = distances(doc.vertices);
  const groups = new Map<string, NumberedMark[]>();
  const anchors: (Anchor | null)[] = landmarks.map((landmark, index) => {
    const passes = stationPassages(doc, landmark.location, axis);
    const match = /^([a-z]+)[ -]?(\d{1,6})(?=$|[^a-z0-9])/i.exec(landmark.name);
    if (match) {
      const prefix = match[1].toUpperCase();
      const series = groups.get(prefix) ?? [];
      series.push({ index, number: Number(match[2]), passes });
      groups.set(prefix, series);
    }
    // Keep the nearest pass for ordinary landmarks. Users can review alternatives.
    return passes.reduce((best, pass) => (pass.offset < best.offset ? pass : best)).anchor;
  });
  for (const marks of groups.values()) matchSeries(marks, anchors);
  return anchors;
}

function applyEndpointMark(endpoint: Station, mark: Landmark, namedForRole: boolean) {
  const role = endpoint.kind === 'start' ? 'Start' : 'Finish';
  const name = namedForRole ? mark.name : `${role} · ${mark.name}`;
  if (endpoint.name === role || name.length >= endpoint.name.length) {
    endpoint.name = name;
    endpoint.location = mark.location;
  }
}

function mergeEndpointMark(mark: Landmark, vertices: Vertex[], start: Station, finish: Station): boolean {
  const combined = /起终点|起終點|start\s*[/&-]\s*finish/i.test(mark.name);
  const isStart = combined || /起点|起點|\bstart\b/i.test(mark.name);
  const isFinish = combined || /终点|終點|\bfinish\b/i.test(mark.name);
  if (!isStart && !isFinish) return false;

  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const closed = vertices.length > 2 && first.lat === last.lat && lonDelta(first.lon, last.lon) === 0;
  const fromStart = distanceMeters(first, mark.location);
  const fromFinish = distanceMeters(last, mark.location);
  // On a loop the name distinguishes the two visits to the same place.
  const atStart = fromStart <= 100 && (closed ? isStart : fromStart <= fromFinish);
  const atFinish = fromFinish <= 100 && (closed ? isFinish : fromFinish <= fromStart);
  if (atStart) applyEndpointMark(start, mark, isStart);
  if (atFinish) applyEndpointMark(finish, mark, isFinish);
  return atStart || atFinish;
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
    declination: automaticDeclination(),
    vertices,
    elevation,
    stations: [],
    elevationReference: line.heights === 'sea-level' ? 1 : 0,
  };
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const start: Station = {
    id: newId(),
    name: 'Start',
    kind: 'start',
    boundary: true,
    anchor: { vertexId: first.id, fraction: 0 },
  };
  const finish: Station = {
    id: newId(),
    name: 'Finish',
    kind: 'finish',
    boundary: true,
    anchor: { vertexId: last.id, fraction: 0 },
  };
  const checkpoints = landmarks.flatMap((mark, index) =>
    mergeEndpointMark(mark, vertices, start, finish)
      ? []
      : [{ ...mark, checkpointName: mark.name || `CP ${index + 1}` }],
  );
  const anchors = matchLandmarks(doc, checkpoints);
  doc.stations.push(start);
  for (const [index, mark] of checkpoints.entries()) {
    doc.stations.push({
      id: newId(),
      name: mark.checkpointName,
      kind: 'cp',
      boundary: true,
      location: mark.location,
      anchor: anchors[index],
    });
  }
  doc.stations.push(finish);
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
        declination: automaticDeclination(),
        pointCount: line.points.length,
        hasUnconfirmedHeights: line.heights === 'unconfirmed' && line.points.some((p) => p.height !== null),
        open: (useUnconfirmedHeights = false) => openLine(line, result.landmarks, useUnconfirmedHeights),
      };
    });
  if (choices.length === 0) throw new RouteFileError('no-routes');
  return choices;
}
