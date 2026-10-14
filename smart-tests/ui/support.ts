// Shared helpers for the UI test suite on the web (docs/ui-test-suite,
// decisions.md 93). Each spec file builds its own fixture world once
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
