// Helpers for the passage record tests (docs/ui-test-suite/05-passage-record.md).
// Pages per role are kept for a whole spec file (one browser context each), so
// a test that reads a passage as six roles does not sign six people in again.
import { commands, derivePassage, type Commands, type EventSpec, type LanguageState } from '@langquest-next/core';
import { blobKey, workerBlobs, type SyncClient } from '@langquest-next/sync';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { clientAs, localServer, send, signIn } from './fixture';
import { button, byId, enterPassage, expect, expectStill, expectSyncIdle, openAs, screenText, tab, text, waitForApp, type AccountKey, type PassageKey, type UiWorld } from './support';

const visible = (l: Locator) => l.locator('visible=true');

/** A passage: a fixture key, or a spare one this file set up ({ unitId, label }). */
export type Passage = PassageKey | { unitId: string; label: string };
const labelOf = (world: UiWorld, p: Passage): string => (typeof p === 'string' ? world.passages[p].label : p.label);
export const unitOf = (world: UiWorld, p: Passage): string => (typeof p === 'string' ? world.passages[p].unitId : p.unitId);

/** Keep Metro's reload sockets quiet: a source change elsewhere must not reload a page mid-test. */
export async function quietReloads(target: Page | BrowserContext): Promise<void> {
  await target.routeWebSocket(/\/(hot|message)(\?|$)/, () => { /* held open, never told anything */ });
}

/** Reload the app and wait for it; a reload that lands mid-navigation is tried again. */
export async function reloadApp(page: Page): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await page.reload();
      await waitForApp(page);
      return;
    } catch (e) {
      if (i >= 2) throw e;
      await page.waitForLoadState('domcontentloaded').catch(() => { /* the document is going away: try again */ });
    }
  }
}

/**
 * Load the app afresh at an address (`pathTo`), as typing it would. A new navigation, not a reload:
 * a reload keeps the old document's history depth, and the app then steps back out of a screen opened by the tests' entry.
 */
export async function gotoApp(page: Page, path = '/'): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await page.goto(path);
      await waitForApp(page);
      return;
    } catch (e) {
      if (i >= 2) throw e;
      await page.waitForLoadState('domcontentloaded').catch(() => { /* the document is going away: try again */ });
    }
  }
}

/** Back to a tab: reload when the tab bar is not showing (a pushed screen). */
export async function toTabs(page: Page): Promise<void> {
  if (await tab(page, 'map').isVisible().catch(() => false)) return;
  await reloadApp(page);
  await expect(tab(page, 'map')).toBeVisible({ timeout: 60_000 });
}

/**
 * Open a passage's record by the test build's entry (support.ts enterPassage), not the Map's search.
 * The navigation and search tests use `openRecordBySearch`.
 */
export async function openRecord(page: Page, world: UiWorld, p: Passage): Promise<void> {
  const label = labelOf(world, p);
  await toTabs(page);
  await expect(async () => {
    if ((await header(page).innerText({ timeout: 1_000 }).catch(() => '')).trim() === label) return;
    if (!(await enterPassage(page, world, unitOf(world, p)))) throw new Error('no test entry in this build');
    await expect(header(page)).toHaveText(label, { timeout: 4_000 });
  }).toPass({ timeout: 120_000 }).catch(async () => openRecordBySearch(page, world, p));
  await settleRecord(page, world);
}

async function settleRecord(page: Page, world: UiWorld): Promise<void> {
  await expect(visible(page.getByText('Then the team', { exact: true })).first()).toBeVisible({ timeout: 30_000 });
  // Names come with the organization: wait for the checks' people, by name.
  await expect(visible(page.getByText(new RegExp(`${world.accounts.TREV.name}|${world.accounts.REV.name}`))).first()).toBeVisible({ timeout: 30_000 });
  // The session's privileges come from the organization's fold: let the sync finish, then the footer holds still.
  await expectSyncIdle(page);
  await expectStill(byId(page, 'primary-action').or(header(page)).first());
}

