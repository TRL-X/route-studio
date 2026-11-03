import { expect, test } from '@playwright/test';
import { emptyRoute } from '../../src/domain/model';
import { saveProject } from '../../src/files/project';

test('aligns the workbench headers and keeps file actions inside a narrow window', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Export RTE…' }).waitFor();
  const headerEdges = await page
    .locator('.workspace .panel-heading, .map-tools')
    .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().bottom));
  expect(headerEdges).toHaveLength(3);
  expect(Math.max(...headerEdges) - Math.min(...headerEdges)).toBeLessThanOrEqual(1);

  for (const width of [1440, 621, 480]) {
    await page.setViewportSize({ width, height: 700 });
    const actions = await page.locator('.top-actions > button').evaluateAll((elements) =>
      elements.map((el) => {
        const { top, bottom, right } = el.getBoundingClientRect();
        return { top, bottom, right };
      }),
    );
    const [first] = actions;
    for (const rect of actions) {
      expect(Math.abs(rect.top - first.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(rect.bottom - first.bottom)).toBeLessThanOrEqual(1);
      expect(rect.right).toBeLessThanOrEqual(width);
    }
  }
});

test('selecting a map station reveals its row without resetting the outline filter', async ({ page }) => {
  const doc = emptyRoute();
  doc.vertices = Array.from({ length: 24 }, (_, i) => ({ id: String(i), lat: 46, lon: 7 + i * 0.001 }));
  doc.stations = doc.vertices.map((v, i) => ({
    id: String(i),
    name: 'Station ' + i,
    kind: 'cp',
    boundary: false,
    anchor: { vertexId: v.id, fraction: 0 },
  }));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'stations.routeproj',
    mimeType: 'application/json',
    buffer: Buffer.from(saveProject(doc)),
  });
  const list = page.locator('.station-list');
  const row = list.getByRole('button', { name: /Station 23/ });
  await expect(row).not.toBeInViewport();
  await page.locator('[data-station="23"] .rv-station-pin').click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toBeInViewport({ ratio: 0.99 });
  const filter = page.getByRole('textbox', { name: 'Find a station' });
  await filter.fill('Station 0');
  await page.locator('[data-station="1"] .rv-station-pin').click();
  await expect(filter).toHaveValue('Station 0');
  await expect(list.getByRole('button')).toHaveCount(1);
});

test('selects and inspects independently in a narrow workbench', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto('/');
  const map = page.getByRole('application', { name: 'Route map' });
  const profile = page.getByRole('group', { name: 'Elevation profile' });
  await page.getByRole('button', { name: 'Route outline', exact: true }).click();
  await page.getByRole('button', { name: /Ridge Pass.*Checkpoint/ }).click();
  await expect(page.locator('.selection-summary')).toHaveText('Ridge Pass · 5.66 km');
  await expect(page.locator('.inspector')).toBeHidden();
  await expect(map).toBeVisible();
  await page.getByRole('button', { name: 'Edit selection' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Ridge Pass');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await profile.focus();
  await profile.press('ArrowRight');
  await profile.press('ArrowRight');
  await expect(page.locator('.selection-summary')).toContainText('Elevation sample 2');
  await expect(page.locator('.inspector')).toBeHidden();
});

test('resizes the profile with its divider and restores its size when expanded', async ({ page }) => {
  await page.goto('/');
  const divider = page.getByRole('separator', { name: 'Resize elevation profile' });
  const profile = page.getByRole('group', { name: 'Elevation profile' });
  const original = (await profile.boundingBox())!;
  await divider.focus();
  await divider.press('ArrowUp');
  await expect.poll(async () => (await profile.boundingBox())!.height).toBeGreaterThan(original.height);
  const expandedHeight = (await profile.boundingBox())!.height;
  await page.getByRole('button', { name: 'Collapse elevation profile' }).click();
  await expect(profile).toBeHidden();
  await page.getByRole('button', { name: 'Expand elevation profile' }).click();
  await expect.poll(async () => (await profile.boundingBox())!.height).toBe(expandedHeight);
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 73);
  await page.mouse.up();
  await expect.poll(async () => (await profile.boundingBox())!.height).toBeLessThan(expandedHeight);
});
