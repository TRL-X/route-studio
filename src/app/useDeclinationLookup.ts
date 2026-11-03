import { useEffect, useMemo, useState } from 'react';
import { midpointReference, sameReference, type Reference } from '../domain/declination';
import type { AutomaticDeclination, RouteDocument } from '../domain/model';
import type { MagneticDeclination } from '../rte/context';
import { lookupDeclination, type LookupFailure } from './declinationLookup';

export interface LookupState {
  reference?: Reference;
  pending: boolean;
  error?: LookupFailure;
}

export function useDeclinationLookup(
  doc: RouteDocument,
  session: number,
  dispatch: (action: { type: 'lookup'; settings: AutomaticDeclination; value: MagneticDeclination }) => void,
): LookupState {
  const settings = doc.declination?.mode === 'auto' ? doc.declination : undefined;
  const date = settings?.date;
  const reference = useMemo(
    () => (date !== undefined ? midpointReference(doc, date) : undefined),
    [doc.vertices, doc.rte?.distanceDm, date],
  );
  const lat = reference?.referenceLatE7,
    lon = reference?.referenceLonE7;
  const ready = sameReference(settings?.result, reference);
  const [failure, setFailure] = useState<{
    settings: AutomaticDeclination;
    reference: Reference;
    error: LookupFailure;
  } | null>(null);

  useEffect(() => {
    if (!settings || ready || lat === undefined || lon === undefined) return;
    const controller = new AbortController();
    const current = { referenceLatE7: lat, referenceLonE7: lon, referenceDate: settings.date };
    setFailure(null);
    void lookupDeclination(current, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if ('error' in result) setFailure({ settings, reference: current, error: result.error });
      else dispatch({ type: 'lookup', settings, value: result.value });
    });
    return () => controller.abort();
  }, [settings, lat, lon, ready, session, dispatch]);

  const error =
    failure?.settings === settings && sameReference(failure?.reference, reference)
      ? failure?.error
      : undefined;
  return { reference, error, pending: !!reference && !ready && !error };
}
