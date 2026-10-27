// 06 · Recording (docs/ui-test-suite/06-recording.md): the recording
// workspace, voice detection, parts, Publish, several drafts, what a
// browser does with a recording when the page goes, and who may record.
// The tests share one fixture world and run in order: REC-011 publishes
// Version 1 of P-NEW and REC-016 Version 2, as the spec's order says. Each
// test opens its own page (a fresh browser profile), so whatever a test
// leaves for the next one is on the server before it ends (expectUploaded).
//
// The microphone is e2e/fixtures/voice-mic.wav (a part about every
// four seconds) unless a test needs quiet or speech of a set length; then
// it switches to the tone microphone in 06-recording-helpers.ts.
//
// Tests needing the world untouched by these live in their own files:
// 06-recording-mic.spec.ts (the microphone refused) and
// 06-recording-long.spec.ts (REC-030, ten minutes of recording).
import { randomUUID } from 'node:crypto';
import { derivePassage, draftsBy, type LanguageState } from '@langquest-next/core';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  chip, deletePart, swipePart, deviceLog, expectIdle, expectUploaded, expectParts, holdPart, installMicControl, lastComposed, leaveSession, mic, openWorkspace, draftParts, partCount, partsTitle,
  publishButton, recordButton, recordSaid, recordStep, redoButton, savedMark, say, secondDevice, startFromRecord, stopRecording, undoButton, verseSpace, workspaceSub,
  useFileWorld
} from './06-recording-helpers';
import { clientAs, send } from './fixture';
import {
  back, button, byId, expect, expectNothingRefused, expectSyncIdle, expectToast, openAs, openPassage, primary, screenText, syncNow, tab, test, text, waitForApp,
  type UiWorld
} from './support';

const world = useFileWorld('06-recording');
type Key = keyof UiWorld['passages'];

test.beforeEach(async ({ page }) => { await installMicControl(page); });

/** TRANS's drafts and versions of a passage, as the server has them (a second device). */
async function onServer(w: UiWorld, key: Key, who: 'TRANS' | 'REV' | 'COORD' = 'TRANS') {
  const client = await clientAs(w, who, 'A');
  const state = client.getState() as LanguageState;
  const p = derivePassage(state, w.passages[key].unitId);
  return { p, drafts: draftsBy(p, w.accounts.TRANS.id), versions: p.versions };
}

/** How many events this device holds for the language, once it has stopped catching up ("nothing was written"). */
async function eventCount(page: Page, w: UiWorld): Promise<number> {
  const count = async () => (await deviceLog(page, w.languages.A.orgId, w.languages.A.languageId)).length;
  await expectSyncIdle(page);
  return count();
}

const groupPlay = (page: Page, count: number) => button(page, `Play ${partsTitle(count)}`);

// ---- Opening the workspace -------------------------------------------------------------

test('REC-001 Record opens the workspace for a passage nobody has recorded', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openPassage(page, w, 'P-NEW');
  const before = await eventCount(page, w);
  await startFromRecord(page, 'Record');
  await expect(text(page, w.passages['P-NEW'].label)).toBeVisible();
  await expect(text(page, 'Recording Version 1')).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  // Nothing to save (decision 127): no Save button, and no mark until a part is kept.
  await expect(button(page, 'Save')).toHaveCount(0);
  await expect(savedMark(page)).toHaveCount(0);
  // The divider at half: the reference on top, the recorder below.
  const divider = page.getByRole('slider', { name: 'Divider between reference and your recording' });
  await expect(divider).toHaveAttribute('aria-valuetext', 'Source 50%');
  // The chips: Bible (selected), Key words, Notes; no Earlier yet.
  for (const c of ['Bible', 'Key words', 'Notes']) await expect(chip(page, new RegExp(`^${c}`))).toBeVisible();
  await expect(chip(page, /^Earlier/)).toHaveCount(0);
  await expect(chip(page, /^Bible/)).toHaveAttribute('aria-selected', 'true');
  // The recorder: Part 1 lit, the hint. Nothing about the microphone to set (LAN-82).
  await expect(page.getByLabel('Part 1. Recording next')).toBeVisible();
  // No line explains it (decision 124): the lit part says where the next one goes.
  await expect(button(page, 'Set up the microphone')).toHaveCount(0);
  // The footer: Part 1, the red button, Publish disabled.
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Record');
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  expect(await eventCount(page, w), 'opening the workspace writes nothing').toBe(before);
});

test('REC-002 My Work\'s Start opens the same workspace', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await expect(text(page, 'Next for you')).toBeVisible();
  // The newest request leads (P-Q4 in the fixture); any of P-NEW to P-Q4 is a passage nobody has recorded.
  const asked = (['P-NEW', 'P-Q1', 'P-Q2', 'P-Q3', 'P-Q4'] as const).map((k) => w.passages[k].label);
  const heading = page.getByRole('heading', { level: 1 }).filter({ hasText: /^Luke / }).first();
  await expect(heading).toBeVisible();
  const label = (await heading.innerText()).trim();
  expect(asked).toContain(label);
  const before = await eventCount(page, w);
  await button(page, 'Start').click();
  if (!(await text(page, 'Recording Version 1').isVisible().catch(() => false))) await startFromRecord(page, 'Record');
  await expect(page.getByRole('heading', { name: label })).toBeVisible();
  await expect(text(page, 'Recording Version 1')).toBeVisible();
  await chip(page, /^Notes/).click();
  // COORD's request leads the notes: who asked (and when it is due, when it is).
  await expect(text(page, /^Cora Coordinator asked/)).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Recording Version 1')).toHaveCount(0);
  expect(await eventCount(page, w), 'nothing is written').toBe(before);
});

test('REC-003 Continue recording opens the draft already on the device', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openPassage(page, w, 'P-DRAFT');
  await expect(primary(page)).toHaveText('Continue recording');
  await expect(text(page, 'Your parts are recorded, not published yet.')).toBeVisible();
  await primary(page).click();
  await expect(text(page, 'Recording Version 1')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Parts 1–2, 2 parts · \d+:\d\d$/ })).toBeVisible();
  await expect(groupPlay(page, 2)).toBeVisible();
  // The parts show by themselves when the pane has room; the toggle folds them.
  await expect(button(page, 'Hide the parts')).toBeVisible();
  await expect(page.getByLabel('Part 3. Recording next')).toBeVisible();
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(text(page, 'Tap the red button and speak. Pause between parts: each part is kept by itself.')).toHaveCount(0);
});

// ---- Recording parts ----------------------------------------------------------------

