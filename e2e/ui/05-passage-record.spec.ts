// 05 The passage record (docs/ui-test-suite/05-passage-record.md), the
// tests that read the fixture world: every passage's main button, the path,
// the step sheets, Something else?, the checkpoint's hard stop, Versions and
// history, and the version and review pages. One role per test (docs/testing.md,
// "One test, one role"): what every other role sees is held by the screen
// models (apps/mobile/test/passageRecordMatrix.test.ts, decision 102), and
// each test here proves that model reaches the screen for the most telling
// role, tapping where the spec is about tapping. Nothing here changes the
// world until PASS-066 adds a note last.
// The tests that change passages are in 05-passage-actions.spec.ts and
// 05-passage-checks.spec.ts, each with a world of its own.
import type { Page } from '@playwright/test';
import { back, button, byId, expect, screenText, test, text, type AccountKey } from './support';
import { offerExampleGuides, useRunWorld } from './reviewing-helpers';
import {
  actAs, closeSheet, expand, header, id, mainButton, openTeamRow, pathStep, recordAs, sheet, sheetButtons, sheetText, shows, somethingElse,
  teamRow, teamRows, versionsPage, type Passage
} from './05-passage-helpers';

// One world for the run, kept when a failed test restarts the worker; it follows LangQuest's example
// study guides, which hold the worked study for Luke 15:11-32 (P-SUBMITTED), as 08 STUDY does.
const world = useRunWorld('05-record', offerExampleGuides);
const nameOf = (who: AccountKey) => world().accounts[who].name;
const label = (p: Passage) => (typeof p === 'string' ? world().passages[p].label : p.label);
const DUE = /due [A-Z][a-z]{2} \d{1,2}/;

async function expectNoCrash(page: Page): Promise<void> {
  await expect(text(page, 'This screen could not open')).toHaveCount(0);
  expect(await screenText(page)).not.toContain("You don't have permission to open that.");
}

// ---- the main button for each passage ------------------------------------------------------

test('PASS-001 TRANS P-NEW: not started, asked of TRANS @p0', async ({ browser }) => {
  const L = label('P-NEW');
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEW');
  await expect(header(page)).toHaveText(L);
  await expect(text(page, 'Alpha')).toBeVisible();
  await expect(byId(page, 'header-back')).toBeVisible();
  const rec = (await pathStep(page, 'Record').getAttribute('aria-label')) ?? '';
  expect(rec).toContain(`${nameOf('COORD')} asked you · `);
  expect(rec).toMatch(DUE);
  expect(rec).toContain('Tell it in your language.');
  expect(await screenText(page)).toContain('Publish Then ask for the peer check');
  expect(await teamRows(page)).toEqual([
    'Peer check, after you publish', 'Back translation, same time', 'Community check, after the peer check',
    'Consultant check, after the community check', 'Final approval, after the consultant check'
  ]);
  expect(await mainButton(page)).toBe('Record');
  await byId(page, 'primary-action').click();
  await expect(byId(page, 'record-button'), 'the workspace').toBeVisible();
  await byId(page, 'header-close').click();
  await expect(header(page), '✕ returns to the record').toHaveText(L);
  expect(await mainButton(page), 'unchanged').toBe('Record');
  await expectNoCrash(page);
});

test('PASS-002 TRANS P-DRAFT: TRANS\'s unpublished takes @p0', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-DRAFT');
  expect(await screenText(page)).toContain('Record Your parts are recorded, not published yet.');
  expect(await mainButton(page)).toBe('Continue recording');
});

test('PASS-003 TRANS P-SUBMITTED: Version 1, Peer check asked of REV @p0', async ({ browser }) => {
  const L = label('P-SUBMITTED');
  const rev = nameOf('REV');
  const page = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  // The worked study comes first, passed ("–"): recording has started.
  await expect(pathStep(page, 'Study')).toHaveAttribute('aria-label', /^1\. Study\. .+ guide · 0 of \d+ steps$/, { timeout: 30_000 });
  expect(await screenText(page)).toMatch(/Record Version 1 · \d+:\d\d Publish Published .+ · asked Rita Reviewer/);
  expect(await teamRows(page)).toEqual([
    `Peer check, asked ${rev}`, 'Back translation, same time', 'Community check, after the peer check',
    'Consultant check, after the community check', 'Final approval, after the consultant check'
  ]);
  // TRANS's button goes to the ask page.
  expect(await mainButton(page)).toBe('Ask for the back translation');
  await byId(page, 'primary-action').click();
  await expect(header(page)).toHaveText('Ask for a check');
  await byId(page, 'header-close').click();
  await expect(header(page)).toHaveText(L);
});

