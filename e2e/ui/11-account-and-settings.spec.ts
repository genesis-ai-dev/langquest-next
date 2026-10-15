// docs/ui-test-suite/11-account-and-settings.md (ACCT) on the web: Me, More
// settings, Edit Profile, Switch Organization, the app's language, help
// mode, signing out of a browser, and deleting an account. Phone-only tests
// are Maestro flows (apps/mobile/test/maestro/flows/ACCT-*.yaml); ACCT-021
// changes KEPT for good, so it has its own world
// (11-account-kept-password.spec.ts).
//
// Tests that change a name or sign out use their own session or put the
// name back, so the tests after them see the fixture as it was built.
import type { Browser, Page } from '@playwright/test';
import {
  addNoteUI, catalog, deleteNew, languageLoaded, openHistory, quietDevice, quietDevServer, toTabs, expectAccountSent, freshSession, newAccount, noteAs, openOnce, saveName, say, stateFor, type NewAccount
} from './account-helpers';
import {
  back, button, byId, deviceEvents, expect, expectSent, expectToast, field, openAs, openPassage, openSignedOut, primary, screenText, tab, tabsShown, test, text,
  useWorld, waitForApp, type AccountKey
} from './support';
import type { UiWorld } from './fixture';

const world = useWorld();
test.beforeEach(async ({ context }) => { await quietDevServer(context); });

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A row (a button) whose words start with `label`. */
const row = (page: Page, label: string) => button(page, new RegExp(`^${esc(label)}`));
/** The screen's title. */
const heading = (page: Page, name: string | RegExp) => page.getByRole('heading', { name, exact: typeof name === 'string' }).locator('visible=true').first();
/** A sheet's ✕ (the last Close on screen: the sheet is drawn over the screen). */
const closeSheet = (page: Page) => button(page, 'Close');

const ME_ROWS = ['Name and photo', 'Ready for offline', 'Set up the microphone', 'Say a sentence, pick what sounds best', 'How LangQuest works',
  'Listen to a short tour', 'Language', 'English', 'More settings', 'Password, notifications, sync, account', 'Sign out'];

/** Each of `words` appears in `whole`, in this order. */
function expectInOrder(whole: string, words: string[]) {
  let at = -1;
  for (const w of words) {
    const next = whole.indexOf(w, at + 1);
    expect(next, `"${w}" after position ${at} in: ${whole}`).toBeGreaterThan(at);
    at = next;
  }
}

/** G10.1: no crash screen and nothing refused. */
async function expectNoCrash(page: Page) {
  const all = await screenText(page);
  expect(all).not.toContain('This screen could not open');
  expect(all).not.toContain("That can't be opened from here.");
  expect(all).not.toContain("You don't have permission to open that.");
}

async function goPassage(page: Page, w: UiWorld, key: Parameters<typeof openPassage>[2]) {
  await toTabs(page);
  await openPassage(page, w, key);
}

async function openMe(page: Page) {
  await toTabs(page);
  await tab(page, 'me').click();
  await expect(heading(page, 'Me')).toBeVisible();
}

async function openMore(page: Page) {
  await openMe(page);
  await row(page, 'More settings').click();
  await expect(heading(page, 'More settings')).toBeVisible();
}

async function openBell(page: Page) {
  await toTabs(page);
  await tab(page, 'work').click();
  await button(page, /^Updates/).click();
  await expect(heading(page, 'Inbox')).toBeVisible();
}

async function offline(page: Page, on: boolean) {
  await page.context().setOffline(on);
}

/** The app as `key` in a browser of its own, signed in with a session nobody else holds. */
async function ownBrowser(browser: Browser, w: UiWorld, key: AccountKey, member = true) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
  await quietDevServer(context);
  const page = await context.newPage();
  await openOnce(page, stateFor(w, key, { session: await freshSession(w, key), member }));
  return { context, page };
}

// ---- Me ------------------------------------------------------------------------------------------

for (const who of ['TRANS', 'VIEW', 'ADMIN'] as const) {
  test(`ACCT-001 ${who} Me shows its rows and Sign out`, async ({ browser }) => {
    const { context, page } = await quietDevice(browser, world(), who);
    await openMe(page);
    await expect(row(page, world().accounts[who].name)).toBeVisible();
    await expect(byId(page, 'header-back')).toHaveCount(0);
    const all = await screenText(page);
    expectInOrder(all, [world().accounts[who].name, ...ME_ROWS]);
    expect(all).toMatch(/Ready for offline (Checking this device…|No passages kept on this device yet|\d+ passages? on this device|\d+ of \d+ passages? ready on this device)/);
    // No count on More settings: its sub-line runs straight into Sign out.
    expect(all).toContain('Password, notifications, sync, account Sign out');
    await expect(button(page, 'Sign out')).toBeVisible();
    // "Me" is lit: its label is the brand colour, the other tabs' are not.
    const colour = (id: 'me' | 'map') => tab(page, id).locator('div[dir="auto"]').last().evaluate((e) => getComputedStyle(e).color);
    expect(await colour('me')).not.toBe(await colour('map'));
    expect(all).not.toMatch(/Members|Roles/);
    await context.close();
  });
}

