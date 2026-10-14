// 05 The passage record (docs/ui-test-suite/05-passage-record.md): doing a
// check from the record and the record afterwards, feedback, setting aside,
// Something else?'s choices, notes, checks that already happened,
// checkpoints, drafts, and the version pages. These change passages, so this
// file has a world of its own. The review and recording screens belong to
// 06 REC and 07 REV: here a test checks the record's button opens them,
// then makes the review through the server as that person
// (05-passage-helpers actAs), and reads the record afterwards. Recording a
// part uses Chrome's fake microphone (06-recording-helpers).
import type { Page } from '@playwright/test';
import { back, button, byId, expect, field, screenText, tab, test, text, type AccountKey } from './support';
import { useRunWorld } from './reviewing-helpers';

import {
  actAs, closeSheet, expand, header, id, mainButton, myWork, openTeamRow, pageFor, passageAs, pathStep, recordAs, recordings, recordOn,
  recordOnePart, refreshRecord, sheet, sheetButtons, sheetText, somethingElse, sparePassages, teamRow, teamRows, unitOf, versionsPage,
  type Passage
} from './05-passage-helpers';

// One world for the run, kept when a failed test restarts the worker (reviewing-helpers.ts useRunWorld).
const world = useRunWorld('05-checks');
const nameOf = (who: AccountKey) => world().accounts[who].name;
const label = (p: Passage) => (typeof p === 'string' ? world().passages[p].label : p.label);
const take = (p: 'P-SUBMITTED' | 'P-NEEDS' | 'P-BT' | 'P-CHECK' | 'P-ASIDE' | 'P-DONE') => world().passages[p].takeId!;

async function toast(page: Page, message: string | RegExp): Promise<void> {
  await expect(byId(page, 'toast')).toBeVisible();
  await expect(byId(page, 'toast')).toContainText(message);
}

async function history(page: Page): Promise<string> {
  await versionsPage(page);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  return screenText(page);
}

/** The back translation screen: say one part with the fake microphone, then publish it. */
async function backTranslateOnePart(page: Page): Promise<void> {
  await button(page, 'Record part 1').click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  // The microphone's voice file speaks 1.5 s in every 4 s; the takeover covers the parts while it records.
  await page.waitForTimeout(10_000);
  await button(page, 'Stop recording').click();
  await expect(button(page, 'Publish'), 'a part was said').toBeEnabled({ timeout: 45_000 });
  await button(page, 'Publish').click();
  await button(page, 'Publish back translation').click();
  await expect(text(page, 'Back translation published')).toBeVisible({ timeout: 30_000 });
}

/** Spare passages for this file, set up once. */
let spares: { unitId: string; label: string }[] = [];
const spare = async (i: number) => {
  if (!spares.length) spares = await sparePassages(world(), 10, 10);
  return spares[i]!;
};

// ---- set-ups for a test that runs on a fresh world -----------------------------------------
// Playwright starts a new worker, and so a new world, after a failure. A test
// that needs what an earlier one left makes it through the server instead.

/** P-NEEDS at Version 2, as PASS-019 leaves it. */
async function needsAtV2(): Promise<void> {
  if ((await passageAs(world(), 'TRANS', 'P-NEEDS')).versions.length < 2) {
    await recordOn(world(), 'TRANS', 'P-NEEDS', { parts: 1, publish: true, note: 'Revised after Peer Review' });
  }
}

/** TRANS keeps two drafts of P-DONE, as PASS-031 and PASS-059 leave it. */
async function twoDraftsOnDone(): Promise<void> {
  const mine = async () => (await passageAs(world(), 'TRANS', 'P-DONE')).drafts.filter((d) => d.by === world().accounts.TRANS.id).length;
  while ((await mine()) < 2) await recordOn(world(), 'TRANS', 'P-DONE', { parts: 1, fresh: true });
}

