// 06 · Recording (docs/ui-test-suite/06-recording.md): the recording
// workspace, voice detection, parts, Publish, several drafts, what a
// browser does with a recording when the page goes, and who may record.
// The tests share one fixture world and run in order: REC-011 publishes
// Version 1 of P-NEW and REC-016 Version 2, as the spec's order says. Each
// test opens its own page (a fresh browser profile), so whatever a test
// leaves for the next one is on the server before it ends (expectUploaded).
//
// The microphone is smart-tests/fixtures/voice-mic.wav (a part about every
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
  chip, deletePart, deviceLog, expectIdle, expectUploaded, expectParts, holdPart, installMicControl, lastComposed, mic, openWorkspace, draftParts, partCount, partsTitle,
  publishButton, recordButton, recordSaid, recordStep, saveButton, say, secondDevice, startFromRecord, verseSpace, workspaceSub,
  useFileWorld
} from './06-recording-helpers';
import { clientAs, send } from './fixture';
import {
  back, button, byId, expect, expectNothingRefused, expectSyncIdle, expectToast, openAs, openPassage, primary, screenText, syncNow, tab, test, text, undoToast, waitForApp,
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
  await expect(saveButton(page)).toBeVisible();
  // The divider at half: the reference on top, the recorder below.
  const divider = page.getByRole('slider', { name: 'Divider between reference and your recording' });
  await expect(divider).toHaveAttribute('aria-valuetext', 'Source 50%');
  // The chips: Bible (selected), Key words, Notes; no Earlier yet.
  for (const c of ['Bible', 'Key words', 'Notes']) await expect(chip(page, new RegExp(`^${c}`))).toBeVisible();
  await expect(chip(page, /^Earlier/)).toHaveCount(0);
  await expect(chip(page, /^Bible/)).toHaveAttribute('aria-selected', 'true');
  // The recorder: Part 1 lit, the hint, the quiet microphone link.
  await expect(page.getByLabel('Part 1. Recording next')).toBeVisible();
  await expect(text(page, 'Tap the red button and speak. Pause between parts: each part is kept by itself.')).toBeVisible();
  await expect(button(page, 'Set up the microphone')).toBeVisible();
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
  await expect(text(page, 'Part 1…')).toBeVisible();
  await expect(text(page, 'Listening for you · pause between parts')).toBeVisible();
  await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  for (const [i, ms] of [4000, 4000, 3000].entries()) {
    await m.speak(true);
    await expect(text(page, 'Recording…')).toBeVisible();
    await page.waitForTimeout(ms); // sleep: N s of speech, the product's own threshold
    await m.speak(false);
    // Within 2 seconds of the pause the card counts it, and the next part is lit.
    await expectParts(page, i + 1, 3_000);
    await expect(page.getByLabel(new RegExp(`^Part ${i + 2}\\. `))).toBeVisible();
    await expect(text(page, 'Listening for you · pause between parts')).toBeVisible();
  }
  await recordButton(page).click();
  await expectIdle(page);
  await expect(page.getByRole('button', { name: /^Parts 1–3, 3 parts · 0:1\d$/ })).toBeVisible();
  await expect(page.getByLabel('Part 4. Recording next')).toBeVisible();
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(saveButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  // No part is shorter than a second, and none is empty.
  const lengths = await page.getByRole('button', { name: /^Play Part \d$/ }).evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  expect(lengths).toHaveLength(3);
  for (const l of lengths) expect(l).toMatch(/0:0[3-5]/);
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

test('REC-007 Delete a part, then Undo @p0', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Continue recording');
  await expectParts(page, 3);
  const before = await lastComposed(page, w, 'P-NEW');
  const original = before.length === 3 ? before : (await onServer(w, 'P-NEW')).drafts[0]!.cardHashes;
  await deletePart(page, 2);
  const toast = await expectToast(page, 'Part 2 deleted.');
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Parts 1–2, 2 parts · / })).toBeVisible();
  await expect.poll(() => lastComposed(page, w, 'P-NEW')).toEqual([original[0], original[2]]);
  // The toast stays for 7 seconds; Undo inside them.
  await page.waitForTimeout(4000); // sleep: the toast's own 7 s life; Undo must still work 4 s in
  await expect(toast).toBeVisible();
  await undoToast(page);
  await expectToast(page, 'Undone.');
  await expectParts(page, 3);
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
  for (const n of [1, 2, 3]) {
    await expect(verseSpace(page, n)).toHaveAttribute('aria-disabled', 'true');
    await expect(button(page, `Play Part ${n}`)).toHaveAttribute('aria-disabled', 'true');
  }
  await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  // A hold on the space does nothing: no sheet, no toast.
  const box = (await verseSpace(page, 1).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(700); /* sleep: the long-press threshold, the product's own */ await page.mouse.up();
  await button(page, 'Play Part 1').click({ force: true });
  await expect(page.getByRole('button', { name: 'Delete Part 1', exact: true })).toHaveCount(0);
  await expect(byId(page, 'toast')).toHaveCount(0);
  await recordButton(page).click();
  await expectIdle(page);
  await m.mode('file');
  for (const n of [1, 2, 3]) await expect(verseSpace(page, n)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(saveButton(page)).not.toHaveAttribute('aria-disabled', 'true');
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
  await expectToast(page, 'Part 1 deleted.');
  await expectParts(page, 0);
  await expect(page.getByLabel('Part 1. Recording next')).toBeVisible();
  await expect(text(page, 'Tap the red button and speak. Pause between parts: each part is kept by itself.')).toBeVisible();
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  await undoToast(page);
  await expectToast(page, 'Undone.');
  await expectParts(page, 1);
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expectUploaded(page, w);
  await expect.poll(async () => (await onServer(w, 'P-Q2')).drafts.map((d) => d.cardHashes.length), { timeout: 30_000 }).toEqual([1]);
});

