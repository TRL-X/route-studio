import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { strings } from '../../src/app/strings';

export async function open(page: Page, name: string, bytes: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await (await chooser).setFiles({ name, buffer: bytes, mimeType: 'application/octet-stream' });
}

export async function openExport(page: Page) {
  if (!(await page.getByRole('dialog').isVisible()))
    await page.getByRole('button', { name: strings.en.export, exact: true }).click();
  return page.getByRole('dialog');
}
export async function openMagnetics(page: Page) {
  const dialog = await openExport(page);
  if (!(await dialog.getByLabel('Declination mode').isVisible()))
    await dialog.locator('.mag-export summary').click();
  return dialog;
}
export async function disableExportProcessing(page: Page) {
  const dialog = await openExport(page);
  await dialog.getByText('Route processing options').click();
  await dialog.getByLabel('Elevation sample spacing').selectOption('0');
  await dialog.getByLabel('Geometry tolerance').selectOption('0');
  await dialog.getByLabel('Smoothing window').selectOption('0');
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
