import { expect, type Locator } from '@playwright/test';

/** Select a Radix option through the visible, portalled listbox. */
export async function selectOption(control: Locator, value: string) {
  await control.click();
  await control
    .page()
    .getByRole('option')
    .and(control.page().locator(`[data-value="${value}"]`))
    .click();
  // Language changes also rename the trigger; identify the restored focus independently of its label.
  await expect(control.page().getByRole('combobox').and(control.page().locator(':focus'))).toHaveAttribute(
    'data-value',
    value,
  );
}
