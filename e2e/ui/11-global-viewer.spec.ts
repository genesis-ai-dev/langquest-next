// docs/ui-test-suite/11-account-and-settings.md (ACCT, Global Viewers) on
// the web: a Global Viewer sets up an authenticator, enters its code, and
// reads another organization as a Viewer (decisions.md 158). Each test makes
// its own account and grants it as `npm run global-viewer -- grant` does
// (`global_viewer_grant`, as the service role), so no test shares an
// authenticator with another.
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { anon, newAccount, openNew, quiet, type Fresh } from './auth-helpers';
import { localServer } from './fixture';
import { back, button, byId, expect, field, openPassage, tab, tabsShown, test, text, useWorld } from './support';
import { mainButton, teamRow } from './05-passage-helpers';
import { totp } from './totp';

const world = useWorld();
test.beforeEach(async ({ context }) => { await quiet(context); });

/** A new account, granted as an operator grants one: no authenticator yet. */
async function newGlobalViewer(name: string): Promise<Fresh> {
  const fresh = await newAccount(world(), name);
  const s = localServer();
  const service = createClient(s.url, s.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.rpc('global_viewer_grant', { p_email: fresh.email, p_by: 'ui test', p_note: 'ui test' });
  if (error || data !== 'granted') throw new Error(`grant ${fresh.email}: ${error?.message ?? String(data)}`);
  return fresh;
}

/** An authenticator set up already (as on the setup call), and a fresh password sign-in, which has entered no code. */
async function withAuthenticator(fresh: Fresh): Promise<{ who: Fresh; key: string }> {
  const sb = anon();
  await sb.auth.signInWithPassword({ email: fresh.email, password: fresh.password });
  const enrolled = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'LangQuest' });
  if (enrolled.error) throw new Error(`enroll: ${enrolled.error.message}`);
  const verified = await sb.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(enrolled.data.totp.secret) });
  if (verified.error) throw new Error(`verify: ${verified.error.message}`);
  const again = anon();
  const { data, error } = await again.auth.signInWithPassword({ email: fresh.email, password: fresh.password });
  if (error || !data.session) throw new Error(`sign in again: ${error?.message ?? 'no session'}`);
  return { who: { ...fresh, session: data.session, sb: again }, key: enrolled.data.totp.secret };
}

const wayIn = (page: Page) => button(page, 'Global Viewer');

test('ACCT-052 A new Global Viewer sets up an authenticator on What brings you here?', async ({ page }) => {
  const gv = await newGlobalViewer('Gia Viewer');
  await openNew(page, world(), gv);
  await expect(wayIn(page)).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'Set up your authenticator to begin')).toBeVisible();
  // They may join or start an organization too, as anyone may.
  await expect(text(page, 'Find your organization')).toBeVisible();
  await wayIn(page).click();
  await button(page, 'Set up authenticator').click();
  const key = (await byId(page, 'global-viewer-key').textContent())?.replace(/\s/g, '') ?? '';
  expect(key).toMatch(/^[A-Z2-7]{16,}$/);
  await field(page, 'Code from your authenticator').fill(totp(key));
  await button(page, 'Check code').click();
  await expect(text(page, 'You can read every organization')).toBeVisible({ timeout: 30_000 });
});

test('ACCT-053 A wrong code is refused and opens nothing', async ({ page }) => {
  const { who, key } = await withAuthenticator(await newGlobalViewer('Gil Viewer'));
  await openNew(page, world(), who);
  await expect(text(page, 'Enter the code from your authenticator')).toBeVisible({ timeout: 60_000 });
  await wayIn(page).click();
  const right = totp(key, 1);
  const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, '0');
  await field(page, 'Code from your authenticator').fill(wrong);
  await button(page, 'Check code').click();
  await expect(text(page, 'That code is not right. Type the code your authenticator shows now.')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'You can read every organization')).toBeHidden();
});

