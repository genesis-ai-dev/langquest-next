// 01 Getting in (docs/ui-test-suite/01-getting-in.md), on the web at phone
// width: Sign In, the terms, Explore, Create Account, invites and helpers'
// sign-in codes. The welcome tests (AUTH-056 to 059) need accounts never
// welcomed, so they are in 01-getting-in-welcome.spec.ts.
//
// Invites and sign-in codes are issued through the server as the app issues
// them (auth-helpers.ts). Where a test would change a fixture account for the
// tests after it, it uses another account of the same kind, or a fresh
// account with no organization, and says so.
import type { Browser, Page } from '@playwright/test';
import type { EventSpec } from '@langquest-next/core';
import { randomUUID } from 'node:crypto';
import {
  anon, expireInvite, projectListing, unprojectListing, expireSignInCode, issueInvite, issueSignInCode, memberOf, newAccount, newAddress, openFresh, openNew, paste,
  quiet, randomHex, redeemAs, settled, signInLink, signInWithForm
} from './auth-helpers';
import { clientAs, send, signIn } from './fixture';
import { back, button, byId, expect, expectToast, field, openSignedOut, primary, screenText, tab, tabsShown, test, text, useWorld } from './support';

const world = useWorld();
test.beforeEach(async ({ context }) => { await quiet(context); });
// LANG-A is listed publicly (fixture); its row on Explore is the projection worker's.
test.beforeAll(async () => { await projectListing(world(), 'A'); });

/** Another phone-width browser, as a second device. */
async function newDevice(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await quiet(context);
  return context;
}

const SIGN_IN = 'Sign In';
/** The web app's address in this run (links are made from it, as the app makes them from its own). */
const base = () => 'http://localhost:' + (process.env['UI_PORT'] ?? '8097');
const PASTE = 'Or paste the code or link';

