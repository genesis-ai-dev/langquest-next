// 03 Home and navigation (docs/ui-test-suite/03-home-and-navigation.md, NAV):
// tabs per role, My Work, the bell and the Inbox, the viewer's overview,
// permission gates, Back and ✕, and the sync chip. One world for the file;
// tests run in ID order and each says what it leaves behind. NAV-017 and
// NAV-033 change too much of the world and live in
// 03-home-and-navigation-b.spec.ts; phone-only tests are Maestro flows
// (apps/mobile/test/maestro/flows/NAV-*.yaml).
import type { Browser, Page } from '@playwright/test';
import {
  askTeam, askToJoin, createEmptyOrg, headerTitle, labels, leaveBookWaiting, litTab, settled
} from './nav-helpers';
import {
  back, button, byId, expect, openAs, primary, screenText, syncNow, tab, tabsShown, test, text, useWorld,
  type AccountKey, type PassageKey, type UiWorld
} from './support';

const world = useWorld();

/** Others' edits make the shared dev server hot-reload open pages, which then find the storage lock held; tests never take them. */
async function open(page: Page, who: AccountKey, opts: { language?: 'A' | 'B' | 'C'; path?: string } = {}): Promise<void> {
  await page.context().routeWebSocket(/\/hot/, () => { /* no hot reloads */ });
  await openAs(page, world(), who, opts);
  if (who !== 'NOORG') await expect(page.locator('[data-testid^="tab-"]').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
  await settled(page);
  // Everything the server has, in: My Work draws while the language's pages still come down.
  await syncNow(page);
}

// What each open page showed when a test failed (the shared results folder is cleared by other runs).
test.afterEach(async ({ browser }, info) => {
  if (info.status === info.expectedStatus) return;
  for (const c of browser.contexts()) for (const p of c.pages()) console.log(`[${info.title}] SCREEN:`, await screenText(p).catch(() => '(closed)'));
});

/** A fresh device for `who`, at phone width unless told. */
async function device(browser: Browser, who: AccountKey, width = 430) {
  const context = await browser.newContext({ viewport: { width, height: 932 } });
  const page = await context.newPage();
  await open(page, who);
  return { context, page };
}

const W = () => world();
const label = (k: PassageKey) => W().passages[k].label;
const orgSub = () => `${W().orgName} · All languages`;
/** P-NEW's due date as the app words it: 14 days after the world was built, "Oct 27". */
const dueDay = () => new Date(Date.parse(W().builtAt) + 14 * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Open a passage from the Map by searching its reference, as a person would (workers' Map is their language). */
async function openByMap(page: Page, k: PassageKey): Promise<void> {
  await tab(page, 'map').click();
  if (await headerTitle(page) === 'Progress') await button(page, /^Alpha: /).click();
  await page.getByPlaceholder('Find “John 3”').locator('visible=true').fill(W().passages[k].ref);
  await page.getByRole('button', { name: new RegExp(`^${label(k)}\\.`) }).locator('visible=true').first().click();
  await expect.poll(() => headerTitle(page)).toBe(label(k));
}

/** The visible text of the screen on top; screens under it in the stack are not drawn. */
const screen = (page: Page) => screenText(page);

const noBack = async (page: Page) => {
  await expect(byId(page, 'header-back')).toHaveCount(0);
  await expect(byId(page, 'header-close')).toHaveCount(0);
};

// ---- Tabs and where they go ------------------------------------------------------------

const PHONE_TABS: Record<string, { home: string; tabs: string[]; lit: string }> = {
  ADMIN: { home: 'My Work', tabs: ['work', 'map', 'manage', 'me'], lit: 'work' },
  COORD: { home: 'My Work', tabs: ['work', 'map', 'manage', 'me'], lit: 'work' },
  LADMIN: { home: 'My Work', tabs: ['work', 'map', 'manage', 'me'], lit: 'work' },
  TRANS: { home: 'My Work', tabs: ['work', 'map', 'me'], lit: 'work' },
  REV: { home: 'My Work', tabs: ['work', 'map', 'me'], lit: 'work' },
  TREV: { home: 'My Work', tabs: ['work', 'map', 'me'], lit: 'work' },
  VIEW: { home: 'Progress', tabs: ['map', 'inbox', 'me'], lit: 'map' },
  KEPT: { home: 'My Work', tabs: ['work', 'map', 'me'], lit: 'work' }
};

test('NAV-001 Tabs on a phone, per role @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const [who, want] of Object.entries(PHONE_TABS)) {
    const { context, page } = await device(browser, who as AccountKey);
    await expect.poll(() => headerTitle(page), { message: `${who}'s home` }).toBe(want.home);
    await expect.poll(() => tabsShown(page), { message: `${who}'s tabs` }).toEqual(want.tabs);
    await expect.poll(() => litTab(page), { message: `${who}'s lit tab` }).toBe(want.lit);
    if (want.tabs.includes('work')) await expect(tab(page, 'work')).toHaveAttribute('aria-label', 'Work');
    await context.close();
  }
  const { context, page } = await device(browser, 'NOORG');
  await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => tabsShown(page)).toEqual([]);
  await context.close();
});

