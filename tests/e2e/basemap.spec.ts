import { selectOption } from '../controls';
import { expect, test } from '@playwright/test';
import { download, openRidge } from './files';

const styleURL = 'https://tiles.openfreemap.org/styles/liberty';
const tileURLs = /https:\/\/t[0-7]\.tianditu\.gov\.cn\//;
// A transparent PNG keeps these tests independent of credentials and external map services.
const tile = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAABPO1TCQAAAABJRU5ErkJggg==',
  'base64',
);
const key = 'user-test-key&extra=not-a-query';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.route(styleURL, (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf2ed' } }],
      },
    }),
  );
  await page.route(tileURLs, (route) => route.fulfill({ contentType: 'image/png', body: tile }));
});

test('applies a personal Key, preserves the view, restores settings and excludes them from projects', async ({
  page,
}) => {
  const requests: URL[] = [];
  page.on('request', (request) => {
    if (tileURLs.test(request.url())) requests.push(new URL(request.url()));
  });
  await page.goto('/');
  await openRidge(page);
  const trigger = page.getByRole('button', { name: 'Basemap: OpenFreeMap', exact: true });
  await expect(trigger).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const routeBefore = await page.locator('.rv-route').getAttribute('d');
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await selectOption(panel.getByLabel('Map provider'), 'tianditu');
  const input = panel.getByLabel('API Key', { exact: true });
  await expect(input).toBeEmpty();
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(`  ${key}  `);
  await panel.getByRole('button', { name: 'Show Key', exact: true }).click();
  await expect(input).toHaveAttribute('type', 'text');
  expect(requests).toHaveLength(0);
  const scheme = await page.locator('html').getAttribute('data-theme');
  await panel.getByRole('tab', { name: 'General', exact: true }).click();
  await selectOption(panel.getByLabel('Interface language'), 'zh');
  await selectOption(panel.getByLabel('Appearance', { exact: true }), 'dark');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', scheme!);
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(panel.getByLabel('Map provider')).toHaveAttribute('data-value', 'openfreemap');
  await selectOption(panel.getByLabel('Map provider'), 'tianditu');
  await expect(input).toBeEmpty();
  await input.fill(`  ${key}  `);
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Basemap: Tianditu', exact: true })).toBeVisible();
  await expect
    .poll(() => [...new Set(requests.map((url) => url.searchParams.get('LAYER')))].sort())
    .toEqual(['cva', 'vec']);
  for (const url of requests) {
    expect(url.searchParams.get('tk')).toBe(key);
    expect(url.searchParams.get('extra')).toBeNull();
    expect(url.searchParams.get('TILEMATRIXSET')).toBe('w');
    expect(url.searchParams.get('TILECOL')).toMatch(/^\d+$/);
    expect(url.searchParams.get('TILEROW')).toMatch(/^\d+$/);
  }
  await expect(page.locator('.rv-route')).toHaveAttribute('d', routeBefore!);
  await expect(page.getByText('Basemap unavailable', { exact: true })).not.toBeVisible();
  const project = (await download(page, 'Save project')).bytes.toString('utf8');
  expect(project).not.toContain(key);
  expect(project).not.toContain('tianditu');
  await page.reload();
  await page.getByRole('button', { name: 'Basemap: Tianditu', exact: true }).click();
  await expect(input).toHaveValue(key);
  await expect(input).toHaveAttribute('type', 'password');
  await expect(panel.getByLabel('Show basemap')).toBeChecked();
  await panel.getByRole('button', { name: 'Clear Key', exact: true }).click();
  await panel.getByLabel('Show basemap').uncheck();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.rv-graticule')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Basemap: Tianditu · Off', exact: true }).click();
  await expect(input).toBeEmpty();
  await expect(panel.getByLabel('Show basemap')).not.toBeChecked();
});

test('keeps the selected provider after tile errors and retries only on request', async ({ page }) => {
  let status = 200;
  let freeMapRequests = 0;
  page.on('request', (request) => {
    if (request.url() === styleURL) freeMapRequests++;
  });
  await page.route(tileURLs, (route) =>
    status === 200
      ? route.fulfill({ contentType: 'image/png', body: tile })
      : route.fulfill({ status, body: 'Denied' }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Basemap: OpenFreeMap', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await selectOption(panel.getByLabel('Map provider'), 'tianditu');
  await panel.getByLabel('API Key', { exact: true }).fill('test-personal-key');
  const loadedTile = page.waitForResponse(tileURLs);
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await loadedTile;
  await expect(page.locator('.rv-base canvas')).toBeVisible();
  status = 403;
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByText('Basemap unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.rv-graticule')).toBeVisible();
  const requestsAfterFailure = freeMapRequests;
  await page.getByRole('button', { name: 'Basemap: Tianditu', exact: true }).click();
  await expect(page.getByText('Basemap unavailable', { exact: true })).toHaveAttribute(
    'aria-description',
    /Map access was denied/,
  );
  await expect(panel.getByLabel('Show basemap')).toBeChecked();
  await panel.press('Escape');
  await expect(page.getByRole('button', { name: 'Basemap: Tianditu', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByText('Basemap unavailable', { exact: true })).toBeVisible();
  expect(freeMapRequests).toBe(requestsAfterFailure);
  status = 200;
  const retried = page.waitForResponse(tileURLs);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await retried;
  await expect(page.locator('.rv-base canvas')).toBeVisible();
  await expect(page.getByText('Basemap unavailable', { exact: true })).not.toBeVisible();
  expect(freeMapRequests).toBe(requestsAfterFailure);
});

test('requires a Key, cancels on Escape, and fits narrow layouts in Chinese', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Basemap: OpenFreeMap', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await selectOption(panel.getByLabel('Map provider'), 'tianditu');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Enter your Tianditu Key');
  await expect(panel.getByLabel('API Key', { exact: true })).toBeFocused();
  await panel.press('Escape');
  await page.getByRole('button', { name: 'Basemap: OpenFreeMap', exact: true }).click();
  await expect(panel.getByLabel('Map provider')).toHaveAttribute('data-value', 'openfreemap');
  await panel.getByRole('tab', { name: 'General', exact: true }).click();
  await selectOption(panel.getByLabel('Interface language'), 'zh');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel).not.toBeVisible();
  for (const width of [1440, 800, 480]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '底图: OpenFreeMap', exact: true }).click();
    const chinese = page.getByRole('dialog', { name: '设置', exact: true });
    await selectOption(chinese.getByLabel('地图提供商'), 'tianditu');
    await expect(chinese.getByRole('button', { name: '应用', exact: true })).toBeInViewport();
    const bounds = await chinese.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    if (width === 1440 || width === 480)
      await page.screenshot({ path: testInfo.outputPath(`basemap-${width}.png`) });
    await chinese.getByRole('button', { name: '取消', exact: true }).click();
  }
});

test('keeps session settings usable when local storage cannot be written', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'route-studio-basemap') throw new DOMException('Unavailable');
      original.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Basemap: OpenFreeMap', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  await panel.getByLabel('Show basemap').uncheck();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText(/Settings apply for this session/)).toBeVisible();
  await expect(page.locator('.rv-graticule')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Basemap: OpenFreeMap', exact: true })).toBeVisible();
});