test('ACCT-003 Each row on Me opens its screen, and Back returns', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await openMe(page);
  const backToMe = async () => {
    await expect(heading(page, 'Me')).toBeVisible();
    await expect(tab(page, 'me')).toBeVisible();
  };
  const opens = async (label: string, title: string | RegExp) => {
    await row(page, label).click();
    await expect(heading(page, title)).toBeVisible();
    await expectNoCrash(page);
    await back(page).click();
    await backToMe();
  };
  await opens(world().accounts.TRANS.name, 'Edit Profile');
  await opens('Ready for offline', 'Sync');
  await opens('Set up the microphone', 'Set up your microphone');
  await row(page, 'How LangQuest works').click();
  await expect(heading(page, 'What is LangQuest?')).toBeVisible();
  await expect(text(page, /^1 of \d+$/)).toBeVisible();
  await back(page).click();
  await backToMe();
  await row(page, 'Language').click();
  await expect(text(page, 'Choose the language LangQuest speaks to you in.')).toBeVisible();
  await expect(heading(page, 'Me')).toBeVisible();
  await closeSheet(page).click();
  await expect(text(page, 'Choose the language LangQuest speaks to you in.')).toHaveCount(0);
  await opens('More settings', 'More settings');
  await button(page, 'Sign out').click();
  await expect(text(page, 'Sign out?')).toBeVisible();
  await button(page, 'Cancel').click();
  await backToMe();
});

test('ACCT-004 Waiting work shows on Me\'s "More settings" row', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await languageLoaded(page);
  await offline(page, true);
  await addNoteUI(page, world(), 'P-SUBMITTED', 'ACCT-004 waiting note', { offline: true });
  await openMe(page);
  const more = row(page, 'More settings');
  await expect(more).toContainText('1 waiting to send · password, notifications, sync, account');
  await expect(more).toContainText(/1$/);
  await offline(page, false);
  await expect(more).toContainText('Password, notifications, sync, account', { timeout: 45_000 });
  await expect(more).not.toContainText('waiting to send');
  await expectSent(page, world());
});

// ---- More settings -------------------------------------------------------------------------------

for (const who of ['TRANS', 'VIEW', 'LADMIN'] as const) {
  test(`ACCT-005 ${who} The profile card names the account, its role and the organization`, async ({ browser }) => {
    const roles = { TRANS: 'Translator', VIEW: 'Viewer', LADMIN: 'Language Lead' } as const;
    const { context, page } = await quietDevice(browser, world(), who);
    await openMore(page);
    await expect(byId(page, 'header-back')).toBeVisible();
    const a = world().accounts[who];
    await expect(text(page, a.name)).toBeVisible();
    await expect(text(page, a.email)).toBeVisible();
    await expect(text(page, `${roles[who]} · ${world().orgName}`)).toBeVisible();
    const all = await screenText(page);
    expectInOrder(all.toLowerCase(), [a.name.toLowerCase(), 'switch organization', 'this device', 'sync', 'send diagnostics', 'delete account',
      'your account and your name, for good']);
    // The web has no push (WEB-021); these accounts have email; nobody is blocked yet.
    expect(all).not.toContain('Notifications');
    expect(all).not.toContain('Set a password');
    expect(all).not.toContain('Blocked people');
    await expect(tab(page, 'me')).toBeHidden();
    await context.close();
  });
}

test('ACCT-006 A looked-after account sees how to get back in', async ({ page }) => {
  const kept = world().accounts.KEPT;
  // Signed in on this device with COORD's help (signInHelp.ts records it when a code is used).
  await page.addInitScript(([id, name]) => {
    if (localStorage.getItem(`signed-in-with-help:${id}`) === null) localStorage.setItem(`signed-in-with-help:${id}`, JSON.stringify({ helper: name, at: Date.now() }));
  }, [kept.id, world().accounts.COORD.name] as const);
  await openAs(page, world(), 'KEPT');
  await openMore(page);
  await expect(text(page, 'No email yet')).toBeVisible();
  expect(await screenText(page)).not.toContain(kept.email);
  await expect(text(page, `Translator · ${world().orgName}`)).toBeVisible();
  await expect(text(page, `New device? ${world().accounts.ADMIN.name} or an admin can help you sign in.`)).toBeVisible();
  await expect(text(page, new RegExp(`^Signed in on this device with ${esc(world().accounts.COORD.name)}'s help · `))).toBeVisible();
  await expect(row(page, 'Set a password')).toContainText('If other people use this device');
  await row(page, 'Set a password').click();
  await expect(heading(page, 'Edit Profile')).toBeVisible();
});

