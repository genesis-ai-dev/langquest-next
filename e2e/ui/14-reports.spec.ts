// 14. Reports (docs/ui-test-suite/14-reports.md): the Reports section on a
// wide window (decision 57), read from the Worker on :8787 (decision 44),
// which folds the organization itself and catches up at once when asked
// (`?fresh=1`, "Catch up with the server"), so these tests need not wait for
// the projection worker. Server answers are faked with routes on
// `/api/orgs/{orgId}/reports`, and settings' saves with routes on
// `append_events`. Every test runs in the wide project (@wide); RPT-002
// changes the window's width itself.
import type { Browser, Page, Route } from '@playwright/test';
import { button, expect, openAs, screenText, tab, tabsShown, test, testState, text, useWorld, type AccountKey, type UiWorld } from './support';
import { browserStateFor } from './fixture';
import { projectionPass } from './pass-helpers';
import {
  atA, createEmptyOrgFor, orgWrite, publishAs, quietReloads, setMembership, setOffline
} from './sync-helpers';

const world = useWorld();

// Reports renders from the inputs the projection pass stores (decision 142), and a plain read answers
// from them as they are. A pass that ran while the world was being built stored half of it: run one now
// that the world is whole, so every figure below starts from the world as built (RPT-007 counts on it).
test.beforeAll(async () => { await projectionPass(); });

// The shared dev server's hot reloads must not reload the app under a test.
test.beforeEach(async ({ context }) => { await quietReloads(context); });

const SECTIONS = ['Overview', 'Recent activity', 'Languages', 'Geography', 'Field report', 'Monthly ledger', 'Pace', 'Alerts'] as const;
const FRESHNESS = /Figures as of .+ \(.+\)\. Work recorded offline appears after the device syncs\./;

const title = (page: Page) => page.getByRole('heading', { level: 1 }).locator('visible=true').first();
const catchUp = (page: Page) => page.getByRole('button', { name: 'Catch up with the server' }).locator('visible=true').first();
const chip = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' }).locator('visible=true').first();

/** A wide browser of its own, signed in as `who`. */
async function wideAs(browser: Browser, w: UiWorld, who: AccountKey, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await quietReloads(context);
  const page = await context.newPage();
  await openAs(page, w, who);
  return { context, page };
}

async function openReports(page: Page): Promise<void> {
  await tab(page, 'reports').click();
  await expect(title(page)).toHaveText('Overview', { timeout: 60_000 });
  await expect(text(page, FRESHNESS).or(text(page, 'No languages to show yet')).first()).toBeVisible({ timeout: 60_000 });
}

async function section(page: Page, name: (typeof SECTIONS)[number]): Promise<void> {
  await chip(page, name === 'Alerts' ? /^Alerts/ : name).click();
  await expect(title(page)).toHaveText(name);
}

/** Alpha's "Recorded n of m" in the Languages table. */
async function alphaRecorded(page: Page): Promise<number> {
  const m = /Alpha ALP · .*? Recorded (\d+) of \d+/.exec(await screenText(page));
  if (!m) throw new Error('Alpha is not in the Languages table');
  return Number(m[1]);
}

async function openAlpha(page: Page): Promise<void> {
  await section(page, 'Languages');
  await page.getByText('Alpha', { exact: true }).locator('visible=true').first().click();
  await expect(title(page)).toHaveText('Alpha');
}

const RPT001: Partial<Record<AccountKey, string[]>> = {
  ADMIN: ['work', 'map', 'reports', 'manage', 'me'],
  COORD: ['work', 'map', 'reports', 'manage', 'me'],
  LADMIN: ['work', 'map', 'reports', 'manage', 'me'],
  TRANS: ['work', 'map', 'reports', 'me'],
  REV: ['work', 'map', 'reports', 'me'],
  TREV: ['work', 'map', 'reports', 'me'],
  VIEW: ['map', 'reports', 'inbox', 'me'],
  KEPT: ['work', 'map', 'reports', 'me']
};
for (const [who, tabs] of Object.entries(RPT001) as [AccountKey, string[]][]) {
  test(`RPT-001 ${who} The Reports tab is there for anyone who may view status @wide`, async ({ browser }) => {
    const w = world();
    const { context, page } = await wideAs(browser, w, who);
    await expect(tab(page, 'reports')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => tabsShown(page), { message: `${who}'s tabs` }).toEqual(tabs);
    await openReports(page);
    await expect(chip(page, 'Overview')).toBeVisible();
    await context.close();
  });
}

