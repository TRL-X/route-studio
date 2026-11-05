import { expect, test, type Page } from '@playwright/test';
import { anchorPoint, distanceMeters, type RouteDocument } from '../../src/domain/model';
import { loadProject, saveProject } from '../../src/files/project';
import en from '../../src/i18n/en.resample.json' with { type: 'json' };
import zh from '../../src/i18n/zh-CN.resample.json' with { type: 'json' };
import { download } from './files';

function fixture(): RouteDocument {
  return {
    name: 'Uneven trail',
    vertices: [
      { id: 'a', lat: 30, lon: 120 },
      { id: 'b', lat: 30, lon: 120.00002 },
      { id: 'c', lat: 30, lon: 120.001 },
      { id: 'd', lat: 30.001, lon: 120.001 },
      { id: 'e', lat: 30.001, lon: 120.002 },
    ],
    stations: [
      { id: 's', name: 'Start', kind: 'start', boundary: true, anchor: { vertexId: 'a', fraction: 0 } },
      {
        id: 'cp',
        name: 'Water',
        shortLabel: 'CP1',
        kind: 'cp',
        boundary: true,
        anchor: { vertexId: 'b', fraction: 0 },
        location: { lat: 30.0001, lon: 120 },
      },
      { id: 'p', name: 'Nearby', kind: 'poi', boundary: false, anchor: { vertexId: 'b', fraction: 0.01 } },
      { id: 'f', name: 'Finish', kind: 'finish', boundary: true, anchor: { vertexId: 'e', fraction: 0 } },
    ],
    elevation: [
      { anchor: { vertexId: 'a', fraction: 0 }, height: 0 },
      { anchor: { vertexId: 'b', fraction: 0.4 }, height: null },
      { anchor: { vertexId: 'c', fraction: 0.2 }, height: 120 },
      { anchor: { vertexId: 'e', fraction: 0 }, height: 70 },
    ],
    elevationReference: 1,
    declination: { mode: 'omit' },
  };
}
async function load(page: Page) {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'uneven.routeproj',
    mimeType: 'application/json',
    buffer: Buffer.from(saveProject(fixture())),
  });
  await page.getByRole('button', { name: /^(Later|稍后处理)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Uneven trail', exact: true })).toBeVisible();
}
async function openResample(page: Page, language: 'en' | 'zh' = 'en') {
  await page.getByRole('button', { name: language === 'en' ? 'Menu' : '菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: language === 'en' ? 'Route' : '路线', exact: true }).click();
  await page
    .getByRole('menuitem', {
      name: language === 'en' ? 'Resample route points…' : '重采样路线点…',
      exact: true,
    })
    .click();
  return page.getByRole('dialog', { name: language === 'en' ? en.title : zh.title });
}
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.addInitScript(() =>
    localStorage.setItem('route-studio-basemap', JSON.stringify({ enabled: false })),
  );
});

test('previews without mutation, preserves data on apply, and restores the entire route in one undo', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await load(page);
  const originalPath = await page.locator('.rv-route').getAttribute('d');
  const dialog = await openResample(page);
  await expect(dialog.getByRole('spinbutton', { name: en.minSpacing })).toHaveValue('2');
  await expect(dialog.getByRole('spinbutton', { name: en.maxSpacing })).toHaveValue('20');
  await expect(dialog.getByRole('spinbutton', { name: en.tolerance })).toHaveValue('0.5');
  await expect(dialog.getByRole('button', { name: en.apply })).toBeEnabled();
  await expect(dialog.locator('.rv-route-original')).toBeVisible();
  await expect(dialog.locator('.rv-comparison .rv-route')).toBeVisible();
  await expect(page.locator('.shell .rv-route')).toHaveAttribute('d', originalPath!);
  await dialog.getByRole('button', { name: en.locate }).click();
  await expect(dialog.locator('.rv-short-segment').first()).toBeAttached();
  await dialog.screenshot({ path: testInfo.outputPath('preview.png') });
  await dialog.getByRole('button', { name: en.apply }).click();
  await expect(dialog).toBeHidden();
  const next = loadProject((await download(page, 'Save project')).bytes.toString('utf8'));
  expect(next.vertices.length).toBeGreaterThan(fixture().vertices.length);
  expect(next.elevation.map((s) => s.height)).toEqual(fixture().elevation.map((s) => s.height));
  expect(next.elevationReference).toBe(1);
  for (const [i, station] of next.stations.entries()) {
    const before = fixture().stations[i];
    expect({ ...station, anchor: null }).toEqual({ ...before, anchor: null });
    expect(
      distanceMeters(anchorPoint(next, station.anchor!), anchorPoint(fixture(), before.anchor!)),
    ).toBeLessThan(1e-6);
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = loadProject((await download(page, 'Save project')).bytes.toString('utf8'));
  expect(undone).toEqual(fixture());
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(loadProject((await download(page, 'Save project')).bytes.toString('utf8'))).toEqual(next);
  expect(errors).toEqual([]);
});

test('validates parameters, recomputes from the original route, and cancels without an edit', async ({
  page,
}) => {
  await load(page);
  const dialog = await openResample(page);
  const apply = dialog.getByRole('button', { name: en.apply });
  await expect(apply).toBeEnabled();
  const initial = await dialog.locator('.resample-stats').innerText();
  const min = dialog.getByRole('spinbutton', { name: en.minSpacing });
  await min.fill('30');
  await expect(dialog.getByRole('alert')).toHaveText(en.options);
  await expect(apply).toBeDisabled();
  await expect(dialog.locator('.rv-comparison')).toHaveCount(0);
  await min.fill('10');
  await expect(apply).toBeEnabled();
  await min.fill('2');
  await expect(apply).toBeEnabled();
  await expect(dialog.locator('.resample-stats')).toHaveText(initial, { useInnerText: true });
  await min.fill('');
  await expect(apply).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(loadProject((await download(page, 'Save project')).bytes.toString('utf8'))).toEqual(fixture());
  await openResample(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('works in a narrow Chinese dark window and cancels an in-flight preview', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('route-studio-language', 'zh');
    localStorage.setItem('route-studio-theme', 'dark');
  });
  await load(page);
  const dialog = await openResample(page, 'zh');
  await expect(dialog.getByRole('button', { name: zh.apply })).toBeEnabled();
  const footer = await dialog.locator('.resample-actions').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(844);
  const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await dialog.screenshot({ path: testInfo.outputPath('mobile.png') });
  await dialog.getByRole('spinbutton', { name: zh.maxSpacing }).fill('25');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  await openResample(page, 'zh');
  await expect(dialog.getByRole('spinbutton', { name: zh.maxSpacing })).toHaveValue('20');
  await expect(dialog.getByRole('button', { name: zh.apply })).toBeEnabled();
});
