import { expect, test } from '@playwright/test';
import { selectOption } from '../controls';
import { Firmware } from '../device/firmware';
import { devicePeer } from './device-peer';
import { deviceCommand } from './files';

for (const transport of ['ble', 'usb'] as const) {
  test(`cancelling ${transport} selection is silent and allows a successful retry`, async ({ page }) => {
    const firmware = new Firmware();
    await devicePeer(page, firmware);
    await page.goto('/');
    await deviceCommand(page, 'Device connection…');
    const dialog = page.getByRole('dialog', { name: 'Device connection', exact: true });
    await selectOption(dialog.getByLabel('Connection method', { exact: true }), transport);
    await page.evaluate((kind) => {
      if (kind === 'ble') {
        const original = navigator.bluetooth.requestDevice;
        navigator.bluetooth.requestDevice = async () => {
          navigator.bluetooth.requestDevice = original;
          throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
        };
      } else {
        const original = navigator.serial!.requestPort;
        navigator.serial!.requestPort = async () => {
          navigator.serial!.requestPort = original;
          throw new DOMException(
            "Failed to execute 'requestPort' on 'Serial': No port selected by the user.",
            'NotFoundError',
          );
        };
      }
    }, transport);

    const connect = dialog.getByRole('button', { name: 'Connect device', exact: true });
    await connect.click();
    await expect(connect).toBeEnabled();
    await expect(dialog.getByRole('status')).toHaveText('Not connected');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.device-task-status')).toHaveCount(0);
    expect(firmware.calls).toHaveLength(0);

    await connect.click();
    await expect(dialog.getByRole('status')).toHaveText(
      transport === 'ble' ? 'Connected · AR Cap · Bluetooth' : 'Connected · Serial · USB',
    );
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  });
}
