// 15. Web and wide windows (docs/ui-test-suite/15-web-and-wide.md): layout by
// width (decision 55) and the web app as a platform of its own (decision 58):
// one tab at a time, the address bar, browser Back, the tab title, leaving
// with work unsent, and forgetting the browser on sign-out. Tests that need a
// width of their own set it (`page.setViewportSize`); those that need a wide
// window are tagged @wide. "Offline" for one tab of two is that tab's
// requests to the server refused (`serverOff`), since a context's network is
// shared by its tabs.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  back, button, byId, expect, expectToast, field, openAs, openSignedOut, primary, screenText, tab, tabsShown, test, text, useWorld, waitForApp,
  type AccountKey, type UiWorld
} from './support';
import { browserStateFor } from './fixture';
import { addNote, caughtUp, deviceAs, openRecord, openSync, quietReloads, setOffline, syncChip, toTab } from './sync-helpers';

const world = useWorld();

// The shared dev server's hot reloads must not reload the app under a test.
test.beforeEach(async ({ context }) => { await quietReloads(context); });

const title = (page: Page) => page.getByRole('heading', { level: 1 }).locator('visible=true').first();
const path = (page: Page) => new URL(page.url()).pathname;
const updates = (page: Page) => page.getByRole('button', { name: /^Updates/ }).locator('visible=true').first();

/** This page's requests to the local server refused, as if this device had no connection; Metro still serves the page. */
const isServer = (u: URL) => u.port === '54421' || u.port === '8787';
async function serverOff(page: Page, off: boolean): Promise<void> {
  if (off) {
    // Port 8787 also serves the app's own files: only data calls fail, so a reload of this tab still loads.
    await page.route(isServer, (route) => (['fetch', 'xhr'].includes(route.request().resourceType())
      ? route.abort('internetdisconnected') : route.fallback()));
    await page.routeWebSocket(isServer, (ws) => ws.close());
  } else {
    await page.unroute(isServer);
  }
}

/** Pending events on this device, across the organization's streams. */
async function waiting(page: Page, orgId: string): Promise<number> {
  return page.evaluate(async (o) => {
    const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog!;
    return ((await log.select("select count(*) as n from events where org_id = ? and status = 'pending'", [o])) as { n: number }[])[0]!.n;
  }, orgId);
}

/** Open a passage from My Work's list ("{n} more for you" opens the rest). */
async function openFromMyWork(page: Page, label: string): Promise<void> {
  const row = page.getByRole('button', { name: new RegExp(label) }).locator('visible=true').first();
  if (!(await row.isVisible().catch(() => false))) await page.getByText(/^\d+ more for you$/).locator('visible=true').first().click();
  await row.click();
  await expect(page.getByRole('heading', { name: label }).locator('visible=true').first()).toBeVisible();
}

/**
 * Signed in as `who` without a seeding script: the session is put in once
 * and the page loaded again, so a sign-out that clears the browser and
 * reloads finds it gone (openAs seeds on every load).
 */
async function openAsOnce(page: Page, w: UiWorld, who: AccountKey): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((entries) => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, browserStateFor(w, who));
  await page.goto('/');
  await waitForApp(page);
}

async function wideAs(browser: Browser, w: UiWorld, who: AccountKey, width = 1280): Promise<{ context: BrowserContext; page: Page }> {
  return deviceAs(browser, w, who, { width, height: 900 });
}

// ---- Layout by width ------------------------------------------------------------------

test('WEB-001 Phone width: the bottom bar', async ({ page, browser }) => {
  const w = world();
  await page.setViewportSize({ width: 390, height: 844 });
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(page)).toEqual(['work', 'map', 'me']);
  const bar = await tab(page, 'work').boundingBox();
  expect(bar!.y).toBeGreaterThan(844 - 120);
  for (const [id, label] of [['work', 'Work'], ['map', 'Map'], ['me', 'Me']] as const) await expect(tab(page, id)).toContainText(label);
  await expect(text(page, 'Language explorer')).toBeHidden();
  await expect(page.getByRole('link').locator('visible=true')).toHaveCount(0);
  const view = await deviceAs(browser, w, 'VIEW', { width: 390, height: 844 });
  await expect(tab(view.page, 'map')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(view.page)).toEqual(['map', 'inbox', 'me']);
  await view.context.close();
});

