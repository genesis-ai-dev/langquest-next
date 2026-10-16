// SETUP: the organization's home, a language's page and its More, Get
// ready, content templates and the licence (docs/ui-test-suite/09-language-setup.md).
// New language is in 09-language-setup-new.spec.ts, the checks and review
// flows in 09-language-setup-checks.spec.ts, reference material in
// 09-language-setup-reference.spec.ts, and the language lead's scope in
// 09-language-setup-ladmin.spec.ts. Tests here share one world and run in
// ID order; each puts back what it changes unless it says "Resets".
import {
  back, button, byId, deviceFor, expect, expectNothingRefused, expectSent, expectToast, field, openAs, openSignedOut, primary, screenText, syncNow, tab, test,
  text, useWorld, waitForApp
} from './support';
import { closeSheet, addBareLanguage, contentTemplate, eachBook, expectNotOnScreen, expectOnScreen, expectOrgSent, goBack, languageChecks, languagePage, orgHome, listingOf, openAsIn, orgRefused, publiclyListed, referenceLibrary, referenceMaterial, reviewFlows, setup, switchNamed } from './setup-helpers';

const world = useWorld();

test('SETUP-001 Org home shows the organization, its languages and its setup', async ({ page }) => {
  await openAs(page, world(), 'ADMIN');
  await orgHome(page, world());
  const w = world();
  // 8 people hold a role in ORG: ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW, KEPT.
  await expectOnScreen(page, '2 languages · 8 members', 'Invite people', 'Alpha', 'Bravo', 'New language', 'Members', '3 at org level · 8 total');
  await expectOnScreen(page, /Alpha Standard Bible Flow · \d+ of \d+ recorded · \d+ done/);
  await setup(page);
  await expectOnScreen(page, 'Content templates', 'Reference material', 'Review flows', 'Roles', '7 roles at this level and above', 'All rights reserved');
  // The name and licence are changed beside the name, not in Setup (decision 137).
  await expect(byId(page, 'org-rename')).toBeVisible();
  await expect(text(page, w.orgName).first()).toBeVisible();
  await text(page, 'Alpha').click();
  await expect(text(page, 'Content template')).toBeVisible();
  await expect(back(page)).toBeVisible();

  // COORD sees the same home.
  const coord = await deviceFor(page.context().browser()!, w, 'COORD');
  await orgHome(coord.page, w);
  await expectOnScreen(coord.page, '2 languages · 8 members', 'Invite people', 'New language');
  await coord.context.close();
});

test('SETUP-002 Only an organization admin renames the organization and changes its licence', async ({ page }) => {
  const w = world();
  // COORD: Org home from the Manage tab.
  await openAs(page, w, 'COORD');
  await orgHome(page, w);
  await expect(page.getByTestId('org-rename')).toHaveCount(0);
  await button(page, /^(License: )?All rights reserved/).click();
  await expectOnScreen(page, 'Who may use your work', 'Only an organization admin can change this.');
  await expectNotOnScreen(page, 'Open to ', 'Pick a more open license');

  // LADMIN: Org home from Alpha's page, where Back would be (decision 137).
  const lead = await deviceFor(page.context().browser()!, w, 'LADMIN');
  const p = lead.page;
  await tab(p, 'manage').click();
  await byId(p, 'header-up').click();
  await expect(text(p, w.orgName).first()).toBeVisible();
  await expect(text(p, 'New language or cluster')).toHaveCount(0);
  await expect(p.getByTestId('org-rename')).toHaveCount(0);
  await button(p, /^(License: )?All rights reserved/).click();
  await expectOnScreen(p, 'Only an organization admin can change this.');
  await closeSheet(p);
  await text(p, 'Invite people').click();
  await expect(text(p, 'Invite someone')).toBeVisible();
  await expectNotOnScreen(p, 'All of them');
  await lead.context.close();
});

test('SETUP-003 Rename the organization', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await byId(page, 'org-rename').click();
  await expectOnScreen(page, 'Rename the organization', 'Its members see the new name, and so does anyone asking to join it.');
  const save = button(page, 'Save the name');
  await expect(save).toBeDisabled();
  const name = field(page, 'Its name');
  await name.fill('');
  await expect(save).toBeDisabled();
  const renamed = `${w.orgName} Renamed`;
  await name.fill(renamed);
  await save.click();
  await expectToast(page, `Renamed to ${renamed}.`);
  await expect(text(page, renamed).first()).toBeVisible();

  // A second device, TRANS, sees the new name after sync (Me shows the organization).
  const trans = await deviceFor(page.context().browser()!, w, 'TRANS');
  await syncNow(trans.page);
  await tab(trans.page, 'me').click();
  await text(trans.page, 'More settings').click();
  await expect.poll(async () => { await syncNow(trans.page); return screenText(trans.page); }, { timeout: 30_000 }).toContain(renamed);
  await trans.context.close();

  // Put it back.
  await byId(page, 'org-rename').click();
  await field(page, 'Its name').fill(w.orgName);
  await button(page, 'Save the name').click();
  await expectToast(page, `Renamed to ${w.orgName}.`);
  await expectOrgSent(page, w);
});

