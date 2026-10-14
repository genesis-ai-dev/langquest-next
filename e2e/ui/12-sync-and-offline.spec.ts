// 12. Sync and offline (docs/ui-test-suite/12-sync-and-offline.md), on the
// web: offline is the browser context's network switched off, a second
// device is a second browser context, and another person's writes go through
// the real server (`clientAs`). SYNC-018 to SYNC-020 (refused work) are in
// 12-sync-removed.spec.ts and 12-sync-refused.spec.ts, each on a world of its
// own. Phone-only tests are Maestro flows (apps/mobile/test/maestro/flows).
//
// Each test opens a fresh browser (a fresh install), so before going offline
// it waits until the device has caught up with the server (`caughtUp`), as a
// person's device would have before they set out.
import type { Page } from '@playwright/test';
import {
  button, expect, expectNothingRefused, expectSent, expectSyncIdle, openAs, screenText, syncNow, tab, test, text, useWorld
} from './support';
import {
  addNote, caughtUp, deviceAs, keptHere, noteAs, openByLabel, openRecord, openSync, passageAs, quietReloads, recordAndPublish, serverHasAudio, setOffline, syncChip, tile, tileLocator, toTab
} from './sync-helpers';

const world = useWorld();

// The shared dev server's hot reloads must not reload the app under a test.
test.beforeEach(async ({ context }) => { await quietReloads(context); });


const LIVE = 'Live: changes arrive as they happen';
const POLLING = 'Checking for changes now and then';
const OFFLINE = 'Offline: work is kept on this device';
const idle = (page: Page, which: 'uploading' | 'downloading') => page.locator(`[aria-label="Audio ${which}: nothing"]`).locator('visible=true');
const updates = (page: Page) => page.getByRole('button', { name: /^Updates/ }).locator('visible=true').first();

test('SYNC-001 The Sync screen, online', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await openSync(page);
  await expectSyncIdle(page);
  await expect(text(page, LIVE).or(text(page, POLLING)).first()).toBeVisible();
  await expect(text(page, 'The server refused this account for this organization.')).toBeHidden();
  await expect(text(page, 'Ready for offline')).toBeVisible();
  await expect(text(page, 'Always on this device')).toBeVisible();
  await expect(text(page, 'Needs a connection')).toBeVisible();
  expect(await tile(page, 'waiting to upload')).toBe(0);
  expect(await tile(page, 'refused by the server')).toBe(0);
  await expect.poll(() => tile(page, 'latest confirmed')).toBeGreaterThan(0);
  await expect(tileLocator(page, 'local checkpoint')).toBeVisible();
  // Two by two on a phone.
  const boxes = await Promise.all(['waiting to upload', 'refused by the server', 'latest confirmed', 'local checkpoint'].map((l) => tileLocator(page, l).boundingBox()));
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(4);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 4);
  await expect(text(page, 'Audio uploading')).toBeVisible();
  await expect(text(page, 'Audio downloading')).toBeVisible();
  await expect(idle(page, 'uploading')).toHaveCount(1);
  await expect(idle(page, 'downloading')).toHaveCount(1, { timeout: 60_000 });
  const body = await screenText(page);
  expect(body).not.toMatch(/Waiting · \d/);
  expect(body).not.toMatch(/Refused · \d/);
  await expect(text(page, /^[\d,]+ events? on this device$/)).toBeVisible();
  await expect(text(page, /^(store build|update [0-9a-f]{7}|update unknown)/)).toBeVisible();
  await expect(button(page, 'Sync now')).toBeEnabled();
});

test('SYNC-002 The Sync screen, offline', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await setOffline(context, true);
  await openSync(page);
  await expect.poll(() => tile(page, 'latest confirmed')).toBeGreaterThan(0);
  const confirmed = await tile(page, 'latest confirmed');
  // Known issue (wake.ts, decision 90): nothing tries the server when the network goes, so until something does the banner still says Live.
  await expect.soft(text(page, OFFLINE), 'the banner says Offline before Sync now').toBeVisible({ timeout: 15_000 });
  await button(page, 'Sync now').click();
  await expect(button(page, 'Sync now')).toBeEnabled({ timeout: 30_000 });
  await expect(text(page, OFFLINE)).toBeVisible();
  await expect(page.getByTestId('toast').locator('visible=true')).toHaveCount(0);
  expect(await tile(page, 'latest confirmed')).toBe(confirmed);
  expect(await tile(page, 'waiting to upload')).toBe(0);
  expect(await tile(page, 'refused by the server')).toBe(0);
});

