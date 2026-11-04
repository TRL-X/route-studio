import { expect, test } from '@playwright/test';
import { strings } from '../../src/app/strings';
import { open } from './files';
import { dismissImportElevation, openOnlineTerrain } from './elevation';
import { mockOnlineTerrain } from './fixtures/online-terrain';

const t = strings.en;

test('overlays both profiles on the same scale and inspecting the chart does not change the route', async ({
  page,
  context,
}) => {
  await mockOnlineTerrain(context);
  const points = [20, 260, null, 18, 24]
    .map(
      (h, i) => `<trkpt lat="86" lon="${120 + i / 360}">${h === null ? '' : '<ele>' + h + '</ele>'}</trkpt>`,
    )
    .join('');
  await page.goto('/');
  await open(
    page,
    'preview.gpx',
    Buffer.from(`<gpx><trk><name>Two profiles</name><trkseg>${points}</trkseg></trk></gpx>`),
  );
  await dismissImportElevation(page);
  await expect(page.getByRole('heading', { name: 'Two profiles' })).toBeVisible();
  await openOnlineTerrain(page);
  const dialog = page.getByRole('dialog');
  const graph = dialog.getByRole('img', { name: t.profile, exact: true });
  await expect(graph.locator('.proposed')).toHaveAttribute('d', /^M/);
  // The existing profile keeps its real gap. Only the proposal connects across it.
  expect((await graph.locator('.original').getAttribute('d'))?.match(/M/g)).toHaveLength(2);
  expect((await graph.locator('.proposed').getAttribute('d'))?.match(/M/g)).toHaveLength(1);
  await expect(graph.locator('.profile-preview-strip')).toHaveCount(1);
  const ticks = () => graph.locator('.repair-distance').allTextContents();
  const whole = await ticks();
  await dialog.getByRole('button', { name: t.zoomIn }).click();
  await expect.poll(ticks).not.toEqual(whole);
  const zoomed = await ticks();
  const box = (await graph.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(ticks).not.toEqual(zoomed);
  await dialog.getByRole('button', { name: t.fitRoute, exact: true }).click();
  await expect.poll(ticks).toEqual(whole);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: t.undo, exact: true })).toBeDisabled();
});
