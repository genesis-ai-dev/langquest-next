// 08 · Study and reference (docs/ui-test-suite/08-study-and-reference.md):
// the study reader, key words and key terms, and the Bible beside a passage.
// One world for the file; tests run in ID order.
//
// What the local library gives (checked 2026-10-12): FIA's English guides
// cover only Genesis 2:4-25, outside LANG-A's New Testament, so the world
// follows LangQuest's "Example study guides (English)", written in FIA's
// format, which hold the worked study for Luke 15:11-32 (P-SUBMITTED) and
// John 3:1-21 (not started: the passage "with a guide and no study done").
// Neither has recordings of its steps or glossary links, and the library has
// no Bible of its own, so the world's setup (study-helpers.ts) gives the
// organization its own copy of those guides with Luke's first step recorded
// (the test voice) and a glossary word in its second, and a small Bible of
// its own. Bible Brain is not set up locally: the two tests that need a real
// Bible Brain key (STUDY-030, STUDY-031's Bible Brain half) say so and skip.
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { commands, derivePassage } from '@langquest-next/core';
import { button, byId, deviceEvents, expect, expectSent, expectStill, expectSyncIdle, field, primary, screenText, test, text, undoToast } from './support';
import { recordButton, publishButton, recordParts } from './06-recording-helpers';
import { GLOSSARY_WORD, offerStudyWorld, OWN_BIBLE } from './study-helpers';
import { act, device, langAs, open, openLabel, openRecord, recordedFor, sawToast, uploadVoice, useRunWorld, visible } from './reviewing-helpers';

// One world for the run, kept when a failed test restarts the worker (reviewing-helpers.ts useRunWorld).
const world = useRunWorld('08-study', offerStudyWorld);
const JOHN = 'John 3:1–8';
const STEPS = ['Hear and Heart', 'Setting the Stage', 'Defining the Scenes', 'Embodying the Text', 'Filling the Gaps', 'Speaking the Word'];

const tabChip = (page: Page, name: string | RegExp) => visible(page.getByRole('tab', { name })).first();
const stepBar = (page: Page, n: number) => button(page, `Step ${n} of 6: ${STEPS[n - 1]}. All steps`);
const studyRow = (page: Page) => button(page, /^\d+\. Study\. /);
const eventCount = async (page: Page) => (await deviceEvents(page, world().languages.A.orgId, world().languages.A.languageId)).length;

async function openStudy(page: Page): Promise<void> {
  await openRecord(page, world(), 'P-SUBMITTED');
  await studyRow(page).click();
  await expect(text(page, 'Study')).toBeVisible();
}

/**
 * TRANS's workspace for P-SUBMITTED. With a draft open, the record's main
 * button continues it; otherwise the study, every step done (STUDY-004),
 * offers "Open the recording workspace" (the Record step row opens Version 1).
 */
async function openWorkspace(page: Page): Promise<void> {
  await openRecord(page, world(), 'P-SUBMITTED');
  // A fresh device draws the record before the language arrives ("Record", no versions):
  // read the main button once Version 1 shows and the footer holds still.
  await expect(text(page, /^Version 1 · \d+:\d\d$/)).toBeVisible();
  await expectSyncIdle(page);
  await expectStill(primary(page));
  const main = (await primary(page).innerText().catch(() => '')).trim();
  if (/^(Record|Continue recording)$/.test(main)) await primary(page).click();
  else {
    await studyRow(page).click();
    await button(page, 'Open the recording workspace').click();
  }
  await expect(text(page, /^Recording Version \d+$/)).toBeVisible();
}

async function speakInto(page: Page, mic: string, ms = 3500): Promise<void> {
  await button(page, mic).click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  await recordedFor(page, Math.ceil(ms / 1000));
  await button(page, 'Stop recording').click();
}

/** The language's key term by its word, as TRANS's client sees it now. */
async function termId(word: string): Promise<string> {
  const c = await langAs(world(), 'TRANS');
  const found = Object.entries(c.getState().keyTerms).find(([, k]) => (k as { term: string }).term === word);
  if (!found) throw new Error(`no key term "${word}"`);
  return found[0];
}

// ---- the study --------------------------------------------------------------------------

