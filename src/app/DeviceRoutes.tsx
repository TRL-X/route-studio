import { Button, Flex, Text, Table, Badge, Callout, Progress } from '@radix-ui/themes';
import { useEffect, useState } from 'react';
import { Bluetooth, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { DeviceError } from '../device/mcumgr';
import type { DeviceControls } from './useDeviceRoutes';
import type { DeviceRoute } from '../device/routes';
import type { Lang } from './strings';
import { deviceError, deviceStrings } from './deviceStrings';
import './device-routes.css';

export function DeviceConnectionControls({ device, lang }: { device: DeviceControls; lang: Lang }) {
  const { state, session } = device;
  const t = deviceStrings[lang];
  if (!window.isSecureContext || !navigator.bluetooth?.requestDevice)
    return (
      <Text size="2" color="gray">
        {t.unsupported}
      </Text>
    );
  return (
    <Flex direction="column" gap="2">
      <Text size="2" role="status">
        {state.busy === 'connecting'
          ? t.connecting
          : state.connected
            ? t.connected.replace('{name}', state.deviceName)
            : state.remembered
              ? t.disconnected
              : t.connect}
      </Text>
      <Flex gap="2" wrap="wrap">
        {state.busy === 'connecting' ? (
          <Button variant="soft" color="gray" onClick={session.cancelConnection}>
            {t.cancelConnection}
          </Button>
        ) : state.connected ? (
          <Button variant="surface" disabled={!!state.busy} onClick={() => void session.refresh()}>
            <RefreshCw size={16} />
            {t.refresh}
          </Button>
        ) : (
          <Button disabled={!!state.busy} onClick={() => void session.connect()}>
            <Bluetooth size={16} />
            {state.remembered ? t.reconnect : t.connect}
          </Button>
        )}
        {state.connected && (
          <Button variant="soft" color="gray" disabled={!!state.busy} onClick={session.disconnect}>
            {t.disconnect}
          </Button>
        )}
        {state.remembered && (
          <Button
            variant="soft"
            color="gray"
            disabled={!!state.busy || state.pending}
            onClick={() => void session.connect(true)}
          >
            {t.another}
          </Button>
        )}
      </Flex>
      {state.status && (
        <Text size="2" color="gray">
          {t.capacity
            .replace('{count}', String(state.catalog?.items.length ?? state.status.count))
            .replace('{max}', String(state.status.maxFiles))
            .replace(
              '{free}',
              (Number(state.status.freeBytes) / 1048576).toLocaleString(lang, { maximumFractionDigits: 1 }),
            )}{' '}
          · {t.maxSize.replace('{size}', String(state.status.maxFileSize / 1048576))}
        </Text>
      )}
    </Flex>
  );
}

export function DeviceTransfer({
  device,
  lang,
  actions = true,
}: {
  device: DeviceControls;
  lang: Lang;
  actions?: boolean;
}) {
  const { state, session } = device;
  const t = deviceStrings[lang];
  const progress = state.progress;
  const percent = Math.floor(((progress?.off ?? 0) * 100) / Math.max(1, state.totalBytes));
  const message = state.cancelling
    ? t.cancelling
    : !state.busy && state.pending
      ? progress?.state === 'verifying'
        ? t.verifyPaused
        : t.paused
      : progress?.state === 'ready'
        ? t.done.replace('{name}', progress.name || t.unnamed)
        : progress?.state === 'receiving'
          ? t.receiving.replace('{percent}', String(percent))
          : progress
            ? t[progress.state]
            : '';
  return (
    <Flex direction="column" gap="2">
      {message && (
        <Text size="2" role="status">
          {message}
        </Text>
      )}
      {state.pending && progress?.state === 'receiving' && <Progress value={percent} aria-label={t.send} />}
      {state.error !== undefined && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{deviceError(state.error, lang)}</Callout.Text>
        </Callout.Root>
      )}
      {state.pending && actions && (
        <Flex gap="2" wrap="wrap">
          {!state.busy && (
            <Button onClick={() => void session.resume()}>
              {state.connected ? t.resume : t.reconnectResume}
            </Button>
          )}
          <Button
            variant="soft"
            color="gray"
            disabled={
              !state.connected ||
              state.cancelling ||
              progress?.state === 'verifying' ||
              (!!state.busy && state.busy !== 'uploading')
            }
            onClick={session.cancel}
          >
            {t.cancel}
          </Button>
        </Flex>
      )}
    </Flex>
  );
}

export function DeviceRoutes({
  device,
  lang,
  onClose,
  returnToExport = false,
}: {
  device: DeviceControls;
  lang: Lang;
  onClose: () => void;
  returnToExport?: boolean;
}) {
  const { state, session } = device;
  const t = deviceStrings[lang];
  const [deleting, setDeleting] = useState<{ item: DeviceRoute; rev: bigint } | null>(null);
  useEffect(() => {
    if (session.snapshot().connected) void session.refresh();
  }, [session]);
  return (
    <Modal title={t.title} maxWidth="760px" busy={!!state.busy} onClose={onClose}>
      <Flex direction="column" gap="4">
        <DeviceConnectionControls device={device} lang={lang} />
        <DeviceTransfer device={device} lang={lang} />
        {state.catalog && (
          <div className="device-route-list">
            {state.catalog.items.length === 0 ? (
              <Text size="2" color="gray">
                {t.empty}
              </Text>
            ) : (
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    {[t.name, t.distance, t.size, t.state, t.delete].map((label) => (
                      <Table.ColumnHeaderCell key={label}>{label}</Table.ColumnHeaderCell>
                    ))}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {state.catalog.items.map((item) => (
                    <Table.Row key={item.id}>
                      <Table.RowHeaderCell>
                        <span className="device-route-name">
                          {item.name ||
                            `${t.unnamed} · ${item.id.toString(16).toUpperCase().padStart(8, '0')}`}
                        </span>
                      </Table.RowHeaderCell>
                      <Table.Cell>
                        {(item.totalDm / 10000).toLocaleString(lang, { maximumFractionDigits: 2 })} km
                      </Table.Cell>
                      <Table.Cell>
                        {(item.size / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })} KiB
                      </Table.Cell>
                      <Table.Cell>
                        <Badge
                          color={item.inUse ? 'blue' : item.state === 'invalid' ? 'red' : 'gray'}
                          title={
                            item.error
                              ? deviceError(new DeviceError('device', 64, item.error), lang)
                              : undefined
                          }
                        >
                          {item.inUse ? t.inUse : t[item.state]}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Button
                          size="1"
                          variant="soft"
                          color="red"
                          aria-label={`${t.delete} ${item.name || item.id}`}
                          disabled={!!state.busy || state.pending || item.inUse}
                          onClick={() => setDeleting({ item, rev: state.catalog!.rev })}
                        >
                          {t.delete}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </div>
        )}
        {deleting && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{t.deletePrompt.replace('{name}', deleting.item.name || t.unnamed)}</Callout.Text>
            <Flex gap="2" wrap="wrap">
              <Button color="gray" variant="soft" onClick={() => setDeleting(null)} disabled={!!state.busy}>
                {t.keep}
              </Button>
              <Button
                color="red"
                disabled={!!state.busy || !state.connected}
                onClick={() => {
                  const target = deleting;
                  setDeleting(null);
                  void session.delete(target.item.id, target.rev);
                }}
              >
                {t.confirmDelete}
              </Button>
            </Flex>
          </Callout.Root>
        )}
        <Flex justify="end">
          <Button variant="soft" color="gray" disabled={!!state.busy} onClick={onClose}>
            {returnToExport ? t.backToExport : t.close}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
