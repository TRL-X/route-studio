import { automaticDeclination, type DeclinationSettings, type RouteDocument } from '../domain/model';
import {
  declinationSettings,
  manualDeclination,
  manualMetadata,
  midpointReference,
  sameReference,
  withDeclination,
} from '../domain/declination';
import { RteError } from '../rte/check';
import { Field } from './Field';
import type { Copy, Lang } from './strings';
import type { LookupState } from './useDeclinationLookup';

export function DeclinationFields({
  doc,
  t,
  change,
  lookup,
  lang,
}: {
  doc: RouteDocument;
  t: Copy;
  lang: Lang;
  change: (doc: RouteDocument) => void;
  lookup: LookupState;
}) {
  const settings = declinationSettings(doc);
  const set = (next: DeclinationSettings) => change(withDeclination(doc, next));
  const autoResult =
    settings.mode === 'auto' && sameReference(settings.result, lookup.reference)
      ? settings.result
      : undefined;
  function selectMode(mode: string) {
    if (mode === 'omit') set({ mode });
    if (mode === 'auto')
      set(automaticDeclination(settings.mode === 'manual' ? settings.date || undefined : undefined));
    if (mode === 'manual')
      set(
        manualDeclination(
          autoResult ?? lookup.reference ?? midpointReference(doc, automaticDeclination().date),
        ),
      );
  }

  let manualError: string | undefined;
  if (settings.mode === 'manual') {
    try {
      manualMetadata(settings);
    } catch (error) {
      if (!(error instanceof RteError)) throw error;
      manualError = lang === 'en' ? error.message : error.messageZh;
    }
  }
  return (
    <section aria-label={t.magTitle}>
      <h3>{t.magTitle}</h3>
      <label className="field">
        <span>{t.magMode}</span>
        <select value={settings.mode} onChange={(e) => selectMode(e.target.value)}>
          <option value="auto">{t.magAuto}</option>
          <option value="manual">{t.magManual}</option>
          <option value="omit">{t.magOmit}</option>
        </select>
      </label>
      {settings.mode === 'auto' && (
        <>
          <p className="hint">{t.magLookupHelp}</p>
          <Field
            label={t.magDate}
            date
            value={settings.date}
            onInvalid={() => set(automaticDeclination(''))}
            save={(date) => set(automaticDeclination(date))}
          />
          {lookup.reference && (
            <p className="hint">
              {t.magMidpoint} · {lookup.reference.referenceLatE7 / 1e7}°,{' '}
              {lookup.reference.referenceLonE7 / 1e7}°
            </p>
          )}
          <p aria-live="polite" className={lookup.error ? 'field-issue' : 'hint'}>
            {autoResult
              ? (autoResult.declinationCdeg / 100).toFixed(2) + '° · ' + settings.source
              : lookup.error
                ? t[lookup.error]
                : lookup.pending
                  ? t.magPending
                  : t.magNoRoute}
          </p>
          <button
            className="sub-action"
            disabled={!lookup.reference || lookup.pending}
            onClick={() => set(automaticDeclination(settings.date))}
          >
            {t.magRetry}
          </button>
        </>
      )}
      {settings.mode === 'manual' && (
        <>
          <p className="hint">{t.magSign}</p>
          {(
            [
              ['degrees', t.magDegrees],
              ['lat', t.magLat],
              ['lon', t.magLon],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              number
              optional
              onInvalid={() => set({ ...settings, [key]: null })}
              value={settings[key]}
              save={(raw) => set({ ...settings, [key]: raw === '' ? null : Number(raw) })}
            />
          ))}
          {(
            [
              ['date', t.magDate],
              ['validFrom', t.magFrom],
              ['validUntil', t.magUntil],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              date
              value={settings[key]}
              save={(raw) => set({ ...settings, [key]: raw })}
            />
          ))}
          {manualError && <p className="field-issue">{manualError}</p>}
        </>
      )}
    </section>
  );
}
