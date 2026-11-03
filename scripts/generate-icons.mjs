// Rasterize the existing geometric brand mark without external image tools.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), body.length + 4);
  return result;
}
const lines = [
  [6, 29, 17, 10],
  [17, 10, 25, 24],
  [25, 24, 29, 17],
  [29, 17, 36, 29],
  [17, 10, 17.5, 24],
  [17.5, 24, 25, 24],
];
function distance(x, y, [ax, ay, bx, by]) {
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
  );
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let alpha = 0,
        red = 0,
        green = 0,
        blue = 0;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const x = ((col + (sx + 0.5) / 3) * 40) / size;
          const y = ((row + (sy + 0.5) / 3) * 40) / size;
          const dx = Math.max(8 - x, 0, x - 32),
            dy = Math.max(8 - y, 0, y - 32);
          if (dx * dx + dy * dy > 64) continue;
          const white = lines.some((line) => distance(x, y, line) <= 1.25);
          alpha++;
          red += white ? 255 : 22;
          green += white ? 255 : 116;
          blue += white ? 255 : 90;
        }
      const offset = row * (size * 4 + 1) + 1 + col * 4;
      raw[offset] = alpha ? Math.round(red / alpha) : 0;
      raw[offset + 1] = alpha ? Math.round(green / alpha) : 0;
      raw[offset + 2] = alpha ? Math.round(blue / alpha) : 0;
      raw[offset + 3] = Math.round((alpha * 255) / 9);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const images = new Map(sizes.map((size) => [size, png(size)]));
await mkdir('build/icons', { recursive: true });
await writeFile('build/icons/icon.png', images.get(512));
const icoSizes = sizes.filter((size) => size <= 256);
const icoHeader = Buffer.alloc(6 + icoSizes.length * 16);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoSizes.length, 4);
let offset = icoHeader.length;
for (const [index, size] of icoSizes.entries()) {
  const entry = 6 + index * 16;
  icoHeader[entry] = size === 256 ? 0 : size;
  icoHeader[entry + 1] = icoHeader[entry];
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(images.get(size).length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  offset += images.get(size).length;
}
await writeFile(
  'build/icons/icon.ico',
  Buffer.concat([icoHeader, ...icoSizes.map((size) => images.get(size))]),
);
const icnsParts = [
  [16, 'icp4'],
  [32, 'icp5'],
  [64, 'icp6'],
  [128, 'ic07'],
  [256, 'ic08'],
  [512, 'ic09'],
  [1024, 'ic10'],
].map(([size, type]) => {
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32BE(images.get(size).length + 8, 4);
  return Buffer.concat([header, images.get(size)]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns');
icnsHeader.writeUInt32BE(8 + icnsParts.reduce((sum, part) => sum + part.length, 0), 4);
await writeFile('build/icons/icon.icns', Buffer.concat([icnsHeader, ...icnsParts]));
