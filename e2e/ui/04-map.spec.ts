// 04 The Map (docs/ui-test-suite/04-map.md, MAP): All languages
// ("Progress"), a language's map, a book's chapters, search and the filter.
// One world for the file; tests run in ID order, and those that change it say
// so (MAP-002 adds languages, MAP-020 finishes Luke 3, MAP-023 leaves Jude
// waiting, MAP-034 gives TRANS Bravo). Phone-only tests are Maestro flows
// (apps/mobile/test/maestro/flows/MAP-*.yaml).
import type { Browser, Page } from '@playwright/test';
import {
  addLanguages, chapterUnits, createEmptyOrg, finishPassages, headerTitle, headings, invite, labels, leaveBookWaiting, settled
} from './nav-helpers';
import {
  back, bookRow, button, byId, expect, expectToast, openAs, primary, screenText, syncNow, tab, tabsShown, test, text, useWorld,
  type AccountKey, type PassageKey
} from './support';

const world = useWorld();
const W = () => world();

/** Setups that change the world, done once however many role tests ask (each says so under "Resets"). */
const once = (make: () => Promise<void>) => { let done: Promise<void> | undefined; return () => (done ??= make()); };
/** Jude listed but not broken up (decision 74). Resets: Jude's passages are hidden in Alpha. */
const judeWaiting = once(() => leaveBookWaiting(W(), 'COORD', 'JUD'));
/** Luke 3 taken through all four checks (MAP-020). Resets: Luke 3 is done. */
const luke3Done = once(async () => finishPassages(W(), await chapterUnits(W(), 3)));
const label = (k: PassageKey) => W().passages[k].label;
const screen = (page: Page) => screenText(page);

async function open(page: Page, who: AccountKey): Promise<void> {
  await page.context().routeWebSocket(/\/hot/, () => { /* no hot reloads from others' edits */ });
  await openAs(page, W(), who);
  await expect(page.locator('[data-testid^="tab-"]').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
  await settled(page);
  await syncNow(page);
}

async function device(browser: Browser, who: AccountKey, width = 430) {
  const context = await browser.newContext({ viewport: { width, height: 932 } });
  const page = await context.newPage();
  await open(page, who);
  return { context, page };
}

test.afterEach(async ({ browser }, info) => {
  if (info.status === info.expectedStatus) return;
  for (const c of browser.contexts()) for (const p of c.pages()) console.log(`[${info.title}] SCREEN:`, await screenText(p).catch(() => '(closed)'));
});

/** Alpha's map, as each role reaches it from the Map tab: workers land on it, the rest pick it on Progress. */
async function alphaMap(page: Page): Promise<void> {
  await tab(page, 'map').click();
  await expect.poll(() => headerTitle(page)).toMatch(/^(Progress|Alpha)$/);
  if (await headerTitle(page) === 'Progress') await button(page, /^Alpha: /).click();
  await expect.poll(() => headerTitle(page)).toBe('Alpha');
}

const search = (page: Page) => page.getByTestId('map-search').locator('visible=true');
/** A passage's row in a book's list (decisions.md 166): its spoken label starts with its title. */
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const row = (page: Page, title: string) => button(page, new RegExp(`^${escaped(title)}\\.`));
/** The same, showing more of the book until it is drawn (25 at a time, UI audit finding 122). */
const bookPassage = (page: Page, title: string) => bookRow(page, new RegExp(`^${escaped(title)}\\.`));
/** Every passage of the book, Show more until none is left. */
async function wholeBook(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: /^Show \d+ more · / }).locator('visible=true').first();
  await expect(more).toBeVisible();
  while (await more.isVisible()) await more.click();
}
/**
 * Luke's download button (MAP-036), with the size of its recordings once it is known: "Download" for the whole book and
 * for the rest alike, since the header says how much is here (Carl, 2026-11-23).
 */
const DOWNLOAD_ALL = /^Download( · .+)?$/;
/**
 * Where Luke's passages stand on this device, in its header under how many are recorded: none, some or all, or on the
 * way; all of them, with what they lack (the web UI tests' Bible Brain is out of reach, so reference audio can't come).
 */
