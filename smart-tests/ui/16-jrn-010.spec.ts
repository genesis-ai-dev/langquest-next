// JRN-010 A viewer follows progress (docs/ui-test-suite/16-role-journeys.md).
// Its own world with nobody welcomed yet, so the viewer's Welcome shows.
// Platforms: iOS, Android, Wide: steps 1-4 at phone width, step 5 on a wide window.
import { backToTabs, watch } from './16-helpers';
import { button, expect, openAs, screenText, tab, tabsShown, test, text, useWorld } from './support';

const world = useWorld({ welcomed: false });

test('JRN-010 A viewer follows progress @p0 @wide', async ({ page }) => {
  test.setTimeout(240_000);
  const w = world();
  const done = w.passages['P-DONE'].label;
  await watch(page, 'VIEW');
  await page.setViewportSize({ width: 430, height: 932 });
  await openAs(page, w, 'VIEW');

  // Step 1: the viewer's Welcome, one button, then the overview of every language.
  await expect(text(page, 'See how far each language has come.')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'Open any passage to hear what happened.')).toBeVisible();
  await expect(page.getByRole('button').locator('visible=true').filter({ hasText: /Skip for now|Show me how/ })).toHaveCount(0);
  await button(page, 'Get started').click();
  await expect(text(page, 'Progress')).toBeVisible();
  await expect(text(page, /All languages/)).toBeVisible();
  expect(await screenText(page)).not.toMatch(/My Work|Next for you/);
  expect(await tabsShown(page)).toEqual(['map', 'inbox', 'me']);

  // Step 2: Alpha → Luke → chapter 16 → P-DONE: every step complete, nothing to act on.
  await button(page, /^Alpha: .*Open its map/).click();
  await button(page, /^Luke\./).click();
  await button(page, /^Chapter 16:/).click();
  await button(page, new RegExp(`^${done}\\. Done`)).click();
  await expect(text(page, done)).toBeVisible();
  for (const check of ['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval']) {
    await expect(button(page, new RegExp(`^${check}, (looks good|done|complete)`, 'i'))).toBeVisible();
  }
  for (const action of [/^Record$/, /^Do the /, /^Ask /, /^Back-translate/, /^Hear the feedback$/]) {
    await expect(page.getByRole('button', { name: action }).locator('visible=true')).toHaveCount(0);
  }
  // "Something else?" holds only what a viewer may do (what helps, what comes offline): no ask, log, set aside or note.
  const elseBtn = page.getByRole('button', { name: 'Something else?' }).locator('visible=true');
  if (await elseBtn.count()) {
    await elseBtn.first().click();
    for (const action of [/^Ask someone/, /^Already happened/, /^Set aside/, /^Add a note/, /^Move past/]) {
      await expect(page.getByRole('button', { name: action }).locator('visible=true')).toHaveCount(0);
    }
    await page.getByTestId('header-back').or(page.getByTestId('header-close')).locator('visible=true').last().click();
  }

  // Step 3: play Version 1, then Versions and history.
  const play = page.getByRole('button', { name: /^Play / }).locator('visible=true').first();
  if (await play.count()) {
    await play.click();
    await expect(button(page, 'Pause')).toBeVisible();
  }
  await button(page, 'Versions and history').click();
  await expect(text(page, 'Version 1')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit$|^New version$/ }).locator('visible=true')).toHaveCount(0);

  // Step 4: the Inbox tab. A plain viewer gets no record updates (NAV-033): empty, no badge.
  await backToTabs(page);
  await tab(page, 'inbox').click();
  await expect(text(page, 'Nothing yet')).toBeVisible();
  await expect(tab(page, 'inbox')).toHaveAccessibleName('Inbox');

  // Step 5: on a wide window, Reports → Alpha loads, with no "Language settings" panel.
  await page.setViewportSize({ width: 1280, height: 900 });
  await tab(page, 'reports').click();
  await button(page, 'Languages').click();
  await page.getByRole('button', { name: /^Alpha\b/ }).or(page.getByRole('link', { name: /^Alpha\b/ })).locator('visible=true').first().click();
  await expect(text(page, /Alpha/)).toBeVisible();
  await expect(text(page, /FIA passages|Standard Bible Flow/)).toBeVisible();
  await expect(page.getByText('Language settings')).toHaveCount(0);
  expect(await screenText(page)).not.toMatch(/This screen could not open|Something went wrong/);
});