test('NAV-002 What the Map tab opens, per role @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['ADMIN', 'COORD', 'LADMIN', 'VIEW', 'TRANS', 'REV', 'TREV', 'KEPT'] as const) {
    const { context, page } = await device(browser, who);
    await tab(page, 'map').click();
    if (['ADMIN', 'COORD', 'LADMIN', 'VIEW'].includes(who)) {
      await expect.poll(() => headerTitle(page), { message: who }).toBe('Progress');
      await expect(text(page, orgSub())).toBeVisible();
    } else {
      await expect.poll(() => headerTitle(page), { message: who }).toBe('Alpha');
      await expect(page.getByPlaceholder('Find “John 3”').locator('visible=true')).toBeVisible();
    }
    await noBack(page);
    await expect.poll(() => litTab(page), { message: who }).toBe('map');
    await context.close();
  }
});

test('NAV-003 What the Manage tab opens @p0', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const who of ['ADMIN', 'COORD', 'LADMIN'] as const) {
    const { context, page } = await device(browser, who);
    await tab(page, 'manage').click();
    if (who === 'LADMIN') {
      await expect.poll(() => headerTitle(page)).toBe('Alpha');
      const words = await screen(page);
      expect(words).not.toContain('Bravo');
      expect(words).not.toContain('Content templates, reference, review flows, roles');
    } else {
      await expect.poll(() => headerTitle(page), { message: who }).toBe(W().orgName);
      await expect(text(page, 'Alpha')).toBeVisible();
    }
    // Tapping the tab again on its own home does nothing: the same screen stays, not a new one.
    const heading = await page.getByRole('heading').locator('visible=true').first().elementHandle();
    await tab(page, 'manage').click();
    await page.waitForTimeout(500);
    expect(await heading!.evaluate((e) => e.isConnected), `${who}: the home was not redrawn`).toBe(true);
    await context.close();
  }
});

test('NAV-004 The Reports tab shows only on wide windows @wide', async ({ browser }) => {
  test.setTimeout(300_000);
  const wide: Record<string, string[]> = {
    ADMIN: ['work', 'map', 'reports', 'manage', 'me'], TRANS: ['work', 'map', 'reports', 'me'], VIEW: ['map', 'reports', 'inbox', 'me']
  };
  for (const [who, tabs] of Object.entries(wide)) {
    const { context, page } = await device(browser, who as AccountKey, 390);
    await expect.poll(() => tabsShown(page), { message: `${who} at 390 px` }).not.toContain('reports');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(() => tabsShown(page), { message: `${who} wide` }).toEqual(tabs);
    await tab(page, 'reports').click();
    await page.setViewportSize({ width: 390, height: 900 });
    await expect.poll(() => tabsShown(page), { message: `${who} narrowed` }).not.toContain('reports');
    await expect(text(page, 'This screen could not open')).toHaveCount(0);
    await context.close();
  }
});

test('NAV-005 Pressing a tab resets its stack', async ({ browser }) => {
  test.setTimeout(300_000);
  const t = await device(browser, 'TRANS');
  await tab(t.page, 'map').click();
  await button(t.page, /^Luke\./).click();
  await button(t.page, /^Chapter 15:/).click();
  await button(t.page, new RegExp(`^${label('P-CHECK')}\\.`)).click();
  await expect.poll(() => headerTitle(t.page)).toBe(label('P-CHECK'));
  await expect.poll(() => tabsShown(t.page)).toEqual([]);
  await back(t.page).click();
  await expect.poll(() => headerTitle(t.page)).toBe('Luke');
  await tab(t.page, 'work').click();
  await tab(t.page, 'map').click();
  await expect.poll(() => headerTitle(t.page)).toBe('Alpha');
  await t.context.close();

  const c = await device(browser, 'COORD');
  await tab(c.page, 'map').click();
  await button(c.page, /^Alpha: /).click();
  await button(c.page, /^Luke\./).click();
  await expect.poll(() => headerTitle(c.page)).toBe('Luke');
  await tab(c.page, 'map').click();
  await expect.poll(() => headerTitle(c.page)).toBe('Progress');
  await c.context.close();
});

