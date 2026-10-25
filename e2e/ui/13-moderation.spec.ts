// docs/ui-test-suite/13-moderation.md (MOD) on the web: the flag on what
// someone else made, reporting, blocking and what a block hides, taking
// something out of the record, and acting on reports from the Inbox
// (decision 48). Tests share one world and run in ID order; each says
// what it leaves behind, and blocks are put back through the server.
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { commands, derivePassage } from '@langquest-next/core';
import type { SyncClient } from '@langquest-next/sync';
import { setupBlobs } from './blob-upload';
import {
  expectAccountSent, languageAs, languageLoaded, newAccount, noteAs, openHistory, outboxRows, quietDevice, quietDevServer,
  reportAs, serverBlocks, setBlocked, toTabs
} from './account-helpers';
import { send, signIn, type UiWorld } from './fixture';
import { projectionPass } from './pass-helpers';
import {
  back, button, byId, expect, expectNothingRefused, expectSyncIdle, expectToast, field, languageArrived, openAs, openPassage, openSignedOut, primary, screenText, syncNow, tab, test, text,
  useWorld, type AccountKey
} from './support';

const world = useWorld();
test.beforeEach(async ({ context }) => { await quietDevServer(context); });

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const row = (page: Page, label: string) => button(page, new RegExp(`^${esc(label)}`));
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const closeSheet = (page: Page) => button(page, 'Close');
const nameOf = (key: AccountKey) => world().accounts[key].name;
const flagOf = (page: Page, key: AccountKey) => button(page, `Report or block ${nameOf(key)}`);

/** Each of `words` appears in `whole`, in this order (the sheet is drawn after the screen under it). */
function expectInOrder(whole: string, words: string[]) {
  let at = whole.lastIndexOf(words[0]!) - 1;
  for (const w of words) {
    const next = whole.indexOf(w, at + 1);
    expect(next, `"${w}" after position ${at}`).toBeGreaterThan(at);
    at = next;
  }
}

async function goPassage(page: Page, key: Parameters<typeof openPassage>[2]) {
  await toTabs(page);
  await openPassage(page, world(), key);
}

/** P-SUBMITTED's Version 1, by TRANS ("You" to TRANS), once the names have come down. */
async function openVersion(page: Page, viewer: AccountKey = 'REV') {
  await goPassage(page, 'P-SUBMITTED');
  await text(page, 'Version 1', false).click();
  await expect(text(page, new RegExp(`^${esc(viewer === 'TRANS' ? 'You' : nameOf('TRANS'))} · `))).toBeVisible();
}

/** REV's "needs changes" review of P-NEEDS (the check's name is the language's own: "Peer check"). */
async function openNeedsReview(page: Page) {
  await goPassage(page, 'P-NEEDS');
  await text(page, 'Versions and history').click();
  const reviews = button(page, /^Reviews by version/);
  if (!(await reviews.innerText()).includes('Hide')) await reviews.click();
  await button(page, /^Peer (Review|check) from/i).click();
  // A reviewer's page names the review; the translator's (answering it) names the passage. Both name REV.
  await expect(text(page, nameOf('REV'), false).or(text(page, 'Hidden because', false)).first()).toBeVisible();
  await expect(text(page, 'Something else?')).toHaveCount(0);
}

/** Open reports in ORG as ADMIN sees them (org_content_reports). */
async function openReportRows(): Promise<{ target_kind: string; target_id: string; reason: string; details: string | null }[]> {
  const { sb } = await signIn(world(), 'ADMIN');
  const { data, error } = await sb.rpc('org_content_reports', { p_org: world().orgId });
  if (error) throw new Error(error.message);
  return (data ?? []) as { target_kind: string; target_id: string; reason: string; details: string | null }[];
}

/**
 * The reports MOD-004 and MOD-007 leave, made through the server if they are
 * not open (a failed test before restarts the file on a fresh world).
 */
async function ensureReports() {
  const w = world();
  const rows = await openReportRows();
  const take = w.passages['P-SUBMITTED'];
  if (!rows.some((r) => r.target_kind === 'version' && r.target_id === take.takeId)) {
    await reportAs(w, 'REV', { kind: 'version', id: take.takeId!, profileId: w.accounts.TRANS.id, unitId: take.unitId }, 'spam', 'Test report');
  }
  if (!rows.some((r) => r.target_kind === 'person' && r.target_id === w.accounts.TRANS.id)) {
    await reportAs(w, 'REV', { kind: 'person', id: w.accounts.TRANS.id, profileId: w.accounts.TRANS.id }, 'harassment');
  }
}

async function openBell(page: Page) {
  await toTabs(page);
  await tab(page, 'work').click();
  await button(page, /^Updates/).click();
  await expect(heading(page, 'Inbox')).toBeVisible();
}

async function openMore(page: Page) {
  await toTabs(page);
  await tab(page, 'me').click();
  await row(page, 'More settings').click();
  await expect(heading(page, 'More settings')).toBeVisible();
}

const REASONS: [string, string][] = [
  ['Hateful or offensive', 'Insults or attacks on a people, faith or group'],
  ['Harassment or bullying', 'Aimed at you or someone else'],
  ['Sexual content', 'Including anything involving a child'],
  ['Violence or threats', 'Threatens or encourages harm'],
  ['Spam or unrelated', 'Not part of the translation work'],
  ['Something else', 'Say what in the box below']
];