test('ACCT-010 Switch Organization says which organization is active, on Me for someone in several', async ({ browser }) => {
  // ADMIN is in two organizations: the row is on Me, under the name, and not again under More settings
  // (decision 71, amended 2026-10-14).
  const a = await quietDevice(browser, world(), 'ADMIN');
  await openMe(a.page);
  await expect(row(a.page, 'Switch Organization')).toContainText(`${world().orgName} (active)`);
  expectInOrder(await screenText(a.page), [world().accounts.ADMIN.name, 'Switch Organization', 'Ready for offline']);
  await row(a.page, 'More settings').click();
  await expect(heading(a.page, 'More settings')).toBeVisible();
  await expect(row(a.page, 'Switch Organization')).toHaveCount(0);
  await a.context.close();
  // TRANS is in one: More settings keeps it, where it also starts a new one.
  const t = await quietDevice(browser, world(), 'TRANS');
  await openMe(t.page);
  await expect(row(t.page, 'Ready for offline')).toBeVisible();
  await expect(row(t.page, 'Switch Organization')).toHaveCount(0);
  await row(t.page, 'More settings').click();
  await expect(row(t.page, 'Switch Organization')).toContainText(`${world().orgName} · or start a new one`);
  await t.context.close();
});

test('ACCT-011 The Sync row says how sync stands', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await openMore(page);
  const sync = row(page, 'Sync');
  await expect(sync).toContainText(/Live: changes arrive as they happen|Up to date/);
  await offline(page, true);
  // A browser has no network signal the app listens to: it notices when the live channel's heartbeat goes unanswered.
  await expect(sync).toContainText('Offline: work is kept on this device', { timeout: 75_000 });
  await back(page).click();
  await addNoteUI(page, world(), 'P-SUBMITTED', 'ACCT-011 waiting note', { offline: true });
  await openMore(page);
  await expect(sync).toContainText('1 change waiting to send');
  await expect(sync).toContainText(/send1$/);
  await offline(page, false);
  await expect(sync).toContainText(/Live: changes arrive as they happen|Up to date/, { timeout: 45_000 });
  await expect(sync).not.toContainText(/\d$/);
  await sync.click();
  await expect(heading(page, 'Sync')).toBeVisible();
});

test('ACCT-013 Blocked people appears only once someone is blocked', async ({ page }) => {
  const w = world();
  await noteAs(w, 'TREV', 'P-SUBMITTED', 'ACCT-013 note by Trevor');
  await openAs(page, w, 'REV');
  await openMore(page);
  expect(await screenText(page)).not.toContain('Blocked people');
  // Block TRANS from the flag on Version 1 (MOD-008).
  await goPassage(page, w, 'P-SUBMITTED');
  await text(page, 'Version 1', false).click();
  await button(page, `Report or block ${w.accounts.TRANS.name}`).click();
  await row(page, `Block ${w.accounts.TRANS.name}`).click();
  await expectToast(page, `Blocked ${w.accounts.TRANS.name}.`);
  await openMore(page);
  await expect(row(page, 'Blocked people')).toContainText('1 person');
  expectInOrder(await screenText(page), ['Send diagnostics', 'Blocked people', '1 person']);
  // Block TREV from the note TREV made, in the passage's history.
  await goPassage(page, w, 'P-SUBMITTED');
  await openHistory(page);
  await button(page, `Report or block ${w.accounts.TREV.name}`).click();
  await row(page, `Block ${w.accounts.TREV.name}`).click();
  await openMore(page);
  await expect(row(page, 'Blocked people')).toContainText('2 people');
  await row(page, 'Blocked people').click();
  await expect(text(page, "What they add is hidden for you. They aren't told.")).toBeVisible();
  // Resets: unblock both from the sheet (MOD-012).
  const unblock = page.getByRole('button', { name: 'Unblock', exact: true });
  await expect(unblock).toHaveCount(2);
  await unblock.first().click();
  await expect(unblock).toHaveCount(1);
  await unblock.first().click();
  await expect(page.getByRole('button', { name: 'Block again', exact: true })).toHaveCount(2);
  await closeSheet(page).click();
  await expectAccountSent(page, w.accounts.REV.id);
});

// ---- Edit Profile --------------------------------------------------------------------------------

test('ACCT-015 Change your name', async ({ page, browser }) => {
  const w = world();
  const name = w.accounts.TRANS.name;
  try {
    await openAs(page, w, 'TRANS');
    await openMe(page);
    await row(page, name).click();
    await expect(heading(page, 'Edit Profile')).toBeVisible();
    await expect(field(page, 'Full Name')).toHaveValue(name);
    await expect(text(page, 'Email')).toBeVisible();
    await expect(text(page, w.accounts.TRANS.email)).toBeVisible();
    await expect(primary(page)).toHaveAccessibleName('Save Profile');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await field(page, 'Full Name').fill(`${name} Test`);
    await primary(page).click();
    await expectToast(page, 'Profile saved. It syncs when you are connected.');
    await expect(heading(page, 'Me')).toBeVisible();
    await expect(row(page, `${name} Test`)).toBeVisible();
    await row(page, 'More settings').click();
    await expect(text(page, `${name} Test`)).toBeVisible();
    await expectAccountSent(page, w.accounts.TRANS.id);
    // Device 2 (COORD): Version 1 of P-SUBMITTED is by the new name.
    const coord = await quietDevice(browser, w, 'COORD');
    await goPassage(coord.page, w, 'P-SUBMITTED');
    await text(coord.page, 'Version 1', false).click();
    await expect(text(coord.page, `${name} Test`, false)).toBeVisible({ timeout: 60_000 });
    await coord.context.close();
  } finally {
    await saveName(w, 'TRANS', name);
  }
});

