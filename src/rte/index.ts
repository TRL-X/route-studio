import { exportDeclination } from '../domain/declination';
import { msg, type RteText } from './messages';
import type { RteTarget } from './check';
import {
  anchorAtDistance,
  distances,
  lonDelta,
  type Anchor,
  type Point,
  type RouteDocument,
} from '../domain/model';
import {
  RteError,
  check,
  integer,
  INT_MAX,
  INT_MIN,
  LAT,
  limit,
  LON,
  MAX_NODES,
  named,
  quantize,
  UINT,
} from './check';
import { readCbor, writeCbor } from './cbor';
import { validateRteContext } from './context';
import { readMetadata, writeMetadata, type Event, type Metadata } from './meta';
import {
  elevLayout,
  geomLayout,
  indexBlocks,
  indexLayout,
  pack,
  sameRows,
  summarize,
  unpack,
  verifyRoute,
  type Elevation,
  type Geometry,
} from './records';
import { readSections, writeSections } from './wire';

export { RteError, type RteTarget } from './check';

const kinds = ['start', 'finish', 'cp', 'poi'] as const;

export function readRte(bytes: Uint8Array): RouteDocument {
  const sections = readSections(bytes);
  const meta = readMetadata(readCbor(sections.META));
  const geom = unpack(sections.GEOM, geomLayout) as Geometry[];
  const elev = unpack(sections.ELEV, elevLayout) as Elevation[];
  verifyRoute(meta, geom, elev);
  const index = unpack(sections.GIDX, indexLayout);
  const indexBlockSizes = index.map((row) => row[1]);
  check(sameRows(index, indexBlocks(geom, indexBlockSizes)), msg('index.geometryMismatch'));
  const axis = geom.map((node) => node[2]);
  const doc: RouteDocument = {
    name: meta.name,
    elevationReference: meta.reference,
    stations: [],
    elevation: [],
    vertices: geom.map(([lat, lon], i) => ({ id: `v${i + 1}`, lat: lat / 1e7, lon: lon / 1e7 })),
    rte: { distanceDm: axis, indexBlockSizes, magneticDeclination: meta.declination },
  };
  doc.elevation = elev.map(([s, height]) => ({
    anchor: anchorAtDistance(doc, s, axis),
    height: height / 10,
  }));
  doc.stations = meta.events.map((e) => ({
    id: String(e.id),
    name: e.name,
    shortLabel: e.label,
    kind: kinds[e.kind],
    boundary: e.boundary,
    anchor: anchorAtDistance(doc, e.distance, axis),
    location: { lat: e.lat / 1e7, lon: e.lon / 1e7 },
  }));
  return doc;
}

function geo(point: Point, target: RteTarget): [number, number] {
  check(
    Number.isFinite(point.lat) &&
      Math.abs(point.lat) <= 90 &&
      Number.isFinite(point.lon) &&
      Math.abs(point.lon) <= 180,
    msg('compiler.coordinateRange'),
    target,
  );
  const lat = integer(quantize(point.lat * 1e7), -LAT, LAT, msg('field.latitude'), target);
  const lon = quantize(point.lon * 1e7);
  return [lat, lon === LON ? -LON : lon];
}

function defaultLabel(name: string) {
  const encoder = new TextEncoder();
  let result = '';
  let length = 0;
  for (const character of name) {
    length += encoder.encode(character).length;
    if (length > 16) break;
    result += character;
  }
  return result;
}