/** Nothing this browser saved for `key` is a report (nothing was sent). */
async function expectNoReport(page: Page, key: AccountKey) {
  expect((await outboxRows(page, world().accounts[key].id)).filter((a) => a.kind === 'report')).toEqual([]);
}

// ---- The flag ------------------------------------------------------------------------------------

test('MOD-001 The flag on someone else\'s version opens Report or block', async ({ page }) => {
  await openAs(page, world(), 'REV');
  await openVersion(page);
  await flagOf(page, 'TRANS').click();
  await expect(text(page, 'Report or block')).toBeVisible();
  await expect(text(page, `This version by ${nameOf('TRANS')}`)).toBeVisible();
  await expect(row(page, 'Report this version')).toContainText('It is offensive, harmful or does not belong here');
  await expect(row(page, `Report ${nameOf('TRANS')}`)).toContainText('For how they behave, not one thing they made');
  await expect(row(page, `Block ${nameOf('TRANS')}`)).toContainText("Hide what they add, for you only. They aren't told.");
  await expect(page.getByRole('button', { name: /^Remove from the record/ })).toHaveCount(0);
  await closeSheet(page).click();
  await expect(text(page, 'Report or block')).toHaveCount(0);
  await expect(byId(page, 'toast')).toHaveCount(0);
  await expectNoReport(page, 'REV');
});

test('MOD-002 No flag on your own work, and none for guests', async ({ page, browser }) => {
  const w = world();
  await noteAs(w, 'TRANS', 'P-SUBMITTED', 'MOD-002 a note by the translator');
  await openAs(page, w, 'TRANS');
  await openVersion(page, 'TRANS');
  await expect(page.getByRole('button', { name: /^Report or block/ })).toHaveCount(0);
  await back(page).click();
  await openHistory(page);
  await expect(text(page, 'MOD-002 a note by the translator', false)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Report or block/ })).toHaveCount(0);
  await openNeedsReview(page);
  await expect(flagOf(page, 'REV')).toBeVisible();
  // A guest browsing public work: no flag anywhere. Explore lists what the projection pass has listed: have it run first.
  await projectionPass();
  const guest = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await quietDevServer(guest);
  const g = await guest.newPage();
  await openSignedOut(g);
  await button(g, 'Browse public work').click();
  await expect(heading(g, 'Explore')).toBeVisible();
  await button(g, /^Alpha/).click();
  await g.waitForTimeout(2000); // sleep: proves a negative (no flag appears once the language has loaded)
  await expect(g.getByRole('button', { name: /^Report or block/ })).toHaveCount(0);
  await guest.close();
});

test('MOD-003 Flags on reviews, notes and requests', async ({ page }) => {
  const w = world();
  await noteAs(w, 'COORD', 'P-SUBMITTED', 'Check verse 12');
  // COORD asks TRANS, with words, to record a passage nobody has asked of TRANS yet.
  const coord = await languageAs(w, 'COORD');
  await coord.appendMany(commands(coord.getState()).ask({
    commandId: randomUUID(), unitId: w.passages['P-S'].unitId, what: 'record', profileId: w.accounts.TRANS.id, note: 'Please record this one next'
  }) as never);
  await send(coord as SyncClient<unknown>, 'COORD asks with words');
  await openAs(page, w, 'TRANS');
  // Step 1: the review page.
  await openNeedsReview(page);
  await flagOf(page, 'REV').click();
  await expect(text(page, `This review by ${nameOf('REV')}`)).toBeVisible();
  await closeSheet(page).click();
  // Step 2: COORD's note in P-SUBMITTED's history.
  await goPassage(page, 'P-SUBMITTED');
  await openHistory(page);
  await flagOf(page, 'COORD').click();
  await expect(text(page, `This note by ${nameOf('COORD')}`)).toBeVisible();
  await closeSheet(page).click();
  // Step 3: COORD's request with words; the fixture's request on P-NEW has no words, and no flag.
  await goPassage(page, 'P-S');
  await openHistory(page);
  await flagOf(page, 'COORD').click();
  await expect(text(page, `This request by ${nameOf('COORD')}`)).toBeVisible();
  expectInOrder(await screenText(page), ['Report or block', `This request by ${nameOf('COORD')}`, 'Report this request', `Report ${nameOf('COORD')}`]);
  await closeSheet(page).click();
  await goPassage(page, 'P-NEW');
  await openHistory(page);
  await expect(page.getByRole('button', { name: /^Report or block/ })).toHaveCount(0);
});

// ---- Reporting -----------------------------------------------------------------------------------