test('REC-010 Save keeps the draft and goes back', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Continue recording');
  await expectParts(page, 3);
  await saveButton(page).click();
  await expectToast(page, 'Draft saved.');
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
 * REC-011 ends on the published page and REC-012 starts there: the two share
 * one browser, kept open between them.
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

test('REC-011 Publish Version 1 @p0', async ({ browser }) => {
  const w = world();
  const page = await keptPage(browser);
  const label = w.passages['P-NEW'].label;
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-NEW', 'Continue recording');
  await expectParts(page, 3);
  await publishButton(page).click();
  // The Publish screen, inside the workspace.
  await expect(page.getByRole('heading', { name: label })).toBeVisible();
  await expect(text(page, 'Publish')).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(text(page, 'Version 1')).toBeVisible();
  await expect(text(page, /^3 parts · 0:1\d( · recorded with the \S+ Bible)?$/)).toBeVisible();
  const row = button(page, 'Say something about it. Optional · the team hears it with this version');
  await expect(row).toBeVisible();
  await expect(text(page, 'Publishing saves Version 1 to the passage. Everyone on the team can hear it. It goes out when the device has internet.')).toBeVisible();
  await expect(primary(page)).toHaveText('Publish Version 1');
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  await expectToast(page, 'Version 1 published.');
  await expect(byId(page, 'toast-undo')).toHaveCount(0);
  // The published page: what was done, then the next check and who usually does it.
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toBeVisible();
  await expect(text(page, `${label} · sent to the team`)).toBeVisible();
  await expect(text(page, 'Next, ask for a check')).toBeVisible();
  await expect(text(page, 'Peer check')).toBeVisible();
  await expect(text(page, /Trevor Both|Rita Reviewer/)).toBeVisible();
  await expect(primary(page)).toHaveText(/^Ask /);
  await expect(button(page, 'Someone else')).toBeVisible();
  await expect(button(page, 'Not now')).toBeVisible();
  await expectUploaded(page, w);
  // On the server: no draft, Version 1 by TRANS with three parts.
  await expect.poll(async () => { const s = await onServer(w, 'P-NEW'); return [s.drafts.length, s.versions.map((v) => v.cardHashes.length)]; }, { timeout: 30_000 })
    .toEqual([0, [3]]);
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

test('REC-012 After publishing, ask for the check or not now', async ({ browser }) => {
  const w = world();
  const page = await keptPage(browser);
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toBeVisible();
  const target = (await primary(page).innerText()).trim().replace(/^Ask /, '');
  const before = await eventCount(page, w);
  await button(page, 'Not now').click();
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toHaveCount(0);
  await expect(primary(page)).toHaveText('Ask for the peer check');
  expect(await eventCount(page, w), '"Not now" writes nothing').toBe(before);
  // Afterwards the record's steps read the version and when it was published.
  const rows = await pathRows(page);
  expect(rows.join('\n')).toMatch(/Version 1 · 0:1\d/);
  // Known issue (2026-10-12): the step reads "Published Just now" (pathModel.ts puts `when()`'s sentence-start form mid-sentence).
  expect.soft(rows.join('\n')).toMatch(/Published just now/);
  await primary(page).click();
  await expect(page.getByRole('heading', { name: 'Ask for a check' })).toBeVisible();
  await expect(text(page, w.passages['P-NEW'].label)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toHaveCount(0);
  await primary(page).click();
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expectToast(page, new RegExp(`^Sent to ${escaped} — (anyone on it|they) will see it on My Work`));
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await expect.poll(async () => (await pathRows(page)).join('\n')).toMatch(/asked /);
  await expectUploaded(page, w);
  // REV finds P-NEW's Peer check on My Work.
  const rev = await secondDevice(browser, w, 'REV');
  try {
    await expect(text(rev.page, w.passages['P-NEW'].label, false)).toBeVisible({ timeout: 30_000 });
  } finally { await rev.context.close(); }
});

test('REC-013 Publish\'s ✕ returns to the workspace and keeps everything', async ({ page }) => {
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
  await publishButton(page).click();
  await expect(button(page, /^Say something about it\. /)).toBeVisible();
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
  await primary(page).click();
  await expectToast(page, 'Version 1 published.');
  await expectUploaded(page, w);
  const v = (await onServer(w, 'P-Q2')).versions;
  expect(v).toHaveLength(1);
  expect(v[0]!.changeBlobHash, 'the voice note goes with Version 1').toBeTruthy();
  // The record's Versions and history plays the version with its note.
  await button(page, 'Not now').click();
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
  await expect(field).toHaveValue(/^At 0:0[4-6]: $/);
  await field.press('End');
  await field.pressSequentially('verse 24 needs a slower pace');
  await button(page, 'Done').click();
  await expect(button(page, /^What you said about it\. “At 0:0[4-6]: verse 24 needs a slower pace”$/)).toBeVisible();
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
  await expect(text(page, 'These are Version 1\'s parts. Record a new part or delete one to publish a new version.')).toBeVisible();
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  await recordSaid(page, [3000]);
  await expect(text(page, 'These are Version 1\'s parts. Record a new part or delete one to publish a new version.')).toHaveCount(0);
  await expectParts(page, 4);
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await publishButton(page).click();
  await expect(button(page, 'Say what changed. Needed · since Version 1, so the team knows what to listen for')).toBeVisible();
  await expect(primary(page)).toHaveText('Publish Version 2');
  await expect(primary(page)).toBeDisabled();
  await button(page, /^Say what changed\. /).click();
  await expect(text(page, 'What changed?')).toBeVisible();
  await expect(text(page, 'Since Version 1. The team hears it with this version.')).toBeVisible();
  await expect(button(page, 'Say what changed')).toBeVisible();
  await page.getByPlaceholder('Or type it').fill('Added verse 9 again, slower');
  await button(page, 'Done').click();
  await expect(button(page, 'What changed. “Added verse 9 again, slower”')).toBeVisible();
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  await expectToast(page, 'Version 2 published.');
  await expect(page.getByRole('heading', { name: 'Version 2 published' })).toBeVisible();
  await expectUploaded(page, w);
  await button(page, 'Not now').click();
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
  await primary(page).click();
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
  await expectToast(page, 'Part 2 deleted.');
  await expect(publishButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await saveButton(page).click();
  await expectToast(page, 'Draft saved.');
  // Save goes back to where the workspace was opened from: the Versions page.
  await expect(text(page, 'Your draft')).toBeVisible();
  await expectUploaded(page, w);
  const s = await onServer(w, 'P-Q2');
  expect(s.versions[1]!.cardHashes, 'Version 2 keeps all its parts').toEqual(v2);
  expect(s.drafts.map((d) => d.cardHashes)).toEqual([[v2[0]]]);
  await expect(text(page, /^1 part · 0:0\d$/)).toBeVisible();
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
  await saveButton(page).click();
  await expectToast(page, 'Draft 2 saved.');
  // Save went back to the Versions page it was opened from, which lists both drafts.
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
  await button(page, 'Delete Draft 2').click();
  await expectToast(page, 'Draft 2 deleted.');
  await expect(button(page, 'Delete Draft 2')).toHaveCount(0);
  await undoToast(page);
  await expect(button(page, 'Delete Draft 2')).toBeVisible();
  await expectUploaded(page, w);
  await expect.poll(async () => (await onServer(w, 'P-Q2')).drafts.map((d) => d.cardHashes), { timeout: 30_000 }).toEqual(before);
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
  // Close the tab while the voice file speaks (it plays on its own clock: wait for speech).
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  await expect(text(page, 'Recording…')).toBeVisible({ timeout: 8_000 });
  // A reload while speaking (Playwright's page.close with beforeunload leaves the page unable to navigate after a cancel).
  await page.evaluate(() => { window.location.reload(); });
  await expect.poll(() => dialogs).toEqual(['beforeunload']);
  // Cancelled: the page stays and recording goes on; the part ends at the pause.
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  await expectParts(page, before + 1, 8_000);
  await recordButton(page).click();
  await expectIdle(page);
  // Idle, with nothing left to send (else the leave guard asks, storageGate.tsx), a reload asks nothing.
  await expectUploaded(page, w);
  // Until the upload count catches up the leave guard is still on; then nothing holds the page.
  await expect.poll(() => page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), { timeout: 20_000, message: 'nothing asks before leaving' }).toBe(true);
  await page.reload();
  await waitForApp(page);
  expect(dialogs).toEqual(['beforeunload']);
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  await expectParts(page, before + 1);
  // The tab killed outright in the middle of a session (no question asked):
  // every part that ended and was stored in the browser before it went is
  // there when LangQuest opens again in the same browser (recordingJournal.ts).
  await recordButton(page).click();
  await expectParts(page, before + 2, 8_000);
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
  if (label === 'Stop recording') { await recordButton(page).click(); await expectIdle(page); }
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
  // Opened online once, so the passage is on the device.
  await openWorkspace(page, w, 'P-Q1', 'Continue recording');
  await expectParts(page, 2);
  await context.setOffline(true);
  await recordSaid(page, [3000, 3000]);
  await expectParts(page, 4);
  await deletePart(page, 3);
  await expectToast(page, 'Part 3 deleted.');
  await undoToast(page);
  await expectToast(page, 'Undone.');
  await expectParts(page, 4);
  await publishButton(page).click();
  await primary(page).click();
  await expectToast(page, 'Version 1 published.');
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toBeVisible();
  await expect(text(page, `${label} · saved on this device · sends when you're online`)).toBeVisible();
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
  await recordButton(page).click();
  await expectIdle(page);
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
  await button(page, 'Save note').click();
  await expectToast(page, 'Note added.');
  await recordButton(page).click();
  await expect(button(page, 'Add a note here')).toHaveCount(0);
  await recordButton(page).click();
  await expectIdle(page);
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
  await button(page, 'Save note').click();
  await expectToast(page, 'Note added.');
  await expect(text(page, 'The fig tree means Israel here', false)).toBeVisible();
  await expect.poll(count).toBe(n + 1);
  await mic(page).mode('tone');
  await recordButton(page).click();
  await expect(button(page, 'Add a note')).toHaveAttribute('aria-disabled', 'true');
  await recordButton(page).click();
  await expectIdle(page);
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
  await expect(text(page, 'Drag down for the guide, key words, notes and earlier recordings')).toBeVisible();
  await button(page, 'Open the reference').click();
  await expect(divider).toHaveAttribute('aria-valuetext', 'Source 50%');
  // All the way down: the recorder is one line, with its own red button, and no footer.
  const parts = await partCount(page);
  await drag(viewport.height);
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
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Record');
  await expect(text(page, `${parts + 1} parts recorded`)).toBeVisible({ timeout: 10_000 });
  await button(page, /^Your recording\. /).click();
  await expect(divider).toHaveAttribute('aria-valuetext', 'Source 50%');
  // Two thirds down: it snaps there, and is where it was when the workspace opens again.
  const room = (await divider.boundingBox())!;
  await drag(room.y + room.height / 2 + viewport.height * 0.12);
  await expect(divider).toHaveAttribute('aria-valuetext', /^(Source 65%|Source 6\d%)$/);
  const at = await divider.getAttribute('aria-valuetext');
  const small = ((await page.getByLabel('Your recording', { exact: true }).first().boundingBox())?.height ?? 999) < 360;
  if (small) await expect(text(page, new RegExp(`^Parts 1–${parts + 1} recorded · drag up to see them$`))).toBeVisible();
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
  await verseSpace(page, 1).click();
  await expectToast(page, 'Part 1 is verse 22.');
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await expect(verseSpace(page, 1)).toHaveAttribute('aria-label', 'Part 1, Verse 22');
  await verseSpace(page, 2).click();
  await expectToast(page, 'Part 2 is verse 23.');
  await undoToast(page);
  await expectToast(page, 'Undone.');
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, no verse yet');
  await verseSpace(page, 2).click();
  await expectToast(page, 'Part 2 is verse 23.');
  await verseSpace(page, 2).click();
  await expectToast(page, 'Part 2 is more of verse 22.');
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
  await page.getByRole('button', { name: /^Verse 25$/ }).click();
  await expectToast(page, 'Part 3 is verse 25.');
  await page.getByRole('button', { name: /^Verse 26$/ }).click();
  await expectToast(page, 'Part 3 is verses 25–26.');
  await button(page, 'Auto').click();
  await expectToast(page, 'Part 3 follows the order.');
  await button(page, 'None').click();
  await expectToast(page, 'Part 3 has no verse.');
  await button(page, 'Delete Part 3').click();
  await expectToast(page, 'Part 3 deleted.');
  await expectParts(page, parts - 1);
  await undoToast(page);
  await expectParts(page, parts);
  await expectUploaded(page, w);
});

test('REC-044 A verse left for later, then Record here', async ({ page }) => {
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
  await expect(text(page, 'Verse 23 · left for later')).toBeVisible();
  await mic(page).mode('tone');
  await button(page, 'Record here').click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  await say(page, 3000);
  await expectParts(page, parts + 1);
  await recordButton(page).click();
  await expectIdle(page);
  // The new part sits between Part 1 and the old Part 2, as verse 23.
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, Verse 23');
  await expect(verseSpace(page, 3)).toHaveAttribute('aria-label', 'Part 3, Verse 24');
  await expect(text(page, 'Verse 23 · left for later')).toHaveCount(0);
  // Recording again without Record here adds at the end.
  await recordSaid(page, [3000]);
  await expect(verseSpace(page, parts + 2)).toBeVisible();
  await expect(verseSpace(page, 2)).toHaveAttribute('aria-label', 'Part 2, Verse 23');
  await expectUploaded(page, w);
});

// ---- Microphone setup ---------------------------------------------------------------

/** The microphone settings kept on this device (AsyncStorage on the web is localStorage). */
const micStored = (page: Page) => page.evaluate(() => localStorage.getItem('mic-setup:v1'));

/** One try on "Try N of 3": tap, say the sentence twice with a pause, tap to stop. */
async function sayTry(page: Page, n: number): Promise<void> {
  await expect(text(page, `Try ${n} of 3`)).toBeVisible();
  await recordButton(page).click();
  await expect(text(page, /^Listening… 0:0\d$/)).toBeVisible();
  await say(page, 1500, 1800);
  await say(page, 1500, 1800);
  await recordButton(page).click();
}

test('REC-045 Set up the microphone by ear', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  await mic(page).mode('tone');
  await button(page, 'Set up the microphone').click();
  await expect(text(page, 'Set up your microphone')).toBeVisible();
  await expect(text(page, 'Takes about a minute')).toBeVisible();
  await expect(text(page, 'First, the room')).toBeVisible();
  await expect(text(page, 'First, a few seconds of quiet')).toBeVisible();
  await expect(text(page, 'Go where you usually record. Stay quiet while the device listens to the room.')).toBeVisible();
  await expect(text(page, 'Tap to start')).toBeVisible();
  await expect(text(page, 'Then you\'ll say one sentence three times.')).toBeVisible();
  await expect(button(page, 'Adjust by hand')).toBeVisible();
  expect(Math.round((await recordButton(page).boundingBox())!.width)).toBe(120);
  await recordButton(page).click();
  await expect(text(page, /^Listening to the room… 0:0[0-3]$/)).toBeVisible();
  for (const n of [1, 2, 3]) {
    await expect(text(page, `Try ${n} of 3`)).toBeVisible({ timeout: 10_000 });
    await expect(text(page, 'Say this, then pause, then say it again')).toBeVisible();
    await expect(text(page, '“The shepherd went to look for the lost sheep.”')).toBeVisible();
    await expect(button(page, 'Hear it')).toBeVisible();
    await sayTry(page, n);
  }
  await expect(text(page, 'Which sounds best?')).toBeVisible();
  await expect(text(page, 'Listen to each. Pick the one where every word is clear and nothing is cut off.')).toBeVisible();
  for (const id of ['A', 'B', 'C']) {
    await expect(page.getByRole('radio', { name: new RegExp(`^Try ${id}, 0:0\\d$`) })).toBeVisible();
    await expect(button(page, `Play Try ${id}`)).toBeVisible();
  }
  await expect(page.getByRole('radio', { name: /^Try B,/ })).toHaveAttribute('aria-checked', 'true');
  await button(page, 'Play Try A').click();
  await page.getByRole('radio', { name: /^Try A,/ }).click();
  await expect(primary(page)).toHaveText('Use Try A');
  await primary(page).click();
  await expectToast(page, 'Microphone set up. Recording now uses Try A.');
  await expect(workspaceSub(page)).toBeVisible();
  expect(JSON.parse((await micStored(page))!)).toMatchObject({ pauseMs: 700 });
  // A pause of about 0.9 s now ends a part (Try A's 0.7 s; the default 1 s would not).
  const before = await draftParts(page);
  await recordButton(page).click();
  await say(page, 1500, 900);
  await say(page, 1500, 2000);
  await recordButton(page).click();
  await expectIdle(page);
  await expectParts(page, before + 2);
  // Kept on this device after the app starts again.
  await page.reload();
  await waitForApp(page);
  expect(JSON.parse((await micStored(page))!)).toMatchObject({ pauseMs: 700 });
  await expectUploaded(page, w);
});

test('REC-046 Microphone setup when nothing is heard, or every try sounds bad', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await mic(page).mode('tone');
  const saved = await micStored(page);
  await tab(page, 'me').click();
  await button(page, /^Set up the microphone/).click();
  await recordButton(page).click();
  await expect(text(page, 'Try 1 of 3')).toBeVisible({ timeout: 10_000 });
  // A silent try does not count.
  await recordButton(page).click();
  await page.waitForTimeout(2000); // sleep: seconds of silence, the product's own threshold for a try
  await recordButton(page).click();
  await expect(text(page, 'Nothing was heard. Say it a little louder, or hold the device closer.')).toBeVisible();
  await expect(text(page, 'Try 1 of 3')).toBeVisible();
  for (const n of [1, 2, 3]) await sayTry(page, n);
  await button(page, 'They all sound bad. Try again somewhere quieter.').click();
  await expect(text(page, 'First, the room')).toBeVisible();
  await back(page).click();
  await expect(tab(page, 'me')).toBeVisible();
  expect(await micStored(page), 'the saved settings are unchanged').toBe(saved);
});

test('REC-047 Adjust the microphone by hand', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await mic(page).mode('tone');
  await tab(page, 'me').click();
  await button(page, /^Set up the microphone/).click();
  await button(page, 'Adjust by hand').click();
  await expect(text(page, 'Speak, and watch the bars. Drag the line so your voice goes above it and the room\'s noise stays below.')).toBeVisible();
  const line = page.getByRole('slider', { name: 'Sensitivity line' });
  await expect(line).toHaveAttribute('aria-valuemin', '4');
  await expect(line).toHaveAttribute('aria-valuemax', '92');
  for (const p of ['Short pause', 'Normal pause', 'Long pause']) await expect(page.getByRole('radio', { name: p })).toBeVisible();
  await page.getByRole('radio', { name: 'Long pause' }).click();
  // The device cannot store the settings: the screen says so and stays.
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    (window as unknown as { __realSetItem: typeof real }).__realSetItem = real;
    Storage.prototype.setItem = function (k: string, v: string) { if (k === 'mic-setup:v1') throw new Error('QuotaExceededError'); return real.call(this, k, v); };
  });
  await primary(page).click();
  await expectToast(page, 'Not saved on this device. Try again.');
  await expect(text(page, 'Adjust by hand')).toBeVisible();
  await page.evaluate(() => { Storage.prototype.setItem = (window as unknown as { __realSetItem: Storage['setItem'] }).__realSetItem; });
  await primary(page).click();
  await expectToast(page, 'Microphone settings saved on this device.');
  await expect(tab(page, 'me')).toBeVisible();
  expect(JSON.parse((await micStored(page))!)).toMatchObject({ pauseMs: 2000 });
  // A 1.5-second pause no longer ends a part.
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  const before = await draftParts(page);
  await recordButton(page).click();
  await say(page, 1500, 1500);
  await say(page, 1500, 2600);
  await recordButton(page).click();
  await expectIdle(page);
  await expectParts(page, before + 1);
  await expectUploaded(page, w);
});

