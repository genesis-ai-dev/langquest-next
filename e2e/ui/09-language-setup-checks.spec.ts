// SETUP: a language's checks and the review flows behind them
// (docs/ui-test-suite/09-language-setup.md, SETUP-043 to SETUP-048 and
// SETUP-067 to SETUP-073; decision 91). A language's checks are its own:
// a ready-made flow is copied in, and each check carries its people,
// questions and helps. Tests share this file's world and put Alpha's checks
// back the way the fixture left them (Undo, or the same change reversed).
import type { Page } from '@playwright/test';
import {
  back, button, byId, deviceFor, expect, expectNothingRefused, expectSent, expectToast, field, languageArrived, openAs, primary, screenText, tab, test, text, undoToast,
  useWorld, type AccountKey, type UiWorld
} from './support';
import { closeSheet, expectNotOnScreen, expectOnScreen, expectOrgSent, goBack, languagePage, more, orgRefused } from './setup-helpers';

const world = useWorld();

const ORDER = /Peer check \+ back translation → Community check → Consultant check → Final approval/;

/** Alpha's Checks screen: from Alpha's page (the Manage tab's root for LADMIN). */
async function checks(page: Page, w: UiWorld, who: AccountKey): Promise<void> {
  await openAs(page, w, who);
  if (who === 'LADMIN') await tab(page, 'manage').click();
  else await languagePage(page, w, 'Alpha');
  await text(page, 'Checks').click();
  await expectOnScreen(page, 'A translator records a version', 'Add a check');
}

