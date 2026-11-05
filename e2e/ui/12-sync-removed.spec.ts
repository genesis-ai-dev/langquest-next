// SYNC-018 (docs/ui-test-suite/12-sync-and-offline.md): work refused because
// the translator was removed from their only language while offline. On its
// own world: it takes TRANS out of LANG-A and leaves them out. PLAN.md
// invariant 1: the refused work stays on the device, marked, with its reason,
// and is shown.
import { deviceEvents, expect, expectSyncIdle, openAs, screenText, syncNow, test, text, useWorld } from './support';
import {
  atA, caughtUp, eventsHere, openRecord, openSync, passageAs, quietReloads, recordAndPublish, setMembership, setOffline, syncChip, tile, toTab
} from './sync-helpers';

const world = useWorld();

// The shared dev server's hot reloads must not reload the app under a test.
test.beforeEach(async ({ context }) => { await quietReloads(context); });


test('SYNC-018 Work refused after removal is kept and shown @p0', async ({ page, context }) => {
  const w = world();
  const A = w.languages.A;
  await openAs(page, w, 'TRANS');
  await caughtUp(page, w, 'TRANS');
  await setOffline(context, true);
  await recordAndPublish(page, w, 'P-Q1', 2);
  await expect(text(page, /^Version 1 · \d+:\d\d$/)).toBeVisible();
  const mine = (await deviceEvents(page, A.orgId, A.languageId)).filter((e) => e.status === 'pending');
  expect(mine.length).toBeGreaterThan(0);
  await openSync(page);
  await expect.poll(() => eventsHere(page)).toBeGreaterThan(0);
  const before = await eventsHere(page);

  // Device 2 (COORD) takes TRANS out of LANG-A, their only assignment.
  await setMembership(w, 'COORD', 'TRANS', { remove: atA(w) });

  await setOffline(context, false);
  await syncNow(page);
  await expect.poll(async () => (await deviceEvents(page, A.orgId, A.languageId)).filter((e) => e.status === 'rejected').length,
    { timeout: 60_000, message: 'the server refuses the work' }).toBeGreaterThan(0);
  const rows = await deviceEvents(page, A.orgId, A.languageId);
  // Nothing dropped: every event made offline is still on the device, now refused, each with a reason.
  for (const e of mine) expect(rows.some((r) => r.type === e.type)).toBe(true);
  expect(rows.filter((r) => r.status === 'rejected').every((r) => !!r.rejectReason)).toBe(true);

  // Known issue (2026-10-12): with no privileges left the app may route to "Join your team", where Sync cannot be opened.
  await expectSyncIdle(page);
  // Either the app routes away, or the Sync screen it is on says the server refused the account.
  await expect(text(page, 'Join your team', false).or(text(page, 'The server refused this account for this organization.'))).toBeVisible();
  const joinTeam = await text(page, 'Join your team', false).isVisible().catch(() => false);
  test.info().annotations.push({ type: 'SYNC-018 route', description: joinTeam ? 'went to Join your team (known issue)' : 'stayed in the organization' });
  expect.soft(joinTeam, 'the device stays where Sync can be opened').toBe(false);
  if (joinTeam) return;

  await toTab(page, 'work');
  await expect(syncChip(page)).toHaveAccessibleName(/^Not syncing/, { timeout: 30_000 });
  await syncChip(page).click();
  await expect.poll(() => tile(page, 'refused by the server')).toBeGreaterThan(0);
  const refused = await tile(page, 'refused by the server');
  await expect(text(page, `Refused · ${refused}`)).toBeVisible();
  expect(await tile(page, 'waiting to upload')).toBe(0);
  expect(await eventsHere(page)).toBeGreaterThanOrEqual(before);
  await expect(text(page, 'The server refused this account for this organization.')).toBeVisible();
  // Me's More settings says so.
  await toTab(page, 'me');
  await expect(text(page, 'This account cannot sync · password, notifications, account')).toBeVisible();
  // Refused work leaves the passage, but stays listed under Refused.
  await openRecord(page, w, 'P-Q1');
  await expect(text(page, /^Version 1 · /)).toBeHidden();
  expect(await screenText(page)).not.toMatch(/Published/);
  // Device 2 never shows it.
  const { view } = await passageAs(w, 'COORD', w.passages['P-Q1'].unitId);
  expect(view.latest).toBeFalsy();
});
