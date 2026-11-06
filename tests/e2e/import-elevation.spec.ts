import { expect, test, type Page } from '@playwright/test';
import { strings } from '../../src/i18n/index';
import { emptyRoute, type RouteDocument } from '../../src/domain/model';
import { loadProject, saveProject } from '../../src/files/project';
import copy from '../../src/i18n/en.workflow.json' with { type: 'json' };
import zh from '../../src/i18n/zh-CN.workflow.json' with { type: 'json' };
import repair from '../../src/i18n/en.repair.json' with { type: 'json' };
import { setPreference } from '../preferences';
import { download, open } from './files';
import { mockOnlineTerrain } from './fixtures/online-terrain';

const t = strings.en;
const gpx = `<gpx><trk><name>Imported trail</name><trkseg>
  <trkpt lat="0" lon="0"><ele>-10</ele></trkpt>
  <trkpt lat="0" lon="0.0005"/>
  <trkpt lat="0" lon="0.001"><ele>10</ele></trkpt>
</trkseg></trk></gpx>`;

function project(heights: (number | null)[]): RouteDocument {
  return {
    ...emptyRoute(),
    name: 'Imported trail',
    vertices: heights.map((_, i) => ({ id: String(i), lat: 86, lon: 120 + i / 360 })),
    elevationReference: 2,
    elevation: heights.map((height, i) => ({ anchor: { vertexId: String(i), fraction: 0 }, height })),
  };
}

async function savedRoute(page: Page) {
  return loadProject((await download(page, t.save)).bytes.toString('utf8'));
}

test('imported short gaps are diagnosed locally and filled in one undoable edit', async ({
  page,
  context,
}) => {
  let requests = 0;
  await context.route('**/collections/cop-dem-glo-30/items/*', (route) => {
    requests++;
    return route.abort();
  });
  await page.goto('/');
  await open(page, 'short.gpx', Buffer.from(gpx));
  const guidance = page.getByRole('dialog', { name: copy.importElevationTitle });
  await expect(guidance.getByText(copy.importFillable.replace('{gaps}', '1'))).toBeVisible();
  const fill = guidance.getByRole('button', { name: copy.importFillAction, exact: true });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        text: document.activeElement?.textContent,
      })),
    )
    .toEqual({ tag: 'BUTTON', text: copy.importFillAction });
  await fill.click();
  await expect(guidance).toBeHidden();
  const next = await savedRoute(page);
  expect(next.elevation.map((s) => s.height)).toEqual([-10, expect.closeTo(0), 10]);
  await page.getByRole('button', { name: t.undo, exact: true }).click();
  expect((await savedRoute(page)).elevation.map((s) => s.height)).toEqual([-10, null, 10]);
  await expect(guidance).toBeHidden();
  expect(requests).toBe(0);
});

test('omitted endpoints are detected and Later preserves the project across draft recovery', async ({
  page,
}) => {
  const original = project([null, -5, 30, null]);
  original.elevation.shift();
  original.elevation.pop();
  await page.goto('/');
  await open(page, 'endpoints.routeproj', Buffer.from(saveProject(original)));
  const guidance = page.getByRole('dialog', { name: copy.importElevationTitle });
  await expect(guidance.getByText(copy.importFillable.replace('{gaps}', '2'))).toBeVisible();
  await guidance.getByRole('button', { name: copy.importLater, exact: true }).click();
  expect(await savedRoute(page)).toEqual(original);
  await expect(page.getByRole('button', { name: t.undo, exact: true })).toBeDisabled();
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: original.name, exact: true })).toBeVisible();
  await expect(guidance).toBeHidden();
  expect(await savedRoute(page)).toEqual(original);
});

test('mixed gaps recommend replacement and can still fill just the short gap before review', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context);
  const original = project([10, null, 30, 50, null]);
  original.vertices[4].lon += 0.15;
  await page.goto('/');
  await open(page, 'mixed.routeproj', Buffer.from(saveProject(original)));
  const guidance = page.getByRole('dialog', { name: copy.importElevationTitle });
  await expect(
    guidance.getByText(copy.importNeedsReplacement.replace('{gaps}', '2').replace('{remaining}', '1')),
  ).toBeVisible();
  await guidance.getByRole('button', { name: copy.importPartialFill.replace('{filled}', '1') }).click();
  const tools = page.getByRole('dialog', { name: copy.elevationTools, exact: true });
  await expect(tools.getByRole('status')).toHaveText(
    t.interpolationResult.replace('{filled}', '1').replace('{remaining}', '1'),
  );
  await tools.getByRole('button', { name: t.fetchElevations, exact: true }).click();
  const online = page.getByRole('dialog', { name: repair.title });
  await online.getByRole('button', { name: repair.replace, exact: true }).click();
  expect((await savedRoute(page)).elevation.every((s) => s.height !== null)).toBe(true);
  await page.getByRole('button', { name: t.undo, exact: true }).click();
  expect((await savedRoute(page)).elevation.map((s) => s.height)).toEqual([
    10,
    expect.closeTo(20),
    30,
    50,
    null,
  ]);
  await page.getByRole('button', { name: t.undo, exact: true }).click();
  expect(await savedRoute(page)).toEqual(original);
});

