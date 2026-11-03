import { afterEach, describe, expect, it, vi } from 'vitest';
import { bgsEndpoint, lookupDeclination } from '../../src/app/declinationLookup';

const reference = { referenceLatE7: 123456789, referenceLonE7: -345678912, referenceDate: '2026-11-03' };
const query = () => lookupDeclination(reference, new AbortController().signal);
const body = (value: number) => ({
  model: 'wmm',
  model_revision: '2025',
  date: { value: reference.referenceDate },
  coordinates: { latitude: { value: 12.3456789 }, longitude: { value: -34.5678912 }, altitude: { value: 0 } },
  'field-value': { declination: { units: 'deg (east)', value } },
});
function mockResult(result: ReturnType<typeof body>) {
  return vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ 'geomagnetic-field-model-result': result })),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('BGS WMM2025 lookup', () => {
  it.each([
    [3.156, 316],
    [-1.125, -113],
    [-1.005, -101],
    [0, 0],
  ])('validates and quantizes %s degrees', async (degrees, cdeg) => {
    mockResult(body(degrees));
    expect(await query()).toEqual({ value: { ...reference, declinationCdeg: cdeg } });
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url).split('?')[0]).toBe(bgsEndpoint);
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({
      latitude: '12.3456789',
      longitude: '-34.5678912',
      altitude: '0',
      date: reference.referenceDate,
      format: 'json',
    });
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
  it.each(['2024-12-31', '2030-01-01', '2026-02-29', ''])(
    'rejects unsupported date %s without a request',
    async (date) => {
      vi.stubGlobal('fetch', vi.fn());
      expect(
        await lookupDeclination({ ...reference, referenceDate: date }, new AbortController().signal),
      ).toEqual({ error: 'magDateRange' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    (r: ReturnType<typeof body>) => {
      r.model = 'igrf';
    },
    (r: ReturnType<typeof body>) => {
      r.model_revision = '2020';
    },
    (r: ReturnType<typeof body>) => {
      r.date.value = '2025-01-01';
    },
    (r: ReturnType<typeof body>) => {
      r.coordinates.longitude.value = 0;
    },
    (r: ReturnType<typeof body>) => {
      r.coordinates.latitude.value = 0;
    },
    (r: ReturnType<typeof body>) => {
      r.coordinates.altitude.value = 2;
    },
    (r: ReturnType<typeof body>) => {
      r['field-value'].declination.units = 'rad';
    },
    (r: ReturnType<typeof body>) => {
      r['field-value'].declination.value = 181;
    },
  ])('rejects a mismatched response', async (edit) => {
    const result = body(0);
    edit(result);
    mockResult(result);
    expect(await query()).toEqual({ error: 'magInvalidResponse' });
  });
  it('distinguishes service, timeout and JSON failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await query()).toEqual({ error: 'magUnavailable' });
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    try {
      expect(await query()).toEqual({ error: 'magTimeout' });
      expect(timeout).toHaveBeenCalledWith(8000);
    } finally {
      timeout.mockRestore();
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>')));
    expect(await query()).toEqual({ error: 'magInvalidResponse' });
  });
});