test('WEB-002 Tablet width: the rail @wide', async ({ page }) => {
  const w = world();
  await page.setViewportSize({ width: 900, height: 1000 });
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(page)).toEqual(['work', 'map', 'reports', 'me']);
  const work = await tab(page, 'work').boundingBox();
  const me = await tab(page, 'me').boundingBox();
  expect(work!.x + work!.width).toBeLessThanOrEqual(100);
  expect(me!.y).toBeGreaterThan(work!.y);
  for (const id of ['work', 'map', 'reports', 'me'] as const) {
    await tab(page, id).click();
    await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true');
  }
  // A centred column, not stretched; footer buttons stop at about 360 px.
  await openSync(page);
  const heading = await title(page).boundingBox();
  expect(heading!.x).toBeGreaterThan(100);
  const footer = await button(page, 'Sync now').boundingBox();
  expect(footer!.width).toBeLessThanOrEqual(400);
});

test('WEB-003 Desktop width: the sidebar @wide', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(page)).toEqual(['work', 'map', 'reports', 'manage', 'me']);
  const work = await tab(page, 'work').boundingBox();
  const map = await tab(page, 'map').boundingBox();
  expect(work!.x + work!.width).toBeLessThanOrEqual(260);
  expect(work!.width).toBeGreaterThan(150);
  expect(map!.y).toBeGreaterThan(work!.y);
  await expect(text(page, w.orgName)).toBeVisible();
  await expect(text(page, w.accounts.ADMIN.name)).toBeVisible();
  const explorer = page.getByRole('link', { name: 'Language explorer, opens in a new tab' }).or(page.getByRole('button', { name: 'Language explorer, opens in a new tab' }));
  await expect(explorer.locator('visible=true').first()).toBeVisible();
  const view = await wideAs(browser, w, 'VIEW');
  await expect(tab(view.page, 'map')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(view.page)).toEqual(['map', 'reports', 'inbox', 'me']);
  // The Inbox's count, when VIEW has an unread update (the fixture may give none).
  const badge = await tab(view.page, 'inbox').getAttribute('aria-label');
  test.info().annotations.push({ type: 'WEB-003 inbox', description: badge ?? '(no label)' });
  if (badge && /^Inbox, /.test(badge)) expect(badge).toMatch(/^Inbox, (\d{1,2}|99\+)$/);
  await view.context.close();
});

test('WEB-004 Resizing keeps your place @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openRecord(page, w, 'P-NEEDS');
  const label = w.passages['P-NEEDS'].label;
  const here = () => expect(page.getByRole('heading', { name: label }).locator('visible=true').first()).toBeVisible();
  await here();
  await page.setViewportSize({ width: 900, height: 900 });
  await here();
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'reports', 'me']);
  await page.setViewportSize({ width: 390, height: 844 });
  await here();
  await expect.poll(() => tabsShown(page)).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await here();
  await expect(text(page, 'Language explorer')).toBeVisible();
});

test('WEB-005 Language explorer opens in a new tab @wide', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  const before = page.url();
  const opened = context.waitForEvent('page');
  await page.getByText('Language explorer', { exact: true }).locator('visible=true').first().click();
  const explorer = await opened;
  await explorer.waitForLoadState();
  expect(new URL(explorer.url()).pathname).toBe('/languages');
  expect(page.url()).toBe(before);
  // The app's tab keeps the database: it is not told LangQuest moved.
  await page.waitForTimeout(2000); // sleep: proves a negative (the app is not told LangQuest moved); nothing to observe
  await expect(text(page, 'LangQuest moved to another tab')).toBeHidden();
  await expect(tab(page, 'work')).toBeVisible();
  await explorer.close();
});