test('STUDY-001 Open the study from the passage record', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openRecord(page, world(), 'P-SUBMITTED');
  await expect(studyRow(page)).toHaveAccessibleName(/Study\. FIA guide · 0 of 6 steps$/);
  const before = await eventCount(page);
  await studyRow(page).click();
  await expect(text(page, world().passages['P-SUBMITTED'].label)).toBeVisible();
  await expect(text(page, 'Study')).toBeVisible();
  await expect(byId(page, 'header-close')).toBeVisible();
  await expect(tabChip(page, 'Guide')).toHaveAttribute('aria-selected', 'true');
  await expect(tabChip(page, 'Bible')).toBeVisible();
  // No key words and no notes yet, so no chips for them.
  await expect(visible(page.getByRole('tab', { name: /^(Key words|Notes)/ }))).toHaveCount(0);
  await expect(stepBar(page, 1)).toBeVisible();
  await expect(button(page, 'Previous step')).toBeDisabled();
  await expect(button(page, 'Next step')).toBeEnabled();
  await expect(text(page, /^Hear Luke 15:11–32 and put it in your heart\./)).toBeVisible();
  await expect(primary(page)).toHaveText('Done with this step');
  // The Bible has audio: the passage is docked at the bottom.
  await expect(text(page, `The passage · ${world().passages['P-SUBMITTED'].label}`)).toBeVisible();
  expect(await eventCount(page)).toBe(before);
  // A passage not started, with a guide, leads with "Study", which opens the same reader.
  await openLabel(page, JOHN);
  await expect(primary(page)).toHaveText('Study');
  await primary(page).click();
  await expect(button(page, /^Step 1 of \d+: /)).toBeVisible();
});

test('STUDY-002 Move between steps, and the list of steps', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openStudy(page);
  await button(page, 'Next step').click();
  await button(page, 'Next step').click();
  await expect(stepBar(page, 3)).toBeVisible();
  await button(page, 'Previous step').click();
  await expect(stepBar(page, 2)).toBeVisible();
  await stepBar(page, 2).click();
  await expect(text(page, 'Guide · 6 steps')).toBeVisible();
  await expect(text(page, '0 of 6 done')).toBeVisible();
  for (const [i, s] of STEPS.entries()) await expect(button(page, new RegExp(`^Step ${i + 1}: ${s}(, open now)?$`))).toBeVisible();
  await expect(text(page, /^Source: /)).toBeVisible();
  await expect(text(page, 'What you add while studying stays with this passage. Reviewers see it next to the draft.')).toBeVisible();
  await expect(button(page, 'Edit this guide')).toHaveCount(0);
  await expect(button(page, 'Copy this guide to adapt it')).toHaveCount(0);
  await button(page, 'Step 5: Filling the Gaps').click();
  await expect(stepBar(page, 5)).toBeVisible();
  await button(page, 'Next step').click();
  await expect(stepBar(page, 6)).toBeVisible();
  await expect(button(page, 'Next step')).toBeDisabled();
});

test('STUDY-003 Done with this step @p0', async ({ page, browser }) => {
  await open(page, world(), 'TRANS');
  await openStudy(page);
  await primary(page).click();
  await sawToast(page, 'Hear and Heart done · 1 of 6');
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await expect(stepBar(page, 2)).toBeVisible();
  await button(page, 'Previous step').click();
  await expect(text(page, /^Done by (you|Tom Translator) · just now$/i)).toBeVisible();
  await expect(button(page, 'Next: Setting the Stage')).toBeVisible();
  await button(page, 'Next step').click();
  await primary(page).click();
  await sawToast(page, 'Setting the Stage done · 2 of 6');
  await undoToast(page);
  await sawToast(page, 'Undone.');
  await button(page, 'Previous step').click();
  await expect(stepBar(page, 2)).toBeVisible();
  await expect(primary(page)).toHaveText('Done with this step');
  await stepBar(page, 2).click();
  await expect(text(page, /^1 of 6 done · by (you|You|Tom Translator)$/)).toBeVisible();
  await expect(button(page, 'Step 1: Hear and Heart, done')).toBeVisible();
  await button(page, 'Close').click();
  await byId(page, 'header-close').click();
  await expect(studyRow(page)).toHaveAccessibleName(/FIA guide · 1 of 6 steps$/);
  await expectSent(page, world());
  // REV sees step 1 done.
  const rev = await device(browser, world(), 'REV');
  await openStudy(rev.page);
  // The reader opens on the next step to do; step 1 is done, by TRANS.
  await stepBar(rev.page, 2).click();
  await expect(button(rev.page, 'Step 1: Hear and Heart, done')).toBeVisible();
  await expect(text(rev.page, '1 of 6 done · by Tom Translator')).toBeVisible();
  await rev.context.close();
});

test('STUDY-004 The last step, then "Record the first draft"', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openStudy(page);
  // Steps 2 to 6 (step 1 is done, STUDY-003).
  for (let n = 2; n <= 6; n++) {
    await expect(stepBar(page, n)).toBeVisible();
    await primary(page).click();
    if (n < 6) await sawToast(page, `${STEPS[n - 1]} done · ${n} of 6`);
  }
  await sawToast(page, 'Every step is done');
  await expect(byId(page, 'toast-undo')).toBeVisible();
  // P-SUBMITTED has a version.
  await expect(button(page, 'Open the recording workspace')).toBeVisible();
  await byId(page, 'header-close').click();
  await expect(studyRow(page)).toHaveAccessibleName(/FIA guide · done$/);
  // A passage with no version: every step done, then the first draft.
  await openLabel(page, JOHN);
  await primary(page).click();
  // Each "Done" moves the reader to the next step; after the sixth it offers the first draft.
  for (let n = 1; n <= 6; n++) {
    await expect(stepBar(page, n)).toBeVisible();
    await button(page, 'Done with this step').click();
  }
  await expect(button(page, 'Record the first draft')).toBeVisible();
  await button(page, 'Record the first draft').click();
  await expect(text(page, 'Recording Version 1')).toBeVisible();
  // STUDY-005 takes back one of these steps through the server.
  await expectSent(page, world());
});