test('SYNC-003 Waiting work is listed until it goes', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await setOffline(context, true);
  await openRecord(page, w, 'P-SUBMITTED');
  for (const n of [1, 2, 3]) await addNote(page, w, 'P-SUBMITTED', `SYNC-003 note ${n}`, { open: false });
  await openSync(page);
  await expect.poll(() => tile(page, 'waiting to upload')).toBeGreaterThanOrEqual(3);
  const waiting = await tile(page, 'waiting to upload');
  await expect(text(page, `Waiting · ${waiting}`)).toBeVisible();
  // One row per event: its type without the version prefix and the passage it is about (design principle 11),
  // and the time it was made, to the second.
  const row = `NoteAdded · ${w.passages['P-SUBMITTED'].label}`;
  await expect(page.getByText(row, { exact: true }).locator('visible=true')).toHaveCount(3);
  expect((await screenText(page)).split(row + ' ').filter((rest) => /^\d{1,2}:\d{2}:\d{2}/.test(rest))).toHaveLength(3);
  expect(await screenText(page)).not.toContain('v1.NoteAdded');
  const confirmed = await tile(page, 'latest confirmed');
  await setOffline(context, false);
  await expect.poll(() => tile(page, 'waiting to upload'), { timeout: 30_000 }).toBe(0);
  await expect(text(page, /^Waiting · \d/)).toBeHidden();
  // The position moves when the server's answer comes back, a moment after the upload.
  await syncNow(page);
  await expect.poll(() => tile(page, 'latest confirmed'), { timeout: 30_000 }).toBeGreaterThan(confirmed);
  expect(await tile(page, 'refused by the server')).toBe(0);
});

test('SYNC-005 Sync now', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await openSync(page);
  await expect.poll(() => tile(page, 'latest confirmed')).toBeGreaterThan(0);
  const before = await tile(page, 'latest confirmed');
  await noteAs(w, 'COORD', 'P-SUBMITTED', 'SYNC-005 from Cora');
  // Slow the server's answers a little, so "Syncing…" can be seen.
  await page.route('**/rest/v1/rpc/**', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue().catch(() => undefined);
  });
  await button(page, 'Sync now').click();
  await expect(button(page, 'Syncing…')).toBeDisabled();
  await expect(button(page, 'Sync now')).toBeEnabled({ timeout: 30_000 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await expect.poll(() => tile(page, 'latest confirmed'), { timeout: 15_000 }).toBeGreaterThan(before);
  await openRecord(page, w, 'P-SUBMITTED');
  await text(page, 'Versions and history').click();
  await button(page, /^History\. /).click();
  await expect(text(page, 'SYNC-005 from Cora', false)).toBeVisible();
});

test('SYNC-007 My Work\'s sync chip shows only when it matters', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible();
  await expect(syncChip(page)).toBeHidden();
  await setOffline(context, true);
  // Known issue (wake.ts, decision 90): nothing tries the server when the network goes, so the app does not know yet.
  await expect.soft(syncChip(page), 'the chip says Offline within 10 seconds').toHaveAccessibleName('Offline', { timeout: 15_000 });
  await addNote(page, w, 'P-SUBMITTED', 'SYNC-007 offline note');
  await toTab(page, 'work');
  const chip = syncChip(page);
  await expect(chip).toHaveAccessibleName(/^\d+ to send$/);
  const box = await chip.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await chip.click();
  await expect(page.getByRole('heading', { name: 'Sync', exact: true }).locator('visible=true')).toBeVisible();
  await setOffline(context, false);
  await expectSent(page, w);
  await toTab(page, 'work');
  await expect(syncChip(page)).toBeHidden({ timeout: 30_000 });
});

test('SYNC-008 Changes from another device arrive by themselves', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await openSync(page);
  await expect(text(page, LIVE)).toBeVisible({ timeout: 30_000 });
  await openRecord(page, w, 'P-SUBMITTED');
  await text(page, 'Versions and history').click();
  await button(page, /^History\. /).click();
  await noteAs(w, 'COORD', 'P-SUBMITTED', 'SYNC-008 arrives by itself');
  // No Sync now: the live channel brings it.
  await expect(text(page, 'SYNC-008 arrives by itself', false)).toBeVisible({ timeout: 10_000 });
});

