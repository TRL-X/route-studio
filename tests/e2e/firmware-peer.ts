import { createHash } from 'node:crypto';
import { decode, encode } from 'cborg';
import { expect, type Page } from '@playwright/test';

export function firmwareFile() {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0x96f3b83d);
  header.writeUInt16LE(header.length, 8);
  const payload = Buffer.alloc(1300, 0x5a);
  header.writeUInt32LE(payload.length, 12);
  header[20] = 2;
  header[21] = 1;
  header.writeUInt32LE(3, 24);
  const body = Buffer.concat([header, payload]);
  const hash = createHash('sha256').update(body).digest();
  const tlv = Buffer.alloc(8);
  tlv.writeUInt16LE(0x6907);
  tlv.writeUInt16LE(40, 2);
  tlv.writeUInt16LE(0x10, 4);
  tlv.writeUInt16LE(hash.length, 6);
  return {
    file: {
      name: 'firmware.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.concat([body, tlv, hash]),
    },
    hash,
  };
}

type Fields = Record<string, unknown>;
export class FirmwarePeer {
  calls: { group: number; command: number; op: number; fields: Fields; transport: string }[] = [];
  received = Buffer.alloc(0);
  dropUploadAck = false;
  rollback = false;
  selfConfirm = false;
  confirmed = false;
  booted = false;
  restarted = false;
  tested = false;
  readonly oldHash = Buffer.alloc(32, 0x11);
  readonly target = firmwareFile();

  request(group: number, command: number, op: number, fields: Fields, transport: string): Fields | null {
    this.calls.push({ group, command, op, fields, transport });
    if (group === 0 && command === 6 && op === 0) return { buf_size: 1024, buf_count: 4 };
    if (group === 1 && command === 0 && op === 0) return { images: this.images() };
    if (group === 1 && command === 1 && op === 2) {
      const off = fields.off as number;
      const data = Buffer.from(fields.data as Uint8Array);
      if (off === 0 && this.received.length > 0) return { off: this.received.length };
      expect(off).toBe(this.received.length);
      if (off === 0) {
        expect(fields.len).toBe(this.target.file.buffer.length);
        expect(Buffer.from(fields.sha as Uint8Array)).toEqual(
          createHash('sha256').update(this.target.file.buffer).digest(),
        );
      }
      this.received = Buffer.concat([this.received, data]);
      if (this.dropUploadAck) {
        this.dropUploadAck = false;
        return null;
      }
      return { off: this.received.length };
    }
    if (group === 1 && command === 0 && op === 2) {
      if (fields.confirm === true) {
        expect(this.booted).toBe(true);
        if (fields.hash) expect(Buffer.from(fields.hash as Uint8Array)).toEqual(this.target.hash);
        this.confirmed = true;
      } else {
        expect(this.received).toEqual(this.target.file.buffer);
        expect(Buffer.from(fields.hash as Uint8Array)).toEqual(this.target.hash);
        this.tested = true;
      }
      return { images: this.images() };
    }
    if (group === 0 && command === 5 && op === 2) {
      expect(this.received).toEqual(this.target.file.buffer);
      this.restarted = true;
      this.booted = !this.rollback;
      this.confirmed = this.selfConfirm;
      return {};
    }
    throw new Error(`Unexpected firmware command ${group}/${command}/${op}`);
  }

  private images() {
    const original = {
      image: 0,
      slot: this.booted ? 1 : 0,
      version: '1.0.0',
      hash: this.oldHash,
      active: !this.booted,
      confirmed: !this.booted,
      bootable: true,
    };
    if (this.received.length !== this.target.file.buffer.length) return [original];
    return [
      original,
      {
        image: 0,
        slot: this.booted ? 0 : 1,
        version: '2.1.0.3',
        hash: this.target.hash,
        active: this.booted,
        pending: this.tested && !this.booted && !this.restarted,
        confirmed: this.confirmed,
        bootable: true,
      },
    ];
  }
}