/** P-CHECK's checkpoint moved past (`on`) or not. */
async function checkpointMovedPast(on: boolean): Promise<void> {
  const step = (await passageAs(world(), 'COORD', 'P-CHECK')).steps[2]!;
  if (on && !step.override) {
    await actAs(world(), 'COORD', (c) => c.depart({ commandId: id(), unitId: unitOf(world(), 'P-CHECK'), type: 'override', stepId: step.step.id, reason: 'Checked informally — will record it later' }));
  }
  if (!on && step.override) await actAs(world(), 'COORD', (c) => c.undoDeparture({ commandId: id(), departureId: step.override!.id }));
}

// ---- doing the check, and the record afterwards ---------------------------------------------

test('PASS-016 Do the check, and the record afterwards', async ({ browser }) => {
  test.setTimeout(300_000);
  const L = label('P-SUBMITTED');
  const page = await recordAs(browser, world(), 'REV', 'P-SUBMITTED');
  expect(await mainButton(page)).toBe('Do the peer check');
  await byId(page, 'primary-action').click();
  await expect(header(page)).toHaveText(L);
  await expect(text(page, 'Peer check')).toBeVisible();
  await byId(page, 'header-close').click();
  // The verdict itself is 07 REV's screen: REV gives it through the server, carrying the request.
  const p = await passageAs(world(), 'REV', 'P-SUBMITTED');
  const request = p.openRequests.find((r) => r.kindId === 'peer')!;
  await actAs(world(), 'REV', (c) => c.recordReview({ commandId: id(), takeIds: [take('P-SUBMITTED')], kindId: 'peer', outcome: 'looks_good', via: 'app', requestId: request.id }));
  await refreshRecord(page, world(), 'P-SUBMITTED');
  expect((await teamRows(page))[0]).toBe('Peer check, looks good');
  await openTeamRow(page, 'Peer check');
  expect(await sheetText(page)).toContain('Peer check Looks good · You');
  await expect(sheet(page).getByLabel('Not yet')).toBeVisible();
  await closeSheet(page);
  expect(await myWork(page)).not.toContain(L);
});

test('PASS-017 Back-translate it, and the record afterwards', async ({ browser }) => {
  test.setTimeout(400_000);
  const L = label('P-BT');
  const page = await recordAs(browser, world(), 'REV', 'P-BT');
  expect(await mainButton(page)).toBe('Back-translate it');
  await byId(page, 'primary-action').click();
  await expect(header(page)).toHaveText(L);
  expect(await screenText(page)).toContain('Back translation · into English');
  await backTranslateOnePart(page);
  const all = await screenText(page);
  // Fixed (2026-10-12): REV cannot ask, so the page offers no check to ask for, only Done.
  expect(all.toLowerCase()).not.toContain('next, ask for a check');
  await expect(byId(page, 'primary-action')).toHaveText('Done');
  await byId(page, 'primary-action').click();
  await expect(header(page)).toHaveText(L);
  expect((await teamRows(page)).slice(0, 2)).toEqual(['Peer check, looks good', 'Back translation, looks good']);
  // TREV, who may ask, is offered the next check after back-translating (a spare passage, its Peer check done).
  const s = await spare(0);
  await recordOn(world(), 'TRANS', s, { parts: 2, publish: true });
  const v1 = (await passageAs(world(), 'REV', s)).latest!.takeId;
  await actAs(world(), 'REV', (c) => c.recordReview({ commandId: id(), takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
  const t = await recordAs(browser, world(), 'TREV', s);
  expect(await mainButton(t)).toBe('Back-translate it');
  await byId(t, 'primary-action').click();
  await backTranslateOnePart(t);
  expect((await screenText(t)).toLowerCase()).toContain('next, ask for a check community check');
  await expect(byId(t, 'primary-action')).toHaveText(/^Ask /);
});

test('PASS-018 Hear the feedback @p0', async ({ browser }) => {
  test.setTimeout(300_000);
  const L = label('P-NEEDS');
  const rev = nameOf('REV');
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
  await byId(page, 'primary-action').click();
  await expect(header(page)).toHaveText(L);
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Report/ }).locator('visible=true').first()).toBeVisible();
  const all = await screenText(page);
  expect(all).toContain(`Peer check · needs changes`);
  expect(all).toMatch(new RegExp(`${rev} .+ · Version 1`));
  expect(all).toContain(`${rev}'s feedback`);
  expect(all).toContain('“Verse 18 is too fast”');
  await expect(byId(page, 'primary-action')).toHaveText('Record a fix');
  await expect(button(page, 'Keep it, say why')).toBeVisible();
  await button(page, 'Hear Version 1, the version they heard').click();
  await expect(header(page)).toHaveText('Version 1');
});

