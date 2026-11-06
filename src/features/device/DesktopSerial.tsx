import { Button, Flex, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Choice } from '../../ui/Choice';
import type { SerialChoice } from '../../../electron/contracts';
import type { Lang } from '../../i18n/index';
import en from '../../i18n/en.serial.json';
import zh from '../../i18n/zh-CN.serial.json';

export function DesktopSerial({ lang }: { lang: Lang }) {
  const api = window.routeStudioDesktop;
  const t = lang === 'zh' ? zh : en;
  const [ports, setPorts] = useState<SerialChoice[] | null>(null);
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (!api) return;
    const unsubscribe = api.onSerialPorts((next) => {
      setPorts(next);
      setSelected((previous) => (next?.some((port) => port.portId === previous) ? previous : ''));
    });
    return () => {
      unsubscribe();
      api.cancelSerial();
    };
  }, [api]);
  if (!api || ports === null) return null;
  return (
    <Modal maxWidth="480px" title={t.title} onClose={api.cancelSerial}>
      <Flex direction="column" gap="3">
        <Text size="2" role="status">
          {ports.length ? t.choose : t.empty}
        </Text>
        <Choice
          placeholder={t.port}
          aria-label={t.port}
          value={selected}
          onValueChange={setSelected}
          options={ports.map((port) => ({
            value: port.portId,
            label: port.displayName ? `${port.displayName} (${port.portName})` : port.portName,
          }))}
        />
        <Flex justify="end" gap="2">
          <Button variant="soft" color="gray" onClick={api.cancelSerial}>
            {t.cancel}
          </Button>
          <Button disabled={!selected} onClick={() => api.selectSerialPort(selected)}>
            {t.connect}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
