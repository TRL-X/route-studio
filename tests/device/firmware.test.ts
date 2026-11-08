import { expect, test, vi } from 'vitest';
import { FirmwareClient, parseFirmware, sameHash } from '../../src/device/firmware';
import { type Fields, type SmpRequest } from '../../src/device/mcumgr';

async function imageBytes(bodySize = 1024, protectedTlv = false) {
  const protectedSize = protectedTlv ? 12 : 0;
  const hashEnd = 32 + bodySize + protectedSize;
  const bytes = new Uint8Array(hashEnd + 40);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x96f3b83d, true);
  view.setUint16(8, 32, true);
  view.setUint16(10, protectedSize, true);
  view.setUint32(12, bodySize, true);
  bytes[20] = 1;
  bytes[21] = 2;
  view.setUint16(22, 3, true);
  view.setUint32(24, 4, true);
  for (let i = 32; i < 32 + bodySize; i++) bytes[i] = i % 251;
  if (protectedTlv) {
    const start = 32 + bodySize;
    view.setUint16(start, 0x6908, true);
    view.setUint16(start + 2, protectedSize, true);
    view.setUint16(start + 4, 0x50, true);
    view.setUint16(start + 6, 4, true);
    view.setUint32(start + 8, 5, true);
  }
  view.setUint16(hashEnd, 0x6907, true);
  view.setUint16(hashEnd + 2, 40, true);
  view.setUint16(hashEnd + 4, 0x10, true);
  view.setUint16(hashEnd + 6, 32, true);
  bytes.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(0, hashEnd))), hashEnd + 8);
  return bytes;
}

