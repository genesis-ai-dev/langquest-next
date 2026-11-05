// Helpers for 03 Home and navigation and 04 The Map (docs/ui-test-suite):
// changes to a fixture world made through the real server, as the person who
// would make them, and a few ways to read the screen those two files share.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { commands, derivePassage, ORG_STREAM, SEED_ROLES, type EventSpec, type LanguageState, type OrgState, type Scope } from '@langquest-next/core';
import { MemoryStore, SupabaseTransport, SyncClient } from '@langquest-next/sync';
import { blobKey } from '@langquest-next/sync/server';
import { setupBlobs } from './blob-upload';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { clientAs, send, signIn } from './fixture';
import { expect, openAs, type AccountKey, type PassageKey, type UiWorld } from './support';

type LangKey = 'A' | 'B' | 'C';

export async function languageAs(world: UiWorld, who: AccountKey, lang: LangKey = 'A'): Promise<SyncClient<LanguageState>> {
  return await clientAs(world, who, lang) as SyncClient<LanguageState>;
}

export async function orgAs(world: UiWorld, who: AccountKey): Promise<SyncClient<OrgState>> {
  return await clientAs(world, who, 'org') as SyncClient<OrgState>;
}

/** Append a command's specs against the client's current fold, then send it all. */
export async function act(client: SyncClient<LanguageState>, make: (s: LanguageState) => EventSpec[], what: string): Promise<void> {
  const specs = make(client.getState());
  if (specs.length) await client.appendMany(specs as never);
  await send(client as SyncClient<unknown>, what);
}

const id = () => randomUUID();

/** Ask a check's whole team (decision 91: one team per check, `check:<kindId>`). */
export async function askTeam(world: UiWorld, who: AccountKey, passage: PassageKey, kindId: string): Promise<void> {
  const c = await languageAs(world, who);
  await act(c, (s) => commands(s).ask({ commandId: id(), unitId: world.passages[passage].unitId, what: 'review', kindId, teamId: `check:${kindId}` }), `${who} asks the ${kindId} team`);
}

/**
 * Leave a book of Alpha waiting to be broken up (decision 74): every part of
 * it hidden, as book structure leaves a book nobody divided. Returns the
 * book's name as the template gives it.
 */
export async function leaveBookWaiting(world: UiWorld, who: AccountKey, usfm: string): Promise<void> {
  const c = await languageAs(world, who);
  const s = c.getState();
  const book = Object.keys(s.units).find((u) => s.units[u]!.kind === 'book' && s.units[u]!.parentUnitId === null && new RegExp(`(^|[/.])${usfm}$`).test(u.replace(/~[^/]*$/, '')));
  if (!book) throw new Error(`Alpha has no book ${usfm}`);
  const under = (u: string): boolean => { const p = s.units[u]!.parentUnitId; return p === book || (!!p && under(p)); };
  const parts = Object.keys(s.units).filter((u) => u !== book && under(u));
  await act(c, () => parts.map((unitId) => ({ id: id(), type: 'v1.UnitHidden', payload: { unitId, hidden: true } } as EventSpec)), `hide ${usfm}`);
}

/** NOORG asks to join ORG with a message (Request Access, invites.ts `requestAccess`). */
export async function askToJoin(world: UiWorld, who: AccountKey, message: string): Promise<void> {
  const { sb } = await signIn(world, who);
  const { error } = await sb.rpc('create_join_request', { p_org: world.orgId, p_request_id: id(), p_message: message });
  if (error) throw new Error(`create_join_request: ${error.message}`);
}

/** `issuer` invites `who` with a role at a scope, and `who` redeems it (decision 75). */
export async function invite(world: UiWorld, issuer: AccountKey, who: AccountKey, roleId: string, scope: Scope): Promise<void> {
  const a = await signIn(world, issuer);
  const token = randomBytes(32).toString('hex');
  const issued = await a.sb.rpc('issue_invite_v3', {
    p_org: world.orgId, p_invite_id: id(), p_token_hash: createHash('sha256').update(token).digest('hex'), p_role_id: roleId,
    p_scope: scope, p_expires_at: new Date(Date.now() + 86_400_000).toISOString(), p_label: null, p_max_uses: 1
  });
  if (issued.error) throw new Error(`issue_invite_v3: ${issued.error.message}`);
  const b = await signIn(world, who);
  const redeemed = await b.sb.rpc('redeem_invite_v2', { p_token: token });
  if (redeemed.error) throw new Error(`redeem_invite_v2: ${redeemed.error.message}`);
}

