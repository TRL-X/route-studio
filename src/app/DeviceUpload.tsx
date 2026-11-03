import { useEffect, useRef, useState } from 'react';
import { Bluetooth } from 'lucide-react';
import { UploadError, withBluetoothFs } from '../device/mcumgr';
import { uploadFile, validDevicePath } from '../device/upload';
import type { Copy } from './strings';

export function DeviceUpload({ bytes, t }: { bytes?: Uint8Array; t: Copy }) {
  const [expanded, setExpanded] = useState(false);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const current = useRef<AbortController | null>(null);
  const supported = window.isSecureContext && !!navigator.bluetooth?.requestDevice;
  const name = path.trim();
  const valid = validDevicePath(name);
  useEffect(() => {
    setBusy(false);
    setMessage('');
    return () => {
      current.current?.abort();
      current.current = null;
    };
  }, [bytes]);

  async function send() {
    if (!bytes || !valid || current.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    current.current = controller;
    setBusy(true);
    setMessage(t.uploadConnecting);
    try {
      const crc = await withBluetoothFs(signal, (request) =>
        uploadFile(request, name, bytes, (off) => {
          if (!signal.aborted)
            setMessage(
              off === bytes.length
                ? t.uploadVerify
                : t.uploadProgress.replace('{percent}', String(Math.floor((off * 100) / bytes.length))),
            );
        }),
      );
      if (!signal.aborted) setMessage(t.uploadDone.replace('{crc}', crc));
    } catch (error) {
      if (!signal.aborted) {
        setMessage(
          error instanceof UploadError
            ? t[error.key].replace('{code}', error.detail)
            : t.uploadFailed.replace('{error}', error instanceof Error ? error.message : String(error)),
        );
      }
    } finally {
      if (current.current === controller) {
        current.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        className={expanded ? 'button' : 'primary'}
        aria-expanded={expanded}
        aria-controls={expanded ? 'device-upload' : undefined}
        disabled={busy}
        onClick={() => setExpanded(!expanded)}
      >
        <Bluetooth />
        {t.bluetoothUpload}
      </button>
      {expanded && (
        <div id="device-upload" className="device-upload">
          {supported ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label className="export-field">
                {t.uploadPath}
                <input
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value);
                    setMessage('');
                  }}
                  autoFocus
                  disabled={busy}
                  aria-invalid={!!name && !valid}
                />
              </label>
              <button type="submit" className="primary" disabled={!bytes || !valid || busy}>
                {t.uploadSend}
              </button>
            </form>
          ) : (
            <small>{t.uploadUnsupported}</small>
          )}
          <small role="status">{message}</small>
        </div>
      )}
    </>
  );
}