for (const who of ['ADMIN', 'COORD'] as const) {
  test(`SETUP-004 ${who} A language that is not ready shows the Get ready checklist`, async ({ page }) => {
    const w = world();
    const d = who === 'ADMIN' ? { page } : await deviceFor(page.context().browser()!, w, who);
    const p = d.page;
    if (who === 'ADMIN') await openAs(p, w, who);
    await languagePage(p, w, 'Bravo');
    await expectOnScreen(p, 'Get Bravo ready', 'What will they record?', 'What will help them?', 'Who checks the recordings?', 'Invite your translators');
    // The order of the four questions.
    const all = await screenText(p);
    const at = ['What will they record?', 'What will help them?', 'Who checks the recordings?', 'Invite your translators'].map((q) => all.indexOf(q));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    await expect(primary(p)).toContainText('What will they record?');
    // "How this works" is offered on the checklist; tapping it turns help on and says how (decision 71, amended 2026-10-10).
    await expect(text(p, /How this works · 0:40/)).toBeVisible();
    // No More: See their work, Roles, Languages and the public list are on the page (decision 137).
    await expectOnScreen(p, 'See their work', 'Roles', 'Languages', 'Show on the public list');
    await expectNotOnScreen(p, 'More');
    await text(p, 'What will help them?').click();
    await expectOnScreen(p, 'Get Bravo ready', '2 of 4');
    if (who !== 'ADMIN') await (d as { context: { close(): Promise<void> } }).context.close();
  });
}

for (const who of ['ADMIN', 'COORD', 'LADMIN'] as const) {
  test(`SETUP-005 ${who} A ready language shows its summary and "See their work"`, async ({ page }) => {
    const w = world();
    const d = who === 'ADMIN' ? null : await deviceFor(page.context().browser()!, w, who);
    const p = d?.page ?? page;
    if (!d) await openAs(p, w, who);
    if (who === 'LADMIN') {
      await tab(p, 'manage').click();
      await expect(text(p, 'Content template')).toBeVisible();
      await expect(back(p)).toHaveCount(0);
      await expect(byId(p, 'header-up')).toHaveAccessibleName(w.orgName);
    } else {
      await languagePage(p, w, 'Alpha');
    }
    // TRANS, TREV and KEPT translate at Alpha; people who also assign work are not counted.
    // One name for each thing, its line this language's pick (decision 137).
    await expectOnScreen(p, 'Alpha', 'Ready · 3 translators', 'Content template', 'Reference material', 'Review flow', 'People', '3 translators · invite more', 'Roles');
    // The Review flow row says the order of the checks (decision 91).
    await expectOnScreen(p, /Review flow Peer check \+ back translation → Community check → Consultant check → Final approval/);
    await languageChecks(p);
    await expectOnScreen(p, 'A translator records a version', 'Add a check');
    await expect(text(p, 'Alpha')).toBeVisible();
    await goBack(p, 'All review flows');
    await goBack(p, 'Content template');
    await contentTemplate(p);
    await expectOnScreen(p, 'FIA passages (English)', 'Each book\'s passages', 'Which books', 'All content templates');
    await text(p, 'Which books').click();
    await expectOnScreen(p, 'What to translate', 'What will Alpha translate?');
    await goBack(p, 'All content templates');
    await goBack(p, 'Content template');
    await primary(p).click();
    await expect.poll(() => screenText(p)).toMatch(/Luke/);
    if (d) await d.context.close();
  });
}

for (const who of ['ADMIN', 'LADMIN'] as const) {
  test(`SETUP-006 ${who} A ready language\'s page holds its settings, with no More`, async ({ page }) => {
    const w = world();
    const d = who === 'ADMIN' ? null : await deviceFor(page.context().browser()!, w, who);
    const p = d?.page ?? page;
    if (!d) { await openAs(p, w, who); await languagePage(p, w, 'Alpha'); } else await tab(p, 'manage').click();
    // While Alpha's events are still arriving the page can read as not ready; wait for the language as it is.
    await expect(text(p, 'Ready · 3 translators')).toBeVisible({ timeout: 60_000 });
    // Seven rows (decision 137): the work, the people, the language itself. No More, nothing twice.
    await expectOnScreen(p, 'Content template', 'Reference material', 'Review flow', 'People', 'Roles', '7 roles', 'Languages', 'Show on the public list');
    await expectNotOnScreen(p, 'More', 'Members', 'Every way to divide the work', 'Bibles, guides and notes', 'Every way to check', 'In the language list',
      'The organization\'s page', 'Review groups');
    // Its name and clusters are at the top, where they show: a pencil, and a chip to put it in a cluster.
    if (who === 'ADMIN') await expectOnScreen(p, 'Cluster');
    await expect(byId(p, 'title-rename')).toBeVisible();
    await text(p, 'Roles').click();
    await expectOnScreen(p, 'Roles', who === 'ADMIN' ? 'Organization' : 'Language');
    await goBack(p, 'Content template');
    // Each pick ends with the organization's whole shelf.
    await contentTemplate(p);
    await text(p, 'All content templates').click();
    await expectOnScreen(p, 'Content templates', 'By language');
    await goBack(p, 'All content templates');
    await goBack(p, 'Reference material');
    await referenceLibrary(p);
    await expectOnScreen(p, 'Reference material', 'What translators are offered');
    await goBack(p, 'All reference material');
    await goBack(p, 'Review flow');
    await reviewFlows(p);
    await expectOnScreen(p, 'Review flows', 'Alpha uses');
    await goBack(p, 'All review flows');
    await goBack(p, 'Languages');
    // Languages: the one they translate into, and the ones they understand.
    await text(p, 'Languages').click();
    await expectOnScreen(p, 'They translate into', 'They understand');
    await text(p, 'They understand').click();
    await expectOnScreen(p, 'Which languages should Alpha\'s Bibles and study guides be in?');
    await goBack(p, 'Content template');
    if (d) await d.context.close();
  });
}

