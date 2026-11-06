import { selectOption } from '../controls';
import { expect, test } from '@playwright/test';
import { strings } from '../../src/i18n/index';
import { commandStrings } from '../../src/features/editor/commands';
import { setPreference } from '../preferences';
import { loadProject } from '../../src/files/project';
import { prepareRte, readRte } from '../../src/rte';

import { open, download, openExport, openRidge, disableExportProcessing, setSurveyDate } from './files';
import { bgsRequests, answerBgs } from './bgs';
import { dismissImportElevation } from './elevation';

test.beforeEach(async ({ page }) => {
  await page.route(bgsRequests, (route) => answerBgs(route));
});

const gpx = `<gpx version="1.1">
  <wpt lat="30.011" lon="105.01"><name>Water</name></wpt>
  <trk><name>North ridge</name><trkseg>
    <trkpt lat="30" lon="105"><ele>10</ele></trkpt>
    <trkpt lat="30.01" lon="105.01"><ele>20</ele></trkpt>
    <trkpt lat="30.02" lon="105.02"><ele>15</ele></trkpt>
  </trkseg></trk></gpx>`;

test('desktop editor switches languages and retains the preference', async ({ page }) => {
  await page.goto('/');
  await setPreference(page, 'Interface language', 'zh');
  await expect(page.getByRole('button', { name: strings.zh.save, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: commandStrings.zh.export, exact: true })).toBeVisible();
  await setPreference(page, strings.zh.lang, 'en');
  await expect(page.getByRole('button', { name: commandStrings.en.export, exact: true })).toBeVisible();
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
  expect(device.bytes).toEqual(
    Buffer.from(prepareRte(stored, { intervalM: 10, toleranceM: 2, smoothingM: 10 }).bytes),
  );
  expect(decoded.stations.map((s) => s.name)).toEqual(['Start', 'Water', 'Finish']);
  expect(decoded.stations[1]).toMatchObject({ kind: 'cp', boundary: true });
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

test('cancelled imports preserve edits and history while replacement starts a new document session', async ({
  page,
}) => {
  await page.goto('/');
  await open(page, 'original.gpx', Buffer.from(gpx));
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toHaveValue('North ridge');
  await name.fill('Working copy');
  await name.press('Enter');

  const kml =
    '<kml><Document><Placemark><name>Unconfirmed route</name><LineString><coordinates>110,30,100 111,31,120</coordinates></LineString></Placemark></Document></kml>';
  await open(page, 'unconfirmed.kml', Buffer.from(kml));
  await page
    .getByRole('dialog', { name: strings.en.selectTrack })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(name).toHaveValue('Working copy');

  const replacement = Buffer.from(gpx.replace('North ridge', 'Replacement route'));
  await open(page, 'replacement.gpx', replacement);
  await page
    .getByRole('dialog', { name: strings.en.discardTitle })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(name).toHaveValue('Working copy');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(name).toHaveValue('North ridge');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(name).toHaveValue('Working copy');

  await open(page, 'replacement.gpx', replacement);
  await page
    .getByRole('dialog', { name: strings.en.discardTitle })
    .getByRole('button', { name: 'Replace', exact: true })
    .click();
  await expect(name).toHaveValue('Replacement route');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await expect(page.getByText('Draft saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('Replacement route');
});

test('incomplete elevation can be saved to a project and corrected before RTE download', async ({ page }) => {
  await page.goto('/');
  await open(page, 'incomplete.gpx', Buffer.from(gpx.replace('<ele>20</ele>', '')));
  await dismissImportElevation(page);
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toHaveValue('North ridge');
  const project = await download(page, 'Save project');
  expect(loadProject(project.bytes.toString('utf8')).elevation[1].height).toBeNull();
  await setSurveyDate(page);
  await openExport(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Download RTE' })).toBeDisabled();
  await expect(dialog.getByText(/missing height for elevation sample 2/i)).toBeVisible();
  await page.getByRole('button', { name: 'Show in inspector', exact: true }).click();
  const height = page.getByRole('spinbutton', {
    name: 'Elevation (m)',
    exact: true,
  });
  await expect(height).toHaveAccessibleDescription(/missing height for elevation sample 2/i);
  await height.fill('22');
  await height.press('Enter');
  await openExport(page);
  await expect(dialog.getByRole('button', { name: 'Download RTE' })).toBeEnabled();
  const device = await download(page, 'Download RTE');
  expect(Math.max(...readRte(device.bytes).elevation.map((sample) => sample.height!))).toBe(22);
});

test('opens a selected KML line with altitude values enabled by default', async ({ page }) => {
  await page.goto('/');
  const kml = `<kml><Document><Placemark><name>Short loop</name>
    <LineString><coordinates>110,30,100 111,31,120</coordinates></LineString></Placemark>
    <Placemark><name>Long loop</name><LineString><coordinates>112,30,200 112,31,230</coordinates></LineString>
    </Placemark></Document></kml>`;
  await open(page, 'loops.kml', Buffer.from(kml));
  const dialog = page.getByRole('dialog', { name: 'Choose a route to open' });
  const useAltitude = dialog.getByRole('checkbox', { name: 'Use the altitude values in this KML' });
  await expect(useAltitude).toBeChecked();
  await useAltitude.uncheck();
  await selectOption(dialog.getByRole('combobox', { name: 'Route', exact: true }), '1');
  await expect(useAltitude).toBeChecked();
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Long loop', exact: true })).toBeVisible();
  await setSurveyDate(page);
  const device = await download(page, 'Download RTE');
  const { elevation } = readRte(device.bytes);
  expect(elevation[0].height).toBe(200);
  expect(elevation.at(-1)?.height).toBe(230);
});

test('fills gaps in one edit and resolves device-distance collisions in the preview', async ({ page }) => {
  const source =
    '<gpx><trk><name>Close samples</name><trkseg>' +
    '<trkpt lat="0" lon="0"><ele>0</ele></trkpt>' +
    '<trkpt lat="0" lon="0.0005"/>' +
    '<trkpt lat="0" lon="0.001"><ele>10</ele></trkpt>' +
    '<trkpt lat="0" lon="0.0010002"><ele>15</ele></trkpt>' +
    '<trkpt lat="0" lon="0.002"><ele>30</ele></trkpt></trkseg></trk></gpx>';
  await page.goto('/');
  await open(page, 'close.gpx', Buffer.from(source));
  await dismissImportElevation(page);
  await setSurveyDate(page);
  await page.getByRole('button', { name: 'Elevation tools…', exact: true }).click();
  const fill = page.getByRole('button', { name: 'Fill elevation gaps', exact: true });
  await fill.click();
  await expect(page.getByRole('dialog').getByText('Filled 1 · 0 remaining', { exact: true })).toBeVisible();
  await expect(fill).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Elevation tools…', exact: true }).click();
  await expect(fill).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await disableExportProcessing(page);
  await page.getByText('Resolved shared elevation positions: 1').click();
  await expect(page.getByText('111.2 m → 10 m')).toBeVisible();
  const exported = readRte((await download(page, 'Download RTE')).bytes);
  expect(exported.elevation.map((s) => s.height)).toEqual([0, 5, 10, 30]);
  const project = loadProject((await download(page, 'Save project')).bytes.toString('utf8'));
  expect(project.elevation.map((s) => s.height)).toEqual([0, expect.closeTo(5), 10, 15, 30]);
  await page.getByRole('button', { name: commandStrings.en.export, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Route processing options').click();
  await selectOption(dialog.getByLabel('Elevation sample spacing'), '10');
  await selectOption(dialog.getByLabel('Geometry tolerance'), '2');
  await selectOption(dialog.getByLabel('Smoothing window'), '30');
  await dialog.getByText('Compare elevation profiles').click();
  await expect(dialog.getByRole('img', { name: 'Compare elevation profiles' })).toBeVisible();
  await dialog.getByLabel('File name').fill('ridge.rte');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: commandStrings.en.export }).click();
  await dialog.getByText('Route processing options').click();
  await expect(dialog.getByLabel('Smoothing window')).toHaveAttribute('data-value', '30');
  const grid = await download(page, 'Download RTE');
  expect(grid.name).toBe('ridge.rte');
  expect(readRte(grid.bytes).elevation.length).toBe(24);
});

test('starts with an empty route without an example command and recovers edits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'New route', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open example', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Route details.*0 vertices/i })).toBeVisible();
  await expect(page.locator('.station-row')).toHaveCount(0);
  await expect(page.locator('.empty-overlay')).toBeVisible();
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
  await openRidge(page);
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
  await expect(page.getByRole('checkbox', { name: 'Stage boundary' })).toBeChecked();
  await page.getByRole('button', { name: 'Pick on map', exact: true }).click();
  await map.click({ position: { x: position.x + 12, y: position.y + 13 } });
  await expect(map.locator('.rv-connector')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Insert point', exact: true }).click();
  await map.click({ position });
  await expect(page.getByRole('button', { name: /Route details.*24 vertices/i })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: /Route details.*23 vertices/i })).toBeVisible();
  const profile = page.getByRole('group', { name: 'Elevation profile' });
  await profile.focus();
  await profile.press('ArrowRight');
  const height = page.getByRole('spinbutton', { name: 'Elevation (m)' });
  await height.fill('1028');
  await height.press('Enter');
  await disableExportProcessing(page);
  const course = readRte((await download(page, 'Download RTE')).bytes);
  const station = course.stations.find((s) => s.name === 'Water stop');
  expect(station).toMatchObject({ kind: 'cp', boundary: true });
  expect(station?.anchor).toBeTruthy();
  expect(station?.location).toBeTruthy();
  expect(course.elevation[0].height).toBe(1028);
});

