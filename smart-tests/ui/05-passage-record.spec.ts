// 05 The passage record (docs/ui-test-suite/05-passage-record.md), the
// tests that read the fixture world as each role: every passage's main
// button, the path, the step sheets, Something else?, who may ask, the
// checkpoint's hard stop, Versions and history, and the version and review
// pages. Nothing here changes the world until PASS-066 adds a note last.
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

/** The main button each role sees on a passage, read one role at a time. */
async function mains(browser: Parameters<typeof recordAs>[0], p: Passage, roles: AccountKey[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const who of roles) out[who] = await mainButton(await recordAs(browser, world(), who, p));
  return out;
}

async function expectNoCrash(page: Page): Promise<void> {
  await expect(text(page, 'This screen could not open')).toHaveCount(0);
  expect(await screenText(page)).not.toContain("You don't have permission to open that.");
}

// ---- the main button for each passage, per role -------------------------------------------

test('PASS-001 P-NEW: not started, asked of TRANS @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  const L = label('P-NEW');
  const coord = nameOf('COORD');
  for (const who of ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-NEW');
    await expect(header(page), who).toHaveText(L);
    await expect(text(page, 'Alpha'), who).toBeVisible();
    await expect(byId(page, 'header-back'), who).toBeVisible();
    const rec = (await pathStep(page, 'Record').getAttribute('aria-label').catch(() => null)) ?? await screenText(page);
    const asked = who === 'TRANS' ? `${coord} asked you` : who === 'COORD' ? `You asked ${nameOf('TRANS')}` : `${coord} asked ${nameOf('TRANS')}`;
    expect(rec, who).toContain(`${asked} · `);
    expect(rec, who).toMatch(DUE);
    expect(rec, who).toContain('Tell it in your language. The Bible, key words and notes are beside you while you record.');
    expect(await screenText(page), who).toContain('Publish Then ask for the peer check');
    expect(await teamRows(page), who).toEqual([
      'Peer check, after you publish', 'Back translation, same time', 'Community check, after the peer check',
      'Consultant check, after the community check', 'Final approval, after the consultant check'
    ]);
    const main = await mainButton(page);
    expect(main, who).toBe(['REV', 'VIEW'].includes(who) ? null : 'Record');
    if (main) {
      await byId(page, 'primary-action').click();
      await expect(byId(page, 'record-button'), `${who}: the workspace`).toBeVisible();
      await byId(page, 'header-close').click();
      await expect(header(page), `${who}: ✕ returns to the record`).toHaveText(L);
      expect(await mainButton(page), `${who}: unchanged`).toBe('Record');
    }
    await expectNoCrash(page);
  }
});

test('PASS-002 P-DRAFT: TRANS\'s unpublished takes @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  const got: Record<string, [string | null, boolean]> = {};
  for (const who of ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-DRAFT');
    const all = await screenText(page);
    const sub = who === 'TRANS' ? 'Your takes are recorded, not published yet.' : 'Some takes are recorded, not published yet.';
    got[who] = [await mainButton(page), all.includes(`Record ${sub}`)];
  }
  expect(got).toEqual({
    TRANS: ['Continue recording', true], TREV: ['Record', true], COORD: ['Record', true], LADMIN: ['Record', true],
    REV: [null, true], VIEW: [null, true]
  });
});

