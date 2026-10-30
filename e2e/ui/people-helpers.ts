// Helpers for the people and roles tests (docs/ui-test-suite/10-people-and-roles.md):
// NEW accounts made on the local server for a test, opening the app as one,
// asking to join, and the ways to Members, Invite and a member's page.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { localServer } from './fixture';
import { back, button, expect, field, openAs, openSignedOut, leaveScreen, primary, screenText, tab, text, waitForApp, type AccountKey, type UiWorld } from './support';

const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../../apps/mobile/src/account/accountData.ts', import.meta.url), 'utf8'))![1]!;

const visible = (l: Locator) => l.locator('visible=true');

export interface NewPerson { id: string; email: string; password: string; name: string; session: Session; sb: SupabaseClient }

function anon(): SupabaseClient {
  const s = localServer();
  return createClient(s.url, s.anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The service role, for reading what the server keeps (invites) in a test. Local only (fixture.ts refuses anything else). */
export function serviceClient(): SupabaseClient {
  const s = localServer();
  return createClient(s.url, s.service, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** A NEW account (README, Accounts): an address for this run, a password, its name, terms accepted and the Welcome seen. */
export async function newPerson(world: UiWorld, name: string, opts: { welcomed?: boolean } = {}): Promise<NewPerson> {
  const email = `ui-${world.run}-${randomBytes(3).toString('hex')}@example.org`;
  const password = randomBytes(12).toString('hex');
  const made = await serviceClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`new account: ${made.error?.message ?? 'not made'}`);
  const sb = anon();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in as ${email}: ${error?.message ?? 'no session'}`);
  await rpc(sb, 'save_profile', { p_display_name: name });
  const id = data.user.id;
  await rpc(sb, 'record_user_event', { p_id: `${id}:v1.TermsAccepted:${TERMS_VERSION}`, p_type: 'v1.TermsAccepted', p_payload: { version: TERMS_VERSION } });
  if (opts.welcomed ?? true) await rpc(sb, 'record_user_event', { p_id: `${id}:v1.VisionSeen:1`, p_type: 'v1.VisionSeen', p_payload: {} });
  return { id, email, password, name, session: data.session, sb };
}

/** Ask to join an organization as this person, with a message (invites.ts `requestAccess`). Returns the request's id. */
export async function askToJoin(p: NewPerson, orgId: string, message = ''): Promise<string> {
  const requestId = randomUUID();
  await rpc(p.sb, 'create_join_request', { p_org: orgId, p_request_id: requestId, p_message: message });
  return requestId;
}

type Scope = { level: 'org' } | { level: 'language'; languageId: string };

/** Issue an invite as someone, the way the app's issueInvite does; returns the token, or throws with the server's refusal. */
export async function issueInviteAs(sb: SupabaseClient, orgId: string, roleId: string, scope: Scope, maxUses = 1, label: string | null = null): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await rpc(sb, 'issue_invite_v3', {
    p_org: orgId, p_invite_id: randomUUID(), p_token_hash: createHash('sha256').update(token).digest('hex'), p_role_id: roleId,
    p_scope: scope, p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), p_label: label, p_max_uses: maxUses
  });
  return token;
}

/**
 * Someone joins with an invite as a new person (no email, no password), as
 * the app's `joinByInvite` does through the `join` function. For a test whose
 * precondition an earlier test made in the UI, when that test did not run in
 * this world. Returns the new person's id and session.
 */
export async function joinAsNew(issuer: SupabaseClient, orgId: string, roleId: string, scope: Scope, name: string, opts: { group?: boolean } = {}): Promise<{ id: string; session: Session }> {
  const token = await issueInviteAs(issuer, orgId, roleId, scope, opts.group ? 30 : 1, opts.group ? null : name);
  const sb = anon();
  const { data, error } = await sb.functions.invoke('join', { body: { token, requestId: randomUUID(), ...(opts.group ? { name } : {}) } });
  if (error) throw new Error(`join as ${name}: ${error.message}`);
  const joined = data as { session: { access_token: string; refresh_token: string } };
  const set = await sb.auth.setSession(joined.session);
  if (set.error || !set.data.session || !set.data.user) throw new Error(`join as ${name}: ${set.error?.message ?? 'no session'}`);
  return { id: set.data.user.id, session: set.data.session };
}

/** A person's live memberships in an organization, from the server. */
export async function memberships(orgId: string, profileId: string): Promise<{ role_id: string; scope: Scope; removed: boolean }[]> {
  const { data, error } = await serviceClient().from('org_memberships').select('role_id, scope_level, language_id, removed').eq('org_id', orgId).eq('profile_id', profileId);
  if (error) throw new Error(error.message);
  return (data as { role_id: string; scope_level: string; language_id: string | null; removed: boolean }[]).map((r) => ({
    role_id: r.role_id, scope: r.scope_level === 'org' ? { level: 'org' } : { level: 'language', languageId: r.language_id! }, removed: r.removed
  }));
}

/** The profile ids with this display name who hold a live membership in the organization. */
export async function membersNamed(orgId: string, name: string): Promise<string[]> {
  const { data } = await serviceClient().from('profiles').select('id').eq('display_name', name);
  const out: string[] = [];
  for (const { id } of (data ?? []) as { id: string }[]) if ((await memberships(orgId, id)).some((m) => !m.removed)) out.push(id);
  return out;
}

/** The invite row the server keeps for a link or a token (`invites`, by its token hash). */
export async function inviteRow(linkOrToken: string): Promise<Record<string, unknown>> {
  const token = /token=([0-9a-f]+)/i.exec(linkOrToken)?.[1] ?? linkOrToken;
  const hash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await serviceClient().from('invites').select('*').eq('token_hash', hash).single();
  if (error) throw new Error(`invite row: ${error.message}`);
  return data as Record<string, unknown>;
}

/** localStorage for a NEW person, as fixture.ts `browserStateFor` gives a fixture account. */
function stateFor(world: UiWorld, p: NewPerson, inOrg: boolean): Record<string, string> {
  const ref = new URL(world.supabaseUrl).hostname.split('.')[0];
  const state: Record<string, string> = { [`sb-${ref}-auth-token`]: JSON.stringify(p.session) };
  if (inOrg) {
    state[`selection:${p.id}`] = JSON.stringify({ orgId: world.orgId });
    state[`language:${p.id}:${world.orgId}`] = world.languages.A.languageId;
  }
  state[`terms-version:${p.id}`] = TERMS_VERSION;
  state[`vision:${p.id}`] = '1';
  return state;
}

/**
 * No reloads from the shared dev server: Metro tells every open page to
 * reload when any source file changes, and a page that reloads mid-test
 * finds the old one's tab lock ("LangQuest is open in another tab").
 */
export async function quietReloads(target: Page | BrowserContext): Promise<void> {
  await target.routeWebSocket(/\/(hot|message)(\?|$)/, () => { /* held open, never told anything */ });
}

/**
 * A NEW person's own device: a fresh browser context signed in as them.
 * `asks` puts a join request in the device's account outbox, as "Find your
 * organization" → Ask does (entry.tsx `queueAccountAction`), and the device
 * sends it itself (`create_join_request`). The search is skipped because
 * Request Access lists an organization only once the projection pass has
 * listed its language (decision 66), which a fresh world has not had.
 */
export async function deviceForNew(browser: Browser, world: UiWorld, p: NewPerson,
  opts: { inOrg?: boolean; asks?: string; before?: (context: BrowserContext) => Promise<void> } = {}): Promise<{ context: BrowserContext; page: Page; requestId: string | null }> {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
  await quietReloads(context);
  await opts.before?.(context);
  const page = await context.newPage();
  const state = stateFor(world, p, opts.inOrg ?? false);
  const requestId = opts.asks !== undefined ? randomUUID() : null;
  if (requestId) {
    state[`account-outbox:${p.id}`] = JSON.stringify([
      { id: requestId, kind: 'join_request', payload: { orgId: world.orgId, message: opts.asks, orgName: world.orgName }, status: 'queued' }
    ]);
  }
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, state);
  await page.goto('/');
  await waitForApp(page);
  if (requestId) {
    // Sent by the device, not by the test.
    await expect.poll(async () => (await serviceClient().from('join_requests').select('id').eq('id', requestId)).data?.length ?? 0,
      { timeout: 60_000, message: 'the device sends its join request' }).toBe(1);
  }
  return { context, page, requestId };
}

/** A fresh device, signed out, on Sign In. */
export async function signedOutDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await quietReloads(context);
  const page = await context.newPage();
  await openSignedOut(page);
  return { context, page };
}

/** Sign In → "Scan a code" → paste the link or code. */
export async function pasteCode(page: Page, code: string): Promise<void> {
  await text(page, 'Scan a code').click();
  await visible(page.getByPlaceholder('Invite or sign-in code')).first().fill(code);
}

// ---- getting around ------------------------------------------------------------------

/** Org home (ADMIN, COORD) from the Manage tab. */
export async function orgHome(page: Page, world: UiWorld): Promise<void> {
  await tab(page, 'manage').click();
  await expect(text(page, world.orgName)).toBeVisible();
}

/** Org home → People → Members. */
export async function orgMembers(page: Page, world: UiWorld): Promise<void> {
  await orgHome(page, world);
  await text(page, 'Members').click();
  await expect(text(page, /^Organization members · /)).toBeVisible();
}

/** Alpha's page: Org home → Alpha, or straight from Manage for LADMIN. */
export async function alphaPage(page: Page, world: UiWorld, opts: { lead?: boolean } = {}): Promise<void> {
  await tab(page, 'manage').click();
  if (!opts.lead) {
    await expect(text(page, world.orgName)).toBeVisible();
    await page.getByRole('button', { name: /^Alpha / }).locator('visible=true').first().click();
  }
  await expect(text(page, 'People')).toBeVisible();
}

/** Alpha's page → People (its Members). */
export async function alphaMembers(page: Page, world: UiWorld, opts: { lead?: boolean } = {}): Promise<void> {
  await alphaPage(page, world, opts);
  await text(page, 'People').click();
  await expect(text(page, /^Language members · /)).toBeVisible();
}

/** A member's row in Members (their name, or "You"). */
export function memberRow(page: Page, name: string): Locator {
  return text(page, name);
}

/** A member's row in Members, by profile id (`person-<profileId>`). */
export function personRow(page: Page, profileId: string): Locator {
  return visible(page.getByTestId(`person-${profileId}`)).first();
}

/** Open a member's page from Members, and wait for its header. */
export async function openMember(page: Page, name: string): Promise<void> {
  await memberRow(page, name).click();
  await expect(visible(page.getByText(name, { exact: true })).first()).toBeVisible();
  await expect(text(page, /^Pick a role|^This person created/)).toBeVisible();
}

/**
 * Invite someone: one role's tile ("Translators", or a role's own name;
 * LAN-195), and its code on the same page. A role that does checks shows
 * them above its code; `checks` are ticked there, none by default.
 */
export async function inviteRole(page: Page, title: string, checks: readonly string[] = []): Promise<void> {
  await page.getByTestId(`invite-role-${title}`).locator('visible=true').first().click();
  await expect(page.getByTestId(`invite-role-${title}`).locator('visible=true').first()).toHaveAttribute('aria-checked', 'true');
  for (const c of checks) await page.getByRole('button', { name: c, exact: true }).locator('visible=true').first().click();
  await expect(text(page, 'Ask them to scan this')).toBeVisible();
}

/** The radio choices under "What will they do?" on a member's page, in order. */
export async function choicesUnder(page: Page, heading: string, until: string | RegExp): Promise<string[]> {
  const all = await screenText(page);
  const start = all.indexOf(heading);
  if (start < 0) return [];
  const rest = all.slice(start + heading.length);
  const end = typeof until === 'string' ? rest.indexOf(until) : rest.search(until);
  return rest.slice(0, end < 0 ? undefined : end).trim().split(/\s{1,}(?=[A-Z])/);
}

/** The names of the radio buttons on screen, in order. */
export async function radios(page: Page): Promise<string[]> {
  return visible(page.getByRole('radio')).evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()));
}

/** Leave a screen with the header's back arrow. */
export async function goBack(page: Page): Promise<void> {
  await back(page).click();
}

export { button, field, primary };

/** A fixture account on its own device, with no reloads from the dev server (support.ts deviceFor otherwise). */
export async function deviceAs(browser: Browser, world: UiWorld, who: AccountKey, opts: { language?: 'A' | 'B' | 'C' } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
  await quietReloads(context);
  const page = await context.newPage();
  await openAs(page, world, who, opts);
  return { context, page };
}

/** Back out of pushed screens until the tab bar shows. */
export async function toTabs(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (await tab(page, 'me').isVisible()) return;
    if (!(await leaveScreen(page))) await tab(page, 'me').or(back(page)).first().waitFor({ timeout: 2_000 }).catch(() => {});
  }
  await expect(tab(page, 'me'), 'the tab bar').toBeVisible();
}
