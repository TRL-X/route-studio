import {
  anchorAtDistance,
  anchorPoint,
  distances,
  type DeclinationSettings,
  type ManualDeclination,
  type RouteDocument,
} from './model';
import { check, LON, quantize } from '../rte/check';
import { validateDeclination, type MagneticDeclination } from '../rte/context';
import { msg } from '../rte/messages';

export type Reference = Pick<MagneticDeclination, 'referenceLatE7' | 'referenceLonE7' | 'referenceDate'>;

// Shift the decimal exponent before rounding. Multiplying a decimal half-step
// such as 1.005 by 100 in binary can turn it into 100.49999999999999.
export function centidegrees(degrees: number) {
  const [mantissa, exponent = '0'] = String(degrees).split('e');
  return quantize(Number(mantissa + 'e' + (Number(exponent) + 2)));
}

function longitudeE7(degrees: number) {
  const lon = quantize(degrees * 1e7);
  return lon === LON ? -LON : lon;
}

export function midpointReference(doc: RouteDocument, date: string): Reference | undefined {
  const axis = doc.rte?.distanceDm ?? distances(doc.vertices);
  const total = axis.at(-1);
  if (!total || doc.vertices.length < 2) return undefined;
  const point = anchorPoint(doc, anchorAtDistance(doc, total / 2, axis));
  return {
    referenceLatE7: quantize(point.lat * 1e7),
    referenceLonE7: longitudeE7(point.lon),
    referenceDate: date,
  };
}

export function supportedLookupDate(date: string) {
  return (
    date >= '2025-01-01' &&
    date <= '2029-12-31' &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    new Date(date + 'T00:00:00Z').toJSON()?.slice(0, 10) === date
  );
}

export function sameReference(a?: Reference, b?: Reference) {
  return (
    !!a &&
    !!b &&
    a.referenceDate === b.referenceDate &&
    a.referenceLatE7 === b.referenceLatE7 &&
    a.referenceLonE7 === b.referenceLonE7
  );
}

export function manualDeclination(reference?: Reference & Partial<MagneticDeclination>): ManualDeclination {
  return {
    mode: 'manual',
    degrees: reference?.declinationCdeg === undefined ? null : reference.declinationCdeg / 100,
    lat: reference ? reference.referenceLatE7 / 1e7 : null,
    lon: reference ? reference.referenceLonE7 / 1e7 : null,
    date: reference?.referenceDate ?? new Date().toISOString().slice(0, 10),
    validFrom: reference?.validFrom ?? '',
    validUntil: reference?.validUntil ?? '',
  };
}

// Older projects and imported RTEs have only the optional wire metadata.
export function declinationSettings(doc: RouteDocument): DeclinationSettings {
  if (doc.declination) return doc.declination;
  const info = doc.rte?.magneticDeclination;
  return info ? manualDeclination(info) : { mode: 'omit' };
}

export function withDeclination(doc: RouteDocument, declination: DeclinationSettings): RouteDocument {
  if (!doc.rte?.magneticDeclination) return { ...doc, declination };
  const rte = { ...doc.rte };
  delete rte.magneticDeclination;
  return { ...doc, rte, declination };
}

export function manualMetadata(fields: ManualDeclination): MagneticDeclination {
  const { degrees, lat, lon } = fields;
  check(
    degrees !== null &&
      Math.abs(degrees) <= 180 &&
      lat !== null &&
      Math.abs(lat) <= 90 &&
      lon !== null &&
      Math.abs(lon) <= 180,
    msg('declination.manualFields'),
  );
  const info = {
    declinationCdeg: centidegrees(degrees),
    referenceLatE7: quantize(lat * 1e7),
    referenceLonE7: longitudeE7(lon),
    referenceDate: fields.date,
    validFrom: fields.validFrom || undefined,
    validUntil: fields.validUntil || undefined,
  };
  validateDeclination(info);
  return info;
}

export function exportDeclination(doc: RouteDocument): MagneticDeclination | undefined {
  const settings = doc.declination;
  if (!settings) return doc.rte?.magneticDeclination;
  if (settings.mode === 'omit') return undefined;
  if (settings.mode === 'manual') return manualMetadata(settings);
  check(
    supportedLookupDate(settings.date) &&
      settings.result &&
      sameReference(settings.result, midpointReference(doc, settings.date)),
    msg('declination.lookupRequired'),
  );
  validateDeclination(settings.result);
  return settings.result;
}
