import { selectOption } from '../controls';
import { expect, test } from '@playwright/test';
import { emptyRoute } from '../../src/domain/model';
import { saveProject } from '../../src/files/project';
import { openMagnetics } from './files';

test('aligns workbench headers and keeps every toolbar control separated at narrow widths', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Export RTE…' }).waitFor();
  const headerEdges = await page
    .locator('.workspace .panel-heading, .map-tools')
    .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().bottom));
  expect(headerEdges).toHaveLength(3);
  expect(Math.max(...headerEdges) - Math.min(...headerEdges)).toBeLessThanOrEqual(1);

  for (const language of ['en', 'zh']) {
    await selectOption(page.locator('.language [role="combobox"]'), language);
    for (const width of [1440, 1100, 960, 800, 621, 480]) {
      await page.setViewportSize({ width, height: 700 });
      await expect
        .poll(
          () =>
            page.locator('.topbar').evaluate((header) => {
              const bounds = header.getBoundingClientRect();
              const visible = Array.from(
                header.querySelectorAll('button, .brand, h1, .theme-picker > svg, .language > svg'),
              )
                .map((element) => ({
                  name: element.getAttribute('aria-label') || element.textContent || element.tagName,
                  rect: element.getBoundingClientRect(),
                  button: element.tagName === 'BUTTON',
                }))
                .filter(({ rect }) => rect.width > 0 && rect.height > 0);
              const issues: string[] = [];
              // Includes both combobox buttons and the two nested export buttons.
              if (visible.filter((item) => item.button).length < 9) issues.push('Missing toolbar controls');
              for (const { name, rect } of visible) {
                if (
                  rect.left < bounds.left - 1 ||
                  rect.right > Math.min(bounds.right, innerWidth) + 1 ||
                  rect.top < bounds.top - 1 ||
                  rect.bottom > bounds.bottom + 1
                )
                  issues.push(`${name} extends outside the toolbar`);
              }
              for (let i = 0; i < visible.length; i++) {
                for (let j = i + 1; j < visible.length; j++) {
                  const a = visible[i],
                    b = visible[j];
                  const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
                  const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
                  if (overlapX > 1 && overlapY > 1) issues.push(`${a.name} overlaps ${b.name}`);
                  // Compare centers only within a row; the compact toolbar intentionally has two rows.
                  if (a.button && b.button && overlapY > Math.min(a.rect.height, b.rect.height) / 2) {
                    const centerDelta = Math.abs(
                      (a.rect.top + a.rect.bottom - b.rect.top - b.rect.bottom) / 2,
                    );
                    if (centerDelta > 2) issues.push(`${a.name} and ${b.name} are vertically misaligned`);
                  }
                }
              }
              return issues;
            }),
          `${language} toolbar at ${width}px`,
        )
        .toEqual([]);
    }
  }
});

test('keeps map tools roomy and centered in every selection state and window width', async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  const tools = page.locator('.map-tools .tools');
  await expect(tools.getByRole('radio')).toHaveCount(3);
  for (const language of ['en', 'zh']) {
    await selectOption(page.locator('.language [role="combobox"]'), language);
    for (const width of [1280, 1100, 960, 800, 480]) {
      await page.setViewportSize({ width, height: 800 });
      for (let selected = 0; selected < 3; selected++) {
        const radio = tools.getByRole('radio').nth(selected);
        await radio.click();
        await expect(radio).toHaveAttribute('aria-checked', 'true');
        await expect
          .poll(
            () =>
              page.locator('.map-tools').evaluate((header) => {
                const issues: string[] = [];
                if (document.documentElement.scrollWidth > document.documentElement.clientWidth)
                  issues.push('The workbench overflows horizontally');
                const bounds = header.getBoundingClientRect();
                const buttons = Array.from(header.querySelectorAll('.tools [role="radio"]'));
                if (buttons.length !== 3) return ['Missing map tools'];
                const first = buttons[0].getBoundingClientRect();
                for (const button of buttons) {
                  const rect = button.getBoundingClientRect();
                  const name = button.getAttribute('title');
                  if (
                    Math.abs(rect.width - first.width) > 1 ||
                    Math.abs(rect.height - first.height) > 1 ||
                    Math.abs(rect.top - first.top) > 1
                  )
                    issues.push(`${name} differs from the other tool segments`);
                  if (rect.height < 28) issues.push(`${name} is too short`);
                  const selected = button.getAttribute('data-state') === 'on';
                  const wrapper = button.querySelector(
                    selected
                      ? '.rt-SegmentedControlItemLabelActive'
                      : '.rt-SegmentedControlItemLabelInactive',
                  )!;
                  if (Number(getComputedStyle(wrapper).opacity) < 0.99)
                    issues.push(`${name} is still transitioning`);
                  const label = wrapper.querySelector('.tool-label')!.getBoundingClientRect();
                  if (Math.abs(label.top + label.height / 2 - rect.top - rect.height / 2) > 1)
                    issues.push(`${name} label is not vertically centered`);
                  if (label.left - rect.left < 10 || rect.right - label.right < 10)
                    issues.push(`${name} label has insufficient horizontal space`);
                }
                const parts = Array.from(
                  header.querySelectorAll(':scope > .pane-title, .tools, .course-totals'),
                )
                  .map((element) => ({ name: element.className, rect: element.getBoundingClientRect() }))
                  .filter(({ rect }) => rect.width > 0 && rect.height > 0);
                for (const { name, rect } of parts) {
                  if (
                    rect.left < bounds.left - 1 ||
                    rect.right > bounds.right + 1 ||
                    rect.top < bounds.top - 1 ||
                    rect.bottom > bounds.bottom + 1
                  )
                    issues.push(`${name} extends outside the map toolbar`);
                }
                // The totals may wrap below the tools, but must not cover them or the title.
                for (let i = 0; i < parts.length; i++) {
                  for (let j = i + 1; j < parts.length; j++) {
                    const a = parts[i],
                      b = parts[j];
                    const overlapX =
                      Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
                    const overlapY =
                      Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
                    if (overlapX > 1 && overlapY > 1) issues.push(`${a.name} overlaps ${b.name}`);
                  }
                }
                return issues;
              }),
            `${language} map toolbar at ${width}px, tool ${selected + 1}`,
          )
          .toEqual([]);
      }
    }
  }
});

