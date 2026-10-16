// JRN-003 A reviewer's round: one check, one back translation
// (docs/ui-test-suite/16-role-journeys.md). Its own world: it changes
// P-SUBMITTED and P-BT.
import { Devices, openBell, sayEachPart, syncUntil, watch } from './16-helpers';
import { back, button, byId, expect, expectToast, openAs, primary, screenText, tab, test, text, useWorld } from './support';

const world = useWorld();

test('JRN-003 A reviewer\'s round: one check, one back translation @p0', async ({ page, browser }) => {
  const w = world();
  const trans = w.accounts.TRANS;
  const transFirst = trans.name.split(' ')[0]!;
  const submitted = w.passages['P-SUBMITTED'].label;
  const bt = w.passages['P-BT'].label;
  await watch(page, 'REV');
  await openAs(page, w, 'REV');

  // Step 1: the newest ask leads (P-BT's back translation); P-SUBMITTED's check is under Then.
  await expect(text(page, 'Next for you', false)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: new RegExp(`^Check ${submitted}`) }).locator('visible=true').first().click();
  await expect(text(page, 'Listen to all of it first')).toBeVisible();
  await expect(button(page, /^Listen, step 1 of 2/)).toBeVisible();
  await expect(button(page, /^Decide, step 2 of 2/)).toBeVisible();
  await expect(text(page, `Version 1 · recorded by ${transFirst}`)).toBeVisible();

  // Step 2: play it, then on to Decide (the Peer check has no questions in this world).
  await button(page, `Play Version 1 · recorded by ${transFirst}`).click();
  await expect(button(page, 'Pause')).toBeVisible();
  await primary(page).click();

  // Step 4: the verdict.
  await expect(text(page, 'Is it accurate and natural?')).toBeVisible();
  await expect(button(page, 'Looks good')).toBeEnabled();
  await expect(button(page, 'Needs changes')).toBeEnabled();
  await button(page, 'Needs changes').click();

  // Step 5: a spoken note.
  await expect(text(page, 'What should change?')).toBeVisible();
  await button(page, 'Tap and speak').click();
  await expect(button(page, 'Stop recording')).toBeVisible();
  await page.waitForTimeout(5_000); // sleep: the fake microphone must record some voice (a 4 s loop); the screen shows no running time
  await button(page, 'Stop recording').click();
  await expect(button(page, /^Play Your feedback/)).toBeVisible();

  // Step 6: sent.
  await primary(page).click();
  await expectToast(page, `Feedback sent to ${trans.name}`);
  await expect(button(page, 'Peer check, needs changes')).toBeVisible();
  await expect(text(page, `Waiting on ${trans.name} to answer the Peer check feedback.`)).toBeVisible();

  // Step 7: back on My Work, the back translation leads.
  await back(page).click();
  await tab(page, 'work').click();
  await expect(text(page, bt)).toBeVisible();
  await expect(text(page, /^Back translation · asked by/)).toBeVisible();
  await primary(page).click();

  // Step 8: each part said in English; the top pane hides notes and earlier checks on purpose.
  await expect(text(page, /Notes and earlier checks are hidden on purpose/)).toBeVisible();
  await sayEachPart(page, 3);

  // Step 9: Done, and REV (no Send to reviewers) is not offered an ask: it just finishes.
  await button(page, 'Done').click();
  await expect(button(page, /^Ask /)).toHaveCount(0);
  expect(await screenText(page), 'PASS-017: a reviewer who cannot ask is not told to ask').not.toMatch(/Next check/i);
  await expect(primary(page)).toHaveAccessibleName('Finish the back translation');
  await primary(page).click();
  await expectToast(page, 'Back translation published.');

  // TRANS, after syncing: the bell has the feedback on P-SUBMITTED, unread.
  const devices = new Devices(browser, world);
  try {
    const t = await devices.open('TRANS');
    await expect(tab(t, 'work')).toBeVisible({ timeout: 60_000 });
    await syncUntil(t, async () => (await t.getByRole('button', { name: /^Updates, \d+ new/ }).count()) > 0);
    await openBell(t);
    await syncUntil(t, async () => t.getByText(`Feedback on ${submitted}`).locator('visible=true').count().then((n) => n > 0));
    const unread = await screenText(t);
    expect(unread.indexOf(`Feedback on ${submitted}`)).toBeGreaterThan(unread.indexOf('UNREAD'));
    await expect(byId(t, 'tab-work')).toBeVisible();
  } finally {
    await devices.close();
  }
});