test('WEB-006 The Inbox and what it opens, side by side @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await caughtUp(page, w, 'TRANS');
  await updates(page).click();
  await expect(text(page, 'Pick an update')).toBeVisible();
  await expect(text(page, 'What it is about opens here.')).toBeVisible();
  const rows = page.getByRole('button', { name: /Luke \d+:\d+–\d+/ }).locator('visible=true');
  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  const firstLabel = (await rows.nth(0).innerText()).match(/Luke \d+:\d+–\d+/)![0];
  const secondLabel = (await rows.nth(1).innerText()).match(/Luke \d+:\d+–\d+/)![0];
  await rows.nth(0).click();
  await expect(page.getByRole('heading', { name: firstLabel }).locator('visible=true').first()).toBeVisible();
  await expect(text(page, 'Pick an update')).toBeHidden();
  // The list stays on the left, with that row marked.
  const list = await rows.nth(0).boundingBox();
  const detail = await page.getByRole('heading', { name: firstLabel }).locator('visible=true').first().boundingBox();
  expect(list!.x).toBeLessThan(detail!.x);
  // The row's "current" is aria-current on the web (kit Card; aria-selected is not allowed on a button).
  // (Every update about that passage is marked, not only the one tapped.)
  await expect(rows.nth(0), 'the open update\'s row is marked current').toHaveAttribute('aria-current', 'true');
  await rows.nth(1).click();
  await expect(page.getByRole('heading', { name: secondLabel }).locator('visible=true').first()).toBeVisible();
  // At 900 px, a single column: an update opens full width, with Back.
  await page.setViewportSize({ width: 900, height: 900 });
  await toTab(page, 'work');
  await updates(page).click();
  await expect(text(page, 'Pick an update')).toBeHidden();
  await rows.nth(0).click();
  await expect(rows).toHaveCount(0);
  await expect(back(page)).toBeVisible();
});

test('WEB-008 Crumbs show only on wide windows @wide', async ({ page }) => {
  const w = world();
  await page.setViewportSize({ width: 390, height: 844 });
  await openAs(page, w, 'TRANS');
  const label = w.passages['P-NEEDS'].label;
  await openRecord(page, w, 'P-NEEDS');
  await text(page, 'Versions and history').click();
  await button(page, 'Open Version 1').click();
  await expect(title(page)).toHaveText('Version 1');
  await expect(page.getByRole('link').locator('visible=true')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(title(page)).toHaveText('Version 1');
  const crumbs = page.getByRole('link').locator('visible=true');
  await expect.poll(() => crumbs.count()).toBeGreaterThan(0);
  const names = await crumbs.allInnerTexts();
  test.info().annotations.push({ type: 'WEB-008 crumbs', description: names.join(' › ') });
  expect(names.join(' › ')).toContain(label);
  const before = await title(page).innerText();
  await page.getByRole('link', { name: label }).locator('visible=true').first().click();
  await expect(title(page)).not.toHaveText(before);
  await expect(text(page, label, false)).toBeVisible();
  // Alpha's report has the crumb "Reports" (RPT-013).
});

test('WEB-009 Sync\'s tiles in one row on a wide window @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openSync(page);
  const labels = ['waiting to upload', 'refused by the server', 'latest confirmed', 'local checkpoint'];
  const tiles = ['waiting', 'refused', 'confirmed', 'checkpoint'].map((id) => page.getByTestId(`sync-tile-${id}`).locator('visible=true').first());
  await expect(tiles[0]!).toBeVisible();
  const boxes = await Promise.all(tiles.map((t) => t.boundingBox()));
  for (const b of boxes) expect(Math.abs(b!.y - boxes[0]!.y)).toBeLessThan(4);
  // Labels are not cut off: each fits its tile.
  for (const l of labels) {
    const el = page.getByText(l, { exact: true }).locator('visible=true').first();
    expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const narrow = await Promise.all(tiles.map((t) => t.boundingBox()));
    return Math.abs(narrow[0]!.y - narrow[1]!.y) < 4 && narrow[2]!.y > narrow[0]!.y + 10;
  }, { message: 'two by two at phone width' }).toBe(true);
});