test('STUDY-005 Reviewers see the next step, not "Done"', async ({ page }) => {
  // A guide with a step not done: TRANS takes back one of John's steps (STUDY-004 did them all).
  const trans = await langAs(world(), 'TRANS');
  const john = Object.entries(trans.getState().units).find(([, u]) => u.label === JOHN)![0];
  const mark = Object.keys(trans.getState().studyMarks).find((k) => k.startsWith(`${john}:`))!;
  const rest = mark.slice(john.length + 1);
  const stepId = rest.slice(rest.lastIndexOf(':') + 1);
  const guideId = rest.slice(0, rest.lastIndexOf(':'));
  await act(trans, (s) => commands(s).markStudyStep({ commandId: randomUUID(), unitId: john, guideId, stepId, done: false }), 'TRANS takes back a step');
  await open(page, world(), 'REV');
  await openStudy(page);
  await expect(text(page, /^Done by Tom Translator · /)).toBeVisible();
  await expect(button(page, 'Done with this step')).toHaveCount(0);
  await expect(button(page, 'Record the first draft')).toHaveCount(0);
  await expect(button(page, 'Open the recording workspace')).toHaveCount(0);
  // REV may answer (REV holds Review): a question offers "Answer".
  await button(page, /^1\.\s*What do you like in this story\?$/).click();
  await expect(button(page, 'Answer')).toBeVisible();
  // On a step nobody has done, the footer moves on instead of "Done with this step".
  await openLabel(page, JOHN);
  await studyRow(page).click();
  await expect(button(page, /^Step \d+ of \d+: /)).toBeVisible();
  await expect(button(page, 'Done with this step')).toHaveCount(0);
  await expect(button(page, 'Record the first draft')).toHaveCount(0);
});

test('STUDY-006 A viewer reads the study and cannot add to it', async ({ page }) => {
  const w = world();
  const trans = await langAs(w, 'TRANS');
  await act(trans, (s) => commands(s).addNote({ commandId: randomUUID(), unitId: w.passages['P-SUBMITTED'].unitId, anchor: { kind: 'passage' }, text: 'The robe means he is a son again' }), 'TRANS notes P-SUBMITTED');
  await open(page, w, 'VIEW');
  await openLabel(page, JOHN);
  await studyRow(page).click();
  await expect(button(page, /^Step 1 of \d+: /)).toBeVisible();
  for (const label of ['Done with this step', 'Answer', 'Add a note', 'Add a note here']) await expect(button(page, label)).toHaveCount(0);
  // Tapping a part of the step does nothing.
  await visible(page.getByText('What do you like in this story?', { exact: false })).first().click().catch(() => undefined);
  await expect(button(page, 'Answer')).toHaveCount(0);
  await expect(button(page, /^Next: /)).toBeVisible();
  // The Notes chip: notes to read, nothing to add (G10.6).
  await openRecord(page, w, 'P-SUBMITTED');
  await studyRow(page).click();
  await tabChip(page, /^Notes/).click();
  await expect(text(page, 'The robe means he is a son again')).toBeVisible();
  await expect(button(page, 'Add a note')).toHaveCount(0);
});

test('STUDY-007 Answer a question in the guide, by voice', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openStudy(page);
  await stepBar(page, 1).click();
  await button(page, /^Step 1: Hear and Heart/).click();
  await button(page, /^1\.\s*What do you like in this story\?$/).click();
  await expect(button(page, 'Answer')).toBeVisible();
  await button(page, 'Answer').click();
  await expect(text(page, 'Your answer')).toBeVisible();
  await expect(text(page, 'It stays with the passage, and reviewers see it with the study.')).toBeVisible();
  await expect(button(page, 'Add your answer')).toBeDisabled();
  await speakInto(page, 'Record what the group said', 4000);
  await field(page, 'Or type it').fill('The son came to himself');
  await button(page, 'Add your answer').click();
  await sawToast(page, 'Added to the study. Reviewers will see it with the passage.');
  await expect(text(page, 'The son came to himself')).toBeVisible();
  await expect(button(page, 'Play voice note').or(button(page, /^Play /)).first()).toBeVisible();
  await expectSent(page, world());
});

