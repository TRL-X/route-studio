import { selectOption } from '../controls';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { deviceCommand, download, open, openExport, openSend } from './files';
import { Firmware } from '../device/firmware';
import { devicePeer } from './device-peer';

test('sends a route using the previous normal transport after closing USB recovery', async ({ page }) => {
  const firmware = new Firmware();
  await devicePeer(page, firmware);
  await page.goto('/');
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  await deviceCommand(page, 'Device connection…');
  const connection = page.getByRole('dialog', { name: 'Device connection', exact: true });
  await selectOption(connection.getByLabel('Connection method', { exact: true }), 'usb');
  await connection.getByRole('button', { name: 'Close', exact: true }).click();

  await deviceCommand(page, 'USB recovery…');
  const recovery = page.getByRole('dialog', { name: 'USB recovery', exact: true });
  await expect(recovery.getByLabel('Protocol version', { exact: true })).toHaveAttribute('data-value', '1');
  await recovery.getByRole('button', { name: 'Close', exact: true }).click();

  const send = await openSend(page);
  await expect(send.getByLabel('Connection method', { exact: true })).toHaveAttribute('data-value', 'usb');
  await expect(send.getByLabel('Protocol version', { exact: true })).toHaveAttribute('data-value', '2');
  await send.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(send.getByText('Route added to device · Device route')).toBeVisible();
});