test('ACCT-016 A name cannot be blank', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await openMe(page);
  await row(page, world().accounts.TRANS.name).click();
  const name = field(page, 'Full Name');
  await name.fill('');
  await expect(name).toHaveAttribute('placeholder', 'Your name');
  await expect(primary(page)).toBeDisabled();
  await name.fill('   ');
  await expect(primary(page)).toBeDisabled();
});

test('ACCT-017 A name changed offline is saved and sent later', async ({ page }) => {
  const w = world();
  const name = w.accounts.TRANS.name;
  try {
    await openAs(page, w, 'TRANS');
    await openMe(page);
    await expect(row(page, name)).toBeVisible();
    await offline(page, true);
    await row(page, name).click();
    await field(page, 'Full Name').fill('Tom Offline');
    await primary(page).click();
    await expectToast(page, 'Profile saved. It syncs when you are connected.');
    await expect(row(page, 'Tom Offline')).toBeVisible();
    await row(page, 'Tom Offline').click();
    await expect(text(page, 'Saved on this device')).toBeVisible();
    await expect(text(page, 'It sends when you are connected.')).toBeVisible();
    await expect(field(page, 'Full Name')).toHaveValue('Tom Offline');
    await back(page).click();
    // On the web, sign-out waits for it (ACCT-040).
    await button(page, 'Sign out').click();
    await expect(text(page, 'Not yet')).toBeVisible();
    await expect(text(page, 'Still to send: 1 account change.', false)).toBeVisible();
    await button(page, 'Cancel').click();
    await openBell(page);
    const saved = await screenText(page);
    expectInOrder(saved.toLowerCase(), ['saved account changes', 'profile', 'waiting to send', 'saved']);
    await offline(page, false);
    await expect(text(page, /saved account changes/i)).toBeHidden({ timeout: 45_000 });
    await openMe(page);
    await row(page, 'Tom Offline').click();
    await expect(text(page, 'Saved on this device')).toBeHidden();
  } finally {
    await saveName(w, 'TRANS', name);
  }
});

test('ACCT-018 A name the server refuses says why', async ({ page }) => {
  const w = world();
  try {
    await openAs(page, w, 'TRANS');
    await openMe(page);
    await row(page, w.accounts.TRANS.name).click();
    const long = 'N'.repeat(101);
    await field(page, 'Full Name').fill(long);
    const typed = await field(page, 'Full Name').inputValue();
    test.info().annotations.push({ type: 'name length', description: `the field holds ${typed.length} characters` });
    if (typed.length < 101) return; // The field stops at 100: the case cannot be reached, which is also a pass.
    await primary(page).click();
    await expect.poll(async () => (await page.evaluate((id) => localStorage.getItem(`account-outbox:${id}`) ?? '', w.accounts.TRANS.id)), { timeout: 30_000 })
      .toContain('"failed"');
    await openMe(page);
    await row(page, 'More settings').waitFor();
    await button(page, new RegExp(`^${long}|^${esc(w.accounts.TRANS.name)}`)).click();
    await expect(text(page, 'Your last change was not accepted')).toBeVisible();
    await expect(text(page, 'Use a name between 1 and 100 characters.')).toBeVisible();
    await back(page).click();
    await openBell(page);
    await expect(row(page, 'Profile')).toContainText('Use a name between 1 and 100 characters. · Tap to try again');
    await expect(row(page, 'Profile')).toContainText('Not sent');
  } finally {
    await saveName(w, 'TRANS', w.accounts.TRANS.name);
  }
});

test('ACCT-019 A looked-after account\'s password must be 6 or more characters', async ({ page }) => {
  const kept = world().accounts.KEPT;
  await openAs(page, world(), 'KEPT');
  await openMore(page);
  await row(page, 'Set a password').click();
  await expect(heading(page, 'Edit Profile')).toBeVisible();
  await expect(text(page, 'No email yet')).toBeVisible();
  const pass = field(page, 'Password (optional)');
  await expect(pass).toHaveAttribute('placeholder', '6 or more characters');
  await expect(text(page, 'Set one if other people use this device, so you can sign back in after they do.')).toBeVisible();
  await pass.fill('abc12');
  await expect(text(page, `You sign in with ${kept.signInName} and this password. Write the name down.`)).toBeVisible();
  await primary(page).click();
  await expect(text(page, 'Choose a password of 6 or more characters.')).toBeVisible();
  await expect(heading(page, 'Edit Profile')).toBeVisible();
});

test('ACCT-020 Setting a password needs a connection', async ({ page }) => {
  await openAs(page, world(), 'KEPT');
  await openMore(page);
  // The name came down while online, as on a phone that has been used before.
  await expect(text(page, world().accounts.KEPT.name)).toBeVisible();
  await offline(page, true);
  await row(page, 'Set a password').click();
  await field(page, 'Password (optional)').fill('kept-pass-1');
  await primary(page).click();
  await expect(text(page, 'Setting a password needs a connection.')).toBeVisible();
  await expect(heading(page, 'Edit Profile')).toBeVisible();
  await back(page).click();
  await expect(row(page, 'Set a password')).toBeVisible();
});