test('NAV-006 The tab bar is hidden on a passage and its pages on a phone', async ({ page }) => {
  await open(page, 'TRANS');
  await primary(page).click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-Q4'));
  await expect.poll(() => tabsShown(page), { message: 'passage record' }).toEqual([]);
  await back(page).click();
  await openByMap(page, 'P-SUBMITTED');
  await expect.poll(() => tabsShown(page), { message: 'passage record' }).toEqual([]);
  await text(page, 'Versions and history').click();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect.poll(() => tabsShown(page), { message: 'versions' }).toEqual([]);
  await byId(page, 'header-close').click();
  await text(page, 'Something else?').click();
  await text(page, 'What helps here').click();
  await expect(byId(page, 'header-back').or(byId(page, 'header-close')).first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect.poll(() => tabsShown(page), { message: 'what helps here' }).toEqual([]);
  // Back up to the map: the tabs come back on the map, the chapters, My Work and the Inbox.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(600);
    if ((await tabsShown(page)).length) break;
    await back(page).click();
  }
  await expect.poll(() => tabsShown(page), { message: 'the map' }).toEqual(['work', 'map', 'me']);
  await page.getByPlaceholder('Find “John 3”').locator('visible=true').fill('');
  await button(page, /^Luke\./).click();
  await expect.poll(() => tabsShown(page), { message: 'chapters' }).toEqual(['work', 'map', 'me']);
  await tab(page, 'work').click();
  await expect.poll(() => tabsShown(page), { message: 'My Work' }).toEqual(['work', 'map', 'me']);
  await button(page, /^Updates/).click();
  await expect.poll(() => headerTitle(page)).toBe('Inbox');
  await expect.poll(() => tabsShown(page), { message: 'Inbox' }).toEqual(['work', 'map', 'me']);
});

test('NAV-007 Task screens hide the tabs and close with ✕', async ({ page }) => {
  await open(page, 'TRANS');
  // P-ASIDE: its Peer check is not asked yet, so "Someone else should do this" is offered.
  await openByMap(page, 'P-ASIDE');
  await expect(byId(page, 'header-back')).toBeVisible();
  await text(page, 'Something else?').click();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect.poll(() => tabsShown(page)).toEqual([]);
  await text(page, 'Someone else should do this').click();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect.poll(() => tabsShown(page)).toEqual([]);
  // Wide too: a task screen has no rail or sidebar at any width.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(500);
  await expect.poll(() => tabsShown(page), { message: 'Ask someone, wide' }).toEqual([]);
  await page.setViewportSize({ width: 430, height: 932 });
  // ✕ returns to where Ask someone was opened: the record's Something else? page, then its path.
  await byId(page, 'header-close').click();
  await expect.poll(() => headerTitle(page)).toBe('Something else?');
  await expect.poll(() => tabsShown(page), { message: 'Something else?' }).toEqual([]);
  await byId(page, 'header-close').click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-ASIDE'));
  await expect(byId(page, 'header-back')).toBeVisible();

  const rev = await device(page.context().browser()!, 'REV');
  await openByMap(rev.page, 'P-SUBMITTED');
  await primary(rev.page).click();
  await expect(byId(rev.page, 'header-close')).toBeVisible();
  await expect.poll(() => tabsShown(rev.page)).toEqual([]);
  await byId(rev.page, 'header-close').click();
  await expect.poll(() => headerTitle(rev.page)).toBe(label('P-SUBMITTED'));
  await rev.context.close();
});

test('NAV-008 Which tab is lit @wide', async ({ browser }) => {
  test.setTimeout(300_000);
  const t = await device(browser, 'TRANS', 1280);
  await button(t.page, /^Updates/).click();
  await expect.poll(() => headerTitle(t.page)).toBe('Inbox');
  await expect.poll(() => litTab(t.page), { message: 'Inbox from the bell' }).toBe('work');
  await back(t.page).click();
  await tab(t.page, 'map').click();
  await button(t.page, /^Luke\./).click();
  await expect.poll(() => litTab(t.page), { message: 'chapters' }).toBe('map');
  await button(t.page, /^Chapter 16:/).click();
  await button(t.page, new RegExp(`^${label('P-DONE')}\\.`)).click();
  await expect(text(t.page, 'Versions and history')).toBeVisible();
  await expect.poll(() => litTab(t.page), { message: 'passage from the map' }).toBe('map');
  await t.context.close();

  const v = await device(browser, 'VIEW', 1280);
  await button(v.page, /^Alpha: /).click();
  await expect.poll(() => litTab(v.page)).toBe('map');
  await button(v.page, /^Luke\./).click();
  await expect.poll(() => litTab(v.page)).toBe('map');
  await button(v.page, /^Chapter 16:/).click();
  await button(v.page, new RegExp(`^${label('P-DONE')}\\.`)).click();
  await expect(text(v.page, 'Versions and history')).toBeVisible();
  await expect.poll(() => litTab(v.page)).toBe('map');
  await v.context.close();
});

// ---- My Work ------------------------------------------------------------------------------

test('NAV-010 My Work\'s header @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'REV', 'TREV', 'KEPT'] as const) {
    const { context, page } = await device(browser, who);
    expect(await headerTitle(page), who).toBe('My Work');
    await expect(text(page, `Alpha · ${W().orgName}`)).toBeVisible();
    await noBack(page);
    await expect(button(page, /^Updates(, \d+ new)?$/)).toBeVisible();
    for (const chip of ['Offline', 'Not syncing', /^\d+ to send$/]) await expect(page.getByRole('button', { name: chip }).locator('visible=true'), `${who}: no sync chip`).toHaveCount(0);
    await context.close();
  }
});