test('REC-004 Record parts with voice detection @p0', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Record');
  // Speech of a set length: 4 s, 4 s, 3 s, each followed by 2 s of quiet.
  const m = mic(page);
  await m.mode('tone');
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  // The recording view names the part being said; the footer holds Undo and Redo, out of the way while recording (decision 133).
  await expect(page.getByLabel(/^Part 1\. /)).toBeVisible();
  await expect(text(page, 'Listening for you · pause between parts')).toBeVisible();
  await expect(publishButton(page)).toHaveCount(0);
  for (const [i, ms] of [4000, 4000, 3000].entries()) {
    await m.speak(true);
    await expect(text(page, 'Recording…')).toBeVisible();
    await page.waitForTimeout(ms); // sleep: N s of speech, the product's own threshold
    await m.speak(false);
    // After the pause the card counts it, and the next part is lit. The product's rule is 2 s of quiet by the audio's
    // clock; the test allows for a slow runner (CPU load stretches the detector's turn), so the wait is a ceiling, not the point.
    await expectParts(page, i + 1, 10_000);
    await expect(page.getByLabel(new RegExp(`^Part ${i + 2}\\. `))).toBeVisible();
    await expect(text(page, 'Listening for you · pause between parts')).toBeVisible();
  }
  // Stopping keeps the session open (decision 129): its parts are boxes to hear, move or drop, and nothing is saved until the recording view's Done.
  await stopRecording(page);
  for (const n of [1, 2, 3]) await expect(byId(page, `live-part-${n}`)).toBeVisible();
  await expect(page.getByLabel(/^Part 4\. /)).toBeVisible();
  await expect(publishButton(page)).toHaveCount(0);
  await leaveSession(page);
  await expect(page.getByRole('button', { name: /^Parts 1–3, 3 parts · \d+:\d\d$/ })).toBeVisible();
  await expect(page.getByLabel('Part 4. Recording next')).toBeVisible();
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  // Each part is kept as it lands: the mark ends on its check.
  await expect(savedMark(page)).toHaveAttribute('aria-label', 'Saved');
  // No part is shorter than a second, and none is empty.
  // Each part's name and length: tapping it chooses it to record over (LAN-83); its play button has no words.
  const lengths = await page.getByRole('button', { name: /^Record Part \d again$/ }).evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  expect(lengths).toHaveLength(3);
  // Structure, not a stopwatch: every part shows a mm:ss length of at least a second (speech of 3 to 4 s was said; a loaded
  // runner records more or less of it, so no narrow window), and none is hours long.
  for (const l of lengths) {
    const m = /(\d+):(\d\d)/.exec(l);
    expect(m, `"${l}" shows a length`).not.toBeNull();
    const seconds = Number(m![1]) * 60 + Number(m![2]);
    expect(seconds, `"${l}" is a real part`).toBeGreaterThanOrEqual(1);
    expect(seconds, `"${l}" is one part, not the whole session`).toBeLessThan(30);
  }
  await m.mode('file');
  await expectUploaded(page, w);
  // The record: Continue recording, the takes not published yet.
  await back(page).click();
  await expect(primary(page)).toHaveText('Continue recording');
  await expect(text(page, 'Your parts are recorded, not published yet.')).toBeVisible();
  // COORD's device sees the draft on the record.
  const coord = await secondDevice(browser, w, 'COORD');
  try {
    await openPassage(coord.page, w, 'P-NEW');
    await expect(text(coord.page, 'Some parts are recorded, not published yet.')).toBeVisible({ timeout: 30_000 });
  } finally { await coord.context.close(); }
  await expectNothingRefused(page, w);
});

test('REC-005 Parts can be heard together and one by one', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Continue recording');
  await expectParts(page, 3);
  const opened = (await mic(page).counts()).opened;
  // A fresh browser fetches the parts' audio first.
  await expect(groupPlay(page, 3)).toBeEnabled({ timeout: 60_000 });
  await groupPlay(page, 3).click();
  await expect(button(page, 'Pause')).toBeVisible();
  await button(page, 'Pause').click();
  await expect(groupPlay(page, 3)).toBeVisible();
  // The parts, each a row with its play button and its verse space (hold for Delete).
  for (const n of [1, 2, 3]) {
    await expect(button(page, `Play Part ${n}`)).toBeVisible();
    await expect(verseSpace(page, n)).toBeVisible();
  }
  await button(page, 'Play Part 2').click();
  await expect(button(page, 'Pause Part 2')).toBeVisible();
  await expect(button(page, 'Play Part 1')).toBeVisible();
  await button(page, 'Pause Part 2').click();
  await button(page, 'Hide the parts').click();
  await expect(button(page, 'Play Part 1')).toHaveCount(0);
  await expect(button(page, 'Show the parts')).toBeVisible();
  await button(page, 'Show the parts').click();
  await expect(button(page, 'Play Part 1')).toBeVisible();
  // No playback opened the microphone.
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Record');
  expect((await mic(page).counts()).opened).toBe(opened);
});

test('REC-007 Delete a part, then Undo and Redo @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Continue recording');
  await expectParts(page, 3);
  const before = await lastComposed(page, w, 'P-NEW');
  const original = before.length === 3 ? before : (await onServer(w, 'P-NEW')).drafts[0]!.cardHashes;
  // A part slides either way to its bin, and nothing goes until the bin is tapped; a tap on the row closes it.
  const bin = page.getByRole('button', { name: 'Delete Part 2', exact: true }).locator('visible=true');
  await expect(bin).toHaveCount(0);
  await swipePart(page, 2, -110);
  await expect(bin).toHaveCount(1);
  const row = (await page.getByRole('button', { name: 'Record Part 2 again', exact: true }).locator('visible=true').first().boundingBox())!;
  await page.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
  await expect(bin).toHaveCount(0);
  await expectParts(page, 3);
  await deletePart(page, 2);
  // No toast with an Undo that runs out (Caleb, 2026-10-16): the arrows by the red button stay.
  await expect(byId(page, 'toast-undo')).toHaveCount(0);
  await expect(undoButton(page)).toHaveAttribute('aria-label', 'Undo: Part 2 deleted.');
  await expect(redoButton(page)).toHaveAttribute('aria-disabled', 'true');
  // The deleted part's place stays, numbered, so the card reads three places and two parts (LAN-83).
  await expect(page.getByRole('button', { name: /^Parts 1–3, 2 parts · / })).toBeVisible();
  await expect(button(page, 'Record Part 2 here')).toBeVisible();
  await expect.poll(() => lastComposed(page, w, 'P-NEW')).toEqual([original[0], original[2]]);
  // Undo is still there after leaving the workspace and coming back.
  await back(page).click();
  await startFromRecord(page, 'Continue recording');
  await expectParts(page, 2);
  await undoButton(page).click();
  await expectParts(page, 3);
  await expect.poll(() => lastComposed(page, w, 'P-NEW')).toEqual(original);
  // Redo deletes it again, and Undo brings it back once more: each a new change on the record.
  await redoButton(page).click();
  await expectParts(page, 2);
  await undoButton(page).click();
  await expectParts(page, 3);
  await expect(redoButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => lastComposed(page, w, 'P-NEW')).toEqual(original);
  await expectUploaded(page, w);
  // A second device: the same three parts in the same order.
  await expect.poll(async () => (await onServer(w, 'P-NEW')).drafts.map((d) => d.cardHashes), { timeout: 30_000 }).toEqual([original]);
  await expectNothingRefused(page, w);
});

test('REC-008 Parts cannot be deleted while recording', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Continue recording');
  await expectParts(page, 3);
  const m = mic(page);
  await m.mode('tone');
  await m.speak(false);
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  // While recording the pane is the recording view (LAN-83, decision 124): the parts list is not on screen, so no
  // verse space, Play button or Delete of a recorded part can be reached; the view's ✕ throws the whole recording away and asks first.
  for (const n of [1, 2, 3]) {
    await expect(verseSpace(page, n)).toHaveCount(0);
    await expect(button(page, `Play Part ${n}`)).toHaveCount(0);
    await expect(button(page, `Delete Part ${n}`)).toHaveCount(0);
  }
  await expect(button(page, 'Throw away this recording')).toBeVisible();
  await expect(publishButton(page)).toHaveCount(0);
  await expect(byId(page, 'toast')).toHaveCount(0);
  await leaveSession(page);
  await m.mode('file');
  for (const n of [1, 2, 3]) await expect(verseSpace(page, n)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(savedMark(page)).toHaveAttribute('aria-label', 'Saved');
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expectParts(page, 3);
});

test('REC-009 Deleting the only part leaves nothing to publish', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q2', 'Record');
  await recordSaid(page, [3000]);
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await deletePart(page, 1);
  await expectParts(page, 0);
  await expect(page.getByLabel('Part 1. Recording next')).toBeVisible();
  // No line explains it (decision 124): the lit part says where the next one goes.
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  await undoButton(page).click();
  await expectParts(page, 1);
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expectUploaded(page, w);
  await expect.poll(async () => (await onServer(w, 'P-Q2')).drafts.map((d) => d.cardHashes.length), { timeout: 30_000 }).toEqual([1]);
});

