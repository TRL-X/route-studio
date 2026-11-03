import { afterEach, expect, it, vi } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { createOnlineTileReader } from '../../src/files/copernicus-online';

const first = 'Copernicus_DSM_COG_10_N30_00_E120_00_DEM';
const second = 'Copernicus_DSM_COG_10_N30_00_E121_00_DEM';
const blob = 'https://elevationeuwest.blob.core.windows.net/copernicus-dem/COP30_hh/';
const tileRecord = (id: string) => Response.json({ id, assets: { data: { href: blob + id + '.tif' } } });
const token = () =>
  Response.json({ token: 'sig=public-read', 'msft:expiry': new Date(Date.now() + 3600_000) });
afterEach(() => vi.unstubAllGlobals());

it('opens adjacent tiles with one anonymous token and decodes single ranges without Content-Range', async () => {
  const file = writeArrayBuffer([22, 43], { width: 2, height: 1 });
  let tokenCalls = 0;
  const ranges: string[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    if (url.includes('/items/')) return tileRecord(url.split('/').at(-1)!);
    if (url.includes('/sas/')) {
      tokenCalls++;
      return token();
    }
    expect(url.startsWith(blob) && url.endsWith('.tif?sig=public-read')).toBe(true);
    const range = new Headers(options.headers).get('Range')!;
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    ranges.push(range);
    return new Response(file.slice(Number(match[1]), Number(match[2]) + 1), { status: 206 });
  });
  const read = createOnlineTileReader(new AbortController().signal);
  for (const tiff of await Promise.all([read(first), read(second)])) {
    const values = await (await tiff!.getImage()).readRasters({ interleave: true });
    expect(Array.from(values)).toEqual([22, 43]);
  }
  expect(tokenCalls).toBe(1);
  expect(ranges.length).toBeGreaterThanOrEqual(2);
});

it('distinguishes a missing catalog item or blob from a failed request', async () => {
  const read = createOnlineTileReader(new AbortController().signal);
  const missing = () => new Response(null, { status: 404 });
  vi.stubGlobal('fetch', missing);
  await expect(read(first)).resolves.toBeNull();
  vi.stubGlobal('fetch', () => new Response(null, { status: 429 }));
  await expect(read(first)).rejects.toThrow(/429/);
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/items/')) return tileRecord(first);
    if (url.includes('/sas/')) return token();
    return missing();
  });
  await expect(read(first)).resolves.toBeNull();
});

it('validates the catalog asset before requesting credentials and respects cancellation', async () => {
  const controller = new AbortController();
  const fetch = vi.fn(() =>
    Response.json({ id: first, assets: { data: { href: 'https://example.com/file.tif' } } }),
  );
  vi.stubGlobal('fetch', fetch);
  const read = createOnlineTileReader(controller.signal);
  await expect(read(first)).rejects.toThrow(/Unexpected/);
  controller.abort();
  await expect(read(first)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
