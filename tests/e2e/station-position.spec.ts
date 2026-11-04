import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { type RouteDocument } from '../../src/domain/model';
import { loadProject, saveProject } from '../../src/files/project';

const stationLocation = { lat: 0.00001, lon: 0.01 };
function overlappingRoute(): RouteDocument {
  return {
    name: 'Out and back',
    elevationReference: 0,
    elevation: [],
    vertices: [
      { id: 'a', lat: 0, lon: 0 },
      { id: 'b', lat: 0, lon: 0.01 },
      { id: 'c', lat: 0.01, lon: 0.01 },
      { id: 'd', lat: 0, lon: 0.01 },
      { id: 'e', lat: 0, lon: 0.02 },
    ],
    stations: [
      { id: 'start', kind: 'start', name: 'Start', anchor: { vertexId: 'a', fraction: 0 }, boundary: true },
      {
        id: 'cp',
        kind: 'cp',
        name: 'U14',
        anchor: { vertexId: 'b', fraction: 0 },
        location: stationLocation,
        boundary: true,
      },
      { id: 'turn', kind: 'cp', name: 'Turnaround', anchor: { vertexId: 'c', fraction: 0 }, boundary: true },
      { id: 'end', kind: 'finish', name: 'Finish', anchor: { vertexId: 'e', fraction: 0 }, boundary: true },
    ],
  };
}
async function exportStation(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const blob = await downloading;
  return loadProject(await readFile((await blob.path())!, 'utf8')).stations.find((s) => s.id === 'cp')!;
}

test('changes the route pass by distance while keeping the landmark and one-step history', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'overlap.routeproj',
    mimeType: 'application/json',
    buffer: Buffer.from(saveProject(overlappingRoute())),
  });
  await page.getByRole('button', { name: /U14.*Checkpoint/ }).click();
  const field = page.getByRole('spinbutton', { name: 'Route distance (km)', exact: true });
  const original = await field.inputValue();
  const passes = page.getByRole('group', { name: 'Nearby route passes' }).getByRole('button');
  await expect(passes).toHaveCount(2);
  await expect(passes.nth(0)).toContainText('Start → Turnaround');
  await expect(passes.nth(1)).toContainText('Turnaround → Finish');
  await passes.nth(1).click();
  await expect(passes.nth(1)).toHaveAttribute('aria-pressed', 'true');
  const later = await exportStation(page);
  expect(later.location).toEqual(stationLocation);
  expect(later.anchor?.vertexId).toBe('c');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(field).toHaveValue(original);
  await field.fill('99');
  await field.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toHaveText(/Enter a distance from 0 to/);
  expect((await exportStation(page)).anchor).toEqual({ vertexId: 'b', fraction: 0 });
  await field.fill('2.5');
  await field.press('Enter');
  await expect(field).toHaveValue('2.5000');
  const manual = await exportStation(page);
  expect(manual.location).toEqual(stationLocation);
  expect(manual.anchor?.vertexId).toBe('c');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(field).toHaveValue(original);
  await page.getByRole('button', { name: 'Pick route position on map' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Click the route to place this station.' }),
  ).toBeVisible();
});

test('steps numeric properties with precision, bounds and one-step undo', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'stepper.routeproj',
    mimeType: 'application/json',
    buffer: Buffer.from(saveProject(overlappingRoute())),
  });
  await page.getByRole('button', { name: /U14.*Checkpoint/ }).click();
  const distance = page.getByRole('spinbutton', { name: 'Route distance (km)', exact: true });
  const original = await distance.inputValue();
  await distance.press('ArrowUp');
  await expect(distance).toHaveValue((Number(original) + 0.01).toFixed(4));
  await expect(distance).toBeFocused();
  await distance.press('ArrowDown');
  await expect(distance).toHaveValue(original);
  // A typed draft plus one step must commit as one edit, not two separate undo entries.
  await distance.fill('2.1234');
  await page.getByRole('button', { name: 'Route distance (km) +0.01', exact: true }).click();
  await expect(distance).toHaveValue('2.1334');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(distance).toHaveValue(original);
  await distance.fill('0.001');
  await distance.press('ArrowDown');
  await expect(distance).toHaveValue('0.0000');
  await expect(page.getByRole('button', { name: 'Route distance (km) −0.01', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(distance).toHaveValue(original);

  const latitude = page.getByRole('spinbutton', { name: 'Latitude', exact: true });
  await latitude.fill('0.000012345');
  await page.getByRole('button', { name: 'Latitude +0.00001', exact: true }).click();
  await expect(latitude).toHaveValue('0.000022345');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(latitude).toHaveValue('0.00001');
  await latitude.fill('89.999999');
  await latitude.press('ArrowUp');
  await expect(latitude).toHaveValue('90');
  await expect(page.getByRole('button', { name: 'Latitude +0.00001', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(latitude).toHaveValue('0.00001');
  await latitude.fill('45.123456789');
  await latitude.press('Escape');
  await expect(latitude).toHaveValue('0.00001');
  expect((await exportStation(page)).location).toEqual(stationLocation);
});
