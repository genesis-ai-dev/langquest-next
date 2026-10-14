// JRN-002 A translator answers feedback: one fix, one kept with a reason
// (docs/ui-test-suite/16-role-journeys.md). Its own world: it answers the
// feedback on P-NEEDS and P-SUBMITTED.
import { randomUUID } from 'node:crypto';
import { commands, type LanguageState } from '@langquest-next/core';
import type { Page } from '@playwright/test';
import { Devices, expectClean, openBell, partsCount, recordParts, syncUntil, watch } from './16-helpers';
import { clientAs, send } from './fixture';
import { back, button, byId, expect, expectStill, expectToast, openAs, primary, screenText, tab, test, text, useWorld } from './support';

const world = useWorld();

/** Hold a part's row (the gutter) to open its sheet: verses, Auto, None and delete. */
async function holdPart(page: Page, n: number): Promise<void> {
  const row = page.getByRole('button', { name: new RegExp(`^Part ${n}, `) }).locator('visible=true').first();
  await row.scrollIntoViewIfNeeded();
  // The list settles after a recording stops (the new part's row arrives); hold where the row is then.
  await expectStill(row);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900); // sleep: the press must be held for a long-press; the sheet opens on release
  await page.mouse.up();
  await expect(button(page, `Delete Part ${n}`), 'holding the part opens its sheet').toBeVisible({ timeout: 5_000 });
}