test('STUDY-008 A note at a moment of the spoken step', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openStudy(page);
  // The step's recording is the test voice, four seconds long: the note lands at 0:01 to 0:03, not at 0:20.
  await button(page, 'Play This step, spoken').click();
  await expect(text(page, /^0:0[1-3]\b/)).toBeVisible();
  await button(page, 'Add a note here').click();
  await expect(button(page, 'Play This step, spoken')).toBeVisible();
  await expect(text(page, 'Add a note')).toBeVisible();
  await field(page, 'Or type it').fill('Ask the elders about the ring');
  await button(page, 'Save').click();
  await sawToast(page, /^Note added at 0:0[1-4]\. It stays with the study\.$/);
  await expect(text(page, /^At 0:0[1-4]$/)).toBeVisible();
  await expect(text(page, 'Ask the elders about the ring')).toBeVisible();
  await expectSent(page, world());
});

test('STUDY-009 The study without a connection', async ({ page, context }) => {
  await open(page, world(), 'TRANS');
  // The app has opened LANG-A (My Work shows) but never opened this study.
  await expect(text(page, 'Next for you')).toBeVisible();
  await context.setOffline(true);
  await openRecord(page, world(), 'P-SUBMITTED');
  // A guide that exists but never came to this device must not be called missing.
  if (await studyRow(page).isVisible().catch(() => false)) {
    await studyRow(page).click();
    await expect(text(page, 'There\'s no study guide for this passage.')).toHaveCount(0);
  }
  await context.setOffline(false);
});

test('STUDY-010 Glossary words in the guide', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openStudy(page);
  // The second step links a glossary word (the web does not carry the link's "Tap for its meaning" hint, so it is not read here).
  await button(page, 'Next step').click();
  await expect(stepBar(page, 2)).toBeVisible();
  const word = visible(page.getByRole('link', { name: GLOSSARY_WORD })).first();
  await word.click();
  await expect(text(page, GLOSSARY_WORD)).toBeVisible();
  await expect(text(page, /^Glossary · the guide/)).toBeVisible();
  await expect(text(page, 'What a father leaves to his children.')).toBeVisible();
  await expect(text(page, 'In the story the younger son asks for his share while his father is alive.')).toBeVisible();
  // Its recording plays: the player's button turns to Pause.
  await button(page, `Play Listen: ${GLOSSARY_WORD}`).click();
  await expect(button(page, `Pause Listen: ${GLOSSARY_WORD}`)).toBeVisible();
  await expect(text(page, 'Couldn\'t load the audio — playing a stand-in')).toHaveCount(0);
  // The organization has no key term of that name, so the footer says so and is not a button.
  const keyTerms = Object.values((await langAs(world(), 'TRANS')).getState().keyTerms as Record<string, { term: string }>);
  expect(keyTerms.map((k) => k.term), 'the world has no key term of that name').not.toContain(GLOSSARY_WORD);
  await expect(text(page, 'This term isn\'t in your organization\'s key terms yet.')).toBeVisible();
  await expect(button(page, 'Open the key term')).toHaveCount(0);
});

test('STUDY-012 The study\'s other chips', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openStudy(page);
  await tabChip(page, 'Bible').click();
  await expect(button(page, /^Verse 15:11\. /)).toBeVisible();
  await expect(button(page, /^Bible: BSB\. Choose another$/)).toBeVisible();
  await expect(text(page, /^The passage · /)).toHaveCount(0);
  await expect(primary(page)).toHaveText('Back to the guide');
  await tabChip(page, /^Notes/).click();
  await expect(primary(page)).toHaveText('Back to the guide');
  await expect(text(page, 'The robe means he is a son again')).toBeVisible();
  await primary(page).click();
  await expect(button(page, /^Step \d of 6: /)).toBeVisible();
});

test('STUDY-013 The guide from the workspace, and back', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Guide').click();
  await expect(stepBar(page, 1)).toBeVisible();
  await expect(text(page, 'This step, spoken')).toHaveCount(0);
  await button(page, 'Next step').click();
  await button(page, 'Next step').click();
  await expect(stepBar(page, 3)).toBeVisible();
  await button(page, 'Open the study').click();
  await expect(text(page, 'Study')).toBeVisible();
  await expect(stepBar(page, 3)).toBeVisible();
  await byId(page, 'header-close').click();
  await expect(text(page, /^Recording Version \d+$/)).toBeVisible();
  await expect(tabChip(page, 'Guide')).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, /^Parts 1–3, 3 parts/)).toBeVisible();
});

for (const who of ['COORD', 'LADMIN'] as const) {
  test(`STUDY-014 ${who} Editing or adapting the guide`, async ({ browser }) => {
    const d = await device(browser, world(), who);
    await openStudy(d.page);
    await stepBar(d.page, 1).click();
    await expect(button(d.page, 'Copy this guide to adapt it')).toBeVisible();
    await button(d.page, 'Copy this guide to adapt it').click();
    await expect(byId(d.page, 'header-back').or(byId(d.page, 'header-close')).first()).toBeVisible();
    await d.context.close();
  });
}

