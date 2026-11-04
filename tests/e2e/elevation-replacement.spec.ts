import { expect, test, type Page, type Route } from '@playwright/test';
import { strings } from '../../src/app/strings';
import { emptyRoute, type RouteDocument } from '../../src/domain/model';
import { loadProject, saveProject } from '../../src/files/project';
import copy from '../../src/i18n/en.repair.json' with { type: 'json' };
import { download, open } from './files';
import { openElevationTools, openOnlineTerrain } from './elevation';
import { mockOnlineTerrain } from './fixtures/online-terrain';

const t = strings.en;
function polarRoute(heights: (number | null)[], reference: 0 | 1 | 2, start = 120): RouteDocument {
  const vertices = heights.map((_, i) => ({ id: String(i), lat: 86, lon: start + i / 360 }));
  return {
    ...emptyRoute(),
    name: 'Polar test route',
    vertices,
    elevationReference: reference,
    elevation: heights.map((height, i) => ({ anchor: { vertexId: vertices[i].id, fraction: 0 }, height })),
    stations: [
      { id: 'water', name: 'Water', kind: 'cp', boundary: false, anchor: { vertexId: '0', fraction: 0.5 } },
    ],
  };
}
async function openRoute(page: Page, doc: RouteDocument) {
  await page.goto('/');
  await open(page, 'polar.routeproj', Buffer.from(saveProject(doc)));
  await expect(page.getByRole('heading', { name: doc.name })).toBeVisible();
}
async function savedRoute(page: Page) {
  return loadProject((await download(page, t.save)).bytes.toString('utf8'));
}

test('closing during a lookup cancels it and a late response cannot overwrite the reopened preview', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context);
  let heldLookup: Route | undefined;
  await context.route(
    '**/collections/cop-dem-glo-30/items/*',
    (route) => {
      heldLookup = route;
    },
    { times: 1 },
  );
  const original = polarRoute([101, 102, 103], 1);
  await openRoute(page, original);
  const dialog = page.getByRole('dialog', { name: copy.title });
  const confirm = dialog.getByRole('button', { name: copy.replace, exact: true });
  const firstWorker = page.waitForEvent('worker', (worker) => worker.url().includes('io.worker'));
  await openOnlineTerrain(page);
  await expect.poll(() => Boolean(heldLookup)).toBe(true);
  await expect(dialog.getByRole('status')).toHaveText(copy.reading);
  await expect(confirm).toHaveCount(0);
  const stopped = (await firstWorker).waitForEvent('close');
  await dialog.getByRole('button', { name: t.cancel, exact: true }).click();
  await stopped;
  await expect(dialog).toBeHidden();
  expect(await savedRoute(page)).toEqual(original);
  await expect(page.getByRole('button', { name: t.undo, exact: true })).toBeDisabled();

  await openOnlineTerrain(page);
  await expect(confirm).toBeEnabled();
  await heldLookup!.fulfill({ status: 503 });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await confirm.click();
  expect((await savedRoute(page)).elevation.map((s) => s.height)).toEqual([0, 50, -13.5]);
});

test('previews a complete datum change, replaces every height only on confirmation, and undoes in one step', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context);
  const original = polarRoute([110, 150, 230], 2);
  await openRoute(page, original);
  const dialog = page.getByRole('dialog', { name: copy.title });
  const confirm = dialog.getByRole('button', { name: copy.replace, exact: true });
  await openOnlineTerrain(page);
  await expect(confirm).toBeEnabled();
  await expect(dialog.locator('input[type=file]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await savedRoute(page)).toEqual(original);
  await expect(page.getByRole('button', { name: t.undo, exact: true })).toBeDisabled();
  await openOnlineTerrain(page);
  await confirm.click();
  await expect(dialog).toBeHidden();
  const next = await savedRoute(page);
  expect(next).toMatchObject({
    vertices: original.vertices,
    stations: original.stations,
    elevationReference: 1,
  });
  expect(next.elevation.map((s) => s.height)).toEqual([0, 50, -13.5]);
  await page.getByRole('button', { name: t.undo, exact: true }).click();
  expect(await savedRoute(page)).toEqual(original);
});

test('short endpoint gaps fill locally in one undoable edit without starting terrain lookup', async ({
  page,
  context,
}) => {
  let lookups = 0;
  await context.route('**/collections/cop-dem-glo-30/items/*', (route) => {
    lookups++;
    return route.abort();
  });
  const original = polarRoute([null, -5, 30, null], 2);
  original.elevation.pop(); // The finish sample is absent rather than explicitly marked missing.
  await openRoute(page, original);
  const tools = await openElevationTools(page);
  const fill = tools.getByRole('button', { name: t.interpolateGaps, exact: true });
  await fill.click();
  await expect(fill).toBeDisabled();
  await expect(page.getByRole('dialog', { name: copy.title })).toHaveCount(0);
  await tools.getByRole('button', { name: 'Close', exact: true }).click();
  const next = await savedRoute(page);
  expect(next.elevation.map((s) => s.height)).toEqual([-5, -5, 30, 30]);
  expect(next.elevationReference).toBe(2);
  await page.getByRole('button', { name: t.undo, exact: true }).click();
  expect(await savedRoute(page)).toEqual(original);
  expect(lookups).toBe(0);
});

test('safe short gaps are filled before the optional full-profile replacement; the two edits undo independently', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context);
  const original = polarRoute([10, null, 30, 50, null], 0);
  original.vertices[4].lon += 0.15; // Put the final point more than 1 km from its nearest elevation.
  await openRoute(page, original);
  const tools = await openElevationTools(page);
  await tools.getByRole('button', { name: t.interpolateGaps, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.title });
  await expect(dialog).toBeHidden();
  const summary = t.interpolationResult.replace('{filled}', '1').replace('{remaining}', '1');
  await expect(tools.getByText(summary, { exact: true })).toBeVisible();
  await tools.getByRole('button', { name: t.fetchElevations, exact: true }).click();
  await dialog.getByRole('button', { name: copy.replace, exact: true }).click();
  const replaced = await savedRoute(page);
  expect(replaced.elevation.slice(0, 5).map((s) => s.height)).toEqual([0, 50, -13.5, 123.5, 123.5]);
  expect(replaced.elevation.every((s) => s.height !== null)).toBe(true);
  const undo = page.getByRole('button', { name: t.undo, exact: true });
  await undo.click();
  expect((await savedRoute(page)).elevation.map((s) => s.height)).toEqual([
    10,
    expect.closeTo(20),
    30,
    50,
    null,
  ]);
  await undo.click();
  expect(await savedRoute(page)).toEqual(original);
});

test('a tile covering only part of the route cannot confirm a mixed or incomplete profile', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context);
  // The fixture covers the western two posts. The catalog returns 404 for the adjacent tile.
  const original = polarRoute([500, 600, 700, 800], 1, 121 - 2 / 360);
  await openRoute(page, original);
  await openOnlineTerrain(page);
  const dialog = page.getByRole('dialog', { name: copy.title });
  await expect(dialog.getByRole('alert')).toContainText(copy.missing.replace('{missing}', '2'));
  await expect(dialog.getByRole('button', { name: copy.replace, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await savedRoute(page)).toEqual(original);
});
