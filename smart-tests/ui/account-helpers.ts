// Helpers for the account and moderation files (11-account-and-settings,
// 13-moderation): new accounts made for one test, opening the app without
// the init script that would sign it back in after a sign-out, and work
// written through the real server as another person.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { commands, type LanguageState } from '@langquest-next/core';
import type { SyncClient } from '@langquest-next/client';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { clientAs, localServer, send, signIn, type UiWorld } from './fixture';
import { button, expect, field, openAs, openPassage, primary, text, waitForApp, type AccountKey, type PassageKey } from './support';

const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../../apps/mobile/src/accountData.ts', import.meta.url), 'utf8'))![1]!;

/** The English catalog, for words the app says. */
export const en = JSON.parse(readFileSync(new URL('../../apps/mobile/src/i18n/en.json', import.meta.url), 'utf8')) as Record<string, unknown>;
export function catalog(code: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../../apps/mobile/src/i18n/${code}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
}
/** A string from a catalog by its dotted key, `{{name}}`-style placeholders filled. */
export function say(cat: Record<string, unknown>, key: string, vars: Record<string, string | number> = {}): string {
  const raw = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], cat);
  if (typeof raw !== 'string') throw new Error(`no string ${key}`);
  return raw.replace(/\{\{(\w+)(?:, *\w+)?\}\}/g, (_, k: string) => String(vars[k] ?? `{{${k}}}`));
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export interface NewAccount { key: AccountKey; id: string; email: string; password: string; name: string; session: Session; sb: SupabaseClient }

/**
 * A NEW account for one test (README: "NEW"), with the terms accepted and
 * the Welcome seen. `role` makes it a member of ORG at LANG-A by an invite
 * ADMIN issues and it redeems (decision 75); without one it belongs nowhere.
 */