test('PASS-003 P-SUBMITTED: Version 1, Peer check asked of REV @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  const L = label('P-SUBMITTED');
  const rev = nameOf('REV');
  const page = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  // The worked study comes first, passed ("–"): recording has started.
  await expect(pathStep(page, 'Study')).toHaveAttribute('aria-label', /^1\. Study\. .+ guide · 0 of \d+ steps$/, { timeout: 30_000 });
  const all = await screenText(page);
  expect(all).toMatch(/Record Version 1 · \d+:\d\d Publish Published .+ · asked Rita Reviewer/);
  expect(await teamRows(page)).toEqual([
    `Peer check, asked ${rev}`, 'Back translation, same time', 'Community check, after the peer check',
    'Consultant check, after the community check', 'Final approval, after the consultant check'
  ]);
  expect(await mains(browser, 'P-SUBMITTED', ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT', 'VIEW'])).toEqual({
    TRANS: 'Ask for the back translation', REV: 'Do the peer check', TREV: 'Do the peer check', COORD: 'Do the peer check',
    LADMIN: 'Do the peer check', KEPT: 'Do the peer check', VIEW: null
  });
  // Where the buttons go: TRANS to the ask page, REV to the review carrying the request.
  const t = await recordAs(browser, world(), 'TRANS', 'P-SUBMITTED');
  await byId(t, 'primary-action').click();
  await expect(header(t)).toHaveText('Ask for a check');
  await byId(t, 'header-close').click();
  await expect(header(t)).toHaveText(L);
  const r = await recordAs(browser, world(), 'REV', 'P-SUBMITTED');
  await byId(r, 'primary-action').click();
  await expect(byId(r, 'header-close')).toBeVisible();
  await expect(header(r)).toHaveText(L);
  await expect(text(r, 'Peer check')).toBeVisible();
  await byId(r, 'header-close').click();
  await expect(header(r)).toHaveText(L);
});

test('PASS-004 P-NEEDS: feedback waiting for TRANS @p0', async ({ browser }) => {
  test.setTimeout(600_000);
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
  for (const who of ['REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as AccountKey[]) {
    const p = await recordAs(browser, world(), who, 'P-NEEDS');
    const all = await screenText(p);
    expect(all, who).not.toContain('Hear the feedback');
    expect(all, who).not.toContain('Fix it, or keep it and say why');
    expect(all, who).toContain(`Waiting on ${nameOf('TRANS')} to answer the Peer check feedback.`);
    expect((await teamRows(p))[0], who).toBe('Peer check, needs changes');
    // Fixed (2026-10-12): no check is offered while the feedback waits on the translator.
    expect(await mainButton(p), who).toBeNull();
  }
});

test('PASS-005 P-BT: Back translation asked of REV @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await recordAs(browser, world(), 'TRANS', 'P-BT');
  expect((await teamRows(page)).slice(0, 2)).toEqual(['Peer check, looks good', `Back translation, asked ${nameOf('REV')}`]);
  expect(await mains(browser, 'P-BT', ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT', 'VIEW'])).toEqual({
    TRANS: null, REV: 'Back-translate it', TREV: 'Back-translate it', COORD: 'Back-translate it', LADMIN: 'Back-translate it',
    KEPT: 'Back-translate it', VIEW: null
  });
  const r = await recordAs(browser, world(), 'REV', 'P-BT');
  await byId(r, 'primary-action').click();
  await expect(text(r, 'Back translation', false)).toBeVisible();
  await expect(byId(r, 'header-close').or(byId(r, 'header-back')).first()).toBeVisible();
});

test('PASS-006 P-CHECK: at the Consultant check checkpoint @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await recordAs(browser, world(), 'TRANS', 'P-CHECK');
  expect(await teamRows(page)).toEqual([
    'Peer check, looks good', 'Back translation, looks good', 'Community check, looks good', 'Consultant check, next',
    'Final approval, after the consultant check'
  ]);
  expect(await mains(browser, 'P-CHECK', ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT', 'VIEW'])).toEqual({
    TRANS: 'Ask for the consultant check', REV: 'Do the consultant check', TREV: 'Do the consultant check', COORD: 'Do the consultant check',
    LADMIN: 'Do the consultant check', KEPT: 'Do the consultant check', VIEW: null
  });
});

test('PASS-007 P-ASIDE: Community check set aside @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['TRANS', 'REV', 'COORD', 'LADMIN', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-ASIDE');
    expect((await teamRows(page))[2], who).toBe('Community check, set aside');
    if (who === 'VIEW') {
      await expect(teamRow(page, 'Community check'), 'VIEW cannot open the sheet').toBeDisabled();
    } else {
      await openTeamRow(page, 'Community check');
      expect(await sheetText(page), who).toBe('Community check This step is done. Community check Set aside: No community meeting this month');
      expect(await sheetButtons(page), who).toEqual([]);
      await closeSheet(page);
    }
    expect(await mainButton(page), who).toBe({ TRANS: 'Ask for the peer check', VIEW: null }[who as 'TRANS'] ?? (who === 'VIEW' ? null : 'Do the peer check'));
  }
});