for (const who of ['ADMIN', 'LADMIN'] as const) {
  test(`SETUP-007 ${who} Rename a language, warned about a repeated name`, async ({ page }) => {
    const w = world();
    const d = who === 'ADMIN' ? null : await deviceFor(page.context().browser()!, w, who);
    const p = d?.page ?? page;
    if (!d) { await openAs(p, w, who); await languagePage(p, w, 'Alpha'); } else await tab(p, 'manage').click();
    // Let the organization's stream catch up first: the earlier renames arriving would redraw the page under the sheet.
    await syncNow(p);
    await byId(p, 'title-rename').click();
    await expectOnScreen(p, 'Rename Alpha', `Everyone in ${w.orgName} sees the new name. Its code, ALP, stays.`);
    await field(p, 'Its name').fill('Bravo');
    await expectOnScreen(p, 'That name is taken here', 'Bravo (BRA) already has this name. Two languages with one name are hard to tell apart.');
    await expect(button(p, 'Save the name')).toBeEnabled();
    await field(p, 'Its name').fill('Alpha Renamed');
    await button(p, 'Save the name').click();
    await expectToast(p, 'Renamed to Alpha Renamed.');
    await expect(text(p, 'Alpha Renamed').first()).toBeVisible();
    await byId(p, 'title-rename').click();
    await field(p, 'Its name').fill('Alpha');
    await button(p, 'Save the name').click();
    await expectToast(p, 'Renamed to Alpha.');
    await expectOrgSent(p, w);
    expect(await orgRefused(p, w)).toEqual([]);
    if (d) await d.context.close();
  });
}

test('SETUP-008 Link a language to the language list', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Bravo');
  await expectOnScreen(page, 'Languages', 'Link it');
  await text(page, 'Languages').click();
  await expectOnScreen(page, 'They translate into', 'Not linked yet: added offline, or not found there');
  await text(page, 'They translate into').click();
  await expectOnScreen(page, 'Link Bravo', 'Find it by any of its names or its code. It keeps the name Bravo here, and takes the list\'s code.');
  await field(page, 'Its name or code').fill('bra');
  // The local language list is empty (the languoid tables are not seeded locally): nothing is found.
  // Picking an entry, the toast and "Linked to …" need a seeded list (preview environment).
  await expect.poll(() => screenText(page), { timeout: 30_000 })
    .toMatch(/Is it one of these\?|Not there\? Try another of its names, or its code\.|Connect to the internet to search it\./);
  const found = /Is it one of these\?/.test(await screenText(page));
  test.info().annotations.push({ type: 'note', description: found ? 'The language list answered.' : 'The local language list returned nothing; linking was not exercised.' });
  await expect(button(page, 'Link it')).toBeDisabled();
});

test('SETUP-009 Show a language on the public list', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  const listed = switchNamed(page, /Show on the public list/);
  await expect(listed).toBeChecked({ timeout: 20_000 });

  // Signed out, Explore reads the public listing (decision 66).
  const guest = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const g = await guest.newPage();
  await openSignedOut(g);
  await text(g, 'Browse public work').click();
  await expect(text(g, 'Explore')).toBeVisible();
  await guest.close();
  expect(await listingOf(w, 'A')).toBe(true);
  const flip = () => text(page, 'Show on the public list').click();
  await flip();
  await expect(listed).not.toBeChecked();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect.poll(() => listingOf(w, 'A')).toBe(false);
  // Unlisting takes it off Explore at once; listing puts it back at the next projection pass.
  expect(await publiclyListed(w, 'A')).toBe(false);
  await flip();
  await expect(listed).toBeChecked();
  await expect.poll(() => listingOf(w, 'A')).toBe(true);

  // Offline: the switch keeps its state and the page says it could not change it.
  await page.context().setOffline(true);
  await flip();
  await expectOnScreen(page, 'Could not read or change the listing', 'Try again when connected.');
  await expect(listed).toBeChecked();
  await page.context().setOffline(false);
});

// ---- Get ready ----------------------------------------------------------------------------------

test('SETUP-022 Get a language ready, question by question @p0', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'COORD', { language: 'B' });
  await languagePage(page, w, 'Bravo');
  await text(page, 'What will they record?').click();
  await expectOnScreen(page, 'Get Bravo ready', '1 of 4');
  await expect(byId(page, 'header-close')).toBeVisible();
  await text(page, 'The Bible').click();
  await primary(page).click();
  await text(page, 'Like most English Bibles').click();
  await primary(page).click();
  await text(page, 'FIA passages').click();
  await primary(page).click();
  // A first answer has nothing to go back to: no Undo.
  await expectToast(page, /^Bravo translates .*\./);
  // The language of the Bibles and guides: English already, so no toast.
  await expectOnScreen(page, '2 of 4', 'Which languages should Bravo\'s Bibles and study guides be in?');
  await primary(page).click();
  await expectOnScreen(page, 'What will help them?', 'Bibles they understand');
  // The local library has no Bible (no source@1 is seeded): there is none to tick here.
  await primary(page).click();
  await expectOnScreen(page, '3 of 4', 'Who checks the recordings?', 'Suggested');
  await primary(page).click();
  await expectToast(page, /checks the recordings\.$/);
  await expectOnScreen(page, '4 of 4', 'Invite your translators', 'Translate', 'Check', 'Back-translate', 'Help run the team', 'Something else');
  await expectOnScreen(page, 'Ask them to scan this', 'Share as a link');
  await text(page, 'Done').click();
  await expectOnScreen(page, 'Bravo', 'Ready · 0 translators', 'Content template', 'Reference material', 'Review flow', 'People');

  // TRANS has no role at Bravo: nothing about it reaches their phone.
  const trans = await deviceFor(browser, w, 'TRANS');
  await syncNow(trans.page);
  await tab(trans.page, 'map').click();
  await expectNotOnScreen(trans.page, 'Bravo');
  await trans.context.close();
});