test('RPT-002 Never on a phone, and not without an organization @wide', async ({ page, browser }) => {
  const w = world();
  // Step 1: a phone-wide window (767 px) has no Reports tab.
  await page.setViewportSize({ width: 767, height: 900 });
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(page)).toEqual(['work', 'map', 'me']);
  // Step 2: on Reports at 1200 px, narrowed to 700 px.
  await page.setViewportSize({ width: 1200, height: 900 });
  await openReports(page);
  await page.setViewportSize({ width: 700, height: 900 });
  // Known issue (2026-10-12): nothing moves the app off Reports when the window narrows (App.tsx).
  await expect(text(page, 'Language explorer'), 'the sidebar goes at phone width').toBeHidden();
  await expect.soft(tab(page, 'work'), 'the bottom bar of a phone screen').toBeVisible({ timeout: 10_000 });
  await expect.soft(title(page), 'a screen a phone has, not Reports').not.toHaveText('Overview');
  expect.soft(await tabsShown(page)).toEqual(['work', 'map', 'me']);
  await expect(page.getByText('This screen could not open')).toHaveCount(0);
  // Step 3: wide again, Reports is back.
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(tab(page, 'reports')).toBeVisible();
  // Step 4: NOORG on a wide window: Join your team, no tabs.
  const noorg = await wideAs(browser, w, 'NOORG');
  await expect(text(noorg.page, 'Join your team', false)).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(noorg.page)).toEqual([]);
  await noorg.context.close();
});

test('RPT-003 Reports opens on Overview @wide', async ({ page }) => {
  const w = world();
  // Hold the answer a moment, so the loading state can be seen.
  await page.route(`**/api/orgs/${w.orgId}/reports*`, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); });
  await openAs(page, w, 'COORD');
  await tab(page, 'reports').click();
  await expect(text(page, 'Loading reports…')).toBeVisible();
  await expect(title(page)).toHaveText('Overview');
  await expect(text(page, `${w.orgName} · Reports`)).toBeVisible();
  await expect(catchUp(page)).toBeVisible();
  for (const s of SECTIONS) await expect(chip(page, s === 'Alerts' ? /^Alerts/ : s)).toBeVisible();
  await expect(text(page, FRESHNESS)).toBeVisible();
  // A centred column beside the sidebar.
  const box = await title(page).boundingBox();
  expect(box!.x).toBeGreaterThan(248);
});

test('RPT-004 Each chip opens its section @wide', async ({ page, context }) => {
  const w = world();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAs(page, w, 'COORD');
  await openReports(page);
  for (const s of [...SECTIONS.slice(1), 'Overview'] as const) {
    await section(page, s);
    await expect(page.getByText(/could not be read|This screen could not open/)).toHaveCount(0);
    expect((await screenText(page)).length).toBeGreaterThan(200);
  }
  // Alerts: a count on the chip when an alert needs someone, matching the section.
  const alerts = chip(page, /^Alerts/);
  const spoken = (await alerts.getAttribute('aria-label')) ?? '';
  const m = /^Alerts, (\d+) needs? someone$/.exec(spoken);
  await section(page, 'Alerts');
  if (m) await expect(text(page, `${m[1]} need attention`, false)).toBeVisible();
  else await expect(text(page, '0 need attention', false)).toBeVisible();
  // Languages: Alpha and Bravo; Alpha opens its page.
  await section(page, 'Languages');
  await expect(page.getByText('Alpha', { exact: true }).locator('visible=true').first()).toBeVisible();
  await expect(page.getByText('Bravo', { exact: true }).locator('visible=true').first()).toBeVisible();
  // Field report: the periods, and Copy as text on the web.
  await section(page, 'Field report');
  for (const p of ['Weekly', 'Monthly', 'Year to date']) await expect(chip(page, p)).toBeVisible();
  await button(page, 'Copy as text').click();
  await expect(page.getByText('Copied. Paste it into an email or a message.').locator('visible=true').first()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(w.orgName);
  await openAlpha(page);
});

const RPT006: [AccountKey, string[]][] = [['VIEW', ['Alpha', 'Bravo']], ['TRANS', ['Alpha']], ['LADMIN', ['Alpha']]];
for (const [who, names] of RPT006) {
  test(`RPT-006 ${who} Each role sees the languages its role covers @wide`, async ({ browser }) => {
    const w = world();
    const { context, page } = await wideAs(browser, w, who);
    await openReports(page);
    await section(page, 'Languages');
    for (const n of ['Alpha', 'Bravo', 'Charlie']) {
      await expect(page.getByText(n, { exact: true }).locator('visible=true'), `${who} ${names.includes(n) ? 'sees' : 'does not see'} ${n}`)
        .toHaveCount(names.includes(n) ? 1 : 0);
    }
    await context.close();
  });
}

test('RPT-007 Catch up with the server shows new work @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await openReports(page);
  // Catch up first, so the figure below is the log's whatever the pass stored (the pass is not what this test is about).
  await catchUp(page).click();
  await expect(catchUp(page)).toBeEnabled({ timeout: 30_000 });
  await section(page, 'Languages');
  const before = await alphaRecorded(page);
  // Device 2 (TRANS) records and publishes Version 1 of P-NEW; it reaches the server.
  await publishAs(w, 'TRANS', 'P-NEW');
  await page.route(`**/api/orgs/${w.orgId}/reports?fresh=1*`, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); });
  await catchUp(page).click();
  await expect(catchUp(page)).toBeDisabled();
  await expect(catchUp(page)).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => alphaRecorded(page)).toBe(before + 1);
  await page.getByText('Alpha', { exact: true }).locator('visible=true').first().click();
  await expect(text(page, FRESHNESS)).toBeVisible();
  await expect(text(page, /Figures as of .+ \((just now|\d minutes? ago)\)/)).toBeVisible();
});

