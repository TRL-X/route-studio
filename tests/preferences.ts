import { type Page } from '@playwright/test';
import { selectOption } from './controls';

export async function openSettings(page: Page) {
  await page.getByRole('button', { name: /^(Menu|菜单)$/ }).click();
  await page.getByRole('menuitem', { name: /^(Settings…|设置…)$/ }).click();
  return page.getByRole('dialog', { name: /^(Settings|设置)$/ });
}

export async function setPreference(page: Page, label: string | RegExp, value: string) {
  const dialog = await openSettings(page);
  await selectOption(dialog.getByLabel(label, { exact: true }), value);
  await dialog.getByRole('button', { name: /^(Apply|应用)$/ }).click();
}
