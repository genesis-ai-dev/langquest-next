// Helpers for the recording tests (docs/ui-test-suite/06-recording.md).
//
// The microphone. Chrome plays e2e/fixtures/voice-mic.wav as the
// microphone (ui.config.ts, fixtures/voice.ts): 1.5 s of voice, then 2.5 s
// of quiet, on its own clock (not restarted when the app opens the
// microphone), so voice detection ends one part about every four seconds. A test that needs the room quiet,
// or speech of its own length ("speak for 4 seconds"), switches the page's
// microphone to a tone it turns on and off (`mic(page).speak(true)`): the
// app's getUserMedia then gets a 180 Hz tone at the same level as the file's
// voice, or silence. Nothing in the app is changed; only what the
// microphone hears.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { buildWorld } from './fixture';
import { installMic } from './mic';
import { button, byId, expect, expectStill, expectSyncIdle, openAs, openPassage, primary, syncNow, test, text, type UiWorld } from './support';

type PassageKey = keyof UiWorld['passages'];

/**
 * One fixture world for a whole spec file, kept across Playwright's worker
 * restarts. Playwright starts a new worker after any failed test, and
 * support.ts `useWorld` would then build a new world, so every later test in
 * the file would fail for a reason that is not its own (REC-016 needs the
 * Version 1 that REC-011 published). The world is written to a file named
 * for the test runner's process and the spec, and read back by the next
 * worker; the next run of the suite has another runner, so another world.
 */
export function useFileWorld(name: string): () => UiWorld {
  let world: UiWorld | null = null;
  const file = path.join(tmpdir(), `langquest-ui-${name}-${process.ppid}.json`);
  test.beforeAll(async () => {
    test.setTimeout(300_000); // ceiling: builds the whole fixture world on the shared local server, up to three tries
    if (existsSync(file)) { world = JSON.parse(readFileSync(file, 'utf8')) as UiWorld; return; }
    // The shared local server sometimes refuses a step under load ("Unable to join right now. Please retry."): build again.
    for (let attempt = 1; !world; attempt++) {
      try { world = await buildWorld(); } catch (e) { if (attempt >= 3) throw e; }
    }
    writeFileSync(file, JSON.stringify(world));
  });
  return () => {
    if (!world) throw new Error('The fixture world is not built yet.');
    return world;
  };
}

/**
 * Every recording test's page: the controllable microphone, and no reloads
 * from the shared dev server. Metro tells every open page to reload when a
 * source file changes (its /hot and /message sockets); a reload in the middle
 * of a recording test is not something the test did, and the page that
 * comes back finds the old one's tab lock ("LangQuest is open in another tab").
 */
export async function installMicControl(page: Page | BrowserContext): Promise<void> {
  await page.addInitScript(installMic);
  await page.routeWebSocket(/\/(hot|message)(\?|$)/, () => { /* held open, never told anything */ });
}

/** A second device for a recording test (support.ts deviceFor, with the same page set-up). */
export async function secondDevice(browser: Browser, world: UiWorld, who: keyof UiWorld['accounts']): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['microphone'] });
  await installMicControl(context);
  const page = await context.newPage();
  await openAs(page, world, who);
  return { context, page };
}

/** The page's microphone: the voice file (default), a tone switched on and off, or refused. */
export function mic(page: Page) {
  return {
    mode: (mode: 'file' | 'tone' | 'refuse') => page.evaluate((m) => { (window as unknown as { __lqMic: { mode: string } }).__lqMic.mode = m; }, mode),
    speak: (on: boolean) => page.evaluate((o) => { (window as unknown as { __lqMic: { speak(on: boolean): void } }).__lqMic.speak(o); }, on),
    /** How many times the app opened the microphone, and how many are open now. */
    counts: () => page.evaluate(() => { const c = (window as unknown as { __lqMic: { opened: number; open: number } }).__lqMic; return { opened: c.opened, open: c.open }; })
  };
}

