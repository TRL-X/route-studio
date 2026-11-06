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
  await expect(dialog.getByRole('alert')).toContainText('Select a valid MCUboot .bin file');
  await expect(dialog.getByRole('button', { name: 'Start update', exact: true })).toBeDisabled();
  expect(peer.calls).toHaveLength(0);
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
  await expect(dialog.getByRole('status')).toContainText('is running but is not confirmed');
  expect(peer.received).toEqual(peer.target.file.buffer);
  expect(peer.tested).toBe(true);
  expect(peer.confirmed).toBe(false);
  await dialog.getByRole('button', { name: 'Confirm firmware', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText(
    'Firmware update complete. The selected version is running and confirmed.',
  );
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
  await expect(dialog.getByRole('status')).toContainText('is running but is not confirmed');
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
  await dialog.getByRole('button', { name: 'Check firmware status', exact: true }).click();
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
  await expect(dialog.getByRole('status')).toContainText('running and confirmed');
  expect(peer.calls.some(({ fields }) => fields.confirm === true)).toBe(false);
});

test('can explicitly end an unconfirmed update before opening USB recovery', async ({ page }) => {
  const peer = new FirmwarePeer();
  const dialog = await openFirmware(page, peer);
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles(peer.target.file);
  await dialog.getByRole('button', { name: 'Start update', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('is running but is not confirmed');
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
  await expect(dialog.getByText(/an unconfirmed test image may revert/)).toBeVisible();
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
  await expect(dialog.getByText(/Recovery can overwrite the running firmware/)).toBeVisible();
  await dialog.getByLabel('Firmware file', { exact: true }).setInputFiles(peer.target.file);
  await dialog.getByRole('checkbox', { name: 'The device is in serial recovery mode.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Connect USB', exact: true }).click();
  await dialog.getByRole('button', { name: 'Recover firmware', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Firmware written.');
  expect(peer.received).toEqual(peer.target.file.buffer);
  expect(peer.calls.every(({ transport }) => transport === 'usb')).toBe(true);
  expect(peer.calls.some(({ group, command }) => group === 1 && command === 0)).toBe(false);
  await expect(dialog.getByRole('button', { name: 'Test and restart', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Restart device', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(
    'recovery upload does not verify application health',
  );
  expect(peer.calls.filter(({ group, command }) => group === 0 && command === 5)).toHaveLength(1);
});
