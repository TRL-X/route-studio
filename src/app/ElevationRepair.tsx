import { useLayoutEffect, useMemo, useState } from 'react';
import { planFullTerrain } from '../domain/elevation-repair';
import type { RouteDocument } from '../domain/model';
import { RepairProfile } from '../views/RepairProfile';
import en from '../i18n/en.repair.json' with { type: 'json' };
import zh from '../i18n/zh-CN.repair.json' with { type: 'json' };
import { runIO } from './io';
import { strings, type Lang } from './strings';
import { TerrainCredit } from './TerrainCredit';
import './elevation-repair.css';

const replacementCopy = { en, zh } satisfies Record<Lang, typeof en>;
type Preview = ReturnType<ReturnType<typeof planFullTerrain>['preview']>;

export function ElevationRepair({
  doc,
  lang,
  initialSummary,
  onApply,
  onClose,
}: {
  doc: RouteDocument;
  lang: Lang;
  initialSummary?: string;
  onApply: (next: RouteDocument) => void;
  onClose: () => void;
}) {
  const t = strings[lang];
  const copy = replacementCopy[lang];
  const plan = useMemo(() => {
    try {
      return planFullTerrain(doc);
    } catch {
      return null;
    }
  }, [doc]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Preview | 'error' | null>(null);
  useLayoutEffect(() => {
    setResult(null);
    if (!plan?.points.length) return;
    const request = new AbortController();
    void runIO({ type: 'terrain', points: plan.points }, request.signal)
      .then((response) => {
        if (request.signal.aborted) return;
        setResult(response.type === 'heights' ? plan.preview(response.values) : 'error');
      })
      .catch(() => {
        if (!request.signal.aborted) setResult('error');
      });
    return () => request.abort();
  }, [plan, attempt]);

  const preview = result === 'error' ? null : result;
  const candidate = preview?.document;
  const canRetry = result === 'error' || Boolean(preview?.missing);
  const hasOriginal = doc.elevation.some((s) => s.height !== null);
  const attention = preview?.sections ?? plan?.sections;
  return (
    <div className="overlay">
      <section
        className="dialog terrain-dialog replace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-title"
      >
        <h2 id="replace-title">{copy.title}</h2>
        {initialSummary && (
          <p className="replace-summary" role="status">
            {initialSummary}
          </p>
        )}
        {plan?.points.length ? (
          <>
            <p className="replace-datum">
              {hasOriginal && (
                <span>
                  {copy.originalDatum} {[t.unknown, t.msl, t.wgs][doc.elevationReference]} →{' '}
                </span>
              )}
              <strong>GLO-30 · EGM2008</strong>
              {hasOriginal && <span className="replace-hint">{copy.datumHint}</span>}
            </p>
            <RepairProfile
              original={plan.original}
              hasOriginal={hasOriginal}
              lang={lang}
              preview={preview?.readings}
              attention={
                hasOriginal ? attention : attention?.filter((section) => section.kind === 'uncovered')
              }
            />
            {result === 'error' ? (
              <p className="terrain-error" role="alert">
                {t.terrainNetworkError}
              </p>
            ) : preview?.missing ? (
              <p className="terrain-error" role="alert">
                {copy.missing.replace('{missing}', String(preview.missing))}
              </p>
            ) : (
              <p className="replace-status" role="status">
                {preview ? copy.coverage.replace('{total}', String(plan.points.length)) : copy.reading}
              </p>
            )}
          </>
        ) : (
          <p className="terrain-error" role="alert">
            {plan ? t.noVertices : t.terrainLimit}
          </p>
        )}
        <details className="replace-credit">
          <summary>{copy.sourceDetails}</summary>
          <TerrainCredit />
        </details>
        <footer>
          <button className="button" autoFocus onClick={onClose}>
            {t.cancel}
          </button>
          {candidate && (
            <button className="primary" onClick={() => onApply(candidate)}>
              {copy.replace}
            </button>
          )}
          {canRetry && (
            <button className="primary" onClick={() => setAttempt((n) => n + 1)}>
              {copy.retry}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
