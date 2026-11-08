import { DEFAULT_PROFILE, type ConnectionProfile } from './config';
import { checked, DeviceError, record, type Fields, type SmpRequest } from './mcumgr';

export const routeGroup = 64;
export const routeFailure = (code: number) => new DeviceError('device', routeGroup, code);
export function uint(value: unknown, max = 0xffffffff): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new DeviceError('protocol');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new DeviceError('protocol');
  return value;
}
export function revision(value: unknown): bigint {
  const result = typeof value === 'bigint' ? value : BigInt(uint(value, Number.MAX_SAFE_INTEGER));
  if (result < 0n || result > 0xffffffffffffffffn) throw new DeviceError('protocol');
  return result;
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T)) throw new DeviceError('protocol');
  return value as T;
}
export interface RouteStatus {
  storage: 'ready' | 'initializing' | 'error';
  count: number;
  maxFiles: number;
  maxFileSize: number;
  maxChunk: number;
  freeBytes: bigint;
  rev: bigint;
  error: number;
}
export interface DeviceRoute {
  id: number;
  name: string;
  size: number;
  totalDm: number;
  state: 'ready' | 'invalid';
  error: number;
  inUse: boolean;
}
export interface Catalog {
  rev: bigint;
  items: DeviceRoute[];
}
export type UploadState = 'receiving' | 'verifying' | 'ready' | 'cancelled' | 'failed' | 'expired';
export interface UploadStatus {
  uploadId: number;
  size: number;
  state: UploadState;
  error: number;
  path?: string;
  maxChunk?: number;
  name?: string;
  rev?: bigint;
}
function chunk(value: unknown) {
  const size = uint(value, 65525);
  if (!size) throw new DeviceError('protocol');
  return size;
}
function upload(reply: Fields): UploadStatus {
  const result: UploadStatus = {
    uploadId: uint(reply.upload_id),
    size: uint(reply.size),
    state: choice(reply.state, ['receiving', 'verifying', 'ready', 'cancelled', 'failed', 'expired']),
    error: reply.error === undefined ? 0 : uint(reply.error),
  };
  if (!result.uploadId) throw new DeviceError('protocol');
  if (result.state === 'receiving') {
    result.path = text(reply.upload_path);
    if (
      !result.path.startsWith('/') ||
      new TextEncoder().encode(result.path).length > 64 ||
      /[\\\x00-\x1f]/.test(result.path) ||
      result.path
        .split('/')
        .slice(1)
        .some((p) => !p || p === '.' || p === '..')
    )
      throw new DeviceError('protocol');
    result.maxChunk = chunk(reply.max_chunk);
  }
  if (result.state === 'ready') {
    if (uint(reply.id) !== result.uploadId) throw new DeviceError('protocol');
    result.name = text(reply.name);
    result.rev = revision(reply.rev);
  }
  return result;
}

export class RouteClient {
  readonly request: SmpRequest;
  constructor(
    request: SmpRequest,
    readonly profile: Readonly<ConnectionProfile> = DEFAULT_PROFILE,
    readonly packetLimit = profile.maxTxPacketBytes,
  ) {
    this.request = async (...args) => {
      const reply = await request(...args);
      const mapped =
        profile.protocolVersion === 1 && args[0] === routeGroup && typeof reply.rc === 'number'
          ? profile.routeV1Errors[String(reply.rc)]
          : undefined;
      return mapped === undefined ? reply : { ...reply, rc: 0, err: { group: routeGroup, rc: mapped } };
    };
  }
  private async call(command: number, op: 'read' | 'write', fields: Fields, timeoutMs?: number) {
    const reply =
      timeoutMs === undefined
        ? await this.request(routeGroup, command, op, fields)
        : await this.request(routeGroup, command, op, fields, undefined, { timeoutMs });
    return checked(reply);
  }
  async status(): Promise<RouteStatus> {
    const r = await this.call(0, 'read', {});
    if (r.version !== 1 || r.format_version !== 1) throw new DeviceError('version');
    return {
      storage: choice(r.storage, ['ready', 'initializing', 'error']),
      count: uint(r.count),
      maxFiles: uint(r.max_files),
      maxFileSize: uint(r.max_file_size),
      maxChunk: chunk(r.max_chunk),
      freeBytes: revision(r.free_bytes),
      rev: revision(r.rev),
      error: uint(r.error),
    };
  }
  async list(): Promise<Catalog> {
    // Device preview/navigation changes also invalidate a catalog snapshot.
    for (let attempt = 0; attempt < this.profile.routeCatalogAttempts; attempt++) {
      const items: DeviceRoute[] = [];
      let cursor = 0;
      let rev: bigint | undefined;
      try {
        for (let page = 0; page < 256; page++) {
          const r = await this.call(1, 'read', {
            cursor,
            limit: this.profile.routePageSize,
            ...(rev !== undefined && { if_rev: rev }),
          });
          const nextRev = revision(r.rev);
          if (rev !== undefined && rev !== nextRev) throw new DeviceError('protocol');
          rev = nextRev;
          if (!Array.isArray(r.items) || r.items.length > this.profile.routePageSize)
            throw new DeviceError('protocol');
          for (const value of r.items) {
            const item = record(value);
            const id = uint(item.id);
            if (!id || items.some((i) => i.id === id) || typeof item.in_use !== 'boolean')
              throw new DeviceError('protocol');
            items.push({
              id,
              name: text(item.name),
              size: uint(item.size),
              totalDm: uint(item.total_dm),
              state: choice(item.state, ['ready', 'invalid']),
              error: uint(item.error),
              inUse: item.in_use,
            });
          }
          if (r.next_cursor === undefined) return { rev, items };
          const next = uint(r.next_cursor);
          if (next !== items.length || next <= cursor) throw new DeviceError('protocol');
          cursor = next;
        }
        throw new DeviceError('protocol');
      } catch (error) {
        if (!(error instanceof DeviceError && error.group === routeGroup && error.rc === 11)) throw error;
      }
    }
    throw routeFailure(11);
  }
  async prepare(reqId: Uint8Array, size: number) {
    return upload(await this.call(2, 'write', { req_id: reqId, size }));
  }
  async uploadStatus(id: number, timeoutMs?: number) {
    return upload(await this.call(0, 'read', { upload_id: id }, timeoutMs));
  }
  async commit(id: number) {
    return upload(await this.call(3, 'write', { upload_id: id }));
  }
  async cancel(id: number) {
    return upload(await this.call(4, 'write', { upload_id: id }));
  }
  async delete(id: number, rev: bigint) {
    return revision((await this.call(5, 'write', { id, if_rev: rev })).rev);
  }
}