export async function newAccount(world: UiWorld, n: number, role?: 'translator'): Promise<{ world: UiWorld; who: NewAccount }> {
  const s = localServer();
  const admin = createClient(s.url, s.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `ui-${world.run}-new${n}-${randomBytes(2).toString('hex')}@example.org`;
  const password = randomBytes(12).toString('hex');
  const name = `New Person ${n}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`NEW-${n}: ${made.error?.message ?? 'not made'}`);
  const sb = createClient(s.url, s.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`NEW-${n}: ${error?.message ?? 'no session'}`);
  const id = data.user.id;
  await rpc(sb, 'save_profile', { p_display_name: name });
  await rpc(sb, 'record_user_event', { p_id: `${id}:v1.TermsAccepted:${TERMS_VERSION}`, p_type: 'v1.TermsAccepted', p_payload: { version: TERMS_VERSION } });
  await rpc(sb, 'record_user_event', { p_id: `${id}:v1.VisionSeen:1`, p_type: 'v1.VisionSeen', p_payload: {} });
  if (role) {
    const { sb: adminSb } = await signIn(world, 'ADMIN');
    const token = randomBytes(32).toString('hex');
    await rpc(adminSb, 'issue_invite_v3', {
      p_org: world.orgId, p_invite_id: randomUUID(), p_token_hash: createHash('sha256').update(token).digest('hex'), p_role_id: role,
      p_scope: { level: 'language', languageId: world.languages.A.languageId },
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(), p_label: null, p_max_uses: 1
    });
    await rpc(sb, 'redeem_invite_v2', { p_token: token });
  }
  const key = `NEW${n}` as AccountKey;
  const who: NewAccount = { key, id, email, password, name, session: data.session, sb };
  return { world: { ...world, accounts: { ...world.accounts, [key]: { id, email, password, name, session: data.session } } }, who };
}

/** Delete an account made for a test (README: accounts made during a run are deleted at the end). */
export async function deleteNew(who: NewAccount): Promise<void> {
  await who.sb.rpc('delete_my_account');
}

/**
 * localStorage the app reads at start for this account (fixture.ts
 * `browserStateFor`): its session, the open organization and language
 * unless `member` is false, and the first-run marks.
 */
export function stateFor(world: UiWorld, key: AccountKey, opts: { session?: Session; member?: boolean; language?: 'A' | 'B' | 'C' } = {}): Record<string, string> {
  const who = world.accounts[key];
  const language = world.languages[opts.language ?? 'A'];
  const ref = new URL(world.supabaseUrl).hostname.split('.')[0];
  const state: Record<string, string> = { [`sb-${ref}-auth-token`]: JSON.stringify(opts.session ?? who.session) };
  if (opts.member !== false) {
    state[`selection:${who.id}`] = JSON.stringify({ orgId: language.orgId });
    state[`language:${who.id}:${language.orgId}`] = language.languageId;
  }
  state[`terms-version:${who.id}`] = TERMS_VERSION;
  state[`vision:${who.id}`] = '1';
  return state;
}

/**
 * Open the app signed in, written once into the page's storage and then
 * reloaded: unlike `openAs`, nothing puts the session back after the app
 * signs out or deletes the account and forgets the browser.
 */
export async function openOnce(page: Page, state: Record<string, string>): Promise<void> {
  await page.goto('/');
  await page.evaluate((entries) => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, state);
  await page.reload();
  await waitForApp(page);
}

/** A fresh session for an account, so signing out in one browser cannot touch another's (decision 87). */
export async function freshSession(world: UiWorld, key: AccountKey): Promise<Session> {
  return (await signIn(world, key)).session;
}

/** A language client as `key`, for writing what a test needs through the real server. */
export async function languageAs(world: UiWorld, key: AccountKey, lang: 'A' | 'B' | 'C' = 'A'): Promise<SyncClient<LanguageState>> {
  return await clientAs(world, key, lang) as SyncClient<LanguageState>;
}

/** A note on a whole passage, written by `key` through the server. Returns its note id. */
export async function noteAs(world: UiWorld, key: AccountKey, passage: PassageKey, words: string): Promise<string> {
  const client = await languageAs(world, key);
  const specs = commands(client.getState()).addNote({ commandId: randomUUID(), unitId: world.passages[passage].unitId, anchor: { kind: 'passage' }, text: words });
  await client.appendMany(specs as never);
  await send(client as SyncClient<unknown>, `${key}: note on ${passage}`);
  return (specs[0]!.payload as { noteId: string }).noteId;
}

/**
 * Open a passage through the Map's book and chapter, as a person does
 * offline (the Map's search is not there without a connection).
 */
export async function openPassageByBook(page: Page, world: UiWorld, key: PassageKey): Promise<void> {
  const { label, ref } = world.passages[key];
  const chapter = /^Luke (\d+):/.exec(ref)![1]!;
  await page.getByTestId('tab-map').locator('visible=true').last().click();
  const alpha = text(page, 'Alpha');
  if (!(await page.getByRole('button', { name: /^Luke/ }).locator('visible=true').count()) && await alpha.isVisible().catch(() => false)) await alpha.click();
  await button(page, /^Luke/).click();
  await button(page, new RegExp(`^Chapter ${chapter}:`)).click();
  await text(page, label, false).click();
  await expect(text(page, 'Something else?')).toBeVisible();
}

/** Wait until this device holds LANG-A (its Map lists Luke), then go back to My Work: ready to go offline. */
export async function languageLoaded(page: Page): Promise<void> {
  await page.getByTestId('tab-map').locator('visible=true').last().click();
  const luke = page.getByRole('button', { name: /^Luke/ }).locator('visible=true');
  const alpha = text(page, 'Alpha');
  await expect(luke.or(alpha).first()).toBeVisible({ timeout: 60_000 });
  if (!(await luke.count())) await alpha.click();
  await expect(luke.first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('tab-work').locator('visible=true').last().click();
}

/**
 * Add a note to a passage the way a person does: the record's "Something
 * else?", then "Add a note". Offline, the passage is found by its book and
 * chapter.
 */
export async function addNoteUI(page: Page, world: UiWorld, passage: PassageKey, words: string, opts: { offline?: boolean } = {}): Promise<void> {
  if (opts.offline) await openPassageByBook(page, world, passage);
  else await openPassage(page, world, passage);
  await text(page, 'Something else?').click();
  await button(page, 'Add a note').click();
  await field(page, 'Or type it').fill(words);
  await button(page, 'Add note').click();
  await expect(text(page, 'Note added — it follows this passage', false)).toBeVisible();
  await toTabs(page);
}

/** From a passage record: "Versions and history", with its History opened. */
export async function openHistory(page: Page): Promise<void> {
  await text(page, 'Versions and history').click();
  const history = button(page, /^History\./);
  // A card someone opened stays open when they come back (kit Disclosure): open it only if it says Show.
  if ((await history.innerText()).includes('Show')) await history.click();
  await expect(history).toContainText('Hide');
}

/**
 * Keep the dev server from reloading the page mid-test. Metro's web build
 * reloads every open page when any source file changes (its `/hot` and
 * `/message` sockets), and other people edit the app while the suite runs;
 * a reloaded page also trips the one-tab lock ("LangQuest is open in
 * another tab"). The sockets are answered here and never speak.
 */
export async function quietDevServer(context: BrowserContext): Promise<void> {
  await context.routeWebSocket(/^wss?:\/\/[^/]+\/(hot|message)(\?|$)/, () => { /* a socket that never says anything */ });
}

/** A second person on their own device, as support.ts `deviceFor`, kept from dev-server reloads. */
export async function quietDevice(browser: Browser, world: UiWorld, who: AccountKey, opts: { language?: 'A' | 'B' | 'C' } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
  await quietDevServer(context);
  const page = await context.newPage();
  await openAs(page, world, who, opts);
  return { context, page };
}

/** Back out of whatever is open until the tab bar shows. */
export async function toTabs(page: Page): Promise<void> {
  for (let i = 0; i < 8 && !(await page.getByTestId('tab-me').locator('visible=true').count()); i++) {
    const out = page.getByTestId('header-back').or(page.getByTestId('header-close')).locator('visible=true').last();
    if (!(await out.count())) break;
    await out.click();
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId('tab-me').locator('visible=true').last()).toBeVisible();
}

/** The account outbox's rows on this browser (durableOutbox.ts), to know a block or report has gone. */
export async function outboxRows(page: Page, actorId: string): Promise<{ kind: string; status: string }[]> {
  return page.evaluate((id) => {
    try {
      return (JSON.parse(localStorage.getItem(`account-outbox:${id}`) ?? '[]') as { kind: string; status: string }[])
        .map((a) => ({ kind: a.kind, status: a.status }));
    } catch { return []; }
  }, actorId);
}

/** Wait until nothing this account saved on this browser is still waiting to send. */
export async function expectAccountSent(page: Page, actorId: string, timeout = 30_000): Promise<void> {
  await expect.poll(async () => (await outboxRows(page, actorId)).filter((a) => a.status === 'queued').length, { timeout, message: 'account changes waiting' }).toBe(0);
}

/** Who `blocker` has blocked, as the server holds it. */
export async function serverBlocks(world: UiWorld, blocker: AccountKey): Promise<string[]> {
  const { sb } = await signIn(world, blocker);
  const { data, error } = await sb.from('user_blocks').select('blocked_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.blocked_id as string);
}

/** Set a block as `blocker` through the server, as the outbox does. */
export async function setBlocked(world: UiWorld, blocker: AccountKey, blocked: AccountKey, on: boolean): Promise<void> {
  const { sb } = await signIn(world, blocker);
  await rpc(sb, 'set_blocked', { p_profile: world.accounts[blocked].id, p_blocked: on });
}

/** A report made by `reporter` through the server, as the outbox sends it. */
export async function reportAs(world: UiWorld, reporter: AccountKey, target: { kind: 'version' | 'review' | 'note' | 'request' | 'person'; id: string; profileId: string; unitId?: string }, reason: string, details?: string): Promise<void> {
  const { sb } = await signIn(world, reporter);
  await rpc(sb, 'report_content', {
    p_id: randomUUID(), p_org: world.orgId, p_language: target.kind === 'person' ? null : world.languages.A.languageId, p_kind: target.kind,
    p_target: target.id, p_profile: target.profileId, p_reason: reason, p_details: details ?? null, p_unit: target.unitId ?? null
  });
}

/** Save a display name on the server, as Edit Profile's outbox does (used to put a name back). */
export async function saveName(world: UiWorld, key: AccountKey, name: string): Promise<void> {
  const { sb } = await signIn(world, key);
  await rpc(sb, 'save_profile', { p_display_name: name });
}

/** The main action, once it is enabled. */
export const mainAction = (page: Page) => primary(page);