test('NAV-011 Next for you: a record request opens the passage @p0', async ({ page }) => {
  await open(page, 'TRANS');
  await expect(text(page, 'Next for you')).toBeVisible();
  // Requests newest first (core highlightsFor): P-Q4 was asked last, P-NEW first.
  await expect(page.getByRole('heading', { name: label('P-Q4') }).locator('visible=true')).toBeVisible();
  await expect(text(page, 'Record it · asked by Cora Coordinator')).toBeVisible();
  await button(page, /^\d+ more for you$/).click();
  await expect(text(page, label('P-NEW'))).toBeVisible();
  await expect(text(page, `Record · due ${dueDay()}`)).toBeVisible();
  await primary(page).click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-Q4'));
  await expect(primary(page)).toHaveText('Record');
  await back(page).click();
  await expect.poll(() => headerTitle(page)).toBe('My Work');
});

test('NAV-012 Then: three rows, and the rest one tap on', async ({ page }) => {
  await open(page, 'TRANS');
  await expect(text(page, 'Then')).toBeVisible();
  const rows = ['P-Q3', 'P-Q2', 'P-Q1'] as const;
  for (const k of rows) await expect(text(page, label(k))).toBeVisible();
  for (const k of ['P-NEW', 'P-DRAFT', 'P-NEEDS'] as const) await expect(text(page, label(k))).toHaveCount(0);
  await expect(text(page, 'Record · asked by Cora Coordinator')).toBeVisible();
  await button(page, '3 more for you').click();
  const all = await screen(page);
  const at = (k: PassageKey) => all.indexOf(label(k));
  for (const k of [...rows, 'P-NEW', 'P-DRAFT', 'P-NEEDS'] as const) expect(at(k), k).toBeGreaterThan(0);
  // Requests, then drafts, then feedback.
  expect(at('P-NEW')).toBeLessThan(at('P-DRAFT'));
  expect(at('P-DRAFT')).toBeLessThan(at('P-NEEDS'));
  expect(all).toContain(`${label('P-NEW')} Record · due ${dueDay()}`);
  expect(all).toContain(`${label('P-DRAFT')} Finish recording`);
  expect(all).toMatch(new RegExp(`${label('P-NEEDS')} Feedback to hear(?! ·)`));
  await expect(button(page, 'Fewer')).toBeVisible();
  await button(page, 'Fewer').click();
  await expect(text(page, label('P-NEW'))).toHaveCount(0);
  await button(page, '3 more for you').click();
  await text(page, label('P-NEEDS')).click();
  await expect(primary(page)).toHaveText('Hear the feedback');
  await back(page).click();
  if (await text(page, label('P-DRAFT')).count() === 0) await button(page, '3 more for you').click();
  await text(page, label('P-DRAFT')).click();
  await expect(primary(page)).toHaveText('Continue recording');
});

test('NAV-013 Next for you: a check, and a back translation @p0', async ({ page }) => {
  await open(page, 'REV');
  // TRANS asked the Back Translation of P-BT after the Peer Review of P-SUBMITTED: the newer leads.
  await expect(page.getByRole('heading', { name: label('P-BT') }).locator('visible=true')).toBeVisible();
  await expect(text(page, 'Back translation · asked by Tom Translator')).toBeVisible();
  await expect(text(page, `Check ${label('P-SUBMITTED')}`)).toBeVisible();
  await expect(text(page, 'Peer check · asked by Tom Translator')).toBeVisible();
  await text(page, `Check ${label('P-SUBMITTED')}`).click();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(text(page, 'Versions and history')).toHaveCount(0);
  await byId(page, 'header-close').click();
  await expect.poll(() => headerTitle(page)).toBe('My Work');
  await primary(page).click();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(text(page, 'Versions and history')).toHaveCount(0);
  await byId(page, 'header-close').click();
  await expect.poll(() => headerTitle(page)).toBe('My Work');
});

test('NAV-014 A good place to start, when nothing is asked', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const who of ['TREV', 'KEPT'] as const) {
    const { context, page } = await device(browser, who);
    await expect(text(page, 'A good place to start')).toBeVisible();
    // The first passage of Alpha's template nobody has recorded or is drafting.
    await expect(page.getByRole('heading', { name: 'Matthew 1:1–17' }).locator('visible=true')).toBeVisible();
    await expect(text(page, "Nobody has recorded it yet · you don't need to be asked")).toBeVisible();
    await expect(text(page, 'Then')).toHaveCount(0);
    await expect(button(page, 'Everything in Alpha')).toBeVisible();
    await primary(page).click();
    await expect.poll(() => headerTitle(page)).toBe('Matthew 1:1–17');
    await expect(primary(page)).toHaveText(/^(Record|Study)$/);
    await back(page).click();
    await button(page, 'Everything in Alpha').click();
    await expect.poll(() => headerTitle(page)).toBe('Alpha');
    await context.close();
  }
});

