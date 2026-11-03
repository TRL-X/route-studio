import { msg } from './messages';
// Header and section framing, TRL-X Route initial edition §§3–4, 8–10.
import { check, limit, MAX_NODES, RteError } from './check';

type SectionType = 'META' | 'GEOM' | 'ELEV' | 'GIDX';
export type Sections = Record<SectionType, Uint8Array>;
const sizes = new Map<SectionType, number>([
  ['META', 0],
  ['GEOM', 12],
  ['ELEV', 16],
  ['GIDX', 32],
]);
const aligned = (offset: number) => Math.ceil(offset / 4) * 4;
const maxFile = 64 * 1024 * 1024;
export const viewOf = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const table = new Uint32Array(256);
for (let n = 0; n < table.length; n++) {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  table[n] = crc;
}

export function fileCrc(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = i >= 14 && i < 18 ? 0 : data[i];
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readSections(data: Uint8Array): Sections {
  limit(data.length <= maxFile, msg('wire.fileLimit'));
  check(data.length >= 18, msg('wire.truncatedHeader'));
  const view = viewOf(data);
  check(view.getUint32(0) === 0x41525254, msg('wire.invalidSignature'));
  if (view.getUint16(4, true) !== 1) throw new RteError(msg('wire.unsupportedVersion'), 'unsupported');
  const count = view.getUint16(12, true);
  limit(count <= 256, msg('wire.sectionLimit'));
  let end = 18 + 22 * count;
  check(
    count >= 4 && end <= data.length && view.getUint32(8, true) === data.length,
    msg('wire.invalidLength'),
  );
  check(view.getUint32(14, true) === fileCrc(data), msg('wire.checksum'));
  const seen = new Set<string>();
  const sections: Partial<Sections> = {};
  for (let entry = 18; entry < 18 + 22 * count; entry += 22) {
    const kind = String.fromCharCode(...data.subarray(entry, entry + 4));
    check(/^[A-Z0-9]{4}$/.test(kind) && !seen.has(kind), msg('wire.invalidSectionType'));
    seen.add(kind);
    const flags = view.getUint16(entry + 4, true);
    const offset = view.getUint32(entry + 6, true);
    const length = view.getUint32(entry + 10, true);
    const width = view.getUint32(entry + 14, true);
    const records = view.getUint32(entry + 18, true);
    check(
      flags <= 1 && offset === aligned(end) && length > 0 && offset + length <= data.length,
      msg('wire.invalidSection'),
    );
    check(
      data.subarray(end, offset).every((byte) => byte === 0),
      msg('wire.nonzeroPadding'),
    );
    check(width === 0 ? records === 0 : width * records === length, msg('wire.recordSizeMismatch'));
    end = offset + length;
    const type = kind as SectionType;
    if (!sizes.has(type)) {
      if (flags === 1) throw new RteError(msg('wire.criticalSection', { kind }), 'unsupported');
      continue;
    }
    check(flags === 1 && width === sizes.get(type), msg('wire.requiredSectionLayout'));
    limit(records <= MAX_NODES, msg('wire.recordLimit'));
    sections[type] = data.subarray(offset, end);
  }
  check(end === data.length && Object.keys(sections).length === 4, msg('wire.requiredSections'));
  return sections as Sections;
}

export function writeSections(sections: Sections) {
  const entries = [...sizes];
  let size = 18 + entries.length * 22;
  for (const [type] of entries) size = aligned(size) + sections[type].length;
  limit(size <= maxFile, msg('wire.fileLimit'));
  const data = new Uint8Array(size);
  const view = viewOf(data);
  view.setUint32(0, 0x41525254);
  view.setUint16(4, 1, true);
  view.setUint32(8, size, true);
  view.setUint16(12, entries.length, true);
  let end = 18 + entries.length * 22;
  for (const [i, [type, width]] of entries.entries()) {
    const start = aligned(end);
    const bytes = sections[type];
    const offset = 18 + i * 22;
    data.set(new TextEncoder().encode(type), offset);
    view.setUint16(offset + 4, 1, true);
    for (const [k, value] of [start, bytes.length, width, width ? bytes.length / width : 0].entries()) {
      view.setUint32(offset + 6 + 4 * k, value, true);
    }
    data.set(bytes, start);
    end = start + bytes.length;
  }
  view.setUint32(14, fileCrc(data), true);
  return data;
}
