// SETUP: New language, from Org home (docs/ui-test-suite/09-language-setup.md,
// SETUP-010 to SETUP-021, SETUP-075 to SETUP-078). Its six steps show first
// (decision 143): Start opens the first. Every test adds its own language, named with a
// run tag, so they leave each other's alone; the world is this file's own.
import type { Page } from '@playwright/test';
import {
  back, button, byId, deviceFor, expect, expectToast, field, openAs, primary, screenText, syncNow, tab, test, text, useWorld, type UiWorld
} from './support';
import { closeSheet, expectNotOnScreen, expectOnScreen, languagePage, orgHome } from './setup-helpers';

const world = useWorld();
const tag = () => world().run.slice(-4);

/** Open New language: its six steps, then Start (decision 143). */
async function startNewLanguage(page: Page): Promise<void> {
  await text(page, 'New language or cluster').click();
  await expectOnScreen(page, '6 steps', 'Language', 'Content', 'Split into pieces', 'Reference material', 'Review flow', 'People');
  await primary(page).click();
}

/** Step 1: the name (and a code), then Continue. */
async function nameStep(page: Page, name: string, code?: string): Promise<void> {
  await field(page, 'Its name').fill(name);
  if (code) await field(page, 'Its code, if it has one').fill(code);
  await primary(page).click();
}

/** Step 2: the Bible, numbered like World English, then a way (FIA passages by default), then Continue. */
async function bibleStep(page: Page, opts: { way?: string | RegExp; scope?: string; books?: string[] } = {}): Promise<void> {
  await expectOnScreen(page, /What will .* translate\?/);
  await text(page, 'The Bible').click();
  await primary(page).click();
  await expectOnScreen(page, 'Which Bible do you translate from?');
  await page.getByPlaceholder('NIV, Reina-Valera, Luther…').fill('World English');
  await text(page, 'World English Bible').click();
  await primary(page).click();
  await expectOnScreen(page, 'How should the Bible be broken up?');
  // "FIA passages" is LangQuest's (it comes with FIA's study guides); "FIA passages (English)" is the one Alpha follows.
  await text(page, opts.way ?? 'FIA passages').click();
  if (opts.scope) await text(page, opts.scope).click();
  for (const b of opts.books ?? []) await text(page, b).click();
  await primary(page).click();
}

/** Reference material as suggested: its languages, then what its team will have in them. */
async function materialStep(page: Page): Promise<void> {
  await expectOnScreen(page, /Bibles and study guides be in\?/);
  await primary(page).click();
  await expectOnScreen(page, /What will help .*’s team\?/);
  await primary(page).click();
}

/** Reference material and the review flow as suggested, its checks as they come, then Add; wait for the invite step. */
async function finish(page: Page): Promise<void> {
  await materialStep(page);
  await expectOnScreen(page, 'How will recordings get checked?');
  await primary(page).click();
  await expectOnScreen(page, /’s checks/);
  await primary(page).click();
  await expect(text(page, 'Time to invite people')).toBeVisible({ timeout: 60_000 });
}

async function addLanguage(page: Page, w: UiWorld, name: string, code?: string): Promise<void> {
  await orgHome(page, w);
  await startNewLanguage(page);
  await nameStep(page, name, code);
  await bibleStep(page);
  await finish(page);
}

