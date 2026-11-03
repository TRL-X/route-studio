import { expect, test } from '@playwright/test';
import { strings } from '../../src/app/strings';
import { loadProject } from '../../src/files/project';
import copy from '../../src/i18n/en.repair.json' with { type: 'json' };
import { readRte } from '../../src/rte';
import { answerBgs, bgsRequests } from './bgs';
import { disableExportProcessing, download, open, setSurveyDate } from './files';
import { mockOnlineTerrain } from './fixtures/online-terrain';

const t = strings.en;
const source = `<gpx><trk><name>Polar trail</name><trkseg>
  <trkpt lat="86" lon="120"/>
  <trkpt lat="86" lon="120.002777778"/>
  <trkpt lat="86" lon="120.005555556"/>
</trkseg></trk></gpx>`;

test('a route with no heights opens the online preview, can retry, and exports only after confirmation', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context, { failFirstLookup: true });
  await page.route(bgsRequests, (route) => answerBgs(route));
  await page.goto('/');
  await open(page, 'polar.gpx', Buffer.from(source));
  await expect(page.getByRole('heading', { name: 'Polar trail', exact: true })).toBeVisible();
  await page.getByRole('button', { name: t.interpolateGaps, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.title });
  const confirm = dialog.getByRole('button', { name: copy.replace, exact: true });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await dialog.getByRole('button', { name: copy.retry, exact: true }).click();
  await expect(confirm).toBeEnabled();
  await expect(dialog.getByText(copy.currentLine, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(copy.replacementLine, { exact: true })).toBeVisible();
  await expect(dialog.locator('.profile-preview-strip')).toHaveCount(0);
  await confirm.click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: t.undo, exact: true }).click();
  await expect(page.getByRole('button', { name: t.interpolateGaps, exact: true })).toBeEnabled();
  const draft = loadProject((await download(page, t.save)).bytes.toString('utf8'));
  expect(draft.elevation.map((s) => s.height)).toEqual([null, null, null]);
  await page.getByRole('button', { name: t.redo, exact: true }).click();
  await setSurveyDate(page);
  await disableExportProcessing(page);
  const device = readRte((await download(page, 'Download RTE')).bytes);
  expect(device.elevation.map((s) => s.height)).toEqual([0, 50, -13.5]);
  expect(device.elevationReference).toBe(1);
});