async function onSignIn(page: Page) {
  await expect(page.getByLabel('Email or sign-in name', { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
}

async function openScan(page: Page) {
  await button(page, 'Scan a code').click();
  await expect(text(page, 'Scan a code')).toBeVisible();
}

const HOME_TABS: Record<string, string[]> = {
  ADMIN: ['work', 'map', 'manage', 'me'], COORD: ['work', 'map', 'manage', 'me'], LADMIN: ['work', 'map', 'manage', 'me'],
  TRANS: ['work', 'map', 'me'], REV: ['work', 'map', 'me'], TREV: ['work', 'map', 'me'], VIEW: ['map', 'inbox', 'me']
};

async function expectTabs(page: Page, tabs: string[]) {
  await expect(tab(page, tabs[0] as 'work')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => tabsShown(page)).toEqual(tabs);
}

/**
 * Signed in as KEPT by a code: their home, or the welcome first. A returning
 * account on a new device can see the welcome again (App.tsx asks the server
 * whether it was welcomed after it has already routed; AUTH-058), which is
 * not what these tests are about.
 */
async function signedInAsKept(page: Page) {
  await expect(tab(page, 'work').or(text(page, 'Welcome, Kept'))).toBeVisible({ timeout: 60_000 });
  expect(await screenText(page)).toContain(world().orgName);
}

/** Only this world's public languages, so "LANG-A's card" is this world's Alpha whatever else is listed. */
async function onlyThisWorld(page: Page) {
  // Asked of the server itself (the list stops at 100, and every world lists an "Alpha").
  await page.route('**/rest/v1/public_languages*', (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('org_id', `in.(${world().orgId},${world().org2Id})`);
    return route.continue({ url: url.toString() });
  });
}

/** Me → Switch Organization: on Me itself for someone in several organizations (decision 71, amended 2026-10-14). */
async function openSwitchOrganization(page: Page) {
  await tab(page, 'me').click();
  await text(page, 'Switch Organization').click();
}

async function signOutFromMe(page: Page) {
  await tab(page, 'me').click();
  await button(page, /^Sign out/).click();
  await button(page, 'Sign Out').click();
  await onSignIn(page);
}

// ---- Sign in ---------------------------------------------------------------------------

test('AUTH-001 The Sign In screen offers two ways in', async ({ page }) => {
  await openSignedOut(page);
  await expect(page.getByRole('button', { name: 'Language: English. Change it', exact: true })).toBeVisible();
  await expect(text(page, 'LangQuest')).toBeVisible();
  // The fields keep their names once typing starts (UI audit, finding 35).
  await expect(text(page, 'Email or sign-in name')).toBeVisible();
  await expect(field(page, 'Email or sign-in name')).toBeVisible();
  const password = field(page, 'Password');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(button(page, SIGN_IN)).toBeDisabled();
  await expect(page.getByRole('link', { name: /By signing in you accept the Terms of Use and Privacy Policy/ })).toBeVisible();
  await expect(text(page, 'or')).toBeVisible();
  await expect(button(page, 'Scan a code')).toBeVisible();
  await expect(text(page, "Don't have an account?")).toBeVisible();
  await expect(button(page, 'Create Account')).toBeVisible();
  await expect(button(page, 'Browse public work')).toBeVisible();
  await expect(text(page, 'Sign in to join')).toBeHidden();
  // The order: the fields, then "or", then the code, then the other ways in.
  const body = await screenText(page);
  const at = (s: string) => body.indexOf(s);
  expect(at('Sign In')).toBeLessThan(at('Scan a code'));
  expect(at('Scan a code')).toBeLessThan(at("Don't have an account?"));
  expect(at("Don't have an account?")).toBeLessThan(at('Browse public work'));
  // "Switch persona" is a dev-build affordance; this run is a dev build, so it is not checked here (AUTH-010).
  expect(await tabsShown(page)).toEqual([]);
  // A name with a space cannot be a sign-in name: the button stays off, and the screen says why.
  await field(page, 'Email or sign-in name').fill('Nyibol Deng');
  await field(page, 'Password').fill('whatever1');
  await expect(button(page, SIGN_IN)).toBeDisabled();
  await expect(text(page, 'A sign-in name has no spaces: letters, digits and dashes, like nyibol-deng-482.')).toBeVisible();
  await field(page, 'Email or sign-in name').fill('nyibol-deng-482');
  await expect(text(page, 'A sign-in name has no spaces: letters, digits and dashes, like nyibol-deng-482.')).toBeHidden();
  await expect(button(page, SIGN_IN)).toBeEnabled();
});

test('AUTH-001 On a short phone, Scan a code and Create Account are on screen', async ({ page }) => {
  // 360×800, the size most low-end Android phones have (UI audit, finding 27).
  await page.setViewportSize({ width: 360, height: 800 });
  await openSignedOut(page);
  await expect(button(page, 'Scan a code')).toBeInViewport({ ratio: 1 });
  await expect(button(page, 'Create Account')).toBeInViewport({ ratio: 1 });
});

for (const key of ['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'REV', 'TREV', 'VIEW'] as const) {
  test(`AUTH-002 ${key} Sign in with email and password @p0`, async ({ browser }) => {
    const context = await newDevice(browser);
    const page = await context.newPage();
    try {
      await openSignedOut(page);
      // Hold the answer a moment, so the busy label can be seen.
      await page.route('**/auth/v1/token*', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
      const who = world().accounts[key];
      await signInWithForm(page, who.email, who.password!);
      await expect(button(page, 'Signing in…'), key).toBeDisabled();
      // ADMIN is also a Translator in UI Second Org: a new device opens the first of its organizations by name.
      const inOrg2 = key === 'ADMIN' && await expect.poll(() => screenText(page), { timeout: 60_000 }).toMatch(/UI (Test|Second) Org/)
        .then(async () => (await screenText(page)).includes(world().org2Name));
      await test.step(`${key} lands home`, () => expectTabs(page, inOrg2 ? HOME_TABS['TRANS']! : HOME_TABS[key]!));
      await expect(text(page, `Welcome, ${who.name.split(' ')[0]}`), `${key}: no welcome`).toBeHidden();
      if (key === 'VIEW') await expect(tab(page, 'map')).toHaveAttribute('aria-selected', 'true').catch(() => undefined);
      else await expect(text(page, 'My Work'), `${key}: My Work`).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test('AUTH-004 A looked-after account signs in by its sign-in name', async ({ page }) => {
  // KEPT sets a password for a shared phone, as Edit Profile does (supabase.auth.updateUser).
  const { sb } = await signIn(world(), 'KEPT');
  const password = randomHex(6);
  const set = await sb.auth.updateUser({ password, data: { has_password: true } });
  expect(set.error).toBeNull();
  await openSignedOut(page);
  const handle = world().accounts.KEPT.signInName!;
  expect(handle).not.toContain('@');
  await signInWithForm(page, handle, password);
  await expectTabs(page, ['work', 'map', 'me']);
});

test('AUTH-005 Wrong password or unknown account', async ({ page }) => {
  await openSignedOut(page);
  const tries: [string, string][] = [
    [world().accounts.TRANS.email, 'not-the-password'],
    ['nobody-here@example.org', 'whatever1'],
    ['nobody-999', 'whatever1']
  ];
  const stuck = button(page, 'Write to admin@frontierrnd.com');
  for (const [i, [who, pw]] of tries.entries()) {
    await signInWithForm(page, who, pw);
    const alert = page.getByRole('alert').locator('visible=true').first();
    await expect(alert).toHaveText('Wrong email, sign-in name or password.');
    await expect(field(page, 'Email or sign-in name')).toHaveValue(who);
    await expect(field(page, 'Password')).toHaveValue(pw);
    await expect(button(page, SIGN_IN)).toBeVisible();
    // A second refusal opens "Can't sign in?" by itself: the ways in that need no password (UI audit, finding 30).
    if (i === 0) await expect(stuck).toBeHidden();
    else await expect(stuck).toBeVisible();
  }
  await expect(text(page, 'Ask someone on your team to show you a sign-in code, then tap Scan a code.')).toBeVisible();
  await button(page, "Can't sign in?").click();
  await expect(stuck).toBeHidden();
});

test('AUTH-008 Signing in with no connection', async ({ page, context }) => {
  await openSignedOut(page);
  const who = world().accounts.TRANS;
  await settled(page);
  await context.setOffline(true);
  await signInWithForm(page, who.email, who.password!);
  await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText('Not connected. Try again when you are online.', { timeout: 60_000 });
  await expect(button(page, SIGN_IN)).toBeEnabled();
  await context.setOffline(false);
  await button(page, SIGN_IN).click();
  // Signed in: My Work, or first the welcome again (the race AUTH-058 is about, not this test's point).
  await expect(tab(page, 'work').or(text(page, 'Welcome, Tom'))).toBeVisible({ timeout: 60_000 });
});

// ---- Terms & Privacy -------------------------------------------------------------------

test('AUTH-011 The terms are one tap from Sign In', async ({ page }) => {
  await openSignedOut(page);
  await field(page, 'Email or sign-in name').fill('someone@example.org');
  await page.getByRole('link', { name: /By signing in you accept/ }).click();
  await expect(text(page, 'Terms & Privacy')).toBeVisible();
  const body = await screenText(page);
  const order = ['Terms of Use', 'Not allowed', 'Reporting and blocking', 'Privacy Policy'].map((h) => body.indexOf(h));
  expect(order.every((x) => x >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(body).toContain('Updated 2026-09-30');
  expect(body).toContain('You must be 18 or older.');
  expect(body).toContain('Do not record, write or share:');
  const rules = await page.getByText(/^(Hate:|Harassment|Sexual|Content that encourages|Anything illegal|Someone else's private|Pretending|Spam|Trying to break into LangQuest)/)
    .locator('visible=true').allInnerTexts();
  expect(rules).toHaveLength(9);
  expect(rules[0]).toMatch(/^Hate:/);
  expect(rules[8]).toMatch(/^Trying to break into LangQuest/);
  expect(body).toContain('We act on them within 24 hours.');
  expect(body).toContain('admin@frontierrnd.com');
  await expect(button(page, 'Read the full privacy policy')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(button(page, /^Accept/)).toHaveCount(0);
  await back(page).click();
  await expect(field(page, 'Email or sign-in name')).toHaveValue('someone@example.org');
});

test('AUTH-012 The full privacy policy opens outside the app', async ({ page, context }) => {
  await context.route('https://next.langquest.org/**', (route) => route.fulfill({ body: 'privacy', contentType: 'text/plain' }));
  await openSignedOut(page);
  await page.getByRole('link', { name: /By signing in you accept/ }).click();
  const [policy] = await Promise.all([context.waitForEvent('page'), button(page, 'Read the full privacy policy').click()]);
  expect(policy.url()).toBe('https://next.langquest.org/privacy');
  await expect(text(page, 'Terms & Privacy')).toBeVisible();
});

test('AUTH-013 The terms line on Create Account and the scan screen', async ({ page }) => {
  const invite = await issueInvite(world(), base());
  await openSignedOut(page);
  await button(page, 'Create Account').click();
  await page.getByRole('link', { name: /Creating an account accepts the Terms of Use and Privacy Policy/ }).click();
  await expect(text(page, 'Terms & Privacy')).toBeVisible();
  await back(page).click();
  await expect(field(page, 'Confirm password')).toBeVisible();
  await back(page).click();
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await expect(text(page, 'Invite for Test Person')).toBeVisible();
  const joining = page.getByRole('link', { name: /Joining accepts the Terms of Use and Privacy Policy/ });
  await expect(joining).toBeVisible();
  await joining.click();
  await expect(text(page, 'Terms & Privacy')).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Invite for Test Person')).toBeVisible();
});

// ---- Browse public work ----------------------------------------------------------------

test('AUTH-014 A guest browses public work', async ({ page }) => {
  // An organization under an open licence lists a language too: ORG2 (CC BY 4.0) lists Charlie.
  const { sb } = await signIn(world(), 'OWNER2');
  const listed = await sb.rpc('set_language_visibility', { p_org: world().org2Id, p_language: world().languages.C.languageId, p_listed: true });
  expect(listed.error).toBeNull();
  await projectListing(world(), 'C');
  // Everything listed is in name order.
  await openSignedOut(page);
  await button(page, 'Browse public work').click();
  await expect(text(page, 'Explore')).toBeVisible();
  await expect(text(page, 'Listed publicly')).toBeVisible({ timeout: 30_000 });
  const names = await page.locator('[aria-label$="%"]').locator('visible=true').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/, [^,]*$/, '')));
  expect(names.length).toBeGreaterThan(0);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  // This world's cards.
  await back(page).click();
  await onlyThisWorld(page);
  await button(page, 'Browse public work').click();
  await expect(button(page, SIGN_IN)).toBeVisible();
  await expect(back(page)).toBeVisible();
  const alpha = page.getByRole('button', { name: /^Alpha, \d+%$/ }).locator('visible=true').first();
  await expect(alpha).toBeVisible({ timeout: 30_000 });
  await expect(alpha).toContainText('Alpha');
  await expect(alpha).toContainText('All rights reserved · Only your organization');
  await expect(alpha).toContainText('Recorded');
  await expect(alpha).toContainText(/\d+%/);
  const charlie = page.getByRole('button', { name: /^Charlie, \d+%$/ }).locator('visible=true').first();
  await expect(charlie).toContainText('CC BY 4.0 · Any use, with credit');
  const tone = (card: typeof alpha, label: string) => card.getByText(label, { exact: true }).evaluate((e) => getComputedStyle(e.parentElement!).backgroundColor);
  expect(await tone(charlie, 'CC BY 4.0 · Any use, with credit')).not.toEqual(await tone(alpha, 'All rights reserved · Only your organization'));
  await sb.rpc('set_language_visibility', { p_org: world().org2Id, p_language: world().languages.C.languageId, p_listed: false });
  await unprojectListing(world(), 'C');
});

test('AUTH-015 From Explore a guest is sent to sign in', async ({ page }) => {
  await onlyThisWorld(page);
  await openSignedOut(page);
  await button(page, 'Browse public work').click();
  await page.getByRole('button', { name: /^Alpha, \d+%$/ }).locator('visible=true').first().click();
  await onSignIn(page);
  await button(page, 'Browse public work').click();
  await button(page, SIGN_IN).click();
  await onSignIn(page);
  await button(page, 'Browse public work').click();
  await back(page).click();
  await onSignIn(page);
  const body = await screenText(page);
  expect(body).not.toContain(world().passages['P-NEW'].label);
});

test('AUTH-016 Explore offline shows what this device saved', async ({ page, context }) => {
  await onlyThisWorld(page);
  await openSignedOut(page);
  await button(page, 'Browse public work').click();
  await expect(page.getByRole('button', { name: /^Alpha, \d+%$/ }).first()).toBeVisible({ timeout: 30_000 });
  await back(page).click();
  await settled(page);
  await context.setOffline(true);
  await button(page, 'Browse public work').click();
  await expect(page.getByRole('button', { name: /^Alpha, \d+%$/ }).first()).toBeVisible();
  await expect(text(page, 'Unable to refresh. Showing what was saved on this device.')).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);
  await back(page).click();
  await button(page, 'Browse public work').click();
  await expect(page.getByRole('button', { name: /^Alpha, \d+%$/ }).first()).toBeVisible();
  await expect(text(page, 'Unable to refresh. Showing what was saved on this device.')).toBeHidden({ timeout: 30_000 });
});

test('AUTH-017 Nothing listed yet', async ({ page }) => {
  // A server where nothing is listed: its answer, empty (the shared local server always has listings).
  await page.route('**/rest/v1/public_languages*', (route) => route.fulfill({ json: [] }));
  await openSignedOut(page);
  await button(page, 'Browse public work').click();
  await expect(text(page, 'Nothing listed yet')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'Organizations appear here when they list their work publicly.')).toBeVisible();
  await expect(text(page, 'Listed publicly')).toBeHidden();
});

test('AUTH-018 Explore shows 25 at a time', async ({ page }) => {
  // 30 listed: the server's own rows, padded with rows like them when fewer are listed (seeded for this test).
  await page.route('**/rest/v1/public_languages*', async (route) => {
    const res = await route.fetch();
    const rows = (await res.json()) as Record<string, unknown>[];
    const like = rows[0]!;
    const padded = [...rows];
    for (let i = padded.length; i < 30; i++) padded.push({ ...like, language_id: `pad-${i}`, name: `Zz Listed ${String(i).padStart(2, '0')}` });
    await route.fulfill({ response: res, json: padded.slice(0, Math.max(30, Math.min(rows.length, 100))) });
  });
  await openSignedOut(page);
  await button(page, 'Browse public work').click();
  const cards = page.locator('[aria-label$="%"]').locator('visible=true');
  await expect(cards).toHaveCount(25, { timeout: 30_000 });
  const more = page.getByRole('button', { name: /^Show \d+ more · \d+ left$/ });
  await expect(more).toBeVisible();
  const label = (await more.innerText()).trim();
  const [, shown, left] = /^Show (\d+) more · (\d+) left$/.exec(label)!;
  expect(Number(shown)).toBe(Math.min(25, Number(left)));
  await more.click();
  await expect(cards).toHaveCount(25 + Number(shown));
  if (Number(left) <= 25) await expect(more).toBeHidden();
});

// ---- Create account --------------------------------------------------------------------

test('AUTH-019 Create an account with an email @p0', async ({ page }) => {
  await openSignedOut(page);
  await button(page, 'Create Account').click();
  await expect(page.getByPlaceholder('you@example.com', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Choose a password (6 or more characters)', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Re-enter password', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Creating an account accepts the Terms of Use and Privacy Policy/ })).toBeVisible();
  // Nothing typed: not yet (the rule is createAccountReady's, test/authModel.test.ts).
  await expect(button(page, 'Create Account')).toBeDisabled();
  // A short password says why it is not enough.
  await field(page, 'Password').fill('abc12');
  await expect(text(page, /6 or more characters/)).toBeVisible();
  await expect(button(page, 'Scan an invite')).toBeVisible();
  await expect(text(page, 'No email or password needed. The invite makes your account and puts you on the team.')).toBeVisible();
  await field(page, 'Email').fill(newAddress(world()));
  await field(page, 'Password').fill('secret12');
  await field(page, 'Confirm password').fill('secret12');
  await page.route('**/auth/v1/signup*', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  await button(page, 'Create Account').click();
  await expect(button(page, 'Creating…')).toBeVisible();
  await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(page)).toEqual([]);
  await expect(text(page, /^Welcome, /)).toBeHidden();
});

test('AUTH-021 Passwords that do not match', async ({ page }) => {
  await openSignedOut(page);
  await button(page, 'Create Account').click();
  await field(page, 'Email').fill('someone@example.org');
  await field(page, 'Password').fill('secret12');
  await field(page, 'Confirm password').fill('secret13');
  await expect(text(page, 'Passwords do not match.')).toBeVisible();
  await expect(button(page, 'Create Account')).toBeDisabled();
  await field(page, 'Confirm password').fill('secret12');
  await expect(text(page, 'Passwords do not match.')).toBeHidden();
  await expect(button(page, 'Create Account')).toBeEnabled();
});

test('AUTH-022 An email that already has an account', async ({ page }) => {
  const trans = world().accounts.TRANS;
  await openSignedOut(page);
  await button(page, 'Create Account').click();
  await field(page, 'Email').fill(trans.email);
  await field(page, 'Password').fill('newpass12');
  await field(page, 'Confirm password').fill('newpass12');
  await button(page, 'Create Account').click();
  await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText('There is already an account with this email. Sign in instead.');
  // TRANS's password is unchanged.
  const { error } = await anon().auth.signInWithPassword({ email: trans.email, password: trans.password! });
  expect(error).toBeNull();
});

test('AUTH-024 Creating an account with no connection', async ({ page, context }) => {
  await openSignedOut(page);
  await button(page, 'Create Account').click();
  const email = newAddress(world());
  await field(page, 'Email').fill(email);
  await field(page, 'Password').fill('secret12');
  await field(page, 'Confirm password').fill('secret12');
  await settled(page);
  await context.setOffline(true);
  await button(page, 'Create Account').click();
  await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText('Not connected. Try again when you are online.', { timeout: 60_000 });
  await expect(field(page, 'Email')).toHaveValue(email);
  await context.setOffline(false);
  await button(page, 'Create Account').click();
  await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });
});

// ---- Invites ---------------------------------------------------------------------------

async function expectWelcome(page: Page, lines: { invitedBy?: string; first: string; sentence: string; nothingToRemember: boolean }) {
  // The sentence first: "Welcome, {first}" is also Join your team's greeting.
  await expect.poll(() => screenText(page), { timeout: 60_000 }).toContain(lines.sentence);
  await expect(text(page, `Welcome, ${lines.first}`)).toBeVisible();
  if (lines.invitedBy) await expect(text(page, `${lines.invitedBy} invited you`)).toBeVisible();
  await expect.poll(() => screenText(page)).toContain(lines.sentence);
  if (lines.nothingToRemember) await expect(text(page, 'Nothing to remember')).toBeVisible();
  else await expect(text(page, 'Nothing to remember')).toBeHidden();
  expect(await tabsShown(page)).toEqual([]);
}

test('AUTH-026 A new person joins by pasting a one-person invite @p0', async ({ page }) => {
  const invite = await issueInvite(world(), base());
  const coord = world().accounts.COORD.name;
  await openSignedOut(page);
  await openScan(page);
  await expect(text(page, 'Tap Scan to use the camera')).toBeVisible();
  await expect(button(page, 'Scan QR code')).toBeVisible();
  await paste(page, PASTE, invite.link);
  await expect(text(page, 'Invite for Test Person')).toBeVisible();
  await expect(field(page, PASTE)).toHaveValue('');
  await expect(button(page, 'Scan a different code')).toBeVisible();
  await expect(text(page, `Translator · Alpha · ${world().orgName}`)).toBeVisible();
  await expect(text(page, `From ${coord}`)).toBeVisible();
  await button(page, 'Join as Test').click();
  await expectWelcome(page, { invitedBy: coord, first: 'Test', sentence: `You're a Translator on the Alpha team at ${world().orgName}.`, nothingToRemember: true });
  await expect(text(page, `This device keeps you signed in. On a new device, ask ${coord} to help you sign in.`)).toBeVisible();
  await expect(text(page, 'Record passages in your language.')).toBeVisible();
  await button(page, 'Get started').click();
  await expectTabs(page, ['work', 'map', 'me']);
  await tab(page, 'me').click();
  await text(page, 'More settings').click();
  await expect(text(page, 'No email yet')).toBeVisible();
  expect(await screenText(page)).not.toMatch(/@people\.langquest\.org/);
});

test('AUTH-027 A bare invite code can be typed or pasted', async ({ page }) => {
  const invite = await issueInvite(world(), base());
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.token);
  await expect(text(page, 'Invite for Test Person')).toBeVisible();
  await expect(text(page, `Translator · Alpha · ${world().orgName}`)).toBeVisible();
  await expect(button(page, 'Join as Test')).toBeVisible();
});

test('AUTH-028 A group invite asks for the person\'s name @p0', async ({ page, browser }) => {
  const invite = await issueInvite(world(), base(), { label: 'UI Test workshop', maxUses: 10 });
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await expect(text(page, 'UI Test workshop')).toBeVisible();
  await expect(text(page, /^Invite for /)).toBeHidden();
  await expect(button(page, 'Join as Test')).toHaveCount(0);
  await primary(page).click();
  await expect(text(page, 'Join with your invite')).toBeVisible();
  await expect(text(page, 'No email or password needed. Your team sees you by this name.')).toBeVisible();
  await expect(field(page, 'Your name')).toHaveValue('');
  await expect(button(page, 'Join')).toBeDisabled();
  await expect(page.getByRole('link', { name: /Joining accepts the Terms of Use and Privacy Policy/ })).toBeVisible();
  await field(page, 'Your name').fill('Ana Workshop');
  await page.route('**/functions/v1/join', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  await button(page, 'Join').click();
  await expect(button(page, 'Joining…')).toBeVisible();
  await expectWelcome(page, { invitedBy: world().accounts.COORD.name, first: 'Ana', sentence: `You're a Translator on the Alpha team at ${world().orgName}.`, nothingToRemember: true });
  // A second person, on another fresh device, with the same link.
  const context = await newDevice(browser);
  const second = await context.newPage();
  try {
    await openSignedOut(second);
    await openScan(second);
    await paste(second, PASTE, invite.link);
    await primary(second).click();
    await field(second, 'Your name').fill('Ben Workshop');
    await button(second, 'Join').click();
    await expect(text(second, 'Welcome, Ben')).toBeVisible({ timeout: 60_000 });
  } finally {
    await context.close();
  }
});

test('AUTH-029 The name screen needs a name', async ({ page }) => {
  const invite = await issueInvite(world(), base(), { label: 'UI Test workshop', maxUses: 10 });
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await primary(page).click();
  await field(page, 'Your name').fill('   ');
  await expect(button(page, 'Join')).toBeDisabled();
  await back(page).click();
  await expect(text(page, 'UI Test workshop')).toBeVisible();
});

// AUTH-030 to 032 join an organization the account is not in. The automation
// uses UI Second Org, from its owner, instead of an "UI Admin Org" made by
// NOORG-013, and a different account for each, so one test's join does not
// make the next one's account a member already.

test('AUTH-030 "I already have an account" joins after signing in', async ({ page }) => {
  const invite = await issueInvite(world(), base(), { issuer: 'OWNER2', org: 'org2', label: 'Translator Two' });
  const trans = world().accounts.TRANS;
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await button(page, 'I already have an account').click();
  await expect(text(page, 'Sign in to join')).toBeVisible();
  await expect(text(page, "Your invite is saved. You'll join as soon as you sign in.")).toBeVisible();
  await signInWithForm(page, trans.email, trans.password!);
  await expectWelcome(page, { invitedBy: world().accounts.OWNER2.name, first: 'Tom', sentence: `You're a Translator on ${world().org2Name}.`, nothingToRemember: false });
  await button(page, 'Get started').click();
  await expectTabs(page, ['work', 'map', 'me']);
  await openSwitchOrganization(page);
  await expect(text(page, world().orgName, false)).toBeVisible();
  await expect(text(page, world().org2Name, false)).toBeVisible();
  expect(await memberOf((await signIn(world(), 'TRANS')).sb)).toContain(world().org2Id);
});

test('AUTH-031 A held invite survives a restart', async ({ page, context }) => {
  const invite = await issueInvite(world(), base(), { issuer: 'OWNER2', org: 'org2', label: 'Translator Two' });
  const rev = world().accounts.REV;
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await button(page, 'I already have an account').click();
  await expect(text(page, 'Sign in to join')).toBeVisible();
  // Close the tab and open the app again.
  await page.close();
  const again = await context.newPage();
  await openSignedOut(again);
  await expect(text(again, 'Sign in to join')).toBeVisible();
  await signInWithForm(again, rev.email, rev.password!);
  await expectWelcome(again, { invitedBy: world().accounts.OWNER2.name, first: 'Rita', sentence: `You're a Translator on ${world().org2Name}.`, nothingToRemember: false });
});

test('AUTH-032 An invite nobody claimed is offered after signing in', async ({ page }) => {
  const invite = await issueInvite(world(), base(), { issuer: 'OWNER2', org: 'org2', label: 'Translator Two' });
  const trev = world().accounts.TREV;
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await back(page).click();
  await onSignIn(page);
  await expect(text(page, 'Sign in to join')).toBeHidden();
  await signInWithForm(page, trev.email, trev.password!);
  await expect(text(page, 'Invite includes organization, role, and scope')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'Invite for Translator Two')).toBeVisible();
  await expect(button(page, `Join as ${trev.name}`)).toBeVisible();
  await expect(button(page, `Not ${trev.name}? Sign out first`)).toBeVisible();
  await expect(button(page, 'Not now')).toBeVisible();
  await page.waitForTimeout(2000); // sleep: proves a negative (not joined yet); nothing on the device changes when it does not happen
  expect(await memberOf((await signIn(world(), 'TREV')).sb)).not.toContain(world().org2Id);
  await button(page, 'Not now').click();
  await expectTabs(page, ['work', 'map', 'me']);
  await signOutFromMe(page);
  await signInWithForm(page, trev.email, trev.password!);
  await expectTabs(page, ['work', 'map', 'me']);
  await expect(text(page, 'Invite for Translator Two')).toBeHidden();
  expect(await memberOf((await signIn(world(), 'TREV')).sb)).not.toContain(world().org2Id);
});

test('AUTH-033 A signed-in member joins with "Join as"', async ({ page }) => {
  // A fresh account with no organization stands in for NOORG, so NOORG stays without one.
  const nora = await newAccount(world(), 'Nadia Fresh');
  const invite = await issueInvite(world(), base());
  await openNew(page, world(), nora);
  await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });
  await text(page, 'Scan their code').click();
  await paste(page, PASTE, invite.link);
  await expect(text(page, 'Invite includes organization, role, and scope')).toBeVisible();
  await expect(button(page, 'Join as Nadia Fresh')).toBeVisible();
  await expect(button(page, 'Not Nadia Fresh? Sign out first')).toBeVisible();
  await expect(button(page, 'Not now')).toBeVisible();
  await expect(page.getByRole('link', { name: /Joining accepts/ })).toHaveCount(0);
  await button(page, 'Join as Nadia Fresh').click();
  await expectWelcome(page, { first: 'Nadia', sentence: `You're a Translator on the Alpha team at ${world().orgName}.`, nothingToRemember: false });
});

test('AUTH-034 "Not {me}? Sign out first" keeps the invite for the next person', async ({ page }) => {
  const invite = await issueInvite(world(), base());
  await openFresh(page, world(), 'TRANS', { path: `/invite#org=${invite.orgId}&token=${invite.token}` });
  await expect(text(page, 'Invite for Test Person')).toBeVisible({ timeout: 60_000 });
  await button(page, 'Not Tom Translator? Sign out first').click();
  await expect(text(page, 'Sign out?')).toBeVisible();
  await expect(button(page, 'Sign Out')).toBeVisible();
  await expect(button(page, 'Cancel')).toBeVisible();
  await button(page, 'Sign Out').click();
  await onSignIn(page);
  await openScan(page);
  // The web forgets everything at sign-out, the held invite too (decision 11; decided 2026-10-13).
  // Phones keep it for the next person: the Maestro side of this test checks that.
  await expect(text(page, 'Scan a code')).toBeVisible();
  await expect(text(page, 'Invite for Test Person')).toHaveCount(0);
});

test('AUTH-035 An invite link opens the app, signed out', async ({ page }) => {
  const invite = await issueInvite(world(), base());
  await page.goto(`/invite#org=${invite.orgId}&token=${invite.token}`);
  await expect(text(page, 'Invite for Test Person')).toBeVisible({ timeout: 120_000 });
  await expect(text(page, 'Scan a code')).toBeVisible();
  await expect(text(page, 'Code read')).toBeVisible();
  expect(page.url()).not.toContain(invite.token);
  await back(page).click();
  await onSignIn(page);
  await openScan(page);
  await expect(text(page, 'Invite for Test Person')).toBeVisible();
  await page.reload();
  expect(page.url()).not.toContain(invite.token);
  await onSignIn(page);
  await openScan(page);
  await expect(text(page, 'Invite for Test Person')).toBeVisible();
});

test('AUTH-036 An invite link opens the app, signed in', async ({ page }) => {
  const invite = await issueInvite(world(), base());
  await openFresh(page, world(), 'NOORG', { path: `/invite#org=${invite.orgId}&token=${invite.token}` });
  await expect(text(page, 'Invite for Test Person')).toBeVisible({ timeout: 60_000 });
  await expect(button(page, `Join as ${world().accounts.NOORG.name}`)).toBeVisible();
  await page.waitForTimeout(2000); // sleep: proves a negative (not joined yet); nothing on the device changes when it does not happen
  expect(await memberOf((await signIn(world(), 'NOORG')).sb)).toEqual([]);
});

test('AUTH-037 Joining with no connection waits, then joins', async ({ page, context }) => {
  const fresh = await newAccount(world(), 'Omar Offline');
  const invite = await issueInvite(world(), base());
  await openNew(page, world(), fresh);
  await expect(text(page, 'Welcome, Omar')).toBeVisible({ timeout: 60_000 });
  await settled(page);
  await context.setOffline(true);
  await text(page, 'Scan their code').click();
  await paste(page, PASTE, invite.link);
  await expect(text(page, 'Invitation to join an organization')).toBeVisible();
  await expect(text(page, "Your role shows once you're connected.")).toBeVisible();
  expect(await screenText(page)).not.toContain('Translator ·');
  await button(page, 'Join as Omar Offline').click();
  await expect(text(page, 'Saved on this device')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, "You'll join as soon as there's a connection. You can leave this screen.")).toBeVisible();
  await expect(primary(page)).toBeDisabled();
  await back(page).click();
  await expect(text(page, 'Your invite is saved')).toBeVisible();
  await expect(text(page, "You'll join as soon as there's a connection.")).toBeVisible();
  // Step 5 (restarting offline) needs a phone: a browser cannot load the app with no connection.
  await context.setOffline(false);
  // Tried again within 30 seconds of the connection coming back.
  await expect.poll(() => screenText(page), { timeout: 45_000 }).toContain(`You're a Translator on the Alpha team at ${world().orgName}.`);
  await expect(text(page, 'Welcome, Omar')).toBeVisible();
  expect(await tabsShown(page)).toEqual([]);
});

test('AUTH-038 A new person offline is told joining needs a connection', async ({ page, context }) => {
  const invite = await issueInvite(world(), base());
  await openSignedOut(page);
  await settled(page);
  await context.setOffline(true);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await expect(text(page, 'Invitation to join an organization')).toBeVisible();
  await expect(text(page, "Your role shows once you're connected.")).toBeVisible();
  await expect(text(page, 'Joining needs a connection. Your invite is saved on this device.')).toBeVisible({ timeout: 30_000 });
  // The button says it waits, and stays off: no name is taken only to be refused (UI audit, finding 28).
  await expect(primary(page)).toHaveAccessibleName('Join when connected');
  await expect(primary(page)).toBeDisabled();
  // With a connection again, the preview is asked for by itself and the button comes on.
  await context.setOffline(false);
  await expect(text(page, 'Invite for Test Person')).toBeVisible({ timeout: 60_000 });
  await button(page, 'Join as Test').click();
  await expect(text(page, 'Welcome, Test')).toBeVisible({ timeout: 60_000 });
});

test('AUTH-039 An expired invite', async ({ page }) => {
  const invite = await issueInvite(world(), base());
  await expireInvite(invite);
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await expect(text(page, "This invite can't be used")).toBeVisible();
  await expect(text(page, `This invite has expired. Ask ${world().accounts.COORD.name} for a new one.`)).toBeVisible();
  await expect(button(page, /^Join/)).toHaveCount(0);
  await expect(button(page, 'I already have an account')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Joining accepts/ })).toHaveCount(0);
  await button(page, 'Clear this invite').click();
  await expect(text(page, "This invite can't be used")).toBeHidden();
  await expect(text(page, 'Invite for Test Person')).toBeHidden();
  await expect(text(page, 'Tap Scan to use the camera')).toBeVisible();
});