test('NAV-015 Waiting on others opens in place', async ({ page }) => {
  // A check asked of a whole team (decision 91): COORD asks the Peer check team for P-ASIDE.
  await askTeam(W(), 'COORD', 'P-ASIDE', 'peer');
  await open(page, 'COORD');
  await button(page, 'Waiting on others · 6').click();
  await expect.poll(() => headerTitle(page)).toBe('My Work');
  // People's names come from the server after the record: until then each shows as a placeholder.
  await expect.poll(() => screen(page)).toContain('Recording · Tom Translator');
  const all = await screen(page);
  const due = `${label('P-NEW')} Recording · Tom Translator · due ${dueDay()}`;
  expect(all).toContain(due);
  for (const k of ['P-Q1', 'P-Q2', 'P-Q3', 'P-Q4'] as const) expect(all).toMatch(new RegExp(`${label(k)} Recording · Tom Translator · asked (just now|\\d+ (min|h) ago)`));
  // Rows with a due date first.
  expect(all.indexOf(due)).toBeLessThan(all.indexOf(`${label('P-Q4')} Recording`));
  // The team request names the team, not "someone" (Resets: P-ASIDE's Peer check is asked of its team).
  expect(all).toMatch(new RegExp(`${label('P-ASIDE')} Peer check · the Peer check team · asked`));
  expect(all).not.toContain('· someone ·');
  await text(page, label('P-NEW')).click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-NEW'));
  await back(page).click();
  await expect(text(page, due.slice(label('P-NEW').length + 1))).toBeVisible();
});

test('NAV-016 Opened lately opens in place', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, 'TRANS');
  // P-SUBMITTED is on My Work already (TRANS asked its Peer Review), so it is left out.
  for (const k of ['P-SUBMITTED', 'P-CHECK', 'P-ASIDE', 'P-DONE', 'P-S', 'P-T'] as const) {
    await openByMap(page, k);
    await back(page).click();
  }
  await page.getByPlaceholder('Find “John 3”').locator('visible=true').fill('Luke 12:22');
  await button(page, /^Luke 12:22–34\./).click();
  await back(page).click();
  await tab(page, 'work').click();
  await button(page, 'Opened lately · 5').click();
  const all = await screen(page);
  const order = ['Luke 12:22–34', label('P-T'), label('P-S'), label('P-DONE'), label('P-ASIDE')];
  for (const [i, l] of order.entries()) {
    expect(all, l).toContain(l);
    if (i) expect(all.indexOf(order[i - 1]!), `${l} after ${order[i - 1]}`).toBeLessThan(all.indexOf(l));
  }
  expect(all, 'capped at five').not.toContain(label('P-CHECK'));
  expect(all).toContain(`${label('P-S')} Not started`);
  expect(all).toContain(`${label('P-DONE')} Done`);
  await text(page, 'Luke 12:22–34').click();
  await expect.poll(() => headerTitle(page)).toBe('Luke 12:22–34');
});

test('NAV-018 The coordinator\'s Get ready card @p0', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const who of ['COORD', 'ADMIN'] as const) {
    const { context, page } = await device(browser, who);
    await tab(page, 'map').click();
    await button(page, /^Bravo/).click();
    await expect(text(page, 'No passages yet')).toBeVisible({ timeout: 60_000 });
    await tab(page, 'work').click();
    await expect(text(page, `Bravo · ${W().orgName}`)).toBeVisible();
    await expect(text(page, /^Get Bravo ready · \d of 4$/)).toBeVisible();
    await expect(page.getByRole('progressbar', { name: /^\d of 4 questions? answered$/ }).locator('visible=true')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What will they record?' }).locator('visible=true')).toBeVisible();
    await expect(text(page, 'Next for you')).toHaveCount(0);
    await expect(text(page, 'Then')).toHaveCount(0);
    await expect(primary(page)).toHaveText('Choose');
    await primary(page).click();
    // Get ready, at its first question, which the screen words for the language.
    await expect.poll(() => headerTitle(page)).toBe('Get Bravo ready');
    await expect(text(page, /^\d of 4$/)).toBeVisible();
    await expect(text(page, 'What will Bravo translate?')).toBeVisible();
    await context.close();
  }
});