test('SETUP-023 ADMIN My Work leads with "Get ‹language› ready · n of 4"', async ({ page }) => {
  const w = world();
  // Bravo is ready now (SETUP-022): a second language with nothing chosen.
  const mike = await addBareLanguage(w, 'Mike', 'mik');
  await openAsIn(page, w, 'ADMIN', mike);
  await tab(page, 'work').click();
  // What will help them is answered already: the organization offers FIA's English guides to every language.
  await expectOnScreen(page, 'Get Mike ready · 1 of 4', 'What will they record?', 'Choose');
  await text(page, 'Choose').click();
  await expectOnScreen(page, 'Get Mike ready', '1 of 4');
  await text(page, 'The Bible').click();
  await primary(page).click();
  await text(page, 'Like most English Bibles').click();
  await primary(page).click();
  await text(page, 'FIA passages').click();
  await primary(page).click();
  await expectToast(page, /^Mike translates/);
  await byId(page, 'header-close').click();
  await tab(page, 'work').click();
  await expectOnScreen(page, 'Get Mike ready · 2 of 4', 'Who checks the recordings?');
  await expect(page.getByLabel('2 of 4 questions answered')).toHaveCount(1);
  await languagePage(page, w, 'Mike');
  await expectOnScreen(page, 'Get Mike ready');
});

// With Alpha open (ready) there is no card; TRANS, REV and VIEW never see one.
for (const who of ['ADMIN', 'TRANS', 'REV', 'VIEW'] as const) {
  test(`SETUP-023 ${who} No Get ready card on a ready language`, async ({ browser }) => {
    const d = await deviceFor(browser, world(), who);
    if (who !== 'VIEW') await tab(d.page, 'work').click();
    await expect.poll(() => screenText(d.page)).not.toMatch(/Get .* ready · \d of 4/);
    await d.context.close();
  });
}

for (const who of ['ADMIN', 'LADMIN'] as const) {
  test(`SETUP-024 ${who} Change what a ready language translates, and change it back`, async ({ page }) => {
    const w = world();
    const d = who === 'ADMIN' ? null : await deviceFor(page.context().browser()!, w, who);
    const p = d?.page ?? page;
    if (!d) { await openAs(p, w, who); await languagePage(p, w, 'Alpha'); } else await tab(p, 'manage').click();
    // Content template › Which books: the question that chose it (decision 137).
    await contentTemplate(p);
    await text(p, 'Which books').click();
    await expectOnScreen(p, 'What to translate', 'Alpha');
    await primary(p).click();
    await primary(p).click();
    await expect(primary(p)).toContainText('Keep it');
    await text(p, 'Whole Bible').click();
    await expect(primary(p)).toContainText('Use this');
    await expectOnScreen(p, 'Pieces that stay the same keep their recordings. What was recorded on a piece that changes is kept under "Earlier sections" on the new pieces.');
    await primary(p).click();
    await expectToast(p, /^Alpha translates .*\./);
    // No toast offers Undo (decision 134): the same step chooses the New Testament again.
    await text(p, 'Which books').click();
    await expectOnScreen(p, 'What to translate', 'Alpha');
    await primary(p).click();
    await primary(p).click();
    await expect(primary(p)).toContainText('Keep it');
    await text(p, 'New Testament').click();
    await expect(primary(p)).toContainText('Use this');
    await primary(p).click();
    await expectToast(p, /^Alpha translates .*New Testament.*\./);
    await goBack(p, 'Content template');
    await expectOnScreen(p, 'Bible stories · New Testament');
    await expectSent(p, w);
    await expectNothingRefused(p, w);
    if (d) await d.context.close();
  });
}

test('SETUP-026 What will help them: FIA\'s language', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  await referenceMaterial(page);
  await expectOnScreen(page, 'Reference material', 'FIA study guides');
  // The guide set's row: its switch opens the language sheet.
  await text(page, 'FIA study guides').click();
  await expectOnScreen(page, 'Which language should FIA be in?', 'It comes in 5 languages. Choose the one Alpha\'s team reads best.', 'Keep English', 'Don\'t offer FIA');
  await text(page, 'French').click();
  await text(page, 'Use French').click();
  await expectToast(page, 'FIA study guides are now in French');
  await expectSent(page, w);
  // Back to English.
  await text(page, 'FIA study guides').click();
  await text(page, 'English').click();
  await text(page, 'Use English').click();
  await expectToast(page, 'FIA study guides are now in English');
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-027 What will help them: Bibles, study guides and notes', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  await referenceMaterial(page);
  // No Bible is in the local library (no source@1): the Bible rows, ticking and the play button need the preview environment.
  await expectOnScreen(page, 'No Bibles yet');
  // A guide that is not a set turns off and on with the same row; no toast offers Undo (decision 134).
  const example = text(page, 'Example study guides');
  if (await example.count()) {
    await example.click();
    const said = (await (await expectToast(page, /Example study guides/)).innerText()).trim();
    await example.click();
    await expect.poll(async () => (await byId(page, 'toast').innerText()).trim()).not.toBe(said);
    await expectToast(page, /Example study guides/);
  }
  await text(page, 'Add more').click();
  await text(page, 'A Bible').click();
  await expectOnScreen(page, 'Bibles', 'Add a Bible');
  await expectSent(page, w);
  await expectNothingRefused(page, w);
});

