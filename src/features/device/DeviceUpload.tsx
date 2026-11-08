import { Button, Flex, Text } from '@radix-ui/themes';
import { useMemo } from 'react';
import { Send, Check } from 'lucide-react';
import { DeviceTransfer } from './DeviceRoutes';
import { deviceStrings } from './deviceStrings';
import type { DeviceControls } from './useDeviceRoutes';
import type { Lang } from '../../i18n/index';

export function DeviceUpload({
  bytes,
  device,
  lang,
  onManage,
  onStart,
}: {
  bytes?: Uint8Array;
  device: DeviceControls;
  lang: Lang;
  onManage: () => void;
  onStart?: () => void;
}) {
  const { state, session } = device;
  const t = deviceStrings[lang];
  const supported = session.supported();
  // The preview can be regenerated when returning from device management. Only show
  // success for the exact payload that was sent, not another route or set of options.
  const samePayload = useMemo(
    () =>
      !!bytes &&
      !!state.transferBytes &&
      bytes.length === state.transferBytes.length &&
      bytes.every((v, i) => v === state.transferBytes![i]),
    [bytes, state.transferBytes],
  );
  const showTransfer = samePayload || state.pending;
  const done = samePayload && state.progress?.state === 'ready';
  const verifying = state.pending && state.progress?.state === 'verifying';
  const label =
    state.busy === 'connecting'
      ? t.connectingShort
      : verifying && state.busy === 'uploading'
        ? t.verifying
        : state.busy === 'uploading'
          ? t.sending
          : state.pending
            ? state.connected
              ? verifying
                ? t.checkResult
                : t.resume
              : t.reconnectResume
            : done
              ? t.sentTo.replace('{name}', state.deviceName)
              : state.connected
                ? t.sendTo.replace('{name}', state.deviceName)
                : t.connectSend;
  return (
    <>
      <Button
        className="device-send"
        title={label}
        disabled={!supported || !!state.busy || (!state.pending && (!bytes || done))}
        onClick={() => {
          if (state.pending) void session.resume();
          else if (bytes) {
            onStart?.();
            void session.send(bytes);
          }
        }}
      >
        {done ? <Check /> : <Send />}
        <span>{label}</span>
      </Button>
      {(!supported || showTransfer || state.busy === 'connecting') && (
        <Flex className="device-upload-status" direction="column" gap="2" width="100%">
          {!supported && (
            <Text size="2" color="gray">
              {t.unsupported}
            </Text>
          )}
          {state.busy === 'connecting' && (
            <>
              <Text size="2" role="status">
                {t.connecting}
              </Text>
              <Button variant="soft" color="gray" onClick={session.cancelConnection}>
                {t.cancelConnection}
              </Button>
            </>
          )}
          {showTransfer && <DeviceTransfer device={device} lang={lang} actions={false} />}
          <Flex gap="3" wrap="wrap" align="center">
            {state.pending && state.busy !== 'connecting' && (
              <Button
                variant="soft"
                color="gray"
                disabled={!state.connected || state.cancelling || verifying}
                onClick={session.cancel}
              >
                {t.cancel}
              </Button>
            )}
            {(done || state.error !== undefined) && (
              <Button
                className="device-manage-link"
                variant="ghost"
                color="gray"
                disabled={!!state.busy}
                onClick={onManage}
              >
                {done ? t.viewRoutes : t.manageRoutes}
              </Button>
            )}
          </Flex>
        </Flex>
      )}
    </>
  );
}
