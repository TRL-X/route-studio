import { readFile } from 'node:fs/promises';
import type { BrowserContext } from '@playwright/test';

const tile = 'Copernicus_DSM_COG_10_N85_00_E120_00_DEM';
const catalog = 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/cop-dem-glo-30/items';
const tokenUrl = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/elevationeuwest/copernicus-dem';
const asset = `https://elevationeuwest.blob.core.windows.net/copernicus-dem/COP30_hh/${tile}.tif`;
const cors = { 'access-control-allow-origin': '*' };

/** Serve the real online worker one deterministic tile. Its first three posts are 0, 50 and -13.5 m. */
export async function mockOnlineTerrain(context: BrowserContext, { failFirstLookup = false } = {}) {
  const bytes = await readFile(new URL(`./${tile}.tif`, import.meta.url));
  await context.route(catalog + '/*', (route) => {
    const id = route.request().url().split('/').at(-1);
    if (failFirstLookup) {
      failFirstLookup = false;
      return route.fulfill({ status: 503, headers: cors });
    }
    if (id !== tile) return route.fulfill({ status: 404, headers: cors });
    return route.fulfill({ json: { id, assets: { data: { href: asset } } }, headers: cors });
  });
  await context.route(tokenUrl, (route) =>
    route.fulfill({
      json: { token: 'sig=test', 'msft:expiry': new Date(Date.now() + 3_600_000).toISOString() },
      headers: cors,
    }),
  );
  await context.route(asset + '?sig=test', (route) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range ?? '');
    if (!range || Number(range[1]) >= bytes.length) return route.fulfill({ status: 416, headers: cors });
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), bytes.length - 1);
    return route.fulfill({
      status: 206,
      headers: { ...cors, 'content-range': `bytes ${start}-${end}/${bytes.length}` },
      contentType: 'image/tiff',
      body: bytes.subarray(start, end + 1),
    });
  });
}
