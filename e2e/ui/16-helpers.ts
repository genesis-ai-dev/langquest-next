// Helpers for the role journeys (docs/ui-test-suite/16-role-journeys.md).
// A journey drives other areas' screens the way a person would; these are
// the few moves every journey repeats: recording and publishing, opening a
// passage, the bell, syncing, and a person's own device.
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import {
  button, byId, expect, expectNothingRefused, expectSent, leaveScreen, primary, openAs, screenChanged, screenText, syncNow, tab, test, text, type AccountKey, type PassageKey, type UiWorld
} from './support';

/**
 * The parts card's count ("Parts 1–3, 3 parts", or "Version 1, 5 parts"
 * while they are still the version's), or 0 before the first part. While
 * recording the card gives way to the recording view, whose title is the
 * part being said ("Part 4. Recording…"): three are kept.
 */
export async function partsCount(page: Page): Promise<number> {
  // Only what is on screen now: a lookup that waits for an absent card makes a recording overrun its stop.
  const card = page.getByRole('button', { name: /^(Parts? 1(–\d+)?|Version \d+), \d+ parts?/ }).locator('visible=true').first();
  if (await card.count()) {
    const m = (await card.getAttribute('aria-label').catch(() => null))?.match(/, (\d+) parts?/);
    return m ? Number(m[1]) : 0;
  }
  if (!(await page.getByRole('button', { name: 'Done', exact: true }).locator('visible=true').count())) return 0;
  const live = page.getByLabel(/^Part \d+\. /).locator('visible=true').first();
  if (!(await live.count())) return 0;
  const n = (await live.getAttribute('aria-label').catch(() => null))?.match(/^Part (\d+)\. /);
  return n ? Number(n[1]) - 1 : 0;
}

/**
 * In the recording workspace: tap the red button, let the microphone's voice
 * (e2e/fixtures/voice.ts: 1.5 s of voice, 2.5 s of quiet, looped)
 * make `parts` new parts, then tap stop.
 */
export async function recordParts(page: Page, parts: number): Promise<void> {
  const before = await partsCount(page);
  await byId(page, 'record-button').click();
  await expect(byId(page, 'record-button')).toHaveAccessibleName('Stop recording');
  // Each loop of the voice ends one part; a part shows once its pause is heard.
  await expect.poll(() => partsCount(page), { timeout: 15_000 + parts * 5_000, intervals: [500] }).toBeGreaterThanOrEqual(before + parts);
  await byId(page, 'record-button').click();
  await expect(byId(page, 'record-button')).toHaveAccessibleName('Record');
}

/**
 * Back translation: say each part in English, one at a time, as the step
 * says: "Record part N", about 4 seconds, stop. (The session also moves on by
 * itself at a pause; either way each part ends up said.)
 */
