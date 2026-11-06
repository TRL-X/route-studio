import { Button, Callout, Flex, Text } from '@radix-ui/themes';
import { useRef } from 'react';
import type { ImportElevationAssessment } from '../../domain/elevation-repair';
import { Modal } from '../../ui/Modal';
import { strings, type Lang } from '../../i18n/index';
import { workflowStrings } from './ElevationTools';

export function ImportElevationDialog({
  lang,
  assessment,
  onFill,
  onOnline,
  onClose,
}: {
  lang: Lang;
  assessment: ImportElevationAssessment;
  onFill: () => void;
  onOnline: () => void;
  onClose: () => void;
}) {
  const t = strings[lang];
  const copy = workflowStrings[lang];
  const primaryAction = useRef<HTMLButtonElement>(null);
  const canComplete = assessment.recommendation === 'fill';
  const message = !assessment.hasKnownHeights
    ? copy.importNoHeights
    : canComplete
      ? copy.importFillable
      : copy.importNeedsReplacement;
  return (
    <Modal
      title={copy.importElevationTitle}
      onClose={onClose}
      maxWidth="520px"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        primaryAction.current?.focus();
      }}
    >
      <Flex direction="column" gap="4">
        <Callout.Root>
          <Callout.Text>
            {message
              .replace('{gaps}', String(assessment.gaps))
              .replace('{remaining}', String(assessment.gaps - assessment.fillableGaps))}
          </Callout.Text>
        </Callout.Root>
        <Flex direction="column" gap="2">
          <Text as="p" size="2">
            {canComplete
              ? copy.fillHelp
              : assessment.hasKnownHeights
                ? copy.importReplacementHelp
                : copy.onlineHelp}
          </Text>
          <Text as="p" size="2" color="gray">
            {copy.importLaterHelp}
          </Text>
        </Flex>
        <Flex justify="end" wrap="wrap" gap="2">
          <Button variant="soft" color="gray" onClick={onClose}>
            {copy.importLater}
          </Button>
          {canComplete ? (
            <>
              <Button variant="surface" color="gray" onClick={onOnline}>
                {t.fetchElevations}
              </Button>
              <Button ref={primaryAction} onClick={onFill}>
                {copy.importFillAction}
              </Button>
            </>
          ) : (
            <>
              {assessment.fillableGaps > 0 && (
                <Button variant="surface" color="gray" onClick={onFill}>
                  {copy.importPartialFill.replace('{filled}', String(assessment.fillableGaps))}
                </Button>
              )}
              <Button ref={primaryAction} onClick={onOnline}>
                {copy.importOnlineAction}
              </Button>
            </>
          )}
        </Flex>
      </Flex>
    </Modal>
  );
}
