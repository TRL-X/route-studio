import { crc32 } from '../crc32';
import { UploadError, type FsRequest } from './mcumgr';

export function validDevicePath(path: string) {
  return (
    path.startsWith('/') &&
    !path.endsWith('/') &&
    !/[\\\u0000-\u001f]/.test(path) &&
    path
      .slice(1)
      .split('/')
      .every((segment) => segment && segment !== '.' && segment !== '..') &&
    new TextEncoder().encode(path).length <= 64
  );
}

function checked(reply: Awaited<ReturnType<FsRequest>>) {
  if (reply.err || (reply.rc !== undefined && reply.rc !== 0)) {
    const code = reply.err ? reply.err.group + '/' + reply.err.rc : String(reply.rc);
    throw new UploadError('uploadDeviceError', code);
  }
  return reply;
}

export async function uploadFile(
  request: FsRequest,
  name: string,
  bytes: Uint8Array,
  progress: (off: number) => void,
) {
  const status = await request(1, { name });
  const exists = !(status.err?.group === 8 && status.err.rc === 3); // FS_MGMT_ERR_FILE_NOT_FOUND
  if (exists) {
    const { len } = checked(status);
    if (!Number.isSafeInteger(len)) throw new UploadError('uploadProtocol');
    if (len !== bytes.length) throw new UploadError('uploadExists');
    progress(bytes.length);
  } else {
    let off = 0;
    while (off < bytes.length) {
      const data = bytes.subarray(off, off + 512);
      const reply = checked(await request(0, { name, off, data, ...(off === 0 && { len: bytes.length }) }));
      if (reply.off !== off + data.length) throw new UploadError('uploadProtocol');
      off = reply.off;
      progress(off);
    }
  }
  const hash = checked(await request(2, { name, type: 'crc32' }));
  const crc = crc32(bytes); // The device hashes every byte, including the RTE header's own CRC.
  if (hash.type !== 'crc32' || hash.len !== bytes.length || (hash.off ?? 0) !== 0 || hash.output !== crc)
    throw new UploadError(exists ? 'uploadExists' : 'uploadMismatch');
  return crc.toString(16).toUpperCase().padStart(8, '0');
}