// ---- Switch Organization -------------------------------------------------------------------------

test('ACCT-022 Switching organization changes the role and the tabs @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await openMe(page);
  await row(page, 'Switch Organization').click();
  await expect(heading(page, 'Switch Organization')).toBeVisible();
  await expect(byId(page, 'header-back')).toBeVisible();
  await expect(button(page, `${w.orgName}, active`)).toBeVisible();
  await expect(button(page, w.org2Name)).toBeVisible();
  await expect(button(page, 'New organization')).toContainText("You'll be its admin. Your place in the others stays as it is.");
  await button(page, w.org2Name).click();
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'me']);
  const home = await screenText(page);
  expect(home).not.toContain('Alpha');
  await openMore(page);
  await expect(text(page, `Translator · ${w.org2Name}`)).toBeVisible();
  await back(page).click();
  await expect(row(page, 'Switch Organization')).toContainText(`${w.org2Name} (active)`);
  await row(page, 'Switch Organization').click();
  await button(page, w.orgName).click();
  await expect(tab(page, 'manage')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'manage', 'me']);
  await tab(page, 'manage').click();
  await expect(heading(page, w.orgName)).toBeVisible();
  await expectSent(page, w);
});

test('ACCT-023 The organization list works offline', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await openMe(page);
  await row(page, 'Switch Organization').click();
  await expect(button(page, w.org2Name)).toBeVisible();
  await back(page).click();
  await offline(page, true);
  await row(page, 'Switch Organization').click();
  await expect(text(page, 'Unable to refresh. Saved organizations remain available.')).toBeVisible({ timeout: 30_000 });
  await expect(button(page, `${w.orgName}, active`)).toBeVisible();
  await expect(button(page, w.org2Name)).toBeVisible();
  await button(page, w.org2Name).click();
  // ORG2 was never opened here: whatever shows, it is not a crash screen.
  await page.waitForTimeout(5000); // sleep: proves a negative (no crash screen appears); nothing observable otherwise
  await expectNoCrash(page);
  test.info().annotations.push({ type: 'ORG2 offline, never opened here', description: (await screenText(page)).slice(0, 300) });
});

test('ACCT-024 Tapping the active organization opens it again', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openMore(page);
  await row(page, 'Switch Organization').click();
  await expect(button(page, `${w.orgName}, active`)).toBeVisible();
  await expect(page.getByRole('button', { name: w.org2Name })).toHaveCount(0);
  await expect(button(page, 'New organization')).toBeVisible();
  await button(page, `${w.orgName}, active`).click();
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'Next for you')).toBeVisible();
  await tab(page, 'map').click();
  await expect(text(page, 'Alpha', false)).toBeVisible();
});

test('ACCT-025 New organization opens Create Organization', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await openMore(page);
  await row(page, 'Switch Organization').click();
  await button(page, 'New organization').click();
  await expect(heading(page, 'Create Organization')).toBeVisible();
  await back(page).click();
  await expect(heading(page, 'Switch Organization')).toBeVisible();
});

// ---- The app's language --------------------------------------------------------------------------

const LANGUAGES: [string, string | null][] = [
  ['English', null], ['Español', 'Spanish'], ['Português (Brasil)', 'Portuguese (Brazil)'], ['Français', 'French'], ['العربية', 'Arabic'],
  ['Kiswahili', 'Swahili'], ['Hausa', 'Hausa'], ['አማርኛ', 'Amharic'], ['हिन्दी', 'Hindi'], ['বাংলা', 'Bengali'], ['नेपाली', 'Nepali'],
  ['Bahasa Indonesia', 'Indonesian'], ['简体中文', 'Chinese (Simplified)'], ['ไทย', 'Thai'], ['မြန်မာ', 'Burmese']
];

async function openLanguageSheet(page: Page) {
  await openMe(page);
  await row(page, 'Language').click();
  await expect(text(page, 'Choose the language LangQuest speaks to you in.')).toBeVisible();
}

test('ACCT-026 The Language sheet lists fifteen languages', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await openLanguageSheet(page);
  const radios = page.getByRole('radio').locator('visible=true');
  await expect(radios).toHaveCount(16);
  await expect(radios.nth(0)).toHaveText(/^Same as this browser\s*Now English$/);
  const rows = await radios.allInnerTexts();
  LANGUAGES.forEach(([own, english], i) => {
    const lines = rows[i + 1]!.split('\n').map((s) => s.trim()).filter(Boolean);
    expect(lines, `row ${i + 2}`).toEqual(english ? [own, english] : [own]);
  });
  const all = await screenText(page);
  expect(all).not.toContain('Draft');
  expect(all).not.toContain('Draft translations were made by machine');
  // The check is on the first row only (a row's only drawing is its check).
  expect(await checkedRows(page)).toEqual([0]);
});

/** Which Language rows show the check, by position. */
async function checkedRows(page: Page): Promise<number[]> {
  const counts = await page.getByRole('radio').locator('visible=true').evaluateAll((els) => els.map((e) => e.querySelectorAll('svg').length));
  return counts.flatMap((n, i) => (n > 0 ? [i] : []));
}

