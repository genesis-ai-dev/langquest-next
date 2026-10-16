// SETUP: scope limits on setup (docs/ui-test-suite/09-language-setup.md,
// SETUP-061 to SETUP-066). LADMIN holds every setup privilege but only at
// Alpha. A language's own choices (its template, checks and offers) are
// Alpha's events, which LADMIN may write; the organization's library and
// recommendations are organization-stream events that need organization
// scope (core `languageOfOrgEvent`, SQL `may_emit`), so they are not
// offered (library/model.ts `mayWriteLibrary`).
import type { Page } from '@playwright/test';
import {
  back, button, byId, deviceFor, expect, expectNothingRefused, expectSent, expectToast, field, openAs, primary, screenText, tab, tabsShown, test, text,
  useWorld
} from './support';
import { closeSheet, contentTemplate, expectNotOnScreen, expectOnScreen, expectOrgSent, orgRefused, referenceLibrary, reviewFlows, setup } from './setup-helpers';

const world = useWorld();

async function alphaPage(page: Page): Promise<void> {
  await openAs(page, world(), 'LADMIN');
  await tab(page, 'manage').click();
  await expectOnScreen(page, 'Alpha', 'Content template');
}

test('SETUP-061 LADMIN\'s Manage tab is Alpha\'s page', async ({ page }) => {
  await alphaPage(page);
  await expect(byId(page, 'header-back')).toHaveCount(0);
  // Where Back would be, the organization (decision 136); the rest is on the page, with no More.
  await expect(byId(page, 'header-up')).toHaveAccessibleName(world().orgName);
  await expectOnScreen(page, 'Content template', 'Reference material', 'Review flow', 'People', 'Roles', 'Languages', 'Show on the public list');
  await expectNotOnScreen(page, 'More', 'Members', 'Review groups');
  // Bravo is not LADMIN's: none of its setup or its work.
  await tab(page, 'map').click();
  const bravo = text(page, 'Bravo');
  if (await bravo.count()) {
    await bravo.click();
    await expectNotOnScreen(page, 'Content template', 'Get Bravo ready', 'Who checks the recordings?');
  }
  await expectNotOnScreen(page, 'This screen could not open');
});

/** ADMIN follows LangQuest's "FIA passages", so ORG's library holds a second template of its own. */
async function secondTemplate(page: Page): Promise<void> {
  const w = world();
  const admin = await deviceFor(page.context().browser()!, w, 'ADMIN');
  const p = admin.page;
  await tab(p, 'manage').click();
  await setup(p);
  await text(p, 'Content templates').click();
  for (let i = 0; i < 10 && !(await text(p, 'FIA passages').count()); i++) await text(p, /^Show 5 more/).click();
  await text(p, 'FIA passages').click();
  await text(p, 'Follow').click();
  await text(p, 'Update automatically').click();
  await expectToast(p, /^Following FIA passages/);
  await expectOrgSent(p, w);
  await admin.context.close();
}