const BOOK_STATUS = /^(Checking this device…|Not on this device|\d+ of 97 on this device|On this device( · .+)?|(Downloading for offline|Waiting to download) · \d+ of 97)$/;
const closeSheet = (page: Page) => page.getByRole('button', { name: 'Close' }).locator('visible=true').first().click({ position: { x: 10, y: 10 } });

// ---- All languages -------------------------------------------------------------------------

test('MAP-001 LADMIN One language: the Map tab opens it @p0', async ({ browser }) => {
  // LADMIN holds a role in Alpha only: the Map tab opens Alpha, not a Progress list of one (UI audit, finding 82).
  const { context, page } = await device(browser, 'LADMIN');
  await tab(page, 'map').click();
  await expect.poll(() => headerTitle(page)).toBe('Alpha');
  await expect(search(page)).toBeVisible();
  await expect(byId(page, 'header-back')).toHaveCount(0);
  await context.close();
});

for (const who of ['ADMIN'] as const) {
  test(`MAP-001 ${who} All languages @p0`, async ({ browser }) => {
    const { context, page } = await device(browser, who);
    await tab(page, 'map').click();
    await expect.poll(() => headerTitle(page), { message: who }).toBe('Progress');
    await expect(text(page, `${W().orgName} · All languages`)).toBeVisible();
    await expect(byId(page, 'header-back')).toHaveCount(0);
    const all = await screen(page);
    expect(all, who).toMatch(/(Across 2 languages|\d of 2 languages counted) · \d+ passages/);
    expect(all).toMatch(/\d+% recorded \d+% done \d+ with reviewers/);
    expect(all).toMatch(/ALP Alpha \d+ passages · Standard Bible Flow 2 Recorded/);
    for (const word of [/Consultant (Check|check)/, /Final (Approval|approval)/, 'Done']) expect(all).toMatch(word);
    expect(all).toMatch(/Bravo (Open it to bring it onto this device|0 passages · as of )/);
    await button(page, /^Alpha: /).click();
    await expect.poll(() => headerTitle(page)).toBe('Alpha');
    await back(page).click();
    await expect.poll(() => headerTitle(page)).toBe('Progress');
    if (who === 'ADMIN') {
      // Desktop-wide: Alpha's map opens beside the list.
      await page.setViewportSize({ width: 1280, height: 900 });
      await button(page, /^Alpha: /).click();
      await expect.poll(() => headings(page)).toEqual(expect.arrayContaining(['Progress', 'Alpha']));
    }
    await context.close();
  });
}

test('MAP-002 Finding a language among many', async ({ page }) => {
  // Resets: ORG has 26 languages from here on.
  await addLanguages(W(), ['Delta', 'Echo', 'Foxtrot', 'Golf']);
  await open(page, 'ADMIN');
  await tab(page, 'map').click();
  const find = page.getByTestId('map-search').locator('visible=true');
  await expect(find).toBeVisible();
  await find.fill('alp');
  await expect(button(page, /^Alpha: /)).toBeVisible();
  for (const other of ['Bravo', 'Delta', 'Golf']) await expect(text(page, other)).toHaveCount(0);
  await find.fill('q02');
  await expect(text(page, 'Foxtrot')).toBeVisible();
  await expect(button(page, /^Alpha: /)).toHaveCount(0);
  await find.fill('zzz');
  await expect(text(page, 'No language matches “zzz”.')).toBeVisible();
  await find.fill('');
  await addLanguages(W(), Array.from({ length: 20 }, (_, i) => `Lang ${String(i + 1).padStart(2, '0')}`), 4);
  await page.reload();
  await settled(page);
  await syncNow(page);
  await tab(page, 'map').click();
  await expect(button(page, 'Show 1 more · 1 left')).toBeVisible({ timeout: 60_000 });
  await button(page, 'Show 1 more · 1 left').click();
  await expect(text(page, 'Lang 20')).toBeVisible();
});

