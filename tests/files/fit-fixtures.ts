import { FitEncoder, FitBaseType, type FitEncoderField } from 'fit-file-parser/encoder';

const { Enum, Sint32, Uint16, Uint32, String: StringType } = FitBaseType;
function field(number: number, baseType: FitBaseType, value: number): FitEncoderField {
  const size = baseType === Enum ? 1 : baseType === Uint16 ? 2 : 4;
  return { number, baseType, size, value };
}
function name(number: number, text: string): FitEncoderField {
  const value = FitEncoder.string(text);
  return { number, baseType: StringType, size: value.length, value };
}
export function file(type: number) {
  const encoder = new FitEncoder({ protocolVersion: 0x20 });
  return encoder.writeMessage(0, [field(0, Enum, type)]);
}
const epoch = 1_000_000_000;
const semi = (degrees: number) => Math.round(degrees * (2 ** 31 / 180));
const timestamp = (number: number, offset: number) => field(number, Uint32, epoch + offset);

export function multisportActivity({
  summaryTime,
  omitElapsedTime = false,
  omitSport = false,
}: { summaryTime?: number; omitElapsedTime?: boolean; omitSport?: boolean } = {}): Uint8Array {
  const encoder = file(4);
  const session = (start: number, end: number, sport: number) =>
    encoder.writeMessage(18, [
      timestamp(2, start),
      timestamp(253, summaryTime ?? end),
      ...(omitSport ? [] : [field(5, Enum, sport)]),
      ...(omitElapsedTime ? [] : [field(7, Uint32, (end - start) * 1000)]),
    ]);
  // Some devices write the summaries first. A shared timestamp belongs to the new session.
  session(10, 20, 2);
  session(0, 10, 1);
  for (const [time, lat] of [
    [-1, -0.01],
    [0, 0],
    [4, 0.01],
    [10, 2],
    [20, 2.01],
    [21, 2.02],
  ]) {
    encoder.writeMessage(20, [timestamp(253, time), field(0, Sint32, semi(lat)), field(1, Sint32, 0)]);
  }
  return encoder.close();
}

export function indoorActivity() {
  return file(4)
    .writeMessage(20, [timestamp(253, 1), field(0, Sint32, 0x7fffffff), field(1, Sint32, 0)])
    .close();
}

export function outAndBackCourse(): Uint8Array {
  const encoder = file(6);
  encoder.writeMessage(31, [name(5, '山脊')]);
  for (const [time, lon, distance, altitude, enhanced] of [
    [0, 0, 0, 2500, 0xffffffff],
    [1, 1, 100, 2510, 2550],
    [2, 1, 100, 2550, 0xffffffff],
    [3, 0, 250, 0xffff, 0xffffffff],
  ]) {
    encoder.writeMessage(20, [
      timestamp(253, time),
      field(0, Sint32, 0),
      field(1, Sint32, semi(lon)),
      field(5, Uint32, distance * 100),
      field(2, Uint16, altitude),
      field(78, Uint32, enhanced),
    ]);
  }
  encoder.writeMessage(32, [
    timestamp(1, 2),
    name(6, 'Turnaround'),
    field(2, Sint32, semi(-0.01)),
    field(3, Sint32, semi(1)),
  ]);
  encoder.writeMessage(32, [field(4, Uint32, 17500), field(5, Enum, 35), name(6, '返回 CP')]);
  encoder.writeMessage(32, [field(2, Sint32, 0), field(3, Sint32, semi(0.5)), name(6, 'Both visits')]);
  return encoder.close();
}
