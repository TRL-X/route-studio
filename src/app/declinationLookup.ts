import type { MagneticDeclination } from '../rte/context';
import { centidegrees, supportedLookupDate, type Reference } from '../domain/declination';

export const bgsEndpoint = 'https://geomag.bgs.ac.uk/web_service/GMModels/wmm/2025/';
export type LookupFailure = 'magDateRange' | 'magTimeout' | 'magUnavailable' | 'magInvalidResponse';
type LookupResult = { value: MagneticDeclination } | { error: LookupFailure };

export async function lookupDeclination(reference: Reference, signal: AbortSignal): Promise<LookupResult> {
  const { referenceLatE7, referenceLonE7, referenceDate: date } = reference;
  if (!supportedLookupDate(date)) return { error: 'magDateRange' };
  const lat = referenceLatE7 / 1e7,
    lon = referenceLonE7 / 1e7;
  const url = new URL(bgsEndpoint);
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    altitude: '0',
    date,
    format: 'json',
  }).toString();
  let timeout: AbortSignal | undefined;
  try {
    timeout = AbortSignal.timeout(8000);
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, timeout]),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok) return { error: 'magUnavailable' };
    const body = await response.json();
    const result = body?.['geomagnetic-field-model-result'];
    const field = result?.['field-value']?.declination;
    if (
      result?.model !== 'wmm' ||
      String(result?.model_revision) !== '2025' ||
      result.date?.value !== date ||
      result.coordinates?.latitude?.value !== lat ||
      result.coordinates?.longitude?.value !== lon ||
      result.coordinates?.altitude?.value !== 0 ||
      field?.units !== 'deg (east)' ||
      typeof field?.value !== 'number' ||
      !Number.isFinite(field.value) ||
      Math.abs(field.value) > 180
    ) {
      return { error: 'magInvalidResponse' };
    }
    return { value: { ...reference, declinationCdeg: centidegrees(field.value) } };
  } catch (error) {
    if (timeout?.aborted) return { error: 'magTimeout' };
    return { error: error instanceof SyntaxError ? 'magInvalidResponse' : 'magUnavailable' };
  }
}
