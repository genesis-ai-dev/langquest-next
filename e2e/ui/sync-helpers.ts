// Helpers for the sync, reports and web tests (docs/ui-test-suite/12, 14
// and 15). Offline on the web is the browser context's network switched off
// (`context.setOffline`); a second device is a second browser context; the
// other person's writes go through the real server with `clientAs`.
import { createHash, randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { commands, derivePassage, ORG_STREAM, SEED_ROLES, type EventSpec, type LanguageState, type OrgState, type Scope } from '@langquest-next/core';
import { blobKey, MemoryStore, SupabaseTransport, SyncClient, workerBlobs } from '@langquest-next/sync';
import { clientAs, send, signIn } from './fixture';
import { back, button, byId, expect, expectSyncIdle, expectToast, openAs, openPassage, primary, tab, text, type AccountKey, type PassageKey, type UiWorld } from './support';

export const id = (): string => randomUUID();

/**
 * Hold Metro's hot-reload socket open and silent, so another file saved
 * while a test runs does not reload or remount the app under it (the dev
 * server is shared). Call before the page loads.
 */
export async function quietReloads(target: Page | BrowserContext): Promise<void> {
  await target.routeWebSocket(/\/(hot|message)(\?|$)/, () => { /* held open, never told anything */ });
}

/** Another device: a fresh browser context, quiet, signed in as `who`. */
export async function deviceAs(browser: Browser, world: UiWorld, who: AccountKey,
  opts: { width?: number; height?: number; language?: 'A' | 'B' | 'C'; path?: string } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 430, height: opts.height ?? 932 }, permissions: ['microphone'] });
  await quietReloads(context);
  const page = await context.newPage();
  await openAs(page, world, who, { ...(opts.language ? { language: opts.language } : {}), ...(opts.path ? { path: opts.path } : {}) });
  return { context, page };
}

