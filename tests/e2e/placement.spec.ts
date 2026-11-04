import { expect, test, type Locator } from '@playwright/test';
import type { RouteDocument } from '../../src/domain/model';
import { saveProject } from '../../src/files/project';

async function routePoint(map: Locator, fraction: number) {
  return map.locator('.rv-route').evaluate((element, fraction) => {
    const path = element as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength() * fraction);
    return { x: p.x, y: p.y };
  }, fraction);
}

test('station placement previews, ignores empty space and commits one undoable edit', async ({ page }) => {
  await page.goto('/');
  const map = page.getByRole('application', { name: 'Route map' });
  const markers = map.locator('[data-station]');
  const add = page.getByRole('button', { name: 'Add station', exact: true });
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const hit = await routePoint(map, 0.37);
  const bounds = (await map.boundingBox())!;
  const far = { x: bounds.width / 2, y: 18 };
  await add.click();
  const mode = (await page.locator('.rv-mode').boundingBox())!;
  expect(mode.y).toBeGreaterThan(bounds.y + bounds.height / 2);
  expect(mode.y + mode.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  expect(Math.abs(mode.x + mode.width / 2 - (bounds.x + bounds.width / 2))).toBeLessThan(2);
  await map.click({ position: far });
  await expect(map.locator('.rv-snap-preview')).toHaveCount(0);
  await expect(markers).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(undo).toBeDisabled();
  await expect(markers).toHaveCount(4);

  await add.click();
  await page.mouse.move(bounds.x + hit.x, bounds.y + hit.y);
  await expect(map.locator('.rv-snap-preview')).toContainText('km');
  await expect(markers).toHaveCount(4);
  await map.click({ position: hit });
  await expect(markers).toHaveCount(5);
  await undo.click();
  await expect(markers).toHaveCount(4);
  await expect(undo).toBeDisabled();
  await page.getByRole('radio', { name: 'Insert point', exact: true }).click();
  await map.click({ position: far });
  await expect(undo).toBeDisabled();
});

test('a shared track asks which pass to use before creating the checkpoint', async ({ page }) => {
  const doc: RouteDocument = {
    name: 'Out and back',
    elevationReference: 0,
    elevation: [],
    vertices: [
      { id: 'a', lat: 0, lon: 0 },
      { id: 'b', lat: 0, lon: 0.02 },
      { id: 'c', lat: 0, lon: 0 },
    ],
    stations: [
      { id: 's', kind: 'start', name: 'Start', boundary: true, anchor: { vertexId: 'a', fraction: 0 } },
      { id: 't', kind: 'cp', name: 'Turn', boundary: true, anchor: { vertexId: 'b', fraction: 0 } },
      { id: 'f', kind: 'finish', name: 'Finish', boundary: true, anchor: { vertexId: 'c', fraction: 0 } },
    ],
  };
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'shared.routeproj',
    mimeType: 'application/json',
    buffer: Buffer.from(saveProject(doc)),
  });
  await expect(page.getByRole('heading', { name: doc.name, exact: true })).toBeVisible();
  const map = page.getByRole('application', { name: 'Route map' });
  const markers = map.locator('[data-station]');
  const add = page.getByRole('button', { name: 'Add station', exact: true });
  const hit = await routePoint(map, 0.25);
  const options = page.getByRole('group', { name: 'Choose the route pass to use' }).getByRole('button');
  await add.click();
  await map.click({ position: hit });
  await expect(options).toHaveCount(2);
  const bounds = (await map.boundingBox())!;
  const panel = (await page.locator('.rv-pass-panel').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(bounds.x);
  expect(panel.x + panel.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  expect(panel.y).toBeGreaterThanOrEqual(bounds.y);
  expect(panel.y).toBeLessThan(bounds.y + bounds.height / 2);
  expect(panel.y + panel.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  await expect(options.nth(0)).toContainText('Start → Turn');
  await expect(options.nth(1)).toContainText('Turn → Finish');
  await expect(markers).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await add.click();
  await map.click({ position: hit });
  await options.nth(1).click();
  await expect(markers).toHaveCount(4);
  const field = page.getByRole('spinbutton', { name: 'Route distance (km)' });
  expect(Number(await field.inputValue())).toBeCloseTo(3.34, 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(markers).toHaveCount(3);
});

test('probing the route or profile keeps the selected checkpoint locked', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Ridge Pass.*Checkpoint/ }).click();
  const map = page.getByRole('application', { name: 'Route map' });
  const profile = page.getByRole('group', { name: 'Elevation profile' });
  await expect(page.locator('.rv-readout')).toContainText('5.66 km');
  const cursor = profile.locator('.rv-profile-cursor line');
  const locked = await cursor.getAttribute('x1');
  await map.hover({ position: await routePoint(map, 0.24) });
  await expect(map.locator('.rv-anchor-hover')).toHaveCount(1);
  await expect(profile.locator('.rv-profile-probe')).toHaveCount(1);
  await expect(profile.locator('.rv-profile-cursor')).toHaveCount(1);
  await map.locator('[data-kind=poi] .rv-station-pin').hover();
  await expect(page.locator('.rv-readout')).toContainText('8.82 km');
  await expect(cursor).toHaveAttribute('x1', locked!);
  const bounds = (await map.boundingBox())!;
  await map.hover({ position: { x: bounds.width / 2, y: 18 } });
  await expect(profile.locator('.rv-profile-probe')).toHaveCount(0);
  await profile.hover({ position: { x: 140, y: 40 } });
  await expect(map.locator('.rv-anchor-hover')).toHaveCount(1);
  await expect(profile.locator('.rv-profile-probe')).toHaveCount(1);
  await expect(map.locator('.rv-station-active')).toHaveCount(1);
  await expect(profile.locator('.rv-profile-cursor')).toHaveCount(1);
  await expect(cursor).toHaveAttribute('x1', locked!);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Ridge Pass');
});

test('selecting an offscreen checkpoint again reveals it at the current zoom', async ({ page }) => {
  await page.goto('/');
  const station = page.getByRole('button', { name: /Ridge Pass.*Checkpoint/ });
  const map = page.getByRole('application', { name: 'Route map' });
  await station.click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const pathLength = () => map.locator('.rv-route').evaluate((p) => (p as SVGPathElement).getTotalLength());
  const zoomedLength = await pathLength();
  const marker = map.locator('.rv-selection-ring');
  await map.focus();
  for (let i = 0; i < 16; i++) await map.press('ArrowRight');
  await expect.poll(async () => Number(await marker.getAttribute('cx'))).toBeLessThan(0);
  await station.click();
  await expect.poll(async () => Number(await marker.getAttribute('cx'))).toBeGreaterThan(0);
  expect(await pathLength()).toBeCloseTo(zoomedLength, -1);
});
