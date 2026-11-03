import FitParser, { type ParsedFit } from 'fit-file-parser';
import {
  anchorAtDistance,
  distances,
  newId,
  type Anchor,
  type Point,
  type RouteDocument,
} from '../domain/model';
import { stationPassages } from '../domain/projection';
import { RouteFileError } from './errors';
import { documentFromLine, mergeStationaryPoints, type RouteChoice, type TrackPoint } from './track';

type FitRecord = NonNullable<ParsedFit['records']>[number];
type CoursePoint = NonNullable<ParsedFit['course_points']>[number];
type TrackRecord = TrackPoint & { time?: number; distance?: number };

function position(record: FitRecord | CoursePoint): Point | undefined {
  const { position_lat: lat, position_long: lon } = record;
  if (lat === undefined || lon === undefined) return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    throw new RouteFileError('invalid-coordinates');
  return { lat, lon };
}

interface DistanceFix {
  distance: number;
  vertex: number;
}

// Use the recorder's distance scale, even when GPS geometry gives a different route length.
function distanceAnchor(
  doc: RouteDocument,
  axis: number[],
  fixes: DistanceFix[],
  distance: number,
): Anchor | null {
  let lo = 0,
    hi = fixes.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fixes[mid].distance < distance) lo = mid + 1;
    else hi = mid;
  }
  const right = fixes[lo];
  if (!right) return null;
  if (right.distance === distance) {
    // A distance plateau spanning different vertices does not identify a unique visit.
    for (let i = lo + 1; fixes[i]?.distance === distance; i++)
      if (fixes[i].vertex !== right.vertex) return null;
    return { vertexId: doc.vertices[right.vertex].id, fraction: 0 };
  }
  const left = fixes[lo - 1];
  if (!left) return null;
  const fraction = (distance - left.distance) / (right.distance - left.distance);
  return anchorAtDistance(doc, axis[left.vertex] + fraction * (axis[right.vertex] - axis[left.vertex]), axis);
}

function addCoursePoints(
  doc: RouteDocument,
  records: TrackRecord[],
  indices: number[],
  marks: CoursePoint[],
) {
  const axis = distances(doc.vertices);
  const timestamps = new Map<number, number | null>();
  const fixes: DistanceFix[] = [];
  for (const [i, record] of records.entries()) {
    const vertex = indices[i];
    if (record.distance !== undefined) fixes.push({ distance: record.distance, vertex });
    if (record.time !== undefined) {
      const previous = timestamps.get(record.time);
      timestamps.set(record.time, previous === undefined || previous === vertex ? vertex : null);
    }
  }
  const monotonic = fixes.every((fix, i) => i === 0 || fix.distance >= fixes[i - 1].distance);
  const [start, finish] = doc.stations;
  doc.stations = [start];
  const namedEndpoints = new Set<string>();
  for (const [i, mark] of marks.entries()) {
    const location = position(mark);
    const vertex = mark.timestamp && timestamps.get(mark.timestamp.getTime());
    let anchor: Anchor | null = vertex != null ? { vertexId: doc.vertices[vertex].id, fraction: 0 } : null;
    if (!anchor && mark.distance !== undefined && monotonic) {
      if (fixes.length) anchor = distanceAnchor(doc, axis, fixes, mark.distance);
      else if (mark.distance >= 0 && mark.distance <= axis[axis.length - 1])
        anchor = anchorAtDistance(doc, mark.distance, axis);
    }
    if (!anchor && location) {
      const passes = stationPassages(doc, location, axis);
      if (passes.length === 1) anchor = passes[0].anchor;
    }
    // A whole-course segment cue at the matching endpoint supplies its name and landmark.
    const endpoint = mark.type === 'segment_start' ? start : mark.type === 'segment_end' ? finish : undefined;
    if (
      endpoint &&
      anchor?.fraction === 0 &&
      anchor.vertexId === endpoint.anchor?.vertexId &&
      !namedEndpoints.has(endpoint.id)
    ) {
      endpoint.name = mark.name?.trim() || endpoint.name;
      endpoint.location = location;
      namedEndpoints.add(endpoint.id);
      continue;
    }
    const checkpoint = mark.type === 'checkpoint';
    const label =
      typeof mark.type === 'string' && mark.type !== 'generic' ? mark.type.replaceAll('_', ' ') : 'POI';
    doc.stations.push({
      id: newId(),
      name: mark.name?.trim() || `${label} ${i + 1}`,
      kind: checkpoint ? 'cp' : 'poi',
      boundary: checkpoint,
      location,
      anchor,
    });
  }
  doc.stations.push(finish);
}

function trackChoice(name: string, records: TrackRecord[], marks: CoursePoint[] = []): RouteChoice {
  const indices: number[] = [];
  const points = mergeStationaryPoints(records, marks.length ? indices : undefined);
  return {
    name,
    pointCount: points.length,
    hasUnconfirmedHeights: false,
    open() {
      const doc = documentFromLine({ name, points, heights: 'unknown-reference' });
      if (marks.length) addCoursePoints(doc, records, indices, marks);
      return doc;
    },
  };
}

export async function parseFitRoutes(bytes: ArrayBuffer, filename: string): Promise<RouteChoice[]> {
  let fit: ParsedFit;
  try {
    const parser = new FitParser({ strict: true, force: false, lengthUnit: 'm' });
    fit = await parser.parseAsync(bytes);
  } catch {
    throw new RouteFileError('invalid-fit');
  }
  const type = fit.file_ids?.[0]?.type;
  if (type === undefined) throw new RouteFileError('invalid-fit');
  if (type !== 'course' && type !== 'activity') throw new RouteFileError('unsupported-fit-type');
  const name = fit.course?.name?.trim() || filename.replace(/\.fit$/i, '') || filename;
  const records: TrackRecord[] = [];
  for (const record of fit.records ?? []) {
    const point = position(record);
    if (point)
      records.push({
        ...point,
        height: record.enhanced_altitude ?? record.altitude ?? null,
        time: record.timestamp?.getTime(),
        distance: record.distance,
      });
  }
  if (!records.length) throw new RouteFileError('fit-no-gps');
  if (type === 'course') return [trackChoice(name, records, fit.course_points)];
  if (!fit.sessions || fit.sessions.length <= 1) return [trackChoice(name, records)];

  // Session summaries can precede or follow the records. At a shared boundary the
  // record belongs to the session that starts there, so no point is offered twice.
  const sessions = fit.sessions
    .map((session) => {
      const start = session.start_time?.getTime(),
        end = session.timestamp?.getTime();
      if (start === undefined || end === undefined || end < start) throw new RouteFileError('invalid-fit');
      return { start, end, sport: session.sport };
    })
    .sort((a, b) => a.start - b.start);
  const choices = sessions.flatMap(({ start, end, sport }, i) => {
    const next = sessions[i + 1]?.start ?? Infinity;
    const group = records.filter(
      ({ time }) => time !== undefined && time >= start && time <= end && time < next,
    );
    const label = typeof sport === 'string' ? ' · ' + sport : '';
    return group.length ? [trackChoice(`${name} · ${i + 1}${label}`, group)] : [];
  });
  if (!choices.length) throw new RouteFileError('fit-no-gps');
  return choices;
}