export async function sayEachPart(page: Page, parts: number): Promise<void> {
  const said = (n: number) => page.getByRole('button', { name: new RegExp(`^Part ${n}, \\d+:\\d\\d in English`) }).locator('visible=true');
  for (let n = 1; n <= parts; n++) {
    if (await said(n).count()) continue;
    await page.getByRole('button', { name: new RegExp(`^Record part ${n}`) }).locator('visible=true').first().click();
    await expect(page.getByRole('button', { name: 'Stop recording' }).locator('visible=true').first()).toBeVisible();
    // The voice file speaks 1.5 s in every 4 s: stop once a piece has been heard, as a person stops after
    // speaking (07-reviewing's sayPart). A fixed wait let a slow runner stop before anything was heard.
    await expect(page.getByLabel(/[1-9]\d* pieces? so far/).locator('visible=true').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Stop recording' }).locator('visible=true').first().click();
    await expect(said(n).first()).toBeVisible({ timeout: 20_000 });
  }
}

/** The workspace's Publish, then "Publish Version N" on the Publish screen. */
export async function publishVersion(page: Page, n: number): Promise<void> {
  await byId(page, 'publish-button').click();
  await expect(button(page, `Publish Version ${n}`)).toBeVisible();
  await button(page, `Publish Version ${n}`).click();
}

/** Open the bell on My Work. */
export async function openBell(page: Page): Promise<void> {
  await tab(page, 'work').click();
  await page.getByRole('button', { name: /^Updates/ }).locator('visible=true').first().click();
  await expect(text(page, 'Inbox')).toBeVisible();
}

/**
 * Open a passage from its language's map, as a person finds it: the Map tab,
 * the language if the tab opens on All languages, the book, the chapter,
 * then the passage.
 */
export async function openFromMap(page: Page, world: UiWorld, key: PassageKey, language = 'Alpha'): Promise<void> {
  await openByLabel(page, world.passages[key].label, language);
}

/** The Map down to a passage's row in its chapter's list ("Luke 12:1–12. Done. …"), which it returns. */
export async function passageRow(page: Page, label: string, language = 'Alpha'): Promise<Locator> {
  const [, chapter] = label.match(/^Luke (\d+):/)!;
  await backToTabs(page);
  await tab(page, 'map').click();
  const row = page.getByRole('button', { name: new RegExp(`^${label}\\.`) }).locator('visible=true').first();
  // The Map tab may come back where it was left: take the deepest of these that shows.
  const ways = [
    page.getByRole('button', { name: new RegExp(`^Chapter ${chapter}:`) }),
    page.getByRole('button', { name: /^Luke\./ }),
    page.getByRole('button', { name: new RegExp(`^${language}: .*Open its map`) })
  ].map((l) => l.locator('visible=true').first());
  for (let i = 0; i < 8 && !(await row.isVisible()); i++) {
    const [first, ...rest] = [row, ...ways];
    await first!.or(rest[0]!).or(rest[1]!).or(rest[2]!).first().waitFor({ timeout: 5_000 }).catch(() => {});
    if (await row.isVisible()) break;
    for (const way of ways) {
      if (await way.isVisible()) { await way.click(); break; }
    }
  }
  await expect(row).toBeVisible();
  return row;
}

/** The same, by the passage's label on the map ("Luke 12:1–12"). */
export async function openByLabel(page: Page, label: string, language = 'Alpha'): Promise<void> {
  await (await passageRow(page, label, language)).click();
  await expect(text(page, label)).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Something else\?|Versions and history)$/ }).locator('visible=true').first()).toBeVisible();
}

/**
 * Review it, from Listen to Decide: on to the questions, answer each one as a
 * person would (4 on a scale, Yes to yes/no, a few words to a text question),
 * until the verdict buttons show.
 */
export async function throughToDecide(page: Page): Promise<void> {
  const verdict = page.getByRole('button', { name: 'Looks good', exact: true }).locator('visible=true');
  for (let i = 0; i < 12; i++) {
    if (await verdict.count()) return;
    const four = page.getByRole('radio', { name: '4', exact: true }).locator('visible=true');
    const yes = page.getByRole('radio', { name: 'Yes', exact: true }).or(page.getByRole('button', { name: 'Yes', exact: true })).locator('visible=true');
    const typed = page.locator('textarea').locator('visible=true');
    if (await four.count()) await four.first().click();
    else if (await yes.count()) await yes.first().click();
    else if (await typed.count()) await typed.first().fill('It reads well');
    const before = await screenText(page);
    await byId(page, 'primary-action').click();
    await screenChanged(page, before);
  }
  await expect(verdict.first()).toBeVisible();
}

/** Back (or ✕) until the tab bar shows, as a person leaves a pushed screen. */
export async function backToTabs(page: Page): Promise<void> {
  const tabs = page.locator('[data-testid^="tab-"]').locator('visible=true');
  const leave = page.getByTestId('header-back').or(page.getByTestId('header-close')).locator('visible=true');
  await expect(tabs.first().or(leave.first())).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 6; i++) {
    if (await tabs.count()) return;
    await leaveScreen(page);
  }
  await expect(page.locator('[data-testid^="tab-"]').locator('visible=true').first()).toBeVisible();
}

/** Pull the latest from the server, as pulling down on My Work does, until `ready` holds. */
export async function syncUntil(page: Page, ready: () => Promise<boolean>, timeout = 60_000, what = 'the change'): Promise<void> {
  try {
    await expect.poll(async () => { await syncNow(page); return ready(); }, { timeout, intervals: [1_000, 2_000, 3_000] }).toBe(true);
  } catch (e) {
    const shown = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500);
    throw new Error(`${what} did not arrive after syncing for ${timeout / 1000} s. The screen showed: ${shown}\n${String(e)}`);
  }
}