test('MAP-003 No languages yet', async ({ page }) => {
  // NEW (here NOORG) is the Organization Admin of "UI Empty Org", which has no language (NAV-021).
  await createEmptyOrg(W(), 'NOORG', `UI Empty Org ${W().run}`);
  await open(page, 'NOORG');
  await tab(page, 'map').click();
  await expect.poll(() => headerTitle(page)).toBe('Progress');
  await expect(text(page, 'No languages yet')).toBeVisible();
  await expect(text(page, 'Once a language is added, its progress shows here.')).toBeVisible();
  const all = await screen(page);
  expect(all).not.toMatch(/Across|recorded|Each bar layers/);
});

// ---- A language's map --------------------------------------------------------------------------

for (const who of ['TRANS', 'COORD'] as const) {
  test(`MAP-010 ${who} The language map's header and Back @p0`, async ({ browser }) => {
    const { context, page } = await device(browser, who);
    await alphaMap(page);
    if (who === 'COORD') {
      await expect(byId(page, 'header-back')).toBeVisible();
    } else {
      await expect(byId(page, 'header-back')).toHaveCount(0);
    }
    await expect(button(page, 'Filter')).toBeVisible();
    await expect(search(page)).toBeVisible();
    await expect(button(page, /^Next: /)).toBeVisible();
    // Search, then Next, then the books.
    const all = await screen(page);
    expect(all.indexOf('Next: ')).toBeLessThan(all.indexOf('Matthew'));
    // No language chips: each of these opens one language here.
    await expect(page.getByRole('button', { name: 'Bravo', exact: true }).locator('visible=true')).toHaveCount(0);
    const spoken = await labels(page);
    const luke = spoken.find((l) => l.startsWith('Luke.'));
    expect(luke, who).toMatch(/^Luke\. 6 of 97 recorded, 1 done\./);
    if (who === 'TRANS') expect(luke).toContain('7 for you');
    expect(luke).toContain('1 with feedback');
    expect(all).toContain('Luke 6/97');
    expect(spoken).toContain('Matthew. Not started');
    expect(all).toMatch(/Matthew Mark/);
    if (who === 'COORD') {
      await back(page).click();
      await expect.poll(() => headerTitle(page)).toBe('Progress');
    }
    await context.close();
  });
}

for (const who of ['TRANS', 'VIEW'] as const) {
  test(`MAP-011 ${who} Finding a passage by search @p0`, async ({ browser }) => {
    const { context, page } = await device(browser, who);
    await alphaMap(page);
    await search(page).fill('Luke 15');
    await expect(text(page, '2 passages')).toBeVisible();
    await expect(button(page, /^Next: /)).toHaveCount(0);
    await expect(text(page, 'Matthew')).toHaveCount(0);
    // Each row with its summary (people's names arrive from the server after the record).
    await expect.poll(async () => (await labels(page)).some((l) => l.startsWith(`${label('P-SUBMITTED')}. Waiting on Rita Reviewer`))).toBe(true);
    expect((await labels(page)).some((l) => l.startsWith(`${label('P-CHECK')}. Next: Consultant`))).toBe(true);
    expect(await screen(page)).toMatch(new RegExp(`2/4 ${label('P-CHECK')}.*0/4 ${label('P-SUBMITTED')}`));
    await button(page, new RegExp(`^${label('P-SUBMITTED')}\\.`)).click();
    await expect.poll(() => headerTitle(page)).toBe(label('P-SUBMITTED'));
    await back(page).click();
    await expect(search(page)).toHaveValue('Luke 15');
    // The book's start and a verse find the same passages: the search works by chapter.
    for (const q of ['luk 15', 'luke 15:3']) {
      await search(page).fill(q);
      await expect(text(page, '2 passages')).toBeVisible();
    }
    await context.close();
  });
}

test('MAP-012 Searching by book, and no match', async ({ page }) => {
  await open(page, 'TRANS');
  await alphaMap(page);
  await search(page).fill('luk');
  await expect(text(page, '1 book · add a chapter number to jump straight to it')).toBeVisible();
  await search(page).fill('zzz');
  await expect(text(page, 'No book by that name in this language')).toBeVisible();
  // Ruth is not in Alpha (its template covers the New Testament).
  await search(page).fill('ruth 1:1');
  await expect(text(page, 'No passage matches — try a book name, then a chapter')).toBeVisible();
  await search(page).fill('');
  await expect(button(page, /^Next: /)).toBeVisible();
  await expect(button(page, /^Matthew\./)).toBeVisible();
  await search(page).fill('luk');
  await button(page, /^Luke\./).click();
  await expect.poll(() => headerTitle(page)).toBe('Luke');
});

