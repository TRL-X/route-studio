import { expect, test } from '@playwright/test';
import { download, open } from './files';
import { bgsRequests } from './bgs';
import { emptyRoute } from '../../src/domain/model';
import { loadProject, saveProject } from '../../src/files/project';

for (const format of ['GPX', 'KML', 'FIT']) {
  test(`downloads and reopens ${format} without running the RTE lookup`, async ({ page }) => {
    let lookups = 0;
    await page.route(bgsRequests, (route) => {
      lookups++;
      return route.abort();
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose export format' }).click();
    await page.getByRole('menuitem', { name: `Export ${format}…`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Export ${format}`, exact: true });
    await expect(dialog.getByText('23 track points · 4 stations')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Bluetooth upload…' })).toHaveCount(0);
    await dialog.getByLabel('File name').fill('foo/bar');
    await expect(dialog.getByRole('button', { name: `Download ${format}` })).toBeDisabled();
    const name = '山脊.' + format.toLowerCase();
    await dialog.getByLabel('File name').fill(name);
    const file = await download(page, `Download ${format}`);
    expect(file.name).toBe(name);
    await open(page, file.name, file.bytes);
    await expect(page.getByText(file.name, { exact: true })).toBeVisible();
    const doc = loadProject((await download(page, 'Save project')).bytes.toString('utf8'));
    expect(doc.name).toBe('Ridgeline Traverse');
    expect(doc.vertices).toHaveLength(23);
    expect(doc.elevation[0].height).toBe(1020);
    expect(doc.stations).toHaveLength(4);
    expect(doc.stations.find((s) => s.name === 'Ridge Pass')).toBeTruthy();
    expect(lookups).toBe(0);
  });
}

test('previews omitted FIT cues and 2D KML while allowing an incomplete project to export', async ({
  page,
}) => {
  const doc = emptyRoute();
  doc.name = 'Incomplete trail';
  doc.vertices = [
    { id: 'a', lat: 1, lon: 2 },
    { id: 'b', lat: 1, lon: 3 },
  ];
  doc.elevation = [{ anchor: { vertexId: 'a', fraction: 0 }, height: 42 }];
  doc.stations = [
    {
      id: 'u',
      name: 'Unassigned water',
      kind: 'poi',
      boundary: false,
      anchor: null,
      location: { lat: 1, lon: 2.4 },
    },
  ];
  await page.goto('/');
  await open(page, 'trail.routeproj', Buffer.from(saveProject(doc)));
  await expect(page.getByRole('heading', { name: doc.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose export format' }).click();
  await page.getByRole('menuitem', { name: 'Export FIT…', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/stations without a route position/i)).toContainText('Unassigned water');
  await expect(dialog.getByText('The file omits elevation at 1 of its track points.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download FIT' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Choose export format' }).click();
  await page.getByRole('menuitem', { name: 'Export KML…', exact: true }).click();
  await expect(dialog.getByText(/the line is exported in 2D/i)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download KML' })).toBeEnabled();
});