/** More languages in ORG, added by ADMIN (LanguageAdded in the organization's stream); codes run q00, q01… from `start`. */
export async function addLanguages(world: UiWorld, names: string[], start = 0): Promise<void> {
  const org = await orgAs(world, 'ADMIN');
  await org.appendMany(names.map((name, i) => ({
    id: id(), type: 'v1.LanguageAdded',
    payload: { languageId: `L-q${start + i}-${id().replace(/-/g, '').slice(0, 6)}`, name, code: `q${String(start + i).padStart(2, '0')}`, sourceCode: 'eng' }
  })) as never);
  await send(org as SyncClient<unknown>, 'more languages');
}

/**
 * An organization made by `who` as CreateOrg makes it (createOrg.ts), with no
 * language yet. Returns its id.
 */
export async function createEmptyOrg(world: UiWorld, who: AccountKey, name: string): Promise<string> {
  const { sb } = await signIn(world, who);
  const orgId = `org-${id()}`;
  const actorId = world.accounts[who].id;
  const org = new SyncClient<OrgState>({
    orgId, streamId: ORG_STREAM, actorId, deviceId: `ui-nav-${actorId}`,
    store: new MemoryStore(), transport: new SupabaseTransport(sb), newId: () => randomUUID()
  } as never);
  await org.load();
  await org.appendMany([
    { id: id(), type: 'v1.OrgCreated', payload: { name } },
    ...SEED_ROLES.map((r) => ({ id: id(), type: 'v1.RoleDefined', payload: { roleId: r.roleId, name: r.name, privileges: r.privileges } })),
    { id: id(), type: 'v1.MemberAdded', payload: { profileId: actorId, roleId: 'org_admin', scope: { level: 'org' } } },
    { id: id(), type: 'v1.LicenseSet', payload: { license: 'all-rights-reserved' } }
  ] as never);
  await send(org as SyncClient<unknown>, `${name}: created`);
  return orgId;
}