test('PASS-008 P-DONE: every check complete @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['TRANS', 'REV', 'COORD', 'LADMIN', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-DONE');
    expect(await teamRows(page), who).toEqual([
      'Peer check, looks good', 'Back translation, looks good', 'Community check, looks good', 'Consultant check, looks good', 'Final approval, looks good'
    ]);
    expect(await mainButton(page), who).toBeNull();
    await somethingElse(page);
    const all = await screenText(page);
    for (const gone of ['Someone else should do this', 'We already did this', 'Not now']) expect(all, `${who}: ${gone}`).not.toContain(gone);
    expect(all.includes('Record a new version'), who).toBe(['TRANS', 'COORD', 'LADMIN'].includes(who));
  }
});

test('PASS-009 The viewer\'s record is read-only', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const p of ['P-SUBMITTED', 'P-NEEDS', 'P-ASIDE'] as const) {
    const page = await recordAs(browser, world(), 'VIEW', p);
    expect(await mainButton(page), p).toBeNull();
    for (const row of ['Peer check', 'Community check', 'Final approval']) await expect(teamRow(page, row), `${p}: ${row}`).toBeDisabled();
  }
  const page = await recordAs(browser, world(), 'VIEW', 'P-SUBMITTED');
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

test('PASS-010 Steps, "Then the team", and what each tap opens', async ({ browser }) => {
  test.setTimeout(600_000);
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

test('PASS-021 What a step offers, per role', async ({ browser }) => {
  test.setTimeout(600_000);
  const rev = nameOf('REV');
  const trans = nameOf('TRANS');
  const bt = 'Back translation A bilingual speaker records it in English — new content, not a verdict · the Consultant check reviews it';
  const want: Record<string, string> = {
    TRANS: `Peer check and back translation Peer check Waiting on ${rev} Already happened Set aside ${bt} Send to the Back translation team Send to someone else Already happened Set aside`,
    KEPT: `Peer check and back translation Peer check Waiting on ${rev} Review it now Already happened Set aside ${bt} Back-translate it Already happened Ask someone Set aside`,
    REV: `Peer check and back translation Peer check ${trans} asked you Review it now Already happened Set aside ${bt} Back-translate it Already happened Set aside`,
    TREV: `Peer check and back translation Peer check Waiting on ${rev} Review it now Already happened Set aside ${bt} Back-translate it Already happened Ask someone Set aside`
  };
  want['COORD'] = want['TREV']!;
  want['LADMIN'] = want['TREV']!;
  const got: Record<string, string> = {};
  for (const who of ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-SUBMITTED');
    await openTeamRow(page, 'Peer check');
    got[who] = await sheetText(page);
    expect(await sheetButtons(page), who).not.toContain('Move past this checkpoint…');
    await closeSheet(page);
  }
  expect(got).toEqual(want);
  const view = await recordAs(browser, world(), 'VIEW', 'P-SUBMITTED');
  await expect(teamRow(view, 'Peer check')).toBeDisabled();
});

// ---- Something else? ---------------------------------------------------------------------------

test('PASS-026 Something else? on a passage nobody has recorded', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-NEW');
    await somethingElse(page);
    const all = await screenText(page);
    expect(all, who).toContain(`Something else? ${label('P-NEW')} · Record`);
    await expect(byId(page, 'header-close'), who).toBeVisible();
    const asks = !['REV', 'VIEW'].includes(who);
    expect(all.includes('Someone else should do this Ask a person on the team, or someone outside by WhatsApp or text'), who).toBe(asks);
    for (const gone of ['We already did this', 'Not now', 'Record a new version']) expect(all, `${who}: ${gone}`).not.toContain(gone);
    expect(all.includes('Add a note'), who).toBe(who !== 'VIEW');
    expect(all, who).toContain('What helps here');
    expect(all, `${who}: the offline card`).toMatch(/On this device|Not kept on this device|Downloading for offline/);
    expect(all, who).toContain('Each check under "Then the team" has its own options too: tap it on the path.');
    expect(all.includes('Say it instead A voice note on this passage. Your team hears it here.'), who).toBe(who !== 'VIEW');
  }
});