test('SETUP-010 Create a language end to end @p0', async ({ page }) => {
  const w = world();
  const name = `Charlie ${tag()}`;
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await expectOnScreen(page, 'New language', '1 of 6 · Language');
  await nameStep(page, name, 'chr');
  await expectOnScreen(page, '2 of 6 · Content');
  await bibleStep(page);
  // Reference material comes before the review flow (decision 143): its languages, then what the team will have.
  await expectOnScreen(page, '4 of 6 · Reference material', `Which languages should ${name}'s Bibles and study guides be in?`);
  await primary(page).click();
  await expectOnScreen(page, `What will help ${name}’s team?`, 'Bibles and guides in English', 'Study guides', /FIA's study guides in English/);
  await primary(page).click();
  await expectOnScreen(page, '5 of 6 · Review flow', 'How will recordings get checked?', 'Standard Bible Flow', /Suggested · from /);
  await primary(page).click();
  // Its checks, on the pages a ready language sets them up on.
  await expectOnScreen(page, `${name}’s checks`, 'A translator records a version', 'Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval');
  await expect(primary(page)).toContainText(`Add ${name}`);
  await primary(page).click();
  await expectToast(page, `${name} added to ${w.orgName}.`);
  await expectOnScreen(page, '6 of 6 · People', 'Time to invite people', 'Translators', 'Checkers', 'Later');
  // Each role is a card with what it lets them do, one tap open, and its own Invite (decision 143).
  await text(page, 'What they may do').click();
  await expectOnScreen(page, 'Record', 'Ask for checks', `Only in ${name}`);
  await page.getByRole('button', { name: 'Invite', exact: true }).locator('visible=true').first().click();
  // Translators check too (decision 91): the code can put them on some of its checks first.
  await expectOnScreen(page, 'Which checks will they do?', 'Peer check', 'Community check');
  await text(page, 'Peer check').click();
  await primary(page).click();
  // The code is made on the server: Share as a link shows once it is.
  await expectOnScreen(page, 'Translators', 'Peer check', 'Ask them to scan this', 'Share as a link');
  await text(page, 'Done').click();
  await orgHome(page, w);
  await expect(text(page, name)).toBeVisible();
  await text(page, name).click();
  // A template, checks and an invite: ready, once the invite the server issued reaches this phone with the organization's stream.
  await expect.poll(async () => { await syncNow(page); return screenText(page); }, { timeout: 60_000 }).toContain('Ready · 0 translators');
  // Its Languages say whether it is linked to the language list (decision 138).
  await text(page, 'Languages').click();
  await expectOnScreen(page, 'Not linked yet: added offline, or not found there');
  await closeSheet(page);
  await primary(page).click();
  await expectOnScreen(page, 'Luke');
});

test('SETUP-011 Pick the language from the language list', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await field(page, 'Its name').fill('H');
  await page.waitForTimeout(1000); // sleep: the language search's typing debounce; absence of a search has no signal
  await expectNotOnScreen(page, 'Searching the language list…', 'Is it one of these?');
  await field(page, 'Its name').fill('Hadiyya');
  // The local language list is not seeded, so nothing is found: picking an entry needs the preview environment.
  await expect.poll(() => screenText(page), { timeout: 30_000 }).toMatch(/Is it one of these\?|Nothing in the language list goes by that name\./);
  if (/Nothing in the language list goes by that name\./.test(await screenText(page))) {
    await expectOnScreen(page, 'Not there? Continue anyway. It is added unlinked, and you can link it from its page later.');
    test.info().annotations.push({ type: 'note', description: 'The local language list returned nothing; picking an entry was not exercised.' });
    return;
  }
  await text(page, 'Is it one of these?').waitFor();
});

test('SETUP-012 Add a language offline, unlinked, and link it later', async ({ page }) => {
  const w = world();
  const name = `Delta ${tag()}`;
  await openAs(page, w, 'ADMIN');
  // Open New language online once, so its library documents are on this device.
  await orgHome(page, w);
  await startNewLanguage(page);
  await nameStep(page, 'Warm up');
  await bibleStep(page, { way: 'FIA passages (English)' });
  await materialStep(page);
  await expectOnScreen(page, 'How will recordings get checked?', 'Standard Bible Flow');
  await page.context().setOffline(true);
  await back(page).click();
  await orgHome(page, w);
  await startNewLanguage(page);
  await field(page, 'Its name').fill(name);
  await expectOnScreen(page, 'Can\'t search the language list', 'You can still add it. It is added unlinked; link it from its page once you are online.', 'Try again');
  await primary(page).click();
  await bibleStep(page, { way: 'FIA passages (English)' });
  await finish(page);
  // Offline it is added unlinked; what needs the server to be offered is named, to offer later (decisions 71, 76).
  await expectToast(page, new RegExp(`^${name} added to ${w.orgName}\\.( Offer .* under Reference material once you are online\\.)?`));
  await text(page, 'Later').click();
  await page.context().setOffline(false);
  await languagePage(page, w, name);
  await text(page, 'Languages').click();
  await expectOnScreen(page, 'Not linked yet: added offline, or not found there');
  // Linking is SETUP-008's; the local language list returns nothing to link to.
});

