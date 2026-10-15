// Helpers for the getting-in and no-organization tests (01-getting-in,
// 02-no-organization): invites and helpers' sign-in codes issued through the
// server the way the app issues them (invites.ts `issueInvite`,
// `issueSignInCode`), fresh accounts with no organization, and opening the
// app with a session of its own so a test that signs out never spends a
// session another test holds.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Scope } from '@langquest-next/core';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { browserStateFor, localServer, signIn, type AccountKey, type UiWorld } from './fixture';
import { waitForApp } from './support';

const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../../apps/mobile/src/account/accountData.ts', import.meta.url), 'utf8'))![1]!;

export function anon(): SupabaseClient {
  const s = localServer();
  return createClient(s.url, s.anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The local server's service role, for preconditions no screen can make (an invite expired in the past). */
export function service(): SupabaseClient {
  const s = localServer();
  return createClient(s.url, s.service, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomHex = (bytes = 32) => randomBytes(bytes).toString('hex');

export interface Invite { token: string; orgId: string; inviteId: string; link: string; schemeLink: string }

/** The web app's link for an invite (inviteCode.ts `inviteUri`), on this run's web server. */
export const inviteLink = (base: string, orgId: string, token: string) => `${base}/invite#org=${encodeURIComponent(orgId)}&token=${token}`;
export const signInLink = (base: string, code: string) => `${base}/signin#code=${code}`;

/**
 * An invite as Invite people makes it (issue_invite_v3): one person by
 * default, labelled with their name; a group invite when `maxUses` > 1.
 */
export async function issueInvite(world: UiWorld, base: string, opts: {
  issuer?: AccountKey; org?: 'org' | 'org2'; roleId?: string; scope?: Scope; label?: string | null; maxUses?: number; expiresAt?: string;
} = {}): Promise<Invite> {
  const { sb } = await signIn(world, opts.issuer ?? 'COORD');
  const orgId = opts.org === 'org2' ? world.org2Id : world.orgId;
  const token = randomHex();
  const inviteId = randomUUID();
  await rpc(sb, 'issue_invite_v3', {
    p_org: orgId, p_invite_id: inviteId, p_token_hash: sha256(token), p_role_id: opts.roleId ?? 'translator',
    p_scope: opts.scope ?? (opts.org === 'org2' ? { level: 'org' } : { level: 'language', languageId: world.languages.A.languageId }),
    p_expires_at: opts.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
    p_label: opts.label === undefined ? 'Test Person' : opts.label, p_max_uses: opts.maxUses ?? 1
  });
  return { token, orgId, inviteId, link: inviteLink(base, orgId, token), schemeLink: `langquestnext://invite?org=${encodeURIComponent(orgId)}&token=${token}` };
}

/**
 * A language's row on Explore and Find your organization, as the projection
 * worker writes it once a minute (server/projectionWorker.ts) for a language
 * listed publicly. Written here so a test does not wait on, or depend on,
 * the worker running (`npm run dev:local` starts it; a bare stack does not).
 */
export async function projectListing(world: UiWorld, key: 'A' | 'C'): Promise<void> {
  const { orgId, languageId, name } = world.languages[key];
  const sb = service();
  const lang = await sb.from('languages').select('code').eq('org_id', orgId).eq('language_id', languageId).maybeSingle();
  const { error } = await sb.from('public_languages').upsert({
    org_id: orgId, language_id: languageId, name, code: (lang.data as { code?: string } | null)?.code ?? '',
    translated_pct: 0, license: key === 'C' ? 'CC-BY-4.0' : 'all-rights-reserved', updated_at: new Date().toISOString()
  });
  if (error) throw new Error(`project listing ${name}: ${error.message}`);
}

export async function unprojectListing(world: UiWorld, key: 'A' | 'C'): Promise<void> {
  const { orgId, languageId } = world.languages[key];
  await service().from('public_languages').delete().eq('org_id', orgId).eq('language_id', languageId);
}

/** Make an invite expired, as if a week had passed (the server refuses to issue one in the past). */
export async function expireInvite(invite: Invite): Promise<void> {
  const { error } = await service().from('invites').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', invite.inviteId);
  if (error) throw new Error(`expire invite: ${error.message}`);
}

/** A helper's sign-in code (invites.ts `issueSignInCode`), made by `helper` for `who`. */
export async function issueSignInCode(world: UiWorld, opts: { helper?: AccountKey; who?: AccountKey; lost?: boolean } = {}): Promise<string> {
  const { sb } = await signIn(world, opts.helper ?? 'COORD');
  const code = randomHex();
  await rpc(sb, 'issue_sign_in_code_v2', { p_profile: world.accounts[opts.who ?? 'KEPT'].id, p_code_hash: sha256(code), p_lost: opts.lost ?? false });
  return code;
}

export async function expireSignInCode(code: string): Promise<void> {
  const { error } = await service().from('sign_in_codes').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('code_hash', sha256(code));
  if (error) throw new Error(`expire sign-in code: ${error.message}`);
}

export interface Fresh { id: string; email: string; password: string; name: string; session: Session; sb: SupabaseClient }

let made = 0;
/**
 * A new account with an email and password and no organization, as Create
 * Account makes it, with its profile name and the terms recorded. Its
 * address is unique to the run (`ui-<run>-new-<n>@example.test`).
 */
export async function newAccount(world: UiWorld, name = 'Nina Newcomer'): Promise<Fresh> {
  const sb = anon();
  const email = `ui-${world.run}-new-${++made}-${randomHex(2)}@example.test`;
  const password = randomHex(8);
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error || !data.session || !data.user) throw new Error(`sign up ${email}: ${error?.message ?? 'no session'}`);
  await rpc(sb, 'save_profile', { p_display_name: name });
  await rpc(sb, 'record_user_event', { p_id: `${data.user.id}:v1.TermsAccepted:${TERMS_VERSION}`, p_type: 'v1.TermsAccepted', p_payload: { version: TERMS_VERSION } });
  return { id: data.user.id, email, password, name, session: data.session, sb };
}

/** A fresh password address for an account a test makes through Create Account. */
export const newAddress = (world: UiWorld) => `ui-${world.run}-new-${++made}-${randomHex(2)}@example.test`;

function sessionKey(world: UiWorld): string {
  return `sb-${new URL(world.supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/** Put this localStorage in before the first load, then open `path`. */
async function openWithState(page: Page, state: Record<string, string>, path = '/'): Promise<void> {
  await page.addInitScript((entries) => {
    // Only on the first load in this browser: a test that signs out must stay signed out after the
    // reload that follows (which clears both storages on the web), so the mark is a cookie.
    if (document.cookie.includes('ui-state-put=1')) return;
    document.cookie = 'ui-state-put=1; path=/';
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, state);
  await page.goto(path);
  await waitForApp(page);
}

/**
 * Keep Metro's dev sockets (hot reload, reload commands) away from this
 * browser: other people editing the shared checkout would otherwise reload
 * the page in the middle of a test. The page gets a socket that stays
 * quiet, so it neither reloads nor complains.
 */
export async function quiet(context: BrowserContext): Promise<void> {
  await context.routeWebSocket(/\/(hot|message)(\?|$)/, () => {});
}

/** A world account signed in with a session of its own (so signing out spends nothing another test holds). */
export async function openFresh(page: Page, world: UiWorld, who: AccountKey, opts: { language?: 'A' | 'B' | 'C'; path?: string } = {}): Promise<void> {
  const { session } = await signIn(world, who);
  await openWithState(page, browserStateFor(world, who, opts.language ?? 'A', session), opts.path);
}

/** A fresh account (no organization) signed in, on Join your team. */
export async function openNew(page: Page, world: UiWorld, who: Fresh, path = '/'): Promise<void> {
  await openWithState(page, { [sessionKey(world)]: JSON.stringify(who.session), [`terms-version:${who.id}`]: TERMS_VERSION }, path);
}

/**
 * Before going offline: the app's storage is open (the dev web build loads
 * its database code and files lazily, so cutting the network earlier fails
 * storage itself, which a built app does not).
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(globalThis as { __langquestLog?: unknown }).__langquestLog, undefined, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

/** Type into a field the way a paste lands: the whole text at once. */
export async function paste(page: Page, label: string, value: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).locator('visible=true').first().fill(value);
}

/** Sign in through the Sign In screen. */
export async function signInWithForm(page: Page, name: string, password: string): Promise<void> {
  await page.getByLabel('Email or sign-in name', { exact: true }).locator('visible=true').first().fill(name);
  await page.getByLabel('Password', { exact: true }).locator('visible=true').first().fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).locator('visible=true').last().click();
}

/** Redeem an invite as someone else, through the server (another phone joining with it). */
export async function redeemAs(sb: SupabaseClient, token: string): Promise<void> {
  await rpc(sb, 'redeem_invite_v2', { p_token: token });
}

/** Is `profileId` a member of `orgId`? Asked as that account (my_organizations). */
export async function memberOf(sb: SupabaseClient): Promise<string[]> {
  const rows = await rpc<{ org_id: string }[]>(sb, 'my_organizations', {});
  return (rows ?? []).map((r) => r.org_id);
}

/** Wait for the visible page to show `value` somewhere. */
export async function sees(page: Page, value: string | RegExp, timeout?: number): Promise<void> {
  await expect(page.getByText(value, { exact: typeof value === 'string' }).locator('visible=true').first()).toBeVisible(timeout ? { timeout } : undefined);
}
