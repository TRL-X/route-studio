import { selectOption } from '../controls';
import { expect, test, type Page } from '@playwright/test';
import { firmwarePeer, FirmwarePeer } from './firmware-peer';
import { deviceCommand } from './files';

async function openFirmware(page: Page, peer: FirmwarePeer, recovery = false) {
  await firmwarePeer(page, peer);
  await page.goto('/');
  await deviceCommand(page, recovery ? 'USB recovery…' : 'Update device firmware…');
  const dialog = page.getByRole('dialog', {
    name: recovery ? 'USB recovery' : 'Firmware update',
    exact: true,
  });
  await expect(dialog.getByRole('button', { name: 'Bluetooth update', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'USB recovery', exact: true })).toHaveCount(0);
  return dialog;
}

test('rejects a malformed local firmware file before connecting or uploading', async ({ page }) => {
  const peer = new FirmwarePeer();
  const dialog = await openFirmware(page, peer);
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles({
    name: 'broken.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not firmware'),
  });
  await expect(dialog.getByRole('alert')).toContainText('Choose a valid firmware .bin file');
  await expect(dialog.getByRole('button', { name: 'Start update', exact: true })).toBeDisabled();
  expect(peer.calls).toHaveLength(0);
});

test('keeps firmware and recovery settings inside a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('https://**/*', (route) => route.abort());
  const peer = new FirmwarePeer();
  await openFirmware(page, peer);
  for (const recovery of [false, true]) {
    if (recovery) await deviceCommand(page, 'USB recovery…');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await dialog.getByText('Advanced connection settings', { exact: true }).click();
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await dialog.getByLabel('Device profile (JSON)', { exact: true }).scrollIntoViewIfNeeded();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport({ ratio: 1 });
    await close.click();
  }
});