test('NAV-019 Join requests on My Work, for organization-scope admins only', async ({ browser }) => {
  test.setTimeout(300_000);
  await askToJoin(W(), 'NOORG', 'I translate for Alpha');
  for (const who of ['ADMIN', 'COORD'] as const) {
    const { context, page } = await device(browser, who);
    await expect(text(page, 'Nora Noorg wants to join')).toBeVisible();
    await expect(text(page, 'I translate for Alpha')).toBeVisible();
    // First in the list, under the lead card ("A good place to start": the list is "Also for you").
    const all = await screen(page);
    expect(all).toMatch(/Also for you Nora Noorg wants to join I translate for Alpha/i);
    await expect(button(page, /^Updates, \d+ new$/)).toBeVisible();
    if (who === 'ADMIN') {
      await text(page, 'Nora Noorg wants to join').click();
      await expect.poll(() => headerTitle(page)).toBe('Nora Noorg wants to join');
      await expect(text(page, '“I translate for Alpha”')).toBeVisible();
      await expect(button(page, 'Let Nora in')).toBeVisible();
    }
    await context.close();
  }
  const { context, page } = await device(browser, 'LADMIN');
  await expect(text(page, 'A good place to start')).toBeVisible();
  await expect(text(page, 'Nora Noorg wants to join')).toHaveCount(0);
  await expect(button(page, 'Updates')).toBeVisible();
  await context.close();
});

test('NAV-021 An organization with no language: Add a language', async ({ page }) => {
  // NOORG starts "UI Empty Org" (02 NOORG makes it on screen; here through the server). Resets: NOORG now has an organization.
  const name = `UI Empty Org ${W().run}`;
  await createEmptyOrg(W(), 'NOORG', name);
  await open(page, 'NOORG');
  await expect(text(page, `Get ${name} ready`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Add a language' }).locator('visible=true')).toBeVisible();
  await expect(text(page, 'The language your team speaks')).toBeVisible();
  await expect(text(page, name)).toBeVisible();
  await expect(primary(page)).toHaveText('Add a language');
  await primary(page).click();
  await expect.poll(() => headerTitle(page)).not.toBe('My Work');
  await back(page).click();
  await expect.poll(() => headerTitle(page)).toBe('My Work');
});

test('NAV-022 Divide a book from My Work', async ({ browser }) => {
  test.setTimeout(300_000);
  // Jude listed but not broken up (decision 74). Resets: Jude's passages are hidden in Alpha.
  await leaveBookWaiting(W(), 'COORD', 'JUD');
  for (const who of ['ADMIN', 'COORD', 'LADMIN'] as const) {
    const { context, page } = await device(browser, who);
    await expect(text(page, 'Divide Jude')).toBeVisible();
    await expect(text(page, 'Waiting to be divided before anyone records it')).toBeVisible();
    await text(page, 'Divide Jude').click();
    await expect.poll(() => headerTitle(page), { message: who }).toBe('Progress');
    await expect.poll(() => litTab(page)).toBe('map');
    await context.close();
  }
  const { context, page } = await device(browser, 'TRANS');
  await expect(text(page, 'Next for you')).toBeVisible();
  await expect(text(page, /^Divide /)).toHaveCount(0);
  await context.close();
});

// ---- The bell and the Inbox -------------------------------------------------------------

test('NAV-030 The bell\'s count and the Inbox, from My Work @p0', async ({ page }) => {
  await open(page, 'TRANS');
  const bell = button(page, /^Updates, \d+ new$/);
  await expect(bell).toBeVisible();
  const n = Number(/(\d+) new/.exec((await bell.getAttribute('aria-label'))!)![1]);
  // Five record requests and REV's feedback on P-NEEDS, at least.
  expect(n).toBeGreaterThanOrEqual(6);
  await bell.click();
  await expect.poll(() => headerTitle(page)).toBe('Inbox');
  await expect(byId(page, 'header-back')).toBeVisible();
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'me']);
  await expect.poll(() => litTab(page)).toBe('work');
  await expect(text(page, `Unread (${n})`)).toBeVisible();
  await expect.poll(() => screen(page)).toContain('Cora asked you to record');
  const all = await screen(page);
  expect(all).toContain(`Cora asked you to record ${label('P-NEW')} (Alpha) — due ${dueDay()}`);
  expect(all).toMatch(new RegExp(`Feedback on ${label('P-NEEDS')} Rita Reviewer: Peer (Review|check) suggests changes — revise, or keep it and say why\\.`));
  // Nothing TRANS did themselves.
  expect(all).not.toMatch(/Tom Translator (asked|published|recorded|approved|made)/);
  await back(page).click();
  await expect.poll(() => headerTitle(page)).toBe('My Work');
});

test('NAV-031 An update opens its passage and is marked read', async ({ page }) => {
  await open(page, 'TRANS');
  await button(page, /^Updates, \d+ new$/).click();
  const unread = Number(/Unread \((\d+)\)/i.exec(await screen(page))![1]);
  await text(page, `Feedback on ${label('P-NEEDS')}`).click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-NEEDS'));
  await back(page).click();
  await expect.poll(() => headerTitle(page)).toBe('Inbox');
  await expect(text(page, `Unread (${unread - 1})`)).toBeVisible();
  const all = await screen(page);
  expect(all.indexOf(`Feedback on ${label('P-NEEDS')}`), 'under Earlier').toBeGreaterThan(all.search(/Earlier/i));
  await back(page).click();
  await expect(button(page, `Updates, ${unread - 1} new`)).toBeVisible();
  // Read state is kept per device: TRANS's second device still counts it.
  const other = await device(page.context().browser()!, 'TRANS');
  await expect(button(other.page, `Updates, ${unread} new`)).toBeVisible();
  await other.context.close();
});