test('MOD-004 Report what someone made', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'REV');
  await openVersion(page);
  await flagOf(page, 'TRANS').click();
  await row(page, 'Report this version').click();
  await expect(text(page, 'Report this version')).toBeVisible();
  await expect(text(page, 'What is wrong with it?')).toBeVisible();
  const radios = page.getByRole('radio').locator('visible=true');
  await expect(radios).toHaveCount(6);
  for (const [i, [label, sub]] of REASONS.entries()) await expect(radios.nth(i)).toHaveText(new RegExp(`^${esc(label)}\\s*${esc(sub)}$`));
  await expect(field(page, 'Anything else? (optional)')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: new RegExp(`^Also block ${esc(nameOf('TRANS'))}`) })).toContainText('Hide what they add, for you only');
  await expect(text(page, `Your organization's admins and the LangQuest team see the report. ${nameOf('TRANS')} is not told, and your organization does not see who sent it.`)).toBeVisible();
  await expect(primary(page)).toHaveAccessibleName('Send report');
  await expect(primary(page)).toBeDisabled();
  await page.getByRole('radio', { name: /^Spam or unrelated/ }).click();
  await field(page, 'Anything else? (optional)').fill('Test report');
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  // Online, the report reaches the server at once, and the toast says no more than that.
  await expectToast(page, /^Reported\. Thank you\.$/);
  await expect(text(page, 'Report this version')).toHaveCount(0);
  await expect(button(page, 'Play Version 1')).toBeVisible();
  await expectAccountSent(page, w.accounts.REV.id);
  // ADMIN's Inbox.
  const admin = await quietDevice(browser, w, 'ADMIN');
  await openBell(admin.page);
  await expect(row(admin.page, 'A version was reported')).toBeVisible();
  await admin.context.close();
  // TRANS is not told.
  const trans = await quietDevice(browser, w, 'TRANS');
  await openBell(trans.page);
  expect(await screenText(trans.page)).not.toMatch(/reported/i);
  await trans.context.close();
});

test('MOD-005 "Something else" needs words', async ({ page }) => {
  await openAs(page, world(), 'REV');
  await openVersion(page);
  await flagOf(page, 'TRANS').click();
  await row(page, 'Report this version').click();
  await page.getByRole('radio', { name: /^Something else/ }).click();
  const box = page.getByPlaceholder('What is wrong with it?').locator('visible=true').first();
  await expect(box).toBeVisible();
  await expect(primary(page)).toBeDisabled();
  await box.fill('   ');
  await expect(primary(page)).toBeDisabled();
  await box.fill('Not Luke at all');
  await expect(primary(page)).toBeEnabled();
  await closeSheet(page).click();
  await expect(byId(page, 'toast')).toHaveCount(0);
  await expectNoReport(page, 'REV');
});

test('MOD-006 Report and block together', async ({ page }) => {
  const w = world();
  try {
    await openAs(page, w, 'TREV');
    await openNeedsReview(page);
    await expect(text(page, 'Verse 18 is too fast')).toBeVisible();
    await flagOf(page, 'REV').click();
    await row(page, 'Report this review').click();
    await page.getByRole('radio', { name: /^Harassment or bullying/ }).click();
    await page.getByRole('checkbox', { name: new RegExp(`^Also block ${esc(nameOf('REV'))}`) }).click();
    await primary(page).click();
    await expectToast(page, `Reported and blocked ${nameOf('REV')}. Thank you.`);
    // What REV said is hidden: the review's words and voice note.
    await expect(text(page, `Hidden because you blocked ${nameOf('REV')}`)).toBeVisible();
    await expect(text(page, 'Verse 18 is too fast')).toHaveCount(0);
    await flagOf(page, 'REV').click();
    await expect(row(page, `Unblock ${nameOf('REV')}`)).toBeVisible();
    await row(page, 'Report this review').click();
    await expect(page.getByRole('checkbox', { name: /^Also block/ })).toHaveCount(0);
    await closeSheet(page).click();
    await expectAccountSent(page, w.accounts.TREV.id);
  } finally {
    // Resets: TREV unblocks REV.
    await setBlocked(w, 'TREV', 'REV', false);
  }
});

test('MOD-007 Report a person', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'REV');
  await openVersion(page);
  await flagOf(page, 'TRANS').click();
  await row(page, `Report ${nameOf('TRANS')}`).click();
  await expect(text(page, `Report ${nameOf('TRANS')}`)).toBeVisible();
  await expect(text(page, 'What is wrong with it?')).toBeVisible();
  await expect(page.getByRole('radio').locator('visible=true')).toHaveCount(6);
  await page.getByRole('radio', { name: /^Harassment or bullying/ }).click();
  await primary(page).click();
  await expectToast(page, /^Reported\. Thank you\.$/);
  await expectAccountSent(page, w.accounts.REV.id);
  const admin = await quietDevice(browser, w, 'ADMIN');
  await openBell(admin.page);
  await expect(row(admin.page, `${nameOf('TRANS')} was reported`)).toBeVisible();
  await admin.context.close();
});