test('REC-010 Leaving keeps the draft, and the mark says so', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Continue recording');
  await expectParts(page, 3);
  await expect(savedMark(page)).toHaveAttribute('aria-label', 'Saved');
  await back(page).click();
  await expect(byId(page, 'toast')).toHaveCount(0);
  await expect(primary(page)).toHaveText('Continue recording');
  await primary(page).click();
  await expectParts(page, 3);
  await back(page).click();
  await expect(primary(page)).toHaveText('Continue recording');
  await expect(byId(page, 'toast')).toHaveCount(0);
  expect((await onServer(w, 'P-NEW')).drafts.map((d) => d.cardHashes.length)).toEqual([3]);
});

// ---- Publishing ------------------------------------------------------------------------

/**
 * REC-011 ends on the passage record after Done asked for the peer check, and
 * REC-012 starts there: the two share one browser, kept open between them.
 */
let kept: { context: BrowserContext; page: Page } | null = null;
async function keptPage(browser: Browser): Promise<Page> {
  if (!kept) {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
    await installMicControl(context);
    kept = { context, page: await context.newPage() };
  }
  return kept.page;
}
test.afterAll(async () => { await kept?.context.close(); kept = null; });

/** The passage record's path step rows, as one line each ("1. Record. Version 1 · 0:11"). */
async function pathRows(page: Page): Promise<string[]> {
  return page.getByRole('button', { name: /^\d+\. / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
}

test('REC-011 Done, then ask the usual people for the peer check @p0', async ({ browser }) => {
  const w = world();
  const page = await keptPage(browser);
  const label = w.passages['P-NEW'].label;
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Continue recording');
  await expectParts(page, 3);
  await expect(publishButton(page)).toHaveText('Done');
  await publishButton(page).click();
  // The Done screen, inside the workspace: the version, a word about it, and its next check with its people.
  await expect(page.getByRole('heading', { name: label })).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(text(page, 'Version 1')).toBeVisible();
  await expect(text(page, /^3 parts · \d+:\d\d( · recorded with the \S+ Bible)?$/)).toBeVisible();
  await expect(button(page, 'Say something about it. Optional · the team hears it with this version')).toBeVisible();
  await expect(text(page, 'Next check')).toBeVisible();
  await expect(text(page, 'Peer check')).toBeVisible();
  await expect(text(page, /Trevor Both|Rita Reviewer/)).toBeVisible();
  await expect(primary(page)).toHaveText(/^Ask /);
  await expect(primary(page)).toBeEnabled();
  await expect(button(page, 'Someone else')).toBeVisible();
  await expect(button(page, 'Send later')).toBeVisible();
  const target = (await primary(page).innerText()).trim().replace(/^Ask /, '');
  // One tap publishes and asks; the asking is taken back from History (Withdraw), not the toast (decision 134).
  await primary(page).click();
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expectToast(page, new RegExp(`^Sent to ${escaped} — (anyone on it|they) will see it on My Work`));
  await expect(byId(page, 'toast-undo')).toHaveCount(0);
  // Back on the record, which says the version and who was asked; no "published" page in between.
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toHaveCount(0);
  await expect.poll(async () => (await pathRows(page)).join('\n')).toMatch(/asked /);
  await expectUploaded(page, w);
  // On the server: no draft, Version 1 by TRANS with three parts, and the peer check asked for.
  await expect.poll(async () => {
    const s = await onServer(w, 'P-NEW');
    return [s.drafts.length, s.versions.map((v) => v.cardHashes.length), s.p.openRequests.filter((r) => r.what === 'review').map((r) => r.kindId)];
  }, { timeout: 30_000 }).toEqual([0, [3], ['peer']]);
  // REV's device: Version 1 is on the record, and plays.
  const rev = await secondDevice(browser, w, 'REV');
  try {
    await openPassage(rev.page, w, 'P-NEW');
    await button(rev.page, 'Versions and history').click();
    await expect(text(rev.page, 'Version 1')).toBeVisible({ timeout: 30_000 });
    await expect(button(rev.page, 'Play Version 1')).toBeEnabled({ timeout: 30_000 });
  } finally { await rev.context.close(); }
  await expectNothingRefused(page, w);
});

test('REC-012 After Done, the record says who was asked, and they find it on My Work', async ({ browser }) => {
  const w = world();
  const page = await keptPage(browser);
  const rows = await pathRows(page);
  expect(rows.join('\n')).toMatch(/Version 1 · \d+:\d\d/);
  expect(rows.join('\n')).toMatch(/Published just now · asked /);
  // Asked already: the record does not offer asking for the peer check again.
  await expect(primary(page)).not.toHaveText('Ask for the peer check');
  // REV finds P-NEW's Peer check on My Work.
  const rev = await secondDevice(browser, w, 'REV');
  try {
    await expect(text(rev.page, w.passages['P-NEW'].label, false)).toBeVisible({ timeout: 30_000 });
  } finally { await rev.context.close(); }
});

test('REC-013 Done\'s ✕ returns to the workspace and keeps everything', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q2', 'Continue recording');
  await expectParts(page, 1);
  await publishButton(page).click();
  await button(page, /^Say something about it\. /).click();
  await page.getByPlaceholder('Or type it').fill('Draft for the team');
  await button(page, 'Done').click();
  await expect(button(page, /^What you said about it\. “Draft for the team”/)).toBeVisible();
  await back(page).click();
  // Back in the workspace, not the record: the part is still there, nothing published.
  await expect(text(page, 'Recording Version 1')).toBeVisible();
  await expectParts(page, 1);
  // What was said is kept too (decision 127): opening Done again brings it back.
  await publishButton(page).click();
  await expect(button(page, /^What you said about it\. “Draft for the team”/)).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Recording Version 1')).toBeVisible();
  expect((await onServer(w, 'P-Q2')).versions).toHaveLength(0);
});

test('REC-014 Say something about Version 1 by voice', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q2', 'Continue recording');
  await expectParts(page, 1);
  await publishButton(page).click();
  await button(page, /^Say something about it\. /).click();
  await expect(text(page, 'Anything the team should know. They hear it with this version.')).toBeVisible();
  await mic(page).mode('tone');
  await button(page, 'Say it').click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  await say(page, 3000, 0);
  await button(page, 'Stop recording').click();
  await expect(button(page, 'Play voice note')).toBeVisible();
  await button(page, 'Done').click();
  await expect(button(page, 'What you said about it. Voice note')).toBeVisible();
  // Send later: done, and nobody asked yet.
  await button(page, 'Send later').click();
  await expectToast(page, 'Version 1 published.');
  await expectUploaded(page, w);
  const s = await onServer(w, 'P-Q2');
  expect(s.versions).toHaveLength(1);
  expect(s.versions[0]!.changeBlobHash, 'the voice note goes with Version 1').toBeTruthy();
  expect(s.p.openRequests.filter((r) => r.what === 'review'), 'Send later asks nobody').toHaveLength(0);
  // The record asks later; its Versions and history plays the version with its note.
  await expect(primary(page)).toHaveText('Ask for the peer check');
  await button(page, 'Versions and history').click();
  await expect(button(page, 'Play Version 1')).toBeEnabled();
});

test('REC-015 A note at a moment of the version, while publishing', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Record');
  await recordSaid(page, [3000, 3000]);
  await publishButton(page).click();
  await button(page, 'Play Version 1').click();
  await expect(button(page, 'Pause')).toBeVisible();
  await page.waitForTimeout(5000); // sleep: 5 s of playback so the note is stamped at 0:05, the player's own clock
  await button(page, 'Add a note at this moment').click();
  const field = page.getByPlaceholder('Or type it');
  // The point is that the note carries the player's clock, about 5 s in. A slow runner plays and sleeps unevenly, so the stamp may land a few seconds either side.
  await expect(field).toHaveValue(/^At 0:(0[3-9]|1\d): $/);
  await field.press('End');
  await field.pressSequentially('verse 24 needs a slower pace');
  await button(page, 'Done').click();
  await expect(button(page, /^What you said about it\. “At 0:(0[3-9]|1\d): verse 24 needs a slower pace”$/)).toBeVisible();
  await back(page).click();
  await expect(text(page, 'Recording Version 1')).toBeVisible();
  await expectUploaded(page, w);
  expect((await onServer(w, 'P-Q3')).versions).toHaveLength(0);
});