function compile(doc: RouteDocument) {
  const { vertices, stations, elevation, rte } = doc;
  named(doc.name, 96, msg('field.routeName'), { type: 'route' });
  check(vertices.length >= 2, msg('compiler.verticesRequired'));
  limit(vertices.length <= MAX_NODES && elevation.length <= MAX_NODES, msg('compiler.nodeLimit'));
  check(stations.length >= 2 && stations.length <= 4096, msg('compiler.stationCount'));
  check(elevation.length >= 2, msg('compiler.profileRequired'));
  integer(doc.elevationReference, 0, 2, msg('field.elevationReference'));
  if (rte) validateRteContext(rte, vertices.length);
  const positions = new Map(vertices.map((vertex, i) => [vertex.id, i]));
  check(positions.size === vertices.length, msg('compiler.duplicateVertexId'));
  const axis = rte?.distanceDm ?? distances(vertices).map((m) => m * 10);
  const points = new Map<number, Geometry>();
  for (const [i, v] of vertices.entries()) {
    const [lat, lon] = geo(v, { type: 'vertex', id: v.id });
    const s = quantize(axis[i]);
    // Retain the true endpoint when two very close vertices occupy the same distance bin.
    if (!points.has(s) || i === vertices.length - 1) points.set(s, [lat, lon, s]);
  }

  const total = integer(quantize(axis.at(-1)!), 1, UINT, msg('field.totalDistance'));

  function at(anchor: Anchor | null, label: RteText, target: RteTarget) {
    check(anchor !== null, msg('compiler.anchorRequired', { label }), target);
    const i = positions.get(anchor.vertexId);
    check(
      i !== undefined &&
        anchor.fraction >= 0 &&
        anchor.fraction <= 1 &&
        (i < vertices.length - 1 || anchor.fraction === 0),
      msg('validation.invalidAnchor', { label }),
      target,
    );
    const right = Math.min(i + 1, vertices.length - 1);
    const position =
      anchor.fraction === 1 ? axis[right] : axis[i] + (axis[right] - axis[i]) * anchor.fraction;
    const a = vertices[i];
    const b = vertices[right];
    let lon = a.lon + lonDelta(a.lon, b.lon) * anchor.fraction;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    return {
      s: quantize(position),
      position,
      point: { lat: a.lat + (b.lat - a.lat) * anchor.fraction, lon },
    };
  }

  // Numeric string IDs come from decoded RTE files and survive renaming/reordering.
  const incomingIds = new Set<string>();
  const used = new Set<number>();
  const numberFor = (id: string) => (/^[1-9]\d*$/.test(id) && Number(id) <= UINT ? Number(id) : undefined);
  for (const station of stations) {
    check(!incomingIds.has(station.id), msg('validation.duplicateStationId'));
    incomingIds.add(station.id);
    const id = numberFor(station.id);
    if (id !== undefined) used.add(id);
  }
  const boundaryTargets = new Map<number, RteTarget>();
  const events: Event[] = stations.map((station, i) => {
    const target: RteTarget = { type: 'station', id: station.id };
    const name = named(station.name, 96, msg('field.indexedStationName', { number: i + 1 }), target);
    const label = named(
      station.shortLabel || defaultLabel(name),
      16,
      msg('field.indexedStationLabel', { number: i + 1 }),
      target,
    );
    const { s, point } = at(station.anchor, msg('field.namedStation', { name }), target);
    const [lat, lon] = geo(station.location ?? point, target);
    if (station.kind === 'start' || station.kind === 'finish') {
      const start = station.kind === 'start';
      check(
        station.boundary && s === (start ? 0 : total),
        msg(start ? 'compiler.startPlacement' : 'compiler.finishPlacement', { name }),
        target,
      );
    }
    if (station.boundary) {
      check(!boundaryTargets.has(s), msg('compiler.sameBoundaryDistance', { name }), target);
      boundaryTargets.set(s, target);
      if (!points.has(s)) points.set(s, [...geo(point, target), s]);
    }
    const kind = kinds.indexOf(station.kind);
    check(kind >= 0 && typeof station.boundary === 'boolean', msg('compiler.invalidStationKind'), target);
    return {
      id: numberFor(station.id) ?? 0,
      kind,
      name,
      label,
      distance: s,
      lat,
      lon,
      boundary: station.boundary,
    };
  });
  events.sort(
    (a, b) =>
      a.distance - b.distance ||
      (a.kind === 0 ? -1 : b.kind === 0 ? 1 : a.kind === 1 ? 1 : b.kind === 1 ? -1 : 0),
  );
  // A POI at an endpoint shares its distance. Keep imported IDs, and choose
  // fresh IDs so the start/finish remain first/last even when their IDs are sparse.
  const start = events.find((event) => event.kind === 0);
  const finish = events.find((event) => event.kind === 1);
  let nextFree = 1;
  for (const event of events) {
    if (event.id) continue;
    let id = nextFree;
    if (event.distance === 0 && event !== start && start) id = Math.max(id, start.id + 1);
    if (event === finish) {
      for (const peer of events) if (peer.distance === total) id = Math.max(id, peer.id + 1);
    }
    while (used.has(id)) id++;
    const upperBound = event.distance === total && finish?.id && event !== finish ? finish.id - 1 : UINT;
    check(id <= upperBound, msg('compiler.finishIdExhausted', { name: event.name }));
    used.add(id);
    event.id = id;
    while (used.has(nextFree)) nextFree++;
  }
  events.sort((a, b) => a.distance - b.distance || a.id - b.id);

  // Quantization can collapse consecutive coordinates. Retain boundaries and both
  // endpoints; removing a redundant geometry node never changes the reference axis.
  const pinned = new Set([0, total, ...boundaryTargets.keys()]);
  const geom: Geometry[] = [];
  for (const node of [...points.values()].sort((a, b) => a[2] - b[2])) {
    const previous = geom.at(-1);
    if (!previous || previous[0] !== node[0] || previous[1] !== node[1]) {
      geom.push(node);
    } else if (pinned.has(node[2])) {
      check(
        !pinned.has(previous[2]),
        msg('compiler.coincidentBoundaries', { from: previous[2] / 10, to: node[2] / 10 }),
        boundaryTargets.get(node[2]),
      );
      geom[geom.length - 1] = node;
    }
  }
  let importedIndex = rte?.indexBlockSizes;
  if (geom.length !== vertices.length) importedIndex = undefined;
  // Keep source positions separate until the device distance bins are selected.
  const sourceHeights = new Map<number, number>();
  const positionsByBin = new Map<number, number>();
  let precisionIssue: RteError | undefined;
  const lastPosition = axis.at(-1)!;
  function rank(position: number, bin: number) {
    return position === 0 || position === lastPosition ? -1 : Math.abs(position - bin);
  }

  for (const [i, sample] of elevation.entries()) {
    const target: RteTarget = { type: 'sample', index: i };
    const { s, position } = at(sample.anchor, msg('field.indexedSample', { number: i + 1 }), target);
    check(
      sample.height !== null && Number.isFinite(sample.height),
      msg('compiler.missingHeight', { number: i + 1 }),
      target,
    );
    const h = integer(quantize(sample.height * 10), INT_MIN, INT_MAX, msg('field.elevation'), target);
    check(
      !sourceHeights.has(position) || sourceHeights.get(position) === h,
      msg('compiler.conflictingSample', { number: i + 1 }),
      target,
    );
    sourceHeights.set(position, h);

    const current = positionsByBin.get(s);
    if (current === undefined) {
      positionsByBin.set(s, position);
      continue;
    }
    if (!precisionIssue && sourceHeights.get(current) !== h) {
      precisionIssue = new RteError(
        msg('compiler.precisionConflict', { number: i + 1, meters: s / 10 }),
        'invalid',
        target,
        true,
      );
    }
    const candidateRank = rank(position, s);
    const currentRank = rank(current, s);
    if (candidateRank < currentRank || (candidateRank === currentRank && position < current)) {
      positionsByBin.set(s, position);
    }
  }
  const levels = new Map(
    Array.from(positionsByBin, ([bin, position]) => [bin, sourceHeights.get(position)!]),
  );
  check(levels.has(0) && levels.has(total), msg('compiler.profileEndpoints'));
  const source = [...levels].sort((a, b) => a[0] - b[0]);
  let right = 1;
  for (const event of events) {
    const s = event.distance;
    if (!event.boundary || levels.has(s)) continue;
    while (source[right][0] < s) right++;
    const [lo, h0] = source[right - 1];
    const [hi, h1] = source[right];
    levels.set(s, quantize(h0 + ((h1 - h0) * (s - lo)) / (hi - lo)));
  }
  const elev: Elevation[] = [];
  for (const [s, h] of [...levels].sort((a, b) => a[0] - b[0])) {
    const prev = elev.at(-1);
    const delta = prev ? h - prev[1] : 0;
    elev.push([s, h, (prev?.[2] ?? 0) + Math.max(0, delta), (prev?.[3] ?? 0) + Math.max(0, -delta)]);
  }
  limit(geom.length <= MAX_NODES && elev.length <= MAX_NODES, msg('compiler.boundaryNodeLimit'));
  const meta: Metadata = {
    name: doc.name,
    total,
    reference: doc.elevationReference,
    events,
    declination: exportDeclination(doc),
    stages: summarize(events, elev),
  };
  verifyRoute(meta, geom, elev);
  return { geom, elev, meta, importedIndex, precisionIssue };
}

export interface RteWriteOptions {
  /** Allow distinct source samples to share one output node at device distance precision. */
  resampleElevation?: boolean;
}

export function validateForRte(doc: RouteDocument, options: RteWriteOptions = {}): void {
  const { precisionIssue } = compile(doc);
  if (precisionIssue && !options.resampleElevation) throw precisionIssue;
}

export function writeRte(doc: RouteDocument, options: RteWriteOptions = {}) {
  const { geom, elev, meta, importedIndex, precisionIssue } = compile(doc);
  const bytes = writeSections({
    META: writeCbor(writeMetadata(meta)),
    GEOM: pack(geom, geomLayout),
    ELEV: pack(elev, elevLayout),
    GIDX: pack(indexBlocks(geom, importedIndex), indexLayout),
  });
  // Only offer a retry after the complete resampled file passes all export checks.
  if (precisionIssue && !options.resampleElevation) throw precisionIssue;
  return bytes;
}
