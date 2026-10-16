// SETUP: reference material and the guide editor (docs/ui-test-suite/09-language-setup.md,
// SETUP-049 to SETUP-057). The local library has FIA's study guides and
// LangQuest's question sets, but no Bible (no source@1 is seeded), so the
// Bible rows are checked as far as an empty list goes.
import type { Page } from '@playwright/test';
import {
  back, button, byId, deviceFor, expect, expectNothingRefused, expectSent, expectToast, field, openAs, primary, screenText, syncNow, test, text,
  undoToast, useWorld
} from './support';
import { closeSheet, expectNotOnScreen, expectOnScreen, expectOrgSent, languagePage, more, orgHome, orgRefused, setup } from './setup-helpers';

const world = useWorld();

/** Alpha's page → More → Bibles, guides and notes. */
async function alphaReference(page: Page, who: 'ADMIN' | 'COORD' = 'ADMIN'): Promise<void> {
  const w = world();
  await openAs(page, w, who);
  await languagePage(page, w, 'Alpha');
  await more(page);
  await text(page, 'Bibles, guides and notes').click();
  await expectOnScreen(page, 'Reference Material', 'What translators are offered');
}

for (const who of ['ADMIN', 'COORD'] as const) {
  test(`SETUP-049 ${who} Reference Material for a language`, async ({ page, browser }) => {
    const w = world();
    const d = who === 'ADMIN' ? null : await deviceFor(browser, w, who);
    const p = d?.page ?? page;
    await alphaReference(p, who);
    await expectOnScreen(p, 'Alpha', 'Add material', 'Alpha\'s own material adds to what the organization recommends; nothing is copied.',
      'Bibles', /\d+ recommended · text, audio, offline use and timings/, 'Guides and notes', /\d+ recommended guides? · \d+ notes?/,
      'Coverage', 'What reaches each passage in Alpha', 'Key Terms', /\d+ concepts? · Alpha renderings/, /Library · your organization · \d+/i,
      'Write a guide', 'Steps with text and audio, pictures, maps and key terms', /Study material · \d+/i, /Review questions · \d+/i,
      'Question sets for the same kind add up', /General · Alpha · \d+/i);
    await expectOnScreen(p, /Study guides · English/);
    if (d) await d.context.close();
  });
}

test('SETUP-050 Bibles: the organization\'s and a language\'s', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await setup(page);
  await text(page, 'Reference Material').click();
  await text(page, 'Bibles').click();
  await expectOnScreen(page, 'What the organization recommends to every language.', /Recommended · \d+/i);
  await back(page).click();
  await back(page).click();
  await languagePage(page, w, 'Alpha');
  await more(page);
  await text(page, 'Bibles, guides and notes').click();
  await text(page, 'Bibles').click();
  await expectOnScreen(page, 'What this language’s team is offered', /Recommended · \d+/i);
  // No Bible is in the local library: Recommend, Hide and Follow organization need the preview environment.
  await expectOnScreen(page, /No Bible is recommended here yet\.|Hidden for this language/);
});

test('SETUP-051 Add a Bible', async ({ page }) => {
  await alphaReference(page);
  await text(page, 'Bibles').click();
  await button(page, 'Add a Bible').click();
  await expectOnScreen(page, 'It is recommended here once added. Translators see whether it has audio and whether it can be kept offline.');
  const said = await screenText(page);
  // Bible Brain search needs a key on the local Worker; LangQuest's own Bibles need source@1 in the library.
  test.info().annotations.push({ type: 'bible brain', description: said.includes('This server does not offer Bible Brain search yet.') ? 'no key on this server' : 'searchable' });
  await closeSheet(page);
});

test('SETUP-052 Guides and notes, filtered', async ({ page }) => {
  await alphaReference(page);
  await text(page, 'Guides and notes').click();
  await expectOnScreen(page, 'Guides and Notes', 'Study guides and notes reach the passages they are placed on', 'New note for translators');
  await expectOnScreen(page, /FIA study guides \(English\)/, /Study guide · English/);
  await text(page, 'Filter').click();
  await text(page, 'Guides').click();
  await text(page, 'Covers this language’s passages').click();
  await button(page, /^Show \d+ items?$/).click();
  await expectOnScreen(page, /Filter · \d+/);
  await text(page, 'Clear').click();
  await expectOnScreen(page, 'Filter');
});