test('REC-049 Very short parts suggest setting up the microphone', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'TRANS');
  await openWorkspace(page, w, 'P-Q3', 'Continue recording');
  const before = await draftParts(page);
  await mic(page).mode('tone');
  await recordButton(page).click();
  for (const _ of [1, 2, 3]) await say(page, 350, 2000);
  await recordButton(page).click();
  await expectIdle(page);
  await expectParts(page, before + 3);
  await expect(text(page, 'Parts are coming out very short. Words may be cut off.')).toBeVisible();
  // The quiet link gives way to the box's button.
  await expect(page.getByRole('button', { name: 'Set up the microphone' })).toHaveCount(1);
  await button(page, 'Set up the microphone').click();
  await expect(text(page, 'Set up your microphone')).toBeVisible();
  await back(page).click();
  await expect(workspaceSub(page)).toBeVisible();
  await expectParts(page, before + 3);
  await expectUploaded(page, w);
});

// ---- Who may record -----------------------------------------------------------------

/** Back to a screen with the tab bar (each tap goes back one screen). */
async function toTabs(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await expect(tab(page, 'map').or(back(page))).toBeVisible();
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
  await expect(primary(page)).toHaveText('Publish Version 1');
  await primary(page).click();
  await expectToast(page, 'Version 1 published.');
  await expect(page.getByRole('heading', { name: 'Version 1 published' })).toBeVisible();
  await expect(primary(page)).toHaveText(/^Ask /);
  await expectUploaded(page, w);
  const v = (await onServer(w, 'P-T')).versions;
  expect(v.map((x) => [x.by, x.cardHashes.length])).toEqual([[w.accounts.TREV.id, 2]]);
});
