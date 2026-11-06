import { Button, Card, Checkbox, Spinner } from '@radix-ui/themes';
import { Check } from 'lucide-react';
import { Choice } from '../../ui/Choice';
import { Modal } from '../../ui/Modal';
import { strings, type Lang } from '../../i18n';
import type { useRouteFiles } from './useRouteFiles';

export function FileDialogs({ files, lang }: { files: ReturnType<typeof useRouteFiles>; lang: Lang }) {
  const t = strings[lang];
  const { busy, pending, setPending, replace, choices, setChoices, openFile } = files;
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
        <Modal className="dialog" title={t.discardTitle} onClose={() => setPending(null)}>
          <p>{t.replace}</p>
          <div className="dialog-actions">
            <Button
              variant="surface"
              color="gray"

              autoFocus
              onClick={() => setPending(null)}
            >
              {t.cancel}
            </Button>
            <Button variant="solid" color="blue" onClick={() => replace(pending)}>
              {t.confirm}
            </Button>
          </div>
        </Modal>
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
