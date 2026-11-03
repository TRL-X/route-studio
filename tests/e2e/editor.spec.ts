import { expect, test, type Page } from '@playwright/test';
import { strings } from '../../src/app/strings';
import { loadProject } from '../../src/files/project';
import { readRte } from '../../src/rte';

import { open, download } from './files';
import { bgsRequests, answerBgs } from './bgs';

test.beforeEach(async ({ page }) => {
  await page.route(bgsRequests, (route) => answerBgs(route));
});

async function setSurveyDate(page: Page) {
  const date = page.getByLabel('Reference date (UTC)');
  await date.fill('2026-11-03');
  await date.press('Enter');
}

const gpx = `<gpx version="1.1">
  <wpt lat="30.011" lon="105.01"><name>Water</name></wpt>
  <trk><name>North ridge</name><trkseg>
    <trkpt lat="30" lon="105"><ele>10</ele></trkpt>
    <trkpt lat="30.01" lon="105.01"><ele>20</ele></trkpt>
    <trkpt lat="30.02" lon="105.02"><ele>15</ele></trkpt>
  </trkseg></trk></gpx>`;

test('desktop editor switches languages and retains the preference', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Interface language').selectOption('zh');
  await expect(page.getByRole('button', { name: strings.zh.save, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: strings.zh.export, exact: true })).toBeVisible();
  await page.getByLabel(strings.zh.lang).selectOption('en');
  await expect(page.getByRole('button', { name: 'Download RTE', exact: true })).toBeVisible();
});

test('imports, edits, undoes, recovers a draft and downloads project and device files', async ({ page }) => {
  await page.goto('/');
  await open(page, 'ridge.gpx', Buffer.from(gpx));
  await setSurveyDate(page);
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toHaveValue('North ridge');
  await name.fill('Ridge checkpoint');
  await name.press('Enter');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(name).toHaveValue('North ridge');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(name).toHaveValue('Ridge checkpoint');
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('Ridge checkpoint');

  const project = await download(page, 'Save project');
  expect(project.name).toMatch(/\.routeproj$/i);
  const stored = loadProject(project.bytes.toString('utf8'));
  expect(stored).toMatchObject({
    name: 'Ridge checkpoint',
    vertices: [{}, {}, {}],
  });
  expect(stored.stations.map((s) => s.name)).toEqual(['Start', 'Water', 'Finish']);

  const device = await download(page, 'Download RTE');
  expect(device.name).toMatch(/\.rte$/i);
  const decoded = readRte(device.bytes);
  expect(decoded.name).toBe('Ridge checkpoint');
  expect(decoded.elevation.map((sample) => sample.height)).toEqual([10, 20, 15]);
  expect(decoded.stations.map((s) => s.name)).toEqual(['Start', 'Water', 'Finish']);
  await open(page, device.name, device.bytes);
  await expect(page.getByText(device.name, { exact: true })).toBeVisible();
  await expect(name).toHaveValue('Ridge checkpoint');
  await name.fill('Discarded edit');
  await name.press('Enter');
  await open(page, project.name, project.bytes);
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText(project.name, { exact: true })).toBeVisible();
  await expect(name).toHaveValue('Ridge checkpoint');
});

test('incomplete elevation can be saved to a project and corrected before RTE download', async ({ page }) => {
  await page.goto('/');
  await open(page, 'incomplete.gpx', Buffer.from(gpx.replace('<ele>20</ele>', '')));
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toHaveValue('North ridge');
  await setSurveyDate(page);
  const check = page.getByRole('button', { name: 'Check RTE', exact: true });
  await expect(check).toHaveAccessibleDescription('Not checked');
  await check.click();
  await expect(check).toHaveAccessibleDescription('Needs attention');
  await expect(page.getByText(/missing height for elevation sample 2/i).first()).toBeVisible();
  const project = await download(page, 'Save project');
  expect(loadProject(project.bytes.toString('utf8')).elevation[1].height).toBeNull();
  await page.getByRole('button', { name: 'Show in inspector', exact: true }).click();
  const height = page.getByRole('spinbutton', {
    name: 'Elevation (m)',
    exact: true,
  });
  await expect(height).toHaveAccessibleDescription(/missing height for elevation sample 2/i);
  await height.fill('22');
  await height.press('Enter');
  await expect(check).toHaveAccessibleDescription('Not checked');
  await check.click();
  await expect(check).toHaveAccessibleDescription('Ready to export');
  const device = await download(page, 'Download RTE');
  expect(readRte(device.bytes).elevation[1].height).toBe(22);
});