test('REC-016 Version 2 needs "what changed" @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openPassage(page, w, 'P-NEW');
  const v1 = (await onServer(w, 'P-NEW')).versions[0]!.cardHashes;
  await button(page, 'Versions and history').click();
  await expect(text(page, 'Version 1')).toBeVisible();
  await button(page, 'Edit').click();
  await expect(text(page, 'Recording Version 2')).toBeVisible();
  await expectParts(page, 3);
  // The card is named for the version while its parts are still the version's (LAN-83: no sentence says so).
  await expect(page.getByRole('button', { name: /^Version 1, 3 parts · / }).locator('visible=true').first()).toBeVisible();
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  await recordSaid(page, [3000]);
  await expect(page.getByRole('button', { name: /^Version 1, / }).locator('visible=true')).toHaveCount(0);
  await expectParts(page, 4);
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await publishButton(page).click();
  await expect(button(page, 'Say what changed. Needed · since Version 1, so the team knows what to listen for')).toBeVisible();
  await expect(primary(page)).toHaveText(/^Ask /);
  await expect(primary(page)).toBeDisabled();
  await button(page, /^Say what changed\. /).click();
  await expect(text(page, 'What changed?')).toBeVisible();
  await expect(text(page, 'Since Version 1. The team hears it with this version.')).toBeVisible();
  await expect(button(page, 'Say what changed')).toBeVisible();
  await page.getByPlaceholder('Or type it').fill('Added verse 9 again, slower');
  await button(page, 'Done').click();
  await expect(button(page, 'What changed. “Added verse 9 again, slower”')).toBeVisible();
  await expect(primary(page)).toBeEnabled();
  await button(page, 'Send later').click();
  await expectToast(page, 'Version 2 published.');
  await expectUploaded(page, w);
  await button(page, 'Versions and history').click();
  await expect(button(page, /^Open Version 2/)).toBeVisible();
  await expect(button(page, /^Open Version 1/)).toBeVisible();
  // Version 1 never changes (decision 83); Version 2 says what changed.
  const s = await onServer(w, 'P-NEW');
  expect(s.versions.map((v) => v.n)).toEqual([1, 2]);
  expect(s.versions[0]!.cardHashes).toEqual(v1);
  expect(s.versions[1]!.cardHashes).toHaveLength(4);
  expect(s.versions[1]!.changeNote).toBe('Added verse 9 again, slower');
});

test('REC-017 What changed can be said instead of typed', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openPassage(page, w, 'P-Q2');
  await expect(primary(page)).toHaveText('Ask for the peer check');
  // The latest version, edited: Versions and history, then Edit on it (the newest comes first).
  await button(page, 'Versions and history').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(text(page, 'Recording Version 2')).toBeVisible();
  await expectParts(page, 1);
  await recordSaid(page, [3000]);
  await publishButton(page).click();
  await button(page, /^Say what changed\. /).click();
  await mic(page).mode('tone');
  await button(page, 'Say what changed').click();
  await say(page, 3000, 0);
  await button(page, 'Stop recording').click();
  await expect(button(page, 'Play voice note')).toBeVisible();
  await button(page, 'Done').click();
  await expect(button(page, 'What changed. Voice note')).toBeVisible();
  await expect(primary(page)).toBeEnabled();
  await button(page, 'Send later').click();
  await expectToast(page, 'Version 2 published.');
  await expectUploaded(page, w);
  const v = (await onServer(w, 'P-Q2')).versions;
  expect(v.map((x) => x.n)).toEqual([1, 2]);
  expect(v[1]!.changeBlobHash).toBeTruthy();
});

test('REC-018 Changing a published version\'s parts makes a new draft', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openPassage(page, w, 'P-Q2');
  await expect(primary(page)).toHaveText('Ask for the peer check');
  // The latest version, edited: Versions and history, then Edit on it (the newest comes first).
  await button(page, 'Versions and history').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(text(page, 'Recording Version 3')).toBeVisible();
  await expectParts(page, 2);
  const v2 = (await onServer(w, 'P-Q2')).versions[1]!.cardHashes;
  await deletePart(page, 2);
  await expectParts(page, 1);
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(savedMark(page)).toHaveAttribute('aria-label', 'Saved');
  await back(page).click();
  // ✕ goes back to where the workspace was opened from, the Versions page, with the draft kept.
  await expect(text(page, 'Your draft')).toBeVisible();
  await expectUploaded(page, w);
  const s = await onServer(w, 'P-Q2');
  expect(s.versions[1]!.cardHashes, 'Version 2 keeps all its parts').toEqual(v2);
  expect(s.drafts.map((d) => d.cardHashes)).toEqual([[v2[0]]]);
  await expect(text(page, /^1 part · \d+:\d\d$/)).toBeVisible();
});

test('REC-019 Several drafts of one passage', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openPassage(page, w, 'P-Q2');
  await button(page, 'Versions and history').click();
  await primary(page).click(); // New version
  await expect(text(page, 'New draft')).toBeVisible();
  await expectParts(page, 0);
  await recordSaid(page, [3000]);
  await expect(text(page, 'Draft 2')).toBeVisible();
  await expect(savedMark(page)).toHaveAttribute('aria-label', 'Saved');
  await back(page).click();
  // ✕ went back to the Versions page it was opened from, which lists both drafts.
  await expect(text(page, 'Your drafts')).toBeVisible();
  // The record behind it still leads with asking for Version 2's check; its drafts are under Versions and history.
  await back(page).click();
  await expect(primary(page)).toHaveText('Ask for the peer check');
  await button(page, 'Versions and history').click();
  await expect(text(page, 'Your drafts')).toBeVisible();
  for (const name of ['Draft 1', 'Draft 2']) {
    await expect(button(page, `Play ${name}`)).toBeVisible();
    await expect(button(page, `Delete ${name}`)).toBeVisible();
  }
  await expect(button(page, 'Edit').first()).toBeVisible();
  const before = (await onServer(w, 'P-Q2')).drafts.map((d) => d.cardHashes);
  expect(before).toHaveLength(2);
  // A whole draft asks first (decision 124); Cancel keeps it, and once deleted there is no Undo.
  await button(page, 'Delete Draft 2').click();
  await expect(text(page, 'Delete Draft 2?')).toBeVisible();
  await button(page, 'Cancel').click();
  await expect(button(page, 'Delete Draft 2')).toBeVisible();
  await button(page, 'Delete Draft 2').click();
  await page.getByRole('button', { name: 'Delete Draft 2', exact: true }).locator('visible=true').last().click();
  await expectToast(page, 'Draft 2 deleted.');
  await expect(byId(page, 'toast-undo')).toHaveCount(0);
  await expect(button(page, 'Delete Draft 2')).toHaveCount(0);
  await expectUploaded(page, w);
  await expect.poll(async () => (await onServer(w, 'P-Q2')).drafts.map((d) => d.cardHashes), { timeout: 30_000 }).toEqual([before[0]]);
});

// ---- Interruptions and field conditions --------------------------------------------