test('SYNC-009 A translator records and publishes offline @p0', async ({ page, context, browser }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await setOffline(context, true);
  await recordAndPublish(page, w, 'P-NEW', 2);
  await expect(text(page, /^Version 1 · \d+:\d\d$/)).toBeVisible();
  await expect(text(page, /^Published/)).toBeVisible();
  await openSync(page);
  await expect.poll(() => tile(page, 'waiting to upload')).toBeGreaterThan(0);
  await expect(text(page, /^\d+ left · /)).toBeVisible();
  // Step 3 (kill and reopen offline) is phone-only: a browser needs a connection to load the page (decision 58, WEB-027).
  await setOffline(context, false);
  await expect.poll(() => tile(page, 'waiting to upload'), { timeout: 30_000 }).toBe(0);
  await expect(idle(page, 'uploading')).toHaveCount(1, { timeout: 60_000 });
  expect(await tile(page, 'refused by the server')).toBe(0);
  await expectNothingRefused(page, w);
  // Device 2 (COORD): the same Version 1, by TRANS, and its audio on the server.
  const { view } = await passageAs(w, 'COORD', w.passages['P-NEW'].unitId);
  expect(view.latest?.by).toBe(w.accounts.TRANS.id);
  expect(await serverHasAudio(w, 'COORD', view.latest!.cardHashes)).toBe(true);
  const coord = await deviceAs(browser, w, 'COORD');
  await caughtUp(coord.page, w, 'COORD');
  await openRecord(coord.page, w, 'P-NEW');
  await text(coord.page, 'Versions and history').click();
  await expect(button(coord.page, 'Open Version 1')).toContainText('Tom Translator');
  await coord.context.close();
});

test('SYNC-010 A reviewer reviews offline @p0', async ({ page, context, browser }) => {
  const w = world();
  await openAs(page, w, 'REV');
  await caughtUp(page, w, 'REV');
  // P-SUBMITTED is kept because REV was asked to review it: its audio comes down before REV sets out.
  await openRecord(page, w, 'P-SUBMITTED');
  await keptHere(page);
  await setOffline(context, true);
  await button(page, /^Do the peer (check|review)$/).click();
  await button(page, 'Next: decide').click();
  await button(page, 'Looks good').click();
  await expect(page.getByTestId('toast').locator('visible=true')).toContainText(/^Looks good · /);
  await expect(button(page, /^Peer check, looks good/)).toBeVisible();
  await setOffline(context, false);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
  // Device 2 (TRANS): the update, unread, and the same state.
  const trans = await deviceAs(browser, w, 'TRANS');
  await caughtUp(trans.page, w, 'TRANS');
  await syncNow(trans.page);
  await updates(trans.page).click();
  // Unread, at the top: "Rita did the Peer Review you asked for", and "Peer Review: looks good" about P-SUBMITTED.
  await expect(text(trans.page, /^Rita( Reviewer)? did the Peer (Review|check) you asked for/i)).toBeVisible({ timeout: 30_000 });
  const inbox = await screenText(trans.page);
  expect(inbox).toMatch(new RegExp(`^Inbox UNREAD \\(\\d+\\) Rita( Reviewer)? did the Peer (Review|check) you asked for ${w.passages['P-SUBMITTED'].label}`, 'i'));
  expect(inbox).toMatch(new RegExp(`Peer (Review|check): looks good Rita Reviewer approved ${w.passages['P-SUBMITTED'].label}`, 'i'));
  await openRecord(trans.page, w, 'P-SUBMITTED');
  await expect(button(trans.page, /^Peer check, looks good/)).toBeVisible();
  await trans.context.close();
});

test('SYNC-011 A coordinator asks someone offline', async ({ page, context, browser }) => {
  const w = world();
  const label = 'Luke 17:11–19';
  await openAs(page, w, 'COORD');
  await caughtUp(page, w, 'COORD');
  await setOffline(context, true);
  await openByLabel(page, label);
  await button(page, 'Something else?').click();
  await button(page, /^Someone else should do this/).click();
  await page.getByRole('radio', { name: /^Trevor Both/ }).locator('visible=true').first().click();
  await button(page, 'In a week').click();
  await button(page, /^Ask /).click();
  await expect(text(page, /Trevor Both/, false)).toBeVisible();
  await setOffline(context, false);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
  const trev = await deviceAs(browser, w, 'TREV');
  await caughtUp(trev.page, w, 'TREV');
  await expect(text(trev.page, label, false)).toBeVisible({ timeout: 30_000 });
  await updates(trev.page).click();
  // The Inbox names people by their first name.
  await expect(text(trev.page, /^Cora( Coordinator)? asked you to record/)).toBeVisible({ timeout: 30_000 });
  await trev.context.close();
});