test('PASS-027 Something else? on a recorded passage', async ({ browser }) => {
  test.setTimeout(600_000);
  const want = {
    someone: [] as string[],
    already: ['TRANS', 'KEPT', 'REV', 'TREV', 'COORD', 'LADMIN'],
    notNow: ['TRANS', 'KEPT', 'REV', 'TREV', 'COORD', 'LADMIN'],
    newVersion: ['TRANS', 'KEPT', 'TREV', 'COORD', 'LADMIN'],
    movePast: [] as string[]
  };
  const got = { someone: [] as string[], already: [] as string[], notNow: [] as string[], newVersion: [] as string[], movePast: [] as string[] };
  for (const who of ['TRANS', 'KEPT', 'REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-BT');
    await somethingElse(page);
    const all = await screenText(page);
    expect(all, who).toContain(`Something else? ${label('P-BT')} `);
    expect(all, who).not.toContain(`${label('P-BT')} · `);
    // Fixed (2026-10-12): the Back translation is already asked of REV, so nobody is offered a second request.
    if (all.includes('Someone else should do this')) got.someone.push(who);
    if (all.includes('We already did this Say when and how the back translation happened')) got.already.push(who);
    if (all.includes('Not now Set the back translation aside. Say why')) got.notNow.push(who);
    if (all.includes('Record a new version Reviews so far stay with the version they heard')) got.newVersion.push(who);
    if (all.includes('Move past a checkpoint')) got.movePast.push(who);
  }
  expect(got).toEqual(want);
});

test('PASS-028 Someone else should record it', async ({ browser }) => {
  test.setTimeout(600_000);
  const L = label('P-S');
  for (const who of ['COORD', 'TRANS'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-S');
    await somethingElse(page);
    await button(page, /^Someone else should do this/).click();
    await expect(header(page)).toHaveText('Ask someone to record');
    const all = await screenText(page);
    expect(all, who).toContain(`Ask someone to record ${L} · Alpha`);
    expect(all, who).toContain("Record it They'll find it on their My Work, with the source and the study ready.");
    for (const gone of ['Someone on the team', 'Someone without the app', 'They’ll answer']) expect(all.toLowerCase(), `${who}: ${gone}`).not.toContain(gone.toLowerCase());
    const people = await page.getByRole('radio').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e as HTMLElement).innerText.split('\n').map((l) => l.trim()).find((l) => l && !/^[A-Z][a-z]$/.test(l))!));
    const can = (['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'TREV', 'KEPT'] as AccountKey[]).filter((k) => k !== who).map(nameOf).sort();
    expect([...people].sort(), who).toEqual(can);
    await expect(byId(page, 'primary-action')).toHaveText('Choose someone');
    await expect(byId(page, 'primary-action')).toBeDisabled();
  }
});

test('PASS-029 We already did this', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['TRANS', 'REV'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-BT');
    await somethingElse(page);
    await button(page, /^We already did this/).click();
    await expect(header(page), who).toHaveText(label('P-BT'));
    expect(await screenText(page), who).toContain('Back translation · already happened');
    await byId(page, 'header-close').click();
    await expect(header(page), `${who}: ✕ returns`).toHaveText('Something else?');
  }
});

