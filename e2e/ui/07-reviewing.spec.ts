// 07 · Reviewing (docs/ui-test-suite/07-reviewing.md): Review it (Listen,
// Questions, Decide, What should change?), back translation, and the
// translator answering feedback. One world for the file; tests run in ID
// order, and each brings the passages it uses to the state its
// Preconditions name, through the real server as the person who would.
//
// Passages here (the world's own; other files have theirs):
// - P-SUBMITTED: REV-001 to 003 (looks good), then Version 2 for REV-011's Background.
// - P-Q1: Version 1 (REV-004/005 needs changes), kept in REV-043/044, fixed in REV-048.
// - P-Q2: Versions 1 and 2 (2 said by voice): REV-006 needs changes, REV-042 fix (Version 3), REV-045 keep.
// - P-Q3: Version 1: REV-007 needs changes with a retelling; back translation REV-034 to 039; REV-046.
// - P-NEW: Versions 1 and 2 (2 typed "Added verse 9 again, slower"): REV-008, REV-010, REV-024 (nothing sent).
// - P-ASIDE: REV-009 (who is listening, looks good).
// - P-S: Versions 1 and 2 (2 said by voice): REV-010, then REV-022 offline.
// - P-CHECK: questions REV-012 to 018; REV-017 saves the consultant check.
// - P-Q4: asked of REV before any version (REV-021). P-T: TREV's own (REV-030). P-BT: REV-031/032. P-NEEDS: REV-029, REV-040/041.
// - P-DRAFT: published and asked of REV in REV-049, which approves and takes it back three ways.
import type { Page } from '@playwright/test';
import {
  back, button, byId, deviceEvents, expect, expectNothingRefused, expectSent, field, primary,
  screenText, tab, test, text, undoToast
} from './support';
import { deletePart, publishButton, recordButton, recordParts } from './06-recording-helpers';
import {
  act, ask, device, doCheck, langAs, offerExampleGuides, open, openLabel, openRecord, passageNow, publishVersion, reviewLatest, sawToast, toTabs, unitByLabel,
  recordedFor, useRunWorld, visible
} from './reviewing-helpers';
import { clientAs, send } from './fixture';
import { commands } from '@langquest-next/core';
import { randomUUID } from 'node:crypto';
import { openSyncDetails } from './sync-helpers';
import { closeSheet, openTeamRow, sheet } from './05-passage-helpers';

// One world for the run, kept when a failed test restarts the worker (reviewing-helpers.ts useRunWorld).
const world = useRunWorld('07-reviewing', async (w) => {
  await publishVersion(w, 'TRANS', 'P-Q1');
  await publishVersion(w, 'TRANS', 'P-Q2');
  await publishVersion(w, 'TRANS', 'P-Q2', { parts: 1, voiceNote: true });
  await publishVersion(w, 'TRANS', 'P-Q3');
  await publishVersion(w, 'TRANS', 'P-NEW');
  await publishVersion(w, 'TRANS', 'P-NEW', { parts: 1, note: 'Added verse 9 again, slower' });
  await publishVersion(w, 'TRANS', 'P-S');
  await publishVersion(w, 'TRANS', 'P-S', { parts: 1, voiceNote: true });
  await publishVersion(w, 'TREV', 'P-T');
  await ask(w, 'COORD', 'P-T', { kindId: 'peer', profile: 'TREV' });
  await ask(w, 'COORD', 'P-Q4', { kindId: 'peer', profile: 'REV' });
});

const TOM = 'Tom Translator';
const JOHN = 'John 3:9–21';
const TOM_FIRST = 'Tom';
const RITA = 'Rita Reviewer';
const label = (k: Parameters<typeof openRecord>[2]) => world().passages[k].label;

/** Open a passage as `who` and start its check from the record's main button. */
async function startCheck(page: Page, key: Parameters<typeof openRecord>[2], check = 'peer'): Promise<void> {
  await openRecord(page, world(), key);
  await doCheck(page, check).click();
  await expect(text(page, 'Listen')).toBeVisible();
  // A fresh device names people once their profiles arrive ("Amber Square" until then); the toasts name them.
  await expect(text(page, /^Version \d+ · recorded by (you|Tom|Trevor)$/)).toBeVisible();
}

/** Tap a big microphone, let the file voice speak, then stop. */
async function speakInto(page: Page, mic: string, ms = 3500): Promise<void> {
  await button(page, mic).click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  await recordedFor(page, Math.ceil(ms / 1000));
  await button(page, 'Stop recording').click();
}

const eventCount = async (page: Page) => (await deviceEvents(page, world().languages.A.orgId, world().languages.A.languageId)).length;

// ---- Review it: Listen -------------------------------------------------------------------

test('REV-001 "Do the peer check" opens Review it on Listen', async ({ page }) => {
  await open(page, world(), 'REV');
  await openRecord(page, world(), 'P-SUBMITTED');
  // Decision 91: "check" is the one word for a review stage on every screen.
  await expect(primary(page)).toHaveText(/^Do the peer check$/);
  const before = await eventCount(page);
  await doCheck(page, 'peer').click();
  await expect(text(page, label('P-SUBMITTED'))).toBeVisible();
  await expect(text(page, 'Peer check')).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(button(page, 'Listen, step 1 of 2')).toBeVisible();
  await expect(button(page, 'Decide, step 2 of 2')).toBeVisible();
  await expect(button(page, /^Questions/)).toHaveCount(0);
  await expect(text(page, `Version 1 · recorded by ${TOM_FIRST}`)).toBeVisible();
  await expect(text(page, 'Listen to all of it first')).toBeVisible();
  await expect(button(page, 'Back 10 seconds')).toBeVisible();
  await expect(button(page, 'Add a note at this moment')).toBeVisible();
  await expect(button(page, /^Background/)).toBeVisible();
  await expect(text(page, /^The passage/)).toBeVisible();
  await expect(button(page, 'Who is listening?, optional')).toBeVisible();
  await expect(primary(page)).toHaveText('Next: decide');
  expect(await eventCount(page)).toBe(before);
});

test('REV-002 My Work\'s check row opens the same screen', async ({ page }) => {
  await open(page, world(), 'REV');
  await expect(text(page, 'Next for you')).toBeVisible();
  await visible(page.getByText(`Check ${label('P-SUBMITTED')}`, { exact: true })).first().click();
  await expect(text(page, `Version 1 · recorded by ${TOM_FIRST}`)).toBeVisible();
  await expect(button(page, 'Listen, step 1 of 2')).toBeVisible();
  await byId(page, 'header-close').click();
  await expect(text(page, 'Next for you')).toBeVisible();
  await expect(tab(page, 'work')).toBeVisible();
});