test('SETUP-028 The "Reference material" page and "Add more"', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  await referenceMaterial(page);
  await expectOnScreen(page, 'Reference material', 'Bibles', 'Study guides', 'Key words', 'Key terms', /\d+ words? · \d+ with a Alpha word/, 'Notes for translators');
  // Last, the organization's whole shelf (decision 137), not a row in Add more.
  await expectOnScreen(page, 'No Bibles yet', 'No notes yet', 'Add more to offer some', /passages? covered/, 'All reference material');
  await text(page, 'Add more').click();
  await expectOnScreen(page, 'A Bible', 'A study guide', 'A note for translators', 'Key words');
  await expectNotOnScreen(page, 'Everything in your library');
  await text(page, 'Words to say the same way every time').click();
  await expectOnScreen(page, 'Key Terms');
});

test('SETUP-029 Invite your translators: other roles, and a new role', async ({ page }) => {
  const w = world();
  // Get ready's question 4 belongs to a language that is not ready yet.
  const november = await addBareLanguage(w, 'November', 'nov');
  await openAsIn(page, w, 'ADMIN', november);
  await languagePage(page, w, 'November');
  await text(page, 'Invite your translators').click();
  await expectOnScreen(page, '4 of 4', 'Translate', 'Something else');
  await text(page, 'Something else').click();
  await expectOnScreen(page, 'Something else: make a new role');
  await text(page, 'Check').click();
  await expectOnScreen(page, 'Ask them to scan this');
  await text(page, 'Done').click();
  await expectOnScreen(page, 'Get November ready');
});

test('SETUP-030 What counts as ready', async ({ page }) => {
  const w = world();
  const kilo = await addBareLanguage(w, 'Kilo', 'kil');
  await openAsIn(page, w, 'ADMIN', kilo);
  await languagePage(page, w, 'Kilo');
  // Question 1, then leave at question 2.
  await text(page, 'What will they record?').click();
  await text(page, 'The Bible').click();
  await primary(page).click();
  await text(page, 'Like most English Bibles').click();
  await primary(page).click();
  await text(page, 'FIA passages').click();
  await primary(page).click();
  await expectToast(page, /^Kilo translates/);
  await byId(page, 'header-close').click();
  // Question 3 by choosing the checks, which comes back to question 3 without opening question 4.
  await text(page, 'Who checks the recordings?').click();
  await text(page, 'I\'ll choose the checks').click();
  await primary(page).click();
  await text(page, 'Add a check').click();
  await text(page, 'Community check').click();
  await expectToast(page, 'Kilo\'s checks saved');
  await back(page).click();
  await expectOnScreen(page, 'In use · your own steps');
  await byId(page, 'header-close').click();
  // ADMIN, COORD and VIEW hold organization-scope roles: they do not make it ready.
  await expectOnScreen(page, 'Get Kilo ready');
  await expect(primary(page)).toContainText('Invite your translators');
  // Opening question 4 issues a code, and an issued invite counts.
  await primary(page).click();
  await expectOnScreen(page, 'Ask them to scan this');
  await text(page, 'Done').click();
  await expectOnScreen(page, 'Ready · 0 translators');
});

// ---- Content templates ---------------------------------------------------------------------------

/** Org home → Setup → Content templates. */
async function contentTemplates(page: import('@playwright/test').Page, w: ReturnType<typeof world>): Promise<void> {
  await orgHome(page, w);
  await setup(page);
  await text(page, 'Content templates').click();
  await expectOnScreen(page, 'Content templates', 'A template is the structure a language records against');
}

/** A kit Card holding this title and a button with this name. */
const cardWith = (page: import('@playwright/test').Page, title: string, name: string) => page.locator('div')
  .filter({ has: page.getByText(title, { exact: true }) })
  .filter({ has: page.getByRole('button', { name, exact: true }) }).last();

for (const who of ['ADMIN', 'COORD'] as const) {
  test(`SETUP-031 ${who} Content templates for the organization`, async ({ page, browser }) => {
    const w = world();
    const d = who === 'ADMIN' ? null : await deviceFor(browser, w, who);
    const p = d?.page ?? page;
    if (!d) await openAs(p, w, who);
    await contentTemplates(p, w);
    await expectOnScreen(p, w.orgName, 'Template', 'FIA passages (English)', 'Following LangQuest · updates automatically', 'Used by Alpha');
    await expectOnScreen(p, /From other organizations/i, /From LangQuest/);
    // Alpha's template is followed from LangQuest: its options are how it follows.
    await cardWith(p, 'FIA passages (English)', 'Options').getByRole('button', { name: 'Options', exact: true }).click();
    await expectOnScreen(p, 'Update automatically', 'Stop following', 'Copy to change it');
    await closeSheet(p);
    await cardWith(p, 'FIA passages (English)', 'View').getByRole('button', { name: 'View', exact: true }).click();
    await expectOnScreen(p, 'It follows LangQuest', 'Its versions come from there. Copy it to change it.');
    await back(p).click();
    if (d) await d.context.close();
  });
}