test('MOD-008 Block someone, then Unblock', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'REV');
  await openVersion(page);
  await flagOf(page, 'TRANS').click();
  await row(page, `Block ${nameOf('TRANS')}`).click();
  await expect(text(page, 'Report or block')).toHaveCount(0);
  await expectToast(page, `Blocked ${nameOf('TRANS')}. What they add is hidden for you.`);
  await expect(text(page, `Hidden because you blocked ${nameOf('TRANS')}`)).toBeVisible();
  await expect(button(page, 'Play Version 1')).toHaveCount(0);
  // No toast offers Undo (decision 134): the same flag unblocks them.
  await button(page, `Show what ${nameOf('TRANS')} added`).click();
  await flagOf(page, 'TRANS').click();
  await row(page, `Unblock ${nameOf('TRANS')}`).click();
  await expectToast(page, `Unblocked ${nameOf('TRANS')}.`);
  await expect(button(page, 'Play Version 1')).toBeVisible();
  await openMore(page);
  await expect(text(page, 'Sync')).toBeVisible();
  expect(await screenText(page)).not.toContain('Blocked people');
  // Block again and let the toast go (about 3.5 seconds).
  await openVersion(page);
  await flagOf(page, 'TRANS').click();
  await row(page, `Block ${nameOf('TRANS')}`).click();
  await expectToast(page, `Blocked ${nameOf('TRANS')}.`);
  await expect(byId(page, 'toast')).toBeHidden({ timeout: 15_000 });
  await openMore(page);
  await expect(row(page, 'Blocked people')).toContainText('1 person');
  await expectAccountSent(page, w.accounts.REV.id);
  expect(await serverBlocks(w, 'REV')).toEqual([w.accounts.TRANS.id]);
});

test('MOD-009 What a blocked person made is hidden, and Show reveals it once', async ({ page }) => {
  const w = world();
  // REV has blocked TRANS (MOD-008).
  await setBlocked(w, 'REV', 'TRANS', true);
  await openAs(page, w, 'REV');
  await goPassage(page, 'P-SUBMITTED');
  // The passage's state is the same as before the block: Version 1 still counts.
  await expect(text(page, 'Version 1', false)).toBeVisible();
  await expect(text(page, /^Peer check/)).toBeVisible();
  await openHistory(page);
  await expect(text(page, 'Hidden because you blocked them', false)).toBeVisible();
  await expect(text(page, 'First recording.', false)).toHaveCount(0);
  await back(page).click();
  await text(page, 'Version 1', false).click();
  // The note and the recording each stand behind a dashed box with Show.
  const shows = page.getByRole('button', { name: `Show what ${nameOf('TRANS')} added` }).locator('visible=true');
  await expect(shows).toHaveCount(2);
  await expect(page.getByText(`Hidden because you blocked ${nameOf('TRANS')}`).locator('visible=true')).toHaveCount(2);
  await expect(button(page, 'Play Version 1')).toHaveCount(0);
  while (await shows.count()) await shows.first().click();
  await expect(text(page, 'First recording.')).toBeVisible();
  await expect(button(page, 'Play Version 1')).toBeVisible();
  await back(page).click();
  await text(page, 'Version 1', false).click();
  await expect(text(page, `Hidden because you blocked ${nameOf('TRANS')}`)).toBeVisible();
  await expect(button(page, 'Play Version 1')).toHaveCount(0);
});

test('MOD-010 A blocked person\'s updates leave the Inbox', async ({ page }) => {
  const w = world();
  const fromTrans = new RegExp(`^${esc(w.accounts.TRANS.name.split(' ')[0]!)}`);
  try {
    // REV has blocked TRANS; TRANS asked REV for the Peer Review of P-SUBMITTED and the back translation of P-BT (the fixture).
    await setBlocked(w, 'REV', 'TRANS', true);
    await openAs(page, w, 'REV');
    /** What P-SUBMITTED's record says about where it stands, up to "Something else?". */
    const standing = async () => {
      await goPassage(page, 'P-SUBMITTED');
      await expect(text(page, /^Peer check/)).toBeVisible();
      const all = await screenText(page);
      // Where each step stands, without names, avatars, times or what is on this device.
      return ['Version 1', 'Published', 'Peer check asked', 'Back translation same time', 'Community check after the peer check', 'Do the peer check']
        .filter((s) => all.includes(s));
    };
    const before = await standing();
    await openBell(page);
    await expect(page.getByRole('button', { name: fromTrans }).locator('visible=true')).toHaveCount(0);
    await toTabs(page);
    await tab(page, 'work').click();
    const bell = async () => Number(/(\d+) new/.exec(await button(page, /^Updates/).getAttribute('aria-label') ?? '')?.[1] ?? 0);
    const blockedCount = await bell();
    // Unblock TRANS (MOD-011): the updates show, unread, and the bell counts them.
    await goPassage(page, 'P-SUBMITTED');
    await text(page, 'Version 1', false).click();
    await flagOf(page, 'TRANS').click();
    await row(page, `Unblock ${nameOf('TRANS')}`).click();
    await openBell(page);
    await expect(page.getByRole('button', { name: fromTrans }).locator('visible=true').first()).toBeVisible();
    await expect(text(page, /^Unread \(\d+\)$/i)).toBeVisible();
    await toTabs(page);
    await tab(page, 'work').click();
    await expect.poll(bell).toBeGreaterThan(blockedCount);
    // P-SUBMITTED's state is the same either way.
    expect(await standing()).toEqual(before);
    await expectAccountSent(page, w.accounts.REV.id);
  } finally {
    await setBlocked(w, 'REV', 'TRANS', false);
  }
});

