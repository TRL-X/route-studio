import { FitBaseType, FitEncoder, type FitEncoderField } from 'fit-file-parser/encoder';
import { RouteFileError } from './errors';
import type { ExportPoint, ExportStation } from './export';

const { Enum, Uint16, Uint32, Uint32z, Sint32 } = FitBaseType;
function field(number: number, baseType: FitBaseType, value: number): FitEncoderField {
  return { number, baseType, size: baseType === Enum ? 1 : baseType === Uint16 ? 2 : 4, value };
}
function text(number: number, label: string): FitEncoderField {
  if (label.includes('\0') || new TextEncoder().encode(label).length > 254)
    throw new RouteFileError('fit-export-name');
  const value = FitEncoder.string(label);
  return { number, baseType: FitBaseType.String, size: value.length, value };
}
function semicircles(degrees: number) {
  const raw = Math.round(degrees * (2 ** 31 / 180));
  // INT32_MAX is the FIT invalid sentinel. Both sides of the dateline denote the same meridian.
  return raw >= 0x7fffffff ? -0x80000000 : raw;
}
function centimeters(point: ExportPoint) {
  const raw = Math.round(point.distance * 100);
  if (raw >= 0xffffffff) throw new RouteFileError('fit-export-range');
  return raw;
}
function altitude(point: ExportPoint): FitEncoderField[] {
  if (point.height === null) return [];
  const raw = Math.round((point.height + 500) * 5);
  if (raw < 0 || raw >= 0xffffffff) throw new RouteFileError('fit-export-range');
  return raw < 0xffff ? [field(2, Uint16, raw)] : [field(78, Uint32, raw)];
}

export function writeFitCourse(name: string, points: ExportPoint[], stations: ExportStation[]) {
  const encoder = new FitEncoder({ protocolVersion: 0x20 });
  const start = FitEncoder.toFitTimestamp(new Date());
  const last = points[points.length - 1],
    first = points[0];
  // RouteDocument has no activity clock. A one-second step gives every visit a distinct timestamp.
  const duration = points.length - 1,
    end = start + duration;
  if (duration * 1000 >= 0xffffffff || end >= 0xffffffff) throw new RouteFileError('fit-export-range');
  const serial = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  encoder.writeMessage(0, [
    field(0, Enum, 6),
    field(1, Uint16, 255),
    field(2, Uint16, 0),
    field(3, Uint32z, serial),
    field(4, Uint32, start),
  ]);
  encoder.writeMessage(31, [text(5, name || 'Route'), field(4, Enum, 0)]);
  encoder.writeMessage(19, [
    field(2, Uint32, start),
    field(253, Uint32, end),
    field(3, Sint32, semicircles(first.lat)),
    field(4, Sint32, semicircles(first.lon)),
    field(5, Sint32, semicircles(last.lat)),
    field(6, Sint32, semicircles(last.lon)),
    field(7, Uint32, duration * 1000),
    field(8, Uint32, duration * 1000),
    field(9, Uint32, centimeters(last)),
  ]);
  function timer(time: number, type: number) {
    encoder.writeMessage(21, [field(253, Uint32, time), field(0, Enum, 0), field(1, Enum, type)], 1);
  }
  timer(start, 0);
  const times = new Map<ExportPoint, number>();
  for (const [i, point] of points.entries()) {
    times.set(point, start + i);
    encoder.writeMessage(
      20,
      [
        field(253, Uint32, start + i),
        field(0, Sint32, semicircles(point.lat)),
        field(1, Sint32, semicircles(point.lon)),
        field(5, Uint32, centimeters(point)),
        ...altitude(point),
      ],
      2,
    );
  }
  const types = { start: 24, finish: 25, cp: 35, poi: 0 }; // segment_start, segment_end, checkpoint, generic
  const cues = stations
    .map((s) => ({ station: s, time: times.get(s.record!)! }))
    .sort((a, b) => a.time - b.time);
  for (const { station, time } of cues) {
    encoder.writeMessage(
      32,
      [
        field(1, Uint32, time),
        field(4, Uint32, centimeters(station.record!)),
        field(2, Sint32, semicircles(station.location.lat)),
        field(3, Sint32, semicircles(station.location.lon)),
        field(5, Enum, types[station.kind]),
        text(6, station.name),
      ],
      3,
    );
  }
  timer(end, 9);
  return Uint8Array.from(encoder.close());
}