test('AUTH-040 An invite already used by someone else', async ({ page }) => {
  const invite = await issueInvite(world(), base());
  const other = await newAccount(world(), 'Someone Else');
  await redeemAs(other.sb, invite.token);
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await expect(text(page, "This invite can't be used")).toBeVisible();
  await expect(text(page, `This invite has already been used. Ask ${world().accounts.COORD.name} for a new one.`)).toBeVisible();
  await expect(button(page, 'Clear this invite')).toBeVisible();
  await expect(button(page, /^Join/)).toHaveCount(0);
});

test('AUTH-042 An invite whose role was retired', async ({ page }) => {
  // ADMIN makes "Temp Role", invites someone to it, then retires it.
  const roleId = `role-${randomUUID()}`;
  const org = await clientAs(world(), 'ADMIN', 'org');
  await org.appendMany([{ id: randomUUID(), type: 'v1.RoleDefined', payload: { roleId, name: 'Temp Role', privileges: ['view_status'] } }] as EventSpec[] as never);
  await send(org as never, 'Temp Role');
  const invite = await issueInvite(world(), base(), { issuer: 'ADMIN', roleId, scope: { level: 'org' } });
  await org.appendMany([{ id: randomUUID(), type: 'v1.RoleRetired', payload: { roleId } }] as EventSpec[] as never);
  await send(org as never, 'retire Temp Role');
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await expect(text(page, "This invite can't be used")).toBeVisible();
  await expect(text(page, `This invite can no longer be used. Ask ${world().accounts.ADMIN.name} for a new one.`)).toBeVisible();
});

