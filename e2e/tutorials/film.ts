// Films a tutorial video's steps (tutorial.ts) against the web export served
// on :8787 (e2e/ui-web.sh), the way the UI tests open the app: a fresh world
// from the UI tests' fixture, with the tutorial's made-up names, signed in as
// the tutorial's person, at phone size. Chrome's screencast keeps every frame
// with the time it was drawn, and the film notes when each line is said, when
// the speaker starts speaking, what the app plays aloud and what each step
// lit (where the camera moves in), so the video can be put together
// afterwards with its sound (compose.ts).
//
//   TUTORIAL_TTS="<command> <args>" TUTORIAL_SPEECH=<dir> npx tsx e2e/tutorials/film.ts record-a-passage [out]
//
// A line's recording is <out>/voice/<hash>.wav, named as help audio names
// its lines (the first 16 hex digits of SHA-256 over "<language>\n<words>"),
// so a line whose words change is said again. TUTORIAL_TTS makes the missing
// ones: it is run once, with each file to write and its words after its own
// args, so a voice can say them all in one request.
// The speaker's recordings are WAV files in TUTORIAL_SPEECH (make-readings.ts makes them).
import { chromium, type ElementHandle, type Locator, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildWorld, browserStateFor } from '../ui/fixture';
import { giveAddresses } from './addresses';
import { TUTORIALS } from './all';
import { steadyWords } from './look';
import { installTutorialMic } from './mic';
import { installPlaybackTap } from './playback';
import { findInFilmLanguage } from './ui';
import { WORLD_VOICES } from './voices';
import type { Focus } from './camera';
import type { Box, Step } from './tutorial';

// TUTORIAL_LANGUAGE: the app's language for the film (one of apps/mobile/src/i18n), and the voice's.
const LANGUAGE = process.env['TUTORIAL_LANGUAGE'] ?? 'en';

const [name = 'record-a-passage', outArg] = process.argv.slice(2);
const tutorial = TUTORIALS[name];
if (!tutorial) throw new Error(`No tutorial called ${name}. Known: ${Object.keys(TUTORIALS).join(', ')}`);
const out = path.resolve(outArg ?? path.join('e2e', 'results', 'tutorials', name));
// In another language the title and each line are said as e2e/tutorials/lines/<language>.json has them, by their English.
const translated = LANGUAGE === 'en' ? {} : JSON.parse(readFileSync(path.join('e2e', 'tutorials', 'lines', `${LANGUAGE}.json`), 'utf8')) as Record<string, string>;
function inLanguage(english: string): string {
  if (LANGUAGE === 'en') return english;
  const words = translated[english];
  if (!words && DRY) return english; // a dry run says nothing, so it can try a script before its lines are translated
  if (!words) throw new Error(`e2e/tutorials/lines/${LANGUAGE}.json has no "${english}"`);
  return words;
}
const base = `http://localhost:${process.env['UI_PORT'] ?? '8787'}`;
const speechDir = path.resolve(process.env['TUTORIAL_SPEECH'] ?? path.join('e2e', 'results', 'tutorials', 'speech', LANGUAGE));

// ---- the voice --------------------------------------------------------------------------

const lineHash = (words: string) => createHash('sha256').update(`${LANGUAGE}\n${words.trim()}`).digest('hex').slice(0, 16);

/** How long a WAV file plays, from its header. */
function wavSeconds(file: string): number {
  const bytes = readFileSync(file);
  let bytesPerSecond = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const chunk = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (chunk === 'fmt ') bytesPerSecond = bytes.readUInt32LE(at + 16);
    if (chunk === 'data' && bytesPerSecond) return size / bytesPerSecond;
    at += 8 + size + (size % 2);
  }
  throw new Error(`${file} is not a WAV file`);
}

/** TUTORIAL_DRY=1: no voice and no film, a picture of each step and its screen's words (steps/NN.png, NN.txt) instead, to try a script quickly. */
const DRY = process.env['TUTORIAL_DRY'] === '1';
/** TUTORIAL_VOICE_ONLY=1: say the lines that have no recording yet and stop, so many videos' lines are said at once before filming. */
const VOICE_ONLY = process.env['TUTORIAL_VOICE_ONLY'] === '1';