test('PASS-034 What helps here (the passage\'s reference)', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['TRANS', 'VIEW', 'COORD', 'LADMIN'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-SUBMITTED');
    await somethingElse(page);
    await button(page, 'What helps here').click();
    await expect(header(page), who).toHaveText('Reference');
    const all = await screenText(page);
    expect(all, who).toContain(`Reference ${label('P-SUBMITTED')} · Alpha`);
    expect(all, who).toContain('What translators are offered on this passage, and why. They can still explore any Bible online and choose for themselves.');
    expect(all, who).toMatch(/Bibles · \d+/i);
    const manages = ['COORD', 'LADMIN'].includes(who);
    // Reference material: Add for whoever holds it. "Hide here" is on each offered item, and this
    // world offers nothing for Luke 15 beyond the Bibles group (FIA's English guides cover Genesis).
    expect(all.trim().endsWith('Add'), `${who}: ${all}`).toBe(manages);
    const offered = all.includes('Study guides ·') || all.includes('Notes for translators ·') || all.includes('Other material ·') || /BIBLES · [1-9]/i.test(all);
    expect(all.includes('Hide here'), `${who}: ${all}`).toBe(manages && offered);
    expect(await byId(page, 'tab-map').isVisible(), `${who}: no tab bar`).toBe(false);
    if (manages && offered) {
      await button(page, 'Hide here').click();
      await expect(byId(page, 'toast')).toContainText('is hidden on this passage.');
      await byId(page, 'toast-undo').click();
      await expect(button(page, 'Hide here')).toBeVisible();
    }
    await back(page).click();
    await expect(header(page), `${who}: Back`).toHaveText('Something else?');
  }
});

// ---- who may ask -------------------------------------------------------------------------------

test('PASS-043 Who may ask', async ({ browser }) => {
  test.setTimeout(900_000);
  const got: Record<string, boolean> = {};
  for (const who of ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT', 'VIEW'] as AccountKey[]) {
    const seen: string[] = [];
    let page = await recordAs(browser, world(), who, 'P-NEW');
    await somethingElse(page);
    seen.push(await screenText(page));
    page = await recordAs(browser, world(), who, 'P-BT');
    seen.push(`MAIN ${await mainButton(page)}`);
    for (const row of ['Peer check', 'Community check']) {
      if (await teamRow(page, row).isDisabled()) continue;
      await openTeamRow(page, row);
      seen.push((await sheetButtons(page)).join(' | '));
      await closeSheet(page);
    }
    await somethingElse(page);
    seen.push(await screenText(page));
    const all = seen.join('\n');
    got[who] = /Ask someone|Send to |Someone else should do this|MAIN Ask for/.test(all);
    expect(all, who).not.toContain("You don't have permission to open that.");
  }
  expect(got).toEqual({ TRANS: true, REV: false, TREV: true, COORD: true, LADMIN: true, KEPT: true, VIEW: false });
});

// ---- checkpoints -------------------------------------------------------------------------------

test('PASS-052 A checkpoint is a hard stop @p0', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['TRANS', 'REV', 'TREV', 'KEPT'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-CHECK');
    expect((await teamRows(page))[4], who).toBe('Final approval, after the consultant check');
    await openTeamRow(page, 'Final approval');
    expect(await sheetText(page), who).toBe('Final approval Waits for the Consultant check checkpoint. Final approval Starts after the Consultant check checkpoint');
    await expect(sheet(page).getByLabel('Waits for checkpoint'), who).toBeVisible();
    expect(await sheetButtons(page), who).toEqual([]);
    await closeSheet(page);
    await openTeamRow(page, 'Consultant check');
    expect(await sheetText(page), who).toMatch(/^Consultant check Checkpoint — later steps wait for this one\. /);
    const buttons = await sheetButtons(page);
    expect(buttons, who).not.toContain('Set aside');
    expect(buttons, who).not.toContain('Move past this checkpoint…');
    await closeSheet(page);
    await somethingElse(page);
    expect(await screenText(page), who).not.toContain('Move past a checkpoint');
  }
});

