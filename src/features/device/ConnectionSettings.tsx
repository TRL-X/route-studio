import { Button, Flex, Text, TextArea } from '@radix-ui/themes';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { parenthetical, type Lang } from '../../i18n';
import type { DeviceConnectionSession } from '../../device/connection-session';
import { defaultProfile, profileKey } from '../../device/config';
import { Choice } from '../../ui/Choice';
import { deviceStrings } from './deviceStrings';
import './connection-settings.css';

export function ConnectionSettings({
  session,
  lang,
  recovery = false,
}: {
  session: DeviceConnectionSession;
  lang: Lang;
  recovery?: boolean;
}) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const t = deviceStrings[lang];
  const id = useId();
  const [draft, setDraft] = useState(JSON.stringify(state.profile, null, 2));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(JSON.stringify(state.profile, null, 2));
    setError('');
  }, [state.profile]);
  const locked = !!state.busy || !!state.task;
  const settingsLocked = locked || state.connected;
  return (
    <Flex className="connection-settings" direction="column" gap="3">
      <div className="connection-settings-fields">
        {!recovery && (
          <Flex direction="column" gap="1" minWidth="0">
            <Text as="label" size="2" htmlFor={`${id}-transport`}>
              {t.transport}
            </Text>
            <Choice
              id={`${id}-transport`}
              value={state.mode === 'application' ? state.transport : 'recovery'}
              disabled={locked}
              onValueChange={(value) => session.select(value as 'ble' | 'usb')}
              options={[
                ...(state.mode === 'recovery'
                  ? [{ value: 'recovery', label: t.recoveryTask, disabled: true }]
                  : []),
                { value: 'ble', label: t.bluetooth },
                { value: 'usb', label: 'USB' },
              ]}
            />
          </Flex>
        )}
        <Flex direction="column" gap="1" minWidth="0">
          <Text as="label" size="2" htmlFor={`${id}-protocol`}>
            {t.smpVersion}
          </Text>
          <Choice
            id={`${id}-protocol`}
            value={state.profile.protocolVersion}
            disabled={settingsLocked}
            onValueChange={(value) => session.configure({ ...state.profile, protocolVersion: Number(value) })}
            options={[
              { value: 2, label: 'SMP v2' },
              { value: 1, label: 'SMP v1' },
            ]}
          />
        </Flex>
      </div>
      <details className="connection-settings-advanced">
        <summary>{t.connectionSettings}</summary>
        <Flex direction="column" gap="2" mt="2">
          <Text size="2" color="gray" id={`${id}-help`}>
            {state.busy
              ? t.connectingShort
              : state.task
                ? t.taskLocked
                : state.connected
                  ? t.settingsLocked
                  : t.settingsHelp}
          </Text>
          {state.parameters && (
            <Text size="2" color="gray">
              {t.bufferInfo
                .replace('{size}', String(state.parameters.bufferBytes))
                .replace(
                  '{count}',
                  state.parameters.bufferCount === undefined ? '—' : String(state.parameters.bufferCount),
                )}
              {parenthetical(
                lang,
                state.parameters.source === 'device' ? t.deviceParameters : t.profileParameters,
              )}
            </Text>
          )}
          <Flex direction="column" gap="1">
            <Text as="label" size="2" htmlFor={`${id}-profile`}>
              {t.profileJson}
            </Text>
            <TextArea
              id={`${id}-profile`}
              className="connection-settings-json"
              aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
              aria-invalid={!!error}
              value={draft}
              disabled={settingsLocked}
              rows={10}
              resize="vertical"
              spellCheck={false}
              autoCapitalize="none"
              onChange={(event) => {
                setDraft(event.target.value);
                setError('');
              }}
            />
          </Flex>
          {error && (
            <Text color="red" size="2" role="alert" id={`${id}-error`}>
              {t.invalidSettings.replace('{error}', error)}
            </Text>
          )}
          {!state.settingsSaved && (
            <Text color="amber" size="2">
              {t.settingsNotSaved}
            </Text>
          )}
          <Flex gap="2" wrap="wrap">
            <Button
              disabled={settingsLocked}
              onClick={() => {
                try {
                  session.configure(JSON.parse(draft));
                  setError('');
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : String(failure));
                }
              }}
            >
              {t.applySettings}
            </Button>
            <Button
              variant="soft"
              color="gray"
              disabled={settingsLocked}
              onClick={() =>
                setDraft(JSON.stringify(defaultProfile(profileKey(state.mode, state.transport)), null, 2))
              }
            >
              {t.defaultSettings}
            </Button>
          </Flex>
        </Flex>
      </details>
    </Flex>
  );
}
