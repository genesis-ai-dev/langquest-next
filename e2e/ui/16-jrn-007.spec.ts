// JRN-007 An organization admin starts from nothing
// (docs/ui-test-suite/16-role-journeys.md). A NEW account makes its own
// organization; the world is only here for the run's name.
import { backToTabs, watch } from './16-helpers';
import { openSyncDetails } from './sync-helpers';
import { back, button, byId, expect, expectToast, field, openSignedOut, primary, screenText, tab, tabsShown, test, text, useWorld } from './support';

const world = useWorld();

test('JRN-007 An organization admin starts from nothing @p0', async ({ page }) => {
  const w = world();
  const orgName = `Journey Org ${w.run}`;
  const email = `ui-${w.run}-jrn007@example.org`;
  await watch(page, 'NEW');

  // Step 1: a new account.
  await openSignedOut(page);
  await button(page, 'Create Account').click();
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Choose a password (6 or more characters)').fill('journey-pass-123');
  await page.getByPlaceholder('Re-enter password').fill('journey-pass-123');
  await primary(page).click();
  await expect(text(page, 'Join your team')).toBeVisible({ timeout: 60_000 });

  // Steps 2-3: start one, with an open licence; its warning shows.
  await button(page, /^Start a new one/).click();
  await field(page, "What's it called?").fill(orgName);
  await button(page, /^License:/).click();
  await page.getByRole('radio', { name: /^CC BY-NC-SA 4\.0/ }).click();
  await expect(text(page, 'People outside can hear your team')).toBeVisible();
  await button(page, 'Use this license').click();
  await expect(button(page, /^License: CC BY-NC-SA 4\.0/)).toBeVisible();

  // Step 4: straight to My Work, no Welcome, admin's tabs.
  await button(page, 'Create Organization').click();
  await expect(text(page, `Get ${orgName} ready`, false)).toBeVisible({ timeout: 60_000 });
  await expect(primary(page)).toHaveAccessibleName('Add a language');
  expect(await screenText(page)).not.toMatch(/Skip for now|Get started/);
  expect(await tabsShown(page)).toEqual(['work', 'map', 'manage', 'me']);

  // Step 5: New language, with FIA passages (the New Testament) and the Standard Bible Flow.
  await primary(page).click();
  await page.getByPlaceholder('e.g. Hadiyya').fill('Journey Language');
  await primary(page).click();
  await page.getByRole('radio', { name: 'The Bible' }).click();
  await primary(page).click();
  await page.getByRole('radio', { name: 'New International Version (2011)' }).click();
  await primary(page).click();
  await expect(page.getByRole('radio', { name: /^FIA passages\./ })).toBeVisible();
  await page.getByRole('radio', { name: /^FIA passages\./ }).click();
  await primary(page).click();
  await expect(text(page, 'How will recordings get checked?')).toBeVisible();
  await page.getByRole('radio', { name: /^Standard Bible Flow\./ }).click();
  await primary(page).click();
  // As many languages as the team reads (decision 130): English is ticked already.
  await expect(page.getByRole('checkbox', { name: /^English/ })).toBeChecked();
  await primary(page).click();
  // The progress names each part as it starts; it ends on inviting the language's people.
  await expect(text(page, /^(Setting up Journey Language|Getting the passages|Getting the review steps|Saving Journey Language's passages)/)).toBeVisible();
  await expectToast(page, `Journey Language added to ${orgName}.`);
  await expect(text(page, 'Invite someone')).toBeVisible();
  await button(page, 'Later').click();
  // The Map shows the books in scope.
  await tab(page, 'map').click();
  const journey = page.getByRole('button', { name: /^Journey Language: .*Open its map/ }).locator('visible=true').first();
  if (await journey.isVisible({ timeout: 5_000 }).catch(() => false)) await journey.click();
  await expect(button(page, /^Matthew\./)).toBeVisible();
  await expect(button(page, /^Luke\./)).toBeVisible();
  await expect(button(page, /^Genesis\./)).toHaveCount(0);

  // Step 6: a role of its own, Review only.
  await tab(page, 'manage').click();
  await button(page, /^Setup/).click();
  await button(page, /^Roles /).click();
  await button(page, 'Role').click();
  await page.getByPlaceholder('e.g. Back-translator').fill('Community Checker');
  await page.getByRole('switch', { name: 'Check recordings' }).click();
  await primary(page).click();
  await expect(button(page, /^Community Checker /)).toBeVisible();

  // Step 7: inviting offers it; a group code for Journey Language.
  await back(page).click();
  await tab(page, 'manage').click();
  await primary(page).click(); // Invite people
  await expect(text(page, 'What will they do?')).toBeVisible();
  const others = button(page, /^Other roles/);
  if (await others.isVisible().catch(() => false)) await others.click();
  await page.getByRole('radio', { name: 'Community Checker' }).click();
  const journeyScope = page.getByRole('button', { name: 'Journey Language' }).locator('visible=true');
  if (await journeyScope.count()) await journeyScope.first().click();
  await primary(page).click();
  await expect(text(page, 'Ask them to scan this')).toBeVisible();
  await expect(text(page, /^Community Checker/)).toBeVisible();
  await button(page, 'Done').click();

  // Step 8 (decision 91, Review teams are gone): the language's checks are its own copy of the Standard Bible Flow.
  await tab(page, 'manage').click();
  await button(page, /^Journey Language/).click();
  // Until its translators are invited the page is the Get ready checklist, where the checks are "Who checks the recordings?".
  const checks = page.getByRole('button', { name: /^Review flow/ }).locator('visible=true');
  await expect(checks.first().or(button(page, /^Who checks the recordings\?/))).toBeVisible();
  if (await checks.count()) {
    // Its Review flow, then Edit: the checks themselves (decision 137).
    await checks.first().click();
    await text(page, 'Edit').click();
    for (const check of ['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval']) {
      await expect(text(page, new RegExp(`^${check}`))).toBeVisible();
    }
  } else {
    // The checklist's question shows the copied flow as the language's own steps, chosen.
    await button(page, /^Who checks the recordings\?/).click();
    await expect(text(page, 'In use · your own steps')).toBeVisible();
    for (const step of ['Another translator', 'The community', 'A consultant', 'You approve']) await expect(text(page, step)).toBeVisible();
  }

  // Step 9: Switch Organization lists only Journey Org.
  await backToTabs(page);
  await tab(page, 'me').click();
  await button(page, /^More settings/).click();
  await button(page, /^Switch Organization/).click();
  await expect(button(page, `${orgName}, active`)).toBeVisible();
  expect(await page.getByRole('button', { name: /^(UI Test Org|UI Second Org)/ }).count()).toBe(0);

  // Every write accepted.
  await back(page).click();
  await button(page, /^Sync/).click();
  await openSyncDetails(page);
  await expect.poll(async () => (await screenText(page)).match(/(\d+)\s*refused by the server/)?.[1]).toBe('0');
  // And on this device's log, across every stream it holds (G10.2).
  const refused = await page.evaluate(async () => {
    const log = (globalThis as { __langquestLog?: { select(sql: string): Promise<{ n: number }[]> } }).__langquestLog!;
    return (await log.select("select count(*) as n from events where status = 'rejected'"))[0]!.n;
  });
  expect(refused, 'refused by the server').toBe(0);
  await expect(byId(page, 'header-back')).toBeVisible();
});
