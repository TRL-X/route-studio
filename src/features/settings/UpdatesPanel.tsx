import { Button, Checkbox, Flex, Text } from '@radix-ui/themes';
import { useState } from 'react';
import { parenthetical, type Lang } from '../../i18n/index';
import type { UpdateControls } from './useUpdates';
import en from '../../i18n/en.updates.json';
import zh from '../../i18n/zh-CN.updates.json';

export const updateStrings = { en, zh };

export function UpdatesPanel({
  lang,
  updates,
  dirty,
  onSave,
  onBusyChange,
}: {
  lang: Lang;
  updates: UpdateControls;
  dirty: boolean;
  onSave: () => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = updateStrings[lang];
  const { state } = updates;
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [changingPreference, setChangingPreference] = useState(false);
  const disabled = !state || state.mode === 'disabled';
  const working = saving || state?.status === 'installing';
  async function install(save: boolean, discard: boolean) {
    if (working) return;
    setSaving(true);
    setSaveFailed(false);
    onBusyChange(true);
    try {
      if (save && !(await onSave())) {
        setSaveFailed(true);
        return;
      }
      const result = await updates.install(discard);
      if (result?.error === 'unsaved') setConfirm(true);
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }
  return (
    <Flex direction="column" gap="3" pt="4">
      <Text size="2">
        {t.currentVersion} {state?.currentVersion ?? '—'}
      </Text>
      <Text size="2" role="status" aria-live="polite">
        {disabled ? t.disabled : t[state.status]}
        {state?.release && parenthetical(lang, state.release.version)}
      </Text>
      {state?.status === 'downloading' && (
        <Flex direction="column" gap="1">
          <progress
            aria-label={t.downloading}
            max={100}
            value={state.percent ?? 0}
            style={{ width: '100%' }}
          />
          <Text size="1">{Math.floor(state.percent ?? 0)}%</Text>
        </Flex>
      )}
      {updates.unavailable && (
        <Text size="2" color="red" role="alert">
          {t.connectionError}
        </Text>
      )}
      {state?.error && (
        <Text size="2" color="red" role="alert">
          {t.errors[state.error]}
        </Text>
      )}
      {!!state?.release?.notes && (
        <details>
          <summary>{t.releaseNotes}</summary>
          <Text
            as="p"
            size="2"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 180, overflowY: 'auto' }}
          >
            {state.release.notes}
          </Text>
        </details>
      )}
      {state?.mode === 'manual' && (
        <Text size="2" color="gray">
          {window.routeStudioDesktop?.platform === 'darwin' ? t.macInstructions : t.linuxInstructions}
        </Text>
      )}
      <Flex gap="2" wrap="wrap">
        <Button
          type="button"
          variant="surface"
          disabled={
            disabled || working || ['checking', 'downloading', 'downloaded'].includes(state?.status ?? '')
          }
          onClick={() => void updates.check()}
        >
          {t.check}
        </Button>
        {state?.mode === 'manual' && state.release && (
          <Button type="button" onClick={() => void updates.open()}>
            {t.openDownload}
          </Button>
        )}
        {state?.mode === 'automatic' && state.release && ['available', 'error'].includes(state.status) && (
          <Button type="button" onClick={() => void updates.download()}>
            {state.error === 'download' ? t.retryDownload : t.download}
          </Button>
        )}
        {state?.status === 'downloaded' && !confirm && (
          <Button
            type="button"
            disabled={working}
            onClick={() => {
              if (dirty) setConfirm(true);
              else void install(false, false);
            }}
          >
            {t.install}
          </Button>
        )}
      </Flex>
      {confirm && state?.status === 'downloaded' && (
        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">
            {t.unsaved}
          </Text>
          {saveFailed && (
            <Text size="2" color="red" role="alert">
              {t.saveFailed}
            </Text>
          )}
          <Flex gap="2" wrap="wrap">
            <Button type="button" disabled={working} onClick={() => void install(true, false)}>
              {t.saveInstall}
            </Button>
            <Button
              type="button"
              variant="surface"
              color="gray"
              disabled={working}
              onClick={() => void install(false, true)}
            >
              {t.discardInstall}
            </Button>
            <Button
              type="button"
              variant="soft"
              color="gray"
              disabled={working}
              onClick={() => {
                setConfirm(false);
                setSaveFailed(false);
              }}
            >
              {t.cancel}
            </Button>
          </Flex>
        </Flex>
      )}
      <Text as="label" size="2">
        <Flex gap="2" align="center">
          <Checkbox
            checked={state?.autoCheck ?? true}
            disabled={disabled || changingPreference || working}
            onCheckedChange={async (value) => {
              setChangingPreference(true);
              try {
                await updates.setAutoCheck(value === true);
              } finally {
                setChangingPreference(false);
              }
            }}
          />
          {t.autoCheck}
        </Flex>
      </Text>
      <Text size="1" color="gray">
        {t.preferenceImmediate}
      </Text>
    </Flex>
  );
}
