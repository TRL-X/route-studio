import { selectOption } from '../controls';
import { openSettings, setPreference } from '../preferences';
import { openExport } from './files';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
});

test('follows system changes, persists overrides and preserves the current selection', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const settings = await openSettings(page);
  await expect(settings.getByLabel('Appearance', { exact: true })).toHaveAttribute('data-value', 'system');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /Ridge Pass.*Checkpoint/ }).click();
  await setPreference(page, 'Appearance', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Ridge Pass');
  await expect(page.locator('.rv-station-active')).toHaveAttribute('data-station', '2');
  await page.reload();
  await openSettings(page);
  await expect(settings.getByLabel('Appearance', { exact: true })).toHaveAttribute('data-value', 'dark');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await setPreference(page, 'Appearance', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await setPreference(page, 'Appearance', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('changes appearance and opens dialogs when preference storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage disabled');
    };
    Storage.prototype.getItem = () => {
      throw new Error('Storage disabled');
    };
  });
  await page.goto('/');
  for (const theme of ['dark', 'light']) {
    await setPreference(page, 'Appearance', theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const dialog = await openExport(page);
    await selectOption(dialog.getByLabel('Choose export format'), 'gpx');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('color-scheme', theme);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export…', exact: true })).toBeFocused();
  }
});

test('keeps the color basemap, labels and camera stable across appearance changes', async ({ page }) => {
  await page.unroute('https://**/*');
  const styles: string[] = [];
  await page.route('https://tiles.openfreemap.org/styles/**', async (route) => {
    styles.push(route.request().url());
    await route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#20242b' } }],
      },
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect.poll(() => styles.some((url) => url.endsWith('/liberty'))).toBe(true);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const path = await page.locator('.rv-route').getAttribute('d');
  const canvas = await page.locator('.rv-base canvas').elementHandle();
  const labelColor = await page
    .locator('.rv-station text')
    .first()
    .evaluate((el) => getComputedStyle(el).fill);
  await setPreference(page, 'Appearance', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(styles.every((url) => url.endsWith('/liberty'))).toBe(true);
  expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.locator('.rv-station text').first()).toHaveCSS('fill', labelColor);
  await expect(page.locator('.rv-route')).toHaveAttribute('d', path!);
});
