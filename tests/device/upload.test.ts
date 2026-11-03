import { crc32 } from 'node:zlib';
import { expect, test, vi } from 'vitest';
import type { FsRequest } from '../../src/device/mcumgr';
import { uploadFile, validDevicePath } from '../../src/device/upload';

const name = '/SD:/ROUTES/TEST.RTE';
const bytes = Uint8Array.from({ length: 70_003 }, (_, i) => (i * 13) & 255);
const missing = { err: { group: 8, rc: 3 } };
const hash = { len: bytes.length, type: 'crc32', output: crc32(bytes) };

test('checks device paths by UTF-8 byte length and requires a filename', () => {
  expect(validDevicePath(name)).toBe(true);
  expect(validDevicePath('/' + '名'.repeat(21))).toBe(true);
  for (const path of ['', 'TEST.RTE', '/SD:/ROUTES/', '/a/../b', '/a//b', '/a\\b', '/' + '名'.repeat(22)])
    expect(validDevicePath(path)).toBe(false);
});

test('uploads all bytes across 64 KiB and verifies the whole file on the device', async () => {
  let received = 0;
  const progress = vi.fn();
  const request: FsRequest = async (command, fields) => {
    expect(fields.name).toBe(name);
    if (command === 1) return missing;
    if (command === 2) {
      expect(received).toBe(bytes.length);
      expect(fields).toEqual({ name, type: 'crc32' });
      return hash;
    }
    const data = fields.data as Uint8Array;
    expect(fields.off).toBe(received);
    expect(fields.len).toBe(received === 0 ? bytes.length : undefined);
    expect(data).toEqual(bytes.subarray(received, received + data.length));
    received += data.length;
    return { off: received };
  };
  await expect(uploadFile(request, name, bytes, progress)).resolves.toBe(
    hash.output.toString(16).toUpperCase().padStart(8, '0'),
  );
  expect(progress).toHaveBeenLastCalledWith(bytes.length);
});

test('verifies identical existing files and never writes over a different destination', async () => {
  const request = vi.fn<FsRequest>().mockResolvedValueOnce({ len: bytes.length }).mockResolvedValueOnce(hash);
  await uploadFile(request, name, bytes, vi.fn());
  request.mockResolvedValueOnce({ len: bytes.length }).mockResolvedValueOnce({ ...hash, output: 0 });
  await expect(uploadFile(request, name, bytes, vi.fn())).rejects.toMatchObject({ key: 'uploadExists' });
  request.mockResolvedValueOnce({ len: 50 });
  await expect(uploadFile(request, name, bytes, vi.fn())).rejects.toMatchObject({ key: 'uploadExists' });
  expect(request.mock.calls.map(([cmd]) => cmd)).toEqual([1, 2, 1, 2, 1]);
});

test('rejects an unexpected ack offset, a device error, and a mismatched length or CRC', async () => {
  const data = bytes.subarray(0, 16);
  const request = vi.fn<FsRequest>();
  request.mockResolvedValueOnce(missing).mockResolvedValueOnce({ off: 0 });
  await expect(uploadFile(request, name, data, vi.fn())).rejects.toMatchObject({ key: 'uploadProtocol' });
  request.mockResolvedValueOnce({ err: { group: 8, rc: 1 } });
  await expect(uploadFile(request, name, data, vi.fn())).rejects.toMatchObject({ key: 'uploadDeviceError' });
  for (const result of [
    { len: 16, output: 42 },
    { len: 15, output: crc32(data) },
  ]) {
    request
      .mockResolvedValueOnce(missing)
      .mockResolvedValueOnce({ off: 16 })
      .mockResolvedValueOnce({ type: 'crc32', ...result });
    await expect(uploadFile(request, name, data, vi.fn())).rejects.toMatchObject({ key: 'uploadMismatch' });
  }
});