test('online preview returns to the import guidance and cancelling preserves the original', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context);
  const original = project([10, null, 30]);
  original.vertices[2].lon += 0.15;
  await page.goto('/');
  await open(page, 'long.routeproj', Buffer.from(saveProject(original)));
  const guidance = page.getByRole('dialog', { name: copy.importElevationTitle });
  await expect(guidance.getByRole('button', { name: copy.importFillAction })).toHaveCount(0);
  await guidance.getByRole('button', { name: copy.importOnlineAction }).click();
  const online = page.getByRole('dialog', { name: repair.title });
  await expect(online.getByRole('button', { name: repair.replace, exact: true })).toBeEnabled();
  await online.getByRole('button', { name: copy.back, exact: true }).click();
  await expect(guidance).toBeVisible();
  await guidance.getByRole('button', { name: copy.importOnlineAction }).click();
  await online.getByRole('button', { name: t.cancel, exact: true }).click();
  expect(await savedRoute(page)).toEqual(original);
  await expect(page.getByRole('button', { name: t.undo, exact: true })).toBeDisabled();
  await open(page, 'complete.routeproj', Buffer.from(saveProject(project([0, 10, 20]))));
  await expect(page.getByText('complete.routeproj', { exact: true })).toBeVisible();
  await expect(guidance).toBeHidden();
});

test('KML guidance uses the selected altitude choice', async ({ page }) => {
  await page.goto('/');
  const kml =
    '<kml><Placemark><name>Imported trail</name><LineString><coordinates>0,0,10 0.001,0,20</coordinates></LineString></Placemark></kml>';
  await open(page, 'unconfirmed.kml', Buffer.from(kml));
  const choices = page.getByRole('dialog', { name: t.selectTrack });
  await choices.getByRole('checkbox', { name: t.acceptHeights }).uncheck();
  await choices.getByRole('button', { name: 'Open', exact: true }).click();
  const guidance = page.getByRole('dialog', { name: copy.importElevationTitle });
  await expect(guidance.getByText(copy.importNoHeights, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect((await savedRoute(page)).elevation.map((s) => s.height)).toEqual([null, null]);
});

test('guidance waits until replacing unsaved edits is confirmed', async ({ page }) => {
  await page.goto('/');
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Unsaved route');
  await name.press('Enter');
  await open(page, 'short.gpx', Buffer.from(gpx));
  const pending = page.getByRole('dialog', { name: t.discardTitle });
  const guidance = page.getByRole('dialog', { name: copy.importElevationTitle });
  await expect(pending).toBeVisible();
  await expect(guidance).toBeHidden();
  await pending.getByRole('button', { name: t.cancel, exact: true }).click();
  await expect(name).toHaveValue('Unsaved route');
  await open(page, 'short.gpx', Buffer.from(gpx));
  await pending.getByRole('button', { name: t.confirm, exact: true }).click();
  await guidance.getByRole('button', { name: copy.importFillAction }).click();
  await expect(name).toHaveValue('Imported trail');
  expect((await savedRoute(page)).elevation[1].height).toBeCloseTo(0);
});

test('Chinese import guidance and its actions fit a narrow screen', async ({ page }) => {
  await page.goto('/');
  await setPreference(page, 'Interface language', 'zh');
  await page.setViewportSize({ width: 360, height: 600 });
  await page.locator('input[type=file]').setInputFiles({
    name: 'short.gpx',
    buffer: Buffer.from(gpx),
    mimeType: 'application/gpx+xml',
  });
  const guidance = page.getByRole('dialog', { name: zh.importElevationTitle });
  await expect(guidance.getByText(zh.importFillable.replace('{gaps}', '1'))).toBeVisible();
  for (const label of [zh.importLater, strings.zh.fetchElevations, zh.importFillAction]) {
    await expect(guidance.getByRole('button', { name: label, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expect(guidance).toBeInViewport({ ratio: 1 });
  await guidance.screenshot({ path: test.info().outputPath('import-elevation-zh.png') });
  await guidance.getByRole('button', { name: zh.importFillAction, exact: true }).click();
  await expect(guidance).toBeHidden();
});
