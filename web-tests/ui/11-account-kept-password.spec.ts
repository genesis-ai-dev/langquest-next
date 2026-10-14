// docs/ui-test-suite/11-account-and-settings.md, ACCT-021: the looked-after
// account sets a password. It changes KEPT for good (and setting a password
// ends KEPT's other sessions, decision 87), so it has a world of its own;
// ACCT-006, 019, 020 and 041 need KEPT without one.
import { openOnce, quietDevServer, stateFor } from './account-helpers';
import { back, button, expect, field, primary, tab, test, text, useWorld } from './support';

const world = useWorld();
test.beforeEach(async ({ context }) => { await quietDevServer(context); });

const row = (page: Parameters<typeof button>[0], label: string) => button(page, new RegExp(`^${label}`));

test('ACCT-021 A looked-after account sets a password', async ({ page }) => {
  const w = world();
  const kept = w.accounts.KEPT;
  const password = 'kept-pw-8';
  await openOnce(page, stateFor(w, 'KEPT'));
  await tab(page, 'me').click();
  await row(page, 'More settings').click();
  await expect(text(page, kept.name)).toBeVisible();
  await row(page, 'Set a password').click();
  await field(page, 'Password (optional)').fill(password);
  await primary(page).click();
  await expect(page.getByTestId('toast').locator('visible=true').last())
    .toContainText('Saved. You can sign in with your sign-in name and this password.', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'More settings', exact: true })).toBeVisible();
  await expect(row(page, 'Set a password')).toHaveCount(0);
  // Edit Profile again, from Me's name row.
  await back(page).click();
  await row(page, kept.name).click();
  await expect(field(page, 'New password (optional)')).toBeVisible();
  await expect(text(page, `You sign in with ${kept.signInName} and this password. Write the name down.`)).toBeVisible();
  await back(page).click();
  await button(page, 'Sign out').click();
  await expect(text(page, 'Sign out?')).toBeVisible();
  const words = await page.locator('body').innerText();
  expect(words).not.toMatch(/a code from/);
  // Signing out and back in with the sign-in name and the new password works (AUTH).
  const reloaded = page.waitForEvent('load');
  await primary(page).click();
  await reloaded;
  await expect(text(page, 'Create Account')).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Email or sign-in name').fill(kept.signInName!);
  await page.getByPlaceholder('Password').fill(password);
  await primary(page).click();
  await expect(tab(page, 'me')).toBeVisible({ timeout: 60_000 });
});