const nextFor = (): Record<string, string | null> => ({
  TRANS: label('P-Q4'), REV: label('P-BT'), TREV: 'Matthew 1:1–17', ADMIN: 'Matthew 1:1–17', VIEW: null
});
for (const who of ['TRANS', 'REV', 'TREV', 'ADMIN', 'VIEW'] as const) {
  test(`MAP-013 ${who} Next on the map`, async ({ browser }) => {
    const next = nextFor()[who]!;
    const { context, page } = await device(browser, who as AccountKey);
    if (next) {
      // The same passage My Work leads with.
      await expect(page.getByRole('heading', { name: next }).locator('visible=true')).toBeVisible();
    }
    await alphaMap(page);
    if (!next) {
      await expect(button(page, /^Next: /)).toHaveCount(0);
    } else {
      await expect(button(page, `Next: ${next}`)).toBeVisible();
      await button(page, `Next: ${next}`).click();
      await expect.poll(() => headerTitle(page), { message: who }).toBe(next);
    }
    await context.close();
  });
}

test('MAP-014 Testament pills', async ({ page }) => {
  // Step 2 (Ruth listed in Alpha) needs 09 SETUP's book choice; with the fixture's New Testament there are no pills.
  await open(page, 'TRANS');
  await alphaMap(page);
  await expect(button(page, /^Matthew\./)).toBeVisible();
  await expect(text(page, 'New Testament')).toHaveCount(0);
  await expect(text(page, 'Old Testament')).toHaveCount(0);
});

for (const who of ['TRANS', 'COORD'] as const) {
  test(`MAP-015 ${who} The filter, one tap deeper`, async ({ browser }) => {
    const { context, page } = await device(browser, who);
    await alphaMap(page);
    await button(page, 'Filter').click();
    await expect(text(page, 'Show only the passages that match')).toBeVisible();
    const all = await screen(page);
    expect(all).toMatch(/6 of \d+ recorded · 1 done · 2 with reviewers/);
    expect(all).toContain('FIA passages (English) · Standard Bible Flow');
    expect(all).toMatch(/All Feedback waiting · 1 With reviewers · 2 In review · 5 Done · 1 Not recorded · \d+/);
    await button(page, /^Feedback waiting/).click();
    await expect(text(page, 'Show only the passages that match')).toHaveCount(0);
    await expect(button(page, 'Filter: Feedback waiting. Change it')).toBeVisible();
    await expect(button(page, 'Clear filter')).toBeVisible();
    await expect(button(page, /^Matthew\./)).toHaveCount(0);
    // Luke's count is the one passage with feedback, said once.
    expect((await labels(page)).find((l) => l.startsWith('Luke.'))).toMatch(/^Luke\. 6 of 97 recorded, 1 done\. 1 with feedback(\. 7 for you)?$/);
    expect(await screen(page)).toMatch(/Luke 1 /);
    await button(page, /^Luke\./).click();
    await expect.poll(() => headerTitle(page)).toBe('Luke');
    // Its passages, filtered: the one with feedback, and not the ones without.
    await expect(row(page, label('P-NEEDS'))).toBeVisible();
    await expect(row(page, label('P-NEW'))).toHaveCount(0);
    await back(page).click();
    await button(page, 'Clear filter').click();
    await expect(button(page, /^Matthew\./)).toBeVisible();
    await context.close();
  });
}

// ---- A book's passages ----------------------------------------------------------------------------

