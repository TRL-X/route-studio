import { selectOption } from '../controls';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
});

test('follows system changes, persists overrides and preserves the current selection', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const appearance = page.getByLabel('Appearance', { exact: true });
  await expect(appearance).toHaveAttribute('data-value', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /Ridge Pass.*Checkpoint/ }).click();
  await selectOption(appearance, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Ridge Pass');
  await expect(page.locator('.rv-station-active')).toHaveAttribute('data-station', '2');
  await page.reload();
  await expect(appearance).toHaveAttribute('data-value', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await selectOption(appearance, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await selectOption(appearance, 'system');
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
  const appearance = page.getByLabel('Appearance', { exact: true });
  for (const theme of ['dark', 'light']) {
    await selectOption(appearance, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'Choose export format' }).click();
    await page.getByRole('menuitem', { name: 'Export GPX…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export GPX', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('color-scheme', theme);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose export format' })).toBeFocused();
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
  await selectOption(page.getByLabel('Appearance', { exact: true }), 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(styles.every((url) => url.endsWith('/liberty'))).toBe(true);
  expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.locator('.rv-station text').first()).toHaveCSS('fill', labelColor);
  await expect(page.locator('.rv-route')).toHaveAttribute('d', path!);
});
