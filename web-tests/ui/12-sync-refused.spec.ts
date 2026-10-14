// SYNC-019 and SYNC-020 (docs/ui-test-suite/12-sync-and-offline.md): work
// refused event by event after a role change, then sent again once the role
// is back. On their own world: SYNC-019 makes TRANS a Reviewer, SYNC-020
// makes them a Translator again. Both run on one device (one browser
// context), since SYNC-020 sends what SYNC-019 left refused on it; when
// SYNC-019 failed (Playwright then starts a new worker), SYNC-020 makes the
// same state again on P-Q3. PLAN.md invariant 1: refused work stays on the
// device, marked, with its reason, and is shown.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { button, deviceEvents, expect, expectSyncIdle, syncNow, test, text, useWorld } from './support';
import {
  atA, caughtUp, deviceAs, eventsHere, openRecord, openSync, passageAs, quietReloads, recordAndPublish, serverHasAudio, setMembership, setOffline, syncChip, tile, toTab
} from './sync-helpers';

const world = useWorld();

// The shared dev server's hot reloads must not reload the app under a test.
test.beforeEach(async ({ context }) => { await quietReloads(context); });
let device: { context: BrowserContext; page: Page; before: number } | null = null;
test.afterAll(async () => { await device?.context.close(); });

const refusedOn = async (page: Page) => {
  const A = world().languages.A;
  return (await deviceEvents(page, A.orgId, A.languageId)).filter((e) => e.status === 'rejected');
};

/**
 * SYNC-019's steps 1 to 3: TRANS publishes `key` offline on their own device,
 * COORD makes them a Reviewer meanwhile, and the device comes online and is
 * refused. Returns the device and its event count from before it went online.
 */
async function makeRefused(browser: Browser, key: 'P-Q2' | 'P-Q3'): Promise<{ context: BrowserContext; page: Page; before: number }> {
  const w = world();
  const d = await deviceAs(browser, w, 'TRANS');
  const { page, context } = d;
  await caughtUp(page, w, 'TRANS');
  await setOffline(context, true);
  await recordAndPublish(page, w, key, 2);
  await expect(text(page, /^Version 1 · \d+:\d\d$/)).toBeVisible();
  await openSync(page);
  await expect.poll(() => eventsHere(page)).toBeGreaterThan(0);
  const before = await eventsHere(page);
  // Device 2 (COORD): TRANS is a Reviewer at LANG-A now (a new role at the same scope).
  await setMembership(w, 'COORD', 'TRANS', { add: { roleId: 'reviewer', scope: atA(w) } });
  await setOffline(context, false);
  await expect.poll(async () => { await syncNow(page).catch(() => {}); return (await refusedOn(page)).length; },
    { timeout: 60_000, intervals: [1_000, 2_000], message: 'the server refuses the work' }).toBeGreaterThan(0);
  return { ...d, before };
}

test('SYNC-019 Work refused after a role change is kept and shown @p0', async ({ browser }) => {
  const w = world();
  device = await makeRefused(browser, 'P-Q2');
  const { page, before } = device;
  await expect.poll(() => tile(page, 'refused by the server'), { timeout: 15_000 }).toBeGreaterThan(0);
  const refused = await tile(page, 'refused by the server');
  await expect(text(page, `Refused · ${refused}`)).toBeVisible();
  // Each row says the server's reason.
  for (const r of (await refusedOn(page)).slice(0, 20)) {
    expect(r.rejectReason).toBeTruthy();
    await expect(text(page, r.rejectReason!, false)).toBeVisible();
  }
  expect(await tile(page, 'waiting to upload')).toBe(0);
  // Not deleted: the count of events on this device did not drop.
  expect(await eventsHere(page)).toBeGreaterThanOrEqual(before);

  // Outside the Sync screen too (PLAN.md invariant 1): My Work's chip "Refused · n" and Me's More settings say it.
  await toTab(page, 'work');
  await expect.soft(syncChip(page), 'My Work\'s chip says work was refused').toBeVisible({ timeout: 10_000 });
  await toTab(page, 'me');
  await expect.soft(page.getByRole('button', { name: /^More settings[.,]? .*refused/i }).locator('visible=true'), 'Me\'s More settings says work was refused')
    .toBeVisible({ timeout: 5_000 });

  // The refused version leaves the passage on this device; Device 2 never had it.
  await openRecord(page, w, 'P-Q2');
  await expect(text(page, /^Version 1 · /)).toBeHidden();
  const { view } = await passageAs(w, 'COORD', w.passages['P-Q2'].unitId);
  expect(view.latest).toBeFalsy();
});

test('SYNC-020 Refused work goes again when access returns', async ({ browser }) => {
  const w = world();
  const key = device ? 'P-Q2' : 'P-Q3';
  if (!device) {
    await setMembership(w, 'COORD', 'TRANS', { add: { roleId: 'translator', scope: atA(w) } });
    device = await makeRefused(browser, 'P-Q3');
  }
  const { page } = device;
  expect((await refusedOn(page)).length, 'work is refused on this device').toBeGreaterThan(0);

  // Device 2 (COORD): TRANS is a Translator at LANG-A again.
  await setMembership(w, 'COORD', 'TRANS', { add: { roleId: 'translator', scope: atA(w) } });

  // The app hears of the role change and opens its section again (it left Sync for Me in an earlier run), so Sync is opened after a forced pull.
  await syncNow(page);
  await expectSyncIdle(page);
  await openSync(page);
  await button(page, 'Sync now').click();
  await expect(button(page, 'Sync now')).toBeEnabled({ timeout: 30_000 });
  await button(page, 'Sync now').click();
  await expect.poll(() => tile(page, 'refused by the server'), { timeout: 30_000 }).toBe(0);
  await expect.poll(() => tile(page, 'waiting to upload'), { timeout: 30_000 }).toBe(0);
  await expect(text(page, /^Refused · \d/)).toBeHidden();
  await toTab(page, 'work');
  await expect(syncChip(page)).toBeHidden({ timeout: 30_000 });
  // Device 2: Version 1 is there, by TRANS, and its audio is on the server.
  const { view } = await passageAs(w, 'COORD', w.passages[key].unitId);
  expect(view.latest?.by).toBe(w.accounts.TRANS.id);
  await expect.poll(() => serverHasAudio(w, 'COORD', view.latest!.cardHashes), { timeout: 60_000 }).toBe(true);
});
