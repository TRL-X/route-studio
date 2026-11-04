import { Modal } from './Modal';
import { Choice } from './Choice';
import { TextField, Button, Flex } from '@radix-ui/themes';
import { useEffect, useState } from 'react';
import type { BluetoothChoice, PairingRequest } from '../../electron/contracts';
import en from '../i18n/en.desktop.json';
import zh from '../i18n/zh-CN.desktop.json';
import type { Lang } from './strings';

export function DesktopBluetooth({ lang }: { lang: Lang }) {
  const api = window.routeStudioDesktop;
  const t = lang === 'zh' ? zh : en;
  const [devices, setDevices] = useState<BluetoothChoice[] | null>(null);
  const [pairing, setPairing] = useState<PairingRequest | null>(null);
  const [selected, setSelected] = useState('');
  const [pin, setPin] = useState('');
  const visible = devices !== null || pairing !== null;
  useEffect(() => {
    if (!api) return;
    const unsubscribeDevices = api.onBluetoothDevices((next) => {
      setDevices(next);
      setSelected((previous) => (next?.some((device) => device.deviceId === previous) ? previous : ''));
    });
    const unsubscribePairing = api.onBluetoothPairing((next) => {
      setPairing(next);
      setPin('');
    });
    return () => {
      unsubscribeDevices();
      unsubscribePairing();
      api.cancelBluetooth();
    };
  }, [api]);
  if (!api || !visible) return null;
  return (
    <Modal maxWidth="480px" title={pairing ? t.pair : t.selectDevice} onClose={() => api.cancelBluetooth()}>
      <Flex direction="column" gap="3">
        {pairing ? (
          <>
            <p>{t.confirmPair.replace('{device}', pairing.deviceId)}</p>
            {pairing.pairingKind === 'confirmPin' && (
              <p>{t.confirmPin.replace('{pin}', pairing.pin ?? '')}</p>
            )}
            {pairing.pairingKind === 'providePin' && (
              <label>
                {t.providePin}
                <TextField.Root
                  autoFocus
                  value={pin}
                  inputMode="numeric"
                  maxLength={16}
                  mt="2"
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                />
              </label>
            )}
          </>
        ) : (
          <>
            <p role="status">{t.scanning}</p>
            <Choice
              placeholder={t.selectDevice}
              aria-label={t.selectDevice}
              value={selected}
              onValueChange={(value) => setSelected(value)}
              options={[
                ...(devices ?? []).map((device) => ({
                  value: device.deviceId,
                  label: (
                    <>
                      {device.deviceName || t.unnamedDevice} ({device.deviceId})
                    </>
                  ),
                })),
              ]}
            />
          </>
        )}
        <Flex justify="end" gap="2" mt="2">
          <Button variant="soft" color="gray" onClick={() => api.cancelBluetooth()}>
            {t.cancel}
          </Button>
          <Button
            disabled={pairing ? pairing.pairingKind === 'providePin' && !pin : !selected}
            onClick={() => {
              if (pairing)
                api.respondBluetoothPairing({
                  confirmed: true,
                  ...(pairing.pairingKind === 'providePin' ? { pin } : {}),
                });
              else api.selectBluetoothDevice(selected);
            }}
          >
            {t.connect}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
