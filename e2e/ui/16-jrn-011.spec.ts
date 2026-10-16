// JRN-011 One passage from first recording to done, across every role
// (docs/ui-test-suite/16-role-journeys.md). On the web, each person is their
// own browser (a device each): COORD, TRANS, REV, TREV and VIEW. P-X is
// Luke 12:1–12, which nobody in the fixture touches.
import type { Page } from '@playwright/test';
import {
  Devices, backToTabs, deviceTail, expectClean, openByLabel, passageRow, recordParts, sayEachPart, syncUntil, throughToDecide
} from './16-helpers';
import { button, byId, expect, expectToast, primary, screenText, syncNow, tab, test, text, useWorld } from './support';

const world = useWorld();
const PX = 'Luke 12:1–12';

/** Start it from My Work: the "Next for you" card when it leads, else its row. */
async function openFromWork(page: Page, title: string): Promise<void> {
  const card = await screenText(page);
  if (new RegExp(`NEXT FOR YOU ${title}`, 'i').test(card)) await primary(page).click();
  else await page.getByRole('button', { name: new RegExp(`^(Check )?${title}`) }).locator('visible=true').first().click();
}

/** My Work lists the passage (as the card or a row), after pulling the latest. */
async function onMyWork(page: Page, title: RegExp): Promise<void> {
  await backToTabs(page);
  await tab(page, 'work').click();
  await syncUntil(page, async () => {
    // Past the first three, My Work folds the rest under "N more for you".
    const more = page.getByRole('button', { name: /^\d+ more for you$/ }).locator('visible=true');
    if (await more.count()) await more.first().click();
    return (await page.getByText(title).locator('visible=true').count()) > 0
      || (await page.getByRole('button', { name: title }).locator('visible=true').count()) > 0;
  }, 60_000, `My Work showing ${title}`);
}

