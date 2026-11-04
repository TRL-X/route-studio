import { TextField, Button, Flex, Text, Separator } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';
import { Bluetooth } from 'lucide-react';
import { UploadError, withBluetoothFs } from '../device/mcumgr';
import { uploadFile, validDevicePath } from '../device/upload';
import type { Copy } from './strings';

export function DeviceUpload({
  bytes,
  t,
  onBusyChange,
}: {
  bytes?: Uint8Array;
  t: Copy;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const current = useRef<AbortController | null>(null);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
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
      <Button
        variant={expanded ? 'surface' : 'solid'}
        color={expanded ? 'gray' : undefined}
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? 'device-upload' : undefined}
        disabled={busy}
        onClick={() => setExpanded(!expanded)}
      >
        <Bluetooth />
        {t.bluetoothUpload}
      </Button>
      {expanded && (
        <Flex id="device-upload" direction="column" gap="2" width="100%">
          <Separator size="4" />
          {supported ? (
            <Flex asChild wrap="wrap" align="end" gap="2">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <Flex asChild direction="column" gap="1" flexGrow="1">
                  <label>
                    <Text size="2" color="gray">
                      {t.uploadPath}
                    </Text>
                    <TextField.Root
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
                </Flex>
                <Button type="submit" disabled={!bytes || !valid || busy}>
                  {t.uploadSend}
                </Button>
              </form>
            </Flex>
          ) : (
            <Text size="2" color="gray">
              {t.uploadUnsupported}
            </Text>
          )}
          <Text size="2" color="gray" role="status">
            {message}
          </Text>
        </Flex>
      )}
    </>
  );
}
