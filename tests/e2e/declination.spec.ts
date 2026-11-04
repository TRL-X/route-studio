import { selectOption } from '../controls';
import { readFile } from 'node:fs/promises';
import { expect, test, type Route } from '@playwright/test';
import { readRte } from '../../src/rte';
import { parseRoutes } from '../../src/files/import';
import { automaticDeclination } from '../../src/domain/model';
import { loadProject, saveProject } from '../../src/files/project';
import { bgsRequests, answerBgs } from './bgs';
import { open, download, openMagnetics, openExport, disableExportProcessing } from './files';

const gpx = Buffer.from(
  '<gpx><rte><name>Midpoint</name><rtept lat="5" lon="179"><ele>1</ele></rtept><rtept lat="5" lon="-179"><ele>2</ele></rtept></rte></gpx>',
);

// Give the fixture a fixed survey date, independent of the import worker's clock.
function crossingProject() {
  const doc = parseRoutes(gpx.toString(), 'crossing.gpx')[0].open();
  return Buffer.from(saveProject({ ...doc, declination: automaticDeclination('2026-11-03') }));
}

test('RTE imports preserve all three reference vectors until the user edits the value', async ({ page }) => {
  let calls = 0;
  await page.route(bgsRequests, (route) => {
    calls++;
    return route.abort();
  });
  await page.goto('/');
  for (const id of ['c', 'b', 'a']) {
    const bytes = await readFile('tests/rte/vectors/' + id + '.rte');
    await open(page, id + '.rte', bytes);
    await expect(page.getByText(id + '.rte', { exact: true })).toBeVisible();
    await openMagnetics(page);
    await expect(page.getByLabel('Declination mode')).toHaveAttribute(
      'data-value',
      id === 'c' ? 'omit' : 'manual',
    );
    await disableExportProcessing(page);
    expect((await download(page, 'Download RTE')).bytes).toEqual(bytes);
  }
  await openMagnetics(page);
  const angle = page.getByLabel('Magnetic declination (°)', { exact: true });
  await angle.fill('0');
  await angle.press('Enter');
  const output = await download(page, 'Download RTE');
  expect(readRte(output.bytes).rte?.magneticDeclination?.declinationCdeg).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openMagnetics(page);
  await expect(angle).toHaveValue('-3.5');
  await selectOption(page.getByLabel('Declination mode'), 'omit');
  expect(readRte((await download(page, 'Download RTE')).bytes).rte?.magneticDeclination).toBeUndefined();
  expect(calls).toBe(0);
});

test('automatic lookup refreshes on date changes, retries a failure, and reopens offline', async ({
  page,
}) => {
  const dates: string[] = [];
  await page.route(bgsRequests, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    dates.push(params.get('date')!);
    expect(params.get('longitude')).toBe('-180');
    if (dates.length === 2) return route.abort('internetdisconnected');
    await answerBgs(route, dates.length === 1 ? -3.456 : 0);
  });
  await page.goto('/');
  await open(page, 'crossing.routeproj', crossingProject());
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Midpoint');
  expect(dates).toHaveLength(0);
  const name = page.getByLabel('Name', { exact: true });
  await name.fill('Renamed');
  await name.press('Enter');
  await openMagnetics(page);
  await expect(page.getByLabel('Declination mode')).toHaveAttribute('data-value', 'auto');
  await expect(page.getByText('-3.46° · BGS WMM2025')).toBeVisible();
  const referenceDate = page.getByLabel('Reference date (UTC)');
  await referenceDate.fill('2027-03-01');
  await referenceDate.press('Enter');
  await expect(page.getByText(/BGS is unavailable/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download RTE' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText(
    'No magnetic declination result for this location and date',
  );
  await expect(page.getByRole('button', { name: 'Show in inspector' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Repeat lookup' }).click();
  await expect(page.getByText('0.00° · BGS WMM2025')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  const saved = loadProject((await download(page, 'Save project')).bytes.toString('utf8'));
  expect(saved.declination).toMatchObject({
    mode: 'auto',
    source: 'BGS WMM2025',
    date: '2027-03-01',
    result: { declinationCdeg: 0 },
  });
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await openMagnetics(page);
  await expect(page.getByText('0.00° · BGS WMM2025')).toBeVisible();
  const actual = readRte((await download(page, 'Download RTE')).bytes).rte?.magneticDeclination;
  expect(actual).toEqual({
    declinationCdeg: 0,
    referenceLatE7: 50000000,
    referenceLonE7: -1800000000,
    referenceDate: '2027-03-01',
  });
  expect(dates).toEqual(['2026-11-03', '2027-03-01', '2027-03-01']);
  await openMagnetics(page);
  await selectOption(page.getByLabel('Declination mode'), 'manual');
  await expect(page.getByLabel('Magnetic declination (°)', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Reference longitude (°)', { exact: true })).toHaveValue('-180');
  await referenceDate.fill('2035-01-01');
  await referenceDate.press('Enter');
  await selectOption(page.getByLabel('Declination mode'), 'auto');
  await expect(page.getByText(/WMM2025 lookup requires a date/)).toBeVisible();
  await selectOption(page.getByLabel('Declination mode'), 'omit');
  expect(readRte((await download(page, 'Download RTE')).bytes).rte?.magneticDeclination).toBeUndefined();
  expect(dates).toHaveLength(3);
});

test('an outstanding lookup cannot overwrite a manual edit or its exported value', async ({ page }) => {
  let release: (route: Route) => void;
  const requested = new Promise<Route>((resolve) => {
    release = resolve;
  });
  await page.route(bgsRequests, (route) => {
    release(route);
  });
  await page.goto('/');
  await open(page, 'pending.routeproj', crossingProject());
  await openMagnetics(page);
  const pending = await requested;
  await expect(page.getByRole('button', { name: 'Download RTE' })).toBeDisabled();
  await openMagnetics(page);
  await selectOption(page.getByLabel('Declination mode'), 'manual');
  const angle = page.getByLabel('Magnetic declination (°)', { exact: true });
  await expect(angle).toHaveValue('');
  await angle.fill('-4.25');
  await angle.press('Enter');
  await answerBgs(pending, 17);
  expect(
    readRte((await download(page, 'Download RTE')).bytes).rte?.magneticDeclination?.declinationCdeg,
  ).toBe(-425);
  await openMagnetics(page);
  await expect(angle).toHaveValue('-4.25');
});

test('moving a vertex replaces the pending midpoint request and preserves intervening edits', async ({
  page,
}) => {
  const requests: Route[] = [];
  await page.route(bgsRequests, (route) => {
    requests.push(route);
  });
  await page.goto('/');
  await open(page, 'moving.routeproj', crossingProject());
  await openExport(page);
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'First vertex' }).click();
  const longitude = page.getByLabel('Longitude', { exact: true });
  await longitude.fill('177');
  await longitude.press('Enter');
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: /Route details.*vertices/ }).click();
  const name = page.getByLabel('Name', { exact: true });
  await name.fill('Moved route');
  await name.press('Enter');
  await openMagnetics(page);
  await expect.poll(() => requests.length).toBe(2);
  expect(new URL(requests[1].request().url()).searchParams.get('longitude')).toBe('179');
  await answerBgs(requests[1], 1.25);
  await expect(page.getByText('1.25° · BGS WMM2025')).toBeVisible();
  await answerBgs(requests[0], 99);
  const doc = readRte((await download(page, 'Download RTE')).bytes);
  expect(doc.name).toBe('Moved route');
  expect(doc.rte?.magneticDeclination).toMatchObject({ referenceLonE7: 1790000000, declinationCdeg: 125 });
  expect(requests).toHaveLength(2);
});
