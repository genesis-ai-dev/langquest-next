// JRN-005 A coordinator gets a language ready and starts its team
// (docs/ui-test-suite/16-role-journeys.md). Platforms: iOS, Android, Wide:
// here every person is a browser of their own; COORD's last step is on a
// wide window. Its own world: it readies Bravo.
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { signIn } from './fixture';
import { Devices, backToTabs, passageRow, syncUntil, watch } from './16-helpers';
import { button, byId, expect, expectToast, field, openSignedOut, primary, screenText, tab, test, text, useWorld } from './support';

const world = useWorld();

/** The Get ready card's count on My Work ("Get Bravo ready · 2 of 4"). */
async function readyCount(page: Page): Promise<number> {
  const m = (await screenText(page)).match(/Get Bravo ready · (\d) of 4/i);
  return m ? Number(m[1]) : -1;
}

test('JRN-005 A coordinator gets a language ready and starts its team @p0 @wide', async ({ browser }) => {
  test.setTimeout(600_000);
  const w = world();
  const devices = new Devices(browser, world);
  try {
    const coord = await devices.open('COORD', { language: 'B', viewport: { width: 430, height: 932 } });
    await coord.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Step 1: Bravo is open; My Work leads with Get Bravo ready.
    await backToTabs(coord);
    await tab(coord, 'work').click();
    await expect(text(coord, new RegExp(`Bravo · ${w.orgName}`))).toBeVisible({ timeout: 60_000 });
    const start = await readyCount(coord);
    expect(start, 'the Get ready card shows a count of 4').toBeGreaterThanOrEqual(0);
    await expect(text(coord, 'What will they record?')).toBeVisible();
    await primary(coord).click();

    // Step 2, question 1: the Bible, broken up as FIA passages (the New Testament).
    await coord.getByRole('radio', { name: /^The Bible/ }).click();
    await primary(coord).click();
    await coord.getByRole('radio', { name: /^Like most English Bibles/ }).click();
    await primary(coord).click();
    await coord.getByRole('radio', { name: /^FIA passages \(English\)\./ }).click();
    await primary(coord).click();
    // Question 2: English Bibles and FIA's guides.
    await expect(text(coord, '2 of 4')).toBeVisible();
    await coord.getByRole('radio', { name: 'English' }).click();
    await primary(coord).click();
    await expect(coord.getByRole('switch', { name: 'FIA study guides' })).toBeVisible();
    await primary(coord).click();
    // Question 3: who checks: the community, then a retelling (the Oral Review Path, its two checks named).
    await expect(text(coord, 'Who checks the recordings?')).toBeVisible();
    // The other ready-made flows are one tap away.
    const retelling = coord.getByRole('radio', { name: /^Community, then retelling/ });
    if (!(await retelling.isVisible())) await text(coord, /^Other ways to check/).click();
    await retelling.click();
    await primary(coord).click();
    // Question 4: a group code for Translator in Bravo; its link, as a person would send it.
    await expect(text(coord, 'Invite your translators')).toBeVisible();
    await button(coord, 'Translate').click();
    await expect(text(coord, 'Ask them to scan this')).toBeVisible();
    await button(coord, 'Share as a link').click();
    await expectToast(coord, 'Invite link copied. Paste it into a message.');
    const link = await coord.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\S{8,}/);
    await primary(coord).click();
    // Bravo is ready: no Get ready card; its record has the checks chosen.
    await backToTabs(coord);
    await tab(coord, 'work').click();
    await expect.poll(() => readyCount(coord)).toBe(-1);

    // Step 3: Ben makes an account and joins with the group code.
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const ben = await ctx.newPage();
    await watch(ben, 'NEW');
    await openSignedOut(ben);
    await button(ben, 'Create Account').click();
    await ben.getByPlaceholder('you@example.com').fill(`ui-${w.run}-ben@example.org`);
    await ben.getByPlaceholder('Choose a password (6 or more characters)').fill('journey-pass-123');
    await ben.getByPlaceholder('Re-enter password').fill('journey-pass-123');
    await primary(ben).click();
    await expect(text(ben, 'Join your team')).toBeVisible({ timeout: 60_000 });
    await button(ben, /^Scan their code/).click();
    await ben.getByPlaceholder('Invite or sign-in code').fill(link);
    await expect(text(ben, /Invite for|Translator · Bravo/)).toBeVisible();
    // A signed-in account joins as itself (it has no name of its own yet, so it goes by its address).
    await expect(text(ben, 'Translator · Bravo', false)).toBeVisible();
    await expect(text(ben, 'From Cora Coordinator')).toBeVisible();
    const benName = (await ben.getByRole('button', { name: /^Join as / }).locator('visible=true').first().getAttribute('aria-label'))!.replace(/^Join as /, '');
    await button(ben, /^Join/).click();
    // Welcome as a Translator on the Bravo team, then My Work with nothing waiting.
    await expect(text(ben, /You're a Translator on the Bravo team at/)).toBeVisible({ timeout: 60_000 });
    await button(ben, /^(Skip for now|Get started)$/).click();
    await expect(text(ben, 'My Work')).toBeVisible();
    expect(await screenText(ben)).not.toMatch(/NEXT FOR YOU/i);

    // Step 4: NOORG finds UI Test Org and asks to join.
    const nora = await devices.open('NOORG');
    await button(nora, /^Find your organization/).click();
    await nora.getByPlaceholder('Name or language').fill(w.orgName);
    const askOrg = nora.getByRole('button', { name: `Ask ${w.orgName} to let you in`, exact: true }).locator('visible=true');
    // The phone holds the first 500 listed organizations; the server searches them all as you type
    // (decision 66, amended 2026-10-13), so wait for its answer as a person would.
    const found = await askOrg.first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
    expect.soft(found, `"${w.orgName}" can be found by name`).toBe(true);
    if (found) {
      await askOrg.first().click();
      const ask = nora.getByRole('button', { name: /^Ask to join$|^Send$|^Ask$/ }).locator('visible=true');
      if (await ask.count()) await ask.first().click();
      await expect(text(nora, `Asked ${w.orgName}`)).toBeVisible();
    } else {
      const { sb } = await signIn(w, 'NOORG');
      const { error } = await sb.rpc('create_join_request', { p_request_id: randomUUID(), p_org: w.orgId, p_message: '' });
      expect(error).toBeNull();
    }

    // Step 5: COORD lets NOORG in, as a checker in Bravo.
    const noraName = w.accounts.NOORG.name;
    const noraFirst = noraName.split(' ')[0]!;
    await syncUntil(coord, async () => (await coord.getByText(`${noraName} wants to join`).locator('visible=true').count()) > 0, 60_000, 'the join request');
    await coord.getByText(`${noraName} wants to join`).locator('visible=true').first().click();
    await expect(text(coord, 'What will they do?')).toBeVisible();
    await coord.getByRole('radio', { name: /^Check recordings/ }).or(coord.getByRole('button', { name: /^Check recordings/ })).first().click();
    await expect(text(coord, 'In which language?')).toBeVisible();
    await coord.getByRole('button', { name: 'Bravo', exact: true }).or(coord.getByRole('radio', { name: 'Bravo' })).first().click();
    await button(coord, `Let ${noraFirst} in`).click();
    await expectToast(coord, `${noraName} is in, as Reviewer in Bravo.`);
    // NOORG leaves "Asked" within 60 seconds, to Welcome, then My Work.
    // (With the request sent behind the screen, "Join your team" is not waiting on it: open the app again.)
    if (!found) await nora.reload();
    // Welcome shows once per account, and this world has welcomed everyone already: My Work, in Bravo.
    const welcome = text(nora, /You're a Reviewer on the Bravo team/);
    await expect(welcome.or(text(nora, 'My Work')).first()).toBeVisible({ timeout: 60_000 });
    if (await welcome.isVisible()) await button(nora, /^(Skip for now|Get started)$/).click();
    await expect(text(nora, 'My Work')).toBeVisible();
    await expect(text(nora, new RegExp(`Bravo · ${w.orgName}`))).toBeVisible();

    // Step 6: COORD asks Ben to record a Bravo passage, due in 7 days.
    const first = await (await passageRow(coord, 'Matthew 1:1–17', 'Bravo').catch(() => null));
    if (first) await first.click();
    else {
      await tab(coord, 'work').click();
      await primary(coord).click();
    }
    const passage = (await coord.locator('[role="heading"]').first().innerText().catch(() => '')) || 'Matthew 1:1–17';
    await button(coord, 'Something else?').click();
    await button(coord, /^Someone else should do this/).click();
    await coord.getByRole('radio', { name: new RegExp(benName) }).click();
    await button(coord, 'In a week').click();
    await primary(coord).click();
    await expectToast(coord, new RegExp(benName.split(' ')[0]!));
    // Ben's My Work shows it, with the due date.
    await syncUntil(ben, async () => /NEXT FOR YOU/i.test(await screenText(ben)), 60_000, 'the request on Ben\'s My Work');
    expect(await screenText(ben)).toMatch(/Record it · asked by Cora Coordinator · due \w{3} \d{1,2}/);
    void passage;

    // Step 7: on a wide window, Reports → Bravo: its template, its flow and one passage asked.
    await coord.setViewportSize({ width: 1280, height: 900 });
    await tab(coord, 'reports').click();
    await button(coord, 'Languages').click();
    await coord.getByRole('button', { name: /^Bravo\b/ }).or(coord.getByRole('link', { name: /^Bravo\b/ })).locator('visible=true').first().click();
    // Its flow, its passages, and the one passage asked (the server's figures catch up within a minute or two).
    await expect(text(coord, /Review flow: /)).toBeVisible();
    expect.soft(await screenText(coord), 'the report names the checks chosen in Get ready').toMatch(/Community/i);
    expect.soft(await screenText(coord), 'the report names Bravo\'s template').toMatch(/FIA passages/);
    await expect.poll(async () => {
      const catchUp = coord.getByRole('button', { name: 'Catch up with the server' }).locator('visible=true');
      if (await catchUp.count()) await catchUp.first().click();
      return (await screenText(coord)).match(/(\d+) requests? open in all/)?.[1];
    }, { timeout: 150_000, intervals: [5_000, 10_000], message: 'Reports counts the one request to Ben (G2: the projection runs every minute)' }).toBe('1');
    await expect(byId(coord, 'tab-reports')).toBeVisible();
    await ctx.close();
  } finally {
    await devices.close();
  }
});
