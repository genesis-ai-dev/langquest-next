// Shared helpers for the UI test suite on the web (docs/ui-test-suite,
// decisions.md 95). Each spec file builds its own fixture world once
// (`useWorld`), opens the app signed in as a fixture account (`openAs`), and
// reads the screen through the same words a person sees, plus the few
// testIDs the kit carries (header-back, header-close, header-help,
// primary-action, record-button, publish-button, toast, toast-undo, tab-*).
import { expect, test as base, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld, browserStateFor, type UiWorld } from './fixture';
import { installMic } from './mic';

export { expect };
export type { UiWorld };
export type AccountKey = keyof UiWorld['accounts'];
export type PassageKey = keyof UiWorld['passages'];

/**
 * Spec files call `const w = useWorld()` at the top; `w()` is the world inside tests.
 * One world per spec file per run: when a test fails Playwright starts a new
 * worker, and a fresh world there would strand the file's later tests (they
 * build on what earlier ones did). The world is kept beside the results under
 * the run's id (ui.config.ts sets UI_RUN_ID once, in the runner process).
 */
export function useWorld(opts: Parameters<typeof buildWorld>[0] = {}): () => UiWorld {
  let world: UiWorld | null = null;
  base.beforeAll(async ({}, testInfo) => {
    base.setTimeout(300_000);
    const run = process.env['UI_RUN_ID'];
    const key = createHash('sha1').update(`${testInfo.file}:${JSON.stringify(opts)}`).digest('hex').slice(0, 12);
    const file = run ? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results', 'worlds', `${run}-${key}.json`) : null;
    if (file && existsSync(file)) {
      world = JSON.parse(readFileSync(file, 'utf8')) as UiWorld;
      return;
    }
    world = await buildWorld(opts);
    if (file) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(world));
    }
  });
  return () => {
    if (!world) throw new Error('The fixture world is not built yet (useWorld must be called at the top of the file).');
    return world;
  };
}

/**
 * The shared dev server hot-reloads every open page when anyone edits the app,
 * which would reload a test mid-step (and trip the one-tab rule). Metro's
 * hot-reload socket is refused for every context the suite opens.
 */
export async function noHotReload(context: BrowserContext): Promise<void> {
  await context.routeWebSocket(/\/hot|\/message\?/, () => { /* no hot reloads from others' edits */ });
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await noHotReload(context);
    await use(context);
  }
});

/** The app's read-only device log probe, present once the store is open (dev web builds). */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(globalThis as { __langquestLog?: unknown }).__langquestLog, undefined, { timeout: 120_000 });
}

/**
 * Open the app signed in as `who`, in a language (default Alpha), at `path`.
 * The session goes in before the first load, the way the app keeps it.
 */
export async function openAs(page: Page, world: UiWorld, who: AccountKey, opts: { language?: 'A' | 'B' | 'C'; path?: string } = {}): Promise<void> {
  await noHotReload(page.context());
  // Every capture its own bytes: Chrome replays the voice file from the start for each microphone (mic.ts).
  await page.addInitScript(installMic);
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, browserStateFor(world, who, opts.language ?? 'A'));
  await page.goto(opts.path ?? '/');
  await waitForApp(page);
}

/** A second person on their own device: a fresh browser context signed in as `who`. */
export async function deviceFor(browser: Browser, world: UiWorld, who: AccountKey, opts: { language?: 'A' | 'B' | 'C'; path?: string } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
  const page = await context.newPage();
  await openAs(page, world, who, opts);
  return { context, page };
}

/** Open the app signed out, on Sign In. */
export async function openSignedOut(page: Page): Promise<void> {
  await noHotReload(page.context());
  await page.goto('/');
  await expect(page.getByText('Create Account', { exact: true }).first()).toBeVisible({ timeout: 120_000 });
}

const visible = (l: Locator) => l.locator('visible=true');

/** A button by its spoken name (exact string, or a pattern). */
export function button(page: Page, name: string | RegExp): Locator {
  return visible(page.getByRole('button', { name, exact: typeof name === 'string' })).last();
}

/** Text on screen, exact by default. */
export function text(page: Page, value: string | RegExp, exact = true): Locator {
  return visible(page.getByText(value, { exact: typeof value === 'string' ? exact : undefined })).first();
}