/** The checks as the Checks screen lists them, in order, by name. */
async function listed(page: Page): Promise<string[]> {
  const names = ['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval', 'Retelling', 'Local check', 'Elder check'];
  const all = await screenText(page);
  const body = all.slice(all.indexOf('A translator records a version'), all.indexOf('Add a check'));
  return names.map((n) => [n, body.indexOf(` ${n} `)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([n]) => n);
}

/** Peer check's people, in either order. */
const PEER_PEOPLE = /Peer check .*(Rita Reviewer, Trevor Both|Trevor Both, Rita Reviewer)/;

/** A card (a kit Card) that holds this title and a button with this name. */
const cardWith = (page: Page, title: string, button: string) => page.locator('div')
  .filter({ has: page.getByText(title, { exact: true }) })
  .filter({ has: page.getByRole('button', { name: button, exact: true }) }).last();

/**
 * A flow's card on Review Flows, once the device holds the flow's version:
 * the card draws the version's steps where it said "Loading…" (config.tsx
 * `DocSteps`), and only then does its Use have a version to copy. The
 * listing arrives first; the version document is a separate fetch
 * (library/docStore.ts `loadDocs`), slower on a loaded machine.
 */
async function flowCard(page: Page, title: string, ...steps: string[]) {
  const card = cardWith(page, title, 'Use');
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('Loading…');
  for (const s of steps) await expect(card).toContainText(s);
  return card;
}

/** The people on the open check's People page, as it lists them. */
async function onCheck(page: Page): Promise<string> {
  const all = await screenText(page);
  return /People (.*?) Add people/.exec(all)?.[1] ?? '';
}

/** A switch in a Row (the kit's Toggle): its checkbox carries the state; clicked through, since its track lies over it. */
const toggle = (page: Page, name: string) => page.locator('input[role="switch"]').and(page.getByRole('switch', { name, exact: true })).last();

for (const who of ['ADMIN', 'COORD'] as const) {
  test(`SETUP-043 ${who} Review Flows home`, async ({ page, browser }) => {
    const w = world();
    const d = who === 'ADMIN' ? null : await deviceFor(browser, w, who);
    const p = d?.page ?? page;
    if (!d) await openAs(p, w, who);
    await languagePage(p, w, 'Alpha');
    await more(p);
    await text(p, 'Every way to check').click();
    await expectOnScreen(p, 'Review Flows', 'Alpha', 'Flow');
    // Alpha's checks were copied from Standard Bible Flow (decision 91): they are its own.
    await expectOnScreen(p, 'Alpha uses', 'Custom flow', 'Peer Review', 'Back Translation', 'Community Check', 'Consultant Check', 'Final Approval', 'Add to your flows');
    await expectOnScreen(p, /Your organization · 0/i, 'No flows here yet. Follow or copy one another organization shares, or make your own.');
    await expectOnScreen(p, /From other organizations · \d+/i, 'Standard Bible Flow', 'Quick Check', /LangQuest · \d+ versions?/);
    await expect(button(p, 'Use')).toBeVisible();
    await expect(button(p, 'Follow')).toBeVisible();
    await expect(button(p, 'Copy')).toBeVisible();
    if (d) await d.context.close();
  });
}

test('SETUP-044 Use a ready-made flow for a language @p0', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  await more(page);
  await text(page, 'Every way to check').click();
  // "Use" copies the flow's checks into Alpha (decision 91); Quick Check is a peer check, then sign-off.
  // The copy replaces the checks this device holds, and its Undo is the flow it read: Alpha's record must
  // have arrived (a fresh device pulls it in pages), or the old checks stay beside the new ones and Undo is missing.
  await languageArrived(page);
  await expectOnScreen(page, /Alpha uses Custom flow Peer Review Back Translation Community Check Consultant Check Final Approval Add to your flows/);
  const quick = await flowCard(page, 'Quick Check', 'Peer Review', 'Final Approval');
  await quick.getByRole('button', { name: 'Use', exact: true }).click();
  await expectToast(page, 'Alpha now uses Quick Check.');
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await back(page).click();
  await back(page).click().catch(() => undefined);
  await languagePage(page, w, 'Alpha');
  await expectOnScreen(page, /Checks Peer check → Final approval/);
  await expectSent(page, w);
  // Passages read against the new checks; nothing recorded or reviewed is lost (decision 32).
  const rev = await deviceFor(browser, w, 'REV');
  await expect.poll(() => screenText(rev.page)).not.toContain('Something went wrong');
  await rev.context.close();
  // Back to Alpha's checks: Standard Bible Flow again, the same way.
  await more(page);
  await text(page, 'Every way to check').click();
  const standard = await flowCard(page, 'Standard Bible Flow', 'Consultant Check', 'Final Approval');
  await standard.getByRole('button', { name: 'Use', exact: true }).click();
  await expectToast(page, 'Alpha now uses Standard Bible Flow.');
  await undoToast(page);
  await expectToast(page, 'Undone.');
  await back(page).click();
  await expectOnScreen(page, /Checks Peer check → Final approval/);
  // Undo of the first change puts back the checks Alpha had.
  await text(page, 'Checks').click();
  await text(page, 'Start from a ready-made flow').click();
  await text(page, 'Standard Bible Flow').click();
  await text(page, 'Use Standard Bible Flow').click();
  await expectToast(page, 'Alpha now starts from Standard Bible Flow');
  await back(page).click();
  await expectOnScreen(page, ORDER);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-045 Make a review flow in the library', async ({ page }) => {
  const w = world();
  const name = `Community first ${w.run.slice(-4)}`;
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  await more(page);
  await text(page, 'Every way to check').click();
  await text(page, 'Flow').click();
  await expectOnScreen(page, 'New way to check', 'New · your organization');
  await field(page, 'Name').fill(name);
  await field(page, 'Description').fill('The community first, then sign-off.');
  await text(page, 'Add a step').click();
  await expectOnScreen(page, 'Kinds are your organization\'s vocabulary. Add your own if these don\'t fit.');
  await text(page, 'Community Check').click();
  await text(page, 'Add a step').click();
  await field(page, 'A new kind').fill('Elder check');
  await text(page, 'Add this kind').click();
  await text(page, 'Elder check').click();
  await expectOnScreen(page, 'Step 2 of 2', 'Add a check alongside', 'Move up', 'Remove this step');
  await text(page, 'Move up').click();
  await closeSheet(page);
  await primary(page).click();
  await expectToast(page, `${name} saved.`);
  await expectOnScreen(page, /Your organization · 1/i, name);
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

for (const who of ['ADMIN', 'COORD'] as const) {
  test(`SETUP-046 ${who} Remove one of a language\'s checks; Undo puts it back`, async ({ browser }) => {
    const w = world();
    const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    await checks(page, w, who);
    await text(page, 'Community check').click();
    await expectOnScreen(page, 'Community check', 'Check 2 · Alpha', 'People', 'Questions', 'Helps', 'Must pass', 'Remove this check');
    await text(page, 'Remove this check').click();
    await expectToast(page, 'Community check removed');
    await expectOnScreen(page, 'A translator records a version');
    expect(await listed(page)).toEqual(['Peer check', 'Back translation', 'Consultant check', 'Final approval']);
    await undoToast(page);
    await expect.poll(() => listed(page)).toEqual(['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval']);
    await expectSent(page, w);
    await expectNothingRefused(page, w);
    await context.close();
    // P-ASIDE's set-aside Community check is still on its record: the step was never removed (decision 32).
  });
}

test('SETUP-048 Follow, update, stop following and copy a shared flow', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  await more(page);
  await text(page, 'Every way to check').click();
  await cardWith(page, 'Oral Review Path', 'Follow').getByRole('button', { name: 'Follow', exact: true }).click();
  await text(page, 'I\'ll take updates').click();
  await expectToast(page, 'Following Oral Review Path. You choose when to take updates.');
  await text(page, 'Oral Review Path').click();
  await expectOnScreen(page, 'Follows LangQuest', 'It changes only when they publish a new version. Copy it to make your own changes.');
  await text(page, 'Stop following').click();
  await expectToast(page, 'Stopped following. The version in use stays.');
  await text(page, 'Follow again').click();
  await expectToast(page, 'Following LangQuest again.');
  await text(page, 'Copy to change it').click();
  await expectToast(page, 'Oral Review Path copied. It is yours to change.');
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

for (const who of ['ADMIN', 'LADMIN'] as const) {
  test(`SETUP-067 ${who} A check\'s people`, async ({ browser }) => {
    const w = world();
    const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    await checks(page, w, who);
    await expectOnScreen(page, PEER_PEOPLE);
    await text(page, 'Peer check').click();
    await expectOnScreen(page, 'Peer check', 'Check 1 · Alpha', /People (Rita Reviewer, Trevor Both|Trevor Both, Rita Reviewer) Questions/);
    // People and Questions open pages of their own (decision 129).
    await text(page, 'People').click();
    await expectOnScreen(page, 'Rita Reviewer', 'Reviewer', 'Trevor Both', 'Translator-Reviewer');
    await text(page, 'Add people').click();
    // Whoever may review at Alpha can be put on a check; Translators have Review since decision 91. A viewer cannot.
    await expectOnScreen(page, 'Tom Translator', 'Kept Person', 'Cora Coordinator', 'You', who === 'ADMIN' ? 'Lena Lead' : 'Ada Admin');
    await expectNotOnScreen(page, 'Vic Viewer');
    await text(page, 'Tom Translator').click();
    await primary(page).click();
    await expectToast(page, 'Peer check: 3 people');
    // No timed Undo (Caleb, 2026-10-16): taking someone off is the way back.
    await expect(byId(page, 'toast-undo')).toHaveCount(0);
    await expect.poll(() => onCheck(page)).toContain('Tom Translator');
    await page.getByRole('button', { name: 'Take Tom Translator off this check' }).click();
    await expectToast(page, 'Peer check: 2 people');
    await expect.poll(() => onCheck(page)).not.toContain('Tom Translator');
    await back(page).click();
    await back(page).click();
    await expectOnScreen(page, PEER_PEOPLE);
    await expectSent(page, w);
    await expectNothingRefused(page, w);
    await context.close();
  });
}

test('SETUP-068 A check\'s questions', async ({ page }) => {
  const w = world();
  await checks(page, w, 'ADMIN');
  // LangQuest's checks come with no questions: a team writes its own on each check (LAN-85).
  expect(await screenText(page)).toMatch(/Community check Anyone \d+ Consultant check/);
  await text(page, 'Community check').click();
  await expectOnScreen(page, /Questions No questions/);
  await back(page).click();
  await text(page, 'Peer check').click();
  await text(page, 'Questions').click();
  await text(page, 'Add a question').click();
  await page.getByPlaceholder('The question').fill('Is it clear to a child?');
  await text(page, 'Yes / No').click();
  await toggle(page, 'Required').click({ force: true });
  await button(page, 'Save').click();
  await expectToast(page, 'Question saved');
  await expectOnScreen(page, 'Is it clear to a child?', 'Yes / No · Required');
  await back(page).click();
  await expectOnScreen(page, /Questions 1 question/);
  await back(page).click();
  await expectOnScreen(page, /Peer check .*1 question/);
  // A reviewer sees it when reviewing: REV-side checks live in 07-reviewing; here, edit and remove it.
  await text(page, 'Peer check').click();
  await text(page, 'Questions').click();
  await text(page, 'Is it clear to a child?').click();
  await expectOnScreen(page, 'Question', 'Remove question');
  await text(page, 'Remove question').click();
  await expectToast(page, 'Question removed');
  await expectNotOnScreen(page, 'Is it clear to a child?');
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-069 A check\'s helps', async ({ page }) => {
  const w = world();
  await checks(page, w, 'ADMIN');
  await text(page, 'Peer check').click();
  await text(page, 'Add a help').click();
  await expectOnScreen(page, 'Notes', 'Write a note', 'Guides and Bibles', 'FIA study guides (English)');
  await text(page, 'FIA study guides (English)').click();
  await expectToast(page, 'Added to Peer check');
  await expect(byId(page, 'toast-undo')).toHaveCount(0);
  await primary(page).click();
  await expectOnScreen(page, 'FIA study guides (English)');
  await text(page, 'Add a help').click();
  await text(page, 'Write a note').click();
  await field(page, 'Title').fill('Listen for names');
  await field(page, 'The note').fill('Check every name is said the same way.');
  await button(page, 'Save').click();
  await expectToast(page, 'Added to Peer check');
  await expectOnScreen(page, 'Listen for names', 'FIA study guides (English)');
  await back(page).click();
  await expectOnScreen(page, /Peer check .*2 helps/);
  await text(page, 'Peer check').click();
  await page.getByRole('button', { name: 'Take FIA study guides (English) off this check' }).click();
  await expectToast(page, 'Taken off Peer check');
  // Put back the way it was added: no timed Undo (Caleb, 2026-10-16).
  await text(page, 'Add a help').click();
  await text(page, 'FIA study guides (English)').click();
  await expectToast(page, 'Added to Peer check');
  await primary(page).click();
  await expectOnScreen(page, 'FIA study guides (English)');
  await page.getByRole('button', { name: 'Take FIA study guides (English) off this check' }).click();
  await page.getByRole('button', { name: 'Take Listen for names off this check' }).click();
  await expectToast(page, 'Taken off Peer check');
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-070 Must pass, and checks at the same time', async ({ page }) => {
  const w = world();
  await checks(page, w, 'ADMIN');
  // Community check must pass: a lock on its card.
  await text(page, 'Community check').click();
  await toggle(page, 'Must pass').click({ force: true });
  await expectToast(page, 'Alpha\'s checks saved');
  await expect(toggle(page, 'Must pass')).toBeChecked();
  await back(page).click();
  await expect(page.getByLabel('Community check must pass before the next steps')).toHaveCount(1);
  await undoToast(page).catch(() => undefined);
  // Back translation happens at the same time as Peer check; untick it there and it is a check of its own (decision 129).
  await text(page, 'Back translation').click();
  await expectOnScreen(page, /Same time as Peer check/);
  await text(page, 'Same time as').click();
  await expect(page.getByRole('checkbox', { name: 'Peer check' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Peer check' }).click();
  await primary(page).click();
  await expectToast(page, 'Alpha\'s checks saved');
  await expectOnScreen(page, 'Check 2 · Alpha', /Same time as No other check/);
  await text(page, 'Same time as').click();
  await page.getByRole('checkbox', { name: 'Peer check' }).click();
  await primary(page).click();
  await expectOnScreen(page, 'Check 1 · Alpha', /Same time as Peer check/);
  await back(page).click();
  // Community check back as it was.
  await text(page, 'Community check').click();
  if (await toggle(page, 'Must pass').isChecked()) await toggle(page, 'Must pass').click({ force: true });
  await back(page).click();
  await goBack(page);
  await expectOnScreen(page, ORDER);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-071 Add a check: one the organization knows, or a new one by name', async ({ page }) => {
  const w = world();
  await checks(page, w, 'ADMIN');
  await text(page, 'Add a check').click();
  await expectOnScreen(page, 'Retelling', 'Local check', 'Something else');
  await text(page, 'Retelling').click();
  await expectToast(page, 'Alpha\'s checks saved');
  await expect.poll(() => listed(page)).toContain('Retelling');
  await text(page, 'Add a check').click();
  await page.getByPlaceholder('A new kind of check, e.g. Elder check').fill('Elder check');
  await text(page, 'Add this check').click();
  await expectToast(page, 'Alpha\'s checks saved');
  await expect.poll(() => listed(page)).toEqual(['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval', 'Retelling', 'Elder check']);
  // Take both off again.
  for (const name of ['Elder check', 'Retelling']) {
    await text(page, name).click();
    await text(page, 'Remove this check').click();
    await expectToast(page, `${name} removed`);
  }
  await expect.poll(() => listed(page)).toEqual(['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval']);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-072 Start from a ready-made flow', async ({ page }) => {
  const w = world();
  await checks(page, w, 'LADMIN');
  await text(page, 'Start from a ready-made flow').click();
  await expectOnScreen(page, 'Ready-made flows', 'Replaces Alpha\'s checks', 'Standard Bible Flow', 'Quick Check', 'Peer check → Final approval');
  await text(page, 'Quick Check').click();
  await text(page, 'Use Quick Check').click();
  await expectToast(page, 'Alpha now starts from Quick Check');
  await expect.poll(() => listed(page)).toEqual(['Peer check', 'Final approval']);
  await undoToast(page);
  await expect.poll(() => listed(page)).toEqual(['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval']);
  // The checks' people stayed with them.
  await expectOnScreen(page, PEER_PEOPLE);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-073 Move a check to another place in the order', async ({ page }) => {
  const w = world();
  await checks(page, w, 'ADMIN');
  // Drag Final approval's grip above Consultant check.
  const grip = page.getByLabel('Move Final approval').first();
  const target = page.getByLabel('Move Consultant check').first();
  const from = await grip.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('the grips are not on screen');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2 - 10, { steps: 12 });
  await page.mouse.up();
  await expectToast(page, 'Alpha\'s checks saved');
  await expect.poll(() => listed(page)).toEqual(['Peer check', 'Back translation', 'Community check', 'Final approval', 'Consultant check']);
  await undoToast(page);
  await expect.poll(() => listed(page)).toEqual(['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval']);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});