/** Speak for `ms`, then stay quiet for `quietMs` (the tone microphone). */
export async function say(page: Page, ms: number, quietMs = 2000): Promise<void> {
  const m = mic(page);
  await m.speak(true);
  await page.waitForTimeout(ms); // sleep: N s of speech, the product's own threshold
  await m.speak(false);
  if (quietMs) await page.waitForTimeout(quietMs); // sleep: the quiet that ends a part, the product's own silence threshold
}

// ---- the workspace -----------------------------------------------------------------------

export const recordButton = (page: Page): Locator => byId(page, 'record-button');
export const publishButton = (page: Page): Locator => byId(page, 'publish-button');
/** The saved mark in the header (decision 127): a spinner while a part is kept, then a check ("Saved"). */
export const savedMark = (page: Page): Locator => byId(page, 'saved-mark');

/** The passage record's Record step row ("1. Record. …"). */
export const recordStep = (page: Page): Locator => button(page, /^\d+\. Record\./);

/**
 * From the passage record, open the workspace: the main button when it
 * records, else the Record step row. `main` is what the main button should
 * read first (the record has caught up with the server by then); a passage
 * with a study guide leads with "Study", and then the step row is tapped.
 */
export async function startFromRecord(page: Page, main?: 'Record' | 'Continue recording'): Promise<void> {
  const button = primary(page);
  await expect(button).toBeVisible();
  if (main) await expect(button).toHaveText(main, { timeout: 30_000 });
  const label = (await button.innerText()).trim();
  if (/^(Record|Continue recording)$/.test(label)) await button.click();
  else await recordStep(page).click();
  await expect(workspaceSub(page)).toBeVisible();
}

/** The workspace header's sub line: "Recording Version 2", "Draft 2", "New draft", "Draft · from Version 1". */
export const workspaceSub = (page: Page): Locator => text(page, /^(Recording Version \d+|Draft( \d+)?|New draft)( · from Version \d+)?$/);

/** Open a passage's record, then its workspace (startFromRecord). */
export async function openWorkspace(page: Page, world: UiWorld, key: PassageKey, main?: 'Record' | 'Continue recording'): Promise<void> {
  await openPassage(page, world, key);
  await startFromRecord(page, main);
}

/** A reference chip ("Bible", "Notes · 2"). */
export const chip = (page: Page, name: string | RegExp): Locator => page.getByRole('tab', { name }).locator('visible=true').first();

/** The parts card's title: "Part 1", "Parts 1–3". */
export const partsTitle = (count: number): string => (count <= 1 ? 'Part 1' : `Parts 1–${count}`);
/** The parts card's sub line: "3 parts · 0:06". */
export const partsSub = (count: number): RegExp => new RegExp(`^${count} parts? · \\d+:\\d\\d$`);

/**
 * How many parts the card counts now (0 when there is no card). While
 * recording, the card gives way to the recording view, whose title is the
 * part being said at the end ("Part 4. Recording…": three are kept).
 */
export async function partCount(page: Page): Promise<number> {
  const group = page.getByRole('button', { name: /^(Parts? 1(–\d+)?|Version \d+), \d+ parts? · / }).locator('visible=true').first();
  if (await group.count()) {
    const m = /, (\d+) parts? · /.exec((await group.getAttribute('aria-label')) ?? '');
    return m ? Number(m[1]) : 0;
  }
  if (!(await page.getByRole('button', { name: 'Done', exact: true }).locator('visible=true').count())) return 0;
  const live = page.getByLabel(/^Part \d+\. /).locator('visible=true').first();
  if (!(await live.count())) return 0;
  const n = /^Part (\d+)\. /.exec((await live.getAttribute('aria-label').catch(() => null)) ?? '');
  return n ? Number(n[1]) - 1 : 0;
}

/** The parts a draft already has, once its card has drawn (the workspace opens before the card shows; 0 read too soon is not the count). */
export async function draftParts(page: Page): Promise<number> {
  await expect.poll(() => partCount(page), { message: 'the draft\'s parts card shows' }).toBeGreaterThan(0);
  return partCount(page);
}

