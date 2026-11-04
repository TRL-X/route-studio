import { Modal } from './Modal';
import { Button, Callout, Flex, Text } from '@radix-ui/themes';
import { useLayoutEffect, useMemo, useState } from 'react';
import { planFullTerrain } from '../domain/elevation-repair';
import type { RouteDocument } from '../domain/model';
import { RepairProfile } from '../views/RepairProfile';
import en from '../i18n/en.repair.json' with { type: 'json' };
import zh from '../i18n/zh-CN.repair.json' with { type: 'json' };
import { runIO } from './io';
import { strings, type Lang } from './strings';
import { TerrainCredit } from './TerrainCredit';
import { workflowStrings } from './ElevationTools';

const replacementCopy = { en, zh } satisfies Record<Lang, typeof en>;
type Preview = ReturnType<ReturnType<typeof planFullTerrain>['preview']>;

export function ElevationRepair({
  doc,
  lang,
  initialSummary,
  onApply,
  onClose,
  onBack,
}: {
  doc: RouteDocument;
  lang: Lang;
  initialSummary?: string;
  onApply: (next: RouteDocument) => void;
  onClose: () => void;
  onBack: () => void;
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
  const error = !plan
    ? t.terrainLimit
    : !plan.points.length
      ? t.noVertices
      : result === 'error'
        ? t.terrainNetworkError
        : preview?.missing
          ? copy.missing.replace('{missing}', String(preview.missing))
          : null;
  return (
    <Modal maxWidth="880px" title={copy.title} onClose={onClose}>
      <Flex direction="column" gap="3">
        {initialSummary && (
          <Text as="p" size="2" color="blue" role="status">
            {initialSummary}
          </Text>
        )}
        {!!plan?.points.length && (
          <>
            <Text as="p" size="2" color="gray">
              {hasOriginal && (
                <>
                  {copy.originalDatum} {[t.unknown, t.msl, t.wgs][doc.elevationReference]} →{' '}
                </>
              )}
              <Text weight="medium">GLO-30 · EGM2008</Text>
              {hasOriginal && <> · {copy.datumHint}</>}
            </Text>
            <RepairProfile
              original={plan.original}
              hasOriginal={hasOriginal}
              lang={lang}
              preview={preview?.readings}
              attention={
                hasOriginal ? attention : attention?.filter((section) => section.kind === 'uncovered')
              }
            />
          </>
        )}
        {error ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        ) : (
          <Text as="p" size="2" color="gray" role="status">
            {preview ? copy.coverage.replace('{total}', String(plan!.points.length)) : copy.reading}
          </Text>
        )}
        <Text asChild size="2" color="gray">
          <details>
            <summary>{copy.sourceDetails}</summary>
            <TerrainCredit />
          </details>
        </Text>
        <Flex justify="end" wrap="wrap" gap="2" mt="2">
          <Button variant="surface" color="gray" mr="auto" onClick={onBack}>
            {workflowStrings[lang].back}
          </Button>
          <Button variant="soft" color="gray" autoFocus onClick={onClose}>
            {t.cancel}
          </Button>
          {candidate && <Button onClick={() => onApply(candidate)}>{copy.replace}</Button>}
          {canRetry && <Button onClick={() => setAttempt((n) => n + 1)}>{copy.retry}</Button>}
        </Flex>
      </Flex>
    </Modal>
  );
}