/** `who` starts an organization of their own and adds no language (as "Start a new one" does). Returns its id. */
export async function createEmptyOrgFor(world: UiWorld, who: AccountKey, name: string): Promise<string> {
  const { sb } = await signIn(world, who);
  const orgId = `org-${id()}`;
  const actorId = world.accounts[who].id;
  const org = new SyncClient<OrgState>({
    orgId, streamId: ORG_STREAM, actorId, deviceId: `ui-sync-${actorId}`,
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

type TabId = 'work' | 'map' | 'reports' | 'manage' | 'inbox' | 'me';

const heading = (page: Page) => page.getByRole('heading', { level: 1 }).locator('visible=true').first().innerText({ timeout: 2000 }).catch(() => '');

/** Step back (Back or ✕) until the tab bar shows, then press that tab. */
export async function toTab(page: Page, which: TabId): Promise<void> {
  const shown = () => tab(page, which).isVisible().catch(() => false);
  for (let i = 0; i < 10 && !(await shown()); i++) {
    const b = back(page);
    if (!(await b.isVisible().catch(() => false))) { await tab(page, which).or(b).first().waitFor({ timeout: 5000 }).catch(() => {}); continue; }
    const was = await heading(page);
    await b.click();
    await expect.poll(async () => (await shown()) || (await heading(page)) !== was, { timeout: 5000 }).toBe(true);
  }
  await tab(page, which).click();
}

/**
 * Wait until this device holds everything the server has for the
 * organization and the language (its cursors reach the server's), so a test
 * that goes offline next starts from a device that is up to date, as a
 * person's would be (G6, G7).
 */
export async function caughtUp(page: Page, world: UiWorld, who: AccountKey, lang: 'A' | 'B' | 'C' = 'A'): Promise<void> {
  const language = await languageAs(world, who, lang);
  const org = await orgAs(world, who);
  const want = { [world.languages[lang].languageId]: (await language.inspect()).cursor, [ORG_STREAM]: (await org.inspect()).cursor };
  const orgId = world.languages[lang].orgId;
  for (const [stream, seq] of Object.entries(want)) {
    await expect.poll(() => page.evaluate(async ([o, s]) => {
      const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog;
      if (!log) return 0;
      const rows = await log.select('select seq from cursors where org_id = ? and stream_id = ?', [o, s]) as { seq: number }[];
      return rows[0]?.seq ?? 0;
    }, [orgId, stream] as const), { timeout: 60_000, message: `the device has caught up with ${stream}` }).toBeGreaterThanOrEqual(seq);
  }
  // The fold follows the log: wait for the app to say it is idle.
  await expectSyncIdle(page, 15_000);
}

/** Wait until the open passage's offline line says it is all on this device. */
export async function keptHere(page: Page): Promise<void> {
  await expect(page.locator('[aria-label="On this device"]').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
}

/** Me, More settings, Sync. */
export async function openSync(page: Page): Promise<void> {
  await toTab(page, 'me');
  await text(page, 'More settings').click();
  await button(page, /^Sync[ ,]/).click();
  await expect(page.getByRole('heading', { name: 'Sync', exact: true }).locator('visible=true').first()).toBeVisible();
  await openSyncDetails(page);
}

/** The Sync screen keeps its counts, transfers and logs under Details: open it unless it already is. */
export async function openSyncDetails(page: Page): Promise<void> {
  // The web export does not expose the button's expanded state, so a tile showing is the sign it is open.
  const shown = page.getByTestId('sync-tile-waiting').locator('visible=true').first();
  if (await shown.isVisible()) return;
  await button(page, /^Details/).click();
  await expect(shown).toBeVisible();
}

/** A tile's number on the Sync screen ("12 waiting to upload"), read from its spoken label. */
export async function tile(page: Page, label: string): Promise<number> {
  await openSyncDetails(page);
  const el = page.locator(`[aria-label$=" ${label}"]`).locator('visible=true').first();
  const spoken = (await el.getAttribute('aria-label', { timeout: 10_000 })) ?? '';
  const m = /^([\d,.\s]+) /.exec(spoken);
  if (!m) throw new Error(`no number in "${spoken}"`);
  return Number(m[1]!.replace(/[^\d]/g, ''));
}

/** "741 events on this device" on the Sync screen. */
export async function eventsHere(page: Page): Promise<number> {
  const line = await text(page, /^[\d,]+ events? on this device$/).innerText();
  return Number(line.replace(/[^\d]/g, ''));
}

export const tileLocator = (page: Page, label: string): Locator => page.locator(`[aria-label$=" ${label}"]`).locator('visible=true').first();

/** Open a passage's record from wherever the app is. */
export async function openRecord(page: Page, world: UiWorld, key: PassageKey): Promise<void> {
  await toTab(page, 'map');
  await openPassage(page, world, key);
}

/** Open a passage that is not a fixture key, by its label as the map shows it ("Luke 17:11–19"). */
export async function openByLabel(page: Page, label: string): Promise<void> {
  await toTab(page, 'map');
  const search = () => page.getByRole('searchbox').or(page.getByPlaceholder(/Search|Find/)).locator('visible=true').first();
  if (!(await search().isVisible().catch(() => false))) await text(page, 'Alpha', false).click();
  await search().fill(label.replace(/–.*/, ''));
  await page.getByText(label, { exact: true }).locator('visible=true').first().click();
  await expect(text(page, label, false)).toBeVisible();
}

/** "Something else?", "Add a note", type it, "Add note"; back on the record afterwards. */
export async function addNote(page: Page, world: UiWorld, key: PassageKey, words: string, opts: { open?: boolean } = {}): Promise<void> {
  if (opts.open !== false) await openRecord(page, world, key);
  await button(page, 'Something else?').click();
  await button(page, 'Add a note').click();
  await page.getByRole('textbox', { name: 'Or type it' }).locator('visible=true').last().fill(words);
  await button(page, 'Add note').click();
  await expectToast(page, 'Note added — it follows this passage');
  await byId(page, 'header-close').click();
}

/**
 * Record `parts` parts with the voice file (one part about every four
 * seconds) and publish them as the next version: Done, then "Send later"
 * (or "Finish Version N" when no check is next). Leaves the passage's record showing.
 */
export async function recordAndPublish(page: Page, world: UiWorld, key: PassageKey, parts = 2, opts: { enter?: () => Promise<void> } = {}): Promise<void> {
  if (opts.enter) await opts.enter();
  else {
    await openRecord(page, world, key);
    const main = primary(page);
    await expect(main).toBeVisible();
    const label = (await main.innerText()).trim();
    if (/^(Record|Continue recording|Record a new version)$/.test(label)) await main.click();
    else await button(page, /^\d+\. Record\./).click();
  }
  await expect(text(page, /^Recording Version \d+|^Draft \d+/)).toBeVisible();
  const rec = byId(page, 'record-button');
  // The parts card counts what is there already (a revision starts from the last version's parts: "Version 1, 3 parts");
  // while recording, the recording view names the part being said at the end ("Part 4. …": three are kept).
  const count = async () => {
    const card = page.getByRole('button', { name: /^(Parts? 1(–\d+)?|Version \d+), \d+ parts?/ }).locator('visible=true').first();
    if (await card.count()) {
      const m = /, (\d+) parts?/.exec((await card.getAttribute('aria-label').catch(() => null)) ?? '');
      return m ? Number(m[1]) : 0;
    }
    const live = page.getByLabel(/^Part \d+\. /).locator('visible=true').first();
    if (!(await live.count())) return 0;
    const n = /^Part (\d+)\. /.exec((await live.getAttribute('aria-label').catch(() => null)) ?? '');
    return n ? Number(n[1]) - 1 : 0;
  };
  const before = await count();
  await rec.click();
  await expect(rec).toHaveAttribute('aria-label', 'Stop recording');
  await expect.poll(count, { timeout: 8_000 + parts * 6_000, message: `${parts} new parts` }).toBeGreaterThanOrEqual(before + parts);
  await rec.click();
  await expect(rec).toHaveAttribute('aria-label', 'Record');
  await byId(page, 'publish-button').click();
  await button(page, 'Send later').or(button(page, /^Finish Version \d+$/)).first().click();
  await expect(byId(page, 'toast')).toContainText(/^Version \d+ published\./);
}

// ---- the other side, through the real server ------------------------------------------

export async function languageAs(world: UiWorld, who: AccountKey, lang: 'A' | 'B' | 'C' = 'A'): Promise<SyncClient<LanguageState>> {
  return clientAs(world, who, lang) as Promise<SyncClient<LanguageState>>;
}

export async function orgAs(world: UiWorld, who: AccountKey): Promise<SyncClient<OrgState>> {
  return clientAs(world, who, 'org') as Promise<SyncClient<OrgState>>;
}

/** Append a command's events as `who` and send them; throws if the server refused any. */
export async function actAs(world: UiWorld, who: AccountKey, make: (s: LanguageState) => EventSpec[], what = 'test write'): Promise<void> {
  const c = await languageAs(world, who);
  await c.appendMany(make(c.getState()) as never);
  await send(c as SyncClient<unknown>, what);
}

/** A note on the whole passage, written by `who` on their own device. */
export async function noteAs(world: UiWorld, who: AccountKey, key: PassageKey, words: string): Promise<void> {
  await actAs(world, who, (s) => commands(s).addNote({ commandId: id(), unitId: world.passages[key].unitId, anchor: { kind: 'passage' }, text: words }), `${who} note`);
}

/** The passage as `who` sees it after catching up with the server. */
export async function passageAs(world: UiWorld, who: AccountKey, unitId: string) {
  const c = await languageAs(world, who);
  return { state: c.getState(), view: derivePassage(c.getState(), unitId) };
}

/** Membership changes, as an admin or coordinator makes them (orgAdmin.ts: a new role at a scope is another MemberAdded). */
export async function setMembership(world: UiWorld, by: AccountKey, who: AccountKey, op: { add?: { roleId: string; scope: Scope }; remove?: Scope }): Promise<void> {
  const c = await orgAs(world, by);
  const profileId = world.accounts[who].id;
  if (op.add) await c.append('v1.MemberAdded' as never, { profileId, roleId: op.add.roleId, scope: op.add.scope } as never);
  if (op.remove) await c.append('v1.MemberRemoved' as never, { profileId, scope: op.remove } as never);
  await send(c as SyncClient<unknown>, `${by} changes ${who}`);
}

export const atA = (world: UiWorld): Scope => ({ level: 'language', languageId: world.languages.A.languageId });

/** Every file of these hashes is on the server (the Worker's R2), as `who` may read it. */
export async function serverHasAudio(world: UiWorld, who: AccountKey, hashes: string[]): Promise<boolean> {
  const { session } = await signIn(world, who);
  const files = workerBlobs(world.apiUrl, session.access_token);
  const one = async (hash: string) => {
    for (const format of ['m4a', 'wav']) {
      const bytes = await files.get(blobKey(world.orgId, world.languages.A.languageId, hash, format)).catch(() => null);
      if (bytes && bytes.length > 0) return true;
    }
    return false;
  };
  return (await Promise.all(hashes.map(one))).every(Boolean);
}

/** Network off or on for every page of this device. */
export async function setOffline(context: BrowserContext, off: boolean): Promise<void> {
  await context.setOffline(off);
}

/** A WAV of `seconds` (a voiced tone), uploaded where the app keeps LANG-A's files, as `who`. */
export async function uploadWav(world: UiWorld, who: AccountKey, seconds: number): Promise<{ hash: string; durationMs: number; format: 'wav' }> {
  const rate = 16000;
  const total = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + total * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => { for (let k = 0; k < s.length; k++) view.setUint8(at + k, s.charCodeAt(k)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, total * 2, true);
  const carrier = 170 + Math.random() * 40;
  for (let k = 0; k < total; k++) {
    const t = k / rate;
    view.setInt16(44 + k * 2, Math.round((0.4 + 0.15 * Math.sin(2 * Math.PI * 3 * t)) * Math.sin(2 * Math.PI * carrier * t) * 32767), true);
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { session } = await signIn(world, who);
  const A = world.languages.A;
  await workerBlobs(world.apiUrl, session.access_token).put(blobKey(A.orgId, A.languageId, hash, 'wav'), bytes);
  return { hash, durationMs: Math.round(seconds * 1000), format: 'wav' };
}

/**
 * A voice note of `seconds` on the whole passage, by `who` on their own
 * device: its file uploaded, its format said in the log, and the note
 * (SYNC-026's other device).
 */
export async function voiceNoteAs(world: UiWorld, who: AccountKey, key: PassageKey, seconds: number): Promise<string> {
  const { hash } = await uploadWav(world, who, seconds);
  await actAs(world, who, (s) => [
    { id: id(), type: 'v1.AudioFormatSet', payload: { hash, format: 'wav' } } as EventSpec,
    ...commands(s).addNote({ commandId: id(), unitId: world.passages[key].unitId, anchor: { kind: 'passage' }, blobHash: hash })
  ], `${who} voice note`);
  return hash;
}

/** `who` records two parts of a passage on their own device and publishes them as its next version. */
export async function publishAs(world: UiWorld, who: AccountKey, key: PassageKey): Promise<void> {
  const unitId = world.passages[key].unitId;
  const cards = [await uploadWav(world, who, 3), await uploadWav(world, who, 3)];
  const c = await languageAs(world, who);
  for (const card of cards) {
    const recordingId = id();
    await c.appendMany(commands(c.getState()).addRecording({ commandId: recordingId, recordingId, unitId, kind: 'target', card }) as never);
  }
  const hashes = cards.map((x) => x.hash);
  await c.appendMany(commands(c.getState()).keepTake({ commandId: id(), unitId, cardHashes: hashes, actorId: world.accounts[who].id }) as never);
  await c.appendMany(commands(c.getState()).publishVersion({ commandId: id(), unitId, cardHashes: hashes, actorId: world.accounts[who].id }) as never);
  await send(c as SyncClient<unknown>, `${who} publishes ${key}`);
}

/** A setting on the organization's stream, as `who` saves it from a language's report (country, target). */
export async function orgWrite(world: UiWorld, who: AccountKey, type: string, payload: unknown): Promise<void> {
  const c = await orgAs(world, who);
  await c.append(type as never, payload as never);
  await send(c as SyncClient<unknown>, `${who} ${type}`);
}

/** The words of My Work's sync chip beside the bell, or null when there is none. */
/** My Work's sync icon. Its spoken name is the state ("Live", "Offline", "Not syncing"), then ", 3 to send" while work waits. */
export function syncChip(page: Page): Locator {
  return page.getByTestId('sync-indicator').locator('visible=true').first();
}

/** The sync icon's name when nothing is waiting and the server takes this device's work. */
export const SYNC_CLEAR = /^(Live|Connected)$/;
