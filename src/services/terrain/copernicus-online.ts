import { fromCustomClient, type GeoTIFF } from 'geotiff';

const catalog = 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/cop-dem-glo-30/items';
const tokenUrl = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/elevationeuwest/copernicus-dem';
const blobOrigin = 'https://elevationeuwest.blob.core.windows.net';
const rangeOptions = { maxRanges: 0, blockSize: 65_536 };

/** Open GLO-30 tiles from Planetary Computer using one anonymous read token per lookup. */
export function createOnlineTileReader(signal: AbortSignal): (tile: string) => Promise<GeoTIFF | null> {
  function request(url: string, headers?: HeadersInit) {
    signal.throwIfAborted();
    return fetch(url, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  }

  let tokenRequest: Promise<string> | undefined;
  let refreshAt = Infinity;
  function getToken() {
    if (!tokenRequest || Date.now() >= refreshAt) {
      refreshAt = Infinity; // Share an in-flight renewal between raster reads.
      tokenRequest = request(tokenUrl)
        .then(async (response) => {
          if (!response.ok) throw new Error(`GLO-30 access service returned ${response.status}`);
          const result = await response.json();
          const expiry = Date.parse(result['msft:expiry']);
          if (typeof result.token !== 'string' || !result.token || !(expiry > Date.now())) {
            throw new Error('Invalid GLO-30 access token');
          }
          refreshAt = expiry - 30_000;
          return result.token;
        })
        .catch((error) => {
          refreshAt = 0;
          throw error;
        });
    }
    return tokenRequest;
  }

  return async (tile) => {
    if (!/^Copernicus_DSM_COG_10_[NS]\d{2}_00_[EW]\d{3}_00_DEM$/.test(tile)) {
      throw new Error('Invalid GLO-30 tile name');
    }
    const item = await request(`${catalog}/${tile}`);
    if (item.status === 404) return null;
    if (!item.ok) throw new Error(`GLO-30 catalog returned ${item.status}`);
    const record = await item.json();
    const asset = new URL(record.assets.data.href);
    if (
      record.id !== tile ||
      asset.origin !== blobOrigin ||
      !asset.pathname.startsWith('/copernicus-dem/') ||
      !asset.pathname.endsWith(`/${tile}.tif`)
    ) {
      throw new Error('Unexpected GLO-30 catalog asset');
    }

    let missing = false;
    // Azure allows single byte ranges via CORS. geotiff only needs the requested offset,
    // not a CORS-exposed Content-Range header, when maxRanges is zero.
    const client = {
      url: asset.href,
      async request(options: RequestInit = {}) {
        const signed = new URL(asset);
        signed.search = await getToken();
        const response = await request(signed.href, options.headers);
        if (response.status !== 206) {
          missing = response.status === 404;
          await response.body?.cancel();
          throw new Error(`GLO-30 tile range returned ${response.status}`);
        }
        return {
          ok: response.ok,
          status: response.status,
          getHeader: (name: string) => response.headers.get(name) ?? undefined,
          getData: () => response.arrayBuffer(),
        };
      },
    };
    try {
      return await fromCustomClient(client, rangeOptions, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (missing) return null;
      throw error;
    }
  };
}