test('AUTH-043 An invite that dies before it is used', async ({ page, browser }) => {
  // NOORG: a fresh account with no organization, so the world's NOORG stays as it is.
  const nobody = await newAccount(world(), 'Nell Noorg');
  const toOrg = await issueInvite(world(), base());
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, toOrg.link);
  await button(page, 'I already have an account').click();
  await redeemAs((await newAccount(world(), 'Quick Joiner')).sb, toOrg.token);
  await signInWithForm(page, nobody.email, nobody.password);
  await expect(text(page, "Your invite couldn't be used")).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'This invite has already been used. Ask for a new one.')).toBeVisible();
  expect(await memberOf(nobody.sb)).toEqual([]);
  // An account with a home: LADMIN (TRANS joined UI Second Org in AUTH-030), to UI Second Org.
  const toOrg2 = await issueInvite(world(), base(), { issuer: 'OWNER2', org: 'org2', label: 'Translator Two' });
  const context = await newDevice(browser);
  const second = await context.newPage();
  try {
    await openSignedOut(second);
    await openScan(second);
    await paste(second, PASTE, toOrg2.link);
    await button(second, 'I already have an account').click();
    await redeemAs((await newAccount(world(), 'Quicker Joiner')).sb, toOrg2.token);
    const ladmin = world().accounts.LADMIN;
    await signInWithForm(second, ladmin.email, ladmin.password!);
    await expectTabs(second, ['work', 'map', 'manage', 'me']);
    await expect(text(second, 'This invite has already been used. Ask for a new one.')).toBeVisible({ timeout: 30_000 });
    expect(await memberOf((await signIn(world(), 'LADMIN')).sb)).not.toContain(world().org2Id);
  } finally {
    await context.close();
  }
});