test('ACCT-027 Picking a language restarts the app in it', async ({ page }) => {
  const w = world();
  const es = catalog('es');
  await openAs(page, w, 'TRANS');
  await languageLoaded(page);
  // The web app's own page needs the network to reload (decision 58), so only the server is out of reach.
  const server = `${w.supabaseUrl}/**`;
  await page.context().route(server, (r) => r.abort('internetdisconnected'));
  await addNoteUI(page, w, 'P-SUBMITTED', 'ACCT-027 waiting note', { offline: true });
  const waiting = async (p: Page) => (await deviceEvents(p, w.orgId, w.languages.A.languageId)).filter((e) => e.status === 'pending').length;
  expect(await waiting(page)).toBe(1);
  await openLanguageSheet(page);
  const reloaded = page.waitForEvent('load');
  await page.getByRole('radio', { name: /^Español/ }).click();
  await expect(text(page, 'Changing the language…')).toBeVisible();
  await reloaded;
  await waitForApp(page);
  await expect(tab(page, 'me')).toHaveAttribute('aria-label', say(es, 'account.me.title'));
  await tab(page, 'me').click();
  await expect(heading(page, say(es, 'account.me.title'))).toBeVisible();
  await expect(row(page, say(es, 'uiLanguage.row'))).toContainText('Español');
  expect(await waiting(page)).toBe(1);
  // Closing the tab and opening the site again: still Spanish.
  const again = await page.context().newPage();
  await page.close();
  await again.goto('/');
  await waitForApp(again);
  await expect(tab(again, 'me')).toHaveAttribute('aria-label', say(es, 'account.me.title'));
  await expect(tab(again, 'work')).toHaveAttribute('aria-label', say(es, 'account.tabs.work'));
  // Names people typed stay as written: the language's name on the Map.
  await tab(again, 'map').click();
  await expect(text(again, 'Alpha')).toBeVisible();
  expect(await waiting(again)).toBe(1);
  // The note waiting since before the restart goes once the server is back.
  await again.context().unroute(server);
  await expectSent(again, w, 'A', 60_000);
});

test('ACCT-031 The language chip on Sign In', async ({ page }) => {
  const fr = catalog('fr');
  await openSignedOut(page);
  const chip = button(page, 'Language: English. Change it');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(text(page, 'Choose the language LangQuest speaks to you in.')).toBeVisible();
  const reloaded = page.waitForEvent('load');
  await page.getByRole('radio', { name: /^Français/ }).click();
  await reloaded;
  await expect(button(page, say(fr, 'uiLanguage.chipLabel', { language: 'Français' }))).toBeVisible({ timeout: 120_000 });
  const who = world().accounts.TRANS;
  await page.getByPlaceholder(say(fr, 'entry.signIn.namePlaceholder')).fill(who.email);
  await page.getByPlaceholder(say(fr, 'entry.fields.password')).fill(who.password!);
  await primary(page).click();
  await expect(tab(page, 'me')).toBeVisible({ timeout: 60_000 });
  await expect(tab(page, 'me')).toHaveAttribute('aria-label', say(fr, 'account.me.title'));
  await tab(page, 'me').click();
  await expect(row(page, say(fr, 'uiLanguage.row'))).toContainText('Français');
});

test('ACCT-032 On the web, the page reloads in the language and sets its direction', async ({ page }) => {
  const ar = catalog('ar');
  await openAs(page, world(), 'TRANS');
  await openLanguageSheet(page);
  await expect(page.getByRole('radio').locator('visible=true').first()).toHaveText(/^Same as this browser/);
  let loads = 0;
  page.on('load', () => { loads += 1; });
  await page.getByRole('radio', { name: /^العربية/ }).click();
  await expect(tab(page, 'me')).toHaveAttribute('aria-label', say(ar, 'account.me.title'), { timeout: 120_000 });
  await waitForApp(page);
  expect(loads).toBe(1);
  expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['ar', 'rtl']);
  // The French catalog cannot be fetched: the app opens in English, with no raw keys.
  // The export asks for /i18n/fr.json?v=<build> (catalogs.web.ts), so the query is matched too.
  const french = /\/i18n\/fr\.json(\?|$)/;
  await page.route(french, (r) => r.abort());
  await tab(page, 'me').click();
  await row(page, say(ar, 'uiLanguage.row')).click();
  await page.getByRole('radio', { name: /^Français/ }).click();
  await expect(tab(page, 'me')).toHaveAttribute('aria-label', 'Me', { timeout: 120_000 });
  await waitForApp(page);
  await tab(page, 'me').click();
  const all = await screenText(page);
  expect(all).toContain('More settings');
  expect(all).not.toMatch(/account\.me\.|\{\{/);
  await expectNoCrash(page);
  await page.unroute(french);
  await row(page, 'Language').click();
  await page.getByRole('radio', { name: /^Same as this browser/ }).click();
  await page.waitForLoadState('load');
  await waitForApp(page);
  await expect(tab(page, 'me')).toHaveAttribute('aria-label', 'Me');
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
});

test('ACCT-033 Picking the language already showing', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await openLanguageSheet(page);
  await page.getByRole('radio', { name: /^English/ }).click();
  // Either the app restarted in English, or the sheet closed; never stuck on "Changing the language…".
  await expect(tab(page, 'me')).toHaveAttribute('aria-label', 'Me', { timeout: 30_000 });
  await expect(text(page, 'Changing the language…')).toBeHidden({ timeout: 30_000 });
  await openLanguageSheet(page);
  expect(await checkedRows(page)).toEqual([1]);
});