/** Open a passage's record through the Map's search, from whichever Map the role lands on. */
export async function openRecordBySearch(page: Page, world: UiWorld, p: Passage): Promise<void> {
  const label = labelOf(world, p);
  await toTabs(page);
  // Admins land on All languages ("Progress"), with Alpha as a row; workers on Alpha's own map.
  const search = byId(page, 'map-search');
  const all = visible(page.getByRole('heading', { name: 'Progress', exact: true })).first();
  // A tap while the app is still starting can be lost, and the app may put its home back once the
  // language opens: keep going until the passage's record shows.
  await expect(async () => {
    // A tap that opened the record slower than the check below is not tapped again.
    if ((await header(page).innerText({ timeout: 1_000 }).catch(() => '')).trim() === label) return;
    if (await search.isVisible()) {
      await search.fill(label);
      await visible(page.getByText(label, { exact: true })).first().click({ timeout: 5_000 });
    } else if (await all.isVisible()) {
      // The overview redraws as its figures arrive: tap Alpha's row where it is.
      const box = await visible(page.locator('div:text-is("Alpha")')).first().boundingBox({ timeout: 5_000 });
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await tab(page, 'map').click({ timeout: 5_000 });
    }
    await expect(header(page)).toHaveText(label, { timeout: 4_000 });
  }).toPass({ timeout: 120_000 });
  await settleRecord(page, world);
}

/** One page per role for the whole file, signed in once. */
const pages = new Map<string, Page>();
export async function pageFor(browser: Browser, world: UiWorld, who: AccountKey): Promise<Page> {
  const key = `${world.run}:${who}`;
  const have = pages.get(key);
  if (have && !have.isClosed()) return have;
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
  const page = await context.newPage();
  await openAs(page, world, who);
  await expect(tab(page, 'map')).toBeVisible({ timeout: 60_000 });
  pages.set(key, page);
  return page;
}

/** `who`'s page, on a passage's record. */
export async function recordAs(browser: Browser, world: UiWorld, who: AccountKey, p: Passage): Promise<Page> {
  const page = await pageFor(browser, world, who);
  await gotoApp(page);
  await expect(tab(page, 'map')).toBeVisible({ timeout: 60_000 });
  await openRecord(page, world, p);
  return page;
}

/** Pull from the server now and reopen the record (another account changed it). */
export async function refreshRecord(page: Page, world: UiWorld, p: Passage): Promise<void> {
  await gotoApp(page);
  await expect(tab(page, 'map')).toBeVisible({ timeout: 60_000 });
  await openRecord(page, world, p);
}

/** The screen's title. */
export function header(page: Page): Locator {
  return visible(page.getByRole('heading')).first();
}

/** The main button's words, or null when the footer has none. */
export async function mainButton(page: Page): Promise<string | null> {
  const p = byId(page, 'primary-action');
  if (!(await p.isVisible().catch(() => false))) return null;
  return (await p.innerText()).trim();
}

export function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The check kind each "Then the team" row carries in its testID (`team-row-<kindId>`). */
const TEAM_KIND: Record<string, string> = { 'Peer check': 'peer', 'Back translation': 'bt', 'Community check': 'community', 'Consultant check': 'consultant', 'Final approval': 'final' };

/** The path step each title stands for (`path-step-<kind>`). */
const STEP_KIND: Record<string, string> = { Study: 'study', Record: 'record', Publish: 'publish', 'Hear the feedback': 'feedback', 'Fix it, or keep it and say why': 'fix' };

/** A "Then the team" row, by its check's name (spoken "{name}, {status}"). */
export function teamRow(page: Page, name: string): Locator {
  const kindId = TEAM_KIND[name];
  return kindId ? visible(page.getByTestId(`team-row-${kindId}`)).first() : visible(page.getByRole('button', { name: new RegExp(`^${escape(name)}, `) })).first();
}

/** Every "Then the team" row, as "{name}, {status}". */
export async function teamRows(page: Page): Promise<string[]> {
  const names = ['Peer check', 'Back translation', 'Community check', 'Consultant check', 'Final approval'];
  const out: string[] = [];
  for (const n of names) out.push((await teamRow(page, n).getAttribute('aria-label')) ?? `${n}: missing`);
  return out;
}

/** A path step ("2. Publish. …"), by its title; its spoken name holds its sub. */
export function pathStep(page: Page, title: string): Locator {
  const kind = STEP_KIND[title];
  if (kind) return visible(page.getByTestId(`path-step-${kind}`)).first();
  return visible(page.getByRole('button', { name: new RegExp(`^\\d+\\. ${escape(title)}\\. `) })).first();
}