test('SETUP-062 LADMIN chooses Alpha\'s own template and checks', async ({ page }) => {
  const w = world();
  await secondTemplate(page);
  await alphaPage(page);
  // A ready-made flow: its checks are copied into Alpha (decision 91), Alpha's own events.
  await reviewFlows(page);
  const flowCard = (name: string) => page.locator('div').filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Use', exact: true }) }).last();
  const quick = flowCard('Quick Check');
  // Alpha's checks are still as Standard Bible Flow made them, so Use asks nothing (decision 134).
  await quick.getByRole('button', { name: 'Use', exact: true }).click();
  await expectToast(page, 'Alpha now uses Quick Check.');
  // Put back the same way, as no toast offers Undo: Standard Bible Flow, which Alpha's checks were copied from.
  const standard = flowCard('Standard Bible Flow');
  await expect(standard).not.toContainText('Loading…');
  await standard.getByRole('button', { name: 'Use', exact: true }).click();
  await expectToast(page, 'Alpha now uses Standard Bible Flow.');
  await back(page).click();
  // One of Alpha's checks taken out, and added again from the list (it was the last): Review flow › Edit.
  await text(page, 'Edit').click();
  await text(page, 'Final approval').click();
  await text(page, 'Remove this check').click();
  await page.getByTestId('sheet').locator('visible=true').last().getByRole('button', { name: 'Remove this check', exact: true }).click();
  await expectToast(page, 'Final approval removed');
  await text(page, 'Add a check').click();
  await text(page, 'Final approval').click();
  await expectToast(page, 'Alpha\'s checks saved');
  await expectOnScreen(page, 'Final approval');
  await back(page).click();
  await back(page).click();
  // Another of the organization's own templates: the Content template page offers only those (following
  // another organization's is a library write).
  await contentTemplate(page);
  await expectOnScreen(page, 'FIA passages (English)', 'FIA passages');
  await expectNotOnScreen(page, 'Bible chapters (English)');
  await text(page, 'FIA passages', true).click();
  await button(page, 'Use FIA passages').click();
  await expectToast(page, 'Alpha now uses FIA passages.');
  // Put back the same way, from the same list: the template Alpha used before.
  await text(page, 'FIA passages (English)').click();
  await button(page, 'Use FIA passages (English)').click();
  await expectToast(page, 'Alpha now uses FIA passages (English).');
  await expectSent(page, w);
  await expectNothingRefused(page, w);
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

test('SETUP-063 LADMIN is not offered the organization\'s library writes', async ({ page }) => {
  const w = world();
  await alphaPage(page);
  // The template Alpha uses: viewed, not edited; its books are read, not broken up.
  await contentTemplate(page);
  await expectOnScreen(page, 'View', 'Each book\'s passages');
  await expectNotOnScreen(page, 'Edit');
  await text(page, 'Each book\'s passages').click();
  await text(page, 'Luke').click();
  await expectOnScreen(page, 'Luke', 'Called Luke in Alpha');
  await expectNotOnScreen(page, 'Break up differently');
  await back(page).click();
  await back(page).click();
  await text(page, 'View').click();
  await expectNotOnScreen(page, 'Copy to change it', 'Create template');
  await expect(button(page, 'Done')).toHaveCount(0);
  await expect(byId(page, 'saved-mark')).toHaveCount(0);
  await back(page).click();
  await back(page).click();
  // Review flows: Use (Alpha's own checks), but no new flow, Follow or Copy.
  await reviewFlows(page);
  await expectOnScreen(page, 'Review flows', 'Use');
  await expect(button(page, 'Follow')).toHaveCount(0);
  await expect(button(page, 'Copy')).toHaveCount(0);
  await expect(button(page, 'Flow')).toHaveCount(0);
  await expectNotOnScreen(page, 'Add to your flows');
  await back(page).click();
  await back(page).click();
  // The organization's Content templates: no Options, no new template, no Follow or Copy.
  await byId(page, 'header-up').click();
  await setup(page);
  await text(page, 'Content templates').click();
  await expectOnScreen(page, 'Content templates', 'View');
  await expectNotOnScreen(page, 'Options');
  await expect(button(page, 'Template')).toHaveCount(0);
  await text(page, 'Bible chapters (English)').click();
  await expect(button(page, 'Follow')).toHaveCount(0);
  await expect(button(page, 'Copy')).toHaveCount(0);
  await closeSheet(page);
  // Nothing went to the organization's stream to be refused (G10.2).
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

test('SETUP-064 LADMIN\'s Bibles: recommendations are Alpha\'s; adding one to the library is not offered', async ({ page }) => {
  const w = world();
  await alphaPage(page);
  await referenceLibrary(page);
  await text(page, 'Bibles').click();
  await expectOnScreen(page, 'Bibles', 'What this language’s team is offered');
  // Adding a Bible follows LangQuest's or publishes Bible Brain's in the organization's library.
  await expect(button(page, 'Add a Bible')).toHaveCount(0);
  // The local library has no Bible (no source@1 is seeded): Hide, Follow organization and Recommend need the preview environment.
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

test('SETUP-065 LADMIN\'s guides and material are Alpha\'s own', async ({ page }) => {
  const w = world();
  const title = `Names in Luke ${w.run.slice(-4)}`;
  await alphaPage(page);
  await referenceLibrary(page);
  await expectNotOnScreen(page, 'Write a guide');
  await expect(button(page, 'New')).toHaveCount(0);
  await expect(button(page, 'Follow')).toHaveCount(0);
  await primary(page).click();
  await expectNotOnScreen(page, 'Where it applies', 'All languages');
  await field(page, 'Title').fill(title);
  await primary(page).click();
  await expectToast(page, `${title} added.`);
  await text(page, title).click();
  await expectNotOnScreen(page, 'Publish to library');
  await expectSent(page, w);
  await expectNothingRefused(page, w);
  await expectOrgSent(page, w);
  expect(await orgRefused(page, w)).toEqual([]);
});

for (const who of ['TRANS', 'REV', 'TREV', 'VIEW', 'KEPT'] as const) {
  test(`SETUP-066 ${who} Members without setup privileges never reach setup screens`, async ({ browser }) => {
    const w = world();
    const d = await deviceFor(browser, w, who);
    const p = d.page;
    expect(await tabsShown(p)).not.toContain('manage');
    if (who !== 'VIEW') {
      await tab(p, 'work').click();
      await expect.poll(() => screenText(p)).not.toMatch(/Get .* ready · \d of 4/);
    }
    // The web address of a setup section.
    await p.goto('/manage/language');
    await expect.poll(() => screenText(p), { timeout: 30_000 }).not.toMatch(/Content template|Review flow|Reference material/);
    await expectNotOnScreen(p, 'This screen could not open');
    await d.context.close();
  });
}