/** A field by its label or placeholder. */
export function field(page: Page, label: string | RegExp): Locator {
  return visible(page.getByLabel(label, { exact: typeof label === 'string' })).first()
    .or(visible(page.getByPlaceholder(label, { exact: typeof label === 'string' })).first()).first();
}

export const byId = (page: Page, id: string): Locator => visible(page.getByTestId(id)).last();
export const tab = (page: Page, id: 'work' | 'map' | 'reports' | 'manage' | 'inbox' | 'me'): Locator => byId(page, `tab-${id}`);
export const primary = (page: Page): Locator => byId(page, 'primary-action');
export const back = (page: Page): Locator => byId(page, 'header-back').or(byId(page, 'header-close')).first();

/** The tabs showing, by id, in order. */
export async function tabsShown(page: Page): Promise<string[]> {
  const ids = await page.locator('[data-testid^="tab-"]').evaluateAll((els) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .map((e) => e.getAttribute('data-testid')!.slice(4)));
  return [...new Set(ids)];
}

/** Expect a toast with this message; returns its locator. */
export async function expectToast(page: Page, message: string | RegExp): Promise<Locator> {
  const t = byId(page, 'toast');
  await expect(t).toBeVisible();
  await expect(t).toContainText(message);
  return t;
}

export async function undoToast(page: Page): Promise<void> {
  await byId(page, 'toast-undo').click();
}

/** Whole visible text of the page, whitespace collapsed. */
export async function screenText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

/** Ask the app to sync now, as pulling down or Sync now does, through the same screen a person uses. */
export async function syncNow(page: Page): Promise<void> {
  await page.evaluate(() => (globalThis as { __langquestSyncNow?: () => Promise<void> }).__langquestSyncNow?.());
}

/** What the app says it is doing: the test probe in App.tsx (test builds only). */
export interface TestState { syncing: boolean; pending: number; rejected: number; lastSyncAt: number | null; lastPullMore: boolean; orgId: string | null; languageId: string | null }

export async function testState(page: Page): Promise<TestState> {
  return page.evaluate(async () => {
    const probe = (globalThis as { __langquestTestState?: () => Promise<unknown> }).__langquestTestState;
    if (!probe) throw new Error('__langquestTestState is not installed: not signed in yet, or not a test build.');
    return await probe();
  }) as Promise<TestState>;
}

/** Wait until no sync is running and nothing is waiting to upload (organization and open language). */
export async function expectSyncIdle(page: Page, timeoutMs = 30_000): Promise<void> {
  await expect.poll(async () => {
    const t = await testState(page).catch(() => null);
    return t !== null && !t.syncing && t.pending === 0;
  }, { timeout: timeoutMs, message: 'waiting for sync to go idle' }).toBe(true);
}

/** Device log rows for a stream: status and type, oldest first. */
export async function deviceEvents(page: Page, orgId: string, streamId: string): Promise<{ status: string; type: string; rejectReason: string | null }[]> {
  return page.evaluate(async ([org, stream]) => {
    const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog!;
    const rows = await log.select('select status, reject_reason, json from events where org_id = ? and stream_id = ? order by hlc', [org, stream]) as
      { status: string; reject_reason: string | null; json: string }[];
    return rows.map((r) => ({ status: r.status, type: (JSON.parse(r.json) as { type: string }).type, rejectReason: r.reject_reason }));
  }, [orgId, streamId] as const);
}

/** G10.2: nothing refused on this device, unless the test expects it. */
export async function expectNothingRefused(page: Page, world: UiWorld, language: 'A' | 'B' | 'C' = 'A'): Promise<void> {
  const rows = await deviceEvents(page, world.languages[language].orgId, world.languages[language].languageId);
  expect(rows.filter((r) => r.status === 'rejected'), 'refused by the server').toEqual([]);
}

/** Wait until this device has nothing waiting to send (G10.3). */
export async function expectSent(page: Page, world: UiWorld, language: 'A' | 'B' | 'C' = 'A', timeoutMs = 30_000): Promise<void> {
  await expect.poll(async () => (await deviceEvents(page, world.languages[language].orgId, world.languages[language].languageId)).filter((r) => r.status === 'pending').length,
    { timeout: timeoutMs, message: 'waiting to upload' }).toBe(0);
}