test('REV-003 Looks good @p0', async ({ page, browser }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-SUBMITTED');
  await primary(page).click();
  await expect(text(page, 'Is it accurate and natural?')).toBeVisible();
  await expect(button(page, 'Looks good')).toBeVisible();
  await expect(button(page, 'Needs changes')).toBeVisible();
  await expect(button(page, `Say something about it, ${TOM_FIRST} hears it with your answer, optional`)).toBeVisible();
  await expect(button(page, 'Listen, done. Go back')).toBeVisible();
  await button(page, 'Looks good').click();
  await sawToast(page, `Looks good · sent to ${TOM}`);
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await expect(button(page, 'Versions and history')).toBeVisible();
  expect(await screenText(page)).toMatch(/Peer check\s+looks good/);
  await expectSent(page, world());
  await expectNothingRefused(page, world());
  // The request is done: the passage leaves REV's My Work.
  await toTabs(page);
  await tab(page, 'work').click();
  await expect(text(page, `Check ${label('P-SUBMITTED')}`)).toHaveCount(0);
  // TRANS on a second device sees it on the record.
  const trans = await device(browser, world(), 'TRANS');
  await openRecord(trans.page, world(), 'P-SUBMITTED');
  await expect.poll(async () => screenText(trans.page)).toMatch(/Peer check\s+looks good/);
  await trans.context.close();
});

test('REV-004 A note at a moment while listening', async ({ page }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-Q1');
  await button(page, 'Add a note at this moment').click();
  await expect(text(page, 'A note at 0:00')).toBeVisible();
  await expect(text(page, `Say what you noticed here. ${TOM_FIRST} hears it with your review.`)).toBeVisible();
  await speakInto(page, 'Tap and speak');
  await expect(text(page, 'Your note at 0:00')).toBeVisible();
  await expect(text(page, /^0:0\d · goes with your review$/)).toBeVisible();
  await expect(button(page, /^Play Play your note at 0:00|^Play your note at 0:00/)).toBeVisible();
  await button(page, 'Remove your note at 0:00').click();
  await expect(text(page, 'Your note at 0:00')).toHaveCount(0);
  await expect(byId(page, 'toast')).toHaveCount(0);
  await button(page, 'Add a note at this moment').click();
  await speakInto(page, 'Tap and speak');
  await expect(text(page, 'Your note at 0:00')).toBeVisible();
});

test('REV-005 Needs changes, said and typed @p0', async ({ page, browser }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-Q1');
  await button(page, 'Add a note at this moment').click();
  await speakInto(page, 'Tap and speak');
  await expect(text(page, 'Your note at 0:00')).toBeVisible();
  await primary(page).click();
  await button(page, 'Needs changes').click();
  await expect(text(page, 'What should change?')).toBeVisible();
  await expect(text(page, `Say it in your words. ${TOM_FIRST} will hear it.`)).toBeVisible();
  await expect(byId(page, 'header-close')).toHaveCount(0);
  await expect(byId(page, 'header-back')).toBeVisible();
  await expect(button(page, /^Listen, /)).toHaveCount(0);
  await expect(primary(page)).toHaveText('Send feedback');
  await expect(primary(page)).toBeDisabled();
  await speakInto(page, 'Tap and speak');
  await expect(button(page, /^Play Your feedback, 0:0\d$/)).toBeVisible();
  await expect(button(page, 'Record again')).toBeVisible();
  await button(page, 'Or type it').click();
  await field(page, 'Or type it — what worked, what didn\'t').fill('Verse 12 is too fast');
  await expect(button(page, 'Record a listener retelling, optional')).toBeVisible();
  await primary(page).click();
  await sawToast(page, `Feedback sent to ${TOM}`);
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await expect(button(page, 'Versions and history')).toBeVisible();
  expect(await screenText(page)).toMatch(/Peer check\s+needs changes/);
  await expectSent(page, world());
  // TRANS hears it.
  const trans = await device(browser, world(), 'TRANS');
  await openRecord(trans.page, world(), 'P-Q1');
  await expect(primary(trans.page)).toHaveText('Hear the feedback');
  await primary(trans.page).click();
  await expect(text(trans.page, '“Verse 12 is too fast”')).toBeVisible();
  await expect(button(trans.page, new RegExp(`^Play ${RITA}'s feedback`))).toBeVisible();
  await trans.context.close();
});

test('REV-006 "Send feedback" needs words; text alone is enough', async ({ page }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-Q2');
  await primary(page).click();
  await button(page, 'Needs changes').click();
  await expect(primary(page)).toBeDisabled();
  await button(page, 'Or type it').click();
  const f = field(page, 'Or type it — what worked, what didn\'t');
  await f.fill(' ');
  await expect(primary(page)).toBeDisabled();
  await f.fill('Verse 19 says \'tree\' twice');
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  await sawToast(page, `Feedback sent to ${TOM}`);
  await expect(button(page, 'Versions and history')).toBeVisible();
  await expectSent(page, world());
});

test('REV-007 A listener retelling with the feedback', async ({ page }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-Q3');
  await primary(page).click();
  await button(page, 'Needs changes').click();
  await button(page, 'Record a listener retelling, optional').click();
  await expect(text(page, 'Ask someone who listened to tell it back in their own words. It goes with your review.')).toBeVisible();
  await speakInto(page, 'Tap and record the retelling', 4000);
  await expect(button(page, /^Play Listener retelling, 0:0\d$/)).toBeVisible();
  await button(page, 'Remove the retelling').click();
  await button(page, 'Record a listener retelling, optional').click();
  await speakInto(page, 'Tap and record the retelling', 4000);
  await button(page, 'Or type it').click();
  await field(page, 'Or type it — what worked, what didn\'t').fill('They missed the narrow door');
  await primary(page).click();
  await sawToast(page, `Feedback sent to ${TOM}`);
  await expectSent(page, world());
  // The retelling goes with the review as a recording.
  const p = await passageNow(world(), 'TRANS', 'P-Q3');
  const review = p.reviews.find((r) => r.kindId === 'peer' && r.outcome === 'needs_changes');
  expect(review?.comment).toBe('They missed the narrow door');
  expect((review as { artifacts?: unknown[] } | undefined)?.artifacts?.length ?? 0).toBeGreaterThan(0);
});

test('REV-008 Back from "What should change?" returns to Decide', async ({ page }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-NEW');
  const before = await eventCount(page);
  await primary(page).click();
  await button(page, 'Needs changes').click();
  await button(page, 'Or type it').click();
  await field(page, 'Or type it — what worked, what didn\'t').fill('Too quiet at the start');
  await byId(page, 'header-back').click();
  await expect(text(page, 'Is it accurate and natural?')).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(button(page, 'Listen, done. Go back')).toBeVisible();
  await button(page, 'Needs changes').click();
  await expect(field(page, 'Or type it — what worked, what didn\'t')).toHaveValue('Too quiet at the start');
  expect(await eventCount(page)).toBe(before);
  // Step 5 (Android's system Back) is a phone-only step: Maestro flow REV-008.
});

test('REV-009 Who is listening', async ({ page }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-ASIDE');
  await button(page, 'Who is listening?, optional').click();
  await expect(text(page, 'Optional. It goes on the record with this review.')).toBeVisible();
  for (let i = 0; i < 3; i++) await button(page, 'One more person').click();
  await button(page, 'One fewer person').click();
  await expect(text(page, '2 people')).toBeVisible();
  await field(page, 'Where — e.g. Bor church, after service').fill('Bor church');
  await button(page, 'Done').click();
  await expect(button(page, 'Who is listening?, 2 people · Bor church, Change')).toBeVisible();
  await primary(page).click();
  await button(page, 'Looks good').click();
  await sawToast(page, `Looks good · sent to ${TOM}`);
  await expectSent(page, world());
  const p = await passageNow(world(), 'REV', 'P-ASIDE');
  const review = p.reviews.find((r) => r.kindId === 'peer');
  expect(review?.people).toBe(2);
  expect(review?.place).toBe('Bor church');
});