test('PASS-003 REV P-SUBMITTED: Do the peer check opens the review @p0', async ({ browser }) => {
  const L = label('P-SUBMITTED');
  const page = await recordAs(browser, world(), 'REV', 'P-SUBMITTED');
  // REV's button goes to the review carrying the request.
  expect(await mainButton(page)).toBe('Do the peer check');
  await byId(page, 'primary-action').click();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(header(page)).toHaveText(L);
  await expect(text(page, 'Peer check')).toBeVisible();
  await byId(page, 'header-close').click();
  await expect(header(page)).toHaveText(L);
});

test('PASS-004 TRANS P-NEEDS: feedback waiting for TRANS @p0', async ({ browser }) => {
  const rev = nameOf('REV');
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
  const hear = (await pathStep(page, 'Hear the feedback').getAttribute('aria-label')) ?? '';
  expect(hear).toMatch(/^3\. Hear the feedback\. Peer check · needs changes$/);
  // The note's length shows only when the app knows it (a voice note's length is not in the log).
  expect(await screenText(page)).toMatch(new RegExp(`${rev}( · 0:0\\d)? “Verse 18 is too fast”`));
  expect(await pathStep(page, 'Fix it, or keep it and say why').getAttribute('aria-label')).toBe('4. Fix it, or keep it and say why. Then it goes back to the check');
  expect((await teamRows(page))[0]).toBe('Peer check, needs changes');
  expect(await mainButton(page)).toBe('Hear the feedback');
  await byId(page, 'primary-action').click();
  await expect(button(page, 'Record a fix')).toBeVisible();
});

test('PASS-005 REV P-BT: Back translation asked of REV @p0', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'REV', 'P-BT');
  expect((await teamRows(page))[0]).toBe('Peer check, looks good');
  expect(await mainButton(page)).toBe('Back-translate it');
  await byId(page, 'primary-action').click();
  await expect(text(page, 'Back translation', false)).toBeVisible();
  await expect(byId(page, 'header-close').or(byId(page, 'header-back')).first()).toBeVisible();
});

test('PASS-006 TRANS P-CHECK: at the Consultant check checkpoint @p0', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-CHECK');
  expect(await teamRows(page)).toEqual([
    'Peer check, looks good', 'Back translation, looks good', 'Community check, looks good', 'Consultant check, next',
    'Final approval, after the consultant check'
  ]);
  expect(await mainButton(page)).toBe('Ask for the consultant check');
});

test('PASS-007 TRANS P-ASIDE: Community check set aside @p0', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-ASIDE');
  expect((await teamRows(page))[2]).toBe('Community check, set aside');
  await openTeamRow(page, 'Community check');
  expect(await sheetText(page)).toBe('Community check This step is done. Community check Set aside: No community meeting this month');
  expect(await sheetButtons(page)).toEqual([]);
  await closeSheet(page);
  expect(await mainButton(page)).toBe('Ask for the peer check');
});

test('PASS-008 TRANS P-DONE: every check complete @p0', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-DONE');
  expect(await teamRows(page)).toEqual([
    'Peer check, looks good', 'Back translation, looks good', 'Community check, looks good', 'Consultant check, looks good', 'Final approval, looks good'
  ]);
  expect(await mainButton(page)).toBeNull();
  await somethingElse(page);
  const all = await screenText(page);
  for (const gone of ['Someone else should do this', 'We already did this', 'Not now']) expect(all, gone).not.toContain(gone);
  expect(all).toContain('Record a new version');
});

