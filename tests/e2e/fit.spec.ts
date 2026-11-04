import { selectOption } from '../controls';
import { expect, test } from '@playwright/test';
import { multisportActivity, indoorActivity, outAndBackCourse } from '../files/fit-fixtures';
import { loadProject } from '../../src/files/project';
import { download, open } from './files';

test('opens a FIT course and keeps it when the next activity has no GPS', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('input[type=file]')).toHaveAttribute('accept', /\.fit/);
  await open(page, 'loop.FIT', Buffer.from(outAndBackCourse()));
  await expect(page.getByRole('heading', { name: '山脊', exact: true })).toBeVisible();
  const doc = loadProject((await download(page, 'Save project')).bytes.toString('utf8'));
  expect(doc.stations[2]).toMatchObject({
    name: '返回 CP',
    anchor: { vertexId: doc.vertices[1].id, fraction: 0.5 },
  });
  await open(page, 'indoor.fit', Buffer.from(indoorActivity()));
  await expect(page.getByRole('alert')).toContainText('No GPS track');
  await expect(page.getByRole('heading', { name: '山脊', exact: true })).toBeVisible();
});

test('drops a multisport FIT and opens just the selected session', async ({ page }) => {
  await page.goto('/');
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(bytes)], 'race.fit'));
      return data;
    },
    [...multisportActivity()],
  );
  await page.locator('.shell').dispatchEvent('drop', { dataTransfer: transfer });
  const dialog = page.getByRole('dialog', { name: 'Choose a route to open' });
  await selectOption(dialog.getByRole('combobox'), '1');
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'race · 2 · cycling', exact: true })).toBeVisible();
  await expect(page.getByText('2 vertices', { exact: true })).toBeVisible();
});