test('JRN-011 One passage from first recording to done, across every role @p0', async ({ browser }) => {
  const w = world();
  const tom = w.accounts.TRANS.name;
  const devices = new Devices(browser, world);
  try {
    const coord = await devices.open('COORD');
    const trans = await devices.open('TRANS');
    const rev = await devices.open('REV');
    const trev = await devices.open('TREV');
    const view = await devices.open('VIEW');

    // Step 1: COORD asks TRANS to record P-X.
    await openByLabel(coord, PX);
    await button(coord, 'Something else?').click();
    await button(coord, /^Someone else should do this/).click();
    await coord.getByRole('radio', { name: new RegExp(tom) }).click();
    await expect(primary(coord)).toHaveAccessibleName(/^Ask Tom/);
    await primary(coord).click();
    await expectToast(coord, /Tom/);

    // Step 2: TRANS records and publishes Version 1, then asks the Peer check team.
    await onMyWork(trans, new RegExp(PX));
    await openFromWork(trans, PX);
    if (!(await byId(trans, 'record-button').isVisible().catch(() => false))) await button(trans, /^1\. Record\./).click();
    await recordParts(trans, 2);
    // Done asks the Peer check team in the same tap (decision 125).
    await byId(trans, 'publish-button').click();
    await button(trans, 'Ask the Peer check team').click();
    await expectToast(trans, /Sent to the Peer check team/);
    // REV and TREV each see the check.
    await onMyWork(rev, new RegExp(PX));
    await onMyWork(trev, new RegExp(PX));
    for (const p of [rev, trev]) expect(await screenText(p)).toMatch(new RegExp(`${PX} Peer check · asked by ${tom}|Check ${PX}`));

    // Step 3: REV's peer check: needs changes, with text.
    await openFromWork(rev, PX);
    await throughToDecide(rev);
    await button(rev, 'Needs changes').click();
    await button(rev, 'Or type it').click();
    await rev.locator('textarea').locator('visible=true').first().fill('Verse 5 is unclear');
    await primary(rev).click();
    await expectToast(rev, `Feedback sent to ${tom}`);
    // TRANS's My Work moves on to the feedback.
    await onMyWork(trans, new RegExp(PX));
    await openByLabel(trans, PX);
    await expect(primary(trans)).toHaveAccessibleName('Hear the feedback');

    // Step 4: Record a fix; Version 2, saying what changed.
    await primary(trans).click();
    await button(trans, 'Record a fix').click();
    await recordParts(trans, 1);
    await byId(trans, 'publish-button').click();
    await trans.getByRole('button', { name: /^What changed\./ }).locator('visible=true').first().click();
    await trans.getByPlaceholder('Or type it').locator('visible=true').first().fill('Said verse 5 more plainly');
    await button(trans, 'Done').click();
    // The answered check goes back to the peer check team (decided 2026-10-13: answering keeps it open): Done asks them again.
    await button(trans, 'Ask the Peer check team').click();
    await expectToast(trans, /Sent to the Peer check team/);

    // Step 5: REV's peer check on Version 2: looks good.
    await openByLabel(rev, PX);
    await syncUntil(rev, async () => (await rev.getByRole('button', { name: /^1\. Record\. Version 2/ }).count()) > 0);
    const doPeer = rev.getByRole('button', { name: /^Do the peer (check|review)$/ }).locator('visible=true');
    await expect(doPeer.first(), 'Version 2 goes back to the peer check').toBeVisible({ timeout: 30_000 });
    if (await doPeer.count()) {
      await doPeer.first().click();
      await throughToDecide(rev);
      await button(rev, 'Looks good').click();
      await expectToast(rev, /^Looks good/);
      await openByLabel(rev, PX);
    }

    // Step 6: REV back-translates Version 2 and publishes it.
    const bt = rev.getByRole('button', { name: /^Back-translate it$/ }).locator('visible=true');
    if (!(await bt.count())) await rev.getByRole('button', { name: /^Back translation, / }).locator('visible=true').first().click();
    await bt.first().click();
    await expect(text(rev, /Version 2/)).toBeVisible();
    await sayEachPart(rev, 3);
    await button(rev, 'Done').click();
    await button(rev, 'Finish the back translation').or(button(rev, 'Send later')).first().click();
    await expectToast(rev, 'Back translation published.');

    // Step 7: TRANS logs the Community Check: Already happened, looks good, at Village church.
    await openByLabel(trans, PX);
    await syncUntil(trans, async () => (await trans.getByRole('button', { name: /^Back translation, (looks good|done)/ }).count()) > 0);
    await trans.getByRole('button', { name: /^Community check, / }).locator('visible=true').first().click();
    await button(trans, 'Already happened').click();
    await button(trans, /^Add details/).click();
    await trans.getByPlaceholder(/^Where/).fill('Village church');
    await button(trans, 'Done').click();
    await throughToDecide(trans);
    await button(trans, 'Looks good').click();
    await expectToast(trans, 'Community check added to the record');
    await openByLabel(trans, PX);
    await expect(button(trans, /^Community check, looks good/)).toBeVisible();
    await trans.getByRole('button', { name: /^Community check, / }).locator('visible=true').first().click();
    await expect(text(trans, /Village church/)).toBeVisible();
    // The row opened a sheet, whose backdrop covers the header's Back (a run here failed so): close it first.
    await byId(trans, 'sheet-close').click();
    await backToTabs(trans);

    // Step 8: COORD does the consultant check (its required question answered): looks good.
    await openByLabel(coord, PX);
    await syncUntil(coord, async () => (await coord.getByRole('button', { name: 'Do the consultant check' }).count()) > 0);
    await button(coord, 'Do the consultant check').click();
    await throughToDecide(coord);
    await button(coord, 'Looks good').click();
    await expectToast(coord, /Looks good/);

    // Step 9: COORD does the final approval: looks good.
    await openByLabel(coord, PX);
    await button(coord, 'Do the final approval').click();
    await throughToDecide(coord);
    await button(coord, 'Looks good').click();
    await expectToast(coord, /Looks good/);

    // Step 10: VIEW opens P-X: done, and the chapter list counts it done.
    await syncUntil(view, async () => {
      await openByLabel(view, PX);
      return (await view.getByRole('button', { name: /^Final approval, looks good/ }).count()) > 0;
    }, 90_000);
    await expect(await passageRow(view, PX)).toHaveAccessibleName(new RegExp(`^${PX}\\. Done`));

    // On every device: nothing refused, nothing waiting, and the same events in the same order after the latest
    // server snapshot any of them started from (`deviceTail`: a device that opened after a snapshot never stores the
    // events before it). Every device pulls until they all agree; none is the reference, since the first may itself
    // be a pull behind. A failure says which device lacks which events.
    const pages = [coord, trans, rev, trev, view];
    const who = ['COORD', 'TRANS', 'REV', 'TREV', 'VIEW'];
    for (const page of pages) await expectClean(page, w);
    let logs: string[][] = [];
    let floor = 0;
    const differences = () => {
      const union = new Set(logs.flat());
      return logs.map((l, i) => {
        const has = new Set(l);
        const lacks = [...union].filter((e) => !has.has(e));
        return `${who[i]}: ${l.length} events after seq ${floor}${lacks.length ? `, lacks ${lacks.length}: ${lacks.slice(0, 8).join(', ')}` : ''}`;
      }).join('\n');
    };
    await expect.poll(async () => {
      for (const page of pages) await syncNow(page);
      const tails = await Promise.all(pages.map((page) => deviceTail(page, w)));
      floor = Math.max(...tails.map((t) => t.from));
      logs = tails.map((t) => t.events.filter((e) => e.seq > floor).map((e) => e.key));
      return logs.every((l) => JSON.stringify(l) === JSON.stringify(logs[0]));
    }, { timeout: 90_000, intervals: [1_000, 2_000, 3_000], message: 'every device holds the same events' }).toBe(true).catch((e: unknown) => {
      throw new Error(`The devices never held the same events:\n${differences()}\n${String(e)}`);
    });
    for (const l of logs.slice(1)) expect(l).toEqual(logs[0]);
    expect(await screenText(view)).not.toMatch(/This screen could not open/);
  } finally {
    await devices.close();
  }
});