test('SETUP-032 "By language" rows on Content templates', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await contentTemplates(page, w);
  await page.getByText('Alpha', { exact: true }).last().click();
  // Known issue: flow.ts has no templates_home → templates_home edge.
  await expect(page.getByTestId('toast').filter({ hasText: 'That can\'t be opened from here.' })).toHaveCount(0);
  // A language's row opens its books, each to divide (decision 137).
  await expectOnScreen(page, 'Each book\'s passages', 'Alpha', 'Luke');
});

test('SETUP-033 Follow or copy a template another organization shares', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await contentTemplates(page, w);
  await page.getByRole('button', { name: 'By chapter, from LangQuest' }).click();
  await expectOnScreen(page, /From LangQuest · \d+ versions?/, 'Follow', 'Use LangQuest\'s versions as they publish them.', 'Copy', 'Make it ours to change.');
  await text(page, 'Follow').click();
  await text(page, 'Update automatically').click();
  await expectToast(page, 'Following By chapter from LangQuest.');
  // No toast offers Undo (decision 134): its Options stop following it, and then offer "Follow again" in its place.
  const options = () => cardWith(page, 'By chapter', 'Options').getByRole('button', { name: 'Options', exact: true }).click();
  await options();
  await text(page, 'Stop following').click();
  await expectToast(page, /^Stopped following By chapter\./);
  await options();
  await expect(text(page, 'Stop following')).toHaveCount(0);
  await text(page, 'Follow again').click();
  await expectToast(page, 'Following LangQuest again.');
  // Updates by hand, as the next tests expect: the switch in its Options.
  await options();
  await page.locator('input[role="switch"]').and(page.getByRole('switch', { name: 'Update automatically', exact: true })).last().dispatchEvent('click');
  await expectToast(page, 'You take By chapter\'s updates.');
  await closeSheet(page);
  await page.getByRole('button', { name: 'OpenBible: long sections, from LangQuest' }).click();
  await text(page, 'Copy').click();
  await expectToast(page, 'OpenBible: long sections copied. The copy is yours to change.');
  await expectOnScreen(page, /copied from LangQuest/);
  // A followed template opens read only.
  await cardWith(page, 'By chapter', 'View').getByRole('button', { name: 'View', exact: true }).click();
  await expectOnScreen(page, 'It follows LangQuest', 'Copy to change it');
  await back(page).click();
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
  // Offline, the list this device saw.
  await page.context().setOffline(true);
  await back(page).click();
  await text(page, 'Content templates').click();
  await expectOnScreen(page, 'Could not refresh this list', 'Showing the list this device saved.');
  await page.context().setOffline(false);
});