/** A distinct short WAV (16 kHz mono), uploaded where the app keeps the language's files (decision 69). */
export async function upload(world: UiWorld, who: AccountKey, n: number): Promise<{ hash: string; durationMs: number; format: 'wav' }> {
  const rate = 16000, total = rate * 2;
  const bytes = new Uint8Array(44 + total * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => { for (let k = 0; k < s.length; k++) v.setUint8(at + k, s.charCodeAt(k)); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); ascii(36, 'data'); v.setUint32(40, total * 2, true);
  const f = 170 + n * 7 + Math.floor(Math.random() * 50);
  for (let k = 0; k < rate; k++) v.setInt16(44 + k * 2, Math.round(0.4 * Math.sin(2 * Math.PI * f * k / rate) * 32767), true);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { session } = await signIn(world, who);
  await setupBlobs(world.apiUrl, session.access_token).put(blobKey(world.orgId, world.languages.A.languageId, hash, 'wav'), bytes);
  return { hash, durationMs: 2000, format: 'wav' };
}

/**
 * Take passages of Alpha through all four checks (README: MAP-020 makes one
 * chapter done): TRANS records and publishes, REV does the Peer Review, the
 * Back Translation and the Community Check, COORD the Consultant Check (with
 * its required answer) and the Final Approval.
 */
export async function finishPassages(world: UiWorld, unitIds: string[]): Promise<void> {
  const trans = await languageAs(world, 'TRANS');
  for (const [n, unitId] of unitIds.entries()) {
    const card = await upload(world, 'TRANS', n);
    const recordingId = id();
    await act(trans, (s) => commands(s).addRecording({ commandId: recordingId, recordingId, unitId, kind: 'target', card }), 'record');
    await act(trans, (s) => commands(s).keepTake({ commandId: id(), unitId, cardHashes: [card.hash], actorId: world.accounts.TRANS.id }), 'keep');
    await act(trans, (s) => commands(s).publishVersion({ commandId: id(), unitId, cardHashes: [card.hash], actorId: world.accounts.TRANS.id }), 'publish');
  }
  const takeOf = (s: LanguageState, unitId: string) => derivePassage(s, unitId).latest!.takeId;
  const rev = await languageAs(world, 'REV');
  for (const [n, unitId] of unitIds.entries()) {
    const take = takeOf(rev.getState(), unitId);
    await act(rev, (s) => commands(s).recordReview({ commandId: id(), takeIds: [take], kindId: 'peer', outcome: 'looks_good', via: 'app' }), 'peer');
    const bt = await upload(world, 'REV', 100 + n);
    await act(rev, (s) => commands(s).produceContent({ commandId: id(), fromTakeId: take, kindId: 'bt', cards: [bt], via: 'app' }), 'bt');
    await act(rev, (s) => commands(s).recordReview({ commandId: id(), takeIds: [take], kindId: 'community', outcome: 'looks_good', via: 'app', people: 4 }), 'community');
  }
  const coord = await languageAs(world, 'COORD');
  for (const unitId of unitIds) {
    const take = takeOf(coord.getState(), unitId);
    await act(coord, (s) => commands(s).recordReview({ commandId: id(), takeIds: [take], kindId: 'consultant', outcome: 'looks_good', via: 'app',
      answers: { [world.consultantQuestionId]: 'Yes' } }), 'consultant');
    await act(coord, (s) => commands(s).recordReview({ commandId: id(), takeIds: [take], kindId: 'final', outcome: 'looks_good', via: 'app' }), 'final');
  }
}

/** Passages of a Luke chapter in Alpha, in order, by unit id. */
export async function chapterUnits(world: UiWorld, chapter: number): Promise<string[]> {
  const c = await languageAs(world, 'VIEW');
  const s = c.getState();
  return Object.keys(s.units).filter((u) => s.units[u]!.kind === 'passage' && new RegExp(`/LUK\\.${chapter}\\.\\d+-\\d+$`).test(u.replace(/~[^/]*$/, '')))
    .sort((a, b) => (s.units[a]!.order < s.units[b]!.order ? -1 : 1));
}

// ---- reading the screen ---------------------------------------------------------------

/** The headings showing, in order; the screen header's title is the first. */
export async function headings(page: Page): Promise<string[]> {
  return page.getByRole('heading').locator('visible=true').allInnerTexts();
}

/** The title in the header of the screen on top. */
export async function headerTitle(page: Page): Promise<string> {
  return (await headings(page))[0] ?? '';
}

/**
 * The tab that is lit. The tabs carry `accessibilityState.selected`, but the
 * web export draws no aria-selected from it (react-native-web), so the lit tab
 * is read the way a sighted person reads it: the one label in its own colour.
 */
export async function litTab(page: Page): Promise<string | null> {
  const tabs = await page.locator('[data-testid^="tab-"]').evaluateAll((els) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .map((e) => {
      const texts = [...e.querySelectorAll('div, span')].filter((x) => x.childElementCount === 0 && (x.textContent ?? '').trim().length > 1);
      const label = texts.at(-1);
      return { id: e.getAttribute('data-testid')!.slice(4), selected: e.getAttribute('aria-selected'), color: label ? getComputedStyle(label).color : '' };
    }));
  const marked = tabs.find((t) => t.selected === 'true');
  if (marked) return marked.id;
  const lit = tabs.filter((t) => tabs.filter((o) => o.color === t.color).length === 1);
  if (lit.length !== 1) console.log('litTab: no one tab lit:', JSON.stringify(tabs));
  return lit.length === 1 ? lit[0]!.id : null;
}

/** Wait until My Work (or another home) has finished loading. */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/).locator('visible=true')).toHaveCount(0, { timeout: 60_000 });
}

/** A fresh phone-width browser for `who`, its own device. */
export async function phoneFor(browser: Browser, world: UiWorld, who: AccountKey, opts: { language?: LangKey; path?: string; width?: number } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 430, height: 932 } });
  const page = await context.newPage();
  await openAs(page, world, who, { ...(opts.language ? { language: opts.language } : {}), ...(opts.path ? { path: opts.path } : {}) });
  return { context, page };
}

/** Spoken labels of the visible elements that have one. */
export async function labels(page: Page): Promise<string[]> {
  return page.locator('[aria-label]').evaluateAll((els) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute('aria-label') ?? ''));
}