/** Open a passage by its fixture key through the Map's search, as a person would. */
export async function openPassage(page: Page, world: UiWorld, key: keyof UiWorld['passages']): Promise<void> {
  const label = world.passages[key].label;
  await tab(page, 'map').click();
  // Admins land on All languages; workers on their language's map.
  const lang = text(page, 'Alpha');
  if (await page.getByRole('searchbox').or(page.getByPlaceholder(/Search|Find/)).count() === 0 && await lang.isVisible().catch(() => false)) await lang.click();
  const search = visible(page.getByRole('searchbox')).or(visible(page.getByPlaceholder(/Search|Find/))).first();
  await search.fill(label.replace(/^Luke /, 'Luke '));
  await visible(page.getByText(label, { exact: false })).first().click();
  await expect(text(page, label, false)).toBeVisible();
}

/**
 * Press the visible Back (or ✕) and wait until that very button is gone, so the
 * next look sees the screen behind it. Returns false when there was none.
 */
export async function leaveScreen(page: Page): Promise<boolean> {
  const b = back(page);
  const handle = await b.elementHandle({ timeout: 2_000 }).catch(() => null);
  if (!handle) return false;
  await b.click();
  await handle.waitForElementState('hidden', { timeout: 5_000 }).catch(() => { /* the screen may reuse the button */ });
  return true;
}

/** Wait until the page's words differ from `before` (a screen moved on); false when they never did. */
export async function screenChanged(page: Page, before: string, timeoutMs = 5_000): Promise<boolean> {
  return expect.poll(async () => (await screenText(page)) !== before, { timeout: timeoutMs }).toBe(true).then(() => true, () => false);
}

/** Wait until the element has stopped moving (same box on two looks in a row), e.g. a list settling after a row arrives. */
export async function expectStill(target: Locator): Promise<void> {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await target.boundingBox());
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [100, 100, 200], timeout: 10_000, message: 'waiting for the element to settle' }).toBe(true);
}

// ---- entering by address -------------------------------------------------------------------

/**
 * The web app's addresses name sections only (apps/mobile/src/webPaths.ts, decision 58): a deeper
 * screen has no address, because its place depends on what was opened before it. `pathTo` is the
 * address of a section; `openAs(page, world, who, { path: pathTo('map') })` lands there.
 * A role that may not open a section lands on its own home, as a person typing the address would.
 */
const SECTION_PATH = {
  work: '/work', map: '/map', language: '/map/language', reports: '/reports',
  org: '/manage', 'org-language': '/manage/language', inbox: '/inbox', me: '/settings'
} as const;
export type Section = keyof typeof SECTION_PATH;
export const pathTo = (section: Section): string => SECTION_PATH[section];

/**
 * Open a passage's record without walking through the Map's search: the test build's
 * `__langquestOpenPassage` opens it the way a pushed notification does (the role's home under it).
 * Needs the app signed in and on a tab (the hook is installed once the workspace is up).
 * Returns false when this build has no hook (the caller falls back to the search).
 */
export async function enterPassage(page: Page, world: UiWorld, unitId: string, language: 'A' | 'B' | 'C' = 'A'): Promise<boolean> {
  const languageId = world.languages[language].languageId;
  const has = await page.waitForFunction(() => typeof (globalThis as { __langquestOpenPassage?: unknown }).__langquestOpenPassage === 'function', undefined, { timeout: 10_000 }).then(() => true, () => false);
  if (!has) return false;
  // The workspace is up and has pulled once (so its folds are in): before that the app is still choosing its home, and would put it back.
  await expect.poll(async () => { const t = await testState(page).catch(() => null); return !!t?.orgId && !!t.languageId && t.lastSyncAt !== null && !t.syncing; }, { timeout: 30_000, message: 'waiting for the workspace' }).toBe(true);
  await page.evaluate(([lang, unit]) => (globalThis as unknown as { __langquestOpenPassage: (l: string, u: string) => void }).__langquestOpenPassage(lang!, unit!), [languageId, unitId] as const);
  return true;
}