test('AUTH-044 Scanning a code already used by this account', async ({ page }) => {
  // On the device where they joined: a looked-after person joins with the link, then opens it again.
  const invite = await issueInvite(world(), base());
  await openSignedOut(page);
  await openScan(page);
  await paste(page, PASTE, invite.link);
  await button(page, 'Join as Test').click();
  await button(page, 'Get started').click({ timeout: 60_000 });
  await expectTabs(page, ['work', 'map', 'me']);
  await page.goto(`/invite#org=${invite.orgId}&token=${invite.token}`);
  await expect(text(page, "You're already in")).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'This invite was used by this account.')).toBeVisible();
  await expect(button(page, /^Join/)).toHaveCount(0);
  await button(page, 'Clear this invite').click();
  await expect(text(page, "You're already in")).toBeHidden();
  await expect(text(page, 'Invite for Test Person')).toBeHidden();
  await back(page).click();
  await expectTabs(page, ['work', 'map', 'me']);
});

test('AUTH-045 Text that is not a code', async ({ page }) => {
  await openSignedOut(page);
  await openScan(page);
  for (const value of ['hello world', 'https://example.org/invite#token=xyz']) {
    await paste(page, PASTE, value);
    await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText('This is not a LangQuest code.');
    await expect(text(page, /^Invit/)).toBeHidden();
    await paste(page, PASTE, '');
  }
});