test('opens a selected KML line with explicit height confirmation', async ({ page }) => {
  await page.goto('/');
  const kml = `<kml><Document><Placemark><name>Short loop</name>
    <LineString><coordinates>110,30,100 111,31,120</coordinates></LineString></Placemark>
    <Placemark><name>Long loop</name><LineString><coordinates>112,30,200 112,31,230</coordinates></LineString>
    </Placemark></Document></kml>`;
  await open(page, 'loops.kml', Buffer.from(kml));
  const dialog = page.getByRole('dialog', { name: 'Choose a route to open' });
  await dialog.getByRole('combobox', { name: 'Route', exact: true }).selectOption('1');
  await dialog.getByRole('checkbox', { name: 'Use the altitude values in this KML' }).check();
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Long loop', exact: true })).toBeVisible();
  await setSurveyDate(page);
  const device = await download(page, 'Download RTE');
  expect(readRte(device.bytes).elevation.map((sample) => sample.height)).toEqual([200, 230]);
});

test('fills elevation gaps in one edit and asks before resampling device-distance collisions', async ({
  page,
}) => {
  const source =
    '<gpx><trk><name>Close samples</name><trkseg>' +
    '<trkpt lat="0" lon="0"><ele>0</ele></trkpt>' +
    '<trkpt lat="0" lon="0.0005"/>' +
    '<trkpt lat="0" lon="0.001"><ele>10</ele></trkpt>' +
    '<trkpt lat="0" lon="0.0010002"><ele>15</ele></trkpt>' +
    '<trkpt lat="0" lon="0.002"><ele>30</ele></trkpt></trkseg></trk></gpx>';
  await page.goto('/');
  await open(page, 'close.gpx', Buffer.from(source));
  await setSurveyDate(page);
  const fill = page.getByRole('button', { name: 'Fill elevation gaps (1)' });
  await fill.click();
  await expect(page.getByRole('status')).toContainText('Estimated heights: 1. Still missing: 0.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(fill).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Download RTE', exact: true }).click();
  const exported = readRte((await download(page, 'Download with nearest samples')).bytes);
  await expect(page.getByRole('button', { name: 'Check RTE', exact: true })).toHaveAccessibleDescription(
    'Nearest samples only',
  );
  expect(exported.elevation.map((s) => s.height)).toEqual([0, 5, 10, 30]);
  const project = loadProject((await download(page, 'Save project')).bytes.toString('utf8'));
  expect(project.elevation.map((s) => s.height)).toEqual([0, expect.closeTo(5), 10, 15, 30]);
  await page.getByRole('button', { name: 'Download RTE', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download with nearest samples' })).toBeVisible();
});

test('creates and recovers an empty editable project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'New route', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toHaveValue('');
  await name.fill('Survey draft');
  await name.press('Enter');
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('Survey draft');
  const project = await download(page, 'Save project');
  expect(loadProject(project.bytes.toString('utf8'))).toMatchObject({
    name: 'Survey draft',
    vertices: [],
    stations: [],
  });
});

test('places a checkpoint and its separate landmark, inserts a vertex and edits the elevation profile', async ({
  page,
}) => {
  await page.goto('/');
  const map = page.getByRole('application', { name: 'Route map' });
  const position = await map.locator('.rv-route').evaluate((element) => {
    const path = element as SVGPathElement;
    const at = path.getPointAtLength(path.getTotalLength() * 0.37);
    return { x: at.x, y: at.y };
  });
  await page.getByRole('button', { name: 'Add station', exact: true }).click();
  await map.click({ position });
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Water stop');
  await name.press('Enter');
  await page.getByRole('checkbox', { name: 'Stage boundary' }).check();
  await page.getByRole('button', { name: 'Pick on map', exact: true }).click();
  await map.click({ position: { x: position.x + 12, y: position.y + 13 } });
  await expect(map.locator('.rv-connector')).toHaveCount(1);
  await page.getByRole('button', { name: 'Insert point', exact: true }).click();
  await map.click({ position });
  await expect(page.getByRole('button', { name: /Example route.*24 vertices/i })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: /Example route.*23 vertices/i })).toBeVisible();
  const profile = page.getByRole('group', { name: 'Elevation profile' });
  await profile.focus();
  await profile.press('ArrowRight');
  const height = page.getByRole('spinbutton', { name: 'Elevation (m)' });
  await height.fill('1028');
  await height.press('Enter');
  const course = readRte((await download(page, 'Download RTE')).bytes);
  const station = course.stations.find((s) => s.name === 'Water stop');
  expect(station).toMatchObject({ kind: 'cp', boundary: true });
  expect(station?.anchor).toBeTruthy();
  expect(station?.location).toBeTruthy();
  expect(course.elevation[0].height).toBe(1028);
});
