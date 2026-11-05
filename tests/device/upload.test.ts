import { expect, test, vi } from 'vitest';
import { createUpload, transferRoute } from '../../src/device/upload';
import { RouteClient } from '../../src/device/routes';
import { Firmware } from './firmware';
const bytes = Uint8Array.from({ length: 70003 }, (_, i) => i % 251);
const noWait = async () => {};

test('uploads a pre-created empty file, then waits for device validation without FS checksum', async () => {
  const firmware = new Firmware();
  const job = createUpload(bytes);
  const progress = vi.fn();
  await transferRoute(new RouteClient(firmware.request), job, progress, noWait);
  expect(firmware.received).toEqual(bytes);
  expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ state: 'ready', off: bytes.length });
  expect(progress.mock.calls.some(([p]) => p.state === 'verifying')).toBe(true);
  expect(firmware.calls.filter((c) => c.group === 8).every((c) => c.cmd <= 1)).toBe(true);
  expect(firmware.calls.find((c) => c.cmd === 2 && c.group === 64)?.fields.req_id).toHaveLength(16);
});

for (const stage of ['prepare', 'write', 'commit'] as const) {
  test(`recovers a lost ${stage} response without starting another transaction or rewriting acknowledged bytes`, async () => {
    const firmware = new Firmware();
    firmware.lose = stage;
    const client = new RouteClient(firmware.request);
    const source = bytes.slice(0, 1200);
    const original = source.slice();
    const job = createUpload(source);
    source.fill(0); // Edits after starting must not affect the upload snapshot.
    await expect(transferRoute(client, job, vi.fn(), noWait)).rejects.toMatchObject({ kind: 'disconnected' });
    const before = firmware.calls.length;
    await transferRoute(client, job, vi.fn(), noWait);
    expect(firmware.received).toEqual(original);
    expect(firmware.items).toHaveLength(1);
    const subsequent = firmware.calls.slice(before);
    if (stage === 'write') expect(subsequent.find((c) => c.group === 8 && c.cmd === 0)?.fields.off).toBe(512);
    if (stage === 'commit') expect(subsequent.some((c) => c.group === 8 || c.cmd === 2)).toBe(false);
    if (stage === 'prepare') {
      const requests = firmware.calls.filter((c) => c.group === 64 && c.cmd === 2);
      expect(requests[0].fields.req_id).toEqual(requests[1].fields.req_id);
    }
  });
}

test('cancels between complete blocks and does not commit', async () => {
  const firmware = new Firmware();
  const job = createUpload(bytes);
  await transferRoute(
    new RouteClient(firmware.request),
    job,
    (p) => {
      if (p.off >= 512) job.cancelRequested = true;
    },
    noWait,
  );
  expect(job.remote?.state).toBe('cancelled');
  expect(firmware.calls.some((c) => c.group === 64 && c.cmd === 3)).toBe(false);
  expect(firmware.calls.filter((c) => c.group === 8 && c.cmd === 0)).toHaveLength(1);
});

test('does not cancel once validation has started', async () => {
  const firmware = new Firmware();
  const job = createUpload(bytes.slice(0, 16));
  await transferRoute(
    new RouteClient(firmware.request),
    job,
    (p) => {
      if (p.state === 'verifying') job.cancelRequested = true;
    },
    noWait,
  );
  expect(job.remote?.state).toBe('ready');
  expect(firmware.calls.some((c) => c.group === 64 && c.cmd === 4)).toBe(false);
});

test('reports RTE validation failure as a terminal transaction', async () => {
  const firmware = new Firmware();
  firmware.validationError = 8;
  const job = createUpload(bytes.slice(0, 16));
  const progress = vi.fn();
  await expect(transferRoute(new RouteClient(firmware.request), job, progress, noWait)).rejects.toMatchObject(
    { group: 64, rc: 8 },
  );
  expect(job.remote?.state).toBe('failed');
  expect(progress.mock.calls.some(([p]) => p.state === 'ready')).toBe(false);
});

test('recovers committed route after transaction state is lost on device reboot', async () => {
  const firmware = new Firmware();
  const job = createUpload(bytes.slice(0, 16));
  const client = new RouteClient(firmware.request);
  await transferRoute(client, job, vi.fn(), noWait);
  firmware.state = 'none';
  const count = firmware.calls.length;
  await transferRoute(client, job, vi.fn(), noWait);
  expect(firmware.calls.slice(count).every((c) => c.op === 'read')).toBe(true);
  expect(firmware.items).toHaveLength(1);
});

test('expired or rebooted unfinished transactions require a fresh upload', async () => {
  for (const state of ['none', 'expired']) {
    const firmware = new Firmware();
    firmware.lose = 'write';
    const job = createUpload(bytes);
    const client = new RouteClient(firmware.request);
    await expect(transferRoute(client, job, vi.fn(), noWait)).rejects.toThrow();
    firmware.state = state;
    await expect(transferRoute(client, job, vi.fn(), noWait)).rejects.toMatchObject({ rc: 10 });
    expect(job.remote?.state).toBe('expired');
  }
});

test('rejects impossible resume sizes and ACK offsets', async () => {
  for (const command of [0, 1]) {
    const firmware = new Firmware();
    const client = new RouteClient(async (...args) => {
      const result = await firmware.request(...args);
      return args[0] === 8 && args[1] === command
        ? command === 0
          ? { off: 0 }
          : { len: bytes.length + 1 }
        : result;
    });
    await expect(transferRoute(client, createUpload(bytes), vi.fn(), noWait)).rejects.toMatchObject({
      kind: 'protocol',
    });
  }
});