// ---- Sign-in codes ---------------------------------------------------------------------

test('AUTH-049 A looked-after person signs in on a new device with a helper\'s code', async ({ page }) => {
  const code = await issueSignInCode(world());
  const coord = world().accounts.COORD.name;
  await page.goto(`/signin#code=${code}`);
  await expect(text(page, 'A code from someone helping you sign in')).toBeVisible({ timeout: 120_000 });
  await expect(text(page, 'Someone is helping you sign in')).toBeVisible();
  await expect(text(page, 'Nothing to type: this signs you in on this device, with all your work.')).toBeVisible();
  await expect(button(page, 'Sign in')).toBeVisible();
  await expect(button(page, 'Cancel')).toBeVisible();
  await expect(button(page, 'Scan QR code')).toHaveCount(0);
  await expect(text(page, /^Invit/)).toBeHidden();
  await page.route('**/functions/v1/sign-in-code', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  await button(page, 'Sign in').click();
  await expect(button(page, 'Signing in…')).toBeVisible();
  await expectTabs(page, ['work', 'map', 'me']);
  await expectToast(page, `Signed in with ${coord}'s help`);
  await tab(page, 'me').click();
  await text(page, 'More settings').click();
  await expect(text(page, new RegExp(`^Signed in on this device with ${coord}'s help · `))).toBeVisible();
});

test('AUTH-051 A signed-in person scans a sign-in code', async ({ page, browser }) => {
  const code = await issueSignInCode(world());
  await openFresh(page, world(), 'TRANS', { path: `/signin#code=${code}` });
  await expect(text(page, 'This is a sign-in code')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'It is for someone signed out. Sign out first, then scan it again.')).toBeVisible();
  await expect(button(page, 'Sign in')).toHaveCount(0);
  // The way out the banner asks for, on the same screen (UI audit, finding 34).
  await button(page, 'Not you? Sign out first').click();
  await expect(text(page, 'Sign out?')).toBeVisible({ timeout: 10_000 });
  await button(page, 'Cancel').click();
  await expect(text(page, 'This is a sign-in code')).toBeVisible();
  await button(page, 'Scan something else').click();
  await expect(button(page, 'Scan QR code')).toBeVisible();
  await expect(text(page, 'This is a sign-in code')).toBeHidden();
  // The code was not used: it still signs the person in on another device.
  const context = await newDevice(browser);
  const other = await context.newPage();
  try {
    await other.goto(signInLink(base(), code).replace(base(), ''));
    await button(other, 'Sign in').click({ timeout: 120_000 });
    await signedInAsKept(other);
  } finally {
    await context.close();
  }
  usedCode = code;
});