test('NAV-032 The Inbox when there is nothing', async ({ page }) => {
  await open(page, 'VIEW');
  await tab(page, 'inbox').click();
  await expect.poll(() => headerTitle(page)).toBe('Inbox');
  await noBack(page);
  await expect(text(page, 'Nothing yet')).toBeVisible();
  await expect(text(page, 'Requests and feedback about your passages show up here.')).toBeVisible();
});

// ---- The viewer's overview ----------------------------------------------------------------

test('NAV-040 Progress, the viewer\'s home @p0', async ({ page }) => {
  await open(page, 'VIEW');
  expect(await headerTitle(page)).toBe('Progress');
  await expect(text(page, orgSub())).toBeVisible();
  await noBack(page);
  const all = await screen(page);
  expect(all).toMatch(/(Across 2 languages|1 of 2 languages counted) · \d+ passages/);
  expect(all).toMatch(/\d+% recorded \d+% done \d+ with reviewers/);
  expect(all).toMatch(/Languages ALP Alpha \d+ passages · Standard Bible Flow/i);
  expect(all.indexOf('Alpha')).toBeLessThan(all.indexOf('Bravo'));
  // The legend: Recorded, each step (a lock on the Consultant Check, a checkpoint) and Done.
  for (const word of ['Recorded', /Consultant (Check|check)/, /Final (Approval|approval)/, 'Done']) expect(all).toMatch(word);
  await expect(button(page, /^Alpha: \d+ of \d+ recorded\. Open its map\.$/)).toBeVisible();
  expect(all).toContain("Each bar layers the steps of the language's review flow");
  await expect(page.getByPlaceholder('Find a language')).toHaveCount(0);
});

test('NAV-041 Drilling into a language from Progress @p0', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const who of ['VIEW', 'ADMIN'] as const) {
    const { context, page } = await device(browser, who);
    await tab(page, 'map').click();
    await button(page, /^Alpha: /).click();
    await expect.poll(() => headerTitle(page)).toBe('Alpha');
    await expect(byId(page, 'header-back')).toBeVisible();
    if (who === 'VIEW') await expect(button(page, /^Next: /)).toHaveCount(0);
    else await expect(button(page, /^Next: /)).toBeVisible();
    await button(page, /^Luke\./).click();
    await button(page, /^Chapter 16:/).click();
    await button(page, new RegExp(`^${label('P-DONE')}\\.`)).click();
    await expect.poll(() => headerTitle(page)).toBe(label('P-DONE'));
    if (who === 'VIEW') await expect(primary(page)).toHaveCount(0);
    for (const want of ['Luke', 'Alpha', 'Progress']) {
      await back(page).click();
      await expect.poll(() => headerTitle(page), { message: who }).toBe(want);
      await expect.poll(() => litTab(page)).toBe('map');
    }
    await context.close();
  }
});

test('NAV-042 A language lead opening a language outside its scope', async ({ page }) => {
  await open(page, 'LADMIN');
  await tab(page, 'map').click();
  await expect.poll(() => headerTitle(page)).toBe('Progress');
  await expect(button(page, /^Alpha: /)).toBeVisible();
  // Intended: Bravo is not offered (LADMIN holds no role there), or it opens read-only and the tabs stay.
  const bravo = page.getByRole('button', { name: /^Bravo/ }).locator('visible=true');
  if (await bravo.count()) {
    await bravo.first().click();
    await page.waitForTimeout(3000);
    await expect.poll(() => tabsShown(page), { message: 'tabs stay in Bravo' }).toEqual(['work', 'map', 'manage', 'me']);
    await back(page).click();
    await expect.poll(() => headerTitle(page)).toBe('Progress');
  }
  await expect.poll(() => tabsShown(page)).toEqual(['work', 'map', 'manage', 'me']);
  await tab(page, 'work').click();
  await expect.poll(() => headerTitle(page)).toBe('My Work');
});

// ---- Permission gates ------------------------------------------------------------------------

/** Back until the tabs show again (a passage and its pages hide them on a phone). */
async function toTabs(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(600);
    if ((await tabsShown(page)).length) return;
    await back(page).click();
  }
}

/** What a role is offered on P-SUBMITTED (Something else?, its first check) and on P-CHECK's Consultant Check. */
async function offered(page: Page): Promise<string> {
  const parts: string[] = [];
  await openByMap(page, 'P-SUBMITTED');
  parts.push(`MAIN: ${await primary(page).textContent({ timeout: 3000 }).catch(() => '')}`);
  await text(page, 'Something else?').click();
  parts.push(`ELSE: ${await screen(page)}`);
  await byId(page, 'header-close').click();
  // A team row is a button only for those who may act on it (VIEW's are not).
  await page.getByRole('button', { name: /^Peer check, / }).locator('visible=true').first().click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  parts.push(`PEER: ${await screen(page)}`);
  await page.getByRole('button', { name: 'Close' }).locator('visible=true').first().click({ position: { x: 10, y: 10 }, timeout: 3000 }).catch(() => undefined);
  await toTabs(page);
  await page.getByPlaceholder('Find “John 3”').locator('visible=true').fill('').catch(() => undefined);
  await openByMap(page, 'P-CHECK');
  await page.getByRole('button', { name: /^Consultant check, / }).locator('visible=true').first().click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  parts.push(`CONS: ${await screen(page)}`);
  return parts.join('\n');
}