test('uploads through Group 64, resumes lost ACKs, and shares the connection with device routes', async ({
  page,
}) => {
  const firmware = new Firmware();
  firmware.lose = 'write';
  await devicePeer(page, firmware);
  await page.goto('/');
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const local = await download(page, 'Download RTE');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const dialog = await openSend(page);
  await expect(dialog.getByLabel('Device path')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Connect device', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Refresh routes' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(dialog.getByText('Transfer paused. Reconnect if needed, then continue.')).toBeVisible();
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
  await deviceCommand(page, 'Manage device routes…');
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
  const dialog = await openSend(page);
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
  const manager = page.getByRole('dialog', { name: 'Device routes', exact: true });
  await manager.getByRole('button', { name: 'Reconnect device' }).click();
  await manager.getByRole('button', { name: 'Cancel upload' }).click();
  await expect(manager.getByText('Upload cancelled.', { exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await openSend(page);
  await expect(dialog.getByText('Upload cancelled.', { exact: true })).toBeVisible();
  await expect(send).toBeEnabled();
  expect(firmware.calls.filter((c) => c.group === 64 && c.cmd === 3)).toHaveLength(committed);
  expect(firmware.received).toHaveLength(0);
});

test('keeps file export separate, shares Bluetooth across tasks, and preserves send options', async ({
  page,
}) => {
  const firmware = new Firmware();
  firmware.freeBytes = 1;
  firmware.items = [
    { id: 1, name: 'Old route', size: 1000, total_dm: 1000, state: 'ready', error: 0, in_use: false },
  ];
  await devicePeer(page, firmware);
  await page.goto('/');
  await expect(page.locator('.topbar .device-status-button')).toHaveCount(0);
  await expect(page.locator('.topbar').getByRole('button', { name: 'Settings…', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator('.statusbar').getByRole('button', { name: /Route transfer|Firmware update|USB recovery/ }),
  ).toHaveCount(0);
  await deviceCommand(page, 'Device connection…');
  const connection = page.getByRole('dialog', { name: 'Device connection', exact: true });
  await connection.getByRole('button', { name: 'Connect device', exact: true }).click();
  await expect(connection.getByText('Connected · AR Cap · Bluetooth', { exact: true })).toBeVisible();
  expect(firmware.calls).toHaveLength(1);
  await connection.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.locator('.statusbar').getByRole('button', { name: /Route transfer|Firmware update|USB recovery/ }),
  ).toHaveCount(0);
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const fileExport = await openExport(page);
  await expect(fileExport.getByRole('button', { name: 'Download RTE', exact: true })).toBeEnabled();
  await expect(fileExport.getByRole('button', { name: /send/i })).toHaveCount(0);
  await fileExport.getByLabel('File name').fill('My export');
  await fileExport.getByRole('button', { name: 'Close', exact: true }).click();
  const dialog = await openSend(page);
  await expect(dialog.getByLabel('File name')).toHaveCount(0);
  await expect(dialog.getByLabel('Format', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Download/ })).toHaveCount(0);
  await dialog.getByText('Route processing options').click();
  await selectOption(dialog.getByLabel('Elevation sample spacing'), '20');
  await dialog.getByRole('button', { name: 'Send to AR Cap', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Not enough storage');
  await dialog.getByRole('button', { name: 'Manage device routes' }).click();
  const manager = page.getByRole('dialog', { name: 'Device routes', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(manager.getByRole('rowheader', { name: 'Old route', exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Firmware…', exact: true })).toHaveCount(0);
  firmware.freeBytes = 10000000;
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await openSend(page);
  await dialog.getByText('Route processing options').click();
  await expect(dialog.getByLabel('Elevation sample spacing')).toHaveAttribute('data-value', '20');
  await dialog.getByRole('button', { name: 'Send to AR Cap', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Sent to AR Cap', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'View device routes' }).click();
  await manager.getByRole('button', { name: 'Delete Device route', exact: true }).click();
  await manager.getByRole('button', { name: 'Delete route', exact: true }).click();
  await expect(manager.getByRole('rowheader', { name: 'Device route', exact: true })).toHaveCount(0);
  await manager.getByRole('button', { name: 'Close', exact: true }).click();
  await openSend(page);
  await expect(dialog.getByRole('button', { name: 'Send to AR Cap', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await openExport(page);
  await expect(fileExport.getByLabel('File name')).toHaveValue('My export');
});

test('reopens a paused route transfer from the status bar without changing its preview', async ({ page }) => {
  const firmware = new Firmware();
  firmware.lose = 'write';
  await devicePeer(page, firmware);
  await page.goto('/');
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const dialog = await openSend(page);
  const routeLabel = await dialog.getByText(/^Route · /).textContent();
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Reconnect and continue' })).toBeEnabled();
  await dialog.getByText('Route processing options').click();
  await expect(dialog.getByLabel('Elevation sample spacing')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Route', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Route properties', exact: true }).click();
  const name = page.locator('.inspector').getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Edited while the transfer is paused');
  await name.press('Enter');
  await page
    .locator('.statusbar')
    .getByRole('button', { name: /^Route transfer · / })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(routeLabel!, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Reconnect and continue' }).click();
  await expect(dialog.getByRole('button', { name: 'Sent to AR Cap', exact: true })).toBeDisabled();
  expect(firmware.items).toHaveLength(1);
});

test('hides an active route transfer without cancelling it or showing a stale firmware error', async ({
  page,
}) => {
  const firmware = new Firmware();
  const request = firmware.request;
  let releaseUpload!: () => void;
  let uploadStarted!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const started = new Promise<void>((resolve) => {
    uploadStarted = resolve;
  });
  firmware.request = async (...args) => {
    if (args[0] === 8 && args[1] === 0) {
      uploadStarted();
      await held;
    }
    return request(...args);
  };
  await devicePeer(page, firmware);
  await page.goto('/');
  await deviceCommand(page, 'Update device firmware…');
  const firmwareDialog = page.getByRole('dialog', { name: 'Firmware update', exact: true });
  await firmwareDialog.getByLabel('Firmware file', { exact: true }).setInputFiles({
    name: 'broken.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not firmware'),
  });
  await expect(firmwareDialog.getByRole('alert')).toContainText('Choose a valid firmware .bin file');
  await firmwareDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const dialog = await openSend(page);
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await started;
  try {
    await dialog.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.statusbar').getByRole('button', { name: /^Firmware update · / })).toHaveCount(
      0,
    );
    await page
      .locator('.statusbar')
      .getByRole('button', { name: /^Route transfer · / })
      .click();
    await expect(dialog.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
  } finally {
    releaseUpload();
  }
  await expect(dialog.getByRole('button', { name: 'Sent to AR Cap', exact: true })).toBeDisabled();
  expect(firmware.items).toHaveLength(1);
  expect(firmware.calls.filter(({ group, cmd }) => group === 64 && cmd === 4)).toHaveLength(0);
});

test('keeps the send action visible at narrow widths without device toolbar controls', async ({ page }) => {
  const firmware = new Firmware();
  await devicePeer(page, firmware);
  await page.goto('/');
  await page.setViewportSize({ width: 360, height: 600 });
  await expect(page.locator('.topbar .device-status-button')).toHaveCount(0);
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const dialog = await openSend(page);
  await expect(dialog.getByRole('button', { name: 'Connect and send…', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await dialog.getByText('Advanced connection settings', { exact: true }).click();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole('button', { name: 'Connect and send…', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await dialog.getByLabel('Device profile (JSON)', { exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByText('Advanced connection settings', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Sent to AR Cap', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'View device routes' })).toBeInViewport({ ratio: 1 });
  await expect(dialog).toBeInViewport({ ratio: 1 });
  expect(
    (await dialog.getByRole('heading', { name: 'Send current route', exact: true }).boundingBox())!.height,
  ).toBeGreaterThanOrEqual(18);
});

test('can end a disconnected route validation task to open USB recovery without cancelling remote work', async ({
  page,
}) => {
  const firmware = new Firmware();
  firmware.lose = 'commit';
  await devicePeer(page, firmware);
  await page.goto('/');
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const dialog = await openSend(page);
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'End task…', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Cancel upload', exact: true })).toBeDisabled();
  expect(firmware.state).toBe('verifying');
  const written = firmware.received.slice();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Device', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'USB recovery…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page
    .locator('.statusbar')
    .getByRole('button', { name: /^Route transfer · / })
    .click();
  await dialog.getByRole('button', { name: 'End task…', exact: true }).click();
  await expect(dialog.getByText(/Data already sent stays on the device/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep task', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Reconnect and continue', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'End task…', exact: true }).click();
  await dialog.getByRole('button', { name: 'End task', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'End task…', exact: true })).toHaveCount(0);
  expect(firmware.received).toEqual(written);
  expect(firmware.state).toBe('verifying');
  expect(firmware.calls.filter(({ group, cmd }) => group === 64 && cmd === 4)).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await deviceCommand(page, 'USB recovery…');
  await expect(page.getByRole('dialog', { name: 'USB recovery', exact: true })).toBeVisible();
});

test('sends, resumes and deletes a route through normal USB', async ({ page }) => {
  const firmware = new Firmware();
  firmware.lose = 'write';
  await devicePeer(page, firmware);
  await page.goto('/');
  await open(page, 'test.rte', await readFile(new URL('../rte/vectors/a.rte', import.meta.url)));
  const dialog = await openSend(page);
  await selectOption(dialog.getByLabel('Connection method', { exact: true }), 'usb');
  await expect(dialog.getByLabel('Protocol version', { exact: true })).toHaveAttribute('data-value', '2');
  await dialog.getByRole('button', { name: 'Connect and send…', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Reconnect and continue', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Reconnect and continue', exact: true }).click();
  await expect(dialog.getByText('Route added to device · Device route')).toBeVisible();
  await dialog.getByRole('button', { name: 'View device routes', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Device routes', exact: true });
  await manager.getByRole('button', { name: 'Delete Device route', exact: true }).click();
  await manager.getByRole('button', { name: 'Delete route', exact: true }).click();
  await expect(manager.getByRole('rowheader', { name: 'Device route', exact: true })).toHaveCount(0);
  expect(firmware.calls.filter((call) => call.group === 64 && call.cmd === 2)).toHaveLength(1);
});