let usedCode = '';

test('AUTH-052 A sign-in code used twice, or after an hour', async ({ page }) => {
  expect(usedCode, 'AUTH-051 leaves a used code').not.toBe('');
  const expired = await issueSignInCode(world());
  await expireSignInCode(expired);
  for (const code of [usedCode, expired]) {
    await page.goto(`/signin#code=${code}`);
    await button(page, 'Sign in').click({ timeout: 120_000 });
    await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText('This code has expired or was already used. Ask for a new one.');
    await expect(button(page, 'Cancel')).toBeVisible();
    expect(await tabsShown(page)).toEqual([]);
  }
});

test('AUTH-053 A sign-in code that is not valid', async ({ page }) => {
  await page.goto(`/signin#code=${randomHex(32)}`);
  await button(page, 'Sign in').click({ timeout: 120_000 });
  await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText('This code has expired or was already used. Ask for a new one.');
  expect(await tabsShown(page)).toEqual([]);
});

test('AUTH-054 A sign-in code with no connection', async ({ page, context }) => {
  const code = await issueSignInCode(world());
  await page.goto(`/signin#code=${code}`);
  await expect(button(page, 'Sign in')).toBeVisible({ timeout: 120_000 });
  await settled(page);
  await context.setOffline(true);
  await button(page, 'Sign in').click();
  await expect(page.getByRole('alert').locator('visible=true').first()).toHaveText('Try again when connected.', { timeout: 60_000 });
  await context.setOffline(false);
  await button(page, 'Sign in').click();
  await signedInAsKept(page);
});