const GATES: Record<string, { record: boolean; review: boolean; ask: boolean; already: boolean; movePast: boolean }> = {
  ADMIN: { record: true, review: true, ask: true, already: true, movePast: true },
  COORD: { record: true, review: true, ask: true, already: true, movePast: true },
  LADMIN: { record: true, review: true, ask: true, already: true, movePast: false },
  // TRANS recorded both passages: no review of their own version (decision 91 gave Translator Review).
  TRANS: { record: true, review: false, ask: true, already: true, movePast: false },
  KEPT: { record: true, review: true, ask: true, already: true, movePast: false },
  REV: { record: false, review: true, ask: false, already: true, movePast: false },
  TREV: { record: true, review: true, ask: true, already: true, movePast: false },
  VIEW: { record: false, review: false, ask: false, already: false, movePast: false }
};

test('NAV-050 Controls a role may not use are never offered', async ({ browser }) => {
  test.setTimeout(900_000);
  for (const [who, want] of Object.entries(GATES)) {
    const { context, page } = await device(browser, who as AccountKey);
    await expect.poll(() => tabsShown(page), { message: `${who}: Manage only for those who manage` }).toEqual(PHONE_TABS[who]!.tabs);
    const seen = await offered(page);
    const got = {
      record: /Record a new version|MAIN: Record/.test(seen),
      review: /Review it now/.test(seen),
      ask: /Ask someone|Send to |Someone else should do this/.test(seen),
      already: /Already happened|We already did this/.test(seen),
      movePast: /Move past this checkpoint…/.test(seen)
    };
    expect(got, `${who} is offered\n${seen}`).toEqual(want);
    expect(seen, who).not.toContain("You don't have permission to open that.");
    await context.close();
  }
});

test('NAV-051 Forced navigation is refused without a crash (web addresses)', async ({ browser }) => {
  test.setTimeout(300_000);
  // Steps 1–3 need a role change to land between a sheet drawing and a tap (manual); the web addresses are scripted.
  for (const [path, home] of [['/manage', 'Progress'], ['/work', 'Progress'], ['/manage/language', 'Progress']] as const) {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    await open(page, 'VIEW', { path });
    await expect.poll(() => headerTitle(page), { message: path }).toBe(home);
    await expect(text(page, 'This screen could not open')).toHaveCount(0);
    await context.close();
  }
});

// ---- Back, ✕ and the hardware back button ----------------------------------------------------

test('NAV-060 Header Back and ✕', async ({ page }) => {
  await open(page, 'TRANS');
  await primary(page).click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-Q4'));
  await expect(byId(page, 'header-back')).toBeVisible();
  await expect(text(page, 'Alpha')).toBeVisible();
  await text(page, 'Versions and history').click();
  await expect(byId(page, 'header-close')).toBeVisible();
  await byId(page, 'header-close').click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-Q4'));
  await text(page, 'Something else?').click();
  await expect(byId(page, 'header-close')).toBeVisible();
  await byId(page, 'header-close').click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-Q4'));
  await byId(page, 'header-back').click();
  await expect.poll(() => headerTitle(page)).toBe('My Work');
});

// ---- Sync chip ---------------------------------------------------------------------------------

test('NAV-095 The sync chip on My Work', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, 'TRANS');
  await page.context().setOffline(true);
  await syncNow(page).catch(() => undefined);
  await expect(button(page, 'Offline')).toBeVisible({ timeout: 60_000 });
  await button(page, /^\d+ more for you$/).click();
  await text(page, label('P-NEW')).click();
  await text(page, 'Something else?').click();
  await text(page, 'Add a note').click();
  await page.getByPlaceholder('Or type it').locator('visible=true').fill('offline note');
  await button(page, 'Add note').click();
  await expect(byId(page, 'toast')).toContainText('Note added');
  await toTabs(page);
  await expect.poll(() => headerTitle(page)).toBe('My Work');
  await expect(button(page, '1 to send')).toBeVisible();
  await button(page, '1 to send').click();
  await expect.poll(() => headerTitle(page)).not.toBe('My Work');
  await back(page).click();
  await page.context().setOffline(false);
  await syncNow(page).catch(() => undefined);
  await expect(page.getByRole('button', { name: /^(Offline|\d+ to send|Not syncing)$/ }).locator('visible=true')).toHaveCount(0, { timeout: 60_000 });
});