// Luke 3 is taken through all four checks (luke3Done). The fixture's template divides
// Luke into FIA's passages, so Luke lists its passages rather than chapter tiles (decisions.md 166).
for (const who of ['TRANS', 'VIEW'] as const) {
  test(`MAP-020 ${who} A book divided into passages lists them, each with its download button @p0`, async ({ browser }) => {
    await luke3Done();
    const { context, page } = await device(browser, who);
    await alphaMap(page);
    await button(page, /^Luke\./).click();
    await expect.poll(() => headerTitle(page)).toBe('Luke');
    // On a phone the sub-line names the language, as the crumbs do on a wide window (UI audit, finding 124). Under it, where
    // the passages stand on this device: the book's counts in one place (Carl, 2026-11-23).
    await expect(text(page, 'Alpha · 9 of 97 recorded')).toBeVisible();
    await expect(byId(page, 'book-status')).toHaveText(BOOK_STATUS);
    await expect(byId(page, 'header-back')).toBeVisible();
    // The line over the list is the book's download button (MAP-036): all of it when none is kept, the rest when some are.
    await expect(byId(page, 'book-offline-download')).toHaveAttribute('aria-label', DOWNLOAD_ALL);
    // 25 at a time (UI audit, finding 122), then the rest.
    expect((await labels(page)).filter((l) => /^Luke \d+:\d+/.test(l))).toHaveLength(25);
    await expect(button(page, 'Show 25 more · 72 left')).toBeVisible();
    await wholeBook(page);
    const spoken = await labels(page);
    expect(spoken.filter((l) => /^Chapter \d+:/.test(l))).toHaveLength(0);
    const rows = spoken.filter((l) => /^Luke \d+:\d+/.test(l));
    expect(rows).toHaveLength(97);
    // A passage that runs across two chapters is one row.
    expect(rows.filter((l) => l.startsWith('Luke 7:36–8:3.'))).toHaveLength(1);
    const of = (t: string) => rows.find((l) => l.startsWith(`${t}.`))!;
    expect(of(label('P-NEEDS'))).toMatch(/feedback/i);
    expect(of(label('P-NEW'))).toMatch(/Not started/);
    expect(rows.filter((l) => /^Luke 3:/.test(l)).every((l) => /[Dd]one/.test(l))).toBe(true);
    // Every row has its download button.
    expect(spoken.filter((l) => /^(Download for offline|On this device|Downloading for offline|Only \d+ of \d+ files on this device|Not on this device yet|Checking this device…)/.test(l)).length).toBeGreaterThanOrEqual(97);
    if (who === 'TRANS') {
      // Crumbs "Alpha › Luke" show on a wide window (kit Header).
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.getByRole('link', { name: 'Alpha' }).locator('visible=true')).toBeVisible();
    }
    await context.close();
  });
}

test('MAP-021 A book of passages: the filters one tap deeper, and each row says where it stands', async ({ page }) => {
  await open(page, 'TRANS');
  await alphaMap(page);
  await button(page, /^Luke\./).click();
  await button(page, 'Filter').click();
  await expect(text(page, 'Show only the passages that match')).toBeVisible();
  // The key is the chapter tiles'; a list of passages has none.
  await expect(text(page, 'Key')).toHaveCount(0);
  await closeSheet(page);
  await wholeBook(page);
  const spoken = await labels(page);
  const of = (t: string) => spoken.find((l) => l.startsWith(`${t}.`))!;
  expect(of(label('P-NEEDS'))).toMatch(/Feedback for you to answer\. For you/);
  expect(of(label('P-NEW'))).toMatch(/For you/);
  expect(of(label('P-DRAFT'))).toMatch(/Recording in progress/);
});

test('MAP-022 A passage opens from its row, and Back comes to the book', async ({ page }) => {
  await open(page, 'TRANS');
  await alphaMap(page);
  await button(page, /^Luke\./).click();
  // Luke 14's passages one after another, with the steps of the one in review.
  await (await bookPassage(page, label('P-BT'))).scrollIntoViewIfNeeded();
  expect(await screen(page)).toMatch(new RegExp(`0/4 ${label('P-BT')}`));
  await (await bookPassage(page, label('P-NEEDS'))).click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-NEEDS'));
  await back(page).click();
  await expect.poll(() => headerTitle(page)).toBe('Luke');
});