test('SETUP-013 A repeated language is warned about, not refused', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  const warning = `Alpha (ALP) is already here. Adding it again makes a separate language, and its work stays apart from the first. Go back and open that one if it is the same.`;
  for (const typed of ['alpha', 'Álpha!']) {
    await field(page, 'Its name').fill(typed);
    await expectOnScreen(page, `${w.orgName} may already have it`, warning);
  }
  await field(page, 'Its name').fill('Echo');
  await expect(text(page, `${w.orgName} may already have it`)).toHaveCount(0);
  await field(page, 'Its code, if it has one').fill('alp');
  await expectOnScreen(page, warning);
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  await expectOnScreen(page, '2 of 6 · Content');
});

test('SETUP-014 Choose which books a new language translates', async ({ page }) => {
  const w = world();
  const name = `Foxtrot ${tag()}`;
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await nameStep(page, name);
  await text(page, 'The Bible').click();
  await primary(page).click();
  await page.getByPlaceholder('NIV, Reina-Valera, Luther…').fill('World English');
  await text(page, 'World English Bible').click();
  await primary(page).click();
  await text(page, 'FIA passages').click();
  await expectOnScreen(page, '3 of 6 · Split into pieces', 'Which part of the Bible?', 'New Testament', 'Old Testament', 'Whole Bible', 'Choose books');
  await text(page, 'Choose books').click();
  await expectOnScreen(page, 'Mark', 'Luke');
  // A book chip says whether it is on (aria-pressed on the web).
  await expect(page.getByRole('button', { name: 'Mark', exact: true }).locator('visible=true').first()).toHaveAttribute('aria-pressed', 'true');
  // Choose books starts from the part picked before (the New Testament), to change: every book of the New Testament is on, so one tap each clears it.
  for (const book of ['Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
    'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
    'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation']) {
    const chip = text(page, book);
    if (await chip.count()) await chip.click();
  }
  await primary(page).click();
  await materialStep(page);
  await primary(page).click();
  await primary(page).click();
  await expectOnScreen(page, 'Not added', 'Choose at least one book.');
  // Back to the pieces and choose Mark and Luke: the checks, the flows, what helps, its languages.
  for (let i = 0; i < 4; i++) await text(page, 'Back').click();
  await expectOnScreen(page, 'How should the Bible be broken up?');
  await text(page, 'Mark').click();
  await text(page, 'Luke').click();
  await expect(page.getByRole('button', { name: 'Luke', exact: true }).locator('visible=true').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'John', exact: true }).locator('visible=true').first()).toHaveAttribute('aria-pressed', 'false');
  await primary(page).click();
  await finish(page);
  await text(page, 'Later').click();
  await tab(page, 'map').click();
  await text(page, name).click().catch(() => undefined);
  const map = await screenText(page);
  expect(map).toContain('Mark');
  expect(map).toContain('Luke');
  expect(map).not.toContain('Matthew');
  expect(map).not.toContain('John');
});

test('SETUP-015 Numbering is chosen first, by Bible, by list or by questions', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await nameStep(page, `Numbers ${tag()}`);
  await text(page, 'The Bible').click();
  await primary(page).click();
  // The ways are offered only after a numbering (decision 80).
  await expectNotOnScreen(page, 'How should the Bible be broken up?');
  await page.getByPlaceholder('NIV, Reina-Valera, Luther…').fill('zzzz');
  await expectOnScreen(page, 'Not found.');
  await text(page, 'Not listed? Answer a few questions').click();
  await expectOnScreen(page, 'Question 1', 'Which psalm is it in your Bible?');
  // Psalm 23 is "23", and its heading has no number: numbered like most English Bibles.
  await text(page, '23').click();
  await expectOnScreen(page, 'Which looks like Psalm 3 in your Bible?');
  await button(page, 'The heading has no number').click();
  await expectOnScreen(page, /Like .*/, 'Verse numbers in LangQuest will match your Bible.', 'Choose another');
  await text(page, 'Choose another').click();
  await text(page, 'Choose from the list').click();
  await expectOnScreen(page, 'Choose the numbering', 'Like most English Bibles', 'Like the Hebrew and Greek', 'Like the Latin Vulgate (Catholic)', 'Russian Synodal',
    'Russian Synodal (Orthodox)', '66 books', 'Malachi 3', 'Headings verse 1');
  await text(page, 'Like the Hebrew and Greek').click();
  await primary(page).click();
  await expectOnScreen(page, 'How should the Bible be broken up?');
  await text(page, 'How is material broken up?').click();
  await expectOnScreen(page, 'Skip the walk-through');
  await text(page, 'Skip the walk-through').click();
  await back(page).click();
});