function voiceLines(all: string[]): Map<string, { file: string; seconds: number }> {
  const fileOf = (words: string) => path.join(out, 'voice', `${lineHash(words)}.wav`);
  const missing = DRY ? [] : [...new Set(all)].filter((words) => !existsSync(fileOf(words)));
  if (missing.length) {
    const tts = process.env['TUTORIAL_TTS']?.trim();
    if (!tts) throw new Error(`No recording of "${missing[0]}" and no TUTORIAL_TTS to make one.`);
    const [command, ...args] = tts.split(/\s+/);
    mkdirSync(path.join(out, 'voice'), { recursive: true });
    execFileSync(command!, [...args, ...missing.flatMap((words) => [fileOf(words), words])], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return new Map(all.map((words) => [words, DRY ? { file: '', seconds: 0.2 } : { file: fileOf(words), seconds: wavSeconds(fileOf(words)) }]));
}

// ---- what is drawn over the app ---------------------------------------------------------

/**
 * Light some elements as one box and dim the rest, as help mode does; null
 * takes the light away. The box follows the elements while they move (a bar
 * that comes and goes over the screen pushes everything down). An element
 * inside a card that draws its own edge (a lit step's border) is lit with its
 * card, so the light never cuts through the card's edge and leaves a line of
 * it dimmed outside (Caleb found one on 2026-10-30).
 */
function light(els: Node[] | null): void {
  const w = window as unknown as { __lit?: Node[]; __litLoop?: boolean };
  let el = document.getElementById('tutorial-light');
  w.__lit = els ?? [];
  if (!els) {
    if (el) el.style.opacity = '0';
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'tutorial-light';
    Object.assign(el.style, {
      position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', borderRadius: '18px', opacity: '0',
      boxShadow: '0 0 0 3px rgba(255,255,255,0.95), 0 0 0 7px #6847c6, 0 0 0 100vmax rgba(24,18,52,0.5)',
      transition: 'opacity 220ms ease'
    });
    document.body.appendChild(el);
  }
  const box = el;
  /** The element's box, or its card's: the nearest boxes around it that draw an edge, each at most 24 points bigger on a side. */
  const withCard = (e: Element) => {
    let r = e.getBoundingClientRect();
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = a.getBoundingClientRect();
      if (o.left < r.left - 24 || o.top < r.top - 24 || o.right > r.right + 24 || o.bottom > r.bottom + 24) break;
      const s = getComputedStyle(a);
      const edge = ['Top', 'Right', 'Bottom', 'Left'].some((side) =>
        parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && !/^(transparent|rgba\(.*,\s*0\))$/.test(s.getPropertyValue(`border-${side.toLowerCase()}-color`)));
      if (edge || s.boxShadow !== 'none') r = o;
    }
    return r;
  };
  const place = () => {
    const shown = (w.__lit ?? []).filter((e) => e.isConnected).map((e) => withCard(e as Element)).filter((r) => r.width > 0);
    if (shown.length) {
      const pad = 6;
      const x = Math.max(4, Math.min(...shown.map((r) => r.left)) - pad);
      const y = Math.max(4, Math.min(...shown.map((r) => r.top)) - pad);
      const right = Math.min(innerWidth - 4, Math.max(...shown.map((r) => r.right)) + pad);
      const bottom = Math.min(innerHeight - 4, Math.max(...shown.map((r) => r.bottom)) + pad);
      const at = { left: `${x}px`, top: `${y}px`, width: `${right - x}px`, height: `${bottom - y}px` };
      if (box.style.left !== at.left || box.style.top !== at.top || box.style.width !== at.width || box.style.height !== at.height) Object.assign(box.style, at);
    }
  };
  place();
  if (!w.__litLoop) {
    w.__litLoop = true;
    const loop = () => { place(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  if (box.style.opacity !== '1') requestAnimationFrame(() => { box.style.opacity = '1'; });
}

/** A finger's tap: a ring that opens out and fades where the finger lands. */
function tapRing(at: { x: number; y: number }): void {
  const ring = document.createElement('div');
  Object.assign(ring.style, {
    position: 'fixed', left: `${at.x - 32}px`, top: `${at.y - 32}px`, width: '64px', height: '64px', borderRadius: '50%',
    background: 'rgba(255,255,255,0.45)', border: '4px solid #ffffff', boxShadow: '0 0 0 3px #6847c6',
    zIndex: '2147483647', pointerEvents: 'none', transform: 'scale(0.55)', opacity: '1',
    transition: 'transform 520ms ease-out, opacity 520ms ease-in'
  });
  document.body.appendChild(ring);
  requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.transform = 'scale(1.35)'; ring.style.opacity = '0'; }));
  setTimeout(() => ring.remove(), 800);
}

/** A finger held down (a press, or a drag as it moves); null lifts it. */
function finger(at: { x: number; y: number } | null): void {
  let dot = document.getElementById('tutorial-finger');
  if (!at) {
    if (dot) dot.style.opacity = '0';
    return;
  }
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'tutorial-finger';
    Object.assign(dot.style, {
      position: 'fixed', width: '56px', height: '56px', borderRadius: '50%', zIndex: '2147483647', pointerEvents: 'none',
      background: 'rgba(255,255,255,0.55)', border: '4px solid #ffffff', boxShadow: '0 0 0 3px #6847c6', opacity: '0',
      transition: 'opacity 160ms ease'
    });
    document.body.appendChild(dot);
  }
  Object.assign(dot.style, { left: `${at.x - 28}px`, top: `${at.y - 28}px`, opacity: '1' });
}