test('PASS-019 Record a fix', async ({ browser }) => {
  test.setTimeout(400_000);
  const L = label('P-NEEDS');
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
  await byId(page, 'primary-action').click();
  await byId(page, 'primary-action').click();
  await expect(byId(page, 'record-button')).toBeVisible();
  await recordOnePart(page);
  await byId(page, 'publish-button').click();
  await expect(byId(page, 'primary-action')).toHaveText('Publish Version 2');
  await byId(page, 'primary-action').click();
  await expect(text(page, 'Version 2 published')).toBeVisible({ timeout: 30_000 });
  // Answered feedback keeps the check open (decisions.md 94): the peer check is the one asked for again.
  expect((await screenText(page)).toLowerCase()).toContain('next, ask for a check peer check');
  await expect(button(page, 'Ask the Peer check team')).toBeVisible();
  await button(page, 'Not now').click();
  await expect(header(page)).toHaveText(L);
  const path = await screenText(page);
  expect(path).not.toContain('Hear the feedback');
  expect(path).not.toContain('Fix it, or keep it and say why');
  await openTeamRow(page, 'Peer check');
  expect(await sheetText(page)).toContain('Feedback answered');
  await closeSheet(page);
  expect(await history(page)).toMatch(/Revised after (the )?Peer check/i);
});