test('STUDY-014 TRANS Editing or adapting the guide', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openStudy(page);
  await stepBar(page, 1).click();
  await expect(button(page, 'Copy this guide to adapt it')).toHaveCount(0);
  await expect(button(page, 'Edit this guide')).toHaveCount(0);
});

test('STUDY-015 No guide for this passage', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openRecord(page, world(), 'P-NEW');
  await expect(studyRow(page)).toHaveCount(0);
});

// ---- key words and key terms ------------------------------------------------------------------

test('STUDY-016 Add a key word', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Key words').click();
  await expect(text(page, 'No key words in this passage yet. Add one your team should say the same way every time.')).toBeVisible();
  await button(page, 'Add a key word').click();
  await expect(text(page, 'A word the team should say the same way every time. It is added to Alpha\'s key words.')).toBeVisible();
  await field(page, 'The word in the Bible, e.g. shepherd').fill('heaven');
  await field(page, 'What it means (optional)').fill('God\'s dwelling, or God himself');
  await expect(button(page, 'Add the word')).toBeDisabled();
  await field(page, 'Or type it').fill('ijuru');
  await expect(button(page, 'Add the word')).toBeEnabled();
  await button(page, 'Add the word').click();
  await sawToast(page, 'heaven added.');
  // Key terms are grow-only (core materials.ts): adding one offers no Undo.
  await expect(byId(page, 'toast-undo')).toHaveCount(0);
  await expect(button(page, /^heaven\. /)).toBeVisible();
  await tabChip(page, 'Bible').click();
  await expect(visible(page.getByRole('link', { name: /^heaven, key word/ })).first()).toBeVisible();
  await expectSent(page, world());
});

test('STUDY-017 Key words in the workspace', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Key words').click();
  await expect(button(page, /^heaven\. Luke 15:18, 21/)).toBeVisible();
  await expect(button(page, 'Add a key word')).toBeVisible();
  await expect(button(page, 'All key words')).toBeVisible();
  await button(page, 'Hear heaven in the Bible').click();
  await expect(tabChip(page, 'Bible')).toHaveAttribute('aria-selected', 'true');
  await tabChip(page, 'Key words').click();
  await button(page, /^heaven\. /).click();
  await expect(text(page, 'heaven')).toBeVisible();
  await expect(text(page, 'Alpha key term')).toBeVisible();
});

test('STUDY-018 Say your word for a key word', async ({ page }) => {
  const w = world();
  // A word with no rendering yet: "son", for Luke.
  const trans = await langAs(w, 'TRANS');
  const unitId = w.passages['P-SUBMITTED'].unitId;
  const book = trans.getState().units[unitId]?.parentUnitId ?? unitId;
  await act(trans, (s) => commands(s).defineKeyTerm({ commandId: randomUUID(), termId: `kt-${randomUUID()}`, term: 'son', gloss: '', unitScope: [book], note: 'Added for the study tests' }), 'TRANS adds "son"');
  await open(page, w, 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Key words').click();
  await button(page, 'Say your word for son').click();
  await expect(text(page, 'Your word for “son”')).toBeVisible();
  await expect(text(page, 'Say how Alpha says it. Your team hears it whenever this word comes up.')).toBeVisible();
  await expect(button(page, 'Add your word')).toBeDisabled();
  await speakInto(page, 'Say it');
  await button(page, 'Add your word').click();
  await sawToast(page, 'Your word for son is saved.');
  await expect(byId(page, 'toast-undo')).toHaveCount(0);
  await expect(button(page, 'Play your word for son')).toBeVisible();
  await expectSent(page, world());
});

for (const who of ['REV', 'VIEW'] as const) {
  test(`STUDY-019 ${who} Reviewers and viewers cannot change key words`, async ({ page, browser }) => {
    const forbidden = /^(Say yours|Say your word for .+|Add a key word|New term|Tie to your draft|Adjust or add a rendering|Add a rendering)$/;
    const d = await device(browser, world(), who);
    await openStudy(d.page);
    await tabChip(d.page, 'Key words').click();
    await expect(button(d.page, /^heaven\. /)).toBeVisible();
    await expect(visible(d.page.getByRole('button', { name: forbidden }))).toHaveCount(0);
    await button(d.page, /^heaven\. /).click();
    await expect(text(d.page, 'Alpha key term')).toBeVisible();
    await expect(visible(d.page.getByRole('button', { name: forbidden }))).toHaveCount(0);
    await d.context.close();
    void page;
  });
}

test('STUDY-020 The Key Terms list', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Key words').click();
  await button(page, 'All key words').click();
  await expect(text(page, 'Key Terms')).toBeVisible();
  await expect(text(page, `${world().passages['P-SUBMITTED'].label} · Alpha`)).toBeVisible();
  await expect(button(page, 'New term')).toBeVisible();
  await expect(text(page, /^In this passage · \d+$/)).toBeVisible();
  await expect(button(page, /^heaven/)).toBeVisible();
  const search = field(page, 'Search terms');
  await search.fill('hea');
  await expect(button(page, /^heaven/)).toBeVisible();
  await expect(button(page, /^son/)).toHaveCount(0);
  await search.fill('zzqx');
  await expect(text(page, 'Nothing matches “zzqx”.')).toBeVisible();
  await search.fill('');
  await byId(page, 'header-back').click();
  await expect(text(page, /^Recording Version \d+$/)).toBeVisible();
  await expect(tabChip(page, 'Key words')).toHaveAttribute('aria-selected', 'true');
});