export async function expectParts(page: Page, count: number, timeout = 20_000): Promise<void> {
  await expect.poll(() => partCount(page), { timeout, message: `the parts card counts ${count}` }).toBe(count);
}

/** The recorder idle: the button says Record, nothing is saving. */
export async function expectIdle(page: Page): Promise<void> {
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Record');
  await expect(recordButton(page)).not.toHaveAttribute('aria-disabled', 'true');
}

/** Stop recording (LAN-82): the session stays open, its parts boxes to hear, move or drop until Done. */
export async function stopRecording(page: Page): Promise<void> {
  await recordButton(page).click();
  await expect(text(page, 'Stopped')).toBeVisible();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Record');
}

/** Leave the recording session: Done stops recording if it still is, and keeps every part as its box stands; only then are they saved. */
export async function leaveSession(page: Page): Promise<void> {
  await button(page, 'Done').click();
  await expect(text(page, 'Stopped')).toHaveCount(0);
  await expectIdle(page);
}

/**
 * Record with the voice file until the card counts `more` new parts, then
 * stop in the quiet after the last one (the file speaks again 1.5 s later).
 */
export async function recordParts(page: Page, more: number): Promise<void> {
  const before = await partCount(page);
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  await expectParts(page, before + more, 8_000 + more * 6_000);
  await stopRecording(page);
  await leaveSession(page);
  await expectParts(page, before + more);
}

/** Record parts with the tone microphone: each `ms` of speech then 2 s of quiet ends one part. */
export async function recordSaid(page: Page, lengths: number[]): Promise<void> {
  const m = mic(page);
  await m.mode('tone');
  await m.speak(false);
  const before = await partCount(page);
  await recordButton(page).click();
  await expect(recordButton(page)).toHaveAttribute('aria-label', 'Stop recording');
  for (const [i, ms] of lengths.entries()) {
    await say(page, ms, 0);
    await expectParts(page, before + i + 1, 10_000);
  }
  await stopRecording(page);
  await leaveSession(page);
  await expectParts(page, before + lengths.length);
  await m.mode('file');
}

/** A part's verse space ("Part 2, no verse yet", "Part 2, Verse 23"). */
export const verseSpace = (page: Page, n: number): Locator =>
  page.getByRole('button', { name: new RegExp(`^Part ${n}, (no verse yet|Verses? )`) }).locator('visible=true').first();

/**
 * Hold a part's verse space (the sheet with its verses, Auto, None and Delete). The press is held
 * until the sheet opens, not for a fixed time: on a busy page (a part just recorded, the list
 * settling) the timer that turns a press into a hold runs late, so a press let go at the threshold
 * lands as a tap and gives the part a verse instead (JRN-002 failed so in CI). A press that lands
 * as a tap anyway is undone with the footer's Undo, and held again.
 */
