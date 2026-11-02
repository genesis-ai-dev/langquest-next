// Films the app's own screens for the channel trailer (trailer/README.md):
// the moments its six steps show, in the film's language, as the UI tests
// open the app. Grace (the world's translator) listens to Luke 13:31-35,
// records it with no signal, gets it back up, finishes it and asks for the
// Peer check, then opens Luke 16:19-31's history; Samuel, with no
// organization yet, opens who may use its work. Chrome's screencast keeps
// every frame with its time; capture.json says when each moment starts and
// where on the screen each part is, for the film to cut from; steps/ keeps
// the words of the screens the film shows, for its look (trailer.ts).
//
//   TUTORIAL_LANGUAGE=fr npx tsx e2e/tutorials/trailer/capture.ts [out]
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildWorld, browserStateFor, type AccountKey } from '../../ui/fixture';
import { giveAddresses } from '../addresses';
import { steadyWords } from '../look';
import { installTutorialMic } from '../mic';
import { recordAPassage } from '../record-a-passage';
import { findInFilmLanguage, uiPattern } from '../ui';
import { WORLD_VOICES } from '../voices';
import { button, id, shows } from '../workspace';

const LANGUAGE = process.env['TUTORIAL_LANGUAGE'] ?? 'en';
const out = path.resolve(process.argv[2] ?? path.join('e2e', 'results', 'trailer', LANGUAGE));
// Grace reads in French in every film, so English's readings serve all, and her parts fall the same in every
// language (the nightly job brings them from the release with the film language's own).
const speechDir = path.resolve(process.env['TUTORIAL_SPEECH'] ?? path.join('e2e', 'results', 'tutorials', 'speech', 'en'));
const base = `http://localhost:${process.env['UI_PORT'] ?? '8787'}`;
const SCALE = 3;
const viewport = { width: 430, height: 932 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'frames'), { recursive: true });
mkdirSync(path.join(out, 'stills'), { recursive: true });
mkdirSync(path.join(out, 'steps'), { recursive: true });

const world = await buildWorld({
  keptByInvite: true, names: recordAPassage.names,
  voices: (what) => (WORLD_VOICES[what] ? readFileSync(path.join(speechDir, WORLD_VOICES[what]!)) : undefined)
});
await giveAddresses(world);
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

type Box = { x: number; y: number; width: number; height: number };
const frames: { file: string; t: number; take: string }[] = [];
const marks: { name: string; take: string; t: number; boxes: Record<string, Box | null> }[] = [];
const t0 = Date.now();

