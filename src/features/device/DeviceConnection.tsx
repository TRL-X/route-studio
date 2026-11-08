import { Button, Callout, Flex, Text } from '@radix-ui/themes';
import { Bluetooth, Cable } from 'lucide-react';
import { ConnectionSettings } from './ConnectionSettings';
import { transportSupported } from '../../device/config';
import { Modal } from '../../ui/Modal';
import { parenthetical, type Lang } from '../../i18n';
import type { ConnectionControls } from './useDevices';
import { deviceError, deviceStrings } from './deviceStrings';
import './device-dialog.css';

export function DeviceConnection({
  connection,
  lang,
  onClose,
}: {
  connection: ConnectionControls;
  lang: Lang;
  onClose: () => void;
}) {
  const { session, state } = connection;
  const t = deviceStrings[lang];
  const supported = transportSupported(state.transport);
  return (
    <Modal className="device-dialog" title={t.connectionTitle} maxWidth="480px" onClose={onClose}>
      <Flex direction="column" gap="4">
        <Text size="2" color="gray">
          {t.connectionHelp}
        </Text>
        <ConnectionSettings session={session} lang={lang} />
        <Text size="2" role="status">
          {state.busy
            ? t.connecting
            : state.connected
              ? t.connected.replace(
                  '{name}',
                  () =>
                    state.deviceName + parenthetical(lang, state.transport === 'usb' ? 'USB' : t.bluetooth),
                )
              : state.remembered
                ? t.disconnected
                : t.notConnected}
        </Text>
        {!supported && (
          <Text size="2" color="gray">
            {t.unsupported}
          </Text>
        )}
        <Flex gap="2" wrap="wrap">
          {state.busy ? (
            <Button variant="soft" color="gray" onClick={session.cancelConnection}>
              {t.cancelConnection}
            </Button>
          ) : state.connected ? (
            <Button variant="soft" color="gray" disabled={!!state.task} onClick={() => session.disconnect()}>
              {t.disconnect}
            </Button>
          ) : (
            <Button disabled={!supported || !!state.task} onClick={() => void session.connect()}>
              {state.transport === 'usb' ? <Cable size={16} /> : <Bluetooth size={16} />}
              {state.remembered ? t.reconnect : t.connect}
            </Button>
          )}
          {state.remembered && (
            <Button
              variant="soft"
              color="gray"
              disabled={!!state.busy || !!state.task}
              onClick={() => void session.connect(true)}
            >
              {t.another}
            </Button>
          )}
        </Flex>
        {state.task && (
          <Text size="2" color="gray">
            {t.taskLocked}
          </Text>
        )}
        {state.error !== undefined && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{deviceError(state.error, lang)}</Callout.Text>
          </Callout.Root>
        )}
        <Flex justify="end">
          <Button variant="soft" color="gray" onClick={onClose}>
            {state.busy ? t.hide : t.close}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