test('WEB-010 Where the tabs show @wide', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  const tabsOn = async () => (await tabsShown(page)).length > 0;
  const check = async (width: number) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    const phone = width < 768;
    await toTab(page, 'work');
    await expect.poll(() => tabsShown(page)).toEqual(phone ? ['work', 'map', 'me'] : ['work', 'map', 'reports', 'me']);
    await openRecord(page, w, 'P-NEEDS');
    expect(await tabsOn(), `record at ${width}`).toBe(!phone);
    await text(page, 'Versions and history').click();
    await button(page, 'Open Version 1').click();
    expect(await tabsOn(), `version at ${width}`).toBe(!phone);
    if (!phone) await expect(tab(page, 'map')).toHaveAttribute('aria-selected', 'true');
    await toTab(page, 'me');
    await text(page, 'More settings').click();
    expect(await tabsOn(), `more settings at ${width}`).toBe(!phone);
    await button(page, /^Sync[ ,.]/).click();
    expect(await tabsOn(), `sync at ${width}`).toBe(!phone);
    if (!phone) {
      await expect(tab(page, 'me')).toHaveAttribute('aria-selected', 'true');
      // A tab from here returns to its first screen.
      await tab(page, 'me').click();
      await expect(title(page)).toHaveText('Me');
    }
    await toTab(page, 'me');
    await button(page, /^Tom Translator/).click();
    expect(await tabsOn(), `edit profile at ${width}`).toBe(!phone);
    await toTab(page, 'me');
    await button(page, 'Sign out').click();
    await expect(text(page, 'Sign out?')).toBeVisible();
    expect(await tabsOn(), `sign out at ${width}`).toBe(false);
    await button(page, 'Cancel').click();
    await openRecord(page, w, 'P-NEW');
    await page.getByRole('button', { name: /^(Record|\d+\. Record\.)/ }).locator('visible=true').first().click();
    await expect(text(page, /^Recording Version \d+/)).toBeVisible();
    expect(await tabsOn(), `recording at ${width}`).toBe(false);
    await byId(page, 'header-close').click();
  };
  await check(390);
  await check(1280);
});

// ---- One tab at a time --------------------------------------------------------------------

test('WEB-012 A second tab says LangQuest is open elsewhere', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  const second = await context.newPage();
  await second.goto('/');
  await expect(text(second, 'LangQuest is open in another tab')).toBeVisible({ timeout: 30_000 });
  await expect(text(second, 'It works in one tab at a time, so your recordings and changes stay in one place. Use it here, or go back to the other tab.')).toBeVisible();
  await expect(button(second, 'Use it here')).toBeVisible();
  await expect(text(second, 'Sign In')).toBeHidden();
  await page.bringToFront();
  await tab(page, 'me').click();
  await expect(title(page)).toHaveText('Me');
  await second.close();
});

test('WEB-013 "Use it here" moves the app to the new tab', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  // Tab 1 has no connection, and a note waiting.
  await serverOff(page, true);
  await addNote(page, w, 'P-SUBMITTED', 'WEB-013 moved with the tab');
  expect(await waiting(page, w.orgId)).toBeGreaterThan(0);
  const second = await context.newPage();
  await second.goto('/');
  await expect(text(second, 'LangQuest is open in another tab')).toBeVisible({ timeout: 30_000 });
  await button(second, 'Use it here').click();
  await expect(text(second, 'Moving LangQuest to this tab…').or(tab(second, 'work')).first()).toBeVisible();
  await waitForApp(second);
  await expect(tab(second, 'work')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'LangQuest moved to another tab')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'It works in one tab at a time, so your recordings and changes stay in one place. Use it here, or go back to the other tab.')).toBeVisible();
  // Tab 2 is online: the note that waited in Tab 1 goes, once.
  await expect.poll(() => waiting(second, w.orgId), { timeout: 30_000 }).toBe(0);
  const { languageAs } = await import('./sync-helpers');
  const coord = await languageAs(w, 'COORD');
  const notes = Object.values(coord.getState().notes ?? {}).filter((n) => (n as { text?: { value?: string } | string }).text !== undefined
    && JSON.stringify(n).includes('WEB-013 moved with the tab'));
  expect(notes).toHaveLength(1);
  // And back to Tab 1 the same way.
  await serverOff(page, false);
  await button(page, 'Use it here').click();
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await expect(text(second, 'LangQuest moved to another tab')).toBeVisible({ timeout: 30_000 });
});

test('WEB-015 Leaving with work unsent asks first', async ({ browser }) => {
  const w = world();
  const asked: string[] = [];
  const one = await deviceAs(browser, w, 'TRANS');
  await expect(tab(one.page, 'work')).toBeVisible({ timeout: 60_000 });
  one.page.on('dialog', (d) => { asked.push(d.type()); void d.dismiss(); });
  await one.page.close({ runBeforeUnload: true });
  await one.context.waitForEvent('close', { timeout: 1000 }).catch(() => undefined);
  expect(asked).toEqual([]);
  // Offline, with a note waiting: closing or reloading asks.
  const page = await one.context.newPage();
  page.on('dialog', (d) => { asked.push(d.type()); void d.dismiss(); });
  await page.goto('/');
  await waitForApp(page);
  await caughtUp(page, w, 'TRANS');
  await setOffline(one.context, true);
  await addNote(page, w, 'P-SUBMITTED', 'WEB-015 unsent');
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => asked).toEqual(['beforeunload']);
  // Stayed: online again, it sends, and nothing is asked.
  expect(page.isClosed()).toBe(false);
  await setOffline(one.context, false);
  await expect.poll(() => waiting(page, w.orgId), { timeout: 30_000 }).toBe(0);
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(asked).toEqual(['beforeunload']);
  await one.context.close();
});