test('RPT-008 The country filter @wide', async ({ page }) => {
  const w = world();
  // Alpha and Bravo in different countries (as RPT-019 sets one, through the server).
  await orgWrite(w, 'COORD', 'v1.LanguageCountrySet', { languageId: w.languages.A.languageId, country: 'UG' });
  await orgWrite(w, 'COORD', 'v1.LanguageCountrySet', { languageId: w.languages.B.languageId, country: 'TZ' });
  await openAs(page, w, 'COORD');
  await openReports(page);
  await catchUp(page).click();
  await expect(catchUp(page)).toBeEnabled({ timeout: 30_000 });
  // Languages filters by country (Geography shows every country by itself).
  await section(page, 'Languages');
  await expect(chip(page, 'All countries')).toBeVisible();
  await expect(chip(page, 'Uganda')).toBeVisible();
  await expect(chip(page, /Tanzania/)).toBeVisible();
  await chip(page, 'Uganda').click();
  await expect.poll(async () => /Bravo/.test(await screenText(page))).toBe(false);
  expect(await screenText(page)).toMatch(/Alpha/);
  await chip(page, 'All countries').click();
  await expect.poll(async () => /Bravo/.test(await screenText(page))).toBe(true);
  expect(await screenText(page)).toMatch(/Alpha/);
});

test('RPT-009 Offline @wide', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await expect(tab(page, 'reports')).toBeVisible({ timeout: 60_000 });
  await setOffline(context, true);
  await tab(page, 'reports').click();
  await expect(text(page, 'You are offline')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'Reports need a connection. They load when you are back online.')).toBeVisible();
  await setOffline(context, false);
  await page.route(`**/api/orgs/${w.orgId}/reports*`, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); });
  await button(page, 'Try again').click();
  await expect(text(page, 'Loading reports…')).toBeVisible();
  await expect(text(page, FRESHNESS)).toBeVisible({ timeout: 30_000 });
  await expect(title(page)).toHaveText('Overview');
});

test('RPT-010 The server\'s answers, each in words @wide', async ({ page }) => {
  const w = world();
  let status = 401;
  await page.route(`**/api/orgs/${w.orgId}/reports*`, (route: Route) => route.fulfill({ status, json: { error: 'test' } }));
  await openAs(page, w, 'COORD');
  const words: [number, string][] = [
    [401, 'Your session has ended. Sign in again.'],
    [403, 'You are not a member of this organization.'],
    [502, 'The server could not read this organization just now. Try again.'],
    [418, 'The server answered 418.']
  ];
  for (const [i, [code, body]] of words.entries()) {
    status = code;
    if (i === 0) await tab(page, 'reports').click();
    else await button(page, 'Try again').click();
    await expect(text(page, 'The reports could not be read')).toBeVisible();
    await expect(text(page, body)).toBeVisible();
    await expect(button(page, 'Try again')).toBeVisible();
  }
  await expect(page.getByText('This screen could not open')).toHaveCount(0);
  // Step 5 (a build with no reports server) needs a build without EXPO_PUBLIC_API_URL: not this dev server.
});