test('SETUP-016 Adding a language names each part as it starts, and ✕ says wait', async ({ page }) => {
  const w = world();
  const name = `Golf ${tag()}`;
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await nameStep(page, name);
  await bibleStep(page);
  await materialStep(page);
  await primary(page).click();
  // A phone link: 12 Mbit/s down, 120 ms.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: 1_500_000, uploadThroughput: 750_000 });
  const started = Date.now();
  await primary(page).click();
  await expectOnScreen(page, `Setting up ${name}`, 'Getting the passages', 'Getting the review steps', `Adding ${name} to ${w.orgName}`,
    `Saving ${name}'s passages`, 'Keep the app open until this is done.');
  await byId(page, 'header-close').click();
  await expectToast(page, `Still adding ${name}. Please wait.`);
  await expect(text(page, 'Time to invite people')).toBeVisible({ timeout: 60_000 });
  const took = Date.now() - started;
  test.info().annotations.push({ type: 'took', description: `${took} ms` });
  expect(took).toBeLessThan(15_000);
});

test('SETUP-017 "Make your own" opens the template editor from New language', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await nameStep(page, `Songs lang ${tag()}`);
  await text(page, 'Something else').click();
  await expectOnScreen(page, 'Stories, songs, lessons');
  await expectOnScreen(page, /Your organization's own|There are no ready-made ones for this yet\./);
  await text(page, 'Make your own').click();
  await expectNotOnScreen(page, 'That can\'t be opened from here.');
  await expectOnScreen(page, 'New Template');
});

test('SETUP-018 A new language\'s checks are set up on their own pages before it exists @p0', async ({ page }) => {
  const w = world();
  const name = `Hotel ${tag()}`;
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await nameStep(page, name);
  await bibleStep(page);
  await materialStep(page);
  await text(page, 'Standard Bible Flow').click();
  await primary(page).click();
  // Its checks, from Standard Bible Flow's (decision 91), on the pages a ready language sets them up on (decision 143).
  await expectOnScreen(page, `${name}’s checks`, 'A translator records a version', 'Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval');
  await expectNotOnScreen(page, 'Start from a ready-made flow');
  // Take Final approval off: its own page, as on a ready language; removing asks first (decision 134).
  await text(page, 'Final approval').click();
  await expectOnScreen(page, 'People', 'Choose them as you invite', 'Questions', 'On their screen', 'Must pass', 'Same time as', 'Remove this check');
  await text(page, 'Remove this check').click();
  await primary(page).click();
  await expect(text(page, 'Final approval')).toHaveCount(0);
  // Add Retelling, at the same time as the Community check, picked from any check as on a ready language.
  await text(page, 'Add a check').click();
  await text(page, 'Retelling').click();
  await text(page, 'Community check').click();
  await text(page, 'Same time as').click();
  await text(page, 'Retelling').click();
  await text(page, 'Done').click();
  await expectOnScreen(page, 'Retelling');
  // Its people hear the Bible but do not read it.
  await text(page, 'Bible').click();
  await byId(page, 'toggle-part-bibleText').click();
  await back(page).click();
  await back(page).click();
  await expectOnScreen(page, `${name}’s checks`, 'Bible text');
  await expect(primary(page)).toContainText(`Add ${name}`);
  await primary(page).click();
  await expect(text(page, 'Time to invite people')).toBeVisible({ timeout: 60_000 });
  await text(page, 'Later').click();
  await languagePage(page, w, name);
  await expectOnScreen(page, /Peer check \+ back translation → Community check \+ retelling → Consultant check/i);
  await expectNotOnScreen(page, 'Final approval');
  // What was set before it existed is the language's own now: its Checks say the Community check hides the Bible's text.
  await text(page, 'Who checks the recordings?').click();
  await text(page, 'I\'ll choose the checks').click();
  await primary(page).click();
  await expectOnScreen(page, 'Checks', 'Community check', 'Bible text');
});