test('PASS-055 A language lead may not move past a checkpoint @p0', async ({ browser }) => {
  test.setTimeout(600_000);
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

test('PASS-058 The Versions page, per role', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['TRANS', 'REV', 'COORD', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-NEEDS');
    await versionsPage(page);
    await expect(byId(page, 'header-close'), who).toBeVisible();
    const all = await screenText(page);
    expect(all, who).toContain(`Versions ${label('P-NEEDS')}`);
    const records = ['TRANS', 'COORD'].includes(who);
    expect(all.includes('No drafts. Edit a version below, or start a new one.'), who).toBe(records);
    expect(all.includes('New version'), who).toBe(records);
    expect(all.includes('Edit'), who).toBe(records);
    expect(all, who).toMatch(/Published Version 1 Latest .+ · .+ 3 parts · \d+:\d\d/i);
    // TRANS may ask for the next check not waiting on the feedback (the Back translation, "best after" it); nobody else asks here.
    expect(all.includes('Ask for the back translation'), who).toBe(who === 'TRANS');
    expect(all, who).not.toContain('Ask for the peer check');
    await button(page, 'Open Version 1').click();
    await expect(header(page), who).toHaveText('Version 1');
  }
});

test('PASS-062 History', async ({ browser }) => {
  test.setTimeout(300_000);
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

test('PASS-063 The study, from Versions', async ({ browser }) => {
  test.setTimeout(300_000);
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

test('PASS-064 A version', async ({ browser }) => {
  test.setTimeout(300_000);
  const L = label('P-NEEDS');
  for (const who of ['TRANS', 'TREV'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-NEEDS');
    await pathStep(page, 'Record').click();
    await expect(header(page), who).toHaveText('Version 1');
    const all = await screenText(page);
    expect(all, who).toMatch(new RegExp(`Version 1 .*${who === 'TRANS' ? 'You' : nameOf('TRANS')} · `));
    expect(all, who).toMatch(/Note First recording\./i);
    expect(all, who).toMatch(/Recording Play Version 1 3 takes/i);
    expect(all, who).toContain('Take 3');
    expect(all, who).toContain('Reviews of this version');
    expect(await byId(page, 'tab-map').isVisible(), `${who}: no tab bar`).toBe(false);
    expect(await page.getByRole('button', { name: /^Report/ }).locator('visible=true').count(), `${who}: the report flag`).toBe(who === 'TRANS' ? 0 : 1);
    // Crumbs show on wide windows only; on a phone Back returns to the record.
    await back(page).click();
    await expect(header(page), `${who}: back to the record`).toHaveText(L);
  }
});

test('PASS-065 A review that is not yours to answer', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const who of ['COORD', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-NEEDS');
    await versionsPage(page);
    await expand(page, 'Reviews by version', 'Feedback answered');
    await button(page, `Peer check from ${nameOf('REV')}`).click();
    await expect(header(page), who).toHaveText('Peer check');
    const all = await screenText(page);
    expect(all, who).toContain(`Needs changes ${nameOf('REV')} · in the app`);
    expect(all, who).toContain('Reviewed Version 1');
    expect(all, who).toMatch(/Feedback/i);
    expect(all, who).toContain('Verse 18 is too fast');
    expect(all, who).not.toContain('Record a fix');
    expect(all, who).not.toContain('Keep it');
    // A back translation: new content, not a verdict (P-CHECK's, made by REV).
    const c = await recordAs(browser, world(), who, 'P-CHECK');
    await versionsPage(c);
    await expand(c, 'Reviews by version', 'Feedback answered');
    await button(c, `Back translation from ${nameOf('REV')}`).click();
    const bt = await screenText(c);
    expect(bt, who).toContain('New content made from the version, not a verdict on it. The Consultant check compares it with the source.');
    expect(bt, who).toContain('Made from Version 1');
  }
});

test('PASS-066 Report flags on other people\'s work only', async ({ browser }) => {
  test.setTimeout(600_000);
  const flags = async (page: Page) => page.getByRole('button', { name: /^Report/ }).locator('visible=true').count();
  const seen: Record<string, [number, number]> = {};
  for (const who of ['TRANS', 'REV', 'VIEW'] as AccountKey[]) {
    const page = await recordAs(browser, world(), who, 'P-NEEDS');
    await pathStep(page, 'Record').click().catch(async () => { await versionsPage(page); await button(page, 'Open Version 1').click(); });
    await expect(header(page)).toHaveText('Version 1');
    const onVersion = await flags(page);
    await back(page).click();
    await versionsPage(page);
    await expand(page, 'Reviews by version', 'Feedback answered');
    await button(page, `Peer check from ${who === 'REV' ? 'You' : nameOf('REV')}`).click();
    seen[who] = [onVersion, await flags(page)];
  }
  expect(seen).toEqual({ TRANS: [0, 1], REV: [1, 0], VIEW: [1, 1] });
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
