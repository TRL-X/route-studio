import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

export async function open(page: Page, name: string, bytes: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await (await chooser).setFiles({ name, buffer: bytes, mimeType: 'application/octet-stream' });
}

export async function download(page: Page, button: string) {
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const file = await started;
  return {
    name: file.suggestedFilename(),
    bytes: await readFile((await file.path())!),
  };
}