test('PASS-020 Keep it, say why, and Undo', async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await spare(1);
  await recordOn(world(), 'TRANS', s, { parts: 2, publish: true });
  const v1 = (await passageAs(world(), 'REV', s)).latest!.takeId;
  await actAs(world(), 'REV', (c) => c.recordReview({ commandId: id(), takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Too fast here' }));
  const page = await recordAs(browser, world(), 'TRANS', s);
  await byId(page, 'primary-action').click();
  await button(page, 'Keep it, say why').click();
  const all = await screenText(page);
  expect(all).toContain(`Keep it as it is? Say why. ${nameOf('REV')} and the team will hear it.`);
  await expect(button(page, 'Tap and say why')).toBeVisible();
  await expect(byId(page, 'primary-action')).toHaveText('Keep it');
  await expect(byId(page, 'primary-action')).toBeDisabled();
  await field(page, 'Or type it').fill('The pace is right for our listeners');
  await byId(page, 'primary-action').click();
  await toast(page, 'Kept · your reason is on the record');
  await expect(header(page)).toHaveText(s.label);
  await expect(pathStep(page, 'Hear the feedback')).toHaveCount(0);
  await byId(page, 'toast-undo').click();
  await toast(page, 'Undone — the feedback is waiting again');
  await expect(pathStep(page, 'Hear the feedback')).toBeVisible();
});

// ---- the step sheet ----------------------------------------------------------------------------

test('PASS-023 Set a check aside, with a reason, and Undo @p0', async ({ browser }) => {
  test.setTimeout(500_000);
  for (const who of ['TRANS', 'REV', 'COORD'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-SUBMITTED');
    await openTeamRow(page, 'Back translation');
    // The Back translation's own Set aside is the last button of the sheet.
    await sheet(page).getByRole('button', { name: 'Set aside' }).last().click();
    await expect(text(page, 'Set aside Back translation?'), who).toBeVisible();
    const all = await sheetText(page);
    expect(all, who).toContain('The flow suggests this step. Setting it aside is fine — say why so the next person understands.');
    for (const r of ['No one available for this right now', 'Another review already covered this', 'Not needed for this passage']) expect(all, `${who}: ${r}`).toContain(r);
    const confirm = sheet(page).getByRole('button', { name: 'Set aside', exact: true }).last();
    await expect(confirm, who).toBeDisabled();
    await sheet(page).getByRole('button', { name: 'Not needed for this passage' }).click();
    await confirm.click();
    await toast(page, 'Back translation set aside · reason saved');
    await expect(teamRow(page, 'Back translation')).toHaveAttribute('aria-label', /^Back translation, /);
    await byId(page, 'toast-undo').click();
    await toast(page, 'Undone');
    await openTeamRow(page, 'Back translation');
    expect(await sheetText(page), who).not.toContain('Set aside: Not needed for this passage');
    await closeSheet(page);
  }
  const page = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  expect(await history(page)).toMatch(/Back translation set aside .*brought back/);
});

test('PASS-025 Bring back a set-aside step from History', async ({ browser }) => {
  test.setTimeout(600_000);
  const coord = nameOf('COORD');
  for (const who of ['REV', 'TREV', 'COORD', 'LADMIN', 'VIEW', 'TRANS'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-ASIDE');
    const all = await history(page);
    expect(all, who).toMatch(new RegExp(`Community check set aside ${coord === nameOf(who) ? 'You' : coord} · .+ — No community meeting this month`));
    const undo = page.getByRole('button', { name: 'Undo', exact: true }).locator('visible=true');
    expect(await undo.count(), who).toBe(who === 'VIEW' ? 0 : 1);
    if (who === 'TRANS') {
      await undo.first().click();
      await toast(page, "Brought back — it's a suggested step again");
      await expect(byId(page, 'toast-undo')).toHaveCount(0);
      await byId(page, 'header-close').click();
      await expect(teamRow(page, 'Community check')).not.toHaveAttribute('aria-label', 'Community check, set aside');
    }
  }
  // Resets: set it aside again.
  await actAs(world(), 'COORD', (c) => c.depart({ commandId: id(), unitId: unitOf(world(), 'P-ASIDE'), type: 'skip', kindId: 'community', reason: 'No community meeting this month' }));
});

// ---- Something else? ---------------------------------------------------------------------------

test('PASS-030 Not now, from Something else?', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await spare(2);
  await recordOn(world(), 'TRANS', s, { parts: 2, publish: true });
  const page = await recordAs(browser, world(), 'TREV', s);
  await somethingElse(page);
  await button(page, /^Not now/).click();
  await expect(text(page, 'Set aside Peer check?')).toBeVisible();
  await sheet(page).getByRole('button', { name: 'No one available for this right now' }).click();
  await sheet(page).getByRole('button', { name: 'Set aside', exact: true }).last().click();
  await toast(page, 'Peer check set aside · reason saved');
  await byId(page, 'toast-undo').click();
  await toast(page, 'Undone');
  // It stays on Something else? (the same on every platform).
  await expect(header(page)).toHaveText('Something else?');
});

test('PASS-031 Record a new version, or continue', async ({ browser }) => {
  test.setTimeout(400_000);
  const page = await recordAs(browser, world(), 'TRANS', 'P-DONE');
  await somethingElse(page);
  await button(page, /^Record a new version/).click();
  await expect(byId(page, 'record-button')).toBeVisible();
  await recordOnePart(page);
  await byId(page, 'header-close').click();
  await expect(header(page)).toHaveText('Something else?');
  await expect(button(page, /^Continue recording/)).toBeVisible();
  // Feedback that is TRANS's to answer: neither option.
  const s = await spare(3);
  await recordOn(world(), 'TRANS', s, { parts: 2, publish: true });
  const v1 = (await passageAs(world(), 'REV', s)).latest!.takeId;
  await actAs(world(), 'REV', (c) => c.recordReview({ commandId: id(), takeIds: [v1], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Slower' }));
  const f = await recordAs(browser, world(), 'TRANS', s);
  await somethingElse(f);
  const all = await screenText(f);
  expect(all).not.toContain('Record a new version');
  expect(all).not.toContain('Continue recording');
});

test('PASS-032 Add a note', async ({ browser }) => {
  test.setTimeout(400_000);
  const page = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  await somethingElse(page);
  await button(page, 'Add a note').click();
  const all = await sheetText(page);
  expect(all).toContain('On the whole passage. It follows the passage into reviews and later versions.');
  expect(all).toContain('Say it');
  const save = sheet(page).getByRole('button', { name: 'Add note' });
  await expect(save).toBeDisabled();
  await sheet(page).getByPlaceholder('Or type it').fill('Watch the names in verse 12');
  await save.click();
  await toast(page, 'Note added — it follows this passage');
  await expect(byId(page, 'toast-undo')).toHaveCount(0);
  const t = await recordAs(browser, world(), 'TREV', 'P-SUBMITTED');
  const h = await history(t);
  expect(h).toMatch(new RegExp(`Note · Whole passage ${nameOf('TRANS')} · .+ — Watch the names in verse 12`));
  await expect(t.getByRole('button', { name: /^Report/ }).locator('visible=true').first()).toBeVisible();
  const r = await recordAs(browser, world(), 'REV', 'P-SUBMITTED');
  await somethingElse(r);
  await expect(button(r, 'Add a note')).toBeVisible();
});

// ---- already happened ----------------------------------------------------------------------------

test('PASS-047 A check that happened outside the app: Looks good', async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await spare(4);
  await recordOn(world(), 'TRANS', s, { parts: 2, publish: true });
  await actAs(world(), 'TRANS', (c) => c.ask({ commandId: id(), unitId: s.unitId, what: 'review', kindId: 'peer', profileId: world().accounts.TREV.id }));
  const page = await recordAs(browser, world(), 'TRANS', s);
  await openTeamRow(page, 'Peer check');
  await sheet(page).getByRole('button', { name: 'Already happened' }).first().click();
  await expect(header(page)).toHaveText(s.label);
  expect(await screenText(page)).toContain('Peer check · already happened');
  await expect(byId(page, 'header-close')).toBeVisible();
  await byId(page, 'header-close').click();
  // Saving it is 07 REV's screen: TRANS logs it through the server.
  const v1 = (await passageAs(world(), 'TRANS', s)).latest!.takeId;
  await actAs(world(), 'TRANS', (c) => c.recordReview({ commandId: id(), takeIds: [v1], kindId: 'peer', outcome: 'looks_good', via: 'logged', givenBy: 'Peter Lual' }));
  await refreshRecord(page, world(), s);
  expect((await teamRows(page))[0]).toBe('Peer check, looks good');
  expect(await myWork(await pageFor(browser, world(), 'TREV'))).not.toContain(s.label);
});

test('PASS-048 A check that happened outside the app: Needs changes', async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await spare(5);
  await recordOn(world(), 'TRANS', s, { parts: 2, publish: true });
  const page = await recordAs(browser, world(), 'REV', s);
  await openTeamRow(page, 'Community check');
  await sheet(page).getByRole('button', { name: 'Already happened' }).click();
  expect(await screenText(page)).toContain('Community check · already happened');
  await byId(page, 'header-close').click();
  const v1 = (await passageAs(world(), 'REV', s)).latest!.takeId;
  await actAs(world(), 'REV', (c) => c.recordReview({ commandId: id(), takeIds: [v1], kindId: 'community', outcome: 'needs_changes', via: 'logged', people: 12, comment: 'Listeners asked who the host was' }));
  await refreshRecord(page, world(), s);
  expect((await teamRows(page))[2]).toBe('Community check, needs changes');
  const t = await recordAs(browser, world(), 'TRANS', s);
  expect(await mainButton(t)).toBe('Hear the feedback');
});

test('PASS-049 Add details: where, and other passages', async ({ browser }) => {
  test.setTimeout(400_000);
  const [a, b] = [await spare(6), await spare(7)];
  for (const p of [a, b]) await recordOn(world(), 'TRANS', p, { parts: 1, publish: true });
  const ta = (await passageAs(world(), 'TRANS', a)).latest!.takeId;
  const tb = (await passageAs(world(), 'TRANS', b)).latest!.takeId;
  await actAs(world(), 'TRANS', (c) => c.recordReview({ commandId: id(), takeIds: [ta, tb], kindId: 'peer', outcome: 'looks_good', via: 'logged', place: 'Bor church, after service' }));
  for (const p of [a, b]) {
    const page = await recordAs(browser, world(), 'TRANS', p);
    expect((await teamRows(page))[0], p.label).toBe('Peer check, looks good');
    expect(await history(page), p.label).toContain('Bor church, after service');
  }
});

test('PASS-050 A back translation that happened outside the app', async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await recordAs(browser, world(), 'REV', 'P-SUBMITTED');
  await openTeamRow(page, 'Back translation');
  await sheet(page).getByRole('button', { name: 'Already happened' }).last().click();
  expect(await screenText(page)).toContain('Back translation · already happened');
  await byId(page, 'header-close').click();
  const [card] = await recordings(world(), 'REV', 1);
  await actAs(world(), 'REV', (c) => c.produceContent({ commandId: id(), fromTakeId: take('P-SUBMITTED'), kindId: 'bt', cards: [card!], via: 'logged' }));
  await refreshRecord(page, world(), 'P-SUBMITTED');
  expect((await teamRows(page))[1]).toBe('Back translation, looks good');
});

// ---- checkpoints -------------------------------------------------------------------------------

test('PASS-053 A check logged afterwards never clears a checkpoint', async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await recordAs(browser, world(), 'TRANS', 'P-CHECK');
  await openTeamRow(page, 'Consultant check');
  await sheet(page).getByRole('button', { name: 'Already happened' }).click();
  expect(await screenText(page)).toContain('Consultant check · already happened');
  await byId(page, 'header-close').click();
  await actAs(world(), 'TRANS', (c) => c.recordReview({ commandId: id(), takeIds: [take('P-CHECK')], kindId: 'consultant', outcome: 'looks_good', via: 'logged',
    answers: { [world().consultantQuestionId]: 'Yes' } }));
  await refreshRecord(page, world(), 'P-CHECK');
  // Fixed (2026-10-12): the row no longer reads "looks good" for a logged check at a checkpoint.
  expect((await teamRows(page)).slice(3)).toEqual(['Consultant check, next', 'Final approval, after the consultant check']);
  expect(await mainButton(page)).toBe('Ask for the consultant check');
});

test('PASS-054 Move past a checkpoint, with a reason @p0', async ({ browser }) => {
  test.setTimeout(400_000);
  const page = await recordAs(browser, world(), 'COORD', 'P-CHECK');
  await somethingElse(page);
  expect(await screenText(page)).toContain('Move past a checkpoint Consultant check is a must-pass step. Say why, and it\'s on the record');
  await byId(page, 'header-close').click();
  await openTeamRow(page, 'Consultant check');
  await sheet(page).getByRole('button', { name: 'Move past this checkpoint…' }).click();
  await expect(text(page, 'Move past the checkpoint?')).toBeVisible();
  const all = await sheetText(page);
  expect(all).toContain("Checkpoints are the flow's hard stops. Your reason is recorded with your name, and anyone can see it on the record.");
  expect(all).toContain('Consultant visit is months away; church needs it now');
  expect(all).toContain('Checked informally — will record it later');
  const confirm = sheet(page).getByRole('button', { name: 'Move past checkpoint', exact: true });
  await expect(confirm).toBeDisabled();
  await sheet(page).getByRole('button', { name: 'Consultant visit is months away; church needs it now' }).click();
  await confirm.click();
  await toast(page, 'Moved past the checkpoint · reason saved');
  await expect(byId(page, 'toast-undo')).toBeVisible();
  // Fixed (2026-10-12): the rows say it was moved past, and the step after it is next.
  await expect.poll(async () => (await teamRows(page)).slice(3)).toEqual(['Consultant check, moved past', 'Final approval, next']);
  await openTeamRow(page, 'Consultant check');
  expect(await sheetText(page)).toContain('Checkpoint moved past, with a reason — later steps can go ahead. Undo it from History.');
  await closeSheet(page);
  await openTeamRow(page, 'Final approval');
  expect(await sheetButtons(page)).toContain('Review it now');
  await closeSheet(page);
  expect(await history(page)).toMatch(/Moved past a checkpoint You · .+ — Consultant visit is months away; church needs it now/);
  const t = await recordAs(browser, world(), 'TRANS', 'P-CHECK');
  expect(await mainButton(t)).toBe('Ask for the final approval');
});

test('PASS-056 Undo moving past a checkpoint', async ({ browser }) => {
  test.setTimeout(400_000);
  await checkpointMovedPast(true);
  const page = await recordAs(browser, world(), 'COORD', 'P-CHECK');
  await history(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).locator('visible=true').first().click();
  await toast(page, 'The checkpoint is back — later steps wait for it again');
  await expect.poll(() => screenText(page)).toMatch(/Moved past a checkpoint .*brought back/);
  await byId(page, 'header-close').click();
  await expect.poll(async () => (await teamRows(page))[4]).toBe('Final approval, after the consultant check');
  // Decided (2026-10-13): taking back an override needs Override checkpoints, as making one does.
  // TRANS sees no Undo on it, and the server refuses it from TRANS anyway.
  const stepId = (await passageAs(world(), 'COORD', 'P-CHECK')).steps[2]!.step.id;
  const [made] = await actAs(world(), 'COORD', (c) => c.depart({ commandId: id(), unitId: unitOf(world(), 'P-CHECK'), type: 'override', stepId, reason: 'Checked informally — will record it later' }));
  const departureId = (made!.payload as { departureId: string }).departureId;
  const t = await recordAs(browser, world(), 'TRANS', 'P-CHECK');
  await history(t);
  await expect(text(t, /Moved past a checkpoint/).first()).toBeVisible();
  expect(await t.getByRole('button', { name: 'Undo', exact: true }).locator('visible=true').count()).toBe(0);
  await expect(actAs(world(), 'TRANS', (c) => c.undoDeparture({ commandId: id(), departureId }), 'TRANS undoes an override'))
    .rejects.toThrow(/may not emit v1\.DepartureUndone/);
  // COORD brings it back, so the checkpoint holds for the tests after this one.
  await actAs(world(), 'COORD', (c) => c.undoDeparture({ commandId: id(), departureId }));
});

test('PASS-057 Not now at a checkpoint', async ({ browser }) => {
  test.setTimeout(300_000);
  await checkpointMovedPast(false);
  const page = await recordAs(browser, world(), 'TRANS', 'P-CHECK');
  await somethingElse(page);
  // Fixed (2026-10-12): no "Not now" at a checkpoint; only an override moves past one.
  expect(await screenText(page)).not.toContain('Not now');
});

// ---- versions and history ------------------------------------------------------------------------

test('PASS-059 Several drafts of one passage', async ({ browser }) => {
  test.setTimeout(600_000);
  // P-DONE has TRANS's draft from PASS-031; a second, from Versions → New version.
  const page = await recordAs(browser, world(), 'TRANS', 'P-DONE');
  await versionsPage(page);
  await byId(page, 'primary-action').click();
  await expect(byId(page, 'record-button')).toBeVisible();
  await recordOnePart(page);
  await byId(page, 'header-close').click();
  await refreshRecord(page, world(), 'P-DONE');
  await somethingElse(page);
  await button(page, /^Continue recording/).click();
  await expect(header(page)).toHaveText('Versions');
  const all = await screenText(page);
  expect(all).toMatch(/Your drafts Draft 1 .*Saved .*Draft 2 .*Saved/i);
  await page.getByRole('button', { name: 'Edit' }).locator('visible=true').nth(1).click();
  await expect(text(page, /^Draft 2/)).toBeVisible();
  await byId(page, 'header-close').click();
  // An unstarted passage with two drafts: the main button and the Record step both open the picker.
  const s = await spare(8);
  await recordOn(world(), 'TRANS', s, { parts: 1 });
  const p = await recordAs(browser, world(), 'TRANS', s);
  expect(await mainButton(p)).toBe('Continue recording');
  await versionsPage(p);
  await byId(p, 'primary-action').click();
  await recordOnePart(p);
  await byId(p, 'header-close').click();
  await refreshRecord(p, world(), s);
  await byId(p, 'primary-action').click();
  await expect(header(p)).toHaveText('Versions');
  await byId(p, 'header-close').click();
  // Fixed (2026-10-12): the Record step picks too, like the main button.
  await pathStep(p, 'Record').click();
  await expect(header(p)).toHaveText('Versions');
});

test('PASS-060 Delete a draft, and Undo', async ({ browser }) => {
  test.setTimeout(300_000);
  await twoDraftsOnDone();
  const page = await recordAs(browser, world(), 'TRANS', 'P-DONE');
  await versionsPage(page);
  await button(page, 'Delete Draft 1').click();
  await toast(page, 'Draft 1 deleted.');
  await expect(text(page, 'Your draft')).toBeVisible();
  await byId(page, 'toast-undo').click();
  await expect(text(page, 'Your drafts')).toBeVisible();
  await button(page, 'Delete Draft 1').click();
  await toast(page, 'Draft 1 deleted.');
  await expect(byId(page, 'toast')).toHaveCount(0, { timeout: 15_000 });
  await expect(text(page, 'Your draft')).toBeVisible();
});

test('PASS-061 Reviews by version', async ({ browser }) => {
  test.setTimeout(300_000);
  await needsAtV2();
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
  await versionsPage(page);
  expect(await screenText(page)).toMatch(/Reviews by version \d+ reviews? across 2 versions/);
  await expand(page, 'Reviews by version', 'Feedback answered');
  await expect(button(page, 'Open Version 2')).toBeVisible();
  await expect(button(page, 'Open Version 1')).toBeVisible();
  const legend = await screenText(page);
  for (const l of ['Looks good', 'Needs changes', 'Feedback answered', 'Asked', 'Set aside', 'Back translation recorded']) expect(legend, l).toContain(l);
  await button(page, `Peer check from ${nameOf('REV')}`).click();
  await expect(header(page)).toHaveText('Peer check');
  await back(page).click();
  await button(page, 'Open Version 1').click();
  await expect(header(page)).toHaveText('Version 1');
});

test('PASS-064 A version (Version 2, after a fix)', async ({ browser }) => {
  test.setTimeout(300_000);
  await needsAtV2();
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
  await pathStep(page, 'Record').click();
  await expect(header(page)).toHaveText('Version 2');
  const all = await screenText(page);
  expect(all).toMatch(/What changed Revised after (the )?Peer (Review|check)/i);
  await button(page, `In response to the Peer check from ${nameOf('REV')}`).or(text(page, `In response to the Peer check from ${nameOf('REV')}`)).first().click();
  await expect(header(page)).toHaveText('Peer check');
  void field;
});
