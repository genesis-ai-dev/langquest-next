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
import { button, byId, expect, field, tab, tabsShown, test, text, useWorld } from './support';
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
  // A Global Viewer account joins no organization: the ways to join are not offered.
  await expect(text(page, 'Find your organization')).toBeHidden();
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
  // A Viewer's tabs, and the Global Viewer's own before Me: no Work and no Manage.
  expect(await tabsShown(page)).toEqual(['map', 'inbox', 'global', 'me']);
  // Their tab says where they are, and lists the others to open instead.
  await tab(page, 'global').click();
  await expect(byId(page, 'global-viewer-here')).toHaveText(world().orgName);
  await expect(field(page, 'Organization or language')).toBeVisible();
});