async function handlesOf(parts: Locator | Locator[]): Promise<ElementHandle[]> {
  return Promise.all((Array.isArray(parts) ? parts : [parts]).map(async (p) => {
    await p.waitFor({ state: 'visible', timeout: 30_000 });
    const handle = (await p.elementHandle())!;
    // A box that hides what overflows is no scroller a finger can move: it stays as it was
    // (right to left, it would show a part cut off on the left and shift the whole panel).
    const held = await handle.evaluateHandle((e) => {
      const kept: { box: Element; x: number; y: number }[] = [];
      for (let box = e.parentElement; box; box = box.parentElement) {
        const style = getComputedStyle(box);
        if (/hidden|clip/.test(style.overflowX + style.overflowY)) kept.push({ box, x: box.scrollLeft, y: box.scrollTop });
      }
      return kept;
    });
    await p.scrollIntoViewIfNeeded();
    await held.evaluate((kept) => { for (const k of kept) { k.box.scrollLeft = k.x; k.box.scrollTop = k.y; } });
    await held.dispose();
    return handle;
  }));
}

const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Where the light is on the screen, as it was placed. */
function litBox(): Box {
  const r = document.getElementById('tutorial-light')!.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** The part of an element that shows: its box cut by the screen and by each box around it that hides what overflows. */
function shownBox(element: Element): Box {
  const r = element.getBoundingClientRect();
  let [left, top, right, bottom] = [Math.max(r.left, 0), Math.max(r.top, 0), Math.min(r.right, innerWidth), Math.min(r.bottom, innerHeight)];
  for (let e = element.parentElement; e; e = e.parentElement) {
    const style = getComputedStyle(e);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const o = e.getBoundingClientRect();
    [left, top, right, bottom] = [Math.max(left, o.left), Math.max(top, o.top), Math.min(right, o.right), Math.min(bottom, o.bottom)];
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


// ---- the film ---------------------------------------------------------------------------

// Every line is said once before filming, so a slow voice never holds the film.
const says = tutorial.steps.filter((s) => s.say).map((s) => s.say!);
const voiced = voiceLines(says.map(inLanguage));
const lines = new Map(says.map((say) => [say, voiced.get(inLanguage(say))!]));
if (VOICE_ONLY) process.exit(0);

rmSync(path.join(out, 'frames'), { recursive: true, force: true });
rmSync(path.join(out, 'heard'), { recursive: true, force: true });
rmSync(path.join(out, 'steps'), { recursive: true, force: true });
mkdirSync(path.join(out, 'frames'), { recursive: true });
mkdirSync(path.join(out, 'heard'), { recursive: true });
if (DRY) mkdirSync(path.join(out, 'steps'), { recursive: true });
const speech = (tutorial.speech ?? []).map((f) => { const file = path.join(speechDir, f); return { file, seconds: wavSeconds(file) }; });

const world = await buildWorld({
  keptByInvite: true, names: tutorial.names,
  voices: (what) => (WORLD_VOICES[what] ? readFileSync(path.join(speechDir, WORLD_VOICES[what]!)) : undefined)
});
// A dry run keeps the run-numbered addresses, so it can run beside a film.
if (!DRY) await giveAddresses(world);
await tutorial.prepare?.(world);
writeFileSync(path.join(out, 'world.json'), JSON.stringify(world));
const viewport = tutorial.viewport ?? { width: 430, height: 932 };
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport, deviceScaleFactor: 2, permissions: ['microphone'], reducedMotion: 'no-preference' });
const page = await context.newPage();
// tsx keeps functions' names with a __name helper, which the page lacks.
await page.addInitScript({ content: 'globalThis.__name ??= (f) => f;' });
for (const [n, s] of speech.entries()) {
  const body = readFileSync(s.file);
  await page.route(`**/__tutorial/speech-${n}.wav`, (r) => r.fulfill({ body, contentType: 'audio/wav' }));
}
await page.addInitScript(installTutorialMic, speech.map((_, n) => `/__tutorial/speech-${n}.wav`));

// What the app plays aloud: the bytes of each thing played, and each stretch played.
const audio = new Map<number, string>();
const played: { id: number; at: number; from: number; to: number }[] = [];
await page.exposeBinding('__tutorialHeard', (_source, entry: { kind: string; id: number; type?: string; base64?: string; at?: number; from?: number; to?: number }) => {
  if (entry.kind === 'audio' && entry.base64) {
    const ext = /webm/.test(entry.type ?? '') ? 'webm' : /mp4|m4a|aac/.test(entry.type ?? '') ? 'm4a' : /mpeg|mp3/.test(entry.type ?? '') ? 'mp3' : /wav/.test(entry.type ?? '') ? 'wav' : 'bin';
    const file = path.join(out, 'heard', `${entry.id}.${ext}`);
    writeFileSync(file, Buffer.from(entry.base64, 'base64'));
    audio.set(entry.id, file);
  } else if (entry.kind === 'played') {
    played.push({ id: entry.id, at: entry.at!, from: entry.from!, to: entry.to! });
  }
});
await page.addInitScript(installPlaybackTap, '__tutorialHeard');
// A phone's browser has a voice for its language, and help's Listen shows only where there is one (UI audit,
// finding 109). This headless Chromium lists none, so it is given one to find; the film never taps Listen.
await page.addInitScript((lang) => {
  const synth = globalThis.speechSynthesis;
  if (!synth) return;
  const voice = { lang, name: lang, voiceURI: lang, default: true, localService: true } as unknown as SpeechSynthesisVoice;
  const listed = synth.getVoices.bind(synth);
  synth.getVoices = () => { const voices = listed(); return voices.length ? voices : [voice]; };
}, LANGUAGE);
// The language picked in this browser (apps/mobile/src/i18n/choice.web.ts), until the video picks another.
if (LANGUAGE !== 'en') await page.addInitScript((code) => { if (localStorage.getItem('ui-language:v1') === null) localStorage.setItem('ui-language:v1', code); }, LANGUAGE);
// The scripts' English is looked for in the app's language.
findInFilmLanguage(page);
if (!tutorial.signedOut) {
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, browserStateFor(world, tutorial.as, tutorial.language ?? 'A'));
}

