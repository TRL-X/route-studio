import { msg, type RteText } from './messages';
import type { Value } from './cbor';
import { check, integer, INT_MIN, INT_MAX, LAT, LON, UINT, named } from './check';
import { validateDeclination, type MagneticDeclination } from './context';

export interface Event {
  id: number;
  name: string;
  label: string;
  kind: number;
  boundary: boolean;
  distance: number;
  lat: number;
  lon: number;
}
export type Stage = [from: number, to: number, min: number, max: number];
export interface Metadata {
  name: string;
  total: number;
  reference: 0 | 1 | 2;
  events: Event[];
  stages: Stage[];
  declination?: MagneticDeclination;
}

function fields(value: Value | undefined, last: number, label: RteText) {
  check(value instanceof Map, msg('validation.expectedMap', { label }));
  for (const key of value.keys())
    check(key <= last || key >= 128, msg('validation.reservedKey', { label, key }));
  return value;
}

function list(value: Value | undefined, min: number, max: number, label: RteText) {
  check(
    Array.isArray(value) && value.length >= min && value.length <= max,
    msg('validation.listLength', { label, min, max }),
  );
  return value;
}

export function readMetadata(input: Value): Metadata {
  const root = fields(input, 5, 'META');
  const total = integer(root.get(1), 1, UINT, msg('field.totalDistance'));
  const events = list(root.get(3), 2, 4096, msg('field.stations')).map((raw, i) => {
    const m = fields(raw, 7, msg('field.indexedStation', { number: i + 1 }));
    const boundary = m.get(4);
    check(typeof boundary === 'boolean', msg('meta.invalidBoundaryFlag'));
    return {
      id: integer(m.get(0), 1, UINT, msg('field.stationId')),
      name: named(m.get(1), 96, msg('field.stationName')),
      label: named(m.get(2), 16, msg('field.stationLabel')),
      kind: integer(m.get(3), 0, 3, msg('field.stationKind')),
      boundary,
      distance: integer(m.get(5), 0, total, msg('field.stationDistance')),
      lat: integer(m.get(6), -LAT, LAT, msg('field.stationLatitude')),
      lon: integer(m.get(7), -LON, LON - 1, msg('field.stationLongitude')),
    };
  });
  const stages = list(root.get(4), 1, 4095, msg('field.stages')).map((raw, i): Stage => {
    const m = fields(raw, 3, msg('field.indexedStage', { number: i + 1 }));
    return [
      integer(m.get(0), 1, UINT, msg('field.stageStartId')),
      integer(m.get(1), 1, UINT, msg('field.stageFinishId')),
      integer(m.get(2), INT_MIN, INT_MAX, msg('field.stageMinElevation')),
      integer(m.get(3), INT_MIN, INT_MAX, msg('field.stageMaxElevation')),
    ];
  });
  const result: Metadata = {
    name: named(root.get(0), 96, msg('field.routeName')),
    total,
    events,
    stages,
    reference: integer(root.get(2), 0, 2, msg('field.elevationReference')) as Metadata['reference'],
  };
  if (root.has(5)) {
    const m = fields(root.get(5), 5, msg('field.declination'));
    const info = {
      declinationCdeg: m.get(0),
      referenceLatE7: m.get(1),
      referenceLonE7: m.get(2),
      referenceDate: m.get(3),
      validFrom: m.get(4),
      validUntil: m.get(5),
    };
    validateDeclination(info);
    result.declination = info;
  }
  return result;
}

const mapFields = (...values: Value[]): Map<number, Value> =>
  new Map(values.map((value, key) => [key, value]));

export function writeMetadata(meta: Metadata) {
  const events = meta.events.map((e) =>
    mapFields(e.id, e.name, e.label, e.kind, e.boundary, e.distance, e.lat, e.lon),
  );
  const root = mapFields(
    meta.name,
    meta.total,
    meta.reference,
    events,
    meta.stages.map((stage) => mapFields(...stage)),
  );
  const info = meta.declination;
  if (info) {
    const map = mapFields(info.declinationCdeg, info.referenceLatE7, info.referenceLonE7, info.referenceDate);
    if (info.validFrom !== undefined && info.validUntil !== undefined) {
      map.set(4, info.validFrom);
      map.set(5, info.validUntil);
    }
    root.set(5, map);
  }
  return root;
}
