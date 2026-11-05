import { expect, test, vi } from 'vitest';
import { checked, DeviceError } from '../../src/device/mcumgr';
import { revision, RouteClient } from '../../src/device/routes';
import { Firmware } from './firmware';

function populated() {
  const firmware = new Firmware();
  firmware.items = Array.from({ length: 9 }, (_, i) => ({
    id: i + 1,
    name: `路线 ${i}`,
    size: 512,
    total_dm: 12000,
    state: 'ready',
    error: 0,
    in_use: i === 0,
  }));
  return firmware;
}
test('preserves uint64 revisions through status, pagination and deletion', async () => {
  const firmware = populated();
  const client = new RouteClient(firmware.request);
  const status = await client.status();
  const catalog = await client.list();
  expect(status.rev).toBe(firmware.rev);
  expect(catalog.items).toHaveLength(9);
  expect(catalog.items[0].inUse).toBe(true);
  const pages = firmware.calls.filter((c) => c.cmd === 1);
  expect(pages.map((c) => c.fields.cursor)).toEqual([0, 4, 8]);
  expect(pages[1].fields.if_rev).toBe(firmware.rev);
  await client.delete(2, catalog.rev);
  expect(firmware.items).toHaveLength(8);
});
test('restarts pagination instead of mixing snapshots when a route lease changes', async () => {
  const firmware = populated();
  let changed = false;
  const client = new RouteClient(async (...args) => {
    if (args[1] === 1 && args[3].cursor === 4 && !changed) {
      firmware.rev++;
      firmware.items.shift();
      changed = true;
    }
    return firmware.request(...args);
  });
  const catalog = await client.list();
  expect(catalog.items.map((i) => i.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  expect(firmware.calls.filter((c) => c.cmd === 1 && c.fields.cursor === 0)).toHaveLength(2);
});
test('bounds stale retries and rejects malformed pagination', async () => {
  const stale = vi.fn().mockResolvedValue({ err: { group: 64, rc: 11 } });
  await expect(new RouteClient(stale).list()).rejects.toMatchObject({ rc: 11 });
  expect(stale).toHaveBeenCalledTimes(3);
  await expect(
    new RouteClient(async () => ({ rev: 1n, items: [], next_cursor: 0 })).list(),
  ).rejects.toMatchObject({ kind: 'protocol' });
});
test('deletion rejects stale snapshots and routes in use, without retrying', async () => {
  const firmware = populated();
  const client = new RouteClient(firmware.request);
  await expect(client.delete(2, firmware.rev - 1n)).rejects.toMatchObject({ rc: 11 });
  await expect(client.delete(1, firmware.rev)).rejects.toMatchObject({ rc: 4 });
  expect(firmware.items).toHaveLength(9);
  expect(firmware.calls).toHaveLength(2);
});
test('accepts safe integers and uint64 bigint, rejects lossy or negative revisions', () => {
  expect(revision(42)).toBe(42n);
  expect(revision(0xffffffffffffffffn)).toBe(0xffffffffffffffffn);
  for (const value of [Number.MAX_SAFE_INTEGER + 1, -1n, 1n << 64n, '42'])
    expect(() => revision(value)).toThrow(DeviceError);
});
test('distinguishes global SMP errors and route/FS group errors', () => {
  for (const [reply, group, rc] of [
    [{ rc: 8 }, 0, 8],
    [{ err: { group: 8, rc: 3 } }, 8, 3],
    [{ err: { group: 64, rc: 12 } }, 64, 12],
  ] as const) {
    expect(() => checked(reply)).toThrow(expect.objectContaining({ kind: 'device', group, rc }));
  }
  expect(() => checked({ rc: '0' })).toThrow(DeviceError);
});
