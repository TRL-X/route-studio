import { msg } from './messages';
import { RteError, check, integer, INT_MIN, UINT, limit } from './check';

export type Value = null | boolean | number | string | Uint8Array | Value[] | Map<number, Value>;
const MAX_META_BYTES = 8 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Decode a single item under the restricted V1 META deterministic CBOR profile. */
export function readCbor(data: Uint8Array): Value {
  limit(data.length <= MAX_META_BYTES, msg('cbor.byteLimit'));
  let position = 0;
  let budget = 250_000;

  function byte() {
    check(position < data.length, msg('cbor.truncatedItem'));
    return data[position++];
  }

  function item(depth: number): Value {
    limit(--budget >= 0 && depth <= 24, msg('cbor.nestingLimit'));
    const header = byte();
    const type = header >>> 5;
    const extra = header & 31;
    if (type === 7) {
      check(extra === 20 || extra === 21 || extra === 22, msg('cbor.invalidSimpleValue'));
      return extra === 22 ? null : extra === 21;
    }
    check(type <= 5 && extra <= 26, msg('cbor.invalidHeader'));
    let size = extra;
    if (extra >= 24) {
      size = 0;
      const width = 1 << (extra - 24);
      for (let i = 0; i < width; i++) size = size * 256 + byte();
      check(size >= [24, 256, 65536][extra - 24], msg('cbor.nonMinimalEncoding'));
    }
    if (type === 0) return size;
    if (type === 1) return integer(-size - 1, INT_MIN, -1, msg('field.negativeInteger'));
    if (type === 2 || type === 3) {
      check(
        size <= (type === 2 ? 1024 : 512) && size <= data.length - position,
        msg('cbor.invalidStringLength'),
      );
      const bytes = data.subarray(position, (position += size));
      if (type === 2) return bytes;
      let value: string;
      try {
        value = utf8.decode(bytes);
      } catch {
        throw new RteError(msg('cbor.invalidUtf8'));
      }
      check(!value.includes('\0'), msg('cbor.nullText'));
      return value;
    }
    limit(size <= budget, msg('cbor.containerLimit'));
    if (type === 4) return Array.from({ length: size }, () => item(depth + 1));
    const result = new Map<number, Value>();
    let previous = -1;
    for (let i = 0; i < size; i++) {
      const key = integer(item(depth + 1), previous + 1, 65535, msg('field.metaMapKey'));
      result.set(key, item(depth + 1));
      previous = key;
    }
    return result;
  }

  const value = item(0);
  check(position === data.length, msg('cbor.trailingData'));
  return value;
}

/** The writer only receives validated, known META values. No extension data is emitted. */
export function writeCbor(root: Value): Uint8Array {
  const bytes: number[] = [];
  function header(type: number, n: number) {
    integer(n, 0, UINT, msg('field.cborIntegerOrLength'));
    if (n < 24) {
      bytes.push(type * 32 + n);
      return;
    }
    const width = n < 256 ? 1 : n < 65536 ? 2 : 4;
    bytes.push(type * 32 + (width === 1 ? 24 : width === 2 ? 25 : 26));
    for (let shift = 8 * (width - 1); shift >= 0; shift -= 8) bytes.push((n >>> shift) & 255);
  }
  const encoder = new TextEncoder();
  function append(value: Value) {
    if (typeof value === 'number') header(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
    else if (typeof value === 'string' || value instanceof Uint8Array) {
      const raw = typeof value === 'string' ? encoder.encode(value) : value;
      header(typeof value === 'string' ? 3 : 2, raw.length);
      for (const b of raw) bytes.push(b);
    } else if (value instanceof Map) {
      header(5, value.size);
      for (const key of [...value.keys()].sort((a, b) => a - b)) {
        header(0, key);
        append(value.get(key)!);
      }
    } else if (Array.isArray(value)) {
      header(4, value.length);
      value.forEach(append);
    } else bytes.push(value === null ? 246 : value ? 245 : 244);
  }
  append(root);
  return Uint8Array.from(bytes);
}