test('SETUP-019 The language of a new team\'s Bibles and guides', async ({ page }) => {
  const w = world();
  const name = `Lima ${tag()}`;
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await nameStep(page, name);
  await bibleStep(page);
  // As many languages as the team reads; each line says what LangQuest has in it, with no sentence above (decision 130).
  await expectOnScreen(page, `Which languages should ${name}'s Bibles and study guides be in?`);
  await expectNotOnScreen(page, 'reads best');
  await expectOnScreen(page, 'English', /FIA guides for \d+ passages?/);
  await text(page, 'Another language').click();
  await page.getByPlaceholder('Search for a language').fill('French');
  await expectOnScreen(page, /French/);
  // Then what the team will have in its languages, the suggestion ticked (decision 143).
  await primary(page).click();
  await expectOnScreen(page, `What will help ${name}’s team?`, 'Bibles and guides in English');
  await expect(page.getByRole('checkbox', { name: /FIA's study guides in English/ }).locator('visible=true').first()).toBeChecked();
  await byId(page, 'header-close').click();
});

test('SETUP-020 New language\'s invite step, or later', async ({ page }) => {
  const w = world();
  const name = `India ${tag()}`;
  await openAs(page, w, 'ADMIN');
  await addLanguage(page, w, name);
  await text(page, 'Later').click();
  await languagePage(page, w, name);
  await expectOnScreen(page, `Get ${name} ready`, 'Invite your translators');
  await expect(primary(page)).toContainText('Invite your translators');
  await tab(page, 'work').click();
  await expectOnScreen(page, `Get ${name} ready · 3 of 4`, 'Invite your translators', 'Choose');
});

test('SETUP-021 Only organization-scope setters add languages', async ({ page, browser }) => {
  const w = world();
  const name = `Juliet ${tag()}`;
  await openAs(page, w, 'COORD');
  await addLanguage(page, w, name);
  await text(page, 'Later').click();
  await orgHome(page, w);
  await expect(text(page, name)).toBeVisible();

  const lead = await deviceFor(browser, w, 'LADMIN');
  const p = lead.page;
  await tab(p, 'manage').click();
  await byId(p, 'header-up').click();
  await expect(text(p, w.orgName).first()).toBeVisible();
  await expect(text(p, 'New language or cluster')).toHaveCount(0);
  await tab(p, 'work').click();
  await expectNotOnScreen(p, 'Add a language');
  await lead.context.close();
});

test('SETUP-074 A cluster of a new language and one already here, then ungrouped @p0', async ({ page }) => {
  // A cluster is a name on some languages (decision 108, demo ADR-045): made in New language, shown on Org home and its own page.
  const w = world();
  const cluster = `Cluster ${tag()}`;
  const name = `Kilo ${tag()}`;
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await startNewLanguage(page);
  await expectOnScreen(page, 'What are you adding?', 'One language', 'A cluster of languages');
  await text(page, 'A cluster of languages').click();
  await field(page, "The cluster's name").fill(cluster);
  // The local language list is not seeded: the name is added as typed.
  await field(page, 'Add a language').fill(name);
  await button(page, `Add “${name}”`).click();
  await button(page, 'Bravo').click();
  await expectOnScreen(page, 'Its languages · 2', 'Languages already here keep everything they have. The new one is set up in the next steps.');
  await primary(page).click();
  await bibleStep(page);
  await materialStep(page);
  await expectOnScreen(page, 'How will recordings get checked?', `For the new language in ${cluster}. It can change its own later.`);
  await primary(page).click();
  await expect(primary(page)).toContainText(`Add ${cluster}`);
  await primary(page).click();
  await expect(text(page, 'Time to invite people')).toBeVisible({ timeout: 60_000 });
  await expectToast(page, `1 language added to ${w.orgName}, in ${cluster}.`);
  await text(page, 'Later').click();
  // Org home: the cluster above the languages in none; Bravo is under it now.
  await orgHome(page, w);
  await expectOnScreen(page, cluster, `2 languages · Bravo, ${name}`);
  await expect(text(page, 'Bravo')).toHaveCount(0);
  await text(page, cluster).click();
  await expectOnScreen(page, `Cluster · 2 languages`, 'Its languages', 'Bravo', name, 'Add a language to it');
  // Ungrouping takes the name off; both languages stay.
  await button(page, 'Ungroup').click();
  await expectOnScreen(page, `Ungroup ${cluster}?`, 'Its 2 languages stay, with their people, recordings and checks. Only the name that groups them goes.');
  await button(page, 'Ungroup').click();
  await expectToast(page, `${cluster} ungrouped. Its languages are still here.`);
  await orgHome(page, w);
  await expect(text(page, 'Bravo')).toBeVisible();
  await expect(text(page, name)).toBeVisible();
  await expect(text(page, cluster)).toHaveCount(0);
});