/** A person's own device, signed in (deviceFor), closed when the journey ends. */
export class Devices {
  private contexts: BrowserContext[] = [];
  constructor(private browser: Browser, private world: () => UiWorld) {}
  async open(who: AccountKey, opts: { language?: 'A' | 'B' | 'C'; viewport?: { width: number; height: number } } = {}): Promise<Page> {
    const context = await this.browser.newContext({ viewport: opts.viewport ?? { width: 430, height: 932 }, permissions: ['microphone'] });
    this.contexts.push(context);
    const page = await context.newPage();
    await watch(page, who);
    await openAs(page, this.world(), who, opts.language ? { language: opts.language } : {});
    return page;
  }
  async close(): Promise<void> {
    await Promise.all(this.contexts.map((c) => c.close().catch(() => {})));
    this.contexts = [];
  }
}

/**
 * Keep a page's errors and reloads, and attach them to a failing test: a
 * crash screen's cause, or a reload by the dev server mid-journey (another
 * edit to the app's code), is then on the report instead of guessed at.
 * Call it before the page's first load.
 */
const watched: { who: string; lines: string[] }[] = [];
export async function watch(page: Page, who: string): Promise<void> {
  // The dev server pushes every code edit (other suites' work too) and remounts the app mid-journey: not here.
  await page.context().routeWebSocket(/\/hot(\?|$)/, () => { /* no updates */ });
  const lines: string[] = [];
  watched.push({ who, lines });
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/BackHandler is not supported|cannot be a descendant|cannot contain a nested/.test(m.text())) lines.push(`console.error: ${m.text().slice(0, 2000)}`); });
  page.on('load', () => lines.push(`load: ${new Date().toISOString()} ${page.url()}`));
}
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    for (const w of watched) await info.attach(`${w.who}-log`, { body: w.lines.join('\n') || '(nothing)', contentType: 'text/plain' });
    // eslint-disable-next-line no-console
    for (const w of watched) console.log(`---- ${w.who} ----\n${w.lines.join('\n').slice(0, 6000)}`);
  }
  watched.length = 0;
});

/** This device's log of Alpha, oldest first, as `type id` (every device should hold the same, in the same order). */
export async function deviceLog(page: Page, world: UiWorld, language: 'A' | 'B' | 'C' = 'A'): Promise<string[]> {
  const l = world.languages[language];
  return page.evaluate(async ([org, stream]) => {
    const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog!;
    const rows = await log.select("select json from events where org_id = ? and stream_id = ? and status = 'confirmed' order by hlc, id", [org, stream]) as { json: string }[];
    return rows.map((r) => { const e = JSON.parse(r.json) as { id: string; type: string }; return `${e.type} ${e.id}`; });
  }, [l.orgId, l.languageId] as const);
}

/**
 * The part of Alpha's log every device must hold the same: its confirmed events with their server
 * order, and the server snapshot it started from (`from`, 0 for none). A device opened while the
 * server had a snapshot starts from it (PLAN.md invariant 10) and never stores the events before it,
 * so whole logs differ by when each device first opened; what comes after the latest snapshot any of
 * them started from must not. CI's projection worker makes snapshots every minute, so a journey that
 * compared whole logs failed whenever one landed while its devices were opening (JRN-011).
 */
export async function deviceTail(page: Page, world: UiWorld, language: 'A' | 'B' | 'C' = 'A'): Promise<{ from: number; events: { seq: number; key: string }[] }> {
  const l = world.languages[language];
  return page.evaluate(async ([org, stream]) => {
    const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog!;
    const rows = await log.select("select server_seq, json from events where org_id = ? and stream_id = ? and status = 'confirmed' order by server_seq", [org, stream]) as { server_seq: number; json: string }[];
    const meta = await log.select('select value from meta where key = ?', [`snapshotSeq:${org}/${stream}`]) as { value: string }[];
    const from = Number(meta[0]?.value.split(':')[1] ?? 0) || 0;
    return { from, events: rows.map((r) => { const e = JSON.parse(r.json) as { id: string; type: string }; return { seq: r.server_seq, key: `${e.type} ${e.id}` }; }) };
  }, [l.orgId, l.languageId] as const);
}

/** G10.2 and G10.3 on one device: everything sent, nothing refused. */
export async function expectClean(page: Page, world: UiWorld, language: 'A' | 'B' | 'C' = 'A'): Promise<void> {
  await expectSent(page, world, language);
  await expectNothingRefused(page, world, language);
}

export { primary };
