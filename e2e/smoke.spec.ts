import { expect, test, type Page } from '@playwright/test';

// Fast, reliable network and no teammates unless a test turns them on.
const QUIET = '/?teammates=0&fail=0&lost=0&latency=50-150&retry=0';

type W = Window & {
  __server: {
    get(id: string): { ref: string; stage: string; ownerId: string; close?: { reason?: string; note?: string } } | undefined;
  };
  __sim: { setState(p: Record<string, unknown>): void };
};

const focusedId = (page: Page) =>
  page
    .locator('#deal-grid')
    .getAttribute('aria-activedescendant')
    .then((v) => v!.replace(/^row-/, ''));

test.beforeEach(async ({ page }) => {
  await page.goto(QUIET);
  await expect(page.getByTestId('deal-row').first()).toBeVisible({ timeout: 20_000 });
});

test('loads 50k deals but only renders what is on screen', async ({ page }) => {
  await page.getByTestId('tab-new').click();
  await expect(page.getByTestId('view-count')).toHaveText('12,000 deals');
  await expect(page.getByTestId('tab-new')).toContainText('12,000');
  const rendered = await page.getByTestId('deal-row').count();
  expect(rendered).toBeLessThan(60);
});

test('moves a deal with the keyboard and confirms the save', async ({ page }) => {
  await page.getByTestId('tab-new').click();
  await page.locator('#deal-grid').focus();
  await page.keyboard.press('j');
  const id = await focusedId(page);
  await page.keyboard.press('2'); // → Contacted

  // Optimistic: it leaves the New Lead list immediately…
  await expect(page.locator(`#row-${id}`)).toHaveCount(0);
  // …and the server really has it.
  await expect.poll(() => page.evaluate((id) => (window as unknown as W).__server.get(id)?.stage, id)).toBe('contacted');
  await expect(page.getByTestId('sync-pill')).toHaveText(/All changes saved/);
});

test('a failed save is rolled back and stays visible until retried', async ({ page }) => {
  await page.getByTestId('tab-new').click();
  await page.evaluate(() => (window as unknown as W).__sim.setState({ failureRate: 1, autoRetry: false }));
  await page.locator('#deal-grid').focus();
  const id = await focusedId(page);
  await page.keyboard.press('3');

  const row = page.locator(`#row-${id}`);
  await expect(row).toHaveAttribute('data-sync', 'failed');
  await expect(row).toHaveAttribute('data-stage', 'new');
  await expect(page.getByTestId('sync-pill')).toContainText('1 not saved');
  await expect(page.getByTestId('toast-failed')).toBeVisible();

  await page.evaluate(() => (window as unknown as W).__sim.setState({ failureRate: 0 }));
  await page.keyboard.press('Shift+R');
  await expect(page.getByTestId('sync-pill')).toHaveText(/All changes saved/);
  await expect.poll(() => page.evaluate((id) => (window as unknown as W).__server.get(id)?.stage, id)).toBe('demo');
});

test('bulk-moves every stale deal in a view to Lost', async ({ page }) => {
  await page.getByTestId('tab-negotiation').click();
  await page.getByLabel('Last activity').selectOption('90');
  const count = Number((await page.getByTestId('view-count').innerText()).replace(/\D/g, ''));
  expect(count).toBeGreaterThan(100);

  await page.locator('#deal-grid').focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByTestId('bulkbar')).toContainText(`${count.toLocaleString('en-IN')} selected`);
  await page.keyboard.press('7');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('to Lost?');
  await page.keyboard.press('Enter'); // no reason yet: the dialog says so and stays open
  await expect(dialog.getByRole('alert')).toContainText('Pick a reason');
  await page.keyboard.press('4'); // No decision / went quiet
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('view-count')).toHaveText('0 deals');
  await expect(page.getByTestId('sync-pill')).toHaveText(/All changes saved/, { timeout: 30_000 });
});

test('closing one deal as Lost asks for a reason first', async ({ page }) => {
  await page.getByTestId('tab-proposal').click();
  await page.locator('#deal-grid').focus();
  const id = await focusedId(page);
  await page.keyboard.press('7');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('as Lost');
  await page.keyboard.press('1'); // Price too high
  await expect(dialog.getByRole('radio', { name: /Price too high/ })).toBeChecked();
  await page.keyboard.press('Enter');

  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((id) => (window as unknown as W).__server.get(id), id))
    .toMatchObject({ stage: 'lost', close: { reason: 'price' } });
  // The Lost tab shows the reason on the row.
  const ref = await page.evaluate((id) => (window as unknown as W).__server.get(id)?.ref, id);
  await page.getByTestId('tab-lost').click();
  await page.keyboard.press('/');
  await page.keyboard.type(ref!);
  await expect(page.locator(`#row-${id}`).getByTestId('lost-reason')).toHaveText('Price');
});

test('bulk-edits the owner of the selected deals', async ({ page }) => {
  await page.getByTestId('tab-demo').click();
  await page.locator('#deal-grid').focus();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push(await focusedId(page));
    await page.keyboard.press('x');
    await page.keyboard.press('j');
  }
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Edit 3 deals');
  await dialog.getByLabel('Owner').selectOption({ label: 'Divya Menon' });
  await expect(dialog).toContainText('owner → Divya');
  await page.keyboard.press('Enter');

  await expect(dialog).toHaveCount(0);
  for (const id of ids)
    await expect.poll(() => page.evaluate((id) => (window as unknown as W).__server.get(id)?.ownerId, id)).toBe('u13');
  await expect(page.getByTestId('sync-pill')).toHaveText(/All changes saved/);
});
