import { msg } from './messages';
import { check, integer, UINT, INT_MIN, INT_MAX, LAT, LON } from './check';
import type { Event, Metadata, Stage } from './meta';
import { viewOf } from './wire';

export type Geometry = [lat: number, lon: number, distance: number];
export type Elevation = [distance: number, height: number, up: number, down: number];

/** Record schemas give column signedness, in on-disk field order. */
export const geomLayout = [true, true, false];
export const elevLayout = [false, true, false, false];
export const indexLayout = [false, false, false, false, true, true, true, true];

export function unpack(data: Uint8Array, signed: boolean[]) {
  const view = viewOf(data);
  const width = signed.length * 4;
  return Array.from({ length: data.length / width }, (_, row) =>
    signed.map((useSign, col) => {
      const offset = row * width + col * 4;
      return useSign ? view.getInt32(offset, true) : view.getUint32(offset, true);
    }),
  );
}

export function pack(rows: number[][], signed: boolean[]) {
  const bytes = new Uint8Array(rows.length * signed.length * 4);
  const view = viewOf(bytes);
  let offset = 0;
  for (const row of rows) {
    for (const [col, value] of row.entries()) {
      if (signed[col]) view.setInt32(offset, integer(value, INT_MIN, INT_MAX, 'RTE i32'), true);
      else view.setUint32(offset, integer(value, 0, UINT, 'RTE u32'), true);
      offset += 4;
    }
  }
  return bytes;
}

export function indexBlocks(geom: Geometry[], blockSizes?: number[]) {
  const rows: number[][] = [];
  let first = 0;
  while (first < geom.length - 1) {
    const count = blockSizes ? blockSizes[rows.length] : Math.min(129, geom.length - first);
    check(
      Number.isInteger(count) && count >= 2 && count <= 129 && first + count <= geom.length,
      msg('index.segmentCoverage'),
    );
    const nodes = geom.slice(first, first + count);
    const lats = nodes.map((v) => v[0]);
    const lons = nodes.map((v) => v[1]);
    const wraps = lons.some((lon, i) => i > 0 && Math.abs(lon - lons[i - 1]) > LON);
    rows.push([
      first,
      count,
      nodes[0][2],
      nodes[count - 1][2],
      Math.min(...lats),
      Math.max(...lats),
      wraps ? -LON : Math.min(...lons),
      wraps ? LON : Math.max(...lons),
    ]);
    first += count - 1;
  }
  check(!blockSizes || blockSizes.length === rows.length, msg('index.extraBlocks'));
  return rows;
}

export function summarize(events: Event[], profile: Elevation[]): Stage[] {
  const stages: Stage[] = [];
  const boundaries = events.filter((e) => e.boundary);
  let index = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const from = boundaries[i - 1];
    const to = boundaries[i];
    check(from.distance < to.distance, msg('record.boundaryDistanceOrder'));
    let low = profile[index][1];
    let high = low;
    while (index + 1 < profile.length && profile[index + 1][0] <= to.distance) {
      const height = profile[++index][1];
      low = Math.min(low, height);
      high = Math.max(high, height);
    }
    check(profile[index][0] === to.distance, msg('record.missingBoundaryElevation'));
    stages.push([from.id, to.id, low, high]);
  }
  return stages;
}

export function verifyRoute(meta: Metadata, geom: Geometry[], elev: Elevation[]) {
  check(geom.length >= 2 && elev.length >= 2, msg('record.nodesRequired'));
  check(
    geom[0][2] === 0 && elev[0][0] === 0 && geom.at(-1)![2] === meta.total && elev.at(-1)![0] === meta.total,
    msg('record.endpointMismatch'),
  );
  const geometryDistances = new Set<number>();
  for (const [i, [lat, lon, s]] of geom.entries()) {
    integer(lat, -LAT, LAT, msg('field.latitude'));
    integer(lon, -LON, LON - 1, msg('field.longitude'));
    if (i > 0)
      check(
        s > geom[i - 1][2] && (lat !== geom[i - 1][0] || lon !== geom[i - 1][1]),
        msg('record.coincidentVertex', { number: i + 1 }),
      );
    geometryDistances.add(s);
  }
  let up = 0;
  let down = 0;
  const elevationDistances = new Set<number>();
  for (const [i, [s, h, u, d]] of elev.entries()) {
    if (i > 0) {
      check(s > elev[i - 1][0], msg('record.elevationDistanceOrder'));
      const delta = h - elev[i - 1][1];
      up += Math.max(delta, 0);
      down += Math.max(-delta, 0);
    }
    check(u === up && d === down && up <= UINT && down <= UINT, msg('record.invalidAscent'));
    elevationDistances.add(s);
  }
  const { events } = meta;
  const ids = new Set<number>();
  for (const [i, e] of events.entries()) {
    if (i === 0) check(e.kind === 0 && e.distance === 0 && e.boundary, msg('record.startPlacement'));
    else if (i === events.length - 1)
      check(e.kind === 1 && e.distance === meta.total && e.boundary, msg('record.finishPlacement'));
    else check(e.kind === 2 || e.kind === 3, msg('record.startFinishCount'));
    if (i > 0)
      check(
        e.distance > events[i - 1].distance ||
          (e.distance === events[i - 1].distance && e.id > events[i - 1].id),
        msg('record.stationOrder'),
      );
    check(!ids.has(e.id), msg('validation.duplicateStationId'));
    ids.add(e.id);
    if (e.boundary)
      check(
        geometryDistances.has(e.distance) && elevationDistances.has(e.distance),
        msg('record.missingBoundaryNode'),
      );
  }
  const stages = summarize(events, elev);
  check(sameRows(stages, meta.stages), msg('record.stageSummaryMismatch'));
}

export const sameRows = (a: number[][], b: number[][]) =>
  a.length === b.length &&
  a.every((row, i) => row.length === b[i].length && row.every((v, j) => v === b[i][j]));
