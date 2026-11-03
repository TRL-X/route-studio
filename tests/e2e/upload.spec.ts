import { readFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { decode, encode } from 'cborg';
import { expect, test } from '@playwright/test';
import { download, open, openExport } from './files';

test('sends the download bytes through SMP, handles disconnection, and verifies the device checksum', async ({
  page,
}) => {
  let pending = Buffer.alloc(0);
  let stored = Buffer.alloc(0);
  let disconnectOnWrite = true;
  let corruptChecksum = true;
  await page.exposeFunction('smpFragment', (fragment: number[]) => {
    expect(fragment.length).toBeLessThanOrEqual(20);
    pending = Buffer.concat([pending, Buffer.from(fragment)]);
    if (pending.length < 8 || pending.length < pending.readUInt16BE(2) + 8) return [];
    const frame = pending;
    pending = Buffer.alloc(0);
    expect(frame.length).toBe(frame.readUInt16BE(2) + 8);
    expect(frame.readUInt16BE(4)).toBe(8);
    const cmd = frame[7];
    expect(frame[0]).toBe(cmd === 0 ? 0x0a : 0x08);
    const fields = decode(frame.subarray(8));
    expect(fields.name).toBe('/SD:/ROUTES/TEST.RTE');
    let reply;
    if (cmd === 1) {
      reply = stored.length ? { len: stored.length } : { err: { group: 8, rc: 3 } };
    } else if (cmd === 0) {
      if (disconnectOnWrite) {
        disconnectOnWrite = false;
        return null;
      }
      expect(fields.off).toBe(stored.length);
      stored = Buffer.concat([stored, fields.data]);
      reply = { off: stored.length };
    } else {
      expect(cmd).toBe(2);
      expect(fields.type).toBe('crc32');
      reply = { type: 'crc32', len: stored.length, output: corruptChecksum ? 0 : crc32(stored) };
    }
    // Zephyr may send an indefinite-length CBOR map split across notifications.
    const encoded = Buffer.concat([Buffer.from([0xbf]), encode(reply).subarray(1), Buffer.from([0xff])]);
    const header = Buffer.from(frame.subarray(0, 8));
    header[0] += 1;
    header.writeUInt16BE(encoded.length, 2);
    return Array.from(Buffer.concat([header, encoded]));
  });
  await page.addInitScript(() => {
    const device = new EventTarget();
    class Channel extends EventTarget {
      value?: DataView;
      async startNotifications() {
        return this;
      }
      async writeValueWithoutResponse(bytes: Uint8Array) {
        const bridge = window as unknown as { smpFragment(data: number[]): Promise<number[] | null> };
        const result = await bridge.smpFragment(Array.from(bytes));
        if (result === null) {
          device.dispatchEvent(new Event('gattserverdisconnected'));
          return;
        }
        for (let i = 0; i < result.length; i += 6) {
          this.value = new DataView(Uint8Array.from(result.slice(i, i + 6)).buffer);
          this.dispatchEvent(new Event('characteristicvaluechanged'));
        }
      }
    }
    const channel = new Channel();
    const service = {
      getCharacteristic: async (id: string) => {
        if (id !== 'da2e7828-fbce-4e01-ae9e-261174997c48') throw new Error('Wrong characteristic');
        return channel;
      },
    };
    const serviceId = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
    const server = {
      getPrimaryService: async (id: string) => {
        if (id !== serviceId) throw new Error('Wrong service');
        return service;
      },
    };
    Object.assign(device, { gatt: { connect: async () => server, disconnect: () => {} } });
    Object.defineProperty(navigator, 'bluetooth', {
      value: {
        requestDevice: async (options: RequestDeviceOptions) => {
          if (
            !navigator.userActivation.isActive ||
            !('filters' in options) ||
            options.filters[0]?.services?.[0] !== serviceId
          )
            throw new Error('Missing user gesture or service filter');
          return device;
        },
      },
    });
  });
  await page.goto('/');
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const local = await download(page, 'Download RTE');
  const dialog = await openExport(page);
  const toggle = dialog.getByRole('button', { name: 'Bluetooth upload…' });
  const path = dialog.getByLabel('Device path');
  const send = dialog.getByRole('button', { name: 'Select device and upload' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(path).toBeHidden();
  await expect(send).toBeHidden();
  await toggle.click();
  await expect(path).toBeFocused();
  expect(await path.getAttribute('placeholder')).toBeNull();
  await expect(path).toHaveAccessibleDescription('');
  await expect(send).toBeDisabled();
  await path.fill('/SD:/ROUTES/');
  await expect(send).toBeDisabled();
  await path.fill('/SD:/ROUTES/TEST.RTE');
  await toggle.click();
  await expect(path).toBeHidden();
  await toggle.click();
  await expect(path).toHaveValue('/SD:/ROUTES/TEST.RTE');
  await send.click();
  await expect(dialog.getByText(/device disconnected/i)).toBeVisible();
  await send.click();
  await expect(dialog.getByText(/failed length or CRC32 verification/i)).toBeVisible();
  expect(stored).toEqual(local.bytes);
  corruptChecksum = false;
  await send.click();
  await expect(
    dialog.getByText(
      'Device file verified · CRC32 ' + crc32(stored).toString(16).toUpperCase().padStart(8, '0'),
    ),
  ).toBeVisible();
});
