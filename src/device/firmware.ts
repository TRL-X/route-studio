import { DEFAULT_PROFILE, type ConnectionProfile } from './config';
import { fitData } from './smp';
import { checked, DeviceError, record, type Fields, type SmpRequest } from './mcumgr';

export const MAX_FIRMWARE_SIZE = DEFAULT_PROFILE.maxFirmwareBytes;

export class FirmwareError extends Error {
  constructor(
    readonly code:
      | 'bootTimeout'
      | 'invalidFile'
      | 'unsupportedImage'
      | 'hashMismatch'
      | 'uploadStalled'
      | 'uploadMismatch'
      | 'unconfirmedImage',
  ) {
    super(code);
  }
}

export interface FirmwareImage {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly version: string;
  readonly uploadHash: Uint8Array<ArrayBuffer>;
  readonly imageHash: Uint8Array<ArrayBuffer>;
  readonly size: number;
}

export function sameHash(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Checks the MCUboot container and digest; the bootloader verifies its signature. */
export async function parseFirmware(input: Uint8Array, maxBytes = MAX_FIRMWARE_SIZE): Promise<FirmwareImage> {
  if (input.length < 32 || input.length > maxBytes) throw new FirmwareError('invalidFile');
  const bytes = Uint8Array.from(input);
  const view = new DataView(bytes.buffer);
  if (view.getUint32(0, true) !== 0x96f3b83d) throw new FirmwareError('invalidFile');
  const headerSize = view.getUint16(8, true);
  const protectedSize = view.getUint16(10, true);
  const bodySize = view.getUint32(12, true);
  const flags = view.getUint32(16, true);
  // Plain executable images may specify fixed-ROM or RAM-load addresses.
  if ((flags & ~0x120) !== 0) throw new FirmwareError('unsupportedImage');
  const bodyEnd = headerSize + bodySize;
  if (headerSize < 32 || bodySize === 0 || bodyEnd > bytes.length - 4) throw new FirmwareError('invalidFile');

  let imageHash: Uint8Array<ArrayBuffer> | undefined;
  const readTlvs = (start: number, magic: number, expectedSize?: number) => {
    if (start + 4 > bytes.length || view.getUint16(start, true) !== magic)
      throw new FirmwareError('invalidFile');
    const size = view.getUint16(start + 2, true);
    const end = start + size;
    if (size < 4 || end > bytes.length || (expectedSize !== undefined && size !== expectedSize))
      throw new FirmwareError('invalidFile');
    let offset = start + 4;
    while (offset < end) {
      if (offset + 4 > end) throw new FirmwareError('invalidFile');
      const type = view.getUint16(offset, true);
      const length = view.getUint16(offset + 2, true);
      offset += 4;
      if (offset + length > end) throw new FirmwareError('invalidFile');
      if (type === 0x10) {
        if (magic !== 0x6907 || length !== 32 || imageHash) throw new FirmwareError('invalidFile');
        imageHash = bytes.slice(offset, offset + length);
      }
      offset += length;
    }
    return end;
  };

  const hashEnd = protectedSize ? readTlvs(bodyEnd, 0x6908, protectedSize) : bodyEnd;
  const tlvEnd = readTlvs(hashEnd, 0x6907);
  if (!imageHash) throw new FirmwareError('unsupportedImage');
  // Erased padding is safe to retain. Boot trailers and concatenated images are not upload files.
  if (bytes.subarray(tlvEnd).some((byte) => byte !== 0xff)) throw new FirmwareError('unsupportedImage');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(0, hashEnd)));
  if (!sameHash(digest, imageHash)) throw new FirmwareError('hashMismatch');
  const uploadHash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const version = `${bytes[20]}.${bytes[21]}.${view.getUint16(22, true)}+${view.getUint32(24, true)}`;
  const verifiedHash = imageHash;
  return Object.freeze({
    version,
    size: bytes.length,
    get bytes() {
      return bytes.slice();
    },
    get imageHash() {
      return verifiedHash.slice();
    },
    get uploadHash() {
      return uploadHash.slice();
    },
  });
}

export interface ImageState {
  image: number;
  slot: number;
  version: string;
  hash?: Uint8Array<ArrayBuffer>;
  active: boolean;
  pending: boolean;
  confirmed: boolean;
  permanent: boolean;
  bootable: boolean;
}