test('REC-025 Web: closing the tab while recording asks first', async ({ page, context }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  // A draft from an earlier test shows its parts a moment after the workspace opens: count them only once they have.
  await openPassage(page, w, 'P-Q3');
  const hasDraft = (await primary(page).innerText()).trim() === 'Continue recording';
  await startFromRecord(page);
  const before = hasDraft ? await draftParts(page) : await partCount(page);
  const dialogs: string[] = [];
  // The first question is cancelled (step 3); any later one is let through, and counted.
  page.on('dialog', (d) => { dialogs.push(d.type()); void (dialogs.length === 1 ? d.dismiss() : d.accept()); });
  // Close the tab while a part is being said. The tone microphone speaks only when told to: the voice file plays on its own
  // clock and says a part more on a slow machine, so a count of exactly one new part was never certain.
  const m = mic(page);
  await m.mode('tone');
  // In syllables: the tone goes on through the reload's question, and a steady one long enough becomes the room (decision 125).
  await m.syllables(true);
  await m.speak(false);
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  await m.speak(true);
  await expect(text(page, 'Recording…')).toBeVisible({ timeout: 8_000 });
  // A reload while speaking (Playwright's page.close with beforeunload leaves the page unable to navigate after a cancel).
  await page.evaluate(() => { window.location.reload(); });
  await expect.poll(() => dialogs).toEqual(['beforeunload']);
  // Cancelled: the page stays and recording goes on; the part ends at the pause.
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  await say(page, 2500); // the part said, then the quiet that ends it
  await expectParts(page, before + 1, 8_000);
  await m.syllables(false);
  await leaveSession(page);
  // Idle, with nothing left to send (else the leave guard asks, storageGate.tsx), a reload asks nothing.
  await expectUploaded(page, w);
  // Until the upload count catches up the leave guard is still on; then nothing holds the page.
  await expect.poll(() => page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), { timeout: 20_000, message: 'nothing asks before leaving' }).toBe(true);
  await page.reload();
  await waitForApp(page);
  expect(dialogs).toEqual(['beforeunload']);
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  await expectParts(page, before + 1);
  // The tab killed outright (no question asked) right after a session was
  // left: every part it kept was stored in the browser before it went, and
  // is there when LangQuest opens again in the same browser
  // (recordingJournal.ts). A session not yet left lives in the page, which
  // asks before it goes (above); a phone keeps it in its journal (LAN-82).
  await recordSaid(page, [3000]); // the microphone is the voice file again after the reload; recordSaid sets the tone
  await page.waitForTimeout(800); // sleep: the journal's write to browser storage, which shows nowhere on screen
  await page.close();
  const again = await context.newPage();
  await openAs(again, w, 'TRANS');
  await openWorkspace(again, w, 'P-Q3', 'Continue recording');
  await expectParts(again, before + 2, 30_000);
  await expectUploaded(again, w);
  expect((await onServer(w, 'P-Q3')).drafts.map((d) => d.cardHashes.length)).toEqual([before + 2]);
});

test('REC-031 Tapping record and stop very fast', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q1', 'Record');
  await recordSaid(page, [3000]);
  const m = mic(page);
  await m.mode('tone');
  await m.speak(false);
  const box = (await recordButton(page).boundingBox())!;
  for (let i = 0; i < 10; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(3000); // sleep: lets ten rapid taps settle; the end state is what is asserted next
  // One clear state, and it agrees with the microphone.
  const label = await recordButton(page).getAttribute('aria-label');
  const open = (await m.counts()).open;
  expect(label === 'Stop recording' ? open > 0 : open === 0, `button "${label}" with ${open} microphone(s) open`).toBe(true);
  // However the taps landed, Done leaves whatever session they opened.
  if (await button(page, 'Done').isVisible()) await leaveSession(page);
  await expectParts(page, 1);
  await expect(text(page, /could not start|did not save|Something went wrong/)).toHaveCount(0);
  await recordSaid(page, [3000]);
  await expectParts(page, 2);
  await expectUploaded(page, w);
});

test('REC-033 Record and publish in airplane mode @p0', async ({ page, context }) => {
  const w = world();
  const label = w.passages['P-Q1'].label;
  await openAs(page, w, 'TRANS');
  // Precondition: TRANS's draft of P-Q1, two parts. In the whole file REC-031
  // leaves it; when only the @p0 tests run (the PR job) this test records it.
  if ((await onServer(w, 'P-Q1')).drafts.length === 0) {
    await openWorkspace(page, w, 'P-Q1', 'Record');
    await recordSaid(page, [3000, 3000]);
    await expectParts(page, 2);
    await expectUploaded(page, w);
    await page.goto('/');
    await waitForApp(page);
  }
  // Opened online once, so the passage is on the device.
  await openWorkspace(page, w, 'P-Q1', 'Continue recording');
  await expectParts(page, 2);
  await context.setOffline(true);
  await recordSaid(page, [3000, 3000]);
  await expectParts(page, 4);
  await deletePart(page, 3);
  await expectParts(page, 3);
  await undoButton(page).click();
  await expectParts(page, 4);
  await publishButton(page).click();
  await button(page, 'Send later').click();
  await expectToast(page, 'Version 1 published.');
  await expect(page.getByRole('heading', { name: label })).toBeVisible();
  const waiting = (await deviceLog(page, w.languages.A.orgId, w.languages.A.languageId)).filter((r) => r.status === 'pending');
  expect(waiting.length, 'the work waits on the device').toBeGreaterThan(0);
  await context.setOffline(false);
  await expectUploaded(page, w);
  await expectNothingRefused(page, w);
  // REV's device: Version 1, every part on the server to play.
  const client = await clientAs(w, 'REV', 'A');
  const state = client.getState() as LanguageState;
  const v = derivePassage(state, w.passages['P-Q1'].unitId).versions;
  expect(v.map((x) => x.cardHashes.length)).toEqual([4]);
  for (const h of v[0]!.cardHashes) expect(state.blobs[h]?.stored, `part ${h.slice(0, 8)} on the server`).toBe(true);
});

// ---- Listening while recording ------------------------------------------------------

/** The fixture world offers a Bible only when the library has one; the local library may not. */
async function needsBible(page: Page): Promise<void> {
  await expect(text(page, /^No Bible for this passage yet$|^Built-in text, a last resort|^No text for this passage/).or(button(page, /^Bible: /))).toBeVisible();
  // Only the built-in last-resort Bible (no recommended one, no text for the passage) means the library has none.
  test.skip(!(await button(page, /^Bible: /).isVisible()),
    'Precondition not met: this fixture world offers no recommended Bible with audio (the local library has no English source). Run against a library that has one.');
}

test('REC-036 Playing the Bible while recording pauses the microphone', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  await needsBible(page);
  const before = await draftParts(page);
  await mic(page).mode('tone');
  await recordButton(page).click();
  await say(page, 3000);
  await expectParts(page, before + 1);
  await button(page, 'Play the Bible').click();
  await expect(text(page, 'Paused while the Bible plays')).toBeVisible();
  await expect(button(page, 'Resume recording now')).toBeVisible();
  await page.waitForTimeout(5000); // sleep: 5 s of Bible playing while recording is held
  await button(page, 'Pause').first().click();
  await expect(text(page, 'Listening for you · pause between parts')).toBeVisible();
  await expectParts(page, before + 1);
  await say(page, 3000);
  await expectParts(page, before + 2);
  await button(page, 'Play the Bible').click();
  await button(page, 'Resume recording now').click();
  await expect(text(page, 'Listening for you · pause between parts')).toBeVisible();
  await say(page, 3000);
  await leaveSession(page);
  await expectParts(page, before + 3);
});

test('REC-037 The Bible in the reference pane', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  await needsBible(page);
  await button(page, 'Play the Bible').click();
  await page.waitForTimeout(15_000); // sleep: 15 s of Bible playing, so Back 10 seconds has somewhere to go
  await button(page, 'Back 10 seconds').click();
  await button(page, /^Bible: .*\. Choose another$/).click();
  await expect(text(page, 'Choose a Bible')).toBeVisible();
  await expect(text(page, 'More Bibles')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Verse 25\. / }).first().click();
  await button(page, 'Add a note here').click();
  await page.getByPlaceholder('Or type it').fill('Hard to say \'Lord, open to us\'');
  await button(page, 'Add a note').last().click();
  await expectToast(page, 'Note added.');
  await recordButton(page).click();
  await expect(button(page, 'Add a note here')).toHaveCount(0);
  await leaveSession(page);
  await expect(button(page, 'Add a note here')).toBeVisible();
});

