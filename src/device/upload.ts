import { fitData } from './smp';
import { checked, DeviceError } from './mcumgr';
import { RouteClient, routeFailure, uint, type UploadStatus } from './routes';

export interface UploadJob {
  bytes: Uint8Array;
  reqId: Uint8Array;
  uploadId?: number;
  remote?: UploadStatus;
  cancelRequested: boolean;
}
export function createUpload(bytes: Uint8Array): UploadJob {
  return { bytes: bytes.slice(), reqId: crypto.getRandomValues(new Uint8Array(16)), cancelRequested: false };
}
export type UploadProgress = {
  state: 'preparing' | 'receiving' | 'verifying' | 'ready' | 'cancelled';
  off: number;
  name?: string;
};
export const terminalUpload = (job: UploadJob) =>
  !!job.remote && ['ready', 'cancelled', 'failed', 'expired'].includes(job.remote.state);

export async function transferRoute(
  client: RouteClient,
  job: UploadJob,
  progress: (value: UploadProgress) => void,
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
) {
  const accept = (reply: UploadStatus) => {
    if (reply.size !== job.bytes.length || (job.uploadId !== undefined && reply.uploadId !== job.uploadId))
      throw new DeviceError('protocol');
    job.uploadId = reply.uploadId;
    job.remote = reply;
    return reply;
  };
  progress({ state: 'preparing', off: 0 });
  if (job.uploadId === undefined) {
    // Repeating PREPARE with the same request ID recovers a lost PREPARE response.
    accept(await client.prepare(job.reqId, job.bytes.length));
  } else {
    try {
      accept(await client.uploadStatus(job.uploadId));
    } catch (error) {
      if (!(error instanceof DeviceError && error.group === 64 && error.rc === 2)) throw error;
      // The device can reboot after committing but before the READY response.
      const catalog = await client.list();
      const entry = catalog.items.find((item) => item.id === job.uploadId);
      if (!entry || entry.size !== job.bytes.length || entry.state !== 'ready') {
        job.remote = { uploadId: job.uploadId, size: job.bytes.length, state: 'expired', error: 10 };
        throw routeFailure(10);
      }
      accept({
        uploadId: entry.id,
        size: entry.size,
        state: 'ready',
        name: entry.name,
        rev: catalog.rev,
        error: 0,
      });
    }
  }
  let remote = job.remote!;
  if (remote.state === 'receiving') {
    if (job.cancelRequested) {
      remote = accept(await client.cancel(remote.uploadId));
    } else {
      // STAT flushes/closes the FS handle; its size is the authoritative resume offset.
      const stat = checked(await client.request(8, 1, 'read', { name: remote.path }));
      let off = uint(stat.len, job.bytes.length);
      progress({ state: 'receiving', off });
      while (off < job.bytes.length && !job.cancelRequested) {
        const fields = { name: remote.path, off, ...(off === 0 && { len: job.bytes.length }) };
        const data = fitData(
          fields,
          job.bytes.subarray(off, off + Math.min(remote.maxChunk!, client.profile.routeChunkBytes)),
          client.packetLimit,
        );
        const ack = checked(await client.request(8, 0, 'write', { ...fields, data }));
        if (ack.off !== off + data.length) throw new DeviceError('protocol');
        off += data.length;
        progress({ state: 'receiving', off });
      }
      // Cancel only between complete SMP requests, never halfway through an SMP packet.
      remote = accept(
        job.cancelRequested ? await client.cancel(remote.uploadId) : await client.commit(remote.uploadId),
      );
    }
  }
  // Poll for at most two minutes per invocation; continuing later uses the same transaction.
  const deadline = Date.now() + client.profile.routeVerifyTimeoutMs;
  while (remote.state === 'verifying') {
    progress({ state: 'verifying', off: job.bytes.length });
    if (Date.now() >= deadline) throw new DeviceError('timeout');
    await wait(Math.min(client.profile.routePollIntervalMs, deadline - Date.now()));
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DeviceError('timeout');
    remote = accept(
      await client.uploadStatus(remote.uploadId, Math.min(client.profile.requestTimeoutMs, remaining)),
    );
  }
  if (remote.state === 'ready') progress({ state: 'ready', off: job.bytes.length, name: remote.name });
  else if (remote.state === 'cancelled') progress({ state: 'cancelled', off: 0 });
  else throw routeFailure(remote.error || (remote.state === 'expired' ? 10 : 8));
}