test('REV-010 What changed in a later version', async ({ page }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-S');
  await expect(text(page, /^What changed in Version 2: said in a voice note$/)).toBeVisible();
  await expect(button(page, /Play what changed/)).toBeVisible();
  await byId(page, 'header-close').click();
  await startCheck(page, 'P-NEW');
  await expect(text(page, 'What changed in Version 2: Added verse 9 again, slower')).toBeVisible();
});

test('REV-011 Background', async ({ page }) => {
  const w = world();
  // The library's worked study covers Luke 15:11-32 and John 3:1-21. P-SUBMITTED's Peer check is done (REV-003),
  // so the review here is of John 3:9–21, which the same study covers: TRANS notes it and publishes Version 1.
  await offerExampleGuides(w);
  const trans = await langAs(w, 'TRANS');
  const john = unitByLabel(trans.getState(), JOHN);
  await act(trans, (s) => commands(s).addNote({ commandId: randomUUID(), unitId: john, anchor: { kind: 'passage' }, text: 'The father runs to him' }), 'TRANS notes the passage');
  await publishVersion(w, 'TRANS', { label: JOHN });
  await open(page, w, 'REV');
  await openLabel(page, JOHN);
  await doCheck(page, 'peer').click();
  await expect(text(page, `Version 1 · recorded by ${TOM_FIRST}`)).toBeVisible();
  await expect(text(page, new RegExp(`^The passage, the team's study, ${TOM_FIRST}'s notes$`))).toBeVisible();
  await button(page, /^Background/).click();
  await expect(text(page, 'Background')).toBeVisible();
  for (const chip of ['Passage', 'Guide', 'Notes · 1', 'Key words · 0', /^Earlier · \d+$/]) await expect(button(page, chip)).toBeVisible();
  // Passage: the Bible beside the passage, its picker and More Bibles.
  await expect(button(page, /^Choose a Bible/)).toBeVisible();
  await button(page, 'Guide').click();
  await expect(text(page, /^The team's study · /)).toBeVisible();
  await expect(button(page, 'Open the study')).toBeVisible();
  await button(page, 'Notes · 1').click();
  await expect(text(page, 'The father runs to him')).toBeVisible();
  await button(page, 'Key words · 0').click();
  await expect(text(page, 'No key words were tied to this version.')).toBeVisible();
  // Decision 91: every earlier version, and what was said about each.
  await button(page, /^Earlier · /).click();
  await expect(text(page, 'Version 1')).toBeVisible();
  await button(page, 'Passage').click();
  await button(page, /^Verse 3:16\. /).click();
  await button(page, 'Add a note on the verse playing').click();
  await field(page, 'Or type it').fill('Is \'heaven\' clear here?');
  await button(page, 'Add a note').click();
  await sawToast(page, 'Note added — it follows this passage');
  await button(page, /^Choose a Bible/).click();
  await button(page, /^More Bibles/).click();
  await expect(text(page, 'More Bibles')).toBeVisible();
  await back(page).click();
  await expect(button(page, 'Listen, step 1 of 2')).toBeVisible();
  // The review saved now names what Background offered (v1.ReferencesUsed).
  await primary(page).click();
  await button(page, 'Looks good').click();
  await sawToast(page, `Looks good · sent to ${TOM}`);
  await expectSent(page, w);
  const used = (await deviceEvents(page, w.languages.A.orgId, w.languages.A.languageId)).filter((e) => e.type === 'v1.ReferencesUsed');
  expect(used.length).toBeGreaterThan(0);
});

// ---- Questions ----

/** P-CHECK's consultant check, on its first question. */
async function toQuestions(page: Page): Promise<void> {
  await startCheck(page, 'P-CHECK', 'consultant');
  await primary(page).click();
  await expect(text(page, 'How well does this draft hold up against the source in the hardest verses?')).toBeVisible();
}
const REQUIRED_Q = 'Does it carry the meaning of the original?';
const radio = (page: Page, name: string) => visible(page.getByRole('radio', { name, exact: true })).first();

test('REV-012 Questions, one per screen', async ({ page }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-CHECK', 'consultant');
  await expect(button(page, 'Listen, step 1 of 3')).toBeVisible();
  await expect(button(page, 'Questions, step 2 of 3')).toBeVisible();
  await expect(button(page, 'Decide, step 3 of 3')).toBeVisible();
  await expect(primary(page)).toHaveText('Next: questions');
  await primary(page).click();
  await expect(visible(page.getByLabel('Question 1 of 4', { exact: true })).first()).toBeVisible();
  await expect(text(page, '1 · not at all')).toBeVisible();
  await expect(text(page, '5 · very well')).toBeVisible();
  // An optional question never holds the way forward (REV-015); only a required one does (REV-016).
  await expect(primary(page)).toBeEnabled();
  await expect(button(page, 'Skip this question')).toBeEnabled();
  await expect(button(page, /^Hear it: How well/)).toBeVisible();
  await radio(page, '4').click();
  await expect(primary(page)).toHaveText('Next question');
  await primary(page).click();
  await expect(text(page, 'Are the key terms aligned with the language\'s key terms list?')).toBeVisible();
  await expect(radio(page, 'Yes')).toBeVisible();
  await expect(radio(page, 'No')).toBeVisible();
  await radio(page, 'Yes').click();
  await primary(page).click();
  await expect(text(page, 'Notes for the translation team')).toBeVisible();
  await expect(button(page, 'Tap and record the answer')).toBeVisible();
  await expect(button(page, 'Or type it')).toBeVisible();
  await primary(page).click();
  // The language team's required question is the fourth, and the last: its button goes on to Decide.
  await expect(text(page, REQUIRED_Q)).toBeVisible();
  await expect(text(page, 'Language team')).toBeVisible();
  await expect(primary(page)).toHaveText('Next: decide');
});

test('REV-013 A text answer said aloud, or typed', async ({ page }) => {
  await open(page, world(), 'REV');
  await toQuestions(page);
  await button(page, 'Skip this question').click();
  await button(page, 'Skip this question').click();
  await expect(text(page, 'Notes for the translation team')).toBeVisible();
  await speakInto(page, 'Tap and record the answer', 4000);
  await expect(button(page, /^Play Their answer, 0:0\d$/)).toBeVisible();
  await button(page, 'Record again').click();
  await speakInto(page, 'Tap and record the answer', 3000);
  await expect(button(page, /^Play Their answer, 0:0\d$/)).toBeVisible();
  await button(page, 'Or type it').click();
  await field(page, 'Type the answer').fill('Verse 7 \'joy in heaven\' is clear');
  await expect(button(page, /^Play Their answer/)).toBeVisible();
  await primary(page).click();
  await radio(page, 'Yes').click();
  await primary(page).click();
  await expect(text(page, 'Does it carry the meaning?')).toBeVisible();
});

test('REV-014 Back to an earlier stage keeps the answers', async ({ page }) => {
  await open(page, world(), 'REV');
  await toQuestions(page);
  await radio(page, '4').click();
  await primary(page).click();
  await radio(page, 'Yes').click();
  await primary(page).click();
  await primary(page).click();
  await radio(page, 'Yes').click();
  await primary(page).click();
  await expect(text(page, 'Does it carry the meaning?')).toBeVisible();
  await button(page, 'Questions, done. Go back').click();
  await expect(text(page, 'How well does this draft hold up against the source in the hardest verses?')).toBeVisible();
  await expect(radio(page, '4')).toBeChecked();
  await button(page, 'Listen, done. Go back').click();
  await expect(primary(page)).toHaveText('Next: questions');
  await primary(page).click();
  for (let i = 0; i < 4; i++) await primary(page).click();
  await expect(text(page, 'Does it carry the meaning?')).toBeVisible();
  await expect(button(page, 'Looks good')).toBeEnabled();
});

test('REV-015 Skipping an optional question just moves on', async ({ page }) => {
  await open(page, world(), 'REV');
  await toQuestions(page);
  await button(page, 'Skip this question').click();
  await expect(text(page, 'Leave this question unanswered?')).toHaveCount(0);
  await expect(text(page, 'Are the key terms aligned with the language\'s key terms list?')).toBeVisible();
  await button(page, 'Skip this question').click();
  await button(page, 'Skip this question').click();
  await radio(page, 'Yes').click();
  await primary(page).click();
  await expect(text(page, /required questions? left/)).toHaveCount(0);
  await expect(button(page, 'Looks good')).toBeEnabled();
});

test('REV-016 An open required question holds the way forward', async ({ page }) => {
  await open(page, world(), 'REV');
  await toQuestions(page);
  for (let i = 0; i < 3; i++) await button(page, 'Skip this question').click();
  await expect(text(page, REQUIRED_Q)).toBeVisible();
  await expect(text(page, 'Required')).toBeVisible();
  await expect(primary(page)).toHaveText('Next: decide');
  await expect(primary(page)).toBeDisabled();
  await expect(button(page, 'Skip this question')).toBeEnabled();
  await expect(button(page, 'Decide, step 3 of 3')).toBeDisabled();
  await radio(page, 'Yes').click();
  await primary(page).click();
  await expect(text(page, /required questions? left/)).toHaveCount(0);
  await expect(button(page, 'Looks good')).toBeEnabled();
  await expect(button(page, 'Needs changes')).toBeEnabled();
  // ✕ with an answer given leaves at once, the answers kept as a draft on this device (REV-024), and sends nothing.
  const before = await eventCount(page);
  await byId(page, 'header-close').click();
  await expect(button(page, 'Versions and history')).toBeVisible();
  expect(await eventCount(page)).toBe(before);
});

test('REV-017 A required question skipped with a reason @p0', async ({ page }) => {
  await open(page, world(), 'REV');
  await toQuestions(page);
  for (let i = 0; i < 3; i++) await button(page, 'Skip this question').click();
  await expect(text(page, 'Required')).toBeVisible();
  await expect(text(page, 'Language team')).toBeVisible();
  await button(page, 'Skip this question').click();
  await expect(text(page, 'Leave this question unanswered?')).toBeVisible();
  await expect(text(page, 'Required questions can be skipped — the reason is saved with your review.')).toBeVisible();
  for (const r of ['Listeners weren\'t able to judge this', 'Not relevant for this passage', 'Ran out of time in the session']) await expect(text(page, r)).toBeVisible();
  await expect(text(page, 'The reason is saved with your review.')).toBeVisible();
  await expect(button(page, 'Skip question')).toBeDisabled();
  await text(page, 'Listeners weren\'t able to judge this').click();
  await button(page, 'Skip question').click();
  await expect(text(page, 'Left unanswered: Listeners weren\'t able to judge this')).toBeVisible();
  await expect(button(page, 'Answer it')).toBeVisible();
  await primary(page).click();
  await button(page, 'Looks good').click();
  await sawToast(page, `Looks good · sent to ${TOM}`);
  await expectSent(page, world());
  await expectNothingRefused(page, world());
  // The saved review, from Versions and history.
  await button(page, 'Versions and history').click();
  await button(page, /^Reviews by version/).click();
  await button(page, /^Consultant (Check|check) from You$/).click();
  await button(page, /^Answers to the questions\. /).click();
  const saved = await screenText(page);
  expect(saved).toContain(REQUIRED_Q);
  expect(saved).toMatch(/Left unanswered: ?Listeners weren't able to judge this/);
  expect(saved).toMatch(/1 left unanswered/);
});

test('REV-018 "Answer it" after skipping', async ({ page }) => {
  const w = world();
  // P-CHECK's consultant check is saved (REV-017), so a required question goes on its Final approval, now open.
  const before = await passageNow(w, 'REV', 'P-CHECK');
  expect(before.steps.find((s) => s.kinds.some((k) => k.kindId === 'consultant'))?.complete, 'REV-017 passed the consultant check').toBe(true);
  const coord = await langAs(w, 'COORD');
  await act(coord, (s) => commands(s).defineMaterial({ commandId: randomUUID(), materialId: `questions-${randomUUID()}`, kind: 'questions', title: 'Final approval questions',
    scope: { stepId: 'final' }, fields: [{ fieldId: 'q1', text: '[yesno!] Is it ready to share?' }] }), 'COORD adds a required question to Final approval');
  await open(page, w, 'REV');
  await startCheck(page, 'P-CHECK', 'final');
  await primary(page).click();
  await button(page, 'Skip this question').click();
  await text(page, 'Not relevant for this passage').click();
  await button(page, 'Skip question').click();
  await expect(text(page, 'Left unanswered: Not relevant for this passage')).toBeVisible();
  await button(page, 'Answer it').click();
  await expect(text(page, /^Left unanswered/)).toHaveCount(0);
  await expect(radio(page, 'Yes')).toBeVisible();
  await expect(radio(page, 'No')).toBeVisible();
  await expect(primary(page)).toBeDisabled();
});

// ---- edges and failures ----

test('REV-021 Nothing to review yet', async ({ page }) => {
  await open(page, world(), 'REV');
  await openRecord(page, world(), 'P-Q4');
  const before = await eventCount(page);
  await doCheck(page, 'peer').click();
  await expect(text(page, 'There\'s no recording to review yet.')).toBeVisible();
  await expect(text(page, 'Once a version is published, it can be reviewed here.')).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  expect(await eventCount(page)).toBe(before);
});

test('REV-022 Review offline', async ({ page, context }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-S');
  await byId(page, 'header-close').click();
  await context.setOffline(true);
  await doCheck(page, 'peer').click();
  await primary(page).click();
  await button(page, 'Looks good').click();
  await sawToast(page, `Looks good · sent to ${TOM}`);
  const pending = (await deviceEvents(page, world().languages.A.orgId, world().languages.A.languageId)).filter((e) => e.status === 'pending');
  expect(pending.length).toBeGreaterThan(0);
  await context.setOffline(false);
  await expectSent(page, world(), 'A', 60_000);
  await expectNothingRefused(page, world());
});

test('REV-023 A review the server refuses is not lost silently', async ({ page, context }) => {
  const w = world();
  await publishVersion(w, 'TRANS', 'P-Q4', { parts: 2 });
  await open(page, w, 'REV');
  await startCheck(page, 'P-Q4');
  await context.setOffline(true);
  // COORD makes REV a Viewer at LANG-A while REV's device is offline.
  const org = await clientAs(w, 'COORD', 'org');
  const scope = { level: 'language', languageId: w.languages.A.languageId };
  await org.appendMany([{ id: randomUUID(), type: 'v1.MemberAdded', payload: { profileId: w.accounts.REV.id, roleId: 'viewer', scope } }] as never);
  await send(org as never, 'COORD makes REV a viewer');
  try {
    await primary(page).click();
    await button(page, 'Looks good').click();
    await sawToast(page, `Looks good · sent to ${TOM}`);
    await context.setOffline(false);
    await expect.poll(async () => (await deviceEvents(page, w.languages.A.orgId, w.languages.A.languageId)).filter((e) => e.status === 'rejected').length,
      { timeout: 60_000 }).toBeGreaterThan(0);
    // The Sync screen (Me → More settings → Sync) shows it refused (PLAN.md invariant 1). Whether My Work or Me
    // say so too is SYNC-019's (a known issue: they do not).
    await toTabs(page);
    await tab(page, 'me').click();
    await button(page, /^More settings/).click();
    await button(page, /^Sync/).first().click();
    await openSyncDetails(page);
    // The screen polls the log once a second.
    await expect.poll(() => screenText(page), { timeout: 15_000 }).toMatch(/Refused · [1-9]|[1-9]\d* refused by the server/);
  } finally {
    await org.appendMany([{ id: randomUUID(), type: 'v1.MemberAdded', payload: { profileId: w.accounts.REV.id, roleId: 'reviewer', scope } }] as never);
    await send(org as never, 'COORD gives REV back the Reviewer role');
  }
});

test('REV-024 Leaving a review keeps it; opening it again brings it back', async ({ page }) => {
  await open(page, world(), 'REV');
  await startCheck(page, 'P-NEW');
  const before = await eventCount(page);
  await button(page, 'Add a note at this moment').click();
  await speakInto(page, 'Tap and speak');
  await expect(text(page, 'Your note at 0:00')).toBeVisible();
  await primary(page).click();
  await button(page, 'Needs changes').click();
  await button(page, 'Or type it').click();
  await field(page, 'Or type it — what worked, what didn\'t').fill('Too quiet at the start');
  // Kept as it is made, only on this device: the header's saved mark turns into a check (decision 127).
  await expect(byId(page, 'saved-mark')).toHaveAttribute('aria-label', 'Saved');
  // Back to Decide, then ✕: it leaves at once, with nothing to answer first, and sends nothing.
  await byId(page, 'header-back').click();
  await byId(page, 'header-close').click();
  await expect(button(page, 'Versions and history')).toBeVisible();
  expect(await eventCount(page)).toBe(before);
  // Opened again, after a reload too, the review is back where it was left: on Decide, with the words and the note.
  await page.reload();
  await openRecord(page, world(), 'P-NEW');
  await doCheck(page, 'peer').click();
  await expect(text(page, 'Is it accurate and natural?')).toBeVisible();
  await button(page, 'Needs changes').click();
  await expect(field(page, 'Or type it — what worked, what didn\'t')).toHaveValue('Too quiet at the start');
  await byId(page, 'header-back').click();
  await button(page, 'Listen, done. Go back').click();
  await expect(text(page, 'Your note at 0:00')).toBeVisible();
});

// ---- who may review ----

const REVIEW_ACTIONS = /^(Do the .+|Back-translate it|Review it now)$/;

test('REV-027 A translator is not offered Review it on their own versions', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await expect(text(page, 'Next for you')).toBeVisible();
  await expect(text(page, /^Check Luke/)).toHaveCount(0);
  for (const k of ['P-SUBMITTED', 'P-CHECK', 'P-BT'] as const) {
    await openRecord(page, world(), k);
    await expect(visible(page.getByRole('button', { name: REVIEW_ACTIONS }))).toHaveCount(0);
  }
});

test('REV-028 A viewer sees no record or review controls', async ({ page }) => {
  await open(page, world(), 'VIEW');
  const actions = /^(Record|Continue recording|Do the .+|Back-translate it|Hear the feedback|Record a fix|Keep it, say why|Ask for the .+|Already happened)$/;
  for (const k of ['P-SUBMITTED', 'P-NEEDS', 'P-BT', 'P-CHECK'] as const) {
    await openRecord(page, world(), k);
    await expect(visible(page.getByRole('button', { name: actions }))).toHaveCount(0);
  }
  // P-CHECK's reviews can be opened and read, with no footer buttons.
  await button(page, 'Versions and history').click();
  await button(page, /^Reviews by version/).click();
  await button(page, /^Peer (Review|check) from /).click();
  await expect(text(page, 'Looks good')).toBeVisible();
  await expect(visible(page.getByRole('button', { name: actions }))).toHaveCount(0);
});

test('REV-029 A reviewer cannot reach the recording workspace', async ({ page }) => {
  await open(page, world(), 'REV');
  await openRecord(page, world(), 'P-NEEDS');
  await expect(button(page, 'Hear the feedback')).toHaveCount(0);
  expect(await screenText(page)).toMatch(/Peer check\s+needs changes/);
  await button(page, 'Versions and history').click();
  await button(page, /^Reviews by version/).click();
  await button(page, /^Peer (Review|check) from You$/).click();
  await expect(text(page, 'Needs changes')).toBeVisible();
  await expect(text(page, 'Verse 18 is too fast')).toBeVisible();
  await expect(button(page, 'Record a fix')).toHaveCount(0);
  await expect(button(page, 'Keep it, say why')).toHaveCount(0);
});

test('REV-030 A translator-reviewer reviews their own version', async ({ page }) => {
  await open(page, world(), 'TREV');
  await startCheck(page, 'P-T');
  await expect(text(page, 'Version 1 · recorded by you')).toBeVisible();
  await primary(page).click();
  await expect(button(page, 'Say something about it, It goes on the record with your answer, optional')).toBeVisible();
  await button(page, 'Needs changes').click();
  await expect(text(page, 'Say it in your words. It goes on the record.')).toBeVisible();
  await byId(page, 'header-back').click();
  await button(page, 'Looks good').click();
  await sawToast(page, 'Looks good · on the record');
  expect(await screenText(page)).toMatch(/Peer check\s+looks good/);
  await expectSent(page, world());
});

// ---- back translation ----

test('REV-031 "Back-translate it" opens the back translation', async ({ page }) => {
  await open(page, world(), 'REV');
  await openRecord(page, world(), 'P-BT');
  await expect(primary(page)).toHaveText('Back-translate it');
  await primary(page).click();
  await expect(text(page, label('P-BT'))).toBeVisible();
  await expect(text(page, 'Back translation · into English')).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(text(page, 'Alpha · Version 1 · part 1')).toBeVisible();
  await expect(text(page, `${TOM_FIRST} · drag back and forth as often as you like`)).toBeVisible();
  await expect(text(page, 'Say each part in English, in your own words. Notes and earlier checks are hidden on purpose, so only the recording shapes what you say.')).toBeVisible();
  await expect(button(page, 'Part 1, Saying it next')).toBeVisible();
  await expect(button(page, 'Part 2')).toBeVisible();
  await expect(button(page, 'Part 3')).toBeVisible();
  await expect(button(page, 'Record part 1')).toBeVisible();
  await expect(button(page, 'Done')).toBeDisabled();
  await expect(button(page, /^Background/)).toHaveCount(0);
});

/** Say a part with the voice file: record until it is said, then stop. */
async function sayPart(page: Page, n: number): Promise<void> {
  await button(page, `Record part ${n}`).click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  // The voice file speaks 1.5 s in every 4 s: stop once a piece has been heard, as a person stops after speaking.
  await expect(visible(page.getByLabel(/[1-9]\d* pieces? so far/)).first()).toBeVisible({ timeout: 15_000 });
  await button(page, 'Stop recording').click();
  // Stopped, the session is still open (LAN-82); Done keeps its pieces.
  await button(page, 'Done').click();
  await expect(button(page, new RegExp(`^Part ${n}, 0:\\d\\d in English`))).toBeVisible({ timeout: 20_000 });
  // The last piece lands a moment after Stop, and then the next part lights up.
  await expect(button(page, /^Record part \d$/)).toBeEnabled();
}

test('REV-032 Say each part, then finish the back translation @p0', async ({ page }) => {
  await open(page, world(), 'REV');
  await openRecord(page, world(), 'P-BT');
  await primary(page).click();
  await button(page, 'Record part 1').click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  // The pane below the divider is the recording view (LAN-83): the part being said, the time and Done.
  await expect(visible(page.getByLabel(/^Part 1\. (Recording…|Listening for you)/)).first()).toBeVisible();
  await expect(visible(page.getByLabel(/^Recorded for 0:\d\d$/)).first()).toBeVisible();
  await expect(button(page, 'Done')).toBeVisible();
  // Stop keeps the session open (LAN-82): its pieces are boxes until Done.
  await button(page, 'Stop recording').click();
  await expect(text(page, 'Stopped')).toBeVisible();
  await button(page, 'Done').click();
  await expect(button(page, /^Part 1, 0:0\d in English$/)).toBeVisible({ timeout: 20_000 });
  await expect(button(page, /^Part 1, 0:\d\d in English$/)).toBeVisible({ timeout: 20_000 });
  await expect(button(page, 'Done')).toBeEnabled();
  await button(page, /^Part 1(,|$)/).click();
  await expect(button(page, /^Part 1, 0:0\d in English · record to add more$/)).toBeVisible();
  await expect(button(page, /Play your part 1/)).toBeVisible();
  await expect(button(page, 'Delete part 1 to say it again')).toBeVisible();
  await button(page, /^Part 2(,|$)/).click();
  await sayPart(page, 2);
  await sayPart(page, 3);
  await button(page, 'Done').click();
  await expect(text(page, 'Of Version 1')).toBeVisible();
  await expect(text(page, '✓ 3 of 3 parts said')).toBeVisible();
  await field(page, 'Or type it — e.g. a word with no English match').fill('The word for \'salt\' has no match');
  // A reviewer may not ask for the next check (REV-033), so Done only finishes it.
  await expect(text(page, 'Next check')).toHaveCount(0);
  await button(page, 'Finish the back translation').click();
  await sawToast(page, 'Back translation published.');
  await expect(byId(page, 'toast-undo')).toBeVisible();
  // Back on the record: there is no page of its own after Done.
  await expect(button(page, 'Versions and history')).toBeVisible();
  await expectSent(page, world());
  const p = await passageNow(world(), 'COORD', 'P-BT');
  const bt = p.reviews.find((r) => r.kindId === 'bt');
  expect(bt?.outcome).toBe('recorded');
  expect(bt?.comment).toContain('The word for \'salt\' has no match');
});

test('REV-034 Delete a part of the back translation, then Undo', async ({ page }) => {
  await ask(world(), 'COORD', 'P-Q3', { kindId: 'bt', profile: 'REV' });
  await open(page, world(), 'REV');
  await openRecord(page, world(), 'P-Q3');
  await button(page, 'Back-translate it').click();
  await sayPart(page, 1);
  await sayPart(page, 2);
  await button(page, /^Part 2(,|$)/).click();
  await button(page, 'Delete part 2 to say it again').click();
  await sawToast(page, 'Part 2 deleted.');
  await expect(button(page, 'Part 2, Saying it next')).toBeVisible();
  await undoToast(page);
  await expect(button(page, /^Part 2, 0:0\d in English/)).toBeVisible();
  await button(page, /^Part 2(,|$)/).click();
  await button(page, 'Delete part 2 to say it again').click();
  await sawToast(page, 'Part 2 deleted.');
  await expect(byId(page, 'toast')).toHaveCount(0, { timeout: 15_000 });
  await sayPart(page, 2);
});

// Each test is a fresh browser, so a back translation in progress is started in the test (the parts are this device's).
/** REV's back translation of P-Q3 (asked in REV-034), with the first `said` parts said. */
async function btInProgress(page: Page, said: number): Promise<void> {
  await open(page, world(), 'REV');
  await openRecord(page, world(), 'P-Q3');
  // The peer check and the back translation are one step (same time): either may lead.
  const bt = page.getByRole('button', { name: 'Back-translate it', exact: true }).locator('visible=true');
  if (!(await bt.count())) await page.getByRole('button', { name: /^Back translation, / }).locator('visible=true').first().click();
  await bt.last().click();
  for (let n = 1; n <= said; n++) await sayPart(page, n);
}

test('REV-035 Notes at a moment, for the consultant', async ({ page }) => {
  await btInProgress(page, 2);
  await button(page, /^Part 2(,|$)/).click();
  await button(page, 'Add a note at this moment').click();
  await expect(text(page, 'A note at 0:00 in part 2')).toBeVisible();
  await expect(text(page, 'What was hard to say here? The Consultant check hears it with your back translation.')).toBeVisible();
  await expect(button(page, 'Add note')).toBeDisabled();
  // The first note, by voice only.
  await speakInto(page, 'Say it');
  await button(page, 'Add note').click();
  await expect(text(page, '1 note for the Consultant check')).toBeVisible();
  // Decided (2026-10-13, interim): a back translation carries one spoken note, so the next is typed, and says so.
  await button(page, 'Add a note at this moment').click();
  await expect(text(page, 'One spoken note per back translation for now: type this one.')).toBeVisible();
  await expect(button(page, 'Say it')).toHaveCount(0);
  await expect(button(page, 'Add note')).toBeDisabled();
  await field(page, 'Or type it — e.g. a word with no English match').fill('No word for \'disciple\'');
  await button(page, 'Add note').click();
  await expect(text(page, '2 notes for the Consultant check')).toBeVisible();
  await button(page, 'Done').click();
  await expect(text(page, '✓ 2 notes at moments')).toBeVisible();
  // Done's "anything hard to say back?" is typed too: the one spoken note is taken.
  await expect(text(page, 'One spoken note per back translation for now: type this one.')).toBeVisible();
  await expect(button(page, 'Say it')).toHaveCount(0);
});

test('REV-036 Done with parts not said', async ({ page }) => {
  await btInProgress(page, 1);
  await button(page, 'Done').click();
  await expect(text(page, '✓ 1 of 3 parts said')).toBeVisible();
  await expect(text(page, 'Nothing yet for part 2, 3')).toBeVisible();
  await expect(button(page, 'Finish the back translation')).toBeEnabled();
  await button(page, 'Close').click();
  await expect(button(page, 'Finish the back translation')).toHaveCount(0);
  await expect(button(page, /^Part 1, 0:0\d in English/)).toBeVisible();
});

test('REV-037 Parts are kept on the device until Done', async ({ page }) => {
  await btInProgress(page, 2);
  await expect(button(page, /^Part 1, 0:0\d in English/)).toBeVisible();
  await expect(button(page, /^Part 2, 0:0\d in English/)).toBeVisible();
  await byId(page, 'header-close').click();
  await button(page, 'Back-translate it').click();
  await expect(button(page, /^Part 1, 0:0\d in English/)).toBeVisible();
  await expect(button(page, /^Part 2, 0:0\d in English/)).toBeVisible();
  await page.reload();
  await openRecord(page, world(), 'P-Q3');
  await button(page, 'Back-translate it').click();
  await expect(button(page, /^Part 1, 0:0\d in English/)).toBeVisible();
  await expect(button(page, /^Part 2, 0:0\d in English/)).toBeVisible();
});

test('REV-038 Hearing the version while saying a part', async ({ page }) => {
  await btInProgress(page, 0);
  await button(page, /^Part 3(,|$)/).click();
  await button(page, 'Record part 3').click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  await button(page, /^Play Alpha · Version 1 · part 3/).click();
  await expect(text(page, /^Paused while the (source|Bible) plays$/)).toBeVisible();
  await expect(button(page, 'Resume recording now')).toBeVisible();
  await button(page, 'Resume recording now').click();
  await expect(text(page, /^Paused while/)).toHaveCount(0);
  await button(page, 'Done').click();
});

test('REV-039 Parts made from an older version', async ({ page }) => {
  const w = world();
  await btInProgress(page, 1);
  await byId(page, 'header-close').click();
  // TRANS publishes Version 2 from another device; REV's comes in by sync.
  await publishVersion(w, 'TRANS', 'P-Q3', { parts: 1, note: 'One more part' });
  await openRecord(page, w, 'P-Q3');
  await expect(button(page, /^\d+\. Record\. Version 2/)).toBeVisible({ timeout: 60_000 });
  await button(page, 'Back-translate it').click();
  await expect(text(page, 'Your parts were made from Version 1')).toBeVisible();
  await expect(text(page, 'Version 2 is out now, and publishing puts your back translation with it. Listen again and redo any part that changed.')).toBeVisible();
  await expect(text(page, /^Alpha · Version 2 · part \d$/)).toBeVisible();
});

// ---- answering feedback ----

test('REV-040 "Hear the feedback" opens what the reviewer said', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openRecord(page, world(), 'P-NEEDS');
  await expect(button(page, /^\d+\. Hear the feedback\. Peer check · needs changes$/)).toBeVisible();
  await expect(button(page, /^\d+\. Fix it, or keep it and say why\. Then it goes back to the check$/)).toBeVisible();
  await expect(primary(page)).toHaveText('Hear the feedback');
  await primary(page).click();
  await expect(text(page, label('P-NEEDS'))).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  // Decision 91: the check's one name.
  await expect(text(page, 'Peer check · needs changes')).toBeVisible();
  await expect(text(page, RITA)).toBeVisible();
  await expect(text(page, /· Version 1$/)).toBeVisible();
  await expect(button(page, `Play ${RITA}'s feedback`)).toBeVisible();
  await expect(text(page, '“Verse 18 is too fast”')).toBeVisible();
  await expect(button(page, 'Hear Version 1, the version they heard')).toBeVisible();
  await expect(button(page, 'Record a fix')).toBeVisible();
  await expect(button(page, 'Keep it, say why')).toBeVisible();
});

/** Record one part in the workspace with the voice file, then stop. */
async function recordAPart(page: Page): Promise<void> {
  await recordParts(page, 1);
}

test('REV-041 Record a fix answers the feedback with Version 2 @p0', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openRecord(page, world(), 'P-NEEDS');
  await button(page, 'Hear the feedback').click();
  await button(page, 'Record a fix').click();
  await expect(text(page, 'Recording Version 2')).toBeVisible();
  // The parts are Version 1's until something changes (LAN-83: no sentence says so).
  await expect(page.getByRole('button', { name: /^Version 1, \d+ parts? · / }).locator('visible=true').first()).toBeVisible();
  await deletePart(page, 3);
  await recordAPart(page);
  await publishButton(page).click();
  await expect(text(page, /^Answers the Peer (Review|check) feedback from Rita Reviewer$/)).toBeVisible();
  await expect(text(page, /Revised after the Peer (Review|check) feedback\./)).toBeVisible();
  // The feedback goes back to its check: Done's main button asks for the Peer check again.
  await expect(text(page, 'Next check')).toBeVisible();
  await expect(primary(page)).toHaveText(/^Ask /);
  await button(page, 'Send later').click();
  await sawToast(page, 'Version 2 published.');
  await expect(button(page, 'Versions and history')).toBeVisible();
  await expectSent(page, world());
  const p = await passageNow(world(), 'REV', 'P-NEEDS');
  expect(p.versions.length).toBe(2);
  expect(p.reviews.find((r) => r.kindId === 'peer')?.response).toBeTruthy();
});