function crc16(bytes: Uint8Array) {
  let crc = 0;
  for (const value of bytes) {
    crc ^= value << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}

export async function firmwarePeer(page: Page, peer: FirmwarePeer) {
  let ble = Buffer.alloc(0);
  let serialLine = Buffer.alloc(0);
  let serialPacket = Buffer.alloc(0);
  let serialLength = 0;
  function respond(frame: Buffer, transport: string) {
    const fields = decode(frame.subarray(8)) as Fields;
    const reply = peer.request(frame.readUInt16BE(4), frame[7], frame[0] & 7, fields, transport);
    if (reply === null) return null;
    const body = encode(reply);
    const header = Buffer.from(frame.subarray(0, 8));
    header[0]++;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  await page.exposeFunction('firmwareWire', (transport: string, fragment: number[]) => {
    if (transport === 'ble') {
      expect(fragment.length).toBeLessThanOrEqual(20);
      ble = Buffer.concat([ble, Buffer.from(fragment)]);
      if (ble.length < 8 || ble.length < ble.readUInt16BE(2) + 8) return [];
      const frame = ble;
      ble = Buffer.alloc(0);
      const reply = respond(frame, transport);
      return reply === null ? null : Array.from(reply);
    }
    serialLine = Buffer.concat([serialLine, Buffer.from(fragment)]);
    const output: Buffer[] = [];
    while (serialLine.includes(10)) {
      const end = serialLine.indexOf(10);
      const line = serialLine.subarray(0, end);
      serialLine = serialLine.subarray(end + 1);
      expect(line.length + 1).toBeLessThanOrEqual(127);
      const payload = Buffer.from(line.subarray(2).toString(), 'base64');
      if (line[0] === 6 && line[1] === 9) {
        serialLength = payload.readUInt16BE();
        serialPacket = payload.subarray(2);
      } else {
        expect(Array.from(line.subarray(0, 2))).toEqual([4, 20]);
        serialPacket = Buffer.concat([serialPacket, payload]);
      }
      if (serialPacket.length < serialLength) continue;
      expect(serialPacket.length).toBe(serialLength);
      expect(crc16(serialPacket)).toBe(0);
      const reply = respond(serialPacket.subarray(0, -2), transport);
      serialPacket = Buffer.alloc(0);
      if (reply === null) return null;
      const length = Buffer.alloc(2);
      length.writeUInt16BE(reply.length + 2);
      const crc = Buffer.alloc(2);
      crc.writeUInt16BE(crc16(reply));
      const packet = Buffer.concat([length, reply, crc]);
      for (let offset = 0; offset < packet.length; offset += 45) {
        output.push(
          Buffer.concat([
            Buffer.from(offset === 0 ? [6, 9] : [4, 20]),
            Buffer.from(packet.subarray(offset, offset + 45).toString('base64') + '\n'),
          ]),
        );
      }
    }
    return Array.from(Buffer.concat(output));
  });
  await page.addInitScript(() => {
    const exchange = (transport: string, bytes: Uint8Array) =>
      (
        window as unknown as { firmwareWire(mode: string, data: number[]): Promise<number[] | null> }
      ).firmwareWire(transport, Array.from(bytes));
    const device = new EventTarget();
    class Channel extends EventTarget {
      value?: DataView;
      async startNotifications() {
        return this;
      }
      async writeValueWithoutResponse(bytes: Uint8Array) {
        const reply = await exchange('ble', bytes);
        if (reply === null) {
          device.dispatchEvent(new Event('gattserverdisconnected'));
          return;
        }
        for (let offset = 0; offset < reply.length; offset += 7) {
          this.value = new DataView(Uint8Array.from(reply.slice(offset, offset + 7)).buffer);
          this.dispatchEvent(new Event('characteristicvaluechanged'));
        }
      }
    }
    const channel = new Channel();
    Object.assign(device, {
      id: 'smp-peripheral',
      name: 'SMP peripheral',
      gatt: {
        connect: async () => ({
          getPrimaryService: async (service: string) => {
            if (service !== '8d53dc1d-1db7-4cd3-868b-8a527460aa84') throw new Error('Unexpected service');
            return { getCharacteristic: async () => channel };
          },
        }),
        disconnect: () => {},
      },
    });
    Object.defineProperty(navigator, 'bluetooth', {
      value: {
        requestDevice: async () => {
          if (!navigator.userActivation.isActive) throw new Error('Missing user gesture');
          return device;
        },
      },
    });
    const port = new EventTarget();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let readable: ReadableStream<Uint8Array> | null = null;
    let writable: WritableStream<Uint8Array> | null = null;
    Object.defineProperties(port, {
      readable: { get: () => readable },
      writable: { get: () => writable },
    });
    Object.assign(port, {
      getInfo: () => ({}),
      setSignals: async () => {},
      open: async () => {
        readable = new ReadableStream({
          start: (next) => {
            controller = next;
          },
        });
        writable = new WritableStream({
          write: async (bytes: Uint8Array) => {
            const reply = await exchange('usb', bytes);
            if (reply === null) {
              controller!.close();
              port.dispatchEvent(new Event('disconnect'));
              return;
            }
            for (let offset = 0; offset < reply.length; offset += 11)
              controller!.enqueue(Uint8Array.from(reply.slice(offset, offset + 11)));
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