/** What the screen showed when a step failed: a picture, and its accessibility tree to read the names in. */
async function keepFailure(name: string): Promise<void> {
  await page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => undefined);
  const tree = await page.locator('body').ariaSnapshot().catch(() => '');
  writeFileSync(path.join(out, `${name}.txt`), tree);
}

const say = (n: number): Promise<number> =>
  page.evaluate((i) => (window as unknown as { __tutorialMic: { play(n: number): Promise<number> } }).__tutorialMic.play(i), n);

await page.goto(base);
await page.waitForFunction(() => !!(globalThis as { __langquestLog?: unknown }).__langquestLog, undefined, { timeout: 120_000 });
if (tutorial.before) {
  await tutorial.before(page, { say: async (n) => { await say(n); await sleep(speech[n]!.seconds * 1000); } }, world)
    .catch(async (error: unknown) => { await keepFailure('failed-before'); throw error; });
} else {
  const first = tutorial.steps.find((s) => s.part)?.part?.(page);
  if (first) await handlesOf(first).catch(async (error: unknown) => { await keepFailure('failed-start'); throw error; });
  await sleep(4000); // the first pull settles the bell and the lists
}

const frames: { file: string; t: number }[] = [];
let t0 = 0;
// Waits the video leaves out (a step's offCamera); one still going ends at Infinity.
const cuts: { from: number; to: number }[] = [];
/** Seconds into the video at this moment: a moment inside a cut is where the cut starts. */
const clock = (at: number) => {
  let ms = at - t0;
  for (const c of cuts) ms -= Math.max(0, Math.min(at, c.to) - c.from);
  return ms / 1000;
};
const now = () => clock(Date.now());
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', (f) => {
  const at = Date.now();
  if (!t0) t0 = at;
  const t = clock(at);
  // Inside a cut every frame falls at its start: the last one, what the wait led to, is kept.
  if (frames.at(-1)?.t === t) frames.pop();
  const file = path.join(out, 'frames', `${String(frames.length).padStart(5, '0')}.jpg`);
  writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, t });
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: viewport.width * 2, maxHeight: viewport.height * 2, everyNthFrame: 1 });
while (!t0) await sleep(50);
// The screencast sends a frame only when the screen changes: nudge one out now and then hold the opening.
await page.evaluate(light, null);
await sleep(800);