async function open(take: string, as: AccountKey, signedIn: boolean): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: SCALE, permissions: ['microphone'], reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.addInitScript({ content: 'globalThis.__name ??= (f) => f;' });
  const passage = readFileSync(path.join(speechDir, 'passage.wav'));
  await page.route('**/__tutorial/speech-0.wav', (r) => r.fulfill({ body: passage, contentType: 'audio/wav' }));
  await page.addInitScript(installTutorialMic, ['/__tutorial/speech-0.wav']);
  if (LANGUAGE !== 'en') await page.addInitScript((code) => { if (localStorage.getItem('ui-language:v1') === null) localStorage.setItem('ui-language:v1', code); }, LANGUAGE);
  findInFilmLanguage(page);
  if (signedIn) {
    await page.addInitScript((entries) => {
      for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    }, browserStateFor(world, as, 'A'));
  }
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    const file = path.join('frames', `${take}-${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(path.join(out, file), Buffer.from(f.data, 'base64'));
    frames.push({ file, t: (Date.now() - t0) / 1000, take });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  await page.goto(base);
  await page.waitForFunction(() => !!(globalThis as { __langquestLog?: unknown }).__langquestLog, undefined, { timeout: 120_000 });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: viewport.width * SCALE, maxHeight: viewport.height * SCALE, everyNthFrame: 1 });
  return { context, page };
}

/** A moment the film can start from: its time, a picture of the whole screen, and where each named part is. */
async function mark(page: Page, take: string, name: string, parts: Record<string, Locator> = {}): Promise<void> {
  const boxes: Record<string, Box | null> = {};
  for (const [k, l] of Object.entries(parts)) boxes[k] = await l.boundingBox({ timeout: 2000 }).catch(() => null);
  marks.push({ name, take, t: (Date.now() - t0) / 1000, boxes });
  await page.screenshot({ path: path.join(out, 'stills', `${name}.png`) });
}

/** The screen's words once they settle, for the film's look; read before a mark, so the mark's timing stays as it was. */
let looked = 0;
async function look(page: Page, name: string): Promise<void> {
  const words = await steadyWords(page, LANGUAGE);
  writeFileSync(path.join(out, 'steps', `${String(++looked).padStart(2, '0')}-${name}.txt`), words);
}

async function fail(page: Page, step: string, error: unknown): Promise<never> {
  await page.screenshot({ path: path.join(out, `failed-${step}.png`) }).catch(() => undefined);
  writeFileSync(path.join(out, `failed-${step}.txt`), await page.locator('body').ariaSnapshot().catch(() => ''));
  await browser.close();
  throw new Error(`${step}: ${String(error)}`);
}

// ---- Grace -------------------------------------------------------------------------------
{
  const take = 'grace';
  const { context, page } = await open(take, 'TRANS', true);
  const step = async (name: string, run: () => Promise<unknown>) => { try { await run(); } catch (e) { await fail(page, name, e); } };
  const play = () => page.getByRole('button', { name: uiPattern('recording.player.playTitle') }).locator('visible=true').first();
  const panel = () => ({ bible: page.getByRole('tab').locator('visible=true').first(), play: play(), divider: page.getByRole('slider').locator('visible=true').first(), record: id(page, 'record-button') });

  await step('open', async () => {
    await page.getByText('Luke 13:31–35').locator('visible=true').first().waitFor({ timeout: 60_000 });
    await sleep(4000);
    await id(page, 'primary-action').click();
    await shows(page, 'path-step-record');
    await sleep(800);
    await id(page, 'primary-action').click();
    await shows(page, 'record-button');
    await sleep(2500);
  });
  // 1 Listen: the Bible for the passage, played.
  await step('listen', async () => {
    await look(page, 'listen');
    await mark(page, take, 'listen', panel());
    await play().click();
    await sleep(300);
    await mark(page, take, 'listen-playing', panel());
    await sleep(4500);
    await page.getByRole('button', { name: /pause|Pause/ }).locator('visible=true').first().click().catch(() => undefined);
    await sleep(800);
  });
  // 2 Speak and 3 Offline: recorded with no signal, part by part, then back in range.
  await step('speak', async () => {
    await context.setOffline(true);
    await sleep(2500);
    await look(page, 'speak');
    await mark(page, take, 'speak', panel());
    await id(page, 'record-button').click();
    await page.evaluate(() => (window as unknown as { __tutorialMic: { play(n: number): Promise<number> } }).__tutorialMic.play(0));
    await mark(page, take, 'speak-recording', { ...panel(), parts: id(page, 'live-parts') });
    await sleep(27_400);
    await mark(page, take, 'speak-end', { ...panel(), parts: id(page, 'live-parts') });
    await id(page, 'record-button').click();
    await words(page, 'Stopped').waitFor();
    await sleep(600);
    await button(page, 'Done').click();
    await shows(page, 'publish-button');
    await sleep(2500);
  });
  await step('offline', async () => {
    const kept = () => ({ bar: id(page, 'upload-bar'), group: button(page, /^Parts 1–3, 3 parts · /), last: page.getByRole('button', { name: /^Part 3, (no verse yet|Verses? )/ }).locator('visible=true').first() });
    await look(page, 'offline');
    await mark(page, take, 'offline', kept());
    await sleep(2500);
    await context.setOffline(false);
    await mark(page, take, 'online', kept());
    await words(page, 'All uploaded').waitFor({ timeout: 60_000 });
    await mark(page, take, 'uploaded', kept());
    await id(page, 'upload-bar').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
    await sleep(1500);
  });
  // 4 Heard: finished, and the Peer check team asked.
  await step('heard', async () => {
    await id(page, 'publish-button').click();
    // "Ask the Peer check team": the template's team name stays as the library wrote it, so found by the app's line.
    const ask = page.getByRole('button', { name: uiPattern('passage.published.askTarget') }).locator('visible=true').last();
    await ask.waitFor({ timeout: 30_000 });
    await sleep(1500);
    await look(page, 'heard');
    await mark(page, take, 'heard', { ask, first: page.getByRole('radio').locator('visible=true').first(), last: page.getByRole('radio').locator('visible=true').last() });
    await ask.click();
    await shows(page, 'path-step-record');
    await sleep(800);
    await look(page, 'heard-asked');
    await mark(page, take, 'heard-asked', { device: button(page, 'On this device'), record: id(page, 'path-step-record'), peer: page.getByRole('button', { name: /^Peer check, / }).locator('visible=true').first() });
    await sleep(3500);
  });
  // 5 Kept: a passage that has been through every check, and its history.
  await step('kept', async () => {
    await button(page, 'Back').click();
    await page.getByRole('tab', { name: 'Map' }).locator('visible=true').first().click();
    const find = page.getByRole('textbox', { name: 'Find “John 3”' }).locator('visible=true').first();
    await find.waitFor({ timeout: 30_000 });
    await find.pressSequentially('Luke 16', { delay: 40 });
    await sleep(800);
    await words(page, 'Luke 16:19–31').click();
    await button(page, 'Versions and history').waitFor({ timeout: 30_000 });
    await sleep(800);
    await button(page, 'Versions and history').click();
    await button(page, 'Open Version 1').waitFor({ timeout: 10_000 });
    await sleep(800);
    await words(page, /^History/).click();
    await sleep(2500);
    await look(page, 'kept');
    await mark(page, take, 'kept', { history: words(page, /^History/), version: button(page, 'Open Version 1') });
    await sleep(1500);
  });
  await context.close();
}

// ---- Samuel, starting an organization ----------------------------------------------------
{
  const take = 'samuel';
  const { context, page } = await open(take, 'NOORG', true);
  const step = async (name: string, run: () => Promise<unknown>) => { try { await run(); } catch (e) { await fail(page, name, e); } };
  await step('decides', async () => {
    await words(page, 'Start a new one').waitFor({ timeout: 60_000 });
    await words(page, 'Start a new one').click();
    await page.getByPlaceholder('Enter organization name').locator('visible=true').first().fill(recordAPassage.names.org ?? 'Riverside Translation Team');
    await page.getByRole('button', { name: /^License: / }).locator('visible=true').first().click();
    await button(page, 'Use this license').waitFor({ timeout: 10_000 });
    await sleep(1500);
    const radios = page.getByRole('radio').locator('visible=true');
    const n = await radios.count();
    // The sheet grows when a sharing license is picked, so each mark keeps where the next pick is.
    const parts = (i: number) => ({ sheet: id(page, 'sheet'), first: radios.first(), next: radios.nth(Math.min(i + 1, n - 1)), use: button(page, 'Use this license') });
    await look(page, 'decides');
    await mark(page, take, 'decides-0', parts(0));
    for (let i = 1; i < n; i++) {
      await radios.nth(i).click();
      await sleep(900);
      await mark(page, take, `decides-${i}`, parts(i));
    }
    await sleep(800);
  });
  await context.close();
}

await browser.close();
writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ language: LANGUAGE, scale: SCALE, viewport, frames, marks }, null, 1));
console.log(`${LANGUAGE}: ${frames.length} frames, ${marks.length} marks → ${out}`);
