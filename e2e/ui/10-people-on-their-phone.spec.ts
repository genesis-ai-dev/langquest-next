// PEOPLE-045 to PEOPLE-048 (docs/ui-test-suite/10-people-and-roles.md):
// what a new role, a removal and a scope mean on a member's own phone, and
// moderation by scope. Its own world: these tests change TRANS, remove a
// member and remove a note.
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { commands, type LanguageState } from '@langquest-next/core';
import type { SyncClient } from '@langquest-next/sync';
import { installMicControl, openWorkspace, recordParts } from './06-recording-helpers';
import { alphaMembers, deviceAs, deviceForNew, issueInviteAs, newPerson, quietReloads, toTabs } from './people-helpers';
import { clientAs, send, signIn } from './fixture';
import { caughtUp } from './sync-helpers';
import {
  back, button, deviceEvents, expect, expectSyncIdle, expectToast, openAs, primary, screenChanged, screenText, syncNow, tab, tabsShown, test, text, undoToast, useWorld
} from './support';

const world = useWorld();
const run = () => world().run;

test.beforeEach(async ({ page }) => { await quietReloads(page); });
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`SCREEN ${info.title}:`, await screenText(page).catch(() => '(closed)'));
});


test('PEOPLE-045 A member\'s new role reaches their phone', async ({ page, browser }) => {
  const w = world();
  const tom = w.accounts.TRANS.name;
  const trans = await deviceAs(browser, w, 'TRANS');
  await expect(tab(trans.page, 'work')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(trans.page)).toEqual(['work', 'map', 'me']);

  await openAs(page, w, 'ADMIN');
  await alphaMembers(page, w);
  await text(page, tom).click();
  await page.getByRole('radio', { name: 'Viewer', exact: true }).locator('visible=true').first().click();
  await primary(page).click();
  await expectToast(page, `${tom} is now Viewer`);

  // A viewer at Alpha (README, roles at a glance): the overview, Map, Inbox and Me; nothing to record.
  await syncNow(trans.page);
  await expect.poll(() => tabsShown(trans.page), { timeout: 60_000 }).toEqual(['map', 'inbox', 'me']);
  // What TRANS recorded stays on the record.
  const rows = await deviceEvents(trans.page, w.orgId, w.languages.A.languageId);
  expect(rows.filter((r) => r.type === 'v1.VersionPublished' || r.type === 'v1.TakeComposed').length).toBeGreaterThan(0);

  await undoToast(page);
  await expectToast(page, 'Put back.');
  await syncNow(trans.page);
  await expect.poll(() => tabsShown(trans.page), { timeout: 60_000 }).toEqual(['work', 'map', 'me']);
  await trans.context.close();
});

test('PEOPLE-046 A removed member\'s next sync is refused, and they are told', async ({ page, browser }) => {
  const w = world();
  // UI Joiner joins as a Translator at Alpha with an invite of ADMIN's.
  const joiner = await newPerson(w, `UI Joiner ${run()}`);
  const { sb: admin } = await signIn(w, 'ADMIN');
  const token = await issueInviteAs(admin, w.orgId, 'translator', { level: 'language', languageId: w.languages.A.languageId });
  const { error } = await joiner.sb.rpc('redeem_invite_v2', { p_token: token });
  expect(error).toBeNull();

  const theirs = await deviceForNew(browser, w, joiner, { inOrg: true, before: installMicControl });
  const p = theirs.page;
  await expect(tab(p, 'work')).toBeVisible({ timeout: 60_000 });
  // Alpha is on the device first; then one recording made offline, before the removal.
  await syncNow(p);
  // On the device means its cursors reach the server's. Not a count of rows in its log: a
  // device that adopts the server's snapshot of Alpha (decision 88) keeps only the events after it.
  await caughtUp(p, w, 'ADMIN', 'A');
  await p.context().setOffline(true);
  await openWorkspace(p, w, 'P-NEW');
  await recordParts(p, 1);
  const pending = async () => (await deviceEvents(p, w.orgId, w.languages.A.languageId)).filter((r) => r.status === 'pending').length;
  const unsent = await pending();
  expect(unsent).toBeGreaterThan(0);
  // Leave the workspace (nothing to save, decision 124): the part stays as a draft, unsent.
  await toTabs(p);

  // ADMIN removes them from Alpha, their only role.
  const org = await clientAs(w, 'ADMIN', 'org');
  await org.appendMany([{ type: 'v1.MemberRemoved', payload: { profileId: joiner.id, scope: { level: 'language', languageId: w.languages.A.languageId } } }] as never);
  await send(org as never, 'remove UI Joiner');

  await p.context().setOffline(false);
  await syncNow(p);
  // Never silent (PLAN.md invariant 1).
  await tab(p, 'work').click();
  await expect(text(p, 'Not syncing')).toBeVisible({ timeout: 60_000 });
  await tab(p, 'me').click();
  await expect(text(p, 'This account cannot sync · password, notifications, account')).toBeVisible();
  await text(p, 'More settings').click();
  await expect(text(p, 'This account cannot sync this organization')).toBeVisible();
  await text(p, 'Sync').click();
  await expect(text(p, 'The server refused this account for this organization.')).toBeVisible();
  // The recording stays on the device, counted, not dropped: still waiting, or kept as refused with the server's reason (SYNC, refused work).
  const mine = (await deviceEvents(p, w.orgId, w.languages.A.languageId)).filter((r) => r.status !== 'confirmed');
  expect(mine.length).toBe(unsent);
  expect(mine.filter((r) => r.type === 'v1.RecordingAdded').length).toBeGreaterThan(0);
  // Signing out says what happens to it.
  await toTabs(p);
  await tab(p, 'me').click();
  await text(p, 'Sign out').click();
  await expect(text(p, 'This account cannot sync this organization: the server refused it. Signing out is safe; anything queued stays on this device.')).toBeVisible();
  await theirs.context.close();
});