test('STUDY-021 A new term from the Key Terms list', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Key words').click();
  await button(page, 'All key words').click();
  await button(page, 'New term').click();
  await expect(text(page, 'New key term')).toBeVisible();
  await expect(text(page, 'Added to Alpha\'s key terms, with its first rendering.')).toBeVisible();
  await field(page, 'Source term, e.g. grace (charis)').fill('compassion');
  await expect(button(page, 'Add Term')).toBeDisabled();
  await field(page, 'Alpha rendering').fill('imbabazi');
  await field(page, 'When to use it, and why').fill('When the father sees the son');
  await button(page, 'Add Term').click();
  await sawToast(page, 'compassion added.');
  await expect(button(page, /^compassion/)).toBeVisible();
  await expectSent(page, world());
});

test('STUDY-022 Nobody may add terms without Fill reference', async ({ page }) => {
  await open(page, world(), 'REV');
  await openStudy(page);
  await tabChip(page, 'Key words').click();
  await button(page, /^heaven\. /).click();
  await expect(text(page, 'Alpha key term')).toBeVisible();
  await expect(button(page, 'New term')).toHaveCount(0);
});

test('STUDY-023 A key term\'s page', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  // A draft: record one part, and stay.
  await recordParts(page, 1);
  await tabChip(page, 'Key words').click();
  await button(page, /^heaven\. /).click();
  await expect(text(page, 'heaven')).toBeVisible();
  await expect(text(page, 'Alpha key term')).toBeVisible();
  await expect(text(page, 'God\'s dwelling, or God himself')).toBeVisible();
  await expect(text(page, /^(Appears in .+|Applies to every passage)$/)).toBeVisible();
  await expect(button(page, 'Tie to your draft')).toBeVisible();
  await expect(text(page, `So reviewers know this term shaped ${world().passages['P-SUBMITTED'].label}.`)).toBeVisible();
  await expect(text(page, 'In Alpha')).toBeVisible();
  await expect(button(page, 'Adjust or add a rendering')).toBeVisible();
  // The draft goes to the server, so a teammate's device (and STUDY-025) sees it.
  await expectSent(page, world());
});

test('STUDY-024 Tie a key term to the draft', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Key words').click();
  await button(page, /^heaven\. /).click();
  await button(page, 'Tie to your draft').click();
  await sawToast(page, 'Tied heaven to your draft.');
  await expect(button(page, 'Tied to your draft').or(text(page, 'Tied to your draft')).first()).toBeVisible();
  await expect(text(page, 'Reviewers will see this term and your reasoning.')).toBeVisible();
  await byId(page, 'header-back').click();
  await tabChip(page, 'Bible').click();
  await expect(visible(page.getByRole('link', { name: /^heaven, key word, tied to your draft$/ })).first()).toBeVisible();
  await publishButton(page).click();
  await expect(text(page, '1 key word tied to this version')).toBeVisible();
  await expectSent(page, world());
});