test('JRN-002 A translator answers feedback: one fix, one kept with a reason @p0', async ({ page, browser }) => {
  const w = world();
  const rev = w.accounts.REV;
  const needs = w.passages['P-NEEDS'].label;
  const submitted = w.passages['P-SUBMITTED'].label;

  // Precondition: REV also marks P-SUBMITTED's Version 1 "needs changes" (the REV-level step, through the server).
  const revClient = await clientAs(w, 'REV', 'A');
  await revClient.appendMany(commands(revClient.getState() as LanguageState).recordReview({
    commandId: randomUUID(), takeIds: [w.passages['P-SUBMITTED'].takeId!], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'The start is too quiet'
  }) as never);
  await send(revClient as never, 'REV: needs changes on P-SUBMITTED');

  await watch(page, 'TRANS');
  await openAs(page, w, 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });

  // Steps 1-3: the bell, the feedback on P-NEEDS, its voice note and text.
  await openBell(page);
  await page.getByRole('button', { name: new RegExp(`^Feedback on ${needs}`) }).locator('visible=true').first().click();
  await expect(text(page, needs)).toBeVisible();
  await primary(page).click();
  await expect(primary(page)).toHaveAccessibleName('Record a fix');
  await expect(text(page, '“Verse 18 is too fast”')).toBeVisible();
  await button(page, `Play ${rev.name}'s feedback`).click();
  await expect(button(page, 'Pause')).toBeVisible();

  // Steps 4-5: Record a fix opens the workspace on Earlier, with the review in it.
  await primary(page).click();
  await expect(text(page, 'Recording Version 2')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Earlier' }).locator('visible=true').first()).toHaveAttribute('aria-selected', 'true');
  await expect(text(page, `${rev.name}'s feedback on Version 1`)).toBeVisible();

  // Step 6: one new part, and one of Version 1's parts deleted.
  const before = await partsCount(page);
  await recordParts(page, 1);
  await holdPart(page, 1);
  await button(page, 'Delete Part 1').click();
  await expectToast(page, 'Part 1 deleted.');
  await expect.poll(() => partsCount(page)).toBe(before);
  await byId(page, 'publish-button').click();

  // The Publish screen: the change note is needed, and the check it answers is named.
  await expect(text(page, 'Version 2')).toBeVisible();
  expect.soft(await screenText(page), 'decision 91: the check is named as the record names it').toMatch(new RegExp(`Answers the peer check feedback from ${rev.name}`, 'i'));
  await expect(text(page, new RegExp(`Answers the .* feedback from ${rev.name}`))).toBeVisible();
  // It starts from a first draft ("Revised after the … feedback."); emptied, Publish waits for something said.
  await page.getByRole('button', { name: /^What changed\./ }).locator('visible=true').first().click();
  const note = page.getByPlaceholder('Or type it').locator('visible=true').first();
  await note.fill('');
  await button(page, 'Done').click();
  await expect(button(page, 'Publish Version 2')).toBeDisabled();
  await page.getByRole('button', { name: /^Say what changed\./ }).locator('visible=true').first().click();
  await page.getByPlaceholder('Or type it').locator('visible=true').first().fill('Slowed verse 18');
  await button(page, 'Done').click();
  await expect(button(page, 'Publish Version 2')).toBeEnabled();

  // Step 7: published; the record moves on.
  await button(page, 'Publish Version 2').click();
  await expectToast(page, 'Version 2 published.');
  await expect(text(page, 'Version 2 published')).toBeVisible();
  await button(page, 'Not now').click();
  await expect(button(page, /^1\. Record\. Version 2/)).toBeVisible();
  await expect(button(page, 'Hear the feedback')).toHaveCount(0);
  await expect(button(page, /^Peer check, (answered|asked|after you publish)/).or(button(page, /^Peer check, /))).toBeVisible();
  expect(await screenText(page)).not.toMatch(/Fix it, or keep it and say why/);

  // Steps 8-9: the feedback on P-SUBMITTED, kept with a reason.
  await back(page).click();
  await openBell(page);
  await syncUntil(page, async () => (await page.getByRole('button', { name: new RegExp(`^Feedback on ${submitted}`) }).count()) > 0);
  await page.getByRole('button', { name: new RegExp(`^Feedback on ${submitted}`) }).locator('visible=true').first().click();
  await primary(page).click();
  await button(page, 'Keep it, say why').click();
  await expect(button(page, 'Keep it')).toBeDisabled();
  await page.getByPlaceholder('Or type it').locator('visible=true').first().fill('The speed matches how elders tell it');
  await button(page, 'Keep it').click();
  const toast = await expectToast(page, 'Kept · your reason is on the record');
  await expect(toast).toBeVisible();
  await expect(byId(page, 'toast-undo')).toBeVisible();
  await button(page, 'Versions and history').click();
  await page.getByRole('button', { name: /^History\./ }).locator('visible=true').first().click();
  await expect(text(page, /The speed matches how elders tell it/)).toBeVisible();
  await expectClean(page, w);

  // REV, after syncing: the Inbox has both answers, and P-NEEDS offers the peer check on Version 2.
  const devices = new Devices(browser, world);
  try {
    const r = await devices.open('REV');
    await expect(tab(r, 'work')).toBeVisible({ timeout: 60_000 });
    await openBell(r);
    await syncUntil(r, async () => {
      const s = await screenText(r);
      const tom = w.accounts.TRANS.name.split(' ')[0];
      return s.includes(`${tom} revised ${needs}`) && s.includes(`${tom} kept ${submitted} as is`);
    });
    await expect(text(r, /The speed matches how elders tell it/)).toBeVisible();
    await back(r).click();
    await tab(r, 'map').click();
    await r.getByRole('button', { name: /^Luke\./ }).locator('visible=true').first().click();
    await r.getByRole('button', { name: /^Chapter 14:/ }).locator('visible=true').first().click();
    await r.getByRole('button', { name: new RegExp(`^${needs}\\.`) }).locator('visible=true').first().click();
    await expect(button(r, /^1\. Record\. Version 2/)).toBeVisible();
    // The peer check and the back translation are one step (same time): either may lead; the peer check is offered on Version 2.
    if (!/^Do the peer (check|review)$/.test((await primary(r).getAttribute('aria-label')) ?? '')) {
      await r.getByRole('button', { name: /^Peer check, / }).locator('visible=true').first().click();
    }
    // Decided (2026-10-13): answered feedback keeps the check open (core `isCompleteState`), so Version 2 goes
    // back to the peer check, as the record told the translator.
    const doPeer = r.getByRole('button', { name: /^Do the peer (check|review)$/ }).locator('visible=true').first();
    await expect(doPeer, 'Version 2 goes back to the peer check').toBeVisible({ timeout: 5_000 });
    expect.soft(await doPeer.getAttribute('aria-label'), 'decision 91: "check" is the word for a review stage').toBe('Do the peer check');
  } finally {
    await devices.close();
  }
});
