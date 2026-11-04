import { openRidge } from './files';
import { setPreference } from '../preferences';
import { expect, test } from '@playwright/test';
import { emptyRoute } from '../../src/domain/model';
import { saveProject } from '../../src/files/project';
import { dismissImportElevation } from './elevation';

test('keeps toolbar controls usable at desktop and compact widths in both languages', async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await openRidge(page);
  for (const language of ['en', 'zh']) {
    await setPreference(page, /Interface language|界面语言/, language);
    for (const width of [1440, 960, 480]) {
      await page.setViewportSize({ width, height: 700 });
      await expect
        .poll(() =>
          page.locator('.topbar, .map-tools').evaluateAll((toolbars) => {
            const issues: string[] = [];
            if (document.documentElement.scrollWidth > innerWidth) issues.push('Horizontal overflow');
            for (const toolbar of toolbars) {
              const controls = Array.from(toolbar.querySelectorAll('button, [role="radio"]'))
                .map((control) => ({
                  name: control.getAttribute('aria-label') || control.textContent,
                  rect: control.getBoundingClientRect(),
                }))
                .filter(({ rect }) => rect.width > 0 && rect.height > 0);
              for (const [index, { name, rect }] of controls.entries()) {
                if (rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight)
                  issues.push(`${name} is outside the viewport`);
                for (const other of controls.slice(index + 1)) {
                  if (
                    Math.min(rect.right, other.rect.right) - Math.max(rect.left, other.rect.left) > 1 &&
                    Math.min(rect.bottom, other.rect.bottom) - Math.max(rect.top, other.rect.top) > 1
                  )
                    issues.push(`${name} overlaps ${other.name}`);
                }
              }
            }
            return issues;
          }),
        )
        .toEqual([]);
      const tools = page.locator('.map-tools').getByRole('radio');
      await expect(tools).toHaveCount(4);
      await tools.last().click();
      await expect(tools.last()).toHaveAttribute('aria-checked', 'true');
    }
  }
});

test('selecting a map station reveals its row without resetting the outline filter', async ({ page }) => {
  const doc = emptyRoute();
  doc.vertices = Array.from({ length: 24 }, (_, i) => ({ id: String(i), lat: 46, lon: 7 + i * 0.001 }));
  doc.stations = doc.vertices.map((v, i) => ({
    id: String(i),
    name: 'Station ' + i,
    kind: 'cp',
    boundary: false,
    anchor: { vertexId: v.id, fraction: 0 },
  }));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'stations.routeproj',
    mimeType: 'application/json',
    buffer: Buffer.from(saveProject(doc)),
  });
  await dismissImportElevation(page);
  const list = page.locator('.station-list');
  const row = list.getByRole('button', { name: /Station 23/ });
  await expect(row).not.toBeInViewport();
  await page.locator('[data-station="23"] .rv-station-pin').click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toBeInViewport({ ratio: 0.99 });
  const filter = page.getByRole('textbox', { name: 'Find a station' });
  await filter.fill('Station 0');
  await page.locator('[data-station="1"] .rv-station-pin').click();
  await expect(filter).toHaveValue('Station 0');
  await expect(list.getByRole('button')).toHaveCount(1);
});

test('selects and inspects independently in a narrow workbench', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto('/');
  await openRidge(page);
  const map = page.getByRole('application', { name: 'Route map' });
  const profile = page.getByRole('group', { name: 'Elevation profile' });
  await page.getByRole('button', { name: 'Route outline', exact: true }).click();
  await page.getByRole('button', { name: /Ridge Pass.*Checkpoint/ }).click();
  await expect(page.locator('.selection-summary')).toHaveText('Ridge Pass · 5.66 km');
  await expect(page.locator('.inspector')).toBeHidden();
  await expect(map).toBeVisible();
  await page.getByRole('button', { name: 'Edit selection' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Ridge Pass');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await profile.focus();
  await profile.press('ArrowRight');
  await profile.press('ArrowRight');
  await expect(page.locator('.selection-summary')).toContainText('Elevation sample 2');
  await expect(page.locator('.inspector')).toBeHidden();
});

test('resizes the profile with its divider and restores its size when expanded', async ({ page }) => {
  await page.goto('/');
  const divider = page.getByRole('separator', { name: 'Resize elevation profile' });
  const profile = page.getByRole('group', { name: 'Elevation profile' });
  const original = (await profile.boundingBox())!;
  await divider.focus();
  await divider.press('ArrowUp');
  await expect.poll(async () => (await profile.boundingBox())!.height).toBeGreaterThan(original.height);
  const expandedHeight = (await profile.boundingBox())!.height;
  await page.getByRole('button', { name: 'Collapse elevation profile' }).click();
  await expect(profile).toBeHidden();
  await page.getByRole('button', { name: 'Expand elevation profile' }).click();
  await expect.poll(async () => (await profile.boundingBox())!.height).toBe(expandedHeight);
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 73);
  await page.mouse.up();
  await expect.poll(async () => (await profile.boundingBox())!.height).toBeLessThan(expandedHeight);
});