test('REV-042 Record a fix offline', async ({ page, context }) => {
  await open(page, world(), 'TRANS');
  await openRecord(page, world(), 'P-Q2');
  await button(page, 'Hear the feedback').click();
  await context.setOffline(true);
  await button(page, 'Record a fix').click();
  await expect(text(page, 'Recording Version 3')).toBeVisible();
  await recordAPart(page);
  await publishButton(page).click();
  await button(page, 'Send later').click();
  await sawToast(page, 'Version 3 published.');
  await context.setOffline(false);
  await expectSent(page, world(), 'A', 60_000);
  const p = await passageNow(world(), 'REV', 'P-Q2');
  expect(p.versions.length).toBe(3);
});

/** TRANS on a passage's feedback, at "Keep it, say why". */
async function toKeep(page: Page, key: 'P-Q1' | 'P-Q2' = 'P-Q1'): Promise<void> {
  await openRecord(page, world(), key);
  await button(page, 'Hear the feedback').click();
  await button(page, 'Keep it, say why').click();
  await expect(text(page, 'Keep it as it is?')).toBeVisible();
}

test('REV-043 Keep it, say why @p0', async ({ page, browser }) => {
  await open(page, world(), 'TRANS');
  await toKeep(page);
  await expect(text(page, 'Keep it, say why')).toBeVisible();
  await expect(byId(page, 'header-back')).toBeVisible();
  await expect(byId(page, 'header-close')).toHaveCount(0);
  await expect(text(page, `Say why. ${RITA} and the team will hear it.`)).toBeVisible();
  await expect(primary(page)).toHaveText('Keep it');
  await expect(primary(page)).toBeDisabled();
  await speakInto(page, 'Tap and say why', 4000);
  await field(page, 'Or type it').fill('Verse 12 is at the speed the elders asked for');
  await primary(page).click();
  await sawToast(page, 'Kept · your reason is on the record');
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await expect(button(page, 'Versions and history')).toBeVisible();
  await expect(primary(page)).not.toHaveText('Hear the feedback');
  await expectSent(page, world());
  const p = await passageNow(world(), 'REV', 'P-Q1');
  expect(p.versions.length).toBe(1);
  // REV hears and reads the reason.
  const rev = await device(browser, world(), 'REV');
  await openRecord(rev.page, world(), 'P-Q1');
  await button(rev.page, 'Versions and history').click();
  await button(rev.page, /^Reviews by version/).click();
  await button(rev.page, /^Peer (Review|check) from You$/).click();
  await expect(text(rev.page, new RegExp(`^${TOM} kept it`))).toBeVisible();
  await expect(text(rev.page, /Verse 12 is at the speed the elders asked for/)).toBeVisible();
  await rev.context.close();
});