export async function holdPart(page: Page, n: number): Promise<void> {
  // The hold sheet's own tool ("None"): every part row has its own "Delete Part n" too.
  const sheet = page.getByRole('button', { name: 'None', exact: true }).locator('visible=true').first();
  for (let attempt = 0; attempt < 3; attempt++) {
    const space = verseSpace(page, n);
    await space.scrollIntoViewIfNeeded();
    await expectStill(space);
    const box = (await space.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sheet.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    await page.mouse.up();
    if (await sheet.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) return;
    const undo = undoButton(page);
    if (await undo.isEnabled().catch(() => false)) await undo.click();
  }
  await expect(sheet, 'holding the part opens its sheet').toBeVisible();
}

/** Undo and Redo by the red button (Caleb, 2026-10-16). */
export const undoButton = (page: Page): Locator => byId(page, 'undo');
export const redoButton = (page: Page): Locator => byId(page, 'redo');

/** Delete a part as a person does: the bin at the end of its row (LAN-83). */
export async function deletePart(page: Page, n: number): Promise<void> {
  await page.getByRole('button', { name: `Delete Part ${n}`, exact: true }).locator('visible=true').first().click();
}

/** The device's events for a stream, with payloads, oldest first. */
export async function deviceLog(page: Page, orgId: string, streamId: string): Promise<{ status: string; type: string; payload: Record<string, unknown> }[]> {
  return page.evaluate(async ([org, stream]) => {
    const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog!;
    const rows = await log.select('select status, json from events where org_id = ? and stream_id = ? order by hlc', [org, stream]) as { status: string; json: string }[];
    return rows.map((r) => { const e = JSON.parse(r.json) as { type: string; payload: Record<string, unknown> }; return { status: r.status, type: e.type, payload: e.payload }; });
  }, [orgId, streamId] as const);
}

/**
 * Every recording this device made is on the server: nothing waits to
 * upload, and each card and voice note it wrote has its BlobStored. A test
 * that leaves recordings for the next test (a fresh browser) waits for this,
 * or the next one could not play them.
 */
export async function expectUploaded(page: Page, world: UiWorld): Promise<void> {
  let lastMissing: string[] = [];
  const state = async () => {
    await syncNow(page);
    const { rows, device } = await page.evaluate(async ([org, stream]) => {
      const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog!;
      const rows = await log.select('select status, json from events where org_id = ? and stream_id = ? order by hlc', [org, stream]) as { status: string; json: string }[];
      const meta = await log.select("select value from meta where key = 'deviceId'") as { value: string }[];
      return { rows, device: meta[0]?.value ?? '' };
    }, [world.languages.A.orgId, world.languages.A.languageId] as const);
    const events = rows.map((r) => ({ status: r.status, ...(JSON.parse(r.json) as { type: string; deviceId: string; payload: Record<string, unknown> }) }));
    const stored = new Set(events.filter((e) => e.type === 'v1.BlobStored').map((e) => e.payload['hash'] as string));
    const wanted = new Map<string, string>();
    for (const e of events.filter((x) => x.deviceId === device)) {
      if (e.type === 'v1.RecordingAdded') for (const c of (e.payload['cards'] as { hash: string }[])) wanted.set(c.hash, e.type);
      for (const [k, v] of Object.entries(e.payload)) if (/blobHash$/i.test(k) && typeof v === 'string') wanted.set(v, `${e.type}.${k}`);
    }
    const missing = [...wanted].filter(([h]) => !stored.has(h)).map(([h, from]) => `${h.slice(0, 8)} (${from})`);
    lastMissing = missing;
    return { missing: missing.length, pending: events.filter((e) => e.status === 'pending').length };
  };
  // G10.3: within 30 seconds online nothing waits to upload. Known issue
  // (2026-10-13): a recording made while transfers were held back (a part, a
  // voice note) often goes up only at the upload worker's next minute tick.
  // That is recorded as a failure, and the wait goes on, so the next test
  // still finds the audio on the server.
  await expect.soft.poll(state, { timeout: 30_000, message: 'G10.3: every recording uploaded within 30 seconds' }).toEqual({ missing: 0, pending: 0 });
  if (lastMissing.length) test.info().annotations.push({ type: 'G10.3', description: `not uploaded after 30 s: ${lastMissing.join(', ')}` });
  await expect.poll(state, { timeout: 60_000, message: 'every recording uploaded' }).toEqual({ missing: 0, pending: 0 });
}

/** The cards of the newest take composed on this device for a passage (the draft as last changed here). */
export async function lastComposed(page: Page, world: UiWorld, key: PassageKey): Promise<string[]> {
  const unitId = world.passages[key].unitId;
  const rows = (await deviceLog(page, world.languages.A.orgId, world.languages.A.languageId))
    .filter((r) => r.type === 'v1.TakeComposed' && r.payload['unitId'] === unitId);
  return (rows.at(-1)?.payload['cardHashes'] as string[] | undefined) ?? [];
}

/** How many events this device holds for the language once it has stopped catching up (for "nothing was written"). */
export async function settledEventCount(page: Page, world: UiWorld): Promise<number> {
  const count = async () => (await deviceLog(page, world.languages.A.orgId, world.languages.A.languageId)).length;
  await expectSyncIdle(page);
  return count();
}