test('REC-038 The reference reaches every chip', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openPassage(page, w, 'P-NEW');
  await expect(primary(page)).toBeVisible();
  const hasStudy = (await pathRows(page)).some((r) => /^\d+\. Study\./.test(r));
  await button(page, 'Versions and history').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(text(page, 'Recording Version 3')).toBeVisible();
  const chips = await page.getByRole('tab').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  const names = chips.map((c) => c.replace(/\s*\d+$/, '').replace(/ · \d+$/, ''));
  expect(names).toEqual(hasStudy ? ['Bible', 'Guide', 'Key words', 'Notes', 'Earlier'] : ['Bible', 'Key words', 'Notes', 'Earlier']);
  if (!hasStudy) test.info().annotations.push({ type: 'precondition', description: 'P-NEW has no FIA study guide in this fixture world (no Study step), so "Guide" is not offered and was not checked.' });
  if (hasStudy) {
    await chip(page, 'Guide').click();
    await expect(button(page, 'Previous step')).toBeVisible();
    await expect(button(page, 'Next step')).toBeVisible();
    await expect(button(page, 'Open the study')).toBeVisible();
  }
  await chip(page, 'Key words').click();
  await expect(text(page, /^No key words in this passage yet\. Add one your team should say the same way every time\.$/).or(button(page, /^Hear /).first())).toBeVisible();
  await chip(page, /^Notes/).click();
  await expect(button(page, 'Add a note')).toBeVisible();
  await chip(page, 'Earlier').click();
  await expect(text(page, 'What changed in Version 2')).toBeVisible();
  await expect(text(page, /Version 2/, false)).toBeVisible();
  await expect(text(page, /Version 1/, false)).toBeVisible();
  // A passage with nothing recorded or reviewed offers no Earlier.
  await back(page).click();
  await back(page).click();
  await back(page).click();
  await openWorkspace(page, w, 'P-Q4', 'Record');
  await expect(chip(page, /^Earlier/)).toHaveCount(0);
});

test('REC-039 Notes from the workspace', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  await chip(page, /^Notes/).click();
  const count = async () => Number(/(\d+)$/.exec((await chip(page, /^Notes/).innerText()).trim())?.[1] ?? 0);
  const n = await count();
  await button(page, 'Add a note').click();
  await page.getByPlaceholder('Or type it').fill('The fig tree means Israel here');
  await button(page, 'Add a note').last().click();
  await expectToast(page, 'Note added.');
  await expect(text(page, 'The fig tree means Israel here', false)).toBeVisible();
  await expect.poll(count).toBe(n + 1);
  await mic(page).mode('tone');
  await recordButton(page).click();
  await expect(button(page, 'Add a note')).toHaveAttribute('aria-disabled', 'true');
  await leaveSession(page);
  await expectUploaded(page, w);
  const notes = (await onServer(w, 'P-Q3')).p.notes.map((x) => x.text);
  expect(notes).toContain('The fig tree means Israel here');
});

test('REC-040 The divider, its five stops and its one-line ends', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  const divider = page.getByRole('slider', { name: 'Divider between reference and your recording' });
  await expect(divider).toHaveAttribute('aria-valuetext', 'Source 50%');
  const dBox = (await divider.boundingBox())!;
  expect(dBox.height, 'the divider\'s touch area').toBeGreaterThanOrEqual(48);
  const drag = async (toY: number) => {
    // The divider glides to a new stop: a press taken mid-glide misses it on a slow machine, so wait for it to rest.
    let lastY = Number.NaN;
    await expect.poll(async () => {
      const y = (await divider.boundingBox())?.y;
      const resting = y === lastY;
      lastY = y ?? Number.NaN;
      return resting;
    }).toBe(true);
    const b = (await divider.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, toY, { steps: 12 });
    await page.mouse.up();
  };
  const viewport = page.viewportSize()!;
  // All the way up: the reference is one line.
  await drag(0);
  await expect(divider).toHaveAttribute('aria-valuetext', 'Reference as one line');
  await expect(button(page, 'Open the reference')).toBeVisible();
  // This passage has Bible audio, so the one line is the Bible player; the hint to drag down is only for a passage without (LAN-81).
  await expect(text(page, 'Drag down for the guide, key words, notes and earlier recordings')).toHaveCount(0);
  await button(page, 'Open the reference').click();
  await expect(divider).toHaveAttribute('aria-valuetext', 'Source 50%');
  // All the way down: the recorder is one line, with its own red button, and no footer.
  const parts = await partCount(page);
  // The last row on screen: a release at the viewport's height is past its edge, and Chromium may not deliver it, which
  // left the drag unfinished and the divider back where it was (CI, 2026-10-24 to 26).
  await drag(viewport.height - 1);
  await expect(divider).toHaveAttribute('aria-valuetext', 'Recorder as one line');
  await expect(text(page, `${parts} parts recorded`)).toBeVisible();
  await expect(publishButton(page)).toHaveCount(0);
  const bar = (await recordButton(page).boundingBox())!;
  expect(Math.round(bar.width)).toBe(56);
  await mic(page).mode('tone');
  await recordButton(page).click();
  await mic(page).speak(true);
  await expect(text(page, 'Recording…')).toBeVisible();
  await page.waitForTimeout(2500); // sleep: N s of speech, the product's own threshold
  await mic(page).speak(false);
  await page.waitForTimeout(2000); // sleep: the quiet that ends a part, the product's own silence threshold
  await leaveSession(page);
  await expect(text(page, `${parts + 1} parts recorded`)).toBeVisible({ timeout: 10_000 });
  await button(page, /^Your recording\. /).click();
  await expect(divider).toHaveAttribute('aria-valuetext', 'Source 50%');
  // Two thirds down: it snaps there, and is where it was when the workspace opens again.
  const room = (await divider.boundingBox())!;
  await drag(room.y + room.height / 2 + viewport.height * 0.12);
  await expect(divider).toHaveAttribute('aria-valuetext', /^(Source 65%|Source 6\d%)$/);
  const at = await divider.getAttribute('aria-valuetext');
  const small = ((await page.getByLabel('Your recording', { exact: true }).first().boundingBox())?.height ?? 999) < 360;
  // A small pane keeps the parts card, closed (LAN-83), where it used to say "drag up to see them".
  if (small) await expect(page.getByRole('button', { name: new RegExp(`^Parts 1–${parts + 1}, ${parts + 1} parts · `) }).locator('visible=true').first()).toBeVisible();
  await back(page).click();
  await startFromRecord(page, 'Continue recording');
  await expect(divider).toHaveAttribute('aria-valuetext', at!);
  await expectUploaded(page, w);
});

// ---- Verse labels on parts (decision 82) --------------------------------------------

test('REC-041 Tap a part\'s space to give it the next verse', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  expect(await partCount(page)).toBeGreaterThanOrEqual(3);
  await expect(verseSpace(page, 1)).toHaveAttribute('aria-label', 'Part 1, no verse yet');
  // A verse is plain to see and easy to change again: no toast (Caleb, 2026-10-16). Undo takes one back.
  await verseSpace(page, 1).click();
  await expect(verseSpace(page, 1)).toHaveAttribute('aria-label', 'Part 1, Verse 22');
  await expect(byId(page, 'toast')).toHaveCount(0);
  await verseSpace(page, 2).click();
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, Verse 23');
  // The label shows at once, but Undo's step is kept once the change is saved: on a slow machine an early Undo took back Part 1's
  // mark instead. Undo names the step it takes back, so wait for it to name Part 2.
  await expect(undoButton(page)).toHaveAttribute('aria-label', /Part 2/);
  await undoButton(page).click();
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, no verse yet');
  await expect(verseSpace(page, 1)).toHaveAttribute('aria-label', 'Part 1, Verse 22');
  await verseSpace(page, 2).click();
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, Verse 23');
  await verseSpace(page, 2).click();
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, Verse 22, same as the part above');
  await expectUploaded(page, w);
  // On the record: a second device reads the same marks.
  const client = await clientAs(w, 'TRANS', 'A');
  const marks = Object.keys((client.getState() as LanguageState).cardVerses[w.passages['P-Q3'].unitId] ?? {}).length;
  expect(marks, 'the marks are on the server').toBeGreaterThanOrEqual(2);
});

