import { expect, test, type Page, type Route } from '@playwright/test';
import { strings } from '../../src/app/strings';
import { emptyRoute, type RouteDocument } from '../../src/domain/model';
import { loadProject, saveProject } from '../../src/files/project';
import copy from '../../src/i18n/en.repair.json' with { type: 'json' };
import { download, open } from './files';
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
  const open = page.getByRole('button', { name: t.fetchElevations, exact: true });
  const dialog = page.getByRole('dialog', { name: copy.title });
  const confirm = dialog.getByRole('button', { name: copy.replace, exact: true });
  const firstWorker = page.waitForEvent('worker', (worker) => worker.url().includes('io.worker'));
  await open.click();
  await expect.poll(() => Boolean(heldLookup)).toBe(true);
  await expect(dialog.getByRole('status')).toHaveText(copy.reading);
  await expect(confirm).toHaveCount(0);
  const stopped = (await firstWorker).waitForEvent('close');
  await dialog.getByRole('button', { name: t.cancel, exact: true }).click();
  await stopped;
  await expect(dialog).toBeHidden();
  expect(await savedRoute(page)).toEqual(original);
  await expect(page.getByRole('button', { name: t.undo, exact: true })).toBeDisabled();

  await open.click();
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
  const open = page.getByRole('button', { name: t.fetchElevations, exact: true });
  const dialog = page.getByRole('dialog', { name: copy.title });
  const confirm = dialog.getByRole('button', { name: copy.replace, exact: true });
  await open.click();
  await expect(confirm).toBeEnabled();
  await expect(dialog.locator('input[type=file]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await savedRoute(page)).toEqual(original);
  await expect(page.getByRole('button', { name: t.undo, exact: true })).toBeDisabled();
  await open.click();
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

test('safe short gaps are filled before the optional full-profile replacement; the two edits undo independently', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context);
  const original = polarRoute([10, null, 30, 50, null], 0);
  await openRoute(page, original);
  await page.getByRole('button', { name: t.interpolateGaps, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.title });
  const summary = t.interpolationResult.replace('{filled}', '1').replace('{remaining}', '1');
  await expect(dialog.getByText(summary, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: copy.replace, exact: true }).click();
  expect((await savedRoute(page)).elevation.map((s) => s.height)).toEqual([0, 50, -13.5, 123.5, 123.5]);
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
  await page.getByRole('button', { name: t.fetchElevations, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.title });
  await expect(dialog.getByRole('alert')).toContainText(copy.missing.replace('{missing}', '2'));
  await expect(dialog.getByRole('button', { name: copy.replace, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await savedRoute(page)).toEqual(original);
});
