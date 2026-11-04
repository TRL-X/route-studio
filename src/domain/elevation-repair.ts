import { limit, MAX_NODES } from '../rte/check';
import { msg } from '../rte/messages';
import { interpolateMissingHeights } from './elevation';
import { distances, type RouteDocument } from './model';
import { planTerrain } from './terrain';
import { localDifferenceSections, type ProfileReading } from './terrain-comparison';

const flatLengthM = 500;
const maxFlatSampleSpacingM = 500;

export interface RepairSection {
  kind: 'gap' | 'flat' | 'suspect' | 'uncovered';
  startM: number;
  endM: number;
}

interface Level {
  distance: number;
  /** NaN means multiple heights at this same route position disagree. */
  observed: number | null;
  missing: boolean;
}

function section(kind: RepairSection['kind'], startM: number, endM: number): RepairSection {
  return { kind, startM, endM };
}

/** Sort recorded samples once for both attention markers and terrain comparison. */
function originalReadings(doc: RouteDocument): ProfileReading[] {
  const { vertices, elevation } = doc;
  limit(vertices.length <= MAX_NODES && elevation.length <= MAX_NODES, msg('compiler.nodeLimit'));
  const axis = distances(vertices);
  const indices = new Map(vertices.map((v, i) => [v.id, i]));
  const samples = elevation
    .map(({ anchor, height }) => {
      const i = indices.get(anchor.vertexId)!;
      const left = axis[i],
        right = axis[i + 1] ?? left;
      return { distance: anchor.fraction === 1 ? right : left + (right - left) * anchor.fraction, height };
    })
    .sort((a, b) => a.distance - b.distance);
  if (axis.length) {
    if (samples[0]?.distance !== 0) samples.unshift({ distance: 0, height: null });
    const finish = axis[axis.length - 1];
    if (samples.at(-1)!.distance !== finish) samples.push({ distance: finish, height: null });
  }
  return samples;
}

function originalLevels(samples: readonly ProfileReading[]) {
  const levels: Level[] = [];
  for (const { distance, height } of samples) {
    let level = levels.at(-1);
    if (!level || level.distance !== distance) {
      level = { distance, observed: null, missing: false };
      levels.push(level);
    }
    if (height === null) level.missing = true;
    else level.observed = level.observed === null || level.observed === height ? height : NaN;
  }
  return levels;
}

function gapSections(levels: readonly Level[]) {
  const gaps: RepairSection[] = [];
  for (let first = 0; first < levels.length;) {
    const observed = levels[first].observed !== null;
    let last = first;
    if (!observed) {
      while (last + 1 < levels.length && levels[last + 1].observed === null) last++;
    }
    if (!observed || levels[first].missing) {
      const left = observed ? first : Math.max(0, first - 1);
      const right = observed ? last : Math.min(levels.length - 1, last + 1);
      gaps.push(section('gap', levels[left].distance, levels[right].distance));
    }
    first = last + 1;
  }
  return gaps;
}

function flatSections(levels: readonly Level[]) {
  const flats: RepairSection[] = [];
  for (let first = 0; first < levels.length;) {
    const level = levels[first];
    let last = first;
    if (!level.missing && Number.isFinite(level.observed)) {
      while (
        last + 1 < levels.length &&
        !levels[last + 1].missing &&
        levels[last + 1].observed === level.observed &&
        levels[last + 1].distance - levels[last].distance <= maxFlatSampleSpacingM
      )
        last++;
    }
    if (last - first >= 2 && levels[last].distance - level.distance >= flatLengthM) {
      flats.push(section('flat', level.distance, levels[last].distance));
    }
    first = last + 1;
  }
  return flats;
}

/** Read-only preview. The document for confirmation exists only when every query is covered. */
export function planFullTerrain(doc: RouteDocument) {
  const samples = originalReadings(doc);
  const original = originalLevels(samples);
  const sections = [...gapSections(original), ...flatSections(original)].sort((a, b) => a.startM - b.startM);
  const compareLocal = doc.elevationReference !== 2 && original.some((level) => level.observed !== null);
  const plan = planTerrain(doc);
  const { points, queryDistances } = plan;
  function preview(values: readonly (number | null)[]) {
    if (values.length !== points.length) throw new RangeError('Unexpected terrain sample count.');
    let missing = 0;
    const readings = queryDistances.map((distance, i) => {
      const height = Number.isFinite(values[i]) ? values[i] : null;
      if (height === null) missing++;
      return { distance, height };
    });
    const attention = [...sections];
    for (let i = 0; i < readings.length; i++) {
      if (readings[i].height !== null) continue;
      const first = i;
      while (i + 1 < readings.length && readings[i + 1].height === null) i++;
      attention.push(section('uncovered', readings[first].distance, readings[i].distance));
    }

    // Only departures from the typical offset indicate local differences in profile shape.
    // Ellipsoid heights need a geoid conversion to compare with EGM2008 at all.
    if (compareLocal) {
      for (const span of localDifferenceSections(samples, readings)) {
        attention.push(section('suspect', span.startM, span.endM));
      }
    }
    return {
      document: points.length && !missing ? plan.apply(values) : null,
      missing,
      readings,
      sections: attention.sort((a, b) => a.startM - b.startM || a.endM - b.endM),
    };
  }
  return { points, original: samples, sections, preview };
}

/** Fill short gaps locally and identify any stretches that still need terrain data. */
export function fillShortElevationGaps(doc: RouteDocument) {
  const original = gapSections(originalLevels(originalReadings(doc)));
  const { document } = interpolateMissingHeights(doc);
  const remaining = document === doc ? original : gapSections(originalLevels(originalReadings(document)));
  return { document, filled: original.length - remaining.length, remaining };
}

export interface ImportElevationAssessment {
  recommendation: 'fill' | 'replace';
  gaps: number;
  fillableGaps: number;
  hasKnownHeights: boolean;
}

/** Diagnose imports with the same rules as local repair, without changing the imported profile. */
export function assessImportedElevation(doc: RouteDocument): ImportElevationAssessment | null {
  if (doc.vertices.length < 2) return null;
  const { filled, remaining } = fillShortElevationGaps(doc);
  const gaps = filled + remaining.length;
  if (!gaps) return null;
  return {
    recommendation: remaining.length ? 'replace' : 'fill',
    gaps,
    fillableGaps: filled,
    hasKnownHeights: doc.elevation.some((sample) => sample.height !== null),
  };
}