test('REC-042 Hold a part to choose its verses, Auto, None or Delete', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  const parts = await draftParts(page);
  await holdPart(page, 3);
  await expect(text(page, 'Part 3')).toBeVisible();
  for (const name of ['Auto', 'None', 'Delete Part 3']) await expect(button(page, name)).toBeVisible();
  // Every tap applies at once, with no toast: each is a verse mark on the record.
  const marks = async () => (await deviceLog(page, w.languages.A.orgId, w.languages.A.languageId)).filter((e) => e.type === 'v1.CardVerseSet');
  const set = async (expected: Record<string, unknown>) => expect.poll(async () => (await marks()).at(-1)?.payload).toMatchObject(expected);
  await page.getByRole('button', { name: /^Verse 25$/ }).click();
  await set({ mark: 'set', from: '13:25', to: '13:25' });
  await page.getByRole('button', { name: /^Verse 26$/ }).click();
  await set({ mark: 'set', from: '13:25', to: '13:26' });
  await button(page, 'Auto').click();
  await set({ mark: 'next' });
  await button(page, 'None').click();
  await set({ mark: 'none' });
  await expect(byId(page, 'toast')).toHaveCount(0);
  await button(page, 'Delete Part 3').click();
  await expectParts(page, parts - 1);
  await undoButton(page).click();
  await expectParts(page, parts);
  await expectUploaded(page, w);
});

test('REC-044 A verse left for later, then tap its place and record', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  const parts = await draftParts(page);
  await holdPart(page, 1);
  await page.getByRole('button', { name: /^Verse 22$/ }).click();
  await page.keyboard.press('Escape');
  await holdPart(page, 2);
  await page.getByRole('button', { name: /^Verse 24$/ }).click();
  await page.keyboard.press('Escape');
  // The verse left out is a place of its own, numbered as the part it will be (LAN-83).
  const place = button(page, 'Record Part 2 here');
  await expect(place).toBeVisible();
  await mic(page).mode('tone');
  await place.click();
  await expect(place).toHaveAttribute('aria-selected', 'true');
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  await say(page, 3000);
  await leaveSession(page);
  await expectParts(page, parts + 1);
  // The new part sits between Part 1 and the old Part 2, as verse 23.
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, Verse 23');
  await expect(verseSpace(page, 3)).toHaveAttribute('aria-label', 'Part 3, Verse 24');
  await expect(button(page, 'Record Part 2 here')).toHaveCount(0);
  // Recording again, with nothing chosen, adds at the end.
  await recordSaid(page, [3000]);
  await expect(verseSpace(page, parts + 2)).toBeVisible();
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, Verse 23');
  await expectUploaded(page, w);
});

// ---- A stopped session ---------------------------------------------------------------

test('REC-053 A stopped session: hear a part, move its edge, drop one, carry on, then Done @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-S', 'Record');
  const m = mic(page);
  await m.mode('tone');
  await m.speak(false);
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  for (const [i, ms] of [3000, 3000, 3000].entries()) {
    await say(page, ms, 0);
    await expectParts(page, i + 1, 10_000);
  }
  // Stopped (LAN-82): the session is open, each part a box on the whole session's waveform.
  await stopRecording(page);
  const part = (n: number) => byId(page, `live-part-${n}`);
  for (const n of [1, 2, 3]) await expect(part(n)).toBeVisible();
  // A tap on a box plays it.
  const two = (await part(2).boundingBox())!;
  await page.mouse.click(two.x + two.width / 2, two.y + 40);
  await expect(text(page, /could not|Something went wrong/)).toHaveCount(0);
  // Part 1's end drags out into the room after it.
  const one = (await part(1).boundingBox())!;
  const y = one.y + one.height / 2;
  await page.mouse.move(one.x + one.width - 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(one.x + one.width - 2 + i * 5, y);
  await page.mouse.up();
  await expect.poll(async () => (await part(1).boundingBox())?.width ?? 0, { message: 'part 1 is longer' }).toBeGreaterThan(one.width + 5);
  // Part 3's ×: it goes, and its place and number stay for what is said next.
  const three = (await part(3).boundingBox())!;
  await page.mouse.click(three.x + three.width - 15, three.y + three.height - 15);
  await expect(part(3)).toHaveCount(0);
  await expect(page.getByLabel(/^Part 3\. /)).toBeVisible();
  // Carrying on fills it.
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  await say(page, 3000, 0);
  await expectParts(page, 3, 10_000);
  // Done keeps the parts as their boxes stand, and only then are they saved.
  await leaveSession(page);
  await expect(page.getByRole('button', { name: /^Parts 1–3, 3 parts · 0:\d\d$/ })).toBeVisible();
  await m.mode('file');
  await expectUploaded(page, w);
});

test('REC-054 Throw away a session: the ✕ asks first, then nothing said in it is kept @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-DRAFT', 'Continue recording');
  const before = await draftParts(page);
  const events = await eventCount(page, w);
  const m = mic(page);
  await m.mode('tone');
  await m.speak(false);
  await recordButton(page).click();
  for (const [i, ms] of [2500, 2500].entries()) {
    await say(page, ms, 0);
    await expectParts(page, before + i + 1, 10_000);
  }
  // The ✕ stops recording and asks, saying what would go.
  await button(page, 'Throw away this recording').click();
  await expect(text(page, 'Throw away this recording?')).toBeVisible();
  await expect(text(page, /^2 parts · \d+:\d\d$/)).toBeVisible();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Record');
  // Cancel keeps the session, stopped, its parts still boxes.
  await button(page, 'Cancel').click();
  await expect(text(page, 'Stopped')).toBeVisible();
  for (const n of [before + 1, before + 2]) await expect(byId(page, `live-part-${n}`)).toBeVisible();
  // Throwing it away keeps nothing said in it: the draft is as it was, and nothing is written.
  await button(page, 'Throw away this recording').click();
  await button(page, 'Throw away').click();
  await expect(text(page, 'Stopped')).toHaveCount(0);
  await expectIdle(page);
  await expect(page.getByRole('button', { name: new RegExp(`^Parts 1–${before}, ${before} parts · `) })).toBeVisible();
  expect(await eventCount(page, w), 'nothing is written').toBe(events);
  await m.mode('file');
});

// ---- Moving parts, recording between them, Undo and Redo (Caleb, 2026-10-16) ----------------

/** Drag a part by its grip until it sits where `to` is now. */
async function dragPart(page: Page, from: number, to: number) {
  const grip = page.getByLabel(`Move Part ${from}`, { exact: true }).locator('visible=true').first();
  const target = page.getByLabel(`Move Part ${to}`, { exact: true }).locator('visible=true').first();
  const a = (await grip.boundingBox())!;
  const b = (await target.boundingBox())!;
  const x = a.x + a.width / 2;
  const dy = b.y - a.y + (to < from ? -8 : 8);
  await page.mouse.move(x, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x, a.y + a.height / 2 + (dy * i) / 12);
  await page.mouse.up();
}