test('PASS-009 VIEW The viewer\'s record is read-only', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'VIEW', 'P-SUBMITTED');
  expect(await mainButton(page)).toBeNull();
  for (const row of ['Peer check', 'Community check', 'Final approval']) await expect(teamRow(page, row), row).toBeDisabled();
  await pathStep(page, 'Record').click();
  await expect(header(page)).toHaveText('Version 1');
  await back(page).click();
  await pathStep(page, 'Publish').click();
  await expect(header(page)).toHaveText('Version 1');
  await back(page).click();
  await somethingElse(page);
  await expect(button(page, 'What helps here')).toBeVisible();
  expect(await shows(page, 'Add a note')).toBe(false);
  expect(await shows(page, 'Say it instead')).toBe(false);
  await byId(page, 'header-close').click();
  await versionsPage(page);
  const all = await screenText(page);
  for (const gone of ['New version', 'Edit', 'Your draft']) expect(all, gone).not.toContain(gone);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  const history = await screenText(page);
  expect(history).not.toMatch(/\bUndo\b/);
  expect(history).not.toContain('Withdraw');
});

// ---- the path -------------------------------------------------------------------------------

test('PASS-010 TRANS Steps, "Then the team", and what each tap opens', async ({ browser }) => {
  const L = label('P-SUBMITTED');
  const page = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  await pathStep(page, 'Study').click();
  // The study opens (08 STUDY): the record's path is gone.
  await expect(text(page, 'Then the team')).toHaveCount(0);
  await back(page).click();
  await expect(header(page)).toHaveText(L);
  for (const step of ['Record', 'Publish']) {
    await pathStep(page, step).click();
    await expect(header(page), step).toHaveText('Version 1');
    await back(page).click();
    await expect(header(page)).toHaveText(L);
  }
  await openTeamRow(page, 'Peer check');
  // The step's own name; an ordinary step is just its checks, with no sub (decision 91).
  expect(await sheetText(page)).toMatch(/^Peer check and back translation Peer check /);
  await closeSheet(page);
  // P-NEW: Record opens the workspace; Publish, with nothing recorded, does nothing.
  const n = await recordAs(browser, world(), 'TRANS', 'P-NEW');
  await expect(pathStep(n, 'Publish')).toHaveCount(0);
  await pathStep(n, 'Record').click();
  await expect(byId(n, 'record-button')).toBeVisible();
  await byId(n, 'header-close').click();
  // P-NEEDS: Hear the feedback and Fix it both open the feedback page.
  for (const step of ['Hear the feedback', 'Fix it, or keep it and say why']) {
    const f = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
    await pathStep(f, step).click();
    await expect(button(f, 'Record a fix'), step).toBeVisible();
  }
});

// ---- the step sheet ----------------------------------------------------------------------------

test('PASS-021 REV What a step offers', async ({ browser }) => {
  const bt = 'Back translation A bilingual speaker records it in English — new content, not a verdict · the Consultant check reviews it';
  const page = await recordAs(browser, world(), 'REV', 'P-SUBMITTED');
  await openTeamRow(page, 'Peer check');
  expect(await sheetText(page)).toBe(
    `Peer check and back translation Peer check ${nameOf('TRANS')} asked you Review it now Already happened Set aside ${bt} Back-translate it Already happened Set aside`
  );
  expect(await sheetButtons(page)).not.toContain('Move past this checkpoint…');
  await closeSheet(page);
});

// ---- Something else? ---------------------------------------------------------------------------

test('PASS-026 TRANS Something else? on a passage nobody has recorded', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEW');
  await somethingElse(page);
  const all = await screenText(page);
  expect(all).toContain(`Something else? ${label('P-NEW')} · Record`);
  await expect(byId(page, 'header-close')).toBeVisible();
  expect(all).toContain('Someone else should do this Ask a person on the team, or someone outside by WhatsApp or text');
  for (const gone of ['We already did this', 'Not now', 'Record a new version']) expect(all, gone).not.toContain(gone);
  expect(all).toContain('Add a note');
  expect(all).toContain('What helps here');
  expect(all, 'the offline card').toMatch(/On this device|Not kept on this device|Downloading for offline/);
  expect(all).toContain('Each check under "Then the team" has its own options too: tap it on the path.');
  expect(all).toContain('Say it instead A voice note on this passage. Your team hears it here.');
});

test('PASS-027 TRANS Something else? on a recorded passage', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-BT');
  await somethingElse(page);
  const all = await screenText(page);
  expect(all).toContain(`Something else? ${label('P-BT')} `);
  expect(all).not.toContain(`${label('P-BT')} · `);
  // Fixed (2026-10-12): the Back translation is already asked of REV, so nobody is offered a second request.
  expect(all).not.toContain('Someone else should do this');
  expect(all).toContain('We already did this Say when and how the back translation happened');
  expect(all).toContain('Not now Set the back translation aside. Say why');
  expect(all).toContain('Record a new version Reviews so far stay with the version they heard');
  expect(all).not.toContain('Move past a checkpoint');
});