test('AUTH-055 Cancel on a sign-in code', async ({ page }) => {
  const code = await issueSignInCode(world());
  await page.goto(`/signin#code=${code}`);
  await expect(text(page, 'Someone is helping you sign in')).toBeVisible({ timeout: 120_000 });
  await button(page, 'Cancel').click();
  await expect(text(page, 'No email or password needed')).toBeVisible();
  await expect(button(page, 'Scan QR code')).toBeVisible();
  expect(await tabsShown(page)).toEqual([]);
  // The code still works.
  await page.goto(`/signin#code=${code}`);
  await button(page, 'Sign in').click({ timeout: 120_000 });
  await signedInAsKept(page);
});

// ---- How LangQuest works ---------------------------------------------------------------

test('AUTH-060 "How LangQuest works" from Me', async ({ page }) => {
  await openFresh(page, world(), 'TRANS');
  await tab(page, 'me').click();
  await text(page, 'How LangQuest works').click();
  await expect(text(page, 'What is LangQuest?')).toBeVisible();
  await expect(text(page, '1 of 3')).toBeVisible();
  await back(page).click();
  await expect(text(page, 'More settings')).toBeVisible();
  await text(page, 'How LangQuest works').click();
  await button(page, 'Next').click();
  await button(page, 'Next').click();
  await button(page, 'Done').click();
  await expect(text(page, 'More settings')).toBeVisible();
  await expect(byId(page, 'tab-me')).toBeVisible();
});
