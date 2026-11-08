import { DeviceError, type Fields, type SmpRequest } from '../../src/device/mcumgr';

// In-memory peer matching arcap e88855a's Group 64 transactions and guarded FS.
export class Firmware {
  rev = 0xfedcba9800000001n;
  items: Fields[] = [];
  received = new Uint8Array();
  size = 0;
  id = 123;
  reqId?: Uint8Array;
  state = 'none';
  polls = 0;
  validationError = 0;
  calls: { group: number; cmd: number; op: string; fields: Fields }[] = [];
  lose?: 'prepare' | 'write' | 'commit';
  maxFiles = 32;
  maxFileSize = 4194304;
  freeBytes = 10000000;
  path = '/SD:/ROUTES/INBOX/0000007B.TMP';
  reply = (): Fields => ({
    upload_id: this.id,
    size: this.size,
    state: this.state,
    ...(this.state === 'receiving' && { upload_path: this.path, max_chunk: 512 }),
    ...(this.state === 'ready' && { id: this.id, name: 'Device route', rev: this.rev }),
    ...(this.state === 'failed' && { error: this.validationError }),
    ...(this.state === 'expired' && { error: 10 }),
  });
  fail = (rc: number) => ({ err: { group: 64, rc } });
  lost(stage: Firmware['lose']) {
    if (this.lose === stage) {
      this.lose = undefined;
      throw new DeviceError('disconnected');
    }
  }
  request: SmpRequest = async (group, cmd, op, fields) => {
    this.calls.push({ group, cmd, op, fields });
    if (group === 0 && cmd === 6 && op === 'read') return { buf_size: 1024, buf_count: 4 };
    if (group === 64) {
      if (op !== (cmd <= 1 ? 'read' : 'write')) throw new Error('Wrong operation');
      if (cmd === 0 && fields.upload_id === undefined)
        return {
          version: 1,
          format_version: 1,
          storage: 'ready',
          count: this.items.length,
          max_files: this.maxFiles,
          max_file_size: this.maxFileSize,
          max_chunk: 512,
          free_bytes: this.freeBytes,
          rev: this.rev,
          error: 0,
        };
      if (cmd === 0) {
        if (this.state === 'none' || fields.upload_id !== this.id) return this.fail(2);
        if (this.state === 'verifying' && ++this.polls >= 2) {
          if (this.validationError) this.state = 'failed';
          else {
            this.state = 'ready';
            this.rev++;
            this.items.push({
              id: this.id,
              name: 'Device route',
              size: this.size,
              total_dm: 10000,
              state: 'ready',
              error: 0,
              in_use: false,
            });
          }
        }
        return this.reply();
      }
      if (cmd === 1) {
        if (fields.if_rev !== undefined && fields.if_rev !== this.rev) return this.fail(11);
        const cursor = fields.cursor as number;
        if (cursor && fields.if_rev === undefined) throw new Error('Missing revision');
        const items = this.items.slice(cursor, cursor + (fields.limit as number));
        return {
          rev: this.rev,
          items,
          ...(cursor + items.length < this.items.length && { next_cursor: cursor + items.length }),
        };
      }
      if (cmd === 2) {
        if (!(fields.req_id instanceof Uint8Array) || fields.req_id.length !== 16)
          throw new Error('Invalid request ID');
        const same = this.reqId?.every((v, i) => v === (fields.req_id as Uint8Array)[i]);
        if (same) return this.state === 'expired' ? this.fail(10) : this.reply();
        if (['receiving', 'verifying'].includes(this.state)) return this.fail(12);
        this.reqId = fields.req_id;
        this.size = fields.size as number;
        this.received = new Uint8Array();
        this.state = 'receiving';
        this.polls = 0;
        this.lost('prepare');
        return this.reply();
      }
      if (cmd === 3) {
        if (fields.upload_id !== this.id) return this.fail(2);
        if (['ready', 'verifying'].includes(this.state)) return this.reply();
        if (this.received.length !== this.size) return this.fail(7);
        this.state = 'verifying';
        this.lost('commit');
        return this.reply();
      }
      if (cmd === 4) {
        if (['verifying', 'ready'].includes(this.state)) return this.fail(12);
        this.state = 'cancelled';
        this.received = new Uint8Array();
        return this.reply();
      }
      if (cmd === 5) {
        const item = this.items.find((i) => i.id === fields.id);
        if (item) {
          if (fields.if_rev !== this.rev) return this.fail(11);
          if (item.in_use) return this.fail(4);
          this.items = this.items.filter((i) => i !== item);
          this.rev++;
        }
        return { rev: this.rev };
      }
    }
    if (group === 8) {
      if (fields.name !== this.path || this.state !== 'receiving') throw new Error('Managed path denied');
      if (cmd === 1 && op === 'read') return { len: this.received.length };
      if (cmd === 0 && op === 'write') {
        const data = fields.data as Uint8Array;
        if (
          fields.off !== this.received.length ||
          data.length > 512 ||
          (fields.off === 0 && fields.len !== this.size)
        )
          throw new Error('Invalid offset or size');
        const next = new Uint8Array(this.received.length + data.length);
        next.set(this.received);
        next.set(data, this.received.length);
        this.received = next;
        this.lost('write');
        return { off: this.received.length };
      }
      throw new Error('FS checksum/download is forbidden');
    }
    throw new Error('Unsupported command');
  };
}