// ---- The address bar and history ----------------------------------------------------------

test('WEB-016 The browser\'s Back is the app\'s Back', async ({ page }) => {
  const w = world();
  await page.goto('about:blank');
  const state = browserStateFor(w, 'TRANS');
  await page.addInitScript((entries) => { for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, state);
  await page.goto('/');
  await waitForApp(page);
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await caughtUp(page, w, 'TRANS');
  const label = w.passages['P-NEEDS'].label;
  await openFromMyWork(page, label);
  // Its Version 1, from the record's Record step.
  await page.getByRole('button', { name: /^\d+\. Record\. Version 1/ }).locator('visible=true').first().click();
  await expect(title(page)).toHaveText('Version 1');
  await page.goBack();
  await expect(title(page)).toHaveText(label);
  await page.goBack();
  // My Work's title is a home title, not a level-1 heading: find it by name.
  await expect(page.getByRole('heading', { name: 'My Work' }).locator('visible=true').first()).toBeVisible();
  await page.goBack();
  await expect.poll(() => page.url()).toBe('about:blank');
  await page.goForward();
  await waitForApp(page);
  await expect(tab(page, 'work').or(text(page, 'LangQuest is open in another tab')).first()).toBeVisible({ timeout: 60_000 });
  test.info().annotations.push({ type: 'WEB-016 forward', description: `${page.url()}: ${(await screenText(page)).slice(0, 120)}` });
});

const expectPath = async (page: Page, p: string) => expect.poll(() => path(page)).toBe(p);

test('WEB-017 ADMIN The address names the section @wide', async ({ browser }) => {
  const w = world();
  const admin = await wideAs(browser, w, 'ADMIN');
  await expect(tab(admin.page, 'work')).toBeVisible({ timeout: 60_000 });
  for (const [id, p] of [['work', '/work'], ['map', '/map'], ['reports', '/reports'], ['manage', '/manage'], ['me', '/settings']] as const) {
    await tab(admin.page, id).click();
    await expectPath(admin.page, p);
  }
  await admin.context.close();
});

test('WEB-018 TRANS A refresh returns to the section', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openSync(page);
  await page.reload();
  await waitForApp(page);
  await expect(title(page)).toHaveText('Me', { timeout: 60_000 });
  // The address follows the screen a render later.
  await expect.poll(() => path(page)).toBe('/settings');
  await tab(page, 'map').click();
  // The address follows the tab a render later; a person refreshes after seeing the map.
  await expect.poll(() => path(page)).toBe('/map/language');
  await page.reload();
  await waitForApp(page);
  await expect(page.getByTestId('map-search').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
  // The address follows the screen a render later.
  await expect.poll(() => path(page)).toBe('/map/language');
});

test('WEB-018 ADMIN A refresh returns to the section', async ({ browser }) => {
  const w = world();
  // ADMIN on a wide window: Reports, then Pace, then a refresh: Reports on Overview.
  const admin = await wideAs(browser, w, 'ADMIN');
  await expect(tab(admin.page, 'reports')).toBeVisible({ timeout: 60_000 });
  await tab(admin.page, 'reports').click();
  await expect(title(admin.page)).toHaveText('Overview', { timeout: 60_000 });
  await admin.page.getByRole('button', { name: 'Pace', exact: true }).locator('visible=true').first().click();
  await expect(title(admin.page)).toHaveText('Pace');
  await admin.page.reload();
  await waitForApp(admin.page);
  await expect(title(admin.page)).toHaveText('Overview', { timeout: 60_000 });
  await admin.context.close();
});

test('WEB-018 TRANS signed out: a refresh returns to Sign In, then the section', async ({ browser }) => {
  const w = world();
  // Signed out, /settings: Sign In first, then Me.
  const out = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await quietReloads(out);
  const guest = await out.newPage();
  guest.on('framenavigated', (f) => { if (f === guest.mainFrame()) test.info().annotations.push({ type: 'WEB-018 navigated', description: f.url() }); });
  await guest.goto('/settings');
  await expect(guest.getByText('Create Account', { exact: true }).first()).toBeVisible({ timeout: 120_000 });
  await field(guest, 'Email or sign-in name').fill(w.accounts.TRANS.email);
  await field(guest, 'Password').fill(w.accounts.TRANS.password!);
  await primary(guest).click();
  await expect(title(guest)).toHaveText('Me', { timeout: 60_000 });
  await out.close();
});

async function openAtPath(browser: Browser, w: UiWorld, who: AccountKey, p: string, width = 430) {
  const d = await deviceAs(browser, w, who, { path: p, width, height: width < 768 ? 932 : 900 });
  // The app lands on its first screen (a tab bar, or Join your team for no organization) before the redirect is judged.
  await expect(d.page.locator('[data-testid^="tab-"]').locator('visible=true').first().or(text(d.page, 'Join your team', false)).first()).toBeVisible({ timeout: 60_000 });
  return d;
}

const NO_PERMISSION = "You don't have permission to open that.";
test('WEB-019 TRANS A refresh never opens a section the person may not open', async ({ browser }) => {
  const w = world();
  // /manage: My Work, and the address follows.
  const a = await openAtPath(browser, w, 'TRANS', '/manage');
  await expect(title(a.page)).toHaveText('My Work', { timeout: 60_000 });
  await expect.poll(() => path(a.page)).toBe('/work');
  await expect(text(a.page, NO_PERMISSION)).toBeHidden();
  await a.context.close();
  // At 390, /reports: My Work.
  const b = await openAtPath(browser, w, 'TRANS', '/reports', 390);
  await expect(title(b.page)).toHaveText('My Work', { timeout: 60_000 });
  await b.context.close();
});

test('WEB-019 NOORG A refresh never opens a section the person may not open', async ({ browser }) => {
  const w = world();
  // Welcome seen, as one that left an organization would be, /settings: Join your team, /.
  // Known issue (2026-10-12): the check counts Me, Map and Inbox as sections an account with no organization may open (App.tsx).
  const d = await openAtPath(browser, w, 'NOORG', '/settings');
  await expect.soft(text(d.page, 'Join your team', false), 'NOORG lands on Join your team').toBeVisible({ timeout: 30_000 });
  await expect.soft.poll(() => path(d.page)).toBe('/');
  await expect(d.page.getByText('This screen could not open')).toHaveCount(0);
  await d.context.close();
});

test('WEB-020 The tab title names the screen', async ({ page }) => {
  const w = world();
  await openAsOnce(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveTitle('My Work · LangQuest');
  await openRecord(page, w, 'P-NEEDS');
  await expect(page).toHaveTitle('Passage Record · LangQuest');
  await toTab(page, 'me');
  await expect(page).toHaveTitle('Me · LangQuest');
  await text(page, 'More settings').click();
  await expect(page).toHaveTitle('More settings · LangQuest');
  await button(page, /^Sync[ ,.]/).click();
  await expect(page).toHaveTitle('Sync · LangQuest');
  await back(page).click();
  await button(page, /^Switch Organization/).click();
  await expect(page).toHaveTitle('Switch Org · LangQuest');
  await toTab(page, 'me');
  await button(page, 'Sign out').click();
  await button(page, 'Sign Out').click();
  await expect(page.getByText('Create Account', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveTitle('Sign In · LangQuest');
});

// ---- What the web does differently --------------------------------------------------------

test('WEB-021 No Notifications row on the web', async ({ page }) => {
  const w = world();
  let asked = false;
  await page.exposeFunction('__notificationAsked', () => { asked = true; });
  await page.addInitScript(() => {
    const N = (globalThis as { Notification?: { requestPermission?: () => Promise<string> } }).Notification;
    if (N) N.requestPermission = async () => { await (globalThis as unknown as { __notificationAsked(): Promise<void> }).__notificationAsked(); return 'denied'; };
  });
  await openAs(page, w, 'TRANS');
  await toTab(page, 'me');
  await text(page, 'More settings').click();
  await expect(title(page)).toHaveText('More settings');
  await expect(text(page, 'Notifications')).toBeHidden();
  const body = await screenText(page);
  expect(body.indexOf('Switch Organization')).toBeGreaterThan(body.indexOf(w.accounts.TRANS.name));
  await toTab(page, 'work');
  await updates(page).click();
  await expect(title(page)).toHaveText('Inbox');
  expect(asked).toBe(false);
});

test('WEB-022 Sharing without a share sheet copies instead', async ({ page, context }) => {
  const w = world();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await openAs(page, w, 'COORD');
  await tab(page, 'manage').click();
  await expect(text(page, w.orgName)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^Alpha / }).locator('visible=true').first().click();
  await text(page, 'People').click();
  await button(page, 'Invite').click();
  await text(page, 'Translate').click();
  await text(page, 'One person, by name').click();
  await field(page, 'Name').fill('Web Share Person');
  await primary(page).click();
  await expect(text(page, 'Step 3 of 3 — QR code')).toBeVisible({ timeout: 30_000 });
  const token = (await text(page, /^[0-9a-f]{64}$/).textContent())!.trim();
  await text(page, 'Share invite').click();
  await expectToast(page, 'Invite link copied. Paste it into a message.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^https?:\/\//);
  expect(copied).toContain(token);
  await expect(text(page, token)).toBeVisible();
});

/**
 * What this origin keeps once the page has opened again after a sign-out:
 * local and session storage, IndexedDB, the files outside SQLite's pool
 * (recordings, library files), and the events in the app's log. The page
 * that opens after it makes a new, empty database in SQLite's pool, so the
 * pool itself is judged by the log being empty.
 */
async function browserTraces(page: Page): Promise<{ local: string[]; session: string[]; idb: string[]; files: string[]; events: number }> {
  await waitForApp(page);
  return page.evaluate(async () => {
    type Dir = { entries(): AsyncIterable<[string, { kind: string } & Dir]> };
    const files: string[] = [];
    const walk = async (dir: Dir, at: string) => {
      for await (const [name, h] of dir.entries()) {
        if (at === '' && name === 'expo-sqlite') continue;
        if (h.kind === 'directory') await walk(h, `${at}${name}/`);
        else files.push(`${at}${name}`);
      }
    };
    try { await walk(await navigator.storage.getDirectory() as unknown as Dir, ''); } catch { /* no origin file system */ }
    const idb = ((await indexedDB.databases?.()) ?? []).map((d) => d.name ?? '');
    const log = (globalThis as { __langquestLog?: { select(sql: string): Promise<unknown[]> } }).__langquestLog;
    const events = log ? ((await log.select('select count(*) as n from events')) as { n: number }[])[0]!.n : -1;
    return { local: Object.keys(localStorage), session: Object.keys(sessionStorage), idb, files, events };
  });
}

/** Only the traces that remain, so a failure names them (an empty object when the browser forgot everything). */
function leftBehind(t: Awaited<ReturnType<typeof browserTraces>>): Partial<Awaited<ReturnType<typeof browserTraces>>> {
  return Object.fromEntries(Object.entries(t).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== 0)));
}

test('WEB-023 Signing out forgets this browser @p0', async ({ page }) => {
  const w = world();
  await openAsOnce(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  // Español, picked on this browser (the app reloads into it).
  await toTab(page, 'me');
  await button(page, /^Language/).click();
  await page.getByText('Español', { exact: false }).locator('visible=true').first().click();
  await expect(tab(page, 'me')).toContainText('Yo', { timeout: 60_000 });
  await waitForApp(page);
  // Step 1, in Spanish: "Cerrar sesión", then the question, which names what the browser forgets.
  await tab(page, 'me').click();
  await button(page, 'Cerrar sesión').click();
  await expect(text(page, '¿Cerrar sesión?')).toBeVisible();
  // Step 2.
  await primary(page).click();
  // Sign In, in the browser's language: the language picked here is forgotten too.
  await expect(page.getByText('Create Account', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  // The browser forgot before the page reloaded (a download writing a file then no longer keeps the files: webFiles.ts). Nothing of TRANS's is left; a failure lists what is.
  await expect.poll(async () => leftBehind(await browserTraces(page)), { timeout: 15_000, message: 'what this browser still holds of TRANS\'s after signing out' }).toEqual({});
  const traces = await browserTraces(page);
  expect(traces.local).toEqual([]);
  expect(traces.session).toEqual([]);
  expect(traces.idb).toEqual([]);
  expect(traces.files).toEqual([]);
  expect(traces.events).toBe(0);
  // REV signs in: nothing of TRANS's shows.
  await field(page, 'Email or sign-in name').fill(w.accounts.REV.email);
  await field(page, 'Password').fill(w.accounts.REV.password!);
  await primary(page).click();
  // A browser that never held REV's sign-in may show REV's Welcome first (a member who joined by invite).
  await expect(tab(page, 'work').or(button(page, 'Get started')).first()).toBeVisible({ timeout: 60_000 });
  if (await button(page, 'Get started').isVisible().catch(() => false)) await button(page, 'Get started').click();
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  await tab(page, 'me').click();
  await expect(text(page, w.accounts.REV.name)).toBeVisible();
  expect(await screenText(page)).not.toContain(w.accounts.TRANS.name);
});

test('WEB-024 Signing out of the web offline', async ({ page, context }) => {
  const w = world();
  await openAsOnce(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await setOffline(context, true);
  await toTab(page, 'me');
  await button(page, 'Sign out').click();
  await expect(text(page, 'Sign out?')).toBeVisible();
  await button(page, 'Sign Out').click();
  // Forgetting reloads the page, and a browser offline cannot load it (WEB-027): the app is gone, not Sign In.
  // The signal that it forgot: the reload ended on the browser's error page.
  await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/^chrome-error:/);
  // The browser forgot anyway: online again, nothing of TRANS's is left.
  await setOffline(context, false);
  await page.reload();
  await expect(page.getByText('Create Account', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const traces = await browserTraces(page);
  expect(traces.local).toEqual([]);
  expect(traces.idb).toEqual([]);
  expect(traces.files).toEqual([]);
  expect(traces.events).toBe(0);
});

test('WEB-026 The update banner waits while recording', async ({ page }) => {
  const w = world();
  let build = 'same';
  let asked = 0;
  await page.route('**/version.json', async (route) => { asked++; await route.fulfill({ json: { build } }); });
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  // A Metro page has no build id (webBuild.ts) and never asks; the export (the default target) does.
  test.skip(process.env['UI_TARGET'] === 'dev', 'Metro\'s dev page has no build id (EXPO_PUBLIC_BUILD_ID): run on the export (the default UI_TARGET).');
  await expect.poll(() => asked, { message: 'the export asks version.json for its build' }).toBeGreaterThan(0);
  build = 'ui-test-newer-build';
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const banner = button(page, 'A new version of LangQuest is ready. Reload to use it.');
  await expect(banner).toBeVisible();
  await openRecord(page, w, 'P-NEW');
  await primary(page).click();
  await byId(page, 'record-button').click();
  await expect(byId(page, 'record-button')).toHaveAttribute('aria-label', 'Stop recording');
  let reloaded = false;
  page.once('load', () => { reloaded = true; });
  await banner.click();
  await page.waitForTimeout(1500); // sleep: proves a negative (tapping Reload while recording must not reload); nothing to observe
  expect(reloaded).toBe(false);
  await expect(byId(page, 'record-button')).toHaveAttribute('aria-label', 'Stop recording');
  await byId(page, 'record-button').click();
  // The take is saved before a reload is allowed (isRecording covers the save).
  await expect(text(page, 'Part 1 recorded · drag up to see them')).toBeVisible();
  page.on('dialog', (d) => void d.accept());
  // A tap while the stopped take is still being saved does nothing (isRecording covers the save): tap again until the page reloads.
  await expect(async () => {
    const load = page.waitForEvent('load', { timeout: 3000 });
    await banner.click({ timeout: 2000 });
    await load;
  }).toPass({ timeout: 30_000 });
});

test('WEB-027 The web app needs a connection to open', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await setOffline(context, true);
  await addNote(page, w, 'P-SUBMITTED', 'WEB-027 kept through a reload');
  expect(await waiting(page, w.orgId)).toBeGreaterThan(0);
  page.on('dialog', (d) => void d.accept());
  await page.reload().catch(() => undefined);
  // The browser's own offline page, not the app.
  await expect(tab(page, 'work')).toHaveCount(0);
  await setOffline(context, false);
  await page.reload();
  await waitForApp(page);
  await expect(tab(page, 'work').or(tab(page, 'map')).first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => waiting(page, w.orgId), { timeout: 30_000 }).toBe(0);
  await toTab(page, 'work');
  await expect(syncChip(page)).toBeHidden({ timeout: 30_000 });
});