test('RPT-011 Figures already shown stay when a refresh fails @wide', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await openReports(page);
  const asOf = await text(page, FRESHNESS).innerText();
  const overview = await screenText(page);
  await setOffline(context, true);
  await catchUp(page).click();
  await expect(catchUp(page)).toBeEnabled({ timeout: 30_000 });
  await expect(text(page, 'You are offline')).toBeHidden();
  await expect(text(page, 'The reports could not be read')).toBeHidden();
  expect(await text(page, FRESHNESS).innerText()).toBe(asOf);
  expect(await screenText(page)).toBe(overview);
  await section(page, 'Pace');
  await expect(text(page, 'You are offline')).toBeHidden();
  await openAlpha(page);
  await expect(text(page, FRESHNESS)).toHaveText(asOf.replace(/\s+/g, ' ').trim());
  await expect(text(page, 'You are offline')).toBeHidden();
});

test('RPT-012 An organization with no languages @wide', async ({ browser }) => {
  const w = world();
  // NOORG starts an organization and adds no language (as "Start a new one" does).

  const orgId = await createEmptyOrgFor(w, 'NOORG', `UI Empty Org ${w.run}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await quietReloads(context);
  const page = await context.newPage();

  const state = browserStateFor(w, 'NOORG');
  state[`selection:${w.accounts.NOORG.id}`] = JSON.stringify({ orgId });
  await page.addInitScript((entries) => { for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, state);
  await page.goto('/');
  await expect(tab(page, 'reports')).toBeVisible({ timeout: 60_000 });
  await tab(page, 'reports').click();
  await expect(text(page, 'No languages to show yet')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'Languages appear here once the organization has one and your role lets you view its status. If you expected some, ask an administrator which languages your role covers.')).toBeVisible();
  for (const s of SECTIONS) {
    await chip(page, s === 'Alerts' ? /^Alerts/ : s).click();
    await expect(title(page)).toHaveText(s);
    await expect(page.getByText('This screen could not open')).toHaveCount(0);
  }
  await context.close();
});

test('RPT-013 Alpha\'s page @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await openReports(page);
  await section(page, 'Languages');
  await page.route(`**/api/orgs/${w.orgId}/reports*`, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); });
  await page.getByText('Alpha', { exact: true }).locator('visible=true').first().click();
  await expect(text(page, 'Loading the report…').or(text(page, FRESHNESS)).first()).toBeVisible();
  await expect(title(page)).toHaveText('Alpha');
  await expect(text(page, w.orgName)).toBeVisible();
  const crumb = page.getByRole('link', { name: 'Reports' }).locator('visible=true').first();
  await expect(crumb).toBeVisible();
  await expect(button(page, 'Download the books as CSV')).toBeVisible();
  await expect(button(page, 'Print or save as PDF')).toBeVisible();
  await expect(text(page, 'ALP')).toBeVisible();
  await expect(text(page, /Review flow: Standard Bible Flow/, false)).toBeVisible();
  await expect(text(page, 'Active')).toBeVisible();
  await expect(text(page, FRESHNESS)).toBeVisible();
  const body = await screenText(page);
  const order = ['Passages', 'Scripture coverage', 'Uploads', 'Recordings on the server', 'Chapters with audio', 'Since the last upload', 'Needs attention',
    'Review flow', 'Where passages stand', 'Activity', 'By week.', 'Progress over time', 'Books', 'Luke', 'Language settings'];
  let at = body.indexOf('Figures as of');
  for (const h of order) {
    const next = body.indexOf(h, at);
    expect(next, `"${h}" after the one before`).toBeGreaterThan(at);
    at = next;
  }
  // The crumb and Back return to Reports, on the section it was on.
  await crumb.click();
  await expect(title(page)).toHaveText('Languages');
  await page.getByText('Alpha', { exact: true }).locator('visible=true').first().click();
  await expect(title(page)).toHaveText('Alpha');
  await button(page, 'Back').click();
  await expect(title(page)).toHaveText('Languages');
});

test('RPT-016 A language whose report you cannot see @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'VIEW');
  await openReports(page);
  await section(page, 'Languages');
  await expect(page.getByText('Bravo', { exact: true }).locator('visible=true')).toHaveCount(1);
  // Device 2 (ADMIN): VIEW's scope becomes LANG-A only.
  const pulledBefore = (await testState(page)).lastSyncAt ?? 0;
  await setMembership(w, 'ADMIN', 'VIEW', { add: { roleId: 'viewer', scope: atA(w) }, remove: { level: 'org' } });
  // The live channel brings the change by itself (no catching up from Reports): wait for the app's pull.
  await expect.poll(async () => ((await testState(page)).lastSyncAt ?? 0) > pulledBefore, { timeout: 30_000, message: 'the app pulled the change' }).toBe(true);
  // Without catching up, Bravo from the list already showing.
  await page.getByText('Bravo', { exact: true }).locator('visible=true').first().click();
  await expect(text(page, 'This language has no report you can see')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'Your role may not include this language, or it was added after the reports loaded (catch up from Reports to check).')).toBeVisible();
  await expect(page.getByText('This screen could not open')).toHaveCount(0);
  // Resets: VIEW back at organization scope.
  await setMembership(w, 'ADMIN', 'VIEW', { add: { roleId: 'viewer', scope: { level: 'org' } }, remove: atA(w) });
});

test('RPT-017 A language\'s page keeps its figures offline @wide', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await openReports(page);
  await openAlpha(page);
  const asOf = await text(page, FRESHNESS).innerText();
  await setOffline(context, true);
  await button(page, 'Back').click();
  await page.getByText('Alpha', { exact: true }).locator('visible=true').first().click();
  await expect(title(page)).toHaveText('Alpha');
  await expect(text(page, FRESHNESS)).toHaveText(asOf);
  await expect(text(page, 'You are offline')).toBeHidden();
  await expect(text(page, 'The report could not be read')).toBeHidden();
});

const RPT018: [AccountKey, boolean][] = [['ADMIN', true], ['COORD', true], ['LADMIN', true], ['TRANS', false], ['REV', false], ['VIEW', false]];
for (const [who, may] of RPT018) {
  test(`RPT-018 ${who} Only people who manage the language see its settings @wide`, async ({ browser }) => {
    const w = world();
    const { context, page } = await wideAs(browser, w, who);
    await openReports(page);
    await openAlpha(page);
    await expect(page.getByText('Language settings', { exact: true }).locator('visible=true'), `${who}`).toHaveCount(may ? 1 : 0);
    if (may) await expect(text(page, 'Where this language\'s work happens, and what it aims to record by when. Only people who manage the organization\'s structure see this.')).toBeVisible();
    if (who === 'ADMIN' || who === 'COORD') {
      await button(page, 'Back').click();
      await page.getByText('Bravo', { exact: true }).locator('visible=true').first().click();
      await expect(title(page)).toHaveText('Bravo');
      await expect(page.getByText('Language settings', { exact: true }).locator('visible=true')).toHaveCount(1);
    }
    await context.close();
  });
}

test('RPT-019 Choose and save a country @wide', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await openReports(page);
  await openAlpha(page);
  const save = button(page, 'Save country');
  await expect(save).toBeDisabled();
  const country = page.getByRole('button', { name: /^Country: .*\. Change it\.$/ }).locator('visible=true').first();
  await country.click();
  const sheet = page.getByTestId('sheet').locator('visible=true').last();
  await expect(sheet.getByText('Country', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Alpha', { exact: true })).toBeVisible();
  const find = sheet.getByPlaceholder('Find a country');
  await expect(find).toBeVisible();
  await expect(sheet.getByText(/^Type to find the other \d+\.$/)).toBeVisible();
  await find.fill('ken');
  await expect(sheet.getByRole('button', { name: 'Kenya', exact: true })).toBeVisible();
  expect(await sheet.getByText(/^[A-Z][a-z]/).allInnerTexts()).not.toContain('Uganda');
  await sheet.getByRole('button', { name: 'Kenya', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Country: Kenya. Change it.' }).locator('visible=true')).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(text(page, 'Saved.')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'Kenya')).toBeVisible();
  await expect(save).toBeDisabled();
  // Another device's Reports shows Kenya after catching up.
  const other = await wideAs(browser, w, 'ADMIN');
  await openReports(other.page);
  await catchUp(other.page).click();
  await expect(catchUp(other.page)).toBeEnabled({ timeout: 30_000 });
  await openAlpha(other.page);
  await expect(text(other.page, 'Kenya')).toBeVisible();
  await other.context.close();
});

test('RPT-020 Set a target, with dates checked @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'LADMIN');
  await openReports(page);
  await openAlpha(page);
  for (const s of ['Gospels', 'New Testament', 'Old Testament', 'Whole Bible']) await expect(chip(page, s)).toBeVisible();
  const start = page.getByLabel('Start (YYYY-MM-DD)').locator('visible=true').first();
  const finish = page.getByLabel('Finish by (YYYY-MM-DD)').locator('visible=true').first();
  await expect(start).toHaveValue(new Date().toISOString().slice(0, 10));
  const ahead = (Date.parse(`${await finish.inputValue()}T00:00:00Z`) - Date.now()) / 86_400_000;
  expect(ahead).toBeGreaterThan(500);
  expect(ahead).toBeLessThan(600);
  await chip(page, 'Gospels').click();
  const error = text(page, 'Write both dates as YYYY-MM-DD, with the finish after the start.');
  const saveTarget = button(page, 'Save target');
  await start.fill('2026-13-01');
  await expect(error).toBeVisible();
  await expect(saveTarget).toBeDisabled();
  await start.fill('2026-10-01');
  await finish.fill('2026-09-01');
  await expect(error).toBeVisible();
  await expect(saveTarget).toBeDisabled();
  await finish.fill('2027-12-31');
  await expect(error).toBeHidden();
  await saveTarget.click();
  await expect(text(page, 'Saved.')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, /^Gospels from Oct 1, 2026 to Dec 31, 2027\./, false)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^(Ahead|On pace|Behind|Stalled|Complete) -?\+?[\d.,]+ pts$/).locator('visible=true').first()).toBeVisible();
  await button(page, 'Back').click();
  await section(page, 'Pace');
  // LADMIN's role covers Alpha only.
  await expect.poll(async () => screenText(page)).toMatch(/1 of 1 language has a target/);
});

test('RPT-021 Saving settings offline @wide', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await openReports(page);
  await openAlpha(page);
  const waiting = async () => {
    const A = w.languages.A;
    return page.evaluate(async ([o]) => {
      const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog!;
      return ((await log.select("select count(*) as n from events where org_id = ? and status = 'pending'", [o])) as { n: number }[])[0]!.n;
    }, [A.orgId] as const);
  };
  const before = await waiting();
  await setOffline(context, true);
  await page.getByRole('button', { name: /^Country: .*\. Change it\.$/ }).locator('visible=true').first().click();
  await page.getByPlaceholder('Find a country').locator('visible=true').fill('ghana');
  await page.getByRole('button', { name: 'Ghana', exact: true }).locator('visible=true').click();
  const offlineWords = 'No connection. Nothing was saved; try again when you are back online.';
  await button(page, 'Save country').click();
  await expect(text(page, offlineWords)).toBeVisible({ timeout: 30_000 });
  await button(page, 'Save target').click();
  await expect(text(page, offlineWords)).toBeVisible({ timeout: 30_000 });
  expect(await waiting()).toBe(before);
  await setOffline(context, false);
  await button(page, 'Save country').click();
  await expect(text(page, 'Saved.')).toBeVisible({ timeout: 30_000 });
});

test('RPT-022 Saving settings the server turns down @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'COORD');
  await openReports(page);
  await openAlpha(page);
  const figures = await text(page, FRESHNESS).innerText();
  await page.getByRole('button', { name: /^Country: .*\. Change it\.$/ }).locator('visible=true').first().click();
  await page.getByPlaceholder('Find a country').locator('visible=true').fill('peru');
  await page.getByRole('button', { name: 'Peru', exact: true }).locator('visible=true').click();
  type Answer = 'refused' | 'unconfirmed' | 'error';
  let answer = 'refused' as Answer;
  await page.route('**/rest/v1/rpc/append_events', async (route) => {
    const body = route.request().postDataJSON() as { p_events: { id: string; stream_id?: string; streamId?: string }[] };
    if (answer === 'error') return route.fulfill({ status: 500, json: { message: 'test failure' } });
    if (answer === 'unconfirmed') return route.fulfill({ json: [] });
    return route.fulfill({ json: body.p_events.map((e) => ({ id: e.id, accepted: false, server_seq: null, reason: 'NOT_ALLOWED: test refusal' })) });
  });
  const steps: [Answer, string][] = [
    ['refused', 'Not saved: the server refused it.'],
    ['unconfirmed', 'Not saved: the server did not confirm it. Try again.'],
    ['error', 'Not saved: the server did not answer.']
  ];
  for (const [a, words] of steps) {
    answer = a;
    await button(page, 'Save country').click();
    await expect(text(page, words)).toBeVisible({ timeout: 30_000 });
    await expect(text(page, FRESHNESS)).toHaveText(figures);
    await expect(text(page, 'Peru')).toBeVisible();
  }
});
