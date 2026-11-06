import { Button, Callout, Checkbox, Flex, Progress, Text } from '@radix-ui/themes';
import { useRef, useState } from 'react';
import { FirmwareError } from '../../device/firmware';
import { DeviceError } from '../../device/mcumgr';
import { Modal } from '../../ui/Modal';
import type { Lang } from '../../i18n';
import type { FirmwareControls } from './useFirmware';
import en from '../../i18n/en.firmware.json';
import zh from '../../i18n/zh-CN.firmware.json';

export const firmwareStrings = { en, zh } satisfies Record<Lang, typeof en>;
function errorMessage(error: unknown, lang: Lang) {
  const t = firmwareStrings[lang];
  if (error instanceof FirmwareError) return t[error.code];
  if (error instanceof DeviceError) {
    if (error.kind === 'device')
      return t.deviceError.replace('{group}', String(error.group)).replace('{code}', String(error.rc));
    if (error.kind === 'disconnected') return t.disconnected;
    return error.kind === 'timeout' ? t.timeout : t.protocol;
  }
  return t.failed.replace('{error}', error instanceof Error ? error.message : String(error));
}

export function FirmwareDialog({
  firmware,
  lang,
  onClose,
}: {
  firmware: FirmwareControls;
  lang: Lang;
  onClose: () => void;
}) {
  const { session, state } = firmware;
  const t = firmwareStrings[lang];
  const [recoveryReady, setRecoveryReady] = useState(state.connected || state.pending);
  const [endingTask, setEndingTask] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const usb = state.mode === 'usb';
  const supported =
    window.isSecureContext && (usb ? !!navigator.serial?.requestPort : !!navigator.bluetooth?.requestDevice);
  const percent = Math.floor((state.off * 100) / Math.max(1, state.image?.size ?? 0));
  const current = state.images.find((image) => image.image === 0 && image.active);
  const canUpload = ['ready', 'paused'].includes(state.phase);
  const afterRestart = ['awaitingReconnect', 'unconfirmed', 'reverted', 'unknown', 'complete'].includes(
    state.phase,
  );
  const status = state.stopping
    ? t.pausing
    : state.busy === 'file'
      ? t.fileBusy
      : state.busy === 'uploading'
        ? t.uploading.replace('{percent}', String(percent))
        : state.busy === 'connecting'
          ? t.connecting
          : state.busy === 'checking'
            ? t.checking
            : state.busy === 'restarting'
              ? t.restarting
              : state.busy === 'confirming'
                ? t.confirming
                : state.phase === 'recovered' && state.recoveryRestarted
                  ? t.recoveryRestarted
                  : t[state.phase];
  return (
    <Modal title={usb ? t.usb : t.title} maxWidth="640px" onClose={onClose}>
      <Flex direction="column" gap="4">
        <Text size="2" color="gray">
          {t.intro}
        </Text>
        <Flex direction="column" gap="2" align="start">
          <Text size="2" weight="medium">
            {t.file}
          </Text>
          <input
            ref={picker}
            hidden
            type="file"
            accept=".bin"
            aria-label={t.file}
            disabled={!!state.busy || state.pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void session.selectFile(file);
            }}
          />
          <Button
            variant="surface"
            disabled={!!state.busy || state.pending}
            onClick={() => picker.current?.click()}
          >
            {t.chooseFile}
          </Button>
        </Flex>
        {state.image && (
          <Text size="2" style={{ overflowWrap: 'anywhere' }}>
            {t.fileInfo
              .replace('{name}', state.filename)
              .replace('{version}', state.image.version)
              .replace(
                '{size}',
                (state.image.size / 1024).toLocaleString(lang, { maximumFractionDigits: 1 }),
              )}
          </Text>
        )}
        {usb && (
          <Callout.Root color="amber">
            <Callout.Text>{t.recoveryHelp}</Callout.Text>
            <Text as="label" size="2">
              <Flex gap="2" align="start">
                <Checkbox
                  checked={recoveryReady}
                  disabled={!!state.busy}
                  onCheckedChange={(value) => setRecoveryReady(value === true)}
                />
                {t.recoveryReady}
              </Flex>
            </Text>
          </Callout.Root>
        )}
        {!supported && (
          <Text size="2" color="gray">
            {usb ? t.usbUnsupported : t.bleUnsupported}
          </Text>
        )}
        <Text size="2">
          {state.connected ? t.connected.replace('{name}', state.deviceName) : t.disconnected}
        </Text>
        {current && !usb && (
          <Text size="2" color="gray">
            {t.currentVersion.replace('{version}', current.version)}
          </Text>
        )}
        <Flex gap="2" wrap="wrap">
          {state.busy === 'connecting' ? (
            <Button color="gray" variant="soft" onClick={session.cancelConnection}>
              {t.cancelConnection}
            </Button>
          ) : !state.connected ? (
            <Button
              disabled={!!state.busy || !supported || (usb && !recoveryReady)}
              onClick={() => void (afterRestart && !usb ? session.check() : session.connect())}
            >
              {afterRestart && !usb ? t.reconnectCheck : usb ? t.connectUsb : t.connectBle}
            </Button>
          ) : (
            <Button
              color="gray"
              variant="soft"
              disabled={!!state.busy || state.pending}
              onClick={() => void session.disconnect()}
            >
              {t.disconnect}
            </Button>
          )}
          {state.connected && !usb && (
            <Button variant="surface" disabled={!!state.busy} onClick={() => void session.check()}>
              {t.check}
            </Button>
          )}
          {state.remembered && (
            <Button
              variant="soft"
              color="gray"
              disabled={!!state.busy || state.pending}
              onClick={() => {
                setRecoveryReady(false);
                void session.chooseAnother();
              }}
            >
              {t.another}
            </Button>
          )}
        </Flex>
        <Text size="2" role="status">
          {status}
        </Text>
        {(state.busy === 'uploading' || state.phase === 'paused') && (
          <Progress value={percent} aria-label={usb ? t.recover : t.upload} />
        )}
        {state.error !== undefined && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{errorMessage(state.error, lang)}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="2" wrap="wrap">
          {state.busy === 'uploading' ? (
            <Button color="gray" variant="soft" disabled={state.stopping} onClick={session.pause}>
              {t.pause}
            </Button>
          ) : (
            canUpload && (
              <Button
                disabled={
                  !!state.busy || !supported || !state.image || (usb && (!recoveryReady || !state.connected))
                }
                onClick={() => void (usb ? session.upload() : session.update())}
              >
                {usb
                  ? state.phase === 'paused'
                    ? t.resume
                    : t.recover
                  : state.phase === 'paused'
                    ? t.resumeUpdate
                    : t.startUpdate}
              </Button>
            )
          )}
          {!usb && state.phase === 'uploaded' && (
            <Button disabled={!!state.busy || !state.connected} onClick={() => void session.update()}>
              {t.testRestart}
            </Button>
          )}
          {!usb && state.phase === 'awaitingReconnect' && state.connected && (
            <Button disabled={!!state.busy} onClick={() => void session.restartPending()}>
              {t.restart}
            </Button>
          )}
          {!usb && state.phase === 'unconfirmed' && (
            <Button disabled={!!state.busy || !state.connected} onClick={() => void session.confirm()}>
              {t.confirm}
            </Button>
          )}
          {usb && state.phase === 'recovered' && state.connected && (
            <Button disabled={!!state.busy} onClick={() => void session.restartRecovery()}>
              {t.restart}
            </Button>
          )}
        </Flex>
        {endingTask && state.pending && !state.busy && (
          <Callout.Root color="amber">
            <Callout.Text>{t.endTaskHelp}</Callout.Text>
            <Flex gap="2" wrap="wrap">
              <Button color="gray" variant="soft" onClick={() => setEndingTask(false)}>
                {t.keepTask}
              </Button>
              <Button
                color="amber"
                onClick={() => {
                  session.abandon();
                  setEndingTask(false);
                }}
              >
                {t.endTask}
              </Button>
            </Flex>
          </Callout.Root>
        )}
        <Flex justify="between" gap="2" wrap="wrap">
          {state.pending && !state.busy && !endingTask && (
            <Button color="gray" variant="surface" onClick={() => setEndingTask(true)}>
              {t.endTask}…
            </Button>
          )}
          <Button color="gray" variant="soft" onClick={onClose}>
            {state.busy ? t.hide : t.close}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
