// docs/ui-test-suite/11-account-and-settings.md, ACCT-059 to ACCT-061: an
// email and a password on Edit Profile, the one place for both (LAN-304,
// docs/decisions/2026-11-18-edit-profile-holds-email-and-password.md). Each
// test changes its account's address or password for good, so each makes an
// account of its own and deletes it at the end.
import type { Page } from '@playwright/test';
import { deleteNew, newAccount, openOnce, quietDevServer, stateFor, type NewAccount } from './account-helpers';
import { anon, randomHex, service } from './auth-helpers';
import { button, expect, field, primary, screenText, tab, test, text, useWorld } from './support';

const world = useWorld();
test.beforeEach(async ({ context }) => { await quietDevServer(context); });

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const row = (page: Page, label: string) => button(page, new RegExp(`^${esc(label)}`));
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const toast = (page: Page) => page.getByTestId('toast').locator('visible=true').last();

/** Me, then the name row: Edit Profile. */
async function openProfile(page: Page, who: NewAccount): Promise<void> {
  await tab(page, 'me').click();
  await row(page, who.name).click();
  await expect(heading(page, 'Edit Profile')).toBeVisible();
}

/** Can this address and password sign in? Asked of the server, apart from the page's session. */
async function signsIn(email: string, password: string): Promise<boolean> {
  const { data, error } = await anon().auth.signInWithPassword({ email, password });
  return !error && !!data.session;
}

/** Delete a test's account with the password it ends with (a new password ends the old session), else the old session. */
async function deleteWith(who: NewAccount, email: string, password: string): Promise<void> {
  const sb = anon();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (!error && !(await sb.rpc('delete_my_account')).error) return;
  await deleteNew(who);
}

test('ACCT-059 A looked-after account adds its email and a password, and signs in with them', async ({ page }) => {
  const { world: w, who } = await newAccount(world(), 59, 'translator', { lookedAfter: true });
  const address = `ui-${w.run}-acct059-${randomHex(2)}@example.org`;
  const password = 'kept-mail-59';
  try {
    const before = await service().from('account_stewards').select('profile_id').eq('profile_id', who.id);
    expect(before.data).toHaveLength(1);
    await openOnce(page, stateFor(w, who.key));
    await openProfile(page, who);
    await expect(field(page, 'Email')).toHaveValue('');
    await expect(text(page, `With an email, you sign in with it instead of ${who.signInName}, and Forgot password can send you a link. A helper's code no longer signs you in.`)).toBeVisible();
    await field(page, 'Email').fill(` ${address.toUpperCase()} `);
    // A password must come with it: helpers' codes stop once the account has an email.
    await expect(text(page, "Choose a password too: with an email, a helper's code no longer signs you in.")).toBeVisible();
    await primary(page).click();
    await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText("Choose a password too: with an email, a helper's code no longer signs you in.");
    expect((await service().auth.admin.getUserById(who.id)).data.user?.email).toBe(who.email);
    await field(page, 'Password').fill(password);
    await field(page, 'Confirm password').fill(password);
    await expect(text(page, `You sign in with ${address} and this password.`)).toBeVisible();
    await primary(page).click();
    await expect(toast(page)).toContainText(`Saved. You sign in with ${address} and this password.`, { timeout: 30_000 });
    await expect(heading(page, 'Me')).toBeVisible();
    // More settings shows the address at once, and no longer how a helper gets them back in.
    await row(page, 'More settings').click();
    await expect(text(page, address)).toBeVisible();
    expect(await screenText(page)).not.toMatch(/No email yet|New device\?|Set a password/);
    // The server: the address is the account's, with nothing sent to prove it, and the steward row has gone.
    expect((await service().auth.admin.getUserById(who.id)).data.user?.email).toBe(address);
    expect((await service().from('account_stewards').select('profile_id').eq('profile_id', who.id)).data).toEqual([]);
    expect(await signsIn(address, password)).toBe(true);
    expect(await signsIn(who.email, password)).toBe(false);
  } finally {
    await deleteWith(who, address, password);
  }
});

test('ACCT-060 Someone with an email changes it; another account\'s address is refused', async ({ page }) => {
  const { world: w, who } = await newAccount(world(), 60, 'translator');
  const address = `ui-${w.run}-acct060-${randomHex(2)}@example.org`;
  try {
    await openOnce(page, stateFor(w, who.key));
    await openProfile(page, who);
    await expect(field(page, 'Email')).toHaveValue(who.email);
    await field(page, 'Email').fill(w.accounts.TRANS.email);
    await primary(page).click();
    await expect(text(page, 'Another account already uses this email.')).toBeVisible({ timeout: 30_000 });
    await expect(heading(page, 'Edit Profile')).toBeVisible();
    await field(page, 'Email').fill('not-an-address');
    await primary(page).click();
    await expect(text(page, 'Check the email address.')).toBeVisible();
    // An email cannot be taken away.
    await field(page, 'Email').fill('');
    await primary(page).click();
    await expect(text(page, 'Type the email you sign in with.')).toBeVisible();
    expect((await service().auth.admin.getUserById(who.id)).data.user?.email).toBe(who.email);
    await field(page, 'Email').fill(address);
    await primary(page).click();
    await expect(toast(page)).toContainText(`Saved. You sign in with ${address} from now on.`, { timeout: 30_000 });
    await expect(heading(page, 'Me')).toBeVisible();
    await row(page, 'More settings').click();
    await expect(text(page, address)).toBeVisible();
    expect((await service().auth.admin.getUserById(who.id)).data.user?.email).toBe(address);
    expect(await signsIn(address, who.password)).toBe(true);
  } finally {
    await deleteWith(who, address, who.password);
  }
});

test('ACCT-061 Someone with an email changes their password on Edit Profile', async ({ page }) => {
  const { world: w, who } = await newAccount(world(), 61, 'translator');
  const password = 'new-pass-61';
  try {
    await openOnce(page, stateFor(w, who.key));
    await openProfile(page, who);
    const pass = field(page, 'New password (optional)');
    await pass.fill('abc12');
    await primary(page).click();
    await expect(text(page, 'Choose a password of 6 or more characters.')).toBeVisible();
    await pass.fill(password);
    // Typed twice: a mistyped second one is refused, and nothing is saved.
    await field(page, 'Confirm password').fill(`${password}x`);
    await expect(text(page, 'Passwords do not match.')).toBeVisible();
    await primary(page).click();
    await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText('Passwords do not match.');
    expect(await signsIn(who.email, who.password)).toBe(true);
    await field(page, 'Confirm password').fill(password);
    await primary(page).click();
    await expect(toast(page)).toContainText(`Saved. You sign in with ${who.email} and this password.`, { timeout: 30_000 });
    await expect(heading(page, 'Me')).toBeVisible();
    expect(await signsIn(who.email, password)).toBe(true);
    expect(await signsIn(who.email, who.password)).toBe(false);
  } finally {
    await deleteWith(who, who.email, password);
  }
});