test('leaves room for coordinate values and steppers, and aligns the export preview and footer', async ({
  page,
}) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  // Exercise fallback font metrics and reserved scrollbar space on every OS.
  await page.addStyleTag({
    content: `
      .radix-themes { --default-font-family: Arial, sans-serif; }
      .inspect-content { scrollbar-gutter: stable; }
    `,
  });
  await page.getByRole('button', { name: 'First vertex', exact: true }).click();
  const latitude = page.getByRole('spinbutton', { name: 'Latitude', exact: true });
  const longitude = page.getByRole('spinbutton', { name: 'Longitude', exact: true });
  for (const width of [1280, 1100, 960]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [input, value] of [
      [latitude, '-46.12345'],
      [longitude, '-123.45678'],
    ] as const) {
      await input.fill(value);
      await expect
        .poll(
          () =>
            page.locator('.inspector .number-control').evaluateAll((controls) => {
              const issues: string[] = [];
              if (controls.length !== 2) issues.push('Coordinate fields are missing');
              for (const control of controls) {
                const bounds = control.getBoundingClientRect();
                const field = control.querySelector('input')!;
                const unit = control.querySelector('.rt-TextFieldSlot > [aria-hidden="true"]')!;
                const buttons = Array.from(control.querySelectorAll('button'));
                const name = field.getAttribute('aria-label');
                if (buttons.length !== 2 || !unit) {
                  issues.push(`${name} is missing its unit or steppers`);
                  continue;
                }
                let right = bounds.left;
                for (const part of [field, unit, ...buttons]) {
                  const rect = part.getBoundingClientRect();
                  if (
                    rect.width <= 0 ||
                    rect.left < right - 1 ||
                    rect.right > bounds.right + 1 ||
                    rect.top < bounds.top - 1 ||
                    rect.bottom > bounds.bottom + 1
                  )
                    issues.push(`${name}: ${part.tagName} is clipped or overlaps its neighbor`);
                  right = rect.right;
                }
                const style = getComputedStyle(field);
                const context = document.createElement('canvas').getContext('2d')!;
                context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const available =
                  field.getBoundingClientRect().width -
                  parseFloat(style.paddingLeft) -
                  parseFloat(style.paddingRight) -
                  Math.max(0, parseFloat(style.textIndent) || 0);
                const required = context.measureText(field.value).width;
                if (required > available + 1)
                  issues.push(
                    `${name} needs ${required.toFixed(1)}px for five decimal places, but has ${available.toFixed(1)}px`,
                  );
              }
              return issues;
            }),
          `Numeric fields at ${width}px`,
        )
        .toEqual([]);
      await input.press('Escape');
    }
    await expect
      .poll(() =>
        page.locator('.index-stepper').evaluate((stepper) => {
          const bounds = stepper.getBoundingClientRect();
          const children = Array.from(
            stepper.querySelectorAll(':scope > button, :scope > .rt-TextFieldRoot'),
          );
          const issues: string[] = [];
          if (children.length !== 3) issues.push('Index controls are missing');
          let right = bounds.left;
          for (const child of children) {
            const rect = child.getBoundingClientRect();
            if (rect.left < right - 1 || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1)
              issues.push('Index controls overlap or exceed their container');
            right = rect.right;
          }
          return issues;
        }),
      )
      .toEqual([]);
  }

  const dialog = await openMagnetics(page);
  await selectOption(dialog.getByLabel('Declination mode'), 'omit');
  await dialog.locator('.mag-export summary').click();
  const title = dialog.getByRole('heading', { name: 'Output preview', exact: true });
  const stats = dialog.locator('.export-preview header > small');
  await expect(title).toBeVisible();
  for (const width of [960, 480]) {
    await page.setViewportSize({ width, height: 700 });
    await expect
      .poll(async () => {
        const heading = (await title.boundingBox())!;
        const summary = (await stats.boundingBox())!;
        return Math.abs(heading.y + heading.height / 2 - summary.y - summary.height / 2);
      })
      .toBeLessThanOrEqual(2);
    await expect(dialog.getByRole('button', { name: 'Download RTE', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(dialog.getByRole('button', { name: 'Bluetooth upload…', exact: true })).toBeInViewport({
      ratio: 1,
    });
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
  const file = page.getByRole('button', { name: 'File', exact: true });
  await file.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'File', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'New route', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Save project', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'New route', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(file).toBeFocused();
  await file.press('Enter');
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Save project', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

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
  await selectOption(page.getByLabel('Appearance', { exact: true }), 'dark');
  await expect(properties).not.toHaveAttribute('open');
  await properties.locator('summary').press('Enter');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Valley Gate');
});