test('MOD-011 Unblock from the flag', async ({ page }) => {
  const w = world();
  await setBlocked(w, 'REV', 'TRANS', true);
  try {
    await openAs(page, w, 'REV');
    await goPassage(page, 'P-SUBMITTED');
    await text(page, 'Version 1', false).click();
    await button(page, `Show what ${nameOf('TRANS')} added`).click();
    await flagOf(page, 'TRANS').click();
    await expect(row(page, `Unblock ${nameOf('TRANS')}`)).toContainText('Show what they add again');
    await row(page, `Unblock ${nameOf('TRANS')}`).click();
    await expectToast(page, `Unblocked ${nameOf('TRANS')}.`);
    await expect(button(page, 'Play Version 1')).toBeVisible();
    // No toast offers Undo (decision 134): the same flag blocks them again.
    await flagOf(page, 'TRANS').click();
    await row(page, `Block ${nameOf('TRANS')}`).click();
    await expectToast(page, `Blocked ${nameOf('TRANS')}.`);
    // Blocked again: leaving and coming back hides the version.
    await back(page).click();
    await text(page, 'Version 1', false).click();
    await expect(text(page, `Hidden because you blocked ${nameOf('TRANS')}`)).toBeVisible();
    await button(page, `Show what ${nameOf('TRANS')} added`).click();
    await flagOf(page, 'TRANS').click();
    await row(page, `Unblock ${nameOf('TRANS')}`).click();
    await back(page).click();
    await text(page, 'Version 1', false).click();
    await expect(button(page, 'Play Version 1')).toBeVisible();
    await expectAccountSent(page, w.accounts.REV.id);
    expect(await serverBlocks(w, 'REV')).toEqual([]);
  } finally {
    await setBlocked(w, 'REV', 'TRANS', false);
  }
});

test('MOD-012 The Blocked people sheet', async ({ page }) => {
  const w = world();
  await setBlocked(w, 'REV', 'TRANS', true);
  await setBlocked(w, 'REV', 'TREV', true);
  try {
    await openAs(page, w, 'REV');
    await openMore(page);
    await expect(row(page, 'Blocked people')).toContainText('2 people');
    await row(page, 'Blocked people').click();
    await expect(text(page, "What they add is hidden for you. They aren't told.")).toBeVisible();
    const personRow = (key: AccountKey) => text(page, nameOf(key)).locator('xpath=ancestor::div[.//*[@role="button"]][1]');
    for (const key of ['TRANS', 'TREV'] as const) await expect(personRow(key).getByRole('button', { name: 'Unblock', exact: true })).toBeVisible();
    await personRow('TRANS').getByRole('button', { name: 'Unblock', exact: true }).click();
    await expect(personRow('TRANS')).toContainText('Unblocked');
    await personRow('TRANS').getByRole('button', { name: 'Block again', exact: true }).click();
    await expect(personRow('TRANS').getByRole('button', { name: 'Unblock', exact: true })).toBeVisible();
    await personRow('TRANS').getByRole('button', { name: 'Unblock', exact: true }).click();
    await personRow('TREV').getByRole('button', { name: 'Unblock', exact: true }).click();
    await closeSheet(page).click();
    await expect(text(page, 'Send diagnostics')).toBeVisible();
    expect(await screenText(page)).not.toContain('Blocked people');
    await expectAccountSent(page, w.accounts.REV.id);
    expect(await serverBlocks(w, 'REV')).toEqual([]);
  } finally {
    await setBlocked(w, 'REV', 'TRANS', false);
    await setBlocked(w, 'REV', 'TREV', false);
  }
});

test('MOD-013 Report and block offline', async ({ page, browser }) => {
  const w = world();
  await noteAs(w, 'TREV', 'P-SUBMITTED', 'MOD-013 a note by Trevor');
  try {
    await openAs(page, w, 'REV');
    await languageLoaded(page);
    await openVersion(page);
    await page.context().setOffline(true);
    await flagOf(page, 'TRANS').click();
    await row(page, 'Report this version').click();
    await page.getByRole('radio', { name: /^Spam or unrelated/ }).click();
    await primary(page).click();
    await expectToast(page, 'Reported. Thank you. It is sent when you are connected.');
    // Block TREV from the note TREV made.
    await back(page).click();
    await openHistory(page);
    await expect(text(page, 'MOD-013 a note by Trevor', false)).toBeVisible();
    await flagOf(page, 'TREV').click();
    await row(page, `Block ${nameOf('TREV')}`).click();
    await expect(text(page, 'MOD-013 a note by Trevor', false)).toHaveCount(0);
    await openBell(page);
    const saved = (await screenText(page)).toLowerCase();
    expect(saved.indexOf('saved account changes')).toBe(saved.indexOf('inbox') + 'inbox '.length);
    // Rows waiting to send are not buttons (only a refused one is tapped to try again).
    expect(saved).toContain('report waiting to send saved');
    expect(saved).toContain('block waiting to send saved');
    await page.context().setOffline(false);
    await expect(text(page, /saved account changes/i)).toBeHidden({ timeout: 45_000 });
    const admin = await quietDevice(browser, w, 'ADMIN');
    await openBell(admin.page);
    await expect(row(admin.page, 'A version was reported')).toBeVisible();
    await admin.context.close();
  } finally {
    // Resets: REV unblocks TREV.
    await setBlocked(w, 'REV', 'TREV', false);
  }
});

// ---- Taking something out of the record ----------------------------------------------------------

let moderationNote = '';