/** The open sheet (a modal dialog). */
export function sheet(page: Page): Locator {
  return visible(page.getByTestId('sheet')).last();
}

export async function sheetText(page: Page): Promise<string> {
  return (await sheet(page).innerText()).replace(/\s+/g, ' ').trim();
}

/** The buttons in the open sheet, by their spoken names, without Close. */
export async function sheetButtons(page: Page): Promise<string[]> {
  const names = await sheet(page).getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? (e as HTMLElement).innerText.trim()));
  return names.filter((n) => n && n !== 'Close');
}

export async function closeSheet(page: Page): Promise<void> {
  await sheet(page).getByTestId('sheet-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Open a "Then the team" row's sheet. */
export async function openTeamRow(page: Page, name: string): Promise<void> {
  await teamRow(page, name).click();
  await expect(sheet(page)).toBeVisible();
}

/** "Something else?" from the record's footer. */
export async function somethingElse(page: Page): Promise<void> {
  await button(page, 'Something else?').click();
  await expect(header(page)).toHaveText('Something else?');
}

/** "Versions and history" from the record's footer. */
export async function versionsPage(page: Page): Promise<void> {
  await button(page, 'Versions and history').click();
  await expect(header(page)).toHaveText('Versions');
}

/** Is this exact text on screen? */
export async function shows(page: Page, value: string | RegExp): Promise<boolean> {
  return visible(page.getByText(value, { exact: typeof value === 'string' })).first().isVisible().catch(() => false);
}

export { screenText };

// ---- the server ----------------------------------------------------------------------

export const id = (): string => randomUUID();

/** Write as an account through the real server: `make` builds a core command against the language's fold. */
export async function actAs(world: UiWorld, who: AccountKey, make: (c: Commands, s: LanguageState) => EventSpec[], what = 'test write'): Promise<EventSpec[]> {
  const client = await clientAs(world, who, 'A') as SyncClient<LanguageState>;
  const state = client.getState();
  const specs = make(commands(state), state);
  if (specs.length) await client.appendMany(specs as never);
  await send(client as SyncClient<unknown>, what);
  return specs;
}

/** The language's fold as an account sees it, freshly pulled. */
export async function stateAs(world: UiWorld, who: AccountKey): Promise<LanguageState> {
  const client = await clientAs(world, who, 'A') as SyncClient<LanguageState>;
  return client.getState();
}

/** A passage's derived state, freshly pulled. */
export async function passageAs(world: UiWorld, who: AccountKey, p: Passage) {
  return derivePassage(await stateAs(world, who), unitOf(world, p));
}

/**
 * Passages in Luke nobody has started and the fixture does not use, in
 * order, so a test that changes a passage gets one of its own.
 */
export async function sparePassages(world: UiWorld, count: number, from = 0): Promise<{ unitId: string; label: string }[]> {
  const state = await stateAs(world, 'ADMIN');
  const used = new Set(Object.values(world.passages).map((p) => p.unitId));
  const units = Object.entries(state.units).map(([unitId, u]) => ({ unitId, kind: u.kind, label: u.label }))
    .filter((u) => u.kind === 'passage' && /\/LUK\.(\d+)\./.test(u.unitId) && !used.has(u.unitId) && !derivePassage(state, u.unitId).recorded && !derivePassage(state, u.unitId).drafting)
    .map((u) => {
      const m = /\/LUK\.(\d+)\.(\d+)/.exec(u.unitId)!;
      return { unitId: u.unitId, label: u.label, order: Number(m[1]) * 1000 + Number(m[2]) };
    })
    .sort((a, b) => a.order - b.order);
  // Luke 1 and 2 first: far from the chapters the fixture and other areas use.
  return units.slice(from, from + count).map(({ unitId, label }) => ({ unitId, label }));
}

const RATE = 16000;
let wav = 0;
/** A short distinct WAV, the way the fixture makes its recordings. */
function tone(seconds = 3): { bytes: Uint8Array; hash: string; durationMs: number } {
  const n = wav++;
  const total = Math.round(seconds * RATE);
  const bytes = new Uint8Array(44 + total * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => { for (let k = 0; k < s.length; k++) view.setUint8(at + k, s.charCodeAt(k)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, total * 2, true);
  const carrier = 210 + (n % 50) * 3 + Math.random();
  for (let k = 0; k < total / 2; k++) view.setInt16(44 + k * 2, Math.round(0.4 * Math.sin(2 * Math.PI * carrier * (k / RATE)) * 32767), true);
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex'), durationMs: Math.round(seconds * 1000) };
}

/** Upload `count` recordings as `who`, where the app keeps the language's files. */
export async function recordings(world: UiWorld, who: AccountKey, count: number): Promise<{ hash: string; durationMs: number; format: 'wav' }[]> {
  const { session } = await signIn(world, who);
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = tone();
    await workerBlobs(localServer().api, session.access_token).put(blobKey(world.orgId, world.languages.A.languageId, v.hash, 'wav'), v.bytes);
    out.push({ hash: v.hash, durationMs: v.durationMs, format: 'wav' as const });
  }
  return out;
}

/** `who` records `parts` parts on a passage and keeps them as a draft; with `publish`, publishes them as the next version. */
export async function recordOn(world: UiWorld, who: AccountKey, p: Passage, o: { parts?: number; publish?: boolean; note?: string; fresh?: boolean } = {}): Promise<void> {
  const cards = await recordings(world, who, o.parts ?? 2);
  const unitId = unitOf(world, p);
  const actorId = world.accounts[who].id;
  await actAs(world, who, (c) => cards.flatMap((card) => {
    const recordingId = id();
    return c.addRecording({ commandId: recordingId, recordingId, unitId, kind: 'target', card });
  }), `${who} records on ${unitId}`);
  await actAs(world, who, (c) => (o.publish
    ? c.publishVersion({ commandId: id(), unitId, cardHashes: cards.map((x) => x.hash), actorId, ...(o.note ? { note: o.note } : {}) })
    : c.keepTake({ commandId: id(), unitId, cardHashes: cards.map((x) => x.hash), actorId, ...(o.fresh ? { parentTakeId: null } : {}) })), `${who} keeps or publishes on ${unitId}`);
}

/** A disclosure ("History", "Reviews by version"), spoken "{title}. {summary}". */
export function disclosure(page: Page, title: string): Locator {
  return visible(page.getByRole('button', { name: new RegExp(`^${escape(title)}\\. `) })).first();
}

/**
 * Open a disclosure. Its open state is remembered per passage and is not
 * exposed to the web's accessibility tree, so `shown` (text inside it) says
 * whether a tap opened or closed it.
 */
export async function expand(page: Page, title: string, shown?: string | RegExp): Promise<void> {
  const d = disclosure(page, title);
  await expect(d).toBeVisible();
  const inside = shown ? visible(page.getByText(shown)).first() : null;
  if (inside && await inside.isVisible().catch(() => false)) return;
  await d.click();
  if (inside && !(await inside.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await inside.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => { /* still closed: tap again */ });
    if (!(await inside.isVisible().catch(() => false))) await d.click();
  }
  if (inside) await inside.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => { /* the caller's expectation says what is missing */ });
  else await expectStill(d);
}

/**
 * My Work's whole text, after pulling from the server. Names come with the
 * organization a moment after the list, so it waits for the text to settle
 * (and, with `until`, for that text to show).
 */
export async function myWork(page: Page, until?: string | RegExp): Promise<string> {
  await reloadApp(page);
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  // The app reopens on the section it was on, and may put it back as it loads: tap Work until My Work stays.
  let last = '';
  await expect.poll(async () => {
    let now = await screenText(page);
    if (!now.startsWith('My Work')) {
      await tab(page, 'work').click({ timeout: 5_000 }).catch(() => {});
      now = '';
    }
    const settled = now !== '' && now === last && (!until || (typeof until === 'string' ? now.includes(until) : until.test(now)));
    last = now;
    return settled;
  }, { timeout: 60_000, intervals: [1_500] }).toBe(true);
  return last;
}

/**
 * In the workspace: record exactly one more part, then stop (06-recording-helpers
 * recordSaid). The tone microphone speaks once and falls quiet, so the part count
 * goes up by one and stays there. The looping voice file kept talking while the test
 * waited to see exactly one part, and on a busy machine (a parallel run) the first read
 * that found the card already counted 14: PASS-031, 2026-10-14.
 */
export async function recordOnePart(page: Page): Promise<void> {
  const { recordSaid } = await import('./06-recording-helpers');
  await recordSaid(page, [2000]);
}