test('PEOPLE-047 A member at Alpha cannot see Bravo\'s work', async ({ page, browser }) => {
  const w = world();
  // TRANS's Map opens Alpha's map directly.
  await openAs(page, w, 'TRANS');
  await tab(page, 'map').click();
  await expect(text(page, 'Alpha', false)).toBeVisible();
  await expect(text(page, 'All languages')).toHaveCount(0);
  // Bravo's stream is not theirs to read: the server refuses it.
  await expect(clientAs(w, 'TRANS', 'B')).rejects.toThrow(/refused|read/i);

  // LADMIN: All languages may name Bravo (its name is in the organization's stream), but none of its work.
  const lead = await deviceAs(browser, w, 'LADMIN');
  await tab(lead.page, 'map').click();
  const bravo = text(lead.page, 'Bravo');
  if (await bravo.count()) {
    const before = await screenText(lead.page);
    await bravo.click();
    await screenChanged(lead.page, before);
    await expectSyncIdle(lead.page);
    const all = await screenText(lead.page);
    expect(all).not.toContain('This screen could not open');
    expect(all).not.toMatch(/Version \d|recorded/);
  }
  await expect(clientAs(w, 'LADMIN', 'B')).rejects.toThrow(/refused|read/i);
  await lead.context.close();
});

test('PEOPLE-048 Moderation by scope: what a language lead may remove', async ({ page, browser }) => {
  const w = world();
  // TREV leaves a note on P-NEEDS; REV reports it, and reports TREV as a person.
  const trev = await clientAs(w, 'TREV', 'A') as SyncClient<LanguageState>;
  const noteCommand = randomUUID();
  const note = `A note to report ${run()}`;
  await trev.appendMany(commands(trev.getState()).addNote({ commandId: noteCommand, unitId: w.passages['P-NEEDS'].unitId, anchor: { kind: 'passage' }, text: note }) as never);
  await send(trev as never, 'TREV note');
  const noteId = `note:${noteCommand}`;
  const { sb: rev } = await signIn(w, 'REV');
  for (const r of [
    { p_kind: 'note', p_target: noteId, p_language: w.languages.A.languageId, p_unit: w.passages['P-NEEDS'].unitId },
    { p_kind: 'person', p_target: w.accounts.TREV.id, p_language: null, p_unit: null }
  ]) {
    const { error } = await rev.rpc('report_content', { p_id: randomUUID(), p_org: w.orgId, p_profile: w.accounts.TREV.id, p_reason: 'offensive', p_details: null, ...r });
    expect(error).toBeNull();
  }

  // LADMIN: the content report, removable; not the person report.
  await openAs(page, w, 'LADMIN');
  await tab(page, 'work').click();
  await page.getByRole('button', { name: /^Updates/ }).locator('visible=true').first().click();
  await expect(text(page, 'Inbox')).toBeVisible();
  await expect(text(page, /^A note was reported/)).toBeVisible({ timeout: 30_000 });
  expect(await screenText(page)).not.toMatch(new RegExp(`${w.accounts.TREV.name} was reported|reported ${w.accounts.TREV.name}`));
  await text(page, /^A note was reported/).click();
  await button(page, 'Remove from the record').click();
  const confirm = button(page, 'Remove for everyone');
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expectToast(page, 'Removed from the record. Devices stop showing it when they next sync.');

  // COORD sees the report about the person, with Open Members.
  const coord = await deviceAs(browser, w, 'COORD');
  await tab(coord.page, 'work').click();
  await coord.page.getByRole('button', { name: /^Updates/ }).locator('visible=true').first().click();
  await expect(text(coord.page, new RegExp(w.accounts.TREV.name))).toBeVisible({ timeout: 30_000 });
  await text(coord.page, new RegExp(w.accounts.TREV.name)).click();
  await expect(text(coord.page, 'Open Members')).toBeVisible();
  await coord.context.close();
});