// ---- Help mode -----------------------------------------------------------------------------------

test('ACCT-034 The ? explains each part of the screen', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await openMe(page);
  await byId(page, 'header-help').click();
  await expect(byId(page, 'header-help')).toHaveAccessibleName('Turn help off');
  await row(page, 'More settings').click();
  const tip = button(page, /^More settings\. Opens your password, notifications, sync and account settings\./);
  await expect(tip).toBeVisible();
  await expect(heading(page, 'Me')).toBeVisible();
  await tip.click();
  await expect(tip).toBeHidden();
  await expect(byId(page, 'header-help')).toHaveAccessibleName('Turn help off');
  await button(page, 'Sign out').click();
  await expect(button(page, /^Sign out\. Leaves this account on this device\. Work not yet sent is kept until it is\./)).toBeVisible();
  await expect(heading(page, 'Me')).toBeVisible();
  await byId(page, 'header-help').click();
  await expect(byId(page, 'header-help')).toHaveAccessibleName('Help: explain this screen');
  await row(page, 'More settings').click();
  await expect(heading(page, 'More settings')).toBeVisible();
  // The main button says what happens when it is tapped, not only its name (decision 71, amended 2026-10-14).
  await goPassage(page, world(), 'P-SUBMITTED');
  await byId(page, 'header-help').click();
  await primary(page).click();
  await expect(button(page, /^Ask for a check\. Choose who to ask, then send it\./)).toBeVisible();
  // Back explains itself too: the ? is the way out of help.
  await back(page).click();
  await expect(button(page, /^Back\. Goes back to the screen before\./)).toBeVisible();
});

// ---- Signing out ---------------------------------------------------------------------------------

test('ACCT-040 On the web, sign-out waits for work to send @p0', async ({ browser }) => {
  const w = world();
  const { context, page } = await ownBrowser(browser, w, 'TRANS');
  await languageLoaded(page);
  await offline(page, true);
  await addNoteUI(page, w, 'P-SUBMITTED', 'ACCT-040 waiting note', { offline: true });
  await openMe(page);
  await button(page, 'Sign out').click();
  await expect(text(page, 'Not yet')).toBeVisible();
  await expect(text(page, 'Still to send: 1 change. This device is offline. Sign out once they have synced so they are not stranded here.')).toBeVisible();
  await expect(primary(page)).toBeDisabled();
  await button(page, 'Cancel').click();
  await expect(heading(page, 'Me')).toBeVisible();
  await button(page, 'Sign out').click();
  await offline(page, false);
  await expect(text(page, 'Sign out?')).toBeVisible({ timeout: 45_000 });
  await expect(text(page, 'You can sign back in anytime. This browser forgets everything it kept for you, so the next person here sees none of it.')).toBeVisible();
  await expect(primary(page)).toBeEnabled();
  const reloaded = page.waitForEvent('load');
  await primary(page).click();
  await reloaded;
  await expect(text(page, 'Create Account')).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token|selection:|language:/.test(k)))).toEqual([]);
  await context.close();
});

test('ACCT-041 A looked-after account is warned before signing out', async ({ page }) => {
  await openAs(page, world(), 'KEPT');
  await openMe(page);
  await button(page, 'Sign out').click();
  await expect(text(page, 'Sign out?')).toBeVisible();
  await expect(text(page, `To sign back in, you'll need a code from ${world().accounts.ADMIN.name} or an admin. If other people use this device, set a password in Edit Profile first.`))
    .toBeVisible();
  await expect(primary(page)).toBeEnabled();
});

// ---- Deleting an account -------------------------------------------------------------------------

let newOne: { world: UiWorld; who: NewAccount } | null = null;
/** NEW-1: a Translator at LANG-A, joined by an invite (ACCT-044 to ACCT-048). */
async function newOneWorld() {
  newOne ??= await newAccount(world(), 1, 'translator');
  return newOne;
}
test.afterAll(async () => { if (newOne) await deleteNew(newOne.who); });

async function openDelete(page: Page) {
  await openMore(page);
  await row(page, 'Delete account').click();
  await expect(heading(page, 'Delete Account')).toBeVisible();
}