// Resets: Jude's passages are hidden in Alpha (judeWaiting).
for (const who of ['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'REV', 'VIEW'] as const) {
  test(`MAP-023 ${who} A book not broken up yet`, async ({ browser }) => {
    await judeWaiting();
    const { context, page } = await device(browser, who);
    await alphaMap(page);
    await expect(button(page, /^Jude\./)).toContainText('Waiting to be divided');
    if (who === 'TRANS') {
      // It stays shown while a filter is set.
      await button(page, 'Filter').click();
      await button(page, /^Done/).click();
      await expect(button(page, /^Jude\./)).toBeVisible();
      await button(page, 'Clear filter').click();
    }
    await button(page, /^Jude\./).click();
    await expect.poll(() => headerTitle(page)).toBe('Jude');
    // On a phone the sub-line names the language too (UI audit, finding 124).
    await expect(text(page, 'Alpha · Waiting to be divided')).toBeVisible();
    await expect(text(page, "Jude isn't divided yet")).toBeVisible();
    // Breaking a book up is a library write at organization scope (decision 74): LADMIN is told who does it.
    if (['ADMIN', 'COORD'].includes(who)) {
      await expect(text(page, "Choose how Jude is divided into sections: by chapter, FIA's passages or another way. Then it can be recorded.")).toBeVisible();
      await expect(primary(page)).toHaveText('Divide Jude');
      await primary(page).click();
      await expect(text(page, 'How should Jude be divided?'), `${who} can divide Jude`).toBeVisible();
    } else {
      await expect(text(page, 'A coordinator decides how Jude is divided into sections. Then you can record it.')).toBeVisible();
      await expect(primary(page)).toHaveCount(0);
    }
    await context.close();
  });
}

for (const who of ['COORD'] as const) {
  test(`MAP-024 ${who} Divide differently, for those who shape templates`, async ({ browser }) => {
    const { context, page } = await device(browser, who);
    await alphaMap(page);
    await button(page, /^Luke\./).click();
    await expect(button(page, 'Filter')).toBeVisible();
    if (['ADMIN', 'COORD', 'LADMIN'].includes(who)) {
      await button(page, 'Divide differently').click();
      // The ways to divide Luke at once, not the book's page with the same link again (UI audit, finding 127).
      await expect(text(page, 'Change how Luke is divided')).toBeVisible();
      await back(page).click();
      await expect(row(page, 'Luke 1:1–4')).toBeVisible();
    } else {
      await expect(button(page, 'Divide differently')).toHaveCount(0);
    }
    await context.close();
  });
}

// ---- Scale, offline and other languages ---------------------------------------------------------------

for (const who of ['COORD', 'ADMIN'] as const) {
  test(`MAP-032 ${who} Bravo, a language that is not ready`, async ({ browser }) => {
    const { context, page } = await device(browser, who);
    await tab(page, 'map').click();
    await button(page, /^Bravo/).click();
    await expect.poll(() => headerTitle(page)).toBe('Bravo');
    // Alpha's books never show under Bravo's name.
    await expect(text(page, 'No passages yet')).toBeVisible({ timeout: 60_000 });
    await expect(text(page, 'Once Bravo has passages to record, they show here by book and chapter.')).toBeVisible();
    await expect(button(page, /^Luke\./)).toHaveCount(0);
    await expect(button(page, 'Filter')).toHaveCount(0);
    await expect(search(page)).toHaveCount(0);
    await back(page).click();
    await expect.poll(() => headerTitle(page)).toBe('Progress');
    await expect(button(page, 'Bravo: 0 of 0 recorded. Open its map.')).toBeVisible();
    await tab(page, 'work').click();
    await expect(text(page, /^Get Bravo ready · \d of 4$/)).toBeVisible();
    await context.close();
  });
}

test('MAP-034 Switching language from the map', async ({ page }) => {
  // TRANS also holds Translator at Bravo (10 PEOPLE). Bravo has no template here, so its map is empty. Resets: TRANS is in Bravo.
  await invite(W(), 'ADMIN', 'TRANS', 'translator', { level: 'language', languageId: W().languages.B.languageId });
  await open(page, 'TRANS');
  await tab(page, 'map').click();
  await expect.poll(() => headerTitle(page)).toBe('Alpha');
  await expect(button(page, 'Alpha')).toBeVisible();
  await expect(button(page, 'Bravo')).toBeVisible();
  await search(page).fill('Luke 15');
  await button(page, 'Bravo').click();
  // The whole app now works in Bravo, and says so (UI audit, finding 126).
  await expect(text(page, 'Now in Bravo')).toBeVisible();
  await expect.poll(() => headerTitle(page)).toBe('Bravo');
  await expect(text(page, 'No passages yet')).toBeVisible({ timeout: 60_000 });
  await expect(button(page, 'Alpha')).toBeVisible();
  await tab(page, 'work').click();
  await expect(text(page, `Bravo · ${W().orgName}`)).toBeVisible();
  await tab(page, 'map').click();
  await button(page, 'Alpha').click();
  await expect(search(page)).toHaveValue('');
});

test('MAP-035 The viewer\'s map is read-only', async ({ page }) => {
  await open(page, 'VIEW');
  await alphaMap(page);
  await expect(button(page, /^Next: /)).toHaveCount(0);
  await button(page, /^Luke\./).click();
  await expect(button(page, 'Divide differently')).toHaveCount(0);
  await (await bookPassage(page, label('P-SUBMITTED'))).click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-SUBMITTED'));
  await expect(primary(page)).toHaveCount(0);
  await expect(text(page, 'Something else?')).toBeVisible();
  await expect(text(page, 'Versions and history')).toBeVisible();
  // Team rows are not tappable for a viewer: tapping one opens nothing.
  await page.getByRole('button', { name: /^Peer check, / }).locator('visible=true').first().click({ force: true });
  await page.waitForTimeout(800); // sleep: nothing observable says a sheet did not open
  await expect(page.getByRole('button', { name: 'Close' }).locator('visible=true')).toHaveCount(0);
  for (const not of ['Review it now', 'Already happened', 'Ask someone']) await expect(text(page, not)).toHaveCount(0);
  // Whether it comes along offline is at the top of the passage, with its button (decisions.md 166).
  await expect(byId(page, 'passage-offline')).toHaveAttribute('aria-label', /^(On this device|Download for offline|Downloading for offline|Only \d+ of \d+ files|Not on this device yet|Checking this device…)/);
  await text(page, 'Something else?').click();
  const all = await screen(page);
  expect(all).toContain('What helps here');
  expect(all).not.toMatch(/Keep offline/);
  for (const not of ['Say it instead', 'Someone else should do this', 'Add a note', 'Record a new version']) expect(all).not.toContain(not);
  expect(await tabsShown(page)).toEqual([]);
});

// A book has its own download button (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, LAN-316).
test('MAP-036 A whole book downloads for offline with one button', async ({ browser }) => {
  // A device of its own: what is kept is the device's, and VIEW keeps nothing by default.
  const { context, page } = await device(browser, 'VIEW');
  await alphaMap(page);
  await button(page, /^Luke\./).click();
  await expect.poll(() => headerTitle(page)).toBe('Luke');
  const book = byId(page, 'book-offline');
  const status = byId(page, 'book-status');
  await expect(byId(page, 'book-offline-download')).toHaveAttribute('aria-label', DOWNLOAD_ALL);
  // No words over the passages: the header says where they stand, the button what it does (Carl, 2026-11-23).
  for (const gone of ['Recordings and reference material', 'Working out the size…']) await expect(text(page, gone)).toHaveCount(0);
  // VIEW keeps nothing: the header says so in words, not "0 of 97 passages ready" under "9 of 97 passages" (Carl, 2026-11-23).
  await expect(status).toHaveText('Not on this device');
  // What each download button's mark means is under Filter, every mark named; no link takes a row over the passages.
  await expect(button(page, 'What the download buttons mean')).toHaveCount(0);
  await button(page, 'Filter').click();
  for (const mark of ['Download for offline', 'Downloading for offline', 'Only some files here', 'On this device',
    'Download needs a connection', 'Checking this device…']) await expect(text(page, mark)).toBeVisible();
  await expect(text(page, 'Recordings on this device')).toHaveCount(0);
  await closeSheet(page);
  // Keeping one passage by its own button: the line's words change and its height does not, so the list under it does not
  // move under a thumb (Carl, 2026-11-23). It shrank to "Checking this device…" and grew back on every tap, and on a phone
  // "Download the rest" beside the words wrapped them from four lines to eight.
  await book.evaluate((el) => {
    const bar = el;
    const seen = [bar.getBoundingClientRect().height];
    new ResizeObserver(() => seen.push(bar.getBoundingClientRect().height)).observe(bar);
    (window as unknown as { barHeights: number[] }).barHeights = seen;
  });
  // The header's line holds its height too: it is over the list as well.
  await status.evaluate((el) => {
    const line = el.parentElement!;
    const seen = [line.getBoundingClientRect().height];
    new ResizeObserver(() => seen.push(line.getBoundingClientRect().height)).observe(line);
    (window as unknown as { statusHeights: number[] }).statusHeights = seen;
  });
  await page.getByRole('button', { name: 'Download for offline', exact: true }).locator('visible=true').first().click();
  await expect(byId(page, 'book-offline-download')).toHaveAttribute('aria-label', DOWNLOAD_ALL);
  // What is kept can be let go at once too, not only once the whole book is, by the words its sheet uses (Carl, 2026-11-23).
  await expect(byId(page, 'book-offline-remove')).toHaveAttribute('aria-label', 'Stop keeping');
  await expect(status).toHaveText(BOOK_STATUS);
  for (const seen of ['barHeights', 'statusHeights']) {
    const heights = await page.evaluate((k) => (window as unknown as Record<string, number[]>)[k]!, seen);
    expect(Math.min(...heights), seen).toBe(heights[0]);
    expect(Math.max(...heights), seen).toBe(heights[0]);
  }
  // The rest, with the button at the line's end: every passage is kept, and no row offers a download any more.
  await byId(page, 'book-offline-download').click();
  await expect(byId(page, 'book-offline-download')).toHaveCount(0);
  // Kept: coming down, waiting its turn, or here; never "Not on this device" as if nothing had been asked (Carl, 2026-11-23).
  await expect(status).toHaveText(/^(On this device( · .+)?|(Downloading for offline|Waiting to download) · \d+ of 97)$/);
  await wholeBook(page);
  await expect.poll(async () => (await labels(page)).filter((l) => /^Download for offline/.test(l))).toHaveLength(0);
  // One kind of kept passage: a book's passages take their reference material too, with no switch to give it up.
  expect((await labels(page)).filter((l) => /^Recordings on this device$/.test(l))).toHaveLength(0);
  await (await bookPassage(page, label('P-NEW'))).click();
  await expect.poll(() => headerTitle(page)).toBe(label('P-NEW'));
  await expect(byId(page, 'passage-offline')).toHaveAttribute('aria-label', /^(On this device|Downloading for offline|Only \d+ of \d+ files|Not on this device yet|Checking this device…)/);
  await expect(page.getByTestId('passage-offline-reference')).toHaveCount(0);
  await back(page).click();
  await expect.poll(() => headerTitle(page)).toBe('Luke');
  // The line only says where they stand now; its Remove button asks first, then lets them go, and the whole book is on offer again.
  await byId(page, 'book-offline-remove').click();
  // It says what it does: the files go when the device needs room, not now (Carl, 2026-11-23).
  await expect(text(page, 'Stop keeping Luke on this device?')).toBeVisible();
  await expect(text(page, /are cleared when this device needs room/)).toBeVisible();
  await button(page, 'Stop keeping').click();
  await expectToast(page, 'No longer kept. Their audio may be removed to make room.');
  await expect(byId(page, 'book-offline-download')).toHaveAttribute('aria-label', DOWNLOAD_ALL);
  // Let go, though its files stay until room is needed: not here as far as the person is told (Carl, 2026-11-23).
  await expect(status).toHaveText('Not on this device');
  await context.close();
});
