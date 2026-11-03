import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLDialogElement>(null);
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
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!visible || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [visible]);
  if (!api || !visible) return null;
  return (
    <dialog
      ref={ref}
      className="desktop-device-dialog"
      aria-labelledby="desktop-device-title"
      onCancel={(event) => {
        event.preventDefault();
        api.cancelBluetooth();
      }}
    >
      <h2 id="desktop-device-title">{pairing ? t.pair : t.selectDevice}</h2>
      {pairing ? (
        <>
          <p>{t.confirmPair.replace('{device}', pairing.deviceId)}</p>
          {pairing.pairingKind === 'confirmPin' && <p>{t.confirmPin.replace('{pin}', pairing.pin ?? '')}</p>}
          {pairing.pairingKind === 'providePin' && (
            <label>
              {t.providePin}
              <input
                autoFocus
                value={pin}
                inputMode="numeric"
                maxLength={16}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              />
            </label>
          )}
        </>
      ) : (
        <>
          <p role="status">{t.scanning}</p>
          <select
            size={6}
            aria-label={t.selectDevice}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="" disabled>
              {t.selectDevice}
            </option>
            {devices?.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.deviceName || t.unnamedDevice} ({device.deviceId})
              </option>
            ))}
          </select>
        </>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={() => api.cancelBluetooth()}>
          {t.cancel}
        </button>
        <button
          className="primary"
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
        </button>
      </div>
    </dialog>
  );
}
