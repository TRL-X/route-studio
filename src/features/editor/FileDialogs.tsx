import { Button, Card, Checkbox, Flex, Spinner, Text } from '@radix-ui/themes';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Choice } from '../../ui/Choice';
import { Modal } from '../../ui/Modal';
import { strings, type Copy, type Lang } from '../../i18n';
import type { useRouteFiles } from './useRouteFiles';

function ReplaceRouteDialog({
  t,
  title,
  recovered,
  saving,
  onSave,
  onContinue,
  onClose,
}: {
  t: Copy;
  title: string;
  recovered: boolean;
  saving: boolean;
  onSave: () => Promise<boolean>;
  onContinue: () => void;
  onClose: () => void;
}) {
  const desktop = !!window.routeStudioDesktop;
  const [status, setStatus] = useState<'downloadStarted' | 'unfinished' | null>(null);
  async function save() {
    setStatus(null);
    if (!(await onSave())) setStatus('unfinished');
    else if (desktop) onContinue();
    else setStatus('downloadStarted');
  }
  return (
    <Modal className="dialog" title={title} busy={saving} onClose={onClose}>
      <p>{recovered ? t.replaceRecovered : t.replace}</p>
      {status === 'downloadStarted' && <p role="status">{t.confirmDraftDownload}</p>}
      {status === 'unfinished' && (
        <Text as="p" color="red" role="alert">
          {t.draftSaveUnfinished}
        </Text>
      )}
      <Flex className="dialog-actions" wrap="wrap">
        <Button variant="surface" color="gray" autoFocus disabled={saving} onClick={onClose}>
          {t.cancel}
        </Button>
        {!recovered || status === 'downloadStarted' ? (
          <Button disabled={saving} onClick={onContinue}>
            {recovered ? t.continueDraftReplacement : t.confirm}
          </Button>
        ) : (
          <>
            <Button variant="soft" color="red" disabled={saving} onClick={onContinue}>
              {t.discardRecovered}
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {desktop ? t.saveAndReplaceDraft : t.downloadDraft}
            </Button>
          </>
        )}
      </Flex>
    </Modal>
  );
}

export function FileDialogs({ files, lang }: { files: ReturnType<typeof useRouteFiles>; lang: Lang }) {
  const t = strings[lang];
  const { busy, pending, setPending, replace, choices, setChoices, openFile, save, savingFile } = files;
  return (
    <>
      {busy && (
        <div className="overlay">
          <Card>
            <div className="processing" role="status">
              <Spinner />
              {t.busy}
            </div>
          </Card>
        </div>
      )}
      {pending && (
        <ReplaceRouteDialog
          t={t}
          title={pending.recovered && !pending.next.source ? t.discardTitleNew : t.discardTitle}
          recovered={pending.recovered}
          saving={savingFile}
          onSave={() => save({ showProblem: false })}
          onContinue={() => replace(pending.next)}
          onClose={() => setPending(null)}
        />
      )}
      {choices && (
        <Modal className="dialog" title={t.selectTrack} onClose={() => setChoices(null)}>
          <Choice
            autoFocus
            aria-label={t.route}
            value={choices.index}
            onValueChange={(value) => setChoices({ ...choices, index: Number(value), accept: true })}
            options={[
              ...choices.list.map((item, i) => ({
                value: i,
                label: (
                  <>
                    {item.name} · {item.pointCount} {t.vertices}
                  </>
                ),
              })),
            ]}
          />
          {choices.list[choices.index].hasUnconfirmedHeights && (
            <>
              <p>{t.unconfirmed}</p>
              <label className="check-field">
                <Checkbox
                  checked={choices.accept}
                  onCheckedChange={(value) => setChoices({ ...choices, accept: value === true })}
                />
                {t.acceptHeights}
              </label>
            </>
          )}
          <div className="dialog-actions">
            <Button variant="surface" color="gray" onClick={() => setChoices(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="solid"
              color="blue"

              onClick={() => void openFile(choices.file, choices.index, choices.accept)}
            >
              <Check />
              {t.open}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