function uint(value: unknown, max = 0xffffffff): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new DeviceError('protocol');
  return value;
}

function boolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new DeviceError('protocol');
  return value;
}

function imageStates(reply: Fields): ImageState[] {
  if (!Array.isArray(reply.images)) throw new DeviceError('protocol');
  const slots = new Set<string>();
  return reply.images.map((value) => {
    const entry = record(value);
    const image = entry.image === undefined ? 0 : uint(entry.image);
    const slot = uint(entry.slot);
    if (typeof entry.version !== 'string' || entry.version.length === 0) throw new DeviceError('protocol');
    if (entry.hash !== undefined && (!(entry.hash instanceof Uint8Array) || entry.hash.length !== 32))
      throw new DeviceError('protocol');
    const key = `${image}:${slot}`;
    if (slots.has(key)) throw new DeviceError('protocol');
    slots.add(key);
    return {
      image,
      slot,
      version: entry.version,
      hash: entry.hash === undefined ? undefined : Uint8Array.from(entry.hash as Uint8Array),
      active: boolean(entry.active),
      pending: boolean(entry.pending),
      confirmed: boolean(entry.confirmed),
      permanent: boolean(entry.permanent),
      bootable: boolean(entry.bootable),
    };
  });
}

export class FirmwareClient {
  constructor(
    readonly request: SmpRequest,
    private readonly chunkSize = DEFAULT_PROFILE.firmwareChunkBytes,
    private readonly profile: Readonly<ConnectionProfile> = DEFAULT_PROFILE,
    private readonly packetLimit = profile.maxTxPacketBytes,
    private readonly recovery = false,
  ) {
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 65525) throw new DeviceError('protocol');
  }

  async list(): Promise<ImageState[]> {
    return imageStates(checked(await this.request(1, 0, 'read', {})));
  }

  async upload(
    image: FirmwareImage,
    onProgress: (offset: number) => void,
    shouldStop: () => boolean = () => false,
  ): Promise<boolean> {
    const bytes = image.bytes;
    const sha = image.uploadHash;
    let offset = 0;
    let highWater = 0;
    let stalled = 0;
    onProgress(0);
    while (offset < bytes.length) {
      if (shouldStop()) return false;
      const target = this.recovery ? this.profile.recoveryUploadImage : this.profile.imageIndex;
      const fields = {
        off: offset,
        ...(offset === 0 && {
          len: bytes.length,
          sha,
          ...(target !== null && (this.recovery || target !== 0) && { image: target }),
          ...(this.profile.upgradeOnly && { upgrade: true }),
        }),
      };
      const data = fitData(fields, bytes.subarray(offset, offset + this.chunkSize), this.packetLimit);
      const reply = checked(
        await this.request(1, 1, 'write', { ...fields, data }, undefined, {
          timeoutMs: offset === 0 ? this.profile.firstUploadTimeoutMs : this.profile.requestTimeoutMs,
        }),
      );
      const next = uint(reply.off, bytes.length);
      if (reply.match !== undefined) {
        if (typeof reply.match !== 'boolean') throw new DeviceError('protocol');
        if (!reply.match) throw new FirmwareError('uploadMismatch');
        if (next !== bytes.length) throw new DeviceError('protocol');
      }
      if (next > highWater) {
        highWater = next;
        stalled = 0;
      } else if (++stalled > this.profile.stalledUploadLimit) {
        throw new FirmwareError('uploadStalled');
      }
      offset = next;
      onProgress(offset);
    }
    return true;
  }

  async markTest(hash: Uint8Array): Promise<ImageState[]> {
    return this.setState(hash, false);
  }

  async confirm(hash?: Uint8Array): Promise<ImageState[]> {
    return this.setState(hash, true);
  }

  private async setState(hash: Uint8Array | undefined, confirm: boolean): Promise<ImageState[]> {
    if (hash !== undefined && hash.length !== 32) throw new DeviceError('protocol');
    return imageStates(
      checked(await this.request(1, 0, 'write', { confirm, ...(hash !== undefined && { hash }) })),
    );
  }

  async reset(): Promise<void> {
    checked(await this.request(0, 5, 'write', {}));
  }
}