test('SETUP-053 Coverage and a passage\'s reference', async ({ page }) => {
  const w = world();
  await alphaReference(page);
  await text(page, 'Coverage').click();
  await expectOnScreen(page, 'Coverage', /\d+ passages/, /\d+ with a Bible · \d+ with a guide · \d+ with a note/, /\d+ passages without a guide or note/,
    'Nothing recommended reaches it', 'No guide');
  await text(page, /^No guide or note/).click();
  await text(page, /^All/).click();
  await page.getByRole('button', { name: /Luke 15:11–32/ }).first().click().catch(async () => {
    for (let i = 0; i < 12 && !(await page.getByText('Luke 15:11–32').count()); i++) await text(page, /^Show 25 more/).click();
    await text(page, 'Luke 15:11–32').click();
  });
  await expectOnScreen(page, 'What helps here');
  const guide = page.getByRole('radio', { name: 'Hide here' }).first();
  if (await guide.count()) {
    await guide.click();
    await expectToast(page, /is hidden on this passage\.$/);
    await undoToast(page);
    await page.getByRole('radio', { name: 'Hide here' }).first().click();
    await page.getByRole('radio', { name: 'Show here' }).first().click();
    await expectToast(page, /shows on this passage again\.$/);
  }
  await text(page, 'Add a help').click();
  await expectOnScreen(page, 'Write a note for translators', 'From your library');
  await closeSheet(page);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-054 Write a note and a question set', async ({ page, browser }) => {
  const w = world();
  const title = `Names in Luke ${w.run.slice(-4)}`;
  await alphaReference(page);
  await primary(page).click();
  await expectOnScreen(page, 'What kind', 'Translation Guidelines', 'Review Questions', 'Where it applies', 'Alpha', 'All languages');
  await field(page, 'Title').fill(title);
  await page.getByPlaceholder('Guidance for Body…').fill('Say each name the same way in every passage.');
  await primary(page).click();
  await expectToast(page, `${title} added.`);
  await text(page, title).click();
  await button(page, 'Publish to library').click();
  await expectToast(page, `${title} is in your library. Share it from there.`);
  await back(page).click();
  // A question set for the peer check.
  await primary(page).click();
  await text(page, 'Review Questions').click();
  await field(page, 'Title').fill(`Peer questions ${w.run.slice(-4)}`);
  // The kinds of review are listed by their kind names here ("Peer Review").
  await text(page, 'Peer Review').click();
  await page.getByPlaceholder('The question').first().fill('Does it sound natural?');
  await primary(page).click();
  await expectToast(page, `Peer questions ${w.run.slice(-4)} added.`);
  await expectSent(page, w);
  await expectNothingRefused(page, w);
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
  void browser;
});

test('SETUP-055 Library material: verses and numbering', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await setup(page);
  await text(page, 'Reference Material').click();
  await button(page, 'New').click();
  await expectOnScreen(page, /Verses|verses/);
  const verses = page.getByLabel(/Verses/).or(page.getByPlaceholder(/RUT 1:1-16|LUK/)).first();
  await verses.fill('LUK 15:11-32\nLUKE fifteen');
  await expectOnScreen(page, 'Could not read “LUKE fifteen”. Write them like RUT 1:1-16.');
  await verses.fill('LUK 15:11-32');
  await expectNotOnScreen(page, 'Could not read');
});

test('SETUP-056 Write a guide and publish it', async ({ page }) => {
  const w = world();
  const title = `The lost son ${w.run.slice(-4)}`;
  await alphaReference(page);
  await text(page, 'Write a guide').click();
  await expectOnScreen(page, 'Write a guide', 'Details', 'Steps', 'Media', 'Glossary');
  await button(page, 'Done').click();
  await expectToast(page, /things? to fix before publishing\./);
  await expectOnScreen(page, 'Before publishing', 'Give the guide a title.');
  await field(page, 'Title').fill(title);
  // The draft is kept on this device as it is written (decision 125): the header's saved mark turns into a check.
  await expect(byId(page, 'saved-mark')).toHaveAttribute('aria-label', 'Saved');
  // A new guide starts with FIA's six steps; choosing another start replaces them (a toast with Undo only once a step has words in it).
  await expectOnScreen(page, 'Now: 6 steps.');
  await text(page, 'One empty step').click();
  await expectOnScreen(page, 'Now: 1 step.');
  await text(page, 'FIA\'s six steps').click();
  await expectOnScreen(page, 'Now: 6 steps.');
  await page.getByLabel(/^Verses/).first().fill('LUK 15:11-32');
  await expectOnScreen(page, 'Numbered as in');
  await text(page, /^English · LangQuest|Like most English Bibles/).click().catch(() => undefined);
  await button(page, 'Done').click();
  await expectToast(page, `${title} is published. Devices get it when they next sync.`);
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

test('SETUP-057 Edit a guide; a draft is kept', async ({ page }) => {
  await alphaReference(page);
  await text(page, 'Write a guide').click();
  await field(page, 'Title').fill('Draft kept');
  // Kept on this device a moment after the change: the saved mark turns into a check.
  await expect(byId(page, 'saved-mark')).toHaveAttribute('aria-label', 'Saved');
  // Back leaves at once and publishes nothing; writing a guide again opens the draft as it was left.
  await back(page).click();
  await expect(byId(page, 'toast')).toHaveCount(0);
  await text(page, 'Write a guide').click();
  await expect(field(page, 'Title')).toHaveValue('Draft kept');
  await expect(byId(page, 'saved-mark')).toHaveAttribute('aria-label', 'Saved');
  void syncNow;
});
