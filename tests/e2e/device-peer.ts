import { decode, encode } from 'cborg';
import { expect, type Page } from '@playwright/test';
import { Firmware } from '../device/firmware';
import { SerialDecoder, encodeSerialPacket } from '../../src/device/serial';
import { DeviceError } from '../../src/device/mcumgr';

export async function devicePeer(page: Page, firmware: Firmware) {
  let pending = Buffer.alloc(0);
  async function respond(frame: Buffer) {
    const fields = decode(frame.subarray(8), { allowBigInt: true });
    let reply;
    try {
      reply = await firmware.request(
        frame.readUInt16BE(4),
        frame[7],
        (frame[0] & 7) === 2 ? 'write' : 'read',
        fields,
      );
    } catch (error) {
      if (error instanceof DeviceError && error.kind === 'disconnected') return null;
      throw error;
    }
    const body = encode(reply);
    const encoded = Buffer.concat([Buffer.from([0xbf]), body.subarray(1), Buffer.from([0xff])]);
    const header = Buffer.from(frame.subarray(0, 8));
    header[0]++;
    header.writeUInt16BE(encoded.length, 2);
    return Array.from(Buffer.concat([header, encoded]));
  }
  await page.exposeFunction('smpFragment', async (fragment: number[]) => {
    expect(fragment.length).toBeLessThanOrEqual(20);
    pending = Buffer.concat([pending, Buffer.from(fragment)]);
    if (pending.length < 8 || pending.length < pending.readUInt16BE(2) + 8) return [];
    const frame = pending;
    pending = Buffer.alloc(0);
    return respond(frame);
  });
  let decoder = new SerialDecoder();
  await page.exposeFunction('routeSerialOpen', () => {
    decoder = new SerialDecoder();
  });
  await page.exposeFunction('routeSerialFragment', async (fragment: number[]) => {
    const output: number[] = [];
    for (const packet of decoder.push(Uint8Array.from(fragment))) {
      const reply = await respond(Buffer.from(packet));
      if (reply === null) return null;
      for (const line of encodeSerialPacket(Uint8Array.from(reply))) output.push(...line);
    }
    return output;
  });
  await page.addInitScript(() => {
    const device = new EventTarget();
    class Channel extends EventTarget {
      value?: DataView;
      async startNotifications() {
        return this;
      }
      async writeValueWithoutResponse(bytes: Uint8Array) {
        const result = await (
          window as unknown as { smpFragment(data: number[]): Promise<number[] | null> }
        ).smpFragment(Array.from(bytes));
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
    const serviceId = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
    Object.assign(device, {
      id: 'arcap',
      name: 'AR Cap',
      gatt: {
        connect: async () => ({
          getPrimaryService: async (id: string) => {
            if (id !== serviceId) throw new Error('Wrong service');
            return {
              getCharacteristic: async (id: string) => {
                if (id !== 'da2e7828-fbce-4e01-ae9e-261174997c48') throw new Error('Wrong characteristic');
                return channel;
              },
            };
          },
        }),
        disconnect: () => {},
      },
    });
    Object.defineProperty(navigator, 'bluetooth', {
      value: {
        requestDevice: async (options: RequestDeviceOptions) => {
          if (
            !navigator.userActivation.isActive ||
            !('filters' in options) ||
            options.filters[0]?.services?.[0] !== serviceId
          )
            throw new Error('Missing user gesture or filter');
          return device;
        },
      },
    });
    const serialApi = window as unknown as {
      routeSerialOpen(): Promise<void>;
      routeSerialFragment(bytes: number[]): Promise<number[] | null>;
    };
    const port = new EventTarget();
    let readable: ReadableStream<Uint8Array> | null = null;
    let writable: WritableStream<Uint8Array> | null = null;
    Object.defineProperties(port, { readable: { get: () => readable }, writable: { get: () => writable } });
    Object.assign(port, {
      getInfo: () => ({}),
      setSignals: async () => {},
      open: async () => {
        await serialApi.routeSerialOpen();
        let controller: ReadableStreamDefaultController<Uint8Array>;
        readable = new ReadableStream({
          start: (value) => {
            controller = value;
          },
        });
        writable = new WritableStream({
          write: async (bytes: Uint8Array) => {
            const reply = await serialApi.routeSerialFragment(Array.from(bytes));
            if (reply === null) {
              controller.close();
              port.dispatchEvent(new Event('disconnect'));
            } else if (reply.length) controller.enqueue(Uint8Array.from(reply));
          },
        });
      },
      close: async () => {
        readable = null;
        writable = null;
      },
    });
    Object.defineProperty(navigator, 'serial', {
      value: {
        requestPort: async () => {
          if (!navigator.userActivation.isActive) throw new Error('Missing user gesture');
          return port;
        },
      },
    });
  });
}
