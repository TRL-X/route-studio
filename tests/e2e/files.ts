import { selectOption } from '../controls';
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { strings } from '../../src/app/strings';

export async function open(page: Page, name: string, bytes: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await (await chooser).setFiles({ name, buffer: bytes, mimeType: 'application/octet-stream' });
}

export async function openExport(page: Page) {
  if (!(await page.getByRole('dialog').isVisible()))
    await page.getByRole('button', { name: strings.en.export, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return page.getByRole('dialog');
}
export async function openMagnetics(page: Page) {
  const dialog = await openExport(page);
  if (!(await dialog.getByLabel('Declination mode').isVisible()))
    await dialog.locator('.mag-export summary').click();
  return dialog;
}
export async function setSurveyDate(page: Page) {
  const dialog = await openMagnetics(page);
  const date = dialog.getByLabel('Reference date (UTC)');
  await date.fill('2026-11-03');
  await date.press('Enter');
  await dialog.getByRole('button', { name: 'Close' }).click();
}
export async function disableExportProcessing(page: Page) {
  const dialog = await openExport(page);
  await dialog.getByText('Route processing options').click();
  await selectOption(dialog.getByLabel('Elevation sample spacing'), '0');
  await selectOption(dialog.getByLabel('Geometry tolerance'), '0');
  await selectOption(dialog.getByLabel('Smoothing window'), '0');
}
export async function download(page: Page, button: string) {
  if (button === 'Download RTE') await openExport(page);
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const file = await started;
  return {
    name: file.suggestedFilename(),
    bytes: await readFile((await file.path())!),
  };
}