test('REV-044 Undo after keeping', async ({ page }) => {
  // P-Q1 needs fresh feedback to keep and undo: REV asks for changes again on Version 1.
  await reviewLatest(world(), 'REV', 'P-Q1', 'peer', 'needs_changes', 'Still too fast');
  await open(page, world(), 'TRANS');
  await toKeep(page);
  await field(page, 'Or type it').fill('The elders chose this speed');
  await primary(page).click();
  await sawToast(page, 'Kept · your reason is on the record');
  await undoToast(page);
  await sawToast(page, 'Undone — the feedback is waiting again');
  await expect(primary(page)).toHaveText('Hear the feedback');
  await primary(page).click();
  await expect(button(page, 'Record a fix')).toBeVisible();
  await expect(button(page, 'Keep it, say why')).toBeVisible();
  // Keep it again, so later tests find it kept.
  await button(page, 'Keep it, say why').click();
  await field(page, 'Or type it').fill('The elders chose this speed');
  await primary(page).click();
  await sawToast(page, 'Kept · your reason is on the record');
  await expectSent(page, world());
});

test('REV-045 Keep it: a voice reason alone, and the way back', async ({ page }) => {
  await reviewLatest(world(), 'REV', 'P-Q2', 'peer', 'needs_changes', 'Verse 21 is unclear');
  await open(page, world(), 'TRANS');
  await toKeep(page, 'P-Q2');
  await byId(page, 'header-back').click();
  await expect(button(page, 'Record a fix')).toBeVisible();
  await button(page, 'Keep it, say why').click();
  await speakInto(page, 'Tap and say why', 3000);
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  await sawToast(page, 'Kept · your reason is on the record');
  await expectSent(page, world());
  const p = await passageNow(world(), 'REV', 'P-Q2');
  const kept = p.departures.filter((d) => d.type === 'keep').at(-1);
  expect(kept?.reason).toBe('Said by voice');
  expect(kept?.reasonBlobHash).toBeTruthy();
});