test('parses MCUboot version and distinguishes the image digest from the upload digest', async () => {
  const bytes = await imageBytes();
  const image = await parseFirmware(bytes);
  expect(image.version).toBe('1.2.3+4');
  expect(image.size).toBe(bytes.length);
  expect(image.imageHash).toEqual(bytes.slice(-32));
  expect(image.uploadHash).toEqual(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  expect(sameHash(image.uploadHash, image.imageHash)).toBe(false);
  bytes.fill(0);
  image.bytes.fill(0);
  image.imageHash.fill(0);
  image.uploadHash.fill(0);
  expect(image.bytes[0]).toBe(0x3d);
  expect(image.imageHash.some((value) => value !== 0)).toBe(true);
  expect(image.uploadHash.some((value) => value !== 0)).toBe(true);
});

test('includes protected metadata in the image digest', async () => {
  const bytes = await imageBytes(100, true);
  const image = await parseFirmware(bytes);
  expect(image.imageHash).toEqual(bytes.slice(-32));
  bytes[32 + 100 + 8]++;
  await expect(parseFirmware(bytes)).rejects.toMatchObject({ code: 'hashMismatch' });
});

test('rejects corrupt payloads and malformed containers before uploading', async () => {
  const valid = await imageBytes(100);
  const corrupt = valid.slice();
  corrupt[40] ^= 1;
  await expect(parseFirmware(corrupt)).rejects.toMatchObject({ code: 'hashMismatch' });
  await expect(parseFirmware(valid.subarray(0, valid.length - 1))).rejects.toMatchObject({
    code: 'invalidFile',
  });
  const badHeader = valid.slice();
  new DataView(badHeader.buffer).setUint16(8, 16, true);
  await expect(parseFirmware(badHeader)).rejects.toMatchObject({ code: 'invalidFile' });
  const badBody = valid.slice();
  new DataView(badBody.buffer).setUint32(12, 0xffffffff, true);
  await expect(parseFirmware(badBody)).rejects.toMatchObject({ code: 'invalidFile' });
  const badTlv = valid.slice();
  new DataView(badTlv.buffer).setUint16(32 + 100 + 6, 0xffff, true);
  await expect(parseFirmware(badTlv)).rejects.toMatchObject({ code: 'invalidFile' });
  const badProtected = await imageBytes(100, true);
  new DataView(badProtected.buffer).setUint16(10, 8, true);
  await expect(parseFirmware(badProtected)).rejects.toMatchObject({ code: 'invalidFile' });
});

test('rejects encrypted images and boot trailers while allowing erased padding', async () => {
  const bytes = await imageBytes(100);
  const encrypted = bytes.slice();
  new DataView(encrypted.buffer).setUint32(16, 4, true);
  await expect(parseFirmware(encrypted)).rejects.toMatchObject({ code: 'unsupportedImage' });
  const padded = new Uint8Array(bytes.length + 100).fill(0xff);
  padded.set(bytes);
  expect((await parseFirmware(padded)).bytes).toEqual(padded);
  padded[padded.length - 1] = 1;
  await expect(parseFirmware(padded)).rejects.toMatchObject({ code: 'unsupportedImage' });
});

test('rejects missing or duplicate SHA-256 image digests', async () => {
  const bytes = await imageBytes(100);
  const missing = bytes.slice();
  new DataView(missing.buffer).setUint16(136, 0xa0, true);
  await expect(parseFirmware(missing)).rejects.toMatchObject({ code: 'unsupportedImage' });
  const duplicate = new Uint8Array(bytes.length + 36);
  duplicate.set(bytes);
  duplicate.set(bytes.subarray(bytes.length - 36), bytes.length);
  new DataView(duplicate.buffer).setUint16(134, 76, true);
  await expect(parseFirmware(duplicate)).rejects.toMatchObject({ code: 'invalidFile' });
});

test('uploads standard image chunks and sends the full-file hash only with offset zero', async () => {
  const image = await parseFirmware(await imageBytes());
  const request = vi.fn<SmpRequest>(async (_group, _cmd, _op, fields) => ({
    off: (fields.off as number) + (fields.data as Uint8Array).length,
    ...((fields.off as number) + (fields.data as Uint8Array).length === image.size && { match: true }),
  }));
  const progress = vi.fn();
  expect(await new FirmwareClient(request).upload(image, progress)).toBe(true);
  const first = request.mock.calls[0];
  expect(first.slice(0, 3)).toEqual([1, 1, 'write']);
  expect(first[3]).toMatchObject({ len: image.size, sha: image.uploadHash, off: 0 });
  expect(first[3]).not.toHaveProperty('image');
  expect(first[3]).not.toHaveProperty('upgrade');
  for (const call of request.mock.calls.slice(1)) {
    expect(call[3]).not.toHaveProperty('len');
    expect(call[3]).not.toHaveProperty('sha');
  }
  const transferred = new Uint8Array(image.size);
  for (const call of request.mock.calls) transferred.set(call[3].data as Uint8Array, call[3].off as number);
  expect(transferred).toEqual(image.bytes);
  expect(progress).toHaveBeenLastCalledWith(image.size);
});

test('resumes at the acknowledged offset and restores initial fields after a device restart', async () => {
  const image = await parseFirmware(await imageBytes());
  let count = 0;
  const request = vi.fn<SmpRequest>(async (_group, _cmd, _op, fields) => {
    if (++count === 1) return { off: 768 };
    if (count === 2) return { off: 0 };
    return { off: (fields.off as number) + (fields.data as Uint8Array).length };
  });
  expect(await new FirmwareClient(request).upload(image, () => {})).toBe(true);
  expect(request.mock.calls[1][3].off).toBe(768);
  expect(request.mock.calls[2][3]).toMatchObject({ off: 0, len: image.size, sha: image.uploadHash });
});

test('pauses only between acknowledged requests and can resume in a later invocation', async () => {
  const image = await parseFirmware(await imageBytes());
  let stop = false;
  let remoteOffset = 0;
  const request = vi.fn<SmpRequest>(async (_group, _cmd, _op, fields) => {
    if (fields.off === 0 && remoteOffset > 0) return { off: remoteOffset };
    remoteOffset += (fields.data as Uint8Array).length;
    return { off: remoteOffset };
  });
  const client = new FirmwareClient(request);
  expect(
    await client.upload(
      image,
      (off) => {
        stop = off > 0;
      },
      () => stop,
    ),
  ).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  expect(remoteOffset).toBe(256);
  expect(await client.upload(image, () => {})).toBe(true);
  expect(request.mock.calls[1][3]).toMatchObject({ off: 0, sha: image.uploadHash });
});

test('bounds repeated or oscillating offsets and rejects an invalid acknowledgement', async () => {
  const image = await parseFirmware(await imageBytes());
  let count = 0;
  const stalled = vi.fn<SmpRequest>(async () => ({ off: (++count % 2) * 256 }));
  await expect(new FirmwareClient(stalled).upload(image, () => {})).rejects.toMatchObject({
    code: 'uploadStalled',
  });
  expect(stalled.mock.calls.length).toBeLessThan(12);
  for (const off of [undefined, -1, 0.5, image.size + 1, '256']) {
    await expect(new FirmwareClient(async () => ({ off })).upload(image, () => {})).rejects.toMatchObject({
      kind: 'protocol',
    });
  }
});

test('does not treat mismatched data or a device error as successful upload', async () => {
  const image = await parseFirmware(await imageBytes());
  const progress = vi.fn();
  await expect(
    new FirmwareClient(async () => ({ off: image.size, match: false })).upload(image, progress),
  ).rejects.toMatchObject({ code: 'uploadMismatch' });
  expect(progress).not.toHaveBeenCalledWith(image.size);
  await expect(
    new FirmwareClient(async () => ({ err: { group: 1, rc: 24 } })).upload(image, progress),
  ).rejects.toMatchObject({ kind: 'device', group: 1, rc: 24 });
  await expect(new FirmwareClient(async () => ({ rc: 3 })).upload(image, progress)).rejects.toMatchObject({
    kind: 'device',
    group: 0,
    rc: 3,
  });
});

test('reads standard image states, including optional flags and recovery entries without hashes', async () => {
  const hash = new Uint8Array(32).fill(9);
  const client = new FirmwareClient(async () => ({
    images: [
      { slot: 0, version: '1.0.0', active: true, confirmed: true, hash },
      { slot: 1, version: '1.1.0' },
    ],
  }));
  const states = await client.list();
  expect(states[0]).toMatchObject({ image: 0, slot: 0, active: true, confirmed: true, pending: false, hash });
  expect(states[1]).toMatchObject({ hash: undefined, active: false, confirmed: false, bootable: false });
});

test('rejects ambiguous or malformed image states', async () => {
  const state = { slot: 0, version: '1.0.0' };
  for (const images of [
    undefined,
    [state, state],
    [{ ...state, active: 'true' }],
    [{ ...state, hash: new Uint8Array(1) }],
  ]) {
    await expect(new FirmwareClient(async () => ({ images })).list()).rejects.toMatchObject({
      kind: 'protocol',
    });
  }
});

test('uses image-state commands for test and confirm, and the standard OS reset command', async () => {
  const calls: { group: number; command: number; op: string; fields: Fields }[] = [];
  const client = new FirmwareClient(async (group, command, op, fields) => {
    calls.push({ group, command, op, fields });
    return group === 1 ? { images: [] } : {};
  });
  const hash = new Uint8Array(32).fill(4);
  await client.markTest(hash);
  await client.confirm(hash);
  await client.confirm();
  await client.reset();
  expect(calls).toEqual([
    { group: 1, command: 0, op: 'write', fields: { hash, confirm: false } },
    { group: 1, command: 0, op: 'write', fields: { hash, confirm: true } },
    { group: 1, command: 0, op: 'write', fields: { confirm: true } },
    { group: 0, command: 5, op: 'write', fields: {} },
  ]);
});

test('fits every firmware request to the peer buffer, including first-packet metadata', async () => {
  const { defaultProfile } = await import('../../src/device/config');
  const { packetBytes } = await import('../../src/device/smp');
  const image = await parseFirmware(await imageBytes());
  const request = vi.fn<SmpRequest>(async (_group, _command, _op, fields) => {
    expect(packetBytes(fields)).toBeLessThanOrEqual(128);
    return { off: (fields.off as number) + (fields.data as Uint8Array).length };
  });
  const profile = { ...defaultProfile('application-usb'), imageIndex: 1, firmwareChunkBytes: 1024 };
  await new FirmwareClient(request, profile.firmwareChunkBytes, profile, 128).upload(image, () => {});
  expect(request.mock.calls[0][3]).toMatchObject({
    image: 1,
    off: 0,
    len: image.size,
    sha: image.uploadHash,
  });
  expect(request.mock.calls[0][5]?.timeoutMs).toBe(120000);
  expect(request.mock.calls[1][5]?.timeoutMs).toBe(60000);
  expect((request.mock.calls[0][3].data as Uint8Array).length).toBeLessThan(
    (request.mock.calls[1][3].data as Uint8Array).length,
  );
});
