import type { GeoTIFF, GeoTIFFImage } from 'geotiff';
import type { Point } from '../domain/model';
import { createOnlineTileReader } from './copernicus-online';

const height = 3600;

// Each AWS COG covers one degree, with wider longitude spacing toward the poles.
function widthAt(south: number) {
  const latitude = Math.abs(south + 0.5);
  if (latitude < 50) return 3600;
  if (latitude < 60) return 2400;
  if (latitude < 70) return 1800;
  if (latitude < 80) return 1200;
  if (latitude < 85) return 720;
  return 360;
}

function tileName(south: number, west: number) {
  const lat = (south < 0 ? 'S' : 'N') + String(Math.abs(south)).padStart(2, '0');
  const lon = (west < 0 ? 'W' : 'E') + String(Math.abs(west)).padStart(3, '0');
  return `Copernicus_DSM_COG_10_${lat}_00_${lon}_00_DEM`;
}

function nearestPost({ lat, lon }: Point) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new Error('Invalid route coordinate');
  }
  // The AWS mirror retains north and west edge posts and removes the shared south/east ones.
  // Round on the global point lattice first so samples near a seam select the correct neighbor.
  const row = Math.min(180 * height - 1, Math.round((90 - lat) * height));
  const south = 89 - Math.floor(row / height);
  const width = widthAt(south);
  const column = Math.round((lon + 180) * width) % (360 * width);
  const west = Math.floor(column / width) - 180;
  return { tile: tileName(south, west), x: column % width, y: row % height };
}

interface Pixel {
  index: number;
  x: number;
  y: number;
}

function validateGrid(tile: string, image: GeoTIFFImage) {
  const match = /^Copernicus_DSM_COG_10_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM$/.exec(tile);
  if (!match) throw new Error('Expected a GLO-30 COG tile');
  const south = Number(match[2]) * (match[1] === 'S' ? -1 : 1);
  const west = Number(match[4]) * (match[3] === 'W' ? -1 : 1);
  const width = widthAt(south);
  const [originX, originY] = image.getOrigin();
  const [dx, dy] = image.getResolution();
  const keys = image.getGeoKeys();
  const matchesTile =
    tile === tileName(south, west) &&
    Math.abs(originX - west) < 1e-9 &&
    Math.abs(originY - (south + 1)) < 1e-9 &&
    west >= -180 &&
    west < 180 &&
    south >= -90 &&
    south < 90;
  const matchesGrid =
    image.getHeight() === height &&
    image.getWidth() === width &&
    Math.abs(dx * width - 1) < 1e-9 &&
    Math.abs(dy * height + 1) < 1e-9 &&
    keys?.GeographicTypeGeoKey === 4326 &&
    keys.GTRasterTypeGeoKey === 2;
  const floatBand =
    image.getSamplesPerPixel() === 1 && image.getSampleFormat() === 3 && image.getBitsPerSample() === 32;
  if (!matchesTile || !matchesGrid || !floatBand || !image.isTiled)
    throw new Error('GeoTIFF does not match its GLO-30 tile');
}

async function sampleTile(
  tiff: GeoTIFF,
  tile: string,
  pixels: Pixel[],
  heights: (number | null)[],
  signal: AbortSignal,
) {
  const image = await tiff.getImage(0);
  validateGrid(tile, image);
  const width = image.getWidth();
  const blocks = new Map<number, Pixel[]>();
  const blockWidth = image.getTileWidth();
  const blockHeight = image.getTileHeight();
  if (blockWidth <= 0 || blockHeight <= 0 || blockWidth * blockHeight > 1024 * 1024)
    throw new Error('Invalid GLO-30 block size');
  const across = Math.ceil(width / blockWidth);
  for (const pixel of pixels) {
    const key = Math.floor(pixel.y / blockHeight) * across + Math.floor(pixel.x / blockWidth);
    const group = blocks.get(key);
    if (group) group.push(pixel);
    else blocks.set(key, [pixel]);
  }
  const nodata = image.getGDALNoData();
  for (const [key, group] of blocks) {
    signal.throwIfAborted();
    const left = (key % across) * blockWidth;
    const top = Math.floor(key / across) * blockHeight;
    const right = Math.min(width, left + blockWidth);
    const bottom = Math.min(height, top + blockHeight);
    const values = await image.readRasters({
      window: [left, top, right, bottom],
      samples: [0],
      interleave: true,
      signal,
    });
    for (const { index, x, y } of group) {
      const value = values[(y - top) * (right - left) + x - left];
      if (Number.isFinite(value) && value !== nodata) heights[index] = value;
    }
  }
}

/** Read full-resolution posts from the online GLO-30 mirror. */
export async function sampleCopernicus(
  points: readonly Point[],
  signal: AbortSignal,
): Promise<(number | null)[]> {
  signal.throwIfAborted();
  const heights = Array<number | null>(points.length).fill(null);
  const tiles = new Map<string, Pixel[]>();
  for (const [index, point] of points.entries()) {
    const { tile, x, y } = nearestPost(point);
    const group = tiles.get(tile);
    if (group) group.push({ x, y, index });
    else tiles.set(tile, [{ x, y, index }]);
  }
  const read = createOnlineTileReader(signal);
  for (const [tile, pixels] of tiles) {
    signal.throwIfAborted();
    const tiff = await read(tile);
    if (tiff) await sampleTile(tiff, tile, pixels, heights, signal);
  }
  signal.throwIfAborted();
  return heights;
}