test('the export footer stays available on a narrow screen and only the chosen route keeps its settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.setViewportSize({ width: 360, height: 600 });
  const dialog = await openExport(page);
  await dialog.getByText('Route processing options').click();
  await expect(dialog.getByLabel('Elevation sample spacing')).toHaveAttribute('data-value', '10');
  await expect(dialog.getByLabel('Geometry tolerance')).toHaveAttribute('data-value', '2');
  await expect(dialog.getByLabel('Smoothing window')).toHaveAttribute('data-value', '10');
  await selectOption(dialog.getByLabel('Elevation sample spacing'), '20');
  await selectOption(dialog.getByLabel('Geometry tolerance'), '5');
  await selectOption(dialog.getByLabel('Smoothing window'), '50');
  await dialog.getByLabel('File name').fill('bad/name');
  await expect(dialog.getByRole('button', { name: 'Download RTE' })).toBeDisabled();
  await dialog.getByLabel('File name').fill('Trail');
  await expect(dialog.getByRole('button', { name: 'Download RTE' })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole('button', { name: 'Connect and send…' })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByLabel('Device path')).toBeHidden();
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await open(page, 'other.gpx', Buffer.from(gpx));
  await expect(page.getByRole('heading', { name: 'North ridge' })).toBeVisible();
  await openExport(page);
  await dialog.getByText('Route processing options').click();
  await expect(dialog.getByLabel('Elevation sample spacing')).toHaveAttribute('data-value', '10');
  await expect(dialog.getByLabel('Geometry tolerance')).toHaveAttribute('data-value', '2');
  await expect(dialog.getByLabel('Smoothing window')).toHaveAttribute('data-value', '10');
  await expect(dialog.getByLabel('File name')).toHaveValue('North ridge');
});