for (const key of ['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'REV', 'VIEW'] as const) {
  test(`MOD-014 ${key} Only moderators see "Remove from the record"`, async ({ browser }) => {
    const w = world();
    moderationNote ||= await noteAs(w, 'TREV', 'P-BT', 'Moderation check');
    const d = await quietDevice(browser, w, key);
    await goPassage(d.page, 'P-BT');
    await openHistory(d.page);
    await expect(text(d.page, 'Moderation check', false)).toBeVisible();
    await flagOf(d.page, 'TREV').click();
    const remove = d.page.getByRole('button', { name: /^Remove from the record/ });
    if (key === 'ADMIN' || key === 'COORD' || key === 'LADMIN') await expect(remove.locator('visible=true')).toContainText('For everyone. Needs a connection.');
    else await expect(remove).toHaveCount(0);
    await d.context.close();
  });
}

test('MOD-015 A moderator removes a note, and every device stops showing it', async ({ page, browser }) => {
  const w = world();
  if (!moderationNote) moderationNote = await noteAs(w, 'TREV', 'P-BT', 'Moderation check');
  const trev = await quietDevice(browser, w, 'TREV');
  const view = await quietDevice(browser, w, 'VIEW');
  for (const d of [trev, view]) {
    await goPassage(d.page, 'P-BT');
    await openHistory(d.page);
    await expect(text(d.page, 'Moderation check', false)).toBeVisible();
  }
  await openAs(page, w, 'ADMIN');
  await goPassage(page, 'P-BT');
  await openHistory(page);
  await flagOf(page, 'TREV').click();
  await row(page, 'Remove from the record').click();
  await expect(text(page, 'Remove this note?')).toBeVisible();
  await expect(text(page, 'It leaves the record for everyone in the organization.')).toBeVisible();
  await expect(text(page, "Use this for content that breaks the terms of use. The passage's status is worked out again without it. It needs a connection.")).toBeVisible();
  await expect(primary(page)).toHaveAccessibleName('Remove for everyone');
  await button(page, 'Cancel').click();
  await expect(text(page, 'Report or block')).toBeVisible();
  await row(page, 'Remove from the record').click();
  await primary(page).click();
  await expectToast(page, 'Removed from the record. Devices stop showing it when they next sync.');
  await expect(text(page, 'Moderation check', false)).toHaveCount(0, { timeout: 30_000 });
  for (const d of [trev, view]) {
    await syncNow(d.page);
    await toTabs(d.page);
    await goPassage(d.page, 'P-BT');
    await openHistory(d.page);
    await expect(text(d.page, 'Moderation check', false)).toHaveCount(0, { timeout: 30_000 });
    await d.context.close();
  }
});

test('MOD-016 Removing a version works the passage out again', async ({ page, browser }) => {
  const w = world();
  // TREV records and publishes Version 1 of Luke 18:1-17 (not started in the fixture).
  const trev = await languageAs(w, 'TREV');
  const found = Object.entries(trev.getState().units).find(([id, u]) => u.kind === 'passage' && id.replace(/~[^/]*$/, '').endsWith('/LUK.18.1-17'));
  expect(found, 'Luke 18:1-17 in the template').toBeTruthy();
  const [unitId, unit] = found!;
  const label = unit.label;
  const card = await uploadVoice(w, 'TREV');
  const recordingId = randomUUID();
  await trev.appendMany(commands(trev.getState()).addRecording({ commandId: recordingId, recordingId, unitId, kind: 'target', card }) as never);
  await trev.appendMany(commands(trev.getState()).keepTake({ commandId: randomUUID(), unitId, cardHashes: [card.hash], actorId: w.accounts.TREV.id }) as never);
  await trev.appendMany(commands(trev.getState()).publishVersion({ commandId: randomUUID(), unitId, cardHashes: [card.hash], actorId: w.accounts.TREV.id }) as never);
  await send(trev as SyncClient<unknown>, 'TREV publishes Luke 18:1-17');
  expect(derivePassage(trev.getState(), unitId).latest).toBeTruthy();
  const openIt = async (p: Page) => {
    await toTabs(p);
    await tab(p, 'map').click();
    const alpha = text(p, 'Alpha');
    if (!(await p.getByRole('button', { name: /^Luke/ }).locator('visible=true').count()) && await alpha.isVisible().catch(() => false)) await alpha.click();
    await button(p, /^Luke/).click();
    await text(p, label, false).click();
  };
  await openAs(page, w, 'COORD');
  await openIt(page);
  await text(page, 'Version 1', false).click();
  await flagOf(page, 'TREV').click();
  await row(page, 'Remove from the record').click();
  await primary(page).click();
  await expectToast(page, 'Removed from the record. Devices stop showing it when they next sync.');
  const trevDevice = await quietDevice(browser, w, 'TREV');
  for (const p of [page, trevDevice.page]) {
    await syncNow(p);
    await openIt(p);
    await expect(text(p, 'Version 1', false)).toHaveCount(0, { timeout: 30_000 });
  }
  await trevDevice.context.close();
});

test('MOD-017 Removing needs a connection', async ({ page }) => {
  const w = world();
  await noteAs(w, 'TREV', 'P-BT', 'MOD-017 still here');
  await openAs(page, w, 'COORD');
  await languageLoaded(page);
  await goPassage(page, 'P-BT');
  await openHistory(page);
  await page.context().setOffline(true);
  await flagOf(page, 'TREV').click();
  await row(page, 'Remove from the record').click();
  await primary(page).click();
  await expectToast(page, 'Not removed: try again when connected');
  await page.context().setOffline(false);
  await closeSheet(page).click().catch(() => undefined);
  await expect(text(page, 'MOD-017 still here', false)).toBeVisible();
});

test('MOD-018 Removed content stays gone for everyone', async ({ browser }) => {
  const w = world();
  const { world: w2, who } = await newAccount(w, 18, 'translator');
  try {
    for (const key of ['TRANS', 'REV', 'VIEW', who.key] as AccountKey[]) {
      const d = await quietDevice(browser, w2, key);
      await goPassage(d.page, 'P-BT');
      await openHistory(d.page);
      await expect(text(d.page, /^\d+ entr(y|ies)/)).toBeVisible();
      // A fresh device pulls the language in pages: the note can land a page before its
      // v1.Redacted, and the history draws in between. What counts is the record once it has all
      // arrived, read as it redraws.
      await languageArrived(d.page);
      await expect.poll(() => screenText(d.page), { message: `${key} sees the removed note` }).not.toContain('Moderation check');
      await expectNothingRefused(d.page, w2);
      await d.context.close();
    }
  } finally {
    await who.sb.rpc('delete_my_account');
  }
});

// ---- Reports in the Inbox ------------------------------------------------------------------------

for (const key of ['ADMIN', 'COORD', 'LADMIN'] as const) {
  test(`MOD-019 ${key} A moderator\'s Inbox lists content reports`, async ({ browser }) => {
    const w = world();
    const label = w.passages['P-SUBMITTED'].label;
    await ensureReports();
    const d = await quietDevice(browser, w, key);
    await tab(d.page, 'work').click();
    await expect(button(d.page, /^Updates, \d+ new$/)).toBeVisible({ timeout: 30_000 });
    await openBell(d.page);
    await expect(text(d.page, /^Unread \(\d+\)$/i)).toBeVisible();
    const report = row(d.page, 'A version was reported');
    await expect(report).toContainText(new RegExp(`Spam or unrelated( · \\d+ reports)? · ${esc(label)} · `));
    await report.click();
    await expect(text(d.page, /^Spam or unrelated( · \d+ reports)? · /)).toBeVisible();
    await expect(text(d.page, `Someone reported this for Spam or unrelated. It was made by ${nameOf('TRANS')}. Look at it, then remove it from the record or keep it.`))
      .toBeVisible();
    await expect(text(d.page, '"Test report"')).toBeVisible();
    await expect(text(d.page, 'Reports never say who sent them. The LangQuest team sees every report too.')).toBeVisible();
    await expect(button(d.page, 'Remove from the record')).toBeVisible();
    await expect(button(d.page, 'Open the passage')).toBeVisible();
    await expect(button(d.page, 'Keep it')).toBeVisible();
    expect(await screenText(d.page)).not.toContain(nameOf('REV'));
    await d.context.close();
  });
}

test('MOD-020 A moderator acts on a content report', async ({ page, browser }) => {
  const w = world();
  await ensureReports();
  const noteId = await noteAs(w, 'TREV', 'P-BT', 'MOD-020 disposable note');
  await reportAs(w, 'REV', { kind: 'note', id: noteId, profileId: w.accounts.TREV.id, unitId: w.passages['P-BT'].unitId }, 'spam');
  await openAs(page, w, 'ADMIN');
  await openBell(page);
  await row(page, 'A version was reported').click();
  await button(page, 'Open the passage').click();
  await expect(text(page, w.passages['P-SUBMITTED'].label, false)).toBeVisible();
  await expect(text(page, 'Something else?')).toBeVisible();
  await openBell(page);
  await tab(page, 'work').click();
  const before = Number(/(\d+) new/.exec(await button(page, /^Updates/).getAttribute('aria-label') ?? '')?.[1] ?? 0);
  await button(page, /^Updates/).click();
  await row(page, 'A version was reported').click();
  await button(page, 'Keep it').click();
  await expectToast(page, 'Kept. The report is closed.');
  await expect(page.getByRole('button', { name: /^A version was reported/ })).toHaveCount(0);
  await back(page).click();
  await expect.poll(async () => Number(/(\d+) new/.exec(await button(page, /^Updates/).getAttribute('aria-label') ?? '')?.[1] ?? 0)).toBe(before - 1);
  // The note's report: removing asks once more, as from the flag.
  await button(page, /^Updates/).click();
  await row(page, 'A note was reported').click();
  await button(page, 'Remove from the record').click();
  await expect(text(page, 'It leaves the record for everyone in the organization.', false)).toBeVisible();
  await button(page, 'Remove for everyone').click();
  await expectToast(page, 'Removed from the record. Devices stop showing it when they next sync.');
  await expect(page.getByRole('button', { name: /^A note was reported/ })).toHaveCount(0);
  // The removal is on this device when the toast shows: COORD can only be told once it has gone up.
  await expectSyncIdle(page);
  // COORD no longer sees either report; the note is gone after a sync.
  const coord = await quietDevice(browser, w, 'COORD');
  // A fresh device draws before its language has all come down: wait for the removal to arrive with it.
  await languageArrived(coord.page);
  await openBell(coord.page);
  await expect(text(coord.page, /^Unread|^Earlier|Nothing yet/i)).toBeVisible();
  expect(await screenText(coord.page)).not.toMatch(/A version was reported|A note was reported/);
  await goPassage(coord.page, 'P-BT');
  await openHistory(coord.page);
  await expect(text(coord.page, 'MOD-020 disposable note', false)).toHaveCount(0);
  await coord.context.close();
});

test('MOD-021 Reports about a person', async ({ page, browser }) => {
  const w = world();
  const reported = `${nameOf('TRANS')} was reported`;
  await ensureReports();
  // LADMIN never sees it (it invites only at LANG-A); COORD does, before it is closed.
  const lead = await quietDevice(browser, w, 'LADMIN');
  await openBell(lead.page);
  expect(await screenText(lead.page)).not.toContain(reported);
  await lead.context.close();
  const coord = await quietDevice(browser, w, 'COORD');
  await openBell(coord.page);
  await expect(row(coord.page, reported)).toBeVisible();
  await openAs(page, w, 'ADMIN');
  await openBell(page);
  await row(page, reported).click();
  await expect(text(page, `Someone reported ${nameOf('TRANS')} for Harassment or bullying. You can remove them from the organization under Members.`)).toBeVisible();
  await expect(text(page, 'Reports never say who sent them. The LangQuest team sees every report too.')).toBeVisible();
  await expect(button(page, 'Open Members')).toBeVisible();
  await expect(button(page, 'Close the report')).toBeVisible();
  await button(page, 'Open Members').click();
  // Updated (2026-10-13, main's 7f26068): a reported person opens that member, where they can be removed.
  await expect(heading(page, nameOf('TRANS'))).toBeVisible();
  await expect(text(page, 'Remove from language')).toBeVisible();
  await back(page).click();
  await openBell(page);
  await row(page, reported).click();
  await button(page, 'Close the report').click();
  await expectToast(page, 'Kept. The report is closed.');
  await expect(page.getByRole('button', { name: new RegExp(`^${esc(reported)}`) })).toHaveCount(0);
  await coord.page.reload();
  await openBell(coord.page);
  await expect(text(coord.page, /^Unread|^Earlier|Nothing yet/i)).toBeVisible();
  expect(await screenText(coord.page)).not.toContain(reported);
  await coord.context.close();
});

test('MOD-022 Nobody sees a report about themselves', async ({ page, browser }) => {
  const w = world();
  await noteAs(w, 'COORD', 'P-BT', "Moderator's own note");
  await openAs(page, w, 'TREV');
  await goPassage(page, 'P-BT');
  await openHistory(page);
  await flagOf(page, 'COORD').click();
  await row(page, 'Report this note').click();
  await page.getByRole('radio', { name: /^Hateful or offensive/ }).click();
  await primary(page).click();
  await expectToast(page, /^Reported\. Thank you\./);
  await expectAccountSent(page, w.accounts.TREV.id);
  const admin = await quietDevice(browser, w, 'ADMIN');
  await openBell(admin.page);
  await row(admin.page, 'A note was reported').click();
  await expect(text(admin.page, `Someone reported this for Hateful or offensive. It was made by ${nameOf('COORD')}. Look at it, then remove it from the record or keep it.`))
    .toBeVisible();
  expect(await screenText(admin.page)).not.toContain(nameOf('TREV'));
  await admin.context.close();
  const coord = await quietDevice(browser, w, 'COORD');
  await openBell(coord.page);
  await expect(text(coord.page, /^Unread|^Earlier|Nothing yet/i)).toBeVisible();
  const all = await screenText(coord.page);
  expect(all).not.toContain('A note was reported');
  expect(all).not.toContain(nameOf('TREV'));
  await coord.context.close();
});

test('MOD-023 Reports need a connection to read and to act on', async ({ page }) => {
  const w = world();
  // An open content report (MOD-022's note, about COORD), read by ADMIN online.
  await openAs(page, w, 'ADMIN');
  await languageLoaded(page);
  await openBell(page);
  await row(page, 'A note was reported').click();
  await page.context().setOffline(true);
  await button(page, 'Keep it').click();
  await expectToast(page, 'Not saved: try again when connected');
  await page.context().setOffline(false);
  await closeSheet(page).click().catch(() => undefined);
  await expect(row(page, 'A note was reported')).toBeVisible();
  // Steps 1 and 2 need the projection worker's notification on this device: checked by hand (see the spec).
});

/** A short WAV uploaded where the app keeps the language's files, for a version made through the server. */
async function uploadVoice(w: UiWorld, key: AccountKey) {
  const { blobKey } = await import('@langquest-next/sync');
  const { createHash } = await import('node:crypto');
  const { signIn } = await import('./fixture');
  const rate = 16000;
  const n = rate * 2;
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => { for (let k = 0; k < s.length; k++) view.setUint8(at + k, s.charCodeAt(k)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, n * 2, true);
  const pitch = 170 + Math.floor(Math.random() * 60);
  for (let k = 0; k < rate; k++) view.setInt16(44 + k * 2, Math.round(0.5 * Math.sin(2 * Math.PI * pitch * (k / rate)) * 32767), true);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { session } = await signIn(w, key);
  await setupBlobs(w.apiUrl, session.access_token).put(blobKey(w.orgId, w.languages.A.languageId, hash, 'wav'), bytes);
  return { hash, durationMs: 2000, format: 'wav' as const };
}