const said: { t: number; file: string; seconds: number; words: string }[] = [];
const spoken: { t: number; file: string }[] = [];
// What each step lit, when: the camera moves in on it (camera.ts); null, a step that lights nothing, shows the whole screen.
const focus: Focus[] = [];

/** The finger presses at `from`, moves to `to` (if anywhere), and lets go; `until` holds it down until it resolves. */
async function press(from: { x: number; y: number }, to: { x: number; y: number } | null, until?: () => Promise<unknown>): Promise<void> {
  await page.evaluate(finger, from);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await sleep(120);
  if (to) {
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const at = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      await page.mouse.move(at.x, at.y);
      await page.evaluate(finger, at);
      await sleep(28);
    }
  }
  if (until) await until();
  await sleep(120);
  await page.mouse.up();
  await page.evaluate(finger, null);
}

async function play(step: Step, index: number): Promise<void> {
  if (step.atSpeech !== undefined) {
    const last = spoken.at(-1);
    if (!last) throw new Error(`step ${index + 1} waits on speech that never started`);
    while (now() < last.t + step.atSpeech) await sleep(20);
  }
  if (step.first) await step.first(page);
  const parts = step.part?.(page);
  const target = parts ? (Array.isArray(parts) ? parts[0]! : parts) : null;
  let lit: Box | null = null;
  if (parts) {
    await page.evaluate(light, await handlesOf(parts));
    lit = await page.evaluate(litBox);
    focus.push({ t: now(), box: lit });
    await sleep(350);
  } else {
    focus.push({ t: now(), box: null });
  }
  if (step.say) {
    const line = lines.get(step.say)!;
    said.push({ t: now(), ...line, words: inLanguage(step.say) });
    await sleep(line.seconds * 1000 + 250);
  }
  const acts = !!(step.tap || step.press || step.drag || step.type || step.paste);
  if (acts && target) {
    const b = (await target.boundingBox())!;
    const at = step.tapAt ? step.tapAt(await target.evaluate(shownBox)) : centre(b);
    await page.evaluate(light, null);
    if (step.press) {
      const shows = step.press(page);
      await press(at, null, () => shows.waitFor({ state: 'visible', timeout: 5_000 }));
    } else if (step.drag) {
      let to = { x: at.x + ('by' in step.drag ? step.drag.by.x : 0), y: at.y + ('by' in step.drag ? step.drag.by.y : 0) };
      if ('to' in step.drag) {
        // Onto the other part's place, a little past its top or bottom edge, as a finger lets go of a row.
        const other = (await step.drag.to(page).boundingBox())!;
        to = { x: at.x, y: at.y + other.y - b.y + (other.y < b.y ? -8 : 8) };
      }
      // The camera takes in where the finger lets go, too.
      if (lit) {
        const [x, y] = [Math.min(lit.x, to.x - 24), Math.min(lit.y, to.y - 24)];
        focus.push({ t: now(), box: { x, y, width: Math.max(lit.x + lit.width, to.x + 24) - x, height: Math.max(lit.y + lit.height, to.y + 24) - y } });
      }
      await press(at, to);
    } else {
      await page.evaluate(tapRing, at);
      await sleep(140);
      if (step.tapAt) await page.mouse.click(at.x, at.y);
      else await target.click();
      if (step.type && step.replace) await target.selectText();
      if (step.type) await target.pressSequentially(typeof step.type === 'string' ? step.type : step.type(world), { delay: 70 });
      if (step.paste) await target.fill(typeof step.paste === 'string' ? step.paste : step.paste(world));
    }
    if (step.speak !== undefined) {
      const started = await say(step.speak);
      spoken.push({ t: clock(started), file: speech[step.speak]!.file });
    }
  } else if (parts) {
    await page.evaluate(light, null);
  }
  if (step.until) await step.until(page);
  await sleep((DRY ? Math.min(step.stay ?? 0.4, 1) : step.stay ?? 0.4) * 1000);
  if (step.offCamera) {
    const cut = { from: Date.now(), to: Infinity };
    cuts.push(cut);
    await step.offCamera(page);
    await sleep(300);
    cut.to = Date.now();
  }
  if (DRY) {
    const name = path.join(out, 'steps', String(index + 1).padStart(2, '0'));
    await page.screenshot({ path: `${name}.png` });
    writeFileSync(`${name}.txt`, await steadyWords(page, LANGUAGE));
  }
}

for (const [index, step] of tutorial.steps.entries()) {
  try {
    await play(step, index);
  } catch (error) {
    await keepFailure(`failed-step-${index + 1}`);
    await browser.close();
    throw new Error(`step ${index + 1} on ${step.screen} could not finish: ${String(error)}`);
  }
}
await sleep(600);
const end = now();
await page.evaluate(() => (window as unknown as { __playbackFlush(): void }).__playbackFlush());
await sleep(300);
await cdp.send('Page.stopScreencast');
await browser.close();
writeFileSync(path.join(out, 'played.json'), JSON.stringify({ t0, played, audio: [...audio.entries()] }, null, 1));
const heard = played
  .filter((p) => p.at >= t0 && audio.has(p.id) && p.to > p.from)
  .map((p) => ({ t: clock(p.at), file: audio.get(p.id)!, from: p.from, to: p.to }));
writeFileSync(path.join(out, 'film.json'), JSON.stringify({
  tutorial: tutorial.id, title: inLanguage(tutorial.title), language: LANGUAGE, end, viewport, frames, said, spoken, heard, focus
}, null, 1));
console.log(`${tutorial.title}: ${frames.length} frames, ${end.toFixed(1)} s, ${said.length} lines, ${heard.length} played → ${out}`);
