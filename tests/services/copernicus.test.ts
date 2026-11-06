import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleCopernicus } from '../../src/services/terrain/copernicus';

const { openOnline } = vi.hoisted(() => ({ openOnline: vi.fn() }));
vi.mock('../../src/services/terrain/copernicus-online', () => ({ createOnlineTileReader: () => openOnline }));
afterEach(() => vi.resetAllMocks());

const signal = () => new AbortController().signal;

function mockTile() {
  // Model distinct full-resolution posts including a depression, sea level, and two types of missing data.
  const readRasters = vi.fn(async ({ window: [left, top, right, bottom] }) => {
    const values = new Float32Array((right - left) * (bottom - top)).fill(372.5);
    if (left === 0 && top === 0) values.set([0, -12, NaN, -32767]);
    return values;
  });
  const image = {
    getOrigin: () => [120, 31],
    getResolution: () => [1 / 3600, -1 / 3600],
    getWidth: () => 3600,
    getHeight: () => 3600,
    getSamplesPerPixel: () => 1,
    getSampleFormat: () => 3,
    getBitsPerSample: () => 32,
    getGeoKeys: () => ({ GeographicTypeGeoKey: 4326, GTRasterTypeGeoKey: 2 }),
    isTiled: true,
    getTileWidth: () => 1024,
    getTileHeight: () => 1024,
    getGDALNoData: () => -32767,
    readRasters,
  };
  return { image, tiff: { getImage: vi.fn(async () => image) } };
}

describe('Copernicus GLO-30 surface posts', () => {
  it('chooses the tile owning the nearest post at seams, the equator and the antimeridian', async () => {
    openOnline.mockResolvedValue(null);
    await sampleCopernicus(
      [
        { lat: 31, lon: 120 },
        { lat: 31 + 0.2 / 3600, lon: 120 - 0.2 / 3600 },
        { lat: 0, lon: 180 },
        { lat: -50, lon: -74 - 0.6 / 3600 },
      ],
      signal(),
    );
    expect(openOnline.mock.calls.map(([tile]) => tile)).toEqual([
      'Copernicus_DSM_COG_10_N30_00_E120_00_DEM',
      'Copernicus_DSM_COG_10_S01_00_W180_00_DEM',
      'Copernicus_DSM_COG_10_S51_00_W074_00_DEM',
    ]);
  });

  it('groups points by COG block, preserving input order, zero and negative heights, and unfilled gaps', async () => {
    const { image, tiff } = mockTile();
    openOnline.mockResolvedValueOnce(tiff).mockResolvedValueOnce(null);
    const points = [0, 3, 2, 1, 0].map((x) => ({ lat: 31, lon: 120 + x / 3600 }));
    points.push({ lat: 30 + 1 / 3600, lon: 121 - 1 / 3600 }, { lat: 31.5, lon: 120.5 });
    expect(await sampleCopernicus(points, signal())).toEqual([0, null, null, -12, 0, 372.5, null]);
    expect(image.readRasters.mock.calls.map(([options]) => options.window)).toEqual([
      [0, 0, 1024, 1024],
      [3072, 3072, 3600, 3600],
    ]);
  });

  it('leaves uncovered online tiles missing and propagates a service error', async () => {
    const { tiff } = mockTile();
    openOnline.mockResolvedValueOnce(tiff).mockResolvedValueOnce(null);
    const points = [
      { lat: 31, lon: 120 },
      { lat: 31.5, lon: 120 },
    ];
    expect(await sampleCopernicus(points, signal())).toEqual([0, null]);
    openOnline.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(sampleCopernicus(points, signal())).rejects.toThrow('Unavailable');
  });

  it('rejects a raster whose grid does not match the requested GLO-30 tile', async () => {
    const { tiff, image } = mockTile();
    image.getOrigin = () => [42, -8];
    openOnline.mockResolvedValue(tiff);
    await expect(sampleCopernicus([{ lat: 31, lon: 120 }], signal())).rejects.toThrow('does not match');
    expect(image.readRasters).not.toHaveBeenCalled();
  });
});
