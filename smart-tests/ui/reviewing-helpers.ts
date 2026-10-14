// Helpers for the reviewing and study files (07-reviewing, 08-study-and-reference):
// bringing a fixture passage to the state a test names, through the real
// server as the person who would do it (as fixture.ts builds the world), and
// a few screen steps both files share.
import { createHash, randomUUID } from 'node:crypto';
import { commands, derivePassage, type EventSpec, type LanguageState, type OrgState } from '@langquest-next/core';
import { blobKey, workerBlobs, type SyncClient } from '@langquest-next/client';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { buildWorld, clientAs, send, signIn, type UiWorld } from './fixture';
import { button, byId, expect, languageArrived, openAs, tab, test, text, type AccountKey, type PassageKey } from './support';

export const visible = (l: Locator): Locator => l.locator('visible=true');

/**
 * Wait until a tap-to-record microphone (bigVoice, voiceNote, reviewVoice) has
 * run for `seconds` by its own clock ("Listening… 0:04", "Recording · 0:04 ·
 * tap to stop"). These recorders keep whatever the microphone hears, with no
 * voice detector and so no "N pieces so far" count; the voice file speaks
 * 1.5 s in every 4 s, so three or more seconds always hold some of it.
 */
export async function recordedFor(page: Page, seconds: number): Promise<void> {
  const clock = visible(page.getByText(/^(Listening… |Recording · )\d+:\d\d/)).first();
  await expect.poll(async () => {
    const m = /(\d+):(\d\d)/.exec(await clock.innerText().catch(() => ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
  }, { timeout: seconds * 1000 + 10_000 }).toBeGreaterThanOrEqual(seconds);
}

/**
 * One world for the whole run of a spec file, like support.ts `useWorld`,
 * kept across worker restarts. Playwright starts a new worker after a failed
 * test, and that worker's beforeAll would build a new world, so every later
 * test would find none of the state the earlier ones left (P-CHECK's
 * consultant check passed, P-Q3's back translation asked...). The world is
 * written beside the run's results, keyed by the runner's process, and read
 * back by the next worker; `setup` runs once, when it is built.
 */
export function useRunWorld(name: string, setup?: (w: UiWorld) => Promise<void>): () => UiWorld {
  let world: UiWorld | null = null;
  test.beforeAll(async () => {
    test.setTimeout(300_000); // ceiling: builds the whole fixture world on the shared local server, up to three tries
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results', 'worlds');
    const file = path.join(dir, `${name}-${process.ppid}.json`);
    if (existsSync(file)) { world = JSON.parse(readFileSync(file, 'utf8')) as UiWorld; return; }
    const built = await buildWorld();
    if (setup) await setup(built);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(built));
    world = built;
  });
  return () => {
    if (!world) throw new Error('The world is not built yet (useRunWorld must be called at the top of the file).');
    return world;
  };
}

const id = () => randomUUID();
let voiceN = 1000;

/** A distinct WAV (a voiced burst, then silence), uploaded where the app keeps the language's files. */
export async function uploadVoice(world: UiWorld, who: AccountKey, voicedSeconds = 1.5, totalSeconds = 3) {
  const rate = 16000;
  const total = Math.round(totalSeconds * rate);
  const voiced = Math.round(voicedSeconds * rate);
  const bytes = new Uint8Array(44 + total * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => { for (let k = 0; k < s.length; k++) view.setUint8(at + k, s.charCodeAt(k)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, total * 2, true);
  const carrier = 150 + (voiceN++ % 400) * 0.7 + Math.random();
  for (let k = 0; k < voiced; k++) {
    const t = k / rate;
    view.setInt16(44 + k * 2, Math.round((0.45 + 0.15 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * carrier * t) * 32767), true);
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { session } = await signIn(world, who);
  const A = world.languages.A;
  await workerBlobs(world.apiUrl, session.access_token).put(blobKey(A.orgId, A.languageId, hash, 'wav'), bytes);
  return { hash, durationMs: Math.round(totalSeconds * 1000), format: 'wav' as const };
}

/** A passage of LANG-A by its label on the map ("John 3:9–21"). */
export function unitByLabel(state: LanguageState, label: string): string {
  const found = Object.entries(state.units).find(([, u]) => u.kind === 'passage' && u.label === label);
  if (!found) throw new Error(`LANG-A has no passage "${label}"`);
  return found[0];
}

/** A language client as `who` on LANG-A, caught up. */
export async function langAs(world: UiWorld, who: AccountKey): Promise<SyncClient<LanguageState>> {
  return await clientAs(world, who, 'A') as SyncClient<LanguageState>;
}

/** Append a command's specs against the client's current fold, and send them. */
export async function act(client: SyncClient<LanguageState>, make: (s: LanguageState) => EventSpec[], what: string): Promise<void> {
  const specs = make(client.getState());
  if (specs.length) await client.appendMany(specs as never);
  await send(client as SyncClient<unknown>, what);
}

/**
 * `who` records `parts` new parts of a passage and publishes them as its next
 * version, saying what changed in `note` (typed) or by voice. Returns the new
 * version's take id.
 */
export async function publishVersion(world: UiWorld, who: AccountKey, key: PassageKey | { label: string }, opts: { parts?: number; note?: string; voiceNote?: boolean } = {}): Promise<string> {
  const c = await langAs(world, who);
  const unitId = typeof key === 'string' ? world.passages[key].unitId : unitByLabel(c.getState(), key.label);
  const cards = await Promise.all(Array.from({ length: opts.parts ?? 3 }, () => uploadVoice(world, who)));
  const changed = opts.voiceNote ? await uploadVoice(world, who, 2.5, 3) : null;
  const actorId = world.accounts[who].id;
  for (const card of cards) {
    const recordingId = id();
    await c.appendMany(commands(c.getState()).addRecording({ commandId: recordingId, recordingId, unitId, kind: 'target', card }) as never);
  }
  await c.appendMany(commands(c.getState()).keepTake({ commandId: id(), unitId, cardHashes: cards.map((x) => x.hash), actorId }) as never);
  if (changed) await c.appendMany([{ id: id(), type: 'v1.AudioFormatSet', payload: { hash: changed.hash, format: 'wav' } }] as never);
  await c.appendMany(commands(c.getState()).publishVersion({
    commandId: id(), unitId, cardHashes: cards.map((x) => x.hash), actorId,
    ...(opts.note ? { note: opts.note } : {}), ...(changed ? { noteBlobHash: changed.hash } : {})
  }) as never);
  await send(c as SyncClient<unknown>, `${who} publishes ${key}`);
  return derivePassage(c.getState(), unitId).latest!.takeId;
}

/** `who` asks `profile` for a check (`kindId`) or a recording of a passage. */
export async function ask(world: UiWorld, who: AccountKey, key: PassageKey, what: { kindId?: string; profile: AccountKey }): Promise<void> {
  const c = await langAs(world, who);
  await act(c, (s) => commands(s).ask({
    commandId: id(), unitId: world.passages[key].unitId, profileId: world.accounts[what.profile].id,
    ...(what.kindId ? { what: 'review', kindId: what.kindId } : { what: 'record' })
  } as never), `${who} asks ${what.profile} about ${key}`);
}

/** `who` reviews a passage's latest version. */
export async function reviewLatest(world: UiWorld, who: AccountKey, key: PassageKey, kindId: string, outcome: 'looks_good' | 'needs_changes', comment?: string): Promise<void> {
  const c = await langAs(world, who);
  const takeId = derivePassage(c.getState(), world.passages[key].unitId).latest!.takeId;
  await act(c, (s) => commands(s).recordReview({ commandId: id(), takeIds: [takeId], kindId, outcome, via: 'app', ...(comment ? { comment } : {}) }),
    `${who} reviews ${key}`);
}

/** The passage as `who`'s client sees it now (after catching up). */
export async function passageNow(world: UiWorld, who: AccountKey, key: PassageKey) {
  const c = await langAs(world, who);
  return derivePassage(c.getState(), world.passages[key].unitId);
}

/**
 * Offer the library's worked study guides (LangQuest's "Example study guides
 * (English)", which hold Luke 15:11-32) to the organization, as an admin who
 * follows them from the library does. The local library's FIA English guides
 * cover only Genesis 2:4-25, which LANG-A's New Testament does not reach.
 */
export async function offerExampleGuides(world: UiWorld): Promise<void> {
  const { sb } = await signIn(world, 'ADMIN');
  const { data, error } = await sb.rpc('library_shared_items', { p_kind: 'material', p_query: null, p_limit: 500, p_offset: 0 });
  if (error) throw new Error(error.message);
  const item = (data as { org_id: string; org_name: string; item_id: string; kind: string; name: string; latest_hash: string }[])
    .find((r) => r.item_id === 'langquest.examples.eng');
  if (!item) throw new Error('The library has no "Example study guides (English)"; run npm run library:seed');
  const adopted = await sb.rpc('library_adopt', { p_org: world.orgId, p_source_org: item.org_id, p_source_item: item.item_id, p_hash: item.latest_hash });
  if (adopted.error) throw new Error(adopted.error.message);
  const org = await clientAs(world, 'ADMIN', 'org') as SyncClient<OrgState>;
  const itemId = `${item.org_id}.${item.item_id}`;
  if (org.getState().library[itemId]) return;
  await org.appendMany([
    { id: id(), type: 'v1.LibrarySubscribed', payload: { itemId, kind: 'material', sourceOrgId: item.org_id, sourceOrgName: item.org_name, sourceItemId: item.item_id, name: item.name, autoUpdate: true, active: true } },
    { id: id(), type: 'v1.LibraryPinned', payload: { itemId, kind: 'material', docHash: item.latest_hash } }
  ] as never);
  await send(org as SyncClient<unknown>, 'ADMIN follows the example study guides');
}

// ---- screen steps ----

/**
 * The dev server's hot-reload sockets, answered here instead of by Metro. The
 * suite runs against `expo start --web`, and any edit to the app's files (by
 * anyone working in the tree) reloads every open page mid-test; the reloaded
 * tab can then come up as "LangQuest is open in another tab" (tabLock.ts).
 * Nothing of the app changes: only the dev server's reload never arrives.
 */
export async function quiet(target: Page | BrowserContext): Promise<void> {
  await target.routeWebSocket(/:\/\/[^/]+\/(hot|message)(\?|$)/, () => { /* never connected: no reloads mid-test */ });
}

/** Every toast the page shows, in order, kept in `window.__uiToasts` (a toast can come and go between two checks). */
function logToasts(): void {
  const w = window as unknown as { __uiToasts?: string[] };
  if (w.__uiToasts) return;
  const seen: string[] = (w.__uiToasts = []);
  let last = '';
  const look = () => {
    for (const el of Array.from(document.querySelectorAll('[data-testid="toast"]'))) {
      const s = (el as HTMLElement).innerText.trim();
      if (s && s !== last) { last = s; seen.push(s); }
    }
  };
  const start = () => new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
}

/** openAs, with the dev server kept quiet and the toasts logged. */
export async function open(page: Page, world: UiWorld, who: AccountKey, opts: Parameters<typeof openAs>[3] = {}): Promise<void> {
  await quiet(page.context());
  await page.addInitScript(logToasts);
  await openAs(page, world, who, opts);
}

/** A toast with this message was shown (it may have gone already); returns every toast seen. */
export async function sawToast(page: Page, message: string | RegExp, timeout = 20_000): Promise<void> {
  const seen = () => page.evaluate(() => (window as unknown as { __uiToasts?: string[] }).__uiToasts ?? []);
  try {
    await expect.poll(async () => (await seen()).some((s) => (typeof message === 'string' ? s.includes(message) : message.test(s))), { timeout }).toBe(true);
  } catch {
    throw new Error(`No toast "${String(message)}". Toasts shown: ${JSON.stringify(await seen().catch(() => []))}`);
  }
}

/** A second person on their own device (as support.ts deviceFor), with the dev server kept quiet. */
export async function device(browser: Browser, world: UiWorld, who: AccountKey): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
  await quiet(context);
  await context.addInitScript(logToasts);
  const page = await context.newPage();
  await openAs(page, world, who);
  return { context, page };
}

/** Back out of whatever screen is open until the tab bar shows. */
export async function toTabs(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const out = byId(page, 'header-back').or(byId(page, 'header-close')).first();
    await expect(tab(page, 'map').or(out).first()).toBeVisible();
    if (await tab(page, 'map').isVisible().catch(() => false)) return;
    await out.click();
  }
  await expect(tab(page, 'map')).toBeVisible();
}

/** Open a passage's record from the Map's search. */
export async function openRecord(page: Page, world: UiWorld, key: PassageKey): Promise<void> {
  await openLabel(page, world.passages[key].label);
}

/** Open a passage's record by its label on the map ("John 3:1–21"). */
export async function openLabel(page: Page, label: string): Promise<void> {
  await toTabs(page);
  await tab(page, 'map').click();
  const lang = text(page, 'Alpha');
  const search = visible(page.getByRole('searchbox')).or(visible(page.getByPlaceholder(/Search|Find/))).first();
  if (!(await search.isVisible().catch(() => false)) && await lang.isVisible().catch(() => false)) await lang.click();
  await search.fill(label);
  await visible(page.getByText(label, { exact: true })).first().click();
  await expect(visible(page.getByRole('button', { name: 'Versions and history' })).first()).toBeVisible();
  await languageArrived(page);
}

/** The record's main button for a check: "Do the peer check" (decision 91), or the older "Do the peer review". */
export const doCheck = (page: Page, check: string) => button(page, new RegExp(`^Do the ${check} (check|review|approval)$`, 'i'));

export { text, button };
