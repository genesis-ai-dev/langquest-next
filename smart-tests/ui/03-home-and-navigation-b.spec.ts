// 03 Home and navigation, the tests that change too much of the world to
// share 03-home-and-navigation.spec.ts's (docs/ui-test-suite, NAV): REV's
// requests done (NAV-017) and a viewer who asks for checks (NAV-033).
import { randomUUID } from 'node:crypto';
import { commands, derivePassage, type EventSpec } from '@langquest-next/core';
import type { Page } from '@playwright/test';
import type { SyncClient } from '@langquest-next/client';
import { send } from './fixture';
import { act, headerTitle, invite, languageAs, orgAs, settled, upload } from './nav-helpers';
import { button, expect, openAs, screenText, syncNow, tab, test, text, useWorld, type AccountKey } from './support';

const world = useWorld();
const W = () => world();

async function open(page: Page, who: AccountKey): Promise<void> {
  await page.context().routeWebSocket(/\/hot/, () => { /* no hot reloads from others' edits */ });
  await openAs(page, W(), who);
  await expect(page.locator('[data-testid^="tab-"]').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
  await settled(page);
  await syncNow(page);
}

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[${info.title}] SCREEN:`, await screenText(page).catch(() => '(closed)'));
});

test('NAV-017 Nothing is waiting on you', async ({ page }) => {
  // REV does the Peer Review asked on P-SUBMITTED and the Back Translation on P-BT, and checks P-ASIDE,
  // so every recorded passage in Alpha has a review. Resets: REV's two requests are done.
  const rev = await languageAs(W(), 'REV');
  const take = (k: 'P-SUBMITTED' | 'P-BT' | 'P-ASIDE') => derivePassage(rev.getState(), W().passages[k].unitId).latest!.takeId;
  await act(rev, (s) => commands(s).recordReview({ commandId: randomUUID(), takeIds: [take('P-SUBMITTED')], kindId: 'peer', outcome: 'looks_good', via: 'app' }), 'peer review');
  const bt = await upload(W(), 'REV', 1);
  await act(rev, (s) => commands(s).produceContent({ commandId: randomUUID(), fromTakeId: take('P-BT'), kindId: 'bt', cards: [bt], via: 'app' }), 'back translation');
  await act(rev, (s) => commands(s).recordReview({ commandId: randomUUID(), takeIds: [take('P-ASIDE')], kindId: 'peer', outcome: 'looks_good', via: 'app' }), 'peer review');

  await open(page, 'REV');
  await expect(text(page, 'Nothing is waiting on you')).toBeVisible();
  await expect(text(page, 'Find any passage on the Map to keep going.')).toBeVisible();
  await expect(text(page, 'Next for you')).toHaveCount(0);
  await button(page, 'Everything in Alpha').click();
  await expect.poll(() => headerTitle(page)).toBe('Alpha');
  // COORD's half (Bravo ready with every book waiting to be divided) needs 09 SETUP's template choice: run by hand.
});

test('NAV-033 The viewer\'s Inbox tab and its badge', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await open(page, 'VIEW');
  await expect(tab(page, 'inbox')).toHaveAttribute('aria-label', 'Inbox');

  // NEW (here OWNER2, of ORG2) holds "Asking viewer" at Alpha: Send to reviewers and View status only.
  const roleId = `role-${randomUUID()}`;
  const org = await orgAs(W(), 'ADMIN');
  await org.appendMany([{ id: randomUUID(), type: 'v1.RoleDefined', payload: { roleId, name: 'Asking viewer', privileges: ['send_to_reviewers', 'view_status'] } }] as never);
  await send(org as SyncClient<unknown>, 'Asking viewer');
  await invite(W(), 'ADMIN', 'OWNER2', roleId, { level: 'language', languageId: W().languages.A.languageId });
  // They ask REV for P-ASIDE's Back Translation, which nobody had asked for; REV does it.
  const asker = await languageAs(W(), 'OWNER2');
  const unitId = W().passages['P-ASIDE'].unitId;
  await act(asker, (s) => commands(s).ask({ commandId: randomUUID(), unitId, what: 'review', kindId: 'bt', profileId: W().accounts.REV.id }), 'ask REV');
  const rev = await languageAs(W(), 'REV');
  const card = await upload(W(), 'REV', 2);
  await act(rev, (s) => commands(s).produceContent({ commandId: randomUUID(), fromTakeId: derivePassage(s, unitId).latest!.takeId, kindId: 'bt', cards: [card], via: 'app' }) as EventSpec[], 'REV back-translates');

  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const p = await context.newPage();
  await open(p, 'OWNER2');
  await expect.poll(() => headerTitle(p)).toBe('Progress');
  await expect(tab(p, 'inbox')).toHaveAttribute('aria-label', 'Inbox, 1');
  await tab(p, 'inbox').click();
  await expect.poll(() => headerTitle(p)).toBe('Inbox');
  await expect(p.getByTestId('header-back').locator('visible=true')).toHaveCount(0);
  await expect.poll(() => screenText(p)).toMatch(/Rita did the Back (T|t)ranslation you asked for/);
  await text(p, /did the Back (T|t)ranslation you asked for/).click();
  await expect.poll(() => headerTitle(p)).toBe(W().passages['P-ASIDE'].label);
  await expect(tab(p, 'inbox')).toHaveCount(0);
  await p.getByTestId('header-back').locator('visible=true').click();
  await expect(tab(p, 'inbox')).toHaveAttribute('aria-label', 'Inbox');
  await context.close();

  // VIEW, a plain viewer, still has no badge: nothing is asked of them and they asked for nothing.
  await page.reload();
  await expect(tab(page, 'inbox')).toHaveAttribute('aria-label', 'Inbox');
});
