import { msg } from './messages';
import { check, integer, LAT, LON, UINT, MAX_NODES, limit } from './check';

export interface MagneticDeclination {
  declinationCdeg: number;
  referenceLatE7: number;
  referenceLonE7: number;
  referenceDate: string;
  validFrom?: string;
  validUntil?: string;
}

/** Only imported, still-valid device-specific information; safe to serialize as JSON. */
export interface RteContext {
  distanceDm?: number[];
  indexBlockSizes?: number[];
  magneticDeclination?: MagneticDeclination;
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isoDate(value: unknown): string {
  check(
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000'),
    msg('declination.dateFormat'),
  );
  const day = new Date(value + 'T00:00:00.000Z');
  check(
    Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value,
    msg('declination.invalidDate'),
  );
  return value;
}

export function validateDeclination(input: unknown): asserts input is MagneticDeclination {
  check(record(input), msg('declination.invalidMetadata'));
  integer(input.declinationCdeg, -18000, 18000, msg('field.declination'));
  integer(input.referenceLatE7, -LAT, LAT, msg('field.magneticLatitude'));
  integer(input.referenceLonE7, -LON, LON - 1, msg('field.magneticLongitude'));
  const date = isoDate(input.referenceDate);
  if (input.validFrom !== undefined || input.validUntil !== undefined) {
    check(
      isoDate(input.validFrom) <= date && isoDate(input.validUntil) >= date,
      msg('declination.dateOutsideInterval'),
    );
  }
}

export function validateRteContext(input: unknown, vertexCount: number): asserts input is RteContext {
  check(record(input), msg('context.invalidContext'));
  const { distanceDm, indexBlockSizes, magneticDeclination } = input;
  if (distanceDm !== undefined) {
    check(
      Array.isArray(distanceDm) && distanceDm.length === vertexCount && vertexCount >= 2,
      msg('context.distanceCount'),
    );
    limit(vertexCount <= MAX_NODES, msg('context.vertexLimit'));
    let previous = -1;
    for (const value of distanceDm) {
      previous = integer(value, previous + 1, UINT, msg('field.referenceDistance'));
    }
    check(distanceDm[0] === 0, msg('context.distanceOrigin'));
  }
  if (indexBlockSizes !== undefined) {
    check(
      distanceDm !== undefined && Array.isArray(indexBlockSizes) && indexBlockSizes.length < vertexCount,
      msg('context.invalidIndex'),
    );
    let segments = 0;
    for (const count of indexBlockSizes)
      segments += integer(count, 2, 129, msg('field.indexBlockNodeCount')) - 1;
    check(segments === vertexCount - 1, msg('context.indexCoverage'));
  }
  if (magneticDeclination !== undefined) validateDeclination(magneticDeclination);
}
