import { Button, Callout, Flex, Text } from '@radix-ui/themes';
import { Modal } from '../../ui/Modal';
import { strings, type Lang } from '../../i18n/index';
import en from '../../i18n/en.workflow.json';
import zh from '../../i18n/zh-CN.workflow.json';

export const workflowStrings = { en, zh };

export function ElevationTools({
  lang,
  canFill,
  hasKnownHeights,
  summary,
  fillError,
  onFill,
  onOnline,
  onClose,
}: {
  lang: Lang;
  canFill: boolean;
  hasKnownHeights: boolean;
  summary?: string;
  fillError?: string;
  onFill: () => void;
  onOnline: () => void;
  onClose: () => void;
}) {
  const t = strings[lang];
  const copy = workflowStrings[lang];
  const feedback = fillError ?? summary;
  return (
    <Modal title={copy.elevationTools} onClose={onClose} maxWidth="480px">
      <Flex direction="column" gap="4">
        <Flex direction="column" align="start" gap="2">
          <Button variant="surface" color="gray" disabled={!canFill} onClick={onFill}>
            {t.interpolateGaps}
          </Button>
          <Text size="2" color="gray">
            {hasKnownHeights ? copy.fillHelp : copy.noKnownHeights}
          </Text>
        </Flex>
        {feedback && (
          <Callout.Root color={fillError ? 'red' : undefined} role={fillError ? 'alert' : 'status'}>
            <Callout.Text>{feedback}</Callout.Text>
          </Callout.Root>
        )}
        <Flex direction="column" align="start" gap="2">
          <Button variant="surface" color="gray" onClick={onOnline}>
            {t.fetchElevations}
          </Button>
          <Text size="2" color="gray">
            {copy.onlineHelp}
          </Text>
        </Flex>
        <Flex justify="end">
          <Button variant="soft" color="gray" onClick={onClose}>
            {t.close}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
