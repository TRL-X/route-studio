import { selectOption } from '../controls';
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { commandStrings } from '../../src/features/editor/commands';
import { saveProject } from '../../src/files/project';
import { ridgeRoute } from '../fixtures/ridge';

export async function open(page: Page, name: string, bytes: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: commandStrings.en.open, exact: true }).click();
  await (await chooser).setFiles({ name, buffer: bytes, mimeType: 'application/octet-stream' });
}

export async function openRidge(page: Page) {
  const doc = ridgeRoute();
  await page.locator('input[type=file]').setInputFiles({
    name: 'ridge.routeproj',
    mimeType: 'application/json',
    buffer: Buffer.from(saveProject(doc)),
  });
  await expect(page.getByRole('heading', { name: doc.name, exact: true })).toBeVisible();
}

export async function openExport(page: Page) {
  if (!(await page.getByRole('dialog').isVisible()))
    await page.getByRole('button', { name: commandStrings.en.export, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return page.getByRole('dialog');
}

export async function deviceCommand(page: Page, name: string) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Device', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

export async function openSend(page: Page) {
  await deviceCommand(page, 'Send current route…');
  const dialog = page.getByRole('dialog', { name: 'Send current route', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function openMagnetics(page: Page) {
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Edit route properties', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Route', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Route properties', exact: true }).click();
  }
  const inspector = page.locator('.inspector');
  if (!(await inspector.getByLabel('Declination mode').isVisible()))
    await inspector.locator('.magnetic-properties summary').click();
  return inspector;
}
export async function setSurveyDate(page: Page) {
  const inspector = await openMagnetics(page);
  const date = inspector.getByLabel('Reference date (UTC)');
  await date.fill('2026-11-03');
  await date.press('Enter');
  await inspector.locator('.magnetic-properties summary').click();
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
  if (button === commandStrings.en.save) {
    await page.getByRole('button', { name: commandStrings.en.menu, exact: true }).click();
    await page.getByRole('menuitem', { name: commandStrings.en.file, exact: true }).click();
    await page.getByRole('menuitem', { name: button, exact: true }).click();
  } else await page.getByRole('button', { name: button, exact: true }).click();
  const file = await started;
  return {
    name: file.suggestedFilename(),
    bytes: await readFile((await file.path())!),
  };
}