test('navigates command menus, outline rows and property groups from the keyboard', async ({ page }) => {
  await page.goto('/');
  await openRidge(page);
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  const route = page.locator('.rv-route');
  const originalPath = await route.getAttribute('d');
  await name.fill('Unsaved route name');
  await name.press('ControlOrMeta+n');
  const replacement = page.getByRole('dialog', { name: 'Open another route?', exact: true });
  await expect(replacement).toBeVisible();
  await replacement.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(name).toHaveValue('Unsaved route name');
  await expect(name).toBeFocused();
  await expect(route).toHaveAttribute('d', originalPath!);

  await name.fill('Preserved after cancelling open');
  const chooser = page.waitForEvent('filechooser');
  await name.press('ControlOrMeta+o');
  await (await chooser).setFiles([]);
  await expect(
    page.getByRole('heading', { name: 'Preserved after cancelling open', exact: true }),
  ).toBeVisible();
  await expect(name).toHaveValue('Preserved after cancelling open');
  await expect(name).toBeFocused();
  await expect(route).toHaveAttribute('d', originalPath!);

  const trigger = page.getByRole('button', { name: 'Menu', exact: true });
  await trigger.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Menu', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'New route', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Export…', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Export route', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(menu.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  const rows = page.locator('.station-list');
  await rows.getByRole('button', { name: /Ridge Pass.*Checkpoint/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.getByRole('button', { name: /Lookout/ })).toBeFocused();
  await expect(rows.getByRole('button', { name: /Lookout/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Home');
  await expect(rows.getByRole('button', { name: /Trailhead/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows.getByRole('button', { name: /Valley Gate/ })).toBeFocused();
  const properties = page
    .locator('.property-group')
    .filter({ has: page.locator('summary', { hasText: /^Properties$/ }) });
  await properties.locator('summary').press('Space');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeHidden();
  await setPreference(page, 'Appearance', 'dark');
  await expect(properties).not.toHaveAttribute('open');
  await properties.locator('summary').press('Enter');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Valley Gate');
});

for (const commitBeforeClose of [false, true]) {
  test(`menu exit preserves date input focus after editing${commitBeforeClose ? ' and committing' : ''}`, async ({
    page,
  }) => {
    await page.goto('/');
    // Make the menu's exit overlap the next editor interaction deterministically.
    await page.addStyleTag({
      content: '.rt-DropdownMenuContent[data-state="closed"] { animation-duration: 1s !important; }',
    });
    await page.locator('.magnetic-properties summary').click();
    const date = page.getByLabel('Reference date (UTC)');
    const trigger = page.getByRole('button', { name: 'Menu', exact: true });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Route', exact: true }).click();
    const menu = await page.getByRole('menu', { name: 'Menu', exact: true }).elementHandle();
    const restored = menu!.evaluate(
      (element) =>
        new Promise<void>((resolve) => {
          element.addEventListener(
            'focusScope.autoFocusOnUnmount',
            () => requestAnimationFrame(() => resolve()),
            { once: true },
          );
        }),
    );
    await page.getByRole('menuitem', { name: 'Route properties', exact: true }).click();
    await date.fill('2026-11-03');
    if (commitBeforeClose) await date.press('Enter');
    await restored;
    if (!commitBeforeClose) {
      await expect(date).toBeFocused();
      await date.press('Enter');
    }
    await expect(trigger).not.toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.magnetic-properties summary').click();
    await expect(date).toBeHidden();
  });
}
