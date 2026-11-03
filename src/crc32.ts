const table = new Uint32Array(256);
for (let n = 0; n < table.length; n++) {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  table[n] = crc;
}

/** IEEE CRC32, optionally continuing from a previous chunk's checksum. */
export function crc32(data: Uint8Array, previous = 0) {
  let crc = previous ^ 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