test('REV-046 Only the author answers feedback', async ({ page }) => {
  await open(page, world(), 'TREV');
  await openRecord(page, world(), 'P-Q3');
  await expect(button(page, 'Hear the feedback')).toHaveCount(0);
  await button(page, 'Versions and history').click();
  await button(page, /^Reviews by version/).click();
  await visible(page.getByRole('button', { name: /^Peer (Review|check) from Rita Reviewer$/ })).first().click();
  await expect(text(page, 'Needs changes')).toBeVisible();
  await expect(button(page, 'Record a fix')).toHaveCount(0);
  await expect(button(page, 'Keep it, say why')).toHaveCount(0);
});

test('REV-048 Answering feedback on P-Q1 with a new version', async ({ page }) => {
  await reviewLatest(world(), 'REV', 'P-Q1', 'peer', 'needs_changes', 'Verse 15 needs a pause');
  // One line per feedback still open on Version 1 (the kept ones are answered).
  const open1 = (await passageNow(world(), 'TRANS', 'P-Q1')).awaitingResponse.length;
  await open(page, world(), 'TRANS');
  await openRecord(page, world(), 'P-Q1');
  await button(page, 'Hear the feedback').click();
  await button(page, 'Record a fix').click();
  await recordAPart(page);
  await publishButton(page).click();
  expect(open1).toBeGreaterThan(0);
  await expect(visible(page.getByText(/^Answers the Peer (Review|check) feedback from Rita Reviewer$/))).toHaveCount(open1);
  await button(page, 'Send later').click();
  await sawToast(page, 'Version 2 published.');
  await expectSent(page, world());
});