test('PASS-028 COORD Someone else should record it', async ({ browser }) => {
  const L = label('P-S');
  const page = await recordAs(browser, world(), 'COORD', 'P-S');
  await somethingElse(page);
  await button(page, /^Someone else should do this/).click();
  await expect(header(page)).toHaveText('Ask someone to record');
  const all = await screenText(page);
  expect(all).toContain(`Ask someone to record ${L} · Alpha`);
  expect(all).toContain("Record it They'll find it on their My Work, with the source and the study ready.");
  for (const gone of ['Someone on the team', 'Someone without the app', 'They’ll answer']) expect(all.toLowerCase(), gone).not.toContain(gone.toLowerCase());
  const people = await page.getByRole('radio').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e as HTMLElement).innerText.split('\n').map((l) => l.trim()).find((l) => l && !/^[A-Z][a-z]$/.test(l))!));
  const can = (['ADMIN', 'LADMIN', 'TRANS', 'TREV', 'KEPT'] as AccountKey[]).map(nameOf).sort();
  expect([...people].sort()).toEqual(can);
  await expect(byId(page, 'primary-action')).toHaveText('Choose someone');
  await expect(byId(page, 'primary-action')).toBeDisabled();
});

test('PASS-029 TRANS We already did this', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-BT');
  await somethingElse(page);
  await button(page, /^We already did this/).click();
  await expect(header(page)).toHaveText(label('P-BT'));
  expect(await screenText(page)).toContain('Back translation · already happened');
  await byId(page, 'header-close').click();
  await expect(header(page), '✕ returns').toHaveText('Something else?');
});

test('PASS-034 COORD What helps here (the passage\'s reference)', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'COORD', 'P-SUBMITTED');
  await somethingElse(page);
  await button(page, 'What helps here').click();
  await expect(header(page)).toHaveText('What helps here');
  const all = await screenText(page);
  // Decision 93 / demo ADR-042: the passage is a tap away at the top ("{passage} · {Bible}"), and each help
  // says what it says here above Show here / Hide here (those two are for whoever manages reference).
  expect(all).toContain(`What helps here Alpha ${label('P-SUBMITTED')} · `);
  // "Add a help" for whoever holds Manage reference. This world offers Luke 15 no recommended material, so the
  // organization's own study guide is the one card, and managers can hide it here.
  expect(all, all).toContain('Add a help');
  expect(await byId(page, 'tab-map').isVisible(), 'no tab bar').toBe(false);
  if (!all.includes('Nothing helps on this passage yet.')) {
    expect(all, all).toContain('Hide here');
    await text(page, 'Hide here').click();
    await expect(byId(page, 'toast')).toContainText('is hidden on this passage.');
    await byId(page, 'toast-undo').click();
    await expect(text(page, 'Hide here')).toBeVisible();
  }
  await back(page).click();
  await expect(header(page), 'Back').toHaveText('Something else?');
});

// ---- checkpoints -------------------------------------------------------------------------------

test('PASS-052 TRANS A checkpoint is a hard stop @p0', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-CHECK');
  expect((await teamRows(page))[4]).toBe('Final approval, after the consultant check');
  await openTeamRow(page, 'Final approval');
  expect(await sheetText(page)).toBe('Final approval Waits for the Consultant check checkpoint. Final approval Starts after the Consultant check checkpoint');
  await expect(sheet(page).getByLabel('Waits for checkpoint')).toBeVisible();
  expect(await sheetButtons(page)).toEqual([]);
  await closeSheet(page);
  await openTeamRow(page, 'Consultant check');
  expect(await sheetText(page)).toMatch(/^Consultant check Checkpoint — later steps wait for this one\. /);
  const buttons = await sheetButtons(page);
  expect(buttons).not.toContain('Set aside');
  expect(buttons).not.toContain('Move past this checkpoint…');
  await closeSheet(page);
  await somethingElse(page);
  expect(await screenText(page)).not.toContain('Move past a checkpoint');
});