test('STUDY-025 Tying when someone else is drafting too', async ({ page }) => {
  const w = world();
  const unitId = w.passages['P-SUBMITTED'].unitId;
  // TREV starts a draft of P-SUBMITTED; TRANS's draft (STUDY-023) is newer.
  const trev = await langAs(w, 'TREV');
  const card = await uploadVoice(w, 'TREV');
  const recordingId = randomUUID();
  await act(trev, (s) => [
    ...commands(s).addRecording({ commandId: recordingId, recordingId, unitId, kind: 'target', card })
  ], 'TREV records');
  await act(trev, (s) => commands(s).keepTake({ commandId: randomUUID(), unitId, cardHashes: [card.hash], actorId: w.accounts.TREV.id }), 'TREV keeps a draft');
  const compassion = await termId('compassion');
  await open(page, w, 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Key words').click();
  await button(page, /^compassion\. /).click();
  await button(page, 'Tie to your draft').click();
  await sawToast(page, 'Tied compassion to your draft.');
  await expectSent(page, w);
  const c = await langAs(w, 'TRANS');
  const p = derivePassage(c.getState(), unitId);
  const transDraft = p.drafts.find((d) => d.by === w.accounts.TRANS.id)!.takeId;
  const trevDraft = p.drafts.find((d) => d.by === w.accounts.TREV.id)!.takeId;
  expect(c.getState().keyTermLinks[transDraft]?.[compassion]).toBeTruthy();
  expect(c.getState().keyTermLinks[trevDraft]?.[compassion]).toBeFalsy();
});

test('STUDY-026 Adjust or add a rendering, with why', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Key words').click();
  await button(page, /^heaven\. /).click();
  await button(page, 'Adjust or add a rendering').click();
  await expect(text(page, 'Alpha · “heaven”')).toBeVisible();
  await expect(text(page, `Recorded as part of ${world().passages['P-SUBMITTED'].label}, and tied to your draft.`)).toBeVisible();
  await expect(button(page, 'Add your word')).toBeDisabled();
  await field(page, 'New rendering (optional)').fill('ijuru ry\'Imana');
  await field(page, 'When to use it').fill('Only for God\'s dwelling');
  await speakInto(page, 'Say why', 4000);
  await button(page, 'Add your word').click();
  await sawToast(page, 'Added “ijuru ry\'Imana”.');
  await button(page, 'Adjust or add a rendering').click();
  await field(page, 'Or type what changed, and why').fill('Elders prefer the older word');
  await button(page, 'Add your word').click();
  await sawToast(page, 'Change recorded.');
  await expect(text(page, 'Why it\'s rendered this way')).toBeVisible();
  expect(await screenText(page)).toMatch(/\d+ changes · latest by (you|You|Tom Translator)/);
  await expectSent(page, world());
});

// ---- Bibles beside a passage ------------------------------------------------------------------

test('STUDY-028 The Bible chip in the workspace', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Bible').click();
  await button(page, `Play ${world().passages['P-SUBMITTED'].label}`).click();
  await expect(button(page, 'Pause')).toBeVisible();
  await button(page, 'Pause').click();
  await expect(button(page, 'Back 10 seconds')).toBeEnabled();
  await button(page, /^Verse 15:20\. /).click();
  // The key word in the text opens its page.
  await visible(page.getByRole('link', { name: /^heaven, key word/ })).first().click();
  await expect(text(page, 'Alpha key term')).toBeVisible();
  await byId(page, 'header-back').click();
  await tabChip(page, 'Bible').click();
  expect(await screenText(page)).toMatch(/BSB: /);
});

test('STUDY-029 Choose a Bible', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Bible').click();
  await button(page, 'Bible: BSB. Choose another').click();
  await expect(text(page, 'Choose a Bible')).toBeVisible();
  await expect(text(page, 'The one you choose plays and shows here, and in the study and reviews on this device.')).toBeVisible();
  await expect(button(page, /More Bibles/)).toBeVisible();
  expect(await visible(page.getByRole('radio')).count(), 'the picker offers at least two Bibles').toBeGreaterThanOrEqual(2);
});