test('SETUP-034 Share, let follow and archive a template', async ({ page }) => {
  const w = world();
  const name = 'OpenBible: long sections';
  await openAs(page, w, 'ADMIN');
  await contentTemplates(page, w);
  const options = () => cardWith(page, name, 'Options').getByRole('button', { name: 'Options', exact: true }).click();
  await options();
  const flip = (name: string) => page.locator('input[role="switch"]').and(page.getByRole('switch', { name, exact: true })).last().dispatchEvent('click');
  await flip('Share with other organizations');
  await expectToast(page, `${name} is shared with other organizations.`);
  await flip('Let them follow updates');
  await expectToast(page, 'Others can follow it and get your new versions.');
  // No toast offers Undo (decision 134): the same switches turn them off, and on again.
  await flip('Let them follow updates');
  await expectToast(page, 'Others can no longer follow it.');
  await flip('Share with other organizations');
  await expectToast(page, `${name} is no longer shared. Anyone using it keeps their version.`);
  await flip('Share with other organizations');
  await expectToast(page, `${name} is shared with other organizations.`);
  await flip('Let them follow updates');
  await expectToast(page, 'Others can follow it and get your new versions.');
  await text(page, 'Archive').click();
  await expectToast(page, `${name} archived. Languages using it keep it.`);
  // The Archived list's Unarchive brings it back.
  await expectOnScreen(page, 'Archived', '1 template · languages using them keep them');
  await text(page, 'Archived').click();
  await page.getByRole('button', { name: /^OpenBible: long sections.*copied from LangQuest/ }).last().click();
  await text(page, 'Unarchive').click();
  await expectToast(page, `${name} is back in the list.`);
  // Taking an update needs an owner who publishes a newer version: the preview environment.
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

for (const who of ['ADMIN', 'LADMIN'] as const) {
  test(`SETUP-035 ${who} A language\'s content template, and each book\'s passages`, async ({ page }) => {
    const w = world();
    const d = who === 'ADMIN' ? null : await deviceFor(page.context().browser()!, w, who);
    const p = d?.page ?? page;
    if (!d) { await openAs(p, w, who); await languagePage(p, w, 'Alpha'); } else await tab(p, 'manage').click();
    // The pick on top with its facts and links, the others under it, the organization's shelf last (decision 137).
    await contentTemplate(p);
    await expectOnScreen(p, 'FIA passages (English)', /\d+ of its \d+ books · English versification/, /\d+ passages · \d+ recorded/,
      'Each book\'s passages', 'Which books', 'View', 'All content templates');
    await text(p, 'Each book\'s passages').click();
    await expectOnScreen(p, 'Each book\'s passages', 'Alpha');
    await p.getByPlaceholder('Find a book').fill('Luk');
    await expectOnScreen(p, 'Luke');
    await p.getByPlaceholder('Find a book').fill('zzz');
    await expectOnScreen(p, 'No book matches “zzz”.');
    await p.getByPlaceholder('Find a book').fill('');
    await text(p, 'Luke').click();
    await expectOnScreen(p, 'Luke', /Alpha · \d+ passages/);
    if (d) await d.context.close();
  });
}

test('SETUP-036 Choose a different template for a language', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  // The others are listed under the one it uses (decision 137).
  await contentTemplate(page);
  await expectOnScreen(page, 'FIA passages (English)', 'OpenBible: long sections');
  // LangQuest's older templates are not offered, nor its ways in other numberings (decision 107).
  await expectNotOnScreen(page, 'Bible books (English)', 'Bible chapters (Russian Orthodox)');
  await text(page, 'OpenBible: long sections').click();
  await expectOnScreen(page, /Alpha's current passages are hidden, not deleted\. \d+ parts have recordings — change back to this template to bring them back\./);
  await button(page, 'Use OpenBible: long sections').click();
  await expectToast(page, 'Alpha now uses OpenBible: long sections.');
  // No toast offers Undo (decision 134): choosing the template it used before puts it back, from the same list.
  await text(page, 'FIA passages (English)').click();
  await button(page, 'Use FIA passages (English)').click();
  await expectToast(page, 'Alpha now uses FIA passages (English).');
  await expectSent(page, w);
  await expectNothingRefused(page, w);
  await back(page).click().catch(() => undefined);
  await languagePage(page, w, 'Alpha');
  await primary(page).click();
  await expectOnScreen(page, 'Luke');
});

test('SETUP-037 Make a Scripture template', async ({ page }) => {
  const w = world();
  const name = `Gospels ${w.run.slice(-4)}`;
  await openAs(page, w, 'ADMIN');
  await contentTemplates(page, w);
  await button(page, 'Template').click();
  await expectOnScreen(page, 'What will languages record with it?', 'Scripture', 'Books and chapters of the Bible, divided into passages as teams go.', 'Something else');
  await text(page, 'Scripture').click();
  // The questions New language asks (decision 107): the Bible translated from, then how it is divided, your own way first.
  await expectOnScreen(page, 'Which Bible do you translate from?', 'Not listed? Answer a few questions');
  await text(page, 'King James Version').click();
  await expectOnScreen(page, 'Like most English Bibles');
  await primary(page).click();
  await expectOnScreen(page, 'How should the Bible be broken up?', 'Divide it your own way', 'Book by book: read each one and choose where its sections start');
  await text(page, 'By chapter').click();
  await primary(page).click();
  await expect(primary(page)).toBeDisabled();
  await field(page, 'Name').fill(name);
  await expectOnScreen(page, 'Tap a book to choose how it\'s divided.');
  await expectNotOnScreen(page, 'Whole books');
  // A book: your own way first, then the ready-made ways.
  await text(page, 'Genesis').click();
  await expectOnScreen(page, 'Change how Genesis is broken up', 'Divide it your own way', 'Or pick a ready-made way', 'Rename or remove Genesis');
  await text(page, 'OpenBible: usual sections').click();
  await button(page, 'Change Genesis').click();
  await expectToast(page, 'Genesis is divided.');
  await expectOnScreen(page, /OpenBible: usual sections · \d+ pieces/);
  // Its name in the language, and taking it out.
  await text(page, 'Exodus').click();
  await text(page, 'Rename or remove Exodus').click();
  await expectOnScreen(page, 'Name in the language', 'Remove this book', 'Languages using the template keep anything recorded in it; its parts are set aside, not deleted.');
  await text(page, 'Remove this book').click();
  await expectOnScreen(page, 'Books · 65');
  await expect(primary(page)).toBeEnabled();
  await button(page, 'Create template').click();
  await expectToast(page, `${name} created.`);
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

test('SETUP-038 Edit a template; leaving keeps the draft', async ({ page }) => {
  const w = world();
  const name = `Gospels ${w.run.slice(-4)}`;
  await openAs(page, w, 'ADMIN');
  await contentTemplates(page, w);
  await cardWith(page, name, 'Edit').getByRole('button', { name: 'Edit', exact: true }).click();
  await field(page, 'What it\'s for').fill('The four gospels first.');
  // Kept on this device as it changes (decision 127): the header's saved mark turns into a check.
  await expect(byId(page, 'saved-mark')).toHaveAttribute('aria-label', 'Saved');
  // Back leaves at once: nothing asks, and nothing is published.
  await back(page).click();
  await expectOnScreen(page, 'Content templates');
  await expect(byId(page, 'toast')).toHaveCount(0);
  // Opening it again brings the change back; Done publishes it, as version 2 (leaving published nothing).
  await cardWith(page, name, 'Edit').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(field(page, 'What it\'s for')).toHaveValue('The four gospels first.');
  await expect(primary(page)).toHaveText('Done');
  await primary(page).click();
  await expectToast(page, `${name} saved as version 2.`);
  await expectOrgSent(page, w);
});

test('SETUP-039 Make an outline template', async ({ page }) => {
  const w = world();
  const name = `Songs ${w.run.slice(-4)}`;
  await openAs(page, w, 'ADMIN');
  await contentTemplates(page, w);
  await button(page, 'Template').click();
  await text(page, 'Something else').click();
  await field(page, 'Name').fill(name);
  // With nothing in the outline it cannot be made.
  await expect(primary(page)).toBeDisabled();
  await text(page, /^Add .* folder$/).click();
  await expectOnScreen(page, 'Folder', 'Move up', 'Move down', 'Remove this folder');
  await button(page, 'Done').click();
  await text(page, /^Add [a-z]+$/).click();
  await button(page, 'Done').click();
  await button(page, 'Create template').click();
  await expectToast(page, `${name} created.`);
  await expectOrgSent(page, w);
});

test('SETUP-040 Divide a book that waits, for this language', async ({ page }) => {
  const w = world();
  // A language that translates the whole Bible with FIA's passages: Proverbs waits to be broken up.
  const oscar = await addBareLanguage(w, 'Oscar', 'osc');
  await openAsIn(page, w, 'ADMIN', oscar);
  await languagePage(page, w, 'Oscar');
  await text(page, 'What will they record?').click();
  await text(page, 'The Bible').click();
  await primary(page).click();
  await text(page, 'Like most English Bibles').click();
  await primary(page).click();
  await text(page, 'FIA passages').click();
  await text(page, 'Whole Bible').click();
  await primary(page).click();
  await expectToast(page, /^Oscar translates/);
  await byId(page, 'header-close').click();
  // Oscar is not ready yet, so its page is the checklist: the book is divided from the map (decision 107).
  await page.goto('/');
  await waitForApp(page);
  await tab(page, 'map').click();
  await text(page, 'Oscar').click().catch(() => undefined);
  await text(page, 'Old Testament').click();
  await text(page, 'Proverbs').click();
  await button(page, 'Break up Proverbs').click();
  await expectOnScreen(page, 'How should Proverbs be broken up?', 'By chapter');
  await text(page, 'By chapter').click();
  await button(page, 'Break up Proverbs').click();
  const sheet = await screenText(page);
  if (sheet.includes('Which languages should change?')) await text(page, 'Change it for this language').click();
  await expectToast(page, 'Proverbs is broken up by chapter.');
  await expectOnScreen(page, 'Broken up');
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

test('SETUP-042 What a language calls a book, and what translators see', async ({ page, browser }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await languagePage(page, w, 'Alpha');
  await eachBook(page);
  // The list shows eight books at a time; by now earlier tests have broken up enough that Luke is
  // past the first eight, so it is found by name, as a person would.
  await page.getByPlaceholder('Find a book').fill('Luke');
  await text(page, 'Luke').click();
  await text(page, 'Tap to give it the name the team uses').click();
  await expectOnScreen(page, 'What Alpha calls Luke', 'Translators see this name');
  await field(page, 'What Alpha calls Luke').fill('Luka');
  await button(page, 'Save').click();
  await expectToast(page, 'Alpha calls it Luka.');
  await expectOnScreen(page, 'Called Luka in Alpha');
  await expectSent(page, w);
  const trans = await deviceFor(browser, w, 'TRANS');
  await syncNow(trans.page);
  await tab(trans.page, 'map').click();
  await expect.poll(async () => { await syncNow(trans.page); return screenText(trans.page); }, { timeout: 30_000 }).toContain('Luka');
  await trans.context.close();
  // Put the name back for the tests after this one.
  await text(page, 'Called Luka in Alpha').click();
  await field(page, 'What Alpha calls Luke').fill('Luke');
  await button(page, 'Save').click();
  await expectToast(page, 'Alpha calls it Luke.');
  await expectSent(page, w);
});

// ---- Licence (run last: SETUP-060 can never be reversed) ---------------------------------------------

test('SETUP-059 The licence is shown to everyone who manages, changed by an organization admin', async ({ page, browser }) => {
  const w = world();
  const coord = await deviceFor(browser, w, 'COORD');
  await orgHome(coord.page, w);
  await setup(coord.page);
  await expectOnScreen(coord.page, 'All rights reserved', 'Only your organization');
  await button(coord.page, /^(License: )?All rights reserved/).click();
  await expectOnScreen(coord.page, 'Who may use your work', 'Only an organization admin can change this.');
  await coord.context.close();

  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await setup(page);
  await button(page, /^(License: )?All rights reserved/).click();
  await expectOnScreen(page, 'Who may use your work', 'Opening up is permanent: anyone who copies your work keeps these terms.');
  await page.getByRole('radio', { name: /^CC BY 4\.0/ }).click();
  await expect(button(page, 'Open to CC BY 4.0')).toBeVisible();
  await expectOnScreen(page, 'People outside can hear your team', /Anyone will be able to listen to your recordings/);
  await closeSheet(page);
  await expectOnScreen(page, 'All rights reserved');
  await expectOrgSent(page, w);
});

test('SETUP-060 The licence only opens, never closes', async ({ page }) => {
  const w = world();
  await openAs(page, w, 'ADMIN');
  await orgHome(page, w);
  await setup(page);
  await button(page, /^(License: )?All rights reserved/).click();
  await page.getByRole('radio', { name: /^CC BY-NC-ND 4\.0/ }).click();
  await button(page, 'Open to CC BY-NC-ND 4.0').click();
  await expectOnScreen(page, 'This can\'t be undone', 'You will not be able to close it again.', 'Back');
  await button(page, 'Yes, open to CC BY-NC-ND 4.0').click();
  await expectToast(page, 'Your work is now under CC BY-NC-ND 4.0.');
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
  await button(page, /^(License: )?CC BY-NC-ND 4\.0/).click();
  await expectOnScreen(page, 'Your work is already more open than this');
  await expect(button(page, /^Open to All rights reserved/)).toHaveCount(0);
});