test('PASS-055 LADMIN A language lead may not move past a checkpoint @p0', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'LADMIN', 'P-CHECK');
  expect(await mainButton(page)).toBe('Do the consultant check');
  await openTeamRow(page, 'Consultant check');
  expect(await sheetButtons(page)).toEqual(['Review it now', 'Already happened', 'Ask someone']);
  await closeSheet(page);
  expect((await teamRows(page))[4]).toBe('Final approval, after the consultant check');
  await somethingElse(page);
  expect(await screenText(page)).not.toContain('Move past a checkpoint');
});

// ---- versions and history ------------------------------------------------------------------------

test('PASS-058 TRANS The Versions page', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
  await versionsPage(page);
  await expect(byId(page, 'header-close')).toBeVisible();
  const all = await screenText(page);
  expect(all).toContain(`Versions ${label('P-NEEDS')}`);
  expect(all).toContain('No drafts. Edit a version below, or start a new one.');
  expect(all).toContain('New version');
  expect(all).toContain('Edit');
  expect(all).toMatch(/Published Version 1 Latest .+ · .+ 3 parts · \d+:\d\d/i);
  // TRANS may ask for the next check not waiting on the feedback (the Back translation, "best after" it).
  expect(all).toContain('Ask for the back translation');
  expect(all).not.toContain('Ask for the peer check');
  await button(page, 'Open Version 1').click();
  await expect(header(page)).toHaveText('Version 1');
});

test('PASS-062 TRANS History', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-ASIDE');
  await versionsPage(page);
  const summary = await screenText(page);
  expect(summary).toMatch(/History \d+ entries (since .+|· just now)/);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  const all = await screenText(page);
  expect(all).toContain('Version 1 published');
  expect(all).toContain('Community check set aside');
  expect(all).toContain('No community meeting this month');
  await button(page, /^Version 1 published/).click();
  await expect(header(page)).toHaveText('Version 1');
});

test('PASS-063 TRANS The study, from Versions', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  await versionsPage(page);
  const study = page.getByRole('button', { name: /^.+ study\. Not started$/ }).locator('visible=true').first();
  await expect(study).toBeVisible({ timeout: 30_000 });
  await study.click();
  await expect(button(page, 'Open the study')).toBeVisible();
  const firstStep = page.getByRole('button').filter({ hasText: /Hear and Heart/ }).locator('visible=true').first();
  await firstStep.click();
  await expect(header(page)).not.toHaveText('Versions');
  await back(page).click();
  await expect(header(page)).toHaveText('Versions');
  await button(page, 'Open the study').click();
  await expect(header(page)).not.toHaveText('Versions');
  // A passage with no study guide has no study on its Versions page.
  const other = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
  await versionsPage(other);
  await expect(other.getByRole('button', { name: / study\. / })).toHaveCount(0);
});

// ---- the version and review pages ---------------------------------------------------------------

/** P-NEEDS's Version 1, from the record's Record step, as `who` sees it. */
async function versionOne(page: Page, who: AccountKey): Promise<string> {
  await pathStep(page, 'Record').click();
  await expect(header(page), who).toHaveText('Version 1');
  const all = await screenText(page);
  expect(all, who).toMatch(new RegExp(`Version 1 .*${who === 'TRANS' ? 'You' : nameOf('TRANS')} · `));
  expect(all, who).toMatch(/Note First recording\./i);
  expect(all, who).toMatch(/Recording Version 1 3 parts · \d+:\d\d/i);
  expect(all, who).toContain('Part 3');
  expect(all, who).toContain('Reviews of this version');
  expect(await byId(page, 'tab-map').isVisible(), `${who}: no tab bar`).toBe(false);
  return all;
}

const flags = async (page: Page) => page.getByRole('button', { name: /^Report/ }).locator('visible=true').count();

test('PASS-064 TRANS A version: their own, without a report flag', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TRANS', 'P-NEEDS');
  await versionOne(page, 'TRANS');
  expect(await flags(page), 'no report flag on your own version').toBe(0);
  // Crumbs show on wide windows only; on a phone Back returns to the record.
  await back(page).click();
  await expect(header(page), 'back to the record').toHaveText(label('P-NEEDS'));
});

test('PASS-064 TREV A version: someone else\'s, with a report flag', async ({ browser }) => {
  const page = await recordAs(browser, world(), 'TREV', 'P-NEEDS');
  await versionOne(page, 'TREV');
  expect(await flags(page), 'the report flag').toBe(1);
  await back(page).click();
  await expect(header(page), 'back to the record').toHaveText(label('P-NEEDS'));
});