test('ACCT-054 A Global Viewer opens another organization and only views it', async ({ page }) => {
  const { who, key } = await withAuthenticator(await newGlobalViewer('Gwen Viewer'));
  await openNew(page, world(), who);
  await expect(wayIn(page)).toBeVisible({ timeout: 60_000 });
  await wayIn(page).click();
  // The next period's code: the one before was used to set it up.
  await field(page, 'Code from your authenticator').fill(totp(key, 1));
  await button(page, 'Check code').click();
  await field(page, 'Organization or language').fill(world().orgName);
  await button(page, world().orgName).click();
  // The organization opens on a Viewer's overview, under the Map tab.
  await expect(tab(page, 'map')).toBeVisible({ timeout: 60_000 });
  // An admin's tabs but Work and the Inbox, and every language on the overview.
  expect(await tabsShown(page)).toEqual(['map', 'manage', 'me']);
  await expect(text(page, 'Alpha')).toBeVisible();
  // A passage offers nothing that would make work: no Edit or Record, nothing recorded to be thrown away.
  await openPassage(page, world(), 'P-NEW');
  expect(await mainButton(page)).toBeNull();
  await expect(page.getByRole('button', { name: /^(Record|Edit)\b/ }).locator('visible=true')).toHaveCount(0);
  await back(page).click();
  // Nor a review action on a check that waits: its row opens no sheet, Something else? offers only what helps.
  await openPassage(page, world(), 'P-SUBMITTED');
  await expect(teamRow(page, 'Peer check')).toBeDisabled();
  await button(page, 'Something else?').click();
  await expect(byId(page, 'else-reference')).toBeVisible();
  await expect(page.locator('[data-testid^="else-"]:not([data-testid="else-reference"])').locator('visible=true')).toHaveCount(0);
  await back(page).click();
  await back(page).click();
  // The link in the header says where they are, and lists the others to open instead.
  await byId(page, 'global-viewer-link').click();
  await expect(byId(page, 'global-viewer-here')).toHaveText(world().orgName);
  await expect(field(page, 'Organization or language')).toBeVisible();
});

test('ACCT-055 A Global Viewer reads Manage as its admins see it, and changes nothing', async ({ page }) => {
  const { who, key } = await withAuthenticator(await newGlobalViewer('Gus Viewer'));
  await openNew(page, world(), who);
  await expect(wayIn(page)).toBeVisible({ timeout: 60_000 });
  await wayIn(page).click();
  await field(page, 'Code from your authenticator').fill(totp(key, 1));
  await button(page, 'Check code').click();
  await field(page, 'Organization or language').fill(world().orgName);
  await button(page, world().orgName).click();
  // Manage opens the organization's page.
  await expect(tab(page, 'manage')).toBeVisible({ timeout: 60_000 });
  await tab(page, 'manage').click();
  await text(page, 'Members').click();
  await expect(text(page, world().accounts.ADMIN.name)).toBeVisible({ timeout: 30_000 });
  // The language's page has the link in its header too.
  await back(page).click();
  await text(page, 'Alpha').click();
  await expect(byId(page, 'global-viewer-link')).toBeVisible();
  await back(page).click();
  // Renaming the organization is not offered: it goes by the organization's own roles, and they hold none.
  await expect(byId(page, 'org-rename')).toHaveCount(0);
});

test('ACCT-056 A revoked Global Viewer account is an ordinary one', async ({ page }) => {
  const gv = await newGlobalViewer('Gil Revoked');
  const s = localServer();
  const service = createClient(s.url, s.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.rpc('global_viewer_revoke', { p_email: gv.email, p_by: 'ui test' });
  if (error || data !== 'revoked') throw new Error(`revoke: ${error?.message ?? String(data)}`);
  // Revoking ended every sign-in: a new one, with the password.
  const again = anon();
  const signedIn = await again.auth.signInWithPassword({ email: gv.email, password: gv.password });
  if (signedIn.error || !signedIn.data.session) throw new Error(`sign in again: ${signedIn.error?.message ?? 'no session'}`);
  await openNew(page, world(), { ...gv, session: signedIn.data.session, sb: again });
  await expect(text(page, 'Global Viewer access has ended')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, 'Find your organization')).toBeVisible();
  await expect(wayIn(page)).toBeHidden();
});