test('REV-049 Take back a review @p0', async ({ page }) => {
  await publishVersion(world(), 'TRANS', 'P-DRAFT');
  await ask(world(), 'TRANS', 'P-DRAFT', { kindId: 'peer', profile: 'REV' });
  await open(page, world(), 'REV');
  const approve = async () => {
    await startCheck(page, 'P-DRAFT');
    await primary(page).click();
    await button(page, 'Looks good').click();
    await sawToast(page, `Looks good · sent to ${TOM}`);
  };
  // Right away, from the message.
  await approve();
  await undoToast(page);
  await sawToast(page, 'Undone.');
  await expect(doCheck(page, 'peer')).toBeVisible();
  // Later, from the check on the passage: the sheet offers Undo on REV's own check only.
  await approve();
  await openTeamRow(page, 'Peer check');
  await visible(sheet(page).getByRole('button', { name: 'Undo', exact: true })).click();
  await sawToast(page, 'Undone.');
  await expect(visible(sheet(page).getByRole('button', { name: 'Review it now' }))).toBeVisible();
  await closeSheet(page);
  // Later, from the history: the review taken back stays, crossed out.
  await approve();
  await button(page, 'Versions and history').click();
  await text(page, 'History').click();
  await expect(visible(page.getByText(/undone just now/))).toHaveCount(2);
  await visible(page.getByRole('button', { name: 'Undo', exact: true })).first().click();
  await expect(visible(page.getByText(/undone just now/))).toHaveCount(3);
  // The screen moves as soon as a write is queued (SyncClient.applyLocal), before it is in
  // the device's log, so wait for the third take-back there before asking what is left to send.
  const a = world().languages.A;
  await expect.poll(async () => (await deviceEvents(page, a.orgId, a.languageId)).filter((r) => r.type === 'v1.ReviewWithdrawn').length).toBe(3);
  await expectSent(page, world());
  await expectNothingRefused(page, world());
  // The check is open again, and the request is back with REV.
  const p = await passageNow(world(), 'TRANS', 'P-DRAFT');
  expect(p.reviews.filter((r) => r.kindId === 'peer')).toEqual([]);
  expect(p.withdrawnReviews).toHaveLength(3);
  expect(p.requests.find((r) => r.kindId === 'peer')?.status).toBe('open');
});