/** P-NEEDS's Peer check and P-CHECK's Back translation, from Reviews by version, as someone who does not answer them. */
async function reviewsNotTheirs(browser: Parameters<typeof recordAs>[0], who: AccountKey): Promise<void> {
  const page = await recordAs(browser, world(), who, 'P-NEEDS');
  await versionsPage(page);
  await expand(page, 'Reviews by version', 'Feedback answered');
  await button(page, `Peer check from ${nameOf('REV')}`).click();
  await expect(header(page)).toHaveText('Peer check');
  const all = await screenText(page);
  expect(all).toContain(`Needs changes ${nameOf('REV')} · in the app`);
  expect(all).toContain('Reviewed Version 1');
  expect(all).toMatch(/Feedback/i);
  expect(all).toContain('Verse 18 is too fast');
  expect(all).not.toContain('Record a fix');
  expect(all).not.toContain('Keep it');
  // A back translation: new content, not a verdict (P-CHECK's, made by REV).
  const c = await recordAs(browser, world(), who, 'P-CHECK');
  await versionsPage(c);
  await expand(c, 'Reviews by version', 'Feedback answered');
  await button(c, `Back translation from ${nameOf('REV')}`).click();
  const bt = await screenText(c);
  expect(bt).toContain('New content made from the version, not a verdict on it. The Consultant check compares it with the source.');
  expect(bt).toContain('Made from Version 1');
}

test('PASS-065 COORD A review that is not yours to answer', async ({ browser }) => {
  await reviewsNotTheirs(browser, 'COORD');
});

test('PASS-065 VIEW A review that is not yours to answer', async ({ browser }) => {
  await reviewsNotTheirs(browser, 'VIEW');
});

/** Report flags on P-NEEDS's Version 1 and on REV's Peer check of it, as `who` sees them. */
async function flagsOnVersionAndReview(browser: Parameters<typeof recordAs>[0], who: AccountKey): Promise<[number, number]> {
  const page = await recordAs(browser, world(), who, 'P-NEEDS');
  await pathStep(page, 'Record').click().catch(async () => { await versionsPage(page); await button(page, 'Open Version 1').click(); });
  await expect(header(page)).toHaveText('Version 1');
  const onVersion = await flags(page);
  await back(page).click();
  await versionsPage(page);
  await expand(page, 'Reviews by version', 'Feedback answered');
  await button(page, `Peer check from ${who === 'REV' ? 'You' : nameOf('REV')}`).click();
  return [onVersion, await flags(page)];
}

test('PASS-066 REV Report flags on other people\'s work only', async ({ browser }) => {
  expect(await flagsOnVersionAndReview(browser, 'REV')).toEqual([1, 0]);
});

test('PASS-066 VIEW Report flags on other people\'s work only', async ({ browser }) => {
  expect(await flagsOnVersionAndReview(browser, 'VIEW')).toEqual([1, 1]);
});

// Last in the file: it adds two notes to P-SUBMITTED.
test('PASS-066 TRANS Report flags on other people\'s work only', async ({ browser }) => {
  expect(await flagsOnVersionAndReview(browser, 'TRANS')).toEqual([0, 1]);
  // A note by someone else carries a flag in History; your own does not.
  await actAs(world(), 'REV', (c) => c.addNote({ commandId: id(), unitId: world().passages['P-SUBMITTED'].unitId, anchor: { kind: 'passage' }, text: 'Watch the names' }), 'REV notes P-SUBMITTED');
  await actAs(world(), 'TRANS', (c) => c.addNote({ commandId: id(), unitId: world().passages['P-SUBMITTED'].unitId, anchor: { kind: 'passage' }, text: 'My own note' }), 'TRANS notes P-SUBMITTED');
  const page = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  await versionsPage(page);
  await expand(page, 'History', /^Version \d+ published$|^Asked /);
  expect(await flags(page)).toBe(1);
  await page.getByRole('button', { name: /^Report/ }).locator('visible=true').first().click();
  const sheetAll = await screenText(page);
  expect(sheetAll).toContain('Report or block');
  expect(sheetAll).toContain(`Block ${nameOf('REV')}`);
});