test('uploads a local binary over Bluetooth, tests it, reconnects and confirms the running image', async ({
  page,
}) => {
  const peer = new FirmwarePeer();
  const dialog = await openFirmware(page, peer);
  const choosing = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Choose firmware file…', exact: true }).click();
  await (await choosing).setFiles(peer.target.file);
  await expect(dialog.getByText(/firmware.bin · Version 2.1.0\+3/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Connect Bluetooth', exact: true }).click();
  await expect(dialog.getByText('Running version: 1.0.0', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Start update', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('is running and awaiting confirmation');
  expect(peer.received).toEqual(peer.target.file.buffer);
  expect(peer.tested).toBe(true);
  expect(peer.confirmed).toBe(false);
  await dialog.getByRole('button', { name: 'Confirm firmware', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Firmware update complete.');
  expect(peer.confirmed).toBe(true);
  expect(peer.calls.every(({ group }) => group === 0 || group === 1)).toBe(true);
});

test('resumes a lost Bluetooth upload acknowledgement using the device offset', async ({ page }) => {
  const peer = new FirmwarePeer();
  peer.dropUploadAck = true;
  const dialog = await openFirmware(page, peer);
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles(peer.target.file);
  await dialog.getByRole('button', { name: 'Connect Bluetooth', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start update', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Upload paused');
  expect(peer.received.length).toBeGreaterThan(0);
  const acknowledgedBytes = peer.received.length;
  await dialog.getByRole('button', { name: 'Continue update', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('is running and awaiting confirmation');
  expect(peer.received).toEqual(peer.target.file.buffer);
  expect(
    peer.calls.filter(({ group, command }) => group === 1 && command === 1).map(({ fields }) => fields.off),
  ).toEqual(expect.arrayContaining([0, acknowledgedBytes]));
});

test('reports a rollback without claiming that the selected update succeeded', async ({ page }) => {
  const peer = new FirmwarePeer();
  peer.rollback = true;
  const dialog = await openFirmware(page, peer);
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles(peer.target.file);
  await dialog.getByRole('button', { name: 'Connect Bluetooth', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start update', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Waiting for the device');
  await dialog.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  if (await dialog.getByRole('button', { name: 'Reconnect and check', exact: true }).count())
    await dialog.getByRole('button', { name: 'Reconnect and check', exact: true }).click();
  else await dialog.getByRole('button', { name: 'Check firmware status', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('previous firmware is running again');
  await expect(dialog.getByRole('button', { name: 'Confirm firmware', exact: true })).toHaveCount(0);
  expect(peer.calls.some(({ fields }) => fields.confirm === true)).toBe(false);
});

test('recognizes a firmware that confirms itself after restarting', async ({ page }) => {
  const peer = new FirmwarePeer();
  peer.selfConfirm = true;
  const dialog = await openFirmware(page, peer);
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles(peer.target.file);
  await dialog.getByRole('button', { name: 'Connect Bluetooth', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start update', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Firmware update complete.');
  expect(peer.calls.some(({ fields }) => fields.confirm === true)).toBe(false);
});

test('can explicitly end an unconfirmed update before opening USB recovery', async ({ page }) => {
  const peer = new FirmwarePeer();
  const dialog = await openFirmware(page, peer);
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles(peer.target.file);
  await dialog.getByRole('button', { name: 'Start update', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('is running and awaiting confirmation');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Device', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'USB recovery…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page
    .locator('.statusbar')
    .getByRole('button', { name: /^Firmware update · / })
    .click();
  await dialog.getByRole('button', { name: 'End task…', exact: true }).click();
  await expect(dialog.getByText(/An unconfirmed version may revert/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep task', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm firmware', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'End task…', exact: true }).click();
  await dialog.getByRole('button', { name: 'End task', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'End task…', exact: true })).toHaveCount(0);
  expect(peer.confirmed).toBe(false);
  expect(peer.received).toEqual(peer.target.file.buffer);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await deviceCommand(page, 'USB recovery…');
  await expect(page.getByRole('dialog', { name: 'USB recovery', exact: true })).toBeVisible();
});

test('requires serial recovery acknowledgement and writes firmware over USB without test or confirm', async ({
  page,
}) => {
  const peer = new FirmwarePeer();
  const dialog = await openFirmware(page, peer, true);
  await expect(dialog.getByRole('button', { name: 'Connect USB', exact: true })).toBeDisabled();
  await expect(dialog.getByText(/Recovery may overwrite the current firmware/)).toBeVisible();
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles(peer.target.file);
  await dialog.getByRole('checkbox', { name: 'The device is in USB recovery mode.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Connect USB', exact: true }).click();
  await dialog.getByRole('button', { name: 'Recover firmware', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Firmware written.');
  expect(peer.received).toEqual(peer.target.file.buffer);
  expect(peer.calls.every(({ transport }) => transport === 'usb')).toBe(true);
  expect(peer.calls.some(({ group, command }) => group === 1 && command === 0)).toBe(false);
  await expect(dialog.getByRole('button', { name: 'Restart and test', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Restart device', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Check that the device starts normally');
  expect(peer.calls.filter(({ group, command }) => group === 0 && command === 5)).toHaveLength(1);
});

test('normal USB uses v2 and the full test/reconnect/confirm workflow', async ({ page }) => {
  const peer = new FirmwarePeer();
  const dialog = await openFirmware(page, peer);
  await selectOption(dialog.getByLabel('Connection method', { exact: true }), 'usb');
  await expect(dialog.getByLabel('Protocol version', { exact: true })).toHaveAttribute('data-value', '2');
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles(peer.target.file);
  await dialog.getByRole('button', { name: 'Start update', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('is running and awaiting confirmation');
  expect(peer.received).toEqual(peer.target.file.buffer);
  expect(peer.calls.every((call) => call.transport === 'usb')).toBe(true);
  await dialog.getByRole('button', { name: 'Confirm firmware', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Firmware update complete.');
});
test('keeps application USB and recovery settings separate and persists edits', async ({ page }) => {
  const peer = new FirmwarePeer();
  const dialog = await openFirmware(page, peer);
  await selectOption(dialog.getByLabel('Connection method', { exact: true }), 'usb');
  await selectOption(dialog.getByLabel('Protocol version', { exact: true }), '1');
  await dialog.getByText('Advanced connection settings', { exact: true }).click();
  const profile = JSON.parse(await dialog.getByLabel('Device profile (JSON)', { exact: true }).inputValue());
  profile.baudRate = 921600;
  profile.bootWaitMs = 420000;
  await dialog.getByLabel('Device profile (JSON)', { exact: true }).fill(JSON.stringify(profile));
  await dialog.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await deviceCommand(page, 'USB recovery…');
  const recovery = page.getByRole('dialog', { name: 'USB recovery', exact: true });
  await expect(recovery.getByLabel('Protocol version', { exact: true })).toHaveAttribute('data-value', '1');
  await recovery.getByText('Advanced connection settings', { exact: true }).click();
  expect(
    JSON.parse(await recovery.getByLabel('Device profile (JSON)', { exact: true }).inputValue()).baudRate,
  ).toBe(115200);
  await page.reload();
  await deviceCommand(page, 'Update device firmware…');
  await selectOption(dialog.getByLabel('Connection method', { exact: true }), 'usb');
  await expect(dialog.getByLabel('Protocol version', { exact: true })).toHaveAttribute('data-value', '1');
  await dialog.getByText('Advanced connection settings', { exact: true }).click();
  expect(
    JSON.parse(await dialog.getByLabel('Device profile (JSON)', { exact: true }).inputValue()),
  ).toMatchObject({ baudRate: 921600, bootWaitMs: 420000 });
});