test('REC-055 Drag a part by its grip; it loses its verse, the others keep theirs; Undo and Redo', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  // REC-053 leaves TRANS a draft of P-S with three parts; run alone, this test records them.
  if ((await onServer(w, 'P-S')).drafts.length === 0) {
    await openWorkspace(page, w, 'P-S', 'Record');
    await recordSaid(page, [2000, 2000, 2000]);
  } else {
    await openWorkspace(page, w, 'P-S', 'Continue recording');
  }
  await expect.poll(async () => (await lastComposed(page, w, 'P-S')).length).toBe(3);
  for (const n of [1, 2, 3]) {
    if ((await verseSpace(page, n).getAttribute('aria-label'))?.endsWith('no verse yet')) await verseSpace(page, n).click();
  }
  await expect(verseSpace(page, 3)).toHaveAttribute('aria-label', 'Part 3, Verse 37');
  const order = await lastComposed(page, w, 'P-S');
  await dragPart(page, 3, 1);
  await expect.poll(() => lastComposed(page, w, 'P-S')).toEqual([order[2], order[0], order[1]]);
  await expect(verseSpace(page, 1)).toHaveAttribute('aria-label', 'Part 1, no verse yet');
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, Verse 35');
  await expect(verseSpace(page, 3)).toHaveAttribute('aria-label', 'Part 3, Verse 36');
  await expect(byId(page, 'toast')).toHaveCount(0);
  await undoButton(page).click();
  await expect.poll(() => lastComposed(page, w, 'P-S')).toEqual(order);
  await expect(verseSpace(page, 3)).toHaveAttribute('aria-label', 'Part 3, Verse 37');
  await redoButton(page).click();
  await expect.poll(() => lastComposed(page, w, 'P-S')).toEqual([order[2], order[0], order[1]]);
  await expect(verseSpace(page, 1)).toHaveAttribute('aria-label', 'Part 1, no verse yet');
  await expectUploaded(page, w);
});

test('REC-056 Record between two parts with the mark on the line; Undo takes the whole recording back', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  // REC-055 leaves TRANS a draft of P-S; run alone, this test records one.
  if ((await onServer(w, 'P-S')).drafts.length === 0) {
    await openWorkspace(page, w, 'P-S', 'Record');
    await recordSaid(page, [2000, 2000]);
  } else {
    await openWorkspace(page, w, 'P-S', 'Continue recording');
  }
  await expect.poll(async () => (await lastComposed(page, w, 'P-S')).length).toBeGreaterThanOrEqual(2);
  const before = await lastComposed(page, w, 'P-S');
  await button(page, 'Record a new part before Part 2').click();
  // The line opens: a place numbered as the part will be, chosen.
  await expect(button(page, 'Record Part 2 here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record Part 3 again', exact: true }).locator('visible=true')).toBeVisible();
  // Two parts said into the place: boxed on the waveform as Parts 2 and 3.
  const m = mic(page);
  await m.mode('tone');
  await m.speak(false);
  await recordButton(page).click();
  for (const n of [2, 3]) {
    await say(page, 2000);
    await expect(byId(page, `live-part-${n}`)).toBeVisible({ timeout: 10_000 });
  }
  await stopRecording(page);
  await leaveSession(page);
  await m.mode('file');
  await expect.poll(async () => (await lastComposed(page, w, 'P-S')).length).toBe(before.length + 2);
  const after = await lastComposed(page, w, 'P-S');
  expect(after[0]).toBe(before[0]);
  expect(after.slice(3)).toEqual(before.slice(1));
  // Back from the red view the card is open, with the first part just said in view.
  await expect(button(page, 'Hide the parts')).toBeVisible();
  await expect(verseSpace(page, 2)).toBeInViewport();
  // What was said between them has no verse; the parts around it keep theirs.
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, no verse yet');
  // One Undo takes back the whole recording, however many parts it made.
  await expect(undoButton(page)).toHaveAttribute('aria-label', 'Undo: New recording');
  await undoButton(page).click();
  await expect.poll(() => lastComposed(page, w, 'P-S')).toEqual(before);
  await redoButton(page).click();
  await expect.poll(() => lastComposed(page, w, 'P-S')).toEqual(after);
  await expectUploaded(page, w);
});

// ---- Who may record -----------------------------------------------------------------

/** Back to a screen with the tab bar (each tap goes back one screen). */
async function toTabs(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    // A screen can show both (a pushed page over the tabs on a wide layout): either will do.
    await expect(tab(page, 'map').or(back(page)).first()).toBeVisible();
    if (await tab(page, 'map').isVisible()) break;
    await back(page).click();
  }
  await expect(tab(page, 'map')).toBeVisible();
}

for (const who of ['REV', 'VIEW'] as const) {
  test(`REC-050 Reviewers and viewers are not offered recording (${who})`, async ({ page }) => {
    const w = world();
    await openAs(page, w, who);
    await expect(tab(page, 'map')).toBeVisible({ timeout: 60_000 });
    const never = /^(Record|Continue recording|Record a fix|New version|Edit)$/;
    const offered = () => page.getByRole('button', { name: never }).locator('visible=true').count();
    for (const key of ['P-DRAFT', 'P-NEW'] as const) {
      await openPassage(page, w, key);
      await expect(page.getByRole('heading', { name: w.passages[key].label })).toBeVisible();
      await expect(button(page, 'Versions and history')).toBeVisible();
      expect(await offered(), `${key}: nothing offers recording`).toBe(0);
      await button(page, 'Versions and history').click();
      expect(await offered(), `${key} Versions: nothing offers recording`).toBe(0);
      await back(page).click();
      // The Record step row does nothing, or opens the published version; never the workspace.
      const step = recordStep(page);
      if (await step.count()) await step.click({ force: true }).catch(() => undefined);
      await expect(workspaceSub(page)).toHaveCount(0);
      await expect(text(page, /^Recording Version/)).toHaveCount(0);
      await toTabs(page);
    }
    if (who === 'REV') {
      await tab(page, 'work').click();
      expect(await screenText(page)).not.toMatch(/Record it|Record ·/);
    }
  });
}

test('REC-051 A role changed while the record is open', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TREV');
  await openPassage(page, w, 'P-Q4');
  await expect(primary(page)).toHaveText('Record');
  const org = await clientAs(w, 'COORD', 'org');
  const scope = { level: 'language', languageId: w.languages.A.languageId };
  await org.appendMany([{ id: randomUUID(), type: 'v1.MemberAdded', payload: { profileId: w.accounts.TREV.id, roleId: 'reviewer', scope } }] as never);
  await send(org as never, 'COORD makes TREV a Reviewer');
  try {
    await syncNow(page);
    await expect.poll(async () => {
      await syncNow(page);
      return page.getByRole('button', { name: /^(Record|Continue recording)$/ }).locator('visible=true').count();
    }, { timeout: 60_000, message: 'the record no longer offers recording' }).toBe(0);
    await recordStep(page).click({ force: true }).catch(() => undefined);
    await expect(workspaceSub(page)).toHaveCount(0);
    await expect(text(page, 'This screen could not open')).toHaveCount(0);
  } finally {
    await org.appendMany([{ id: randomUUID(), type: 'v1.MemberAdded', payload: { profileId: w.accounts.TREV.id, roleId: w.roles.translatorReviewer, scope } }] as never);
    await send(org as never, 'COORD gives TREV back the Translator-Reviewer role');
  }
});

test('REC-052 A translator-reviewer records and publishes', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TREV');
  await openWorkspace(page, w, 'P-T', 'Record');
  await expect(text(page, 'Recording Version 1')).toBeVisible();
  await recordSaid(page, [3000, 3000]);
  await publishButton(page).click();
  await expect(primary(page)).toHaveText(/^Ask /);
  await button(page, 'Send later').click();
  await expectToast(page, 'Version 1 published.');
  await expectUploaded(page, w);
  const v = (await onServer(w, 'P-T')).versions;
  expect(v.map((x) => [x.by, x.cardHashes.length])).toEqual([[w.accounts.TREV.id, 2]]);
});