test('ACCT-044 The Delete Account screen says what goes and what stays @p0', async ({ page }) => {
  const { world: w, who } = await newOneWorld();
  await openAs(page, w, who.key);
  await openDelete(page);
  await expect(byId(page, 'header-back')).toBeVisible();
  await expect(heading(page, 'Delete your account?')).toBeVisible();
  await expect(text(page, 'Deleted')).toBeVisible();
  await expect(text(page, 'Your sign-in, email, name, notifications, blocks and diagnostics. You leave every organization.')).toBeVisible();
  await expect(text(page, 'Kept by your organization')).toBeVisible();
  await expect(text(page, 'Recordings, reviews and notes you made stay part of its work, without your name.')).toBeVisible();
  await expect(text(page, 'This cannot be undone. To use LangQuest again you would create a new account.')).toBeVisible();
  await expect(primary(page)).toHaveAccessibleName('Delete My Account');
  await expect(primary(page)).toBeEnabled({ timeout: 30_000 });
  const all = await screenText(page);
  expect(all).not.toMatch(/You're offline|Send your work first/);
  await expect(tab(page, 'me')).toBeHidden();
  await button(page, 'Cancel').click();
  await expect(heading(page, 'More settings')).toBeVisible();
});

test('ACCT-045 Deleting needs a connection @p0', async ({ page }) => {
  const { world: w, who } = await newOneWorld();
  await openAs(page, w, who.key);
  await languageLoaded(page);
  await offline(page, true);
  await openDelete(page);
  await expect(text(page, "You're offline")).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'Connect to the internet to delete your account.')).toBeVisible();
  await expect(primary(page)).toBeDisabled();
  await offline(page, false);
  await expect(text(page, "You're offline")).toBeHidden({ timeout: 45_000 });
  await expect(primary(page)).toBeEnabled();
});

test('ACCT-046 Deleting waits for work to send @p0', async ({ page }) => {
  const { world: w, who } = await newOneWorld();
  await openAs(page, w, who.key);
  await languageLoaded(page);
  await offline(page, true);
  await addNoteUI(page, w, 'P-SUBMITTED', 'ACCT-046 waiting note', { offline: true });
  await openDelete(page);
  await expect(text(page, 'Send your work first')).toBeVisible();
  await expect(text(page, 'Still to send: 1 change. Delete your account once they have synced, so your organization gets them.')).toBeVisible();
  await expect(text(page, "You're offline")).toHaveCount(0);
  await expect(primary(page)).toBeDisabled();
  await offline(page, false);
  await expectSent(page, w, 'A', 45_000);
  await back(page).click();
  await row(page, 'Delete account').click();
  await expect(text(page, 'Send your work first')).toBeHidden();
  await expect(primary(page)).toBeEnabled();
});

test('ACCT-048 A server error on delete keeps you signed in', async ({ page }) => {
  const { world: w, who } = await newOneWorld();
  await page.route('**/rest/v1/rpc/delete_my_account', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
  await openAs(page, w, who.key);
  await openDelete(page);
  await expect(primary(page)).toBeEnabled({ timeout: 30_000 });
  await primary(page).click();
  await expect(text(page, /^Something went wrong \(code [^)]+\)\. Nothing was lost\.$/)).toBeVisible();
  await expect(heading(page, 'Delete Account')).toBeVisible();
  await expect(primary(page)).toBeEnabled();
});

test('ACCT-049 Deleting from "Join your team"', async ({ browser }) => {
  const { world: w, who } = await newAccount(world(), 2);
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await quietDevServer(context);
  const page = await context.newPage();
  await openOnce(page, stateFor(w, who.key, { member: false }));
  await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });
  await button(page, 'Delete account').click();
  await expect(heading(page, 'Delete Account')).toBeVisible();
  await expect(heading(page, 'Delete your account?')).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Join your team')).toBeVisible();
  await button(page, 'Delete account').click();
  await expect(primary(page)).toBeEnabled({ timeout: 30_000 });
  const reloaded = page.waitForEvent('load');
  await primary(page).click();
  await reloaded;
  await expect(text(page, 'Create Account')).toBeVisible({ timeout: 120_000 });
  // NEW-2 can no longer sign in.
  const { error } = await who.sb.auth.signInWithPassword({ email: who.email, password: who.password });
  expect(error?.message ?? '').toMatch(/invalid/i);
  await context.close();
});

// ---- Other rows on Me ----------------------------------------------------------------------------

test('ACCT-050 The tour and the microphone open from Me', async ({ page }) => {
  await openAs(page, world(), 'REV');
  await openMe(page);
  await row(page, 'How LangQuest works').click();
  await expect(heading(page, 'What is LangQuest?')).toBeVisible();
  await expect(text(page, '1 of 3')).toBeVisible();
  await expect(tab(page, 'me')).toBeHidden();
  await primary(page).click();
  await expect(text(page, '2 of 3')).toBeVisible();
  await primary(page).click();
  await expect(text(page, '3 of 3')).toBeVisible();
  await expect(primary(page)).toHaveAccessibleName('Done');
  await back(page).click();
  await expect(text(page, '2 of 3')).toBeVisible();
  await back(page).click();
  await expect(text(page, '1 of 3')).toBeVisible();
  await back(page).click();
  await expect(heading(page, 'Me')).toBeVisible();
  await row(page, 'Set up the microphone').click();
  await expect(heading(page, 'Set up your microphone')).toBeVisible();
  await expect(tab(page, 'me')).toBeHidden();
  await back(page).click();
  await expect(heading(page, 'Me')).toBeVisible();
});


