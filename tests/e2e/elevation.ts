import type { Page } from '@playwright/test';
import copy from '../../src/i18n/en.repair.json' with { type: 'json' };

export async function openElevationTools(page: Page) {
  await page.getByRole('button', { name: 'Elevation tools…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Elevation tools', exact: true });
}

export async function openOnlineTerrain(page: Page) {
  const tools = await openElevationTools(page);
  await tools.getByRole('button', { name: 'Get elevations online', exact: true }).click();
  return page.getByRole('dialog', { name: copy.title, exact: true });
}