test('SYNC-012 A translator answers feedback offline', async ({ page, context, browser }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await openRecord(page, w, 'P-NEEDS');
  await keptHere(page);
  await setOffline(context, true);
  // REV's feedback and voice note are here offline (P-NEEDS is kept: TRANS worked on it).
  await button(page, 'Hear the feedback').click();
  await expect(text(page, /Verse 18 is too fast/, false)).toBeVisible();
  await expect(button(page, /feedback$/)).toBeVisible();
  await recordAndPublish(page, w, 'P-NEEDS', 2, { enter: () => button(page, 'Record a fix').click() });
  await expect(text(page, /^Version 2 · \d+:\d\d$/)).toBeVisible();
  await setOffline(context, false);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
  const rev = await deviceAs(browser, w, 'REV');
  await caughtUp(rev.page, w, 'REV');
  await updates(rev.page).click();
  await expect(text(rev.page, new RegExp(`^Tom( Translator)? revised ${w.passages['P-NEEDS'].label}`))).toBeVisible({ timeout: 30_000 });
  await expect(text(rev.page, 'The new version answers your', false)).toBeVisible();
  await rev.context.close();
});

test('SYNC-014 Notes added offline on two devices end in the same order', async ({ page, context, browser }) => {
  const w = world();
  await openAs(page, w, 'REV');
  const trans = await deviceAs(browser, w, 'TRANS');
  await caughtUp(page, w, 'REV');
  await caughtUp(trans.page, w, 'TRANS');
  await setOffline(context, true);
  await setOffline(trans.context, true);
  await addNote(page, w, 'P-BT', 'SYNC-014 A');
  await addNote(trans.page, w, 'P-BT', 'SYNC-014 B');
  await addNote(page, w, 'P-BT', 'SYNC-014 C', { open: false });
  await setOffline(context, false);
  await setOffline(trans.context, false);
  await expectSent(page, w);
  await expectSent(trans.page, w);
  const order = async (p: Page) => {
    await syncNow(p);
    await openRecord(p, w, 'P-BT');
    await text(p, 'Versions and history').click();
    await button(p, /^History\. /).click();
    for (const x of ['A', 'B', 'C']) await expect(text(p, `SYNC-014 ${x}`, false)).toBeVisible({ timeout: 30_000 });
    const body = await screenText(p);
    return ['A', 'B', 'C'].map((x) => body.indexOf(`SYNC-014 ${x}`));
  };
  const rank = (xs: number[]) => xs.map((x) => xs.filter((y) => y < x).length);
  const a = rank(await order(page));
  const b = rank(await order(trans.page));
  expect(a).toEqual(b);
  // By the order they were made: A, B, C (oldest or newest first, the same on both).
  expect([[0, 1, 2], [2, 1, 0]]).toContainEqual(a);
  await trans.context.close();
});

test('SYNC-032 The web offers a reload for a new version', async ({ page }) => {
  let asked = 0;
  await page.route('**/version.json', async (route) => { asked++; await route.fulfill({ json: { build: 'ui-test-newer-build' } }); });
  await openAs(page, world(), 'TRANS');
  await expect(tab(page, 'work')).toBeVisible();
  // A Metro page has no build id (webBuild.ts) and never asks; the export (the default target) does.
  test.skip(process.env['UI_TARGET'] === 'dev', 'Metro\'s dev page has no build id (EXPO_PUBLIC_BUILD_ID): run on the export (the default UI_TARGET).');
  await expect.poll(() => asked, { message: 'the export asks version.json for its build' }).toBeGreaterThan(0);
  const banner = button(page, 'A new version of LangQuest is ready. Reload to use it.');
  await expect(banner).toBeVisible();
  // It never reloads by itself.
  await page.waitForTimeout(3000); // sleep: proves a negative (the page does not reload by itself); nothing on screen changes to wait for
  await expect(banner).toBeVisible();
  const reloaded = page.waitForEvent('load');
  await banner.click();
  await reloaded;
});
