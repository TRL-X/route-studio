import { selectOption } from '../controls';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { download, open, openExport } from './files';
import { Firmware } from '../device/firmware';
import { devicePeer } from './device-peer';

test('uploads through Group 64, resumes lost ACKs, and shares the connection with device routes', async ({
  page,
}) => {
  const firmware = new Firmware();
  firmware.lose = 'write';
  await devicePeer(page, firmware);
  await page.goto('/');
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const local = await download(page, 'Download RTE');
  const dialog = await openExport(page);
  await expect(dialog.getByLabel('Device path')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Connect device', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Refresh routes' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(
    dialog.getByText('Transfer paused. Continue with the same device and route data.'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Reconnect and continue' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Device is validating the route…', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel upload' })).toBeDisabled();
  await expect(dialog.getByText('Route added to device · Device route')).toBeVisible();
  expect(firmware.received).toEqual(new Uint8Array(local.bytes));
  expect(firmware.items).toHaveLength(1);
  expect(firmware.calls.filter((c) => c.group === 64 && c.cmd === 2)).toHaveLength(1);
  await expect(dialog.getByRole('button', { name: 'Sent to AR Cap', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'View device routes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog').getByText('Connected · AR Cap')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Device route', exact: true })).toBeVisible();
});

test('manages paginated routes without a local project and protects in-use and stale deletions', async ({
  page,
}) => {
  const firmware = new Firmware();
  firmware.items = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    name: `Route ${i + 1}`,
    size: 1000,
    total_dm: 12345,
    state: i === 5 ? 'invalid' : 'ready',
    error: i === 5 ? 8 : 0,
    in_use: i === 0,
  }));
  await devicePeer(page, firmware);
  await page.goto('/');
  await page.locator('.device-status-button').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Connect device', exact: true }).click();
  await expect(dialog.getByRole('rowheader')).toHaveCount(6);
  await expect(dialog.getByRole('button', { name: 'Delete Route 1', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Invalid route', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete Route 2', exact: true }).click();
  firmware.rev++;
  await dialog.getByRole('button', { name: 'Delete route', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('The device route list changed');
  expect(firmware.items).toHaveLength(6);
  await dialog.getByRole('button', { name: 'Delete Route 2', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete route', exact: true }).click();
  await expect(dialog.getByRole('rowheader')).toHaveCount(5);
  expect(firmware.calls.filter((c) => c.cmd === 5).map((c) => typeof c.fields.if_rev)).toEqual([
    'bigint',
    'bigint',
  ]);
});

test('shows validation failure and can cancel a resumed upload without committing', async ({ page }) => {
  const firmware = new Firmware();
  firmware.validationError = 8;
  await devicePeer(page, firmware);
  await page.goto('/');
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const dialog = await openExport(page);
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  const send = dialog.getByRole('button', { name: 'Send to AR Cap', exact: true });
  await expect(dialog.getByRole('alert')).toContainText(
    "The device rejected the route's checksum or structure",
  );
  await expect(dialog.getByText(/Route added to device/)).toHaveCount(0);
  await expect(send).toBeEnabled();
  firmware.validationError = 0;
  firmware.lose = 'write';
  const committed = firmware.calls.filter((c) => c.group === 64 && c.cmd === 3).length;
  await send.click();
  await expect(dialog.getByRole('button', { name: 'Reconnect and continue' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Manage device routes' }).click();
  const manager = page.getByRole('dialog', { name: 'Device', exact: true });
  await manager.getByRole('button', { name: 'Reconnect device' }).click();
  await manager.getByRole('button', { name: 'Cancel upload' }).click();
  await expect(manager.getByText('Upload cancelled.', { exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Back to export' }).click();
  await expect(dialog.getByText('Upload cancelled.', { exact: true })).toBeVisible();
  await expect(send).toBeEnabled();
  expect(firmware.calls.filter((c) => c.group === 64 && c.cmd === 3)).toHaveLength(committed);
  expect(firmware.received).toHaveLength(0);
});

test('uses one management panel, preserves export settings, and shows global device status', async ({
  page,
}) => {
  const firmware = new Firmware();
  firmware.freeBytes = 1;
  firmware.items = [
    { id: 1, name: 'Old route', size: 1000, total_dm: 1000, state: 'ready', error: 0, in_use: false },
  ];
  await devicePeer(page, firmware);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Device · Not connected', exact: true })).toBeVisible();
  await expect(page.locator('.statusbar .device-status-button')).toHaveCount(0);
  await expect(page.locator('.topbar .device-status-button')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.device-status-button')).toHaveText('');
  await expect(page.locator('.device-status-button')).toHaveAttribute('data-accent-color', 'gray');
  await expect(page.locator('.device-status-button .lucide-bluetooth-off')).toHaveCount(1);
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const dialog = await openExport(page);
  await dialog.getByLabel('File name').fill('My export');
  await dialog.getByText('Route processing options').click();
  await selectOption(dialog.getByLabel('Elevation sample spacing'), '20');
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Not enough storage');
  await dialog.getByRole('button', { name: 'Manage device routes' }).click();
  const manager = page.getByRole('dialog', { name: 'Device', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(manager.getByRole('rowheader', { name: 'Old route', exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Connect another device' })).toBeVisible();
  await manager.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await manager.getByRole('button', { name: 'Reconnect device' }).click();
  await expect(page.locator('.device-status-button')).toHaveAttribute('aria-label', 'AR Cap · Connected');
  await expect(page.locator('.device-status-button')).toHaveAttribute('data-accent-color', 'blue');
  await expect(page.locator('.device-status-button .lucide-bluetooth')).toHaveCount(1);
  firmware.freeBytes = 10000000;
  await manager.getByRole('button', { name: 'Back to export' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByLabel('File name')).toHaveValue('My export');
  await dialog.getByText('Route processing options').click();
  await expect(dialog.getByLabel('Elevation sample spacing')).toHaveAttribute('data-value', '20');
  await dialog.getByRole('button', { name: 'Send to AR Cap', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Sent to AR Cap', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'View device routes' }).click();
  await manager.getByRole('button', { name: 'Delete Device route', exact: true }).click();
  await manager.getByRole('button', { name: 'Delete route', exact: true }).click();
  await expect(manager.getByRole('rowheader', { name: 'Device route', exact: true })).toHaveCount(0);
  await manager.getByRole('button', { name: 'Back to export' }).click();
  await expect(dialog.getByRole('button', { name: 'Send to AR Cap', exact: true })).toBeEnabled();
});

test('keeps the compact send action and device status visible at narrow widths', async ({ page }) => {
  const firmware = new Firmware();
  await devicePeer(page, firmware);
  await page.goto('/');
  await page.setViewportSize({ width: 360, height: 600 });
  await expect(page.getByRole('button', { name: 'Device · Not connected', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const dialog = await openExport(page);
  await expect(dialog.getByRole('button', { name: 'Connect and send…', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Sent to AR Cap', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'View device routes' })).toBeInViewport({ ratio: 1 });
  await expect(dialog).toBeInViewport({ ratio: 1 });
  expect(
    (await dialog.getByRole('heading', { name: 'Export route', exact: true }).boundingBox())!.height,
  ).toBeGreaterThanOrEqual(18);
});