/** More Bibles from the workspace's Bible picker; false when Bible Brain is not set up here. */
async function moreBibles(page: Page): Promise<boolean> {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Bible').click();
  await button(page, 'Bible: BSB. Choose another').click();
  await button(page, /More Bibles/).click();
  await expect(text(page, 'More Bibles')).toBeVisible();
  await expect(text(page, `For ${world().passages['P-SUBMITTED'].label}`)).toBeVisible();
  const search = field(page, 'Search for a language');
  if (!(await search.isVisible().catch(() => false))) return false;
  await search.fill('sw');
  await expect(text(page, /Bible Brain|Swahili/)).toBeVisible();
  return !(await text(page, /Bible Brain (is not|isn't) (set up|available)/).isVisible().catch(() => false));
}

test('STUDY-030 Find another Bible', async ({ page }) => {
  // Searches Bible Brain's live catalogue: no local stand-in, so it needs a real key (BIBLE_BRAIN_ACCESS_KEY) on the Worker.
  test.skip(!(await moreBibles(page)), 'needs a real Bible Brain key on the local Worker (BIBLE_BRAIN_ACCESS_KEY); none is set here');
  await expect(text(page, /^Swahili/)).toBeVisible();
  await field(page, 'Search for a language').fill('zzqx');
  await expect(text(page, 'No languages found')).toBeVisible();
  await expect(text(page, 'Try the name in English, or its three-letter code.')).toBeVisible();
});

/** The organization's own Bible, opened from More Bibles in the workspace's Bible picker (the local library has none). */
async function openOwnBible(page: Page): Promise<void> {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Bible').click();
  await button(page, 'Bible: BSB. Choose another').click();
  await button(page, /More Bibles/).click();
  await expect(text(page, 'In your organization\'s library')).toBeVisible();
  await button(page, new RegExp(`^${OWN_BIBLE} · Test Library Bible`)).click();
  await expect(text(page, 'Test Library Bible')).toBeVisible();
}

const ownBibleChoice = (page: Page) => visible(page.getByRole('radio', { name: new RegExp(OWN_BIBLE) }));

test('STUDY-031 Add to My Bibles, then Undo', async ({ page }) => {
  // Bible Brain's Swahili Bibles need a real key (STUDY-030); the same screen adds a Bible from the organization's library.
  await openOwnBible(page);
  await expect(text(page, `${OWN_BIBLE} · eng`)).toBeVisible();
  await expect(text(page, 'Can be kept offline')).toBeVisible();
  await button(page, 'Next chapter').click();
  await expect(text(page, 'Chapter 2')).toBeVisible();
  await button(page, 'Add to My Bibles').click();
  await sawToast(page, `${OWN_BIBLE} added to My Bibles`);
  await expect(text(page, /^Recording Version \d+$/)).toBeVisible();
  // Undo takes it out again: the Bible picker does not list it.
  await undoToast(page);
  await tabChip(page, 'Bible').click();
  await button(page, 'Bible: BSB. Choose another').click();
  await expect(text(page, 'Choose a Bible')).toBeVisible();
  await expect(ownBibleChoice(page)).toHaveCount(0);
  // Added again, it shows in the picker and as "My Bible" in More Bibles.
  await button(page, /More Bibles/).click();
  await button(page, new RegExp(`^${OWN_BIBLE} · Test Library Bible`)).click();
  await button(page, 'Add to My Bibles').click();
  await sawToast(page, `${OWN_BIBLE} added to My Bibles`);
  await tabChip(page, 'Bible').click();
  // It has Luke 15's text, so it now stands in for the built-in BSB: the Bible chip shows it, and "Other Bibles" leads to More Bibles.
  await expect(text(page, `${OWN_BIBLE}: Written for the UI tests.`)).toBeVisible();
  await expect(button(page, 'Bible: BSB. Choose another')).toHaveCount(0);
  await button(page, 'Other Bibles').click();
  await expect(text(page, 'My Bible')).toBeVisible();
  await button(page, new RegExp(`^${OWN_BIBLE} · Test Library Bible`)).click();
  await expect(button(page, 'In My Bibles')).toBeDisabled();
  await expect(button(page, 'Remove from My Bibles')).toBeVisible();
});

test('STUDY-033 More Bibles without Bible Brain', async ({ page }) => {
  const available = await moreBibles(page);
  test.skip(available, 'Bible Brain is set up here; this test is for a server without it');
  expect(await screenText(page)).toMatch(/Bible Brain (is not set up on the server yet|isn't set up on this device|is not available on this server yet|isn't available on this server yet)/);
  await expect(text(page, 'Bibles you add are yours, on this device, for this language. Your team\'s recommended Bibles always come first.')).toBeVisible();
  await byId(page, 'header-back').click();
  await expect(text(page, /^Recording Version \d+$/)).toBeVisible();
});

test('STUDY-034 "Next chapter" stops at the last chapter', async ({ page }) => {
  await openOwnBible(page);
  // Luke has 24 chapters in this Bible's numbering.
  for (let n = 2; n <= 24; n++) {
    await button(page, 'Next chapter').click();
    await expect(text(page, `Chapter ${n}`)).toBeVisible();
  }
  await expect(button(page, 'Next chapter')).toHaveCount(0);
  await expect(text(page, 'Chapter 24')).toBeVisible();
});

test('STUDY-035 A note on a verse beside the recorder', async ({ page }) => {
  await open(page, world(), 'TRANS');
  await openWorkspace(page);
  await tabChip(page, 'Bible').click();
  await button(page, /^Verse 15:20\. /).click();
  await button(page, 'Add a note here').click();
  await expect(text(page, /Luke 15:11–32 · verse 15:20/)).toBeVisible();
  await speakInto(page, 'Say it');
  await field(page, 'Or type it').fill('Ran: elders never run');
  await button(page, 'Add a note').click();
  await sawToast(page, /^Note added/);
  await expect(button(page, /^Verse 15:20\. .*\d+ notes?$/)).toBeVisible();
  await tabChip(page, /^Notes/).click();
  await expect(text(page, 'Ran: elders never run')).toBeVisible();
  await expectSent(page, world());
});

test('STUDY-036 The Bible offline', async ({ page, context }) => {
  await open(page, world(), 'TRANS');
  await openRecord(page, world(), 'P-Q2');
  await context.setOffline(true);
  await primary(page).click();
  await expect(text(page, /^Recording Version 1$/)).toBeVisible();
  await tabChip(page, 'Bible').click();
  // Never a spinner that never ends: the text if it is here, and the player says the audio is not.
  await expect(text(page, /Audio is not on this device yet\.|no audio for this passage/)).toBeVisible();
  await expect(recordButton(page)).toBeEnabled();
  await context.setOffline(false);
});
