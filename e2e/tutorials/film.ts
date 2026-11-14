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
 * Light some elements and dim the rest, as help mode does; null takes the light away. The light follows the
 * elements while they move (a bar that comes and goes over the screen pushes everything down).
 *
 * Where the light goes (decisions.md 191): the button or card the lit part is in (the nearest one tapped as one, or
 * drawn with an edge or a fill of its own, up to a third of the screen), with a box drawn round it and little bigger
 * (a field's box round the field and its icon, a row's card round the row and its handle). The light is exactly that
 * box, with its corners, so the dimming stops where the part's own edge is and draws no line of its own: nothing
 * outside it is cut and nothing in it is hidden. A part with no box of its own (a line of words, an icon) has the
 * light 6 points round it, nearer on a side where that would take in other words, an icon or an edge.
 * Gemini's frame check held nearly every film of 2026-10-31 for a drawn ring through a card, the words beside it,
 * or with square corners; four rounds of placing the ring better each passed under a tenth of the films.
 */
function light(els: Node[] | null): void {
  type Side = { l: number; t: number; r: number; b: number };
  /** Something a viewer sees: a line of words or an icon (edge null), or an edge across (h) or up and down (v). */
  type Thing = Side & { edge: 'h' | 'v' | null };
  type Clear = { key: string; at: number; off: Side; rows: [number, number][]; round: string };
  type Grown = { key: string; at: number; c: Side; grown: boolean };
  const w = window as unknown as { __lit?: Node[]; __litLoop?: boolean; __clear?: Clear; __grown?: Grown };
  let el = document.getElementById('tutorial-light');
  w.__lit = els ?? [];
  w.__clear = undefined;
  w.__grown = undefined;
  if (!els) {
    if (el) el.style.opacity = '0';
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'tutorial-light';
    Object.assign(el.style, {
      position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', borderRadius: '0px', opacity: '0',
      boxShadow: '0 0 0 100vmax rgba(24,18,52,0.55)', transition: 'opacity 220ms ease'
    });
    document.body.appendChild(el);
  }
  const box = el;
  // Round a part with no box of its own, the light stands 6 points off where it can.
  const PAD = 6;
  const SIDES = ['l', 't', 'r', 'b'] as const;
  const screen = innerWidth * innerHeight;
  const clear = /^(transparent|rgba\(.*,\s*0\))$/;
  const of = (d: DOMRect): Side => ({ l: d.left, t: d.top, r: d.right, b: d.bottom });
  const area = (o: Side) => Math.max(0, o.r - o.l) * Math.max(0, o.b - o.t);
  const cut = (x: Side, y: Side): Side => ({ l: Math.max(x.l, y.l), t: Math.max(x.t, y.t), r: Math.min(x.r, y.r), b: Math.min(x.b, y.b) });
  const meets = (x: Side, y: Side) => x.l < y.r && x.r > y.l && x.t < y.b && x.b > y.t;
  const join = (all: Side[]): Side => ({ l: Math.min(...all.map((o) => o.l)), t: Math.min(...all.map((o) => o.t)), r: Math.max(...all.map((o) => o.r)), b: Math.max(...all.map((o) => o.b)) });
  const edged = (s: CSSStyleDeclaration) => SIDES.some((k) => {
    const side = { l: 'left', t: 'top', r: 'right', b: 'bottom' }[k];
    return parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0 && !clear.test(s.getPropertyValue(`border-${side}-color`));
  });
  const fillUnder = (e: Element | null): string => {
    for (let a = e; a; a = a.parentElement) {
      const c = getComputedStyle(a).backgroundColor;
      if (!clear.test(c)) return c;
    }
    return 'rgb(255, 255, 255)';
  };
  /** A box a viewer sees: an edge, a shadow, or a fill other than what is behind it. */
  const drawn = (e: Element, s: CSSStyleDeclaration) =>
    edged(s) || s.boxShadow !== 'none' || (!clear.test(s.backgroundColor) && s.backgroundColor !== fillUnder(e.parentElement));
  const control = (a: Element) => ['button', 'a', 'input', 'select', 'textarea'].includes(a.tagName.toLowerCase()) ||
    ['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'option', 'slider'].includes(a.getAttribute('role') ?? '') ||
    (a.getAttribute('tabindex') ?? '-1') !== '-1';
  const lit = () => (w.__lit ?? []).filter((e): e is Element => e.isConnected && e instanceof Element);

  /** How round each corner of `e` is (top left, top right, bottom right, bottom left), no more than half its size. */
  const corners = (e: Element): number[] => {
    const s = getComputedStyle(e);
    const d = e.getBoundingClientRect();
    return ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((k) => Math.min(parseFloat(s.getPropertyValue(`border-${k}-radius`)) || 0, d.width / 2, d.height / 2));
  };
  /**
   * A button with no box of its own whose words and icons are all on one box it holds (a part's play button: a round
   * face on a tap area as tall as the row, and taller on the last row): that face. Otherwise the button itself.
   */
  const face = (e: Element): Element => {
    if (!control(e) || drawn(e, getComputedStyle(e))) return e;
    const shows: Node[] = [...e.querySelectorAll('svg, img')].filter((x) => x.getBoundingClientRect().width > 0);
    const words = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = words.nextNode(); n; n = words.nextNode()) if ((n.textContent ?? '').trim()) shows.push(n);
    if (!shows.length) return e;
    let best: Element | undefined;
    for (const d of e.querySelectorAll('*')) {
      const r = d.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || !drawn(d, getComputedStyle(d)) || !shows.every((x) => d.contains(x))) continue;
      if (!best || area(of(r)) > area(of(best.getBoundingClientRect()))) best = d;
    }
    return best ?? e;
  };
  /**
   * What is lit: the button or card each lit part is in, together; how round its corners are (the one box's, the least
   * round of several); and whether each has a box a viewer sees.
   */
  const own = (parts: Element[]): { c: Side; round: number[]; boxed: boolean; found: Element[] } => {
    const found = parts.map((e) => {
      let found: Element | undefined;
      for (let a: Element | null = e; a && a !== document.body; a = a.parentElement) {
        const o = of(a.getBoundingClientRect());
        if (area(o) > screen / 3) break;
        if (found) {
          // A box drawn round it that is little bigger, or as tall and not much wider (a field's box round the field
          // and its icon, a row's card round the row and its handle), is lit with it; never one with another button
          // that has words (the bar at the foot of a screen round Skip and Next question), nor one from one side of the
          // screen to the other (the bar round the main button).
          if (o.l <= 1 && o.r >= innerWidth - 1) break;
          const f = of(found.getBoundingClientRect());
          const tall = o.t >= f.t - 24 && o.b <= f.b + 24;
          if (!(tall && ((o.l >= f.l - 24 && o.r <= f.r + 24) || f.r - f.l >= 0.6 * (o.r - o.l)))) break;
          const inside = found;
          if ([...a.querySelectorAll('*')].some((x) => control(x) && !inside.contains(x) && !x.contains(inside) && !!(x.textContent ?? '').trim() && x.getBoundingClientRect().width > 0)) break;
          if (drawn(a, getComputedStyle(a))) found = a;
        } else if (control(a) || drawn(a, getComputedStyle(a))) found = a;
      }
      return face(found ?? e);
    });
    // What shows of each: a part a list hides (a header scrolled up under the panel above it) is not lit.
    const seen = found.map((e) => shown(e)).filter((o) => o.r - o.l >= 1 && o.b - o.t >= 1);
    let c = seen.length ? join(seen) : join(found.map((e) => of(e.getBoundingClientRect())));
    // A card the lit parts nearly fill (the Bible's card with its play button, lit with the verses under it) is lit
    // whole, not cut across; never a bar from one side of the screen to the other (the bar round the main button).
    for (const f of found) {
      for (let a = f.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = shown(a);
        if (area(o) > screen / 3) break;
        if (o.l <= 1 && o.r >= innerWidth - 1) continue;
        if (drawn(a, getComputedStyle(a)) && o.l >= c.l - 24 && o.t >= c.t - 24 && o.r <= c.r + 24 && o.b <= c.b + 24) c = join([c, o]);
      }
    }
    // Several parts lit as one box take in whole what its edge would cut between them (chips that wrap, By email
    // beside Share as a link and One person under them): the box is no longer one of theirs.
    const taken = found.length > 1 ? takeIn(c, found) : { c, grown: false };
    c = taken.c;
    const round = [0, 1, 2, 3].map((i) => Math.min(...found.map((e) => corners(e)[i]!)));
    // A corner on a rounder box's corner (the first or last rows of a rounded list) is as round as that box's.
    for (let a = found[0]!.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = of(a.getBoundingClientRect());
      if (area(o) > screen / 2) break;
      if (!drawn(a, getComputedStyle(a))) continue;
      const at = [[o.l, o.t, c.l, c.t], [o.r, o.t, c.r, c.t], [o.r, o.b, c.r, c.b], [o.l, o.b, c.l, c.b]];
      corners(a).forEach((r, i) => {
        const [x, y, cx, cy] = at[i]!;
        if (Math.abs(x! - cx!) <= 3 && Math.abs(y! - cy!) <= 3) round[i] = Math.max(round[i]!, r);
      });
    }
    return { c, round, boxed: !taken.grown && found.every((e) => drawn(e, getComputedStyle(e))), found };
  };

  /**
   * The box `c` round several lit parts, grown to take in whole each button, line of words or icon its edge would cut
   * (part of it in the box, part out), until it cuts none; never past a third of the screen. Looked at again when the
   * box moves, and every quarter second.
   */
  const takeIn = (c: Side, found: Element[]): { c: Side; grown: boolean } => {
    const key = SIDES.map((k) => Math.round(c[k])).join(',');
    if (w.__grown && w.__grown.key === key && performance.now() - w.__grown.at < 250) return w.__grown;
    const ours = (e: Element) => !!e.closest('[id^="tutorial-"]');
    const showing = (e: Element) => e.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;
    /** Not under something else: what is at the middle of `o` is the element, or in it. */
    const seen = (e: Element, o: Side) => {
      const hit = document.elementFromPoint(Math.min(Math.max((o.l + o.r) / 2, 0), innerWidth - 1), Math.min(Math.max((o.t + o.b) / 2, 0), innerHeight - 1));
      return !!hit && (e.contains(hit) || hit.contains(e));
    };
    /** `box`: a button's own box or the face it shows, rather than a line of words or an icon. */
    const pieces: (Side & { box?: boolean })[] = [];
    const add = (e: Element, o: Side, box = false) => {
      if (o.r - o.l < 2 || o.b - o.t < 2 || area(o) > screen / 3 || (o.l <= 1 && o.r >= innerWidth - 1)) return;
      if (seen(e, o)) pieces.push(box ? { ...o, box } : o);
    };
    // A button (not one the lit parts are in, nor one in them) and an icon. A button is what a viewer sees of it: its
    // own box, or the round face or card it shows (the + on the line between two parts is a small round face on a tap
    // area as tall as a row); one with neither is only its words and icons, each looked at on its own.
    for (const e of document.body.querySelectorAll('*')) {
      if (ours(e) || found.some((f) => e.contains(f) || f.contains(e))) continue;
      const svg = e.tagName.toLowerCase() === 'svg';
      if (!svg && !control(e)) continue;
      if (!showing(e)) continue;
      const shows = svg ? e : face(e);
      if (svg || shows !== e || drawn(e, getComputedStyle(e))) add(shows, shown(shows), !svg);
    }
    // A line of words.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const e = n.parentElement;
      if (!e || !(n.textContent ?? '').trim() || ours(e) || found.some((f) => f.contains(e)) || !showing(e)) continue;
      range.selectNodeContents(n);
      const clip = shown(e);
      for (const d of range.getClientRects()) add(e, cut(of(d), clip));
    }
    let out = c;
    let grown = false;
    for (let again = true, i = 0; again && i < 8; i++) {
      again = false;
      for (const o of pieces) {
        const both = cut(o, out);
        if (both.r - both.l < 2 || both.b - both.t < 2) continue;
        if (o.l >= out.l - 1 && o.t >= out.t - 1 && o.r <= out.r + 1 && o.b <= out.b + 1) continue;
        if (o.l <= out.l && o.t <= out.t && o.r >= out.r && o.b >= out.b) continue;
        // A button's box the edge only grazes, by under a quarter of its height or width, is not cut: the edge crosses
        // its margin (a part's verse space, as tall as its row, once the + on the line above is taken in).
        if (o.box && (both.b - both.t < (o.b - o.t) / 4 || both.r - both.l < (o.r - o.l) / 4)) continue;
        const next = join([out, o]);
        if (area(next) > screen / 3) continue;
        out = next;
        again = grown = true;
      }
    }
    w.__grown = { key, at: performance.now(), c: out, grown };
    return w.__grown;
  };

  /** Where `e` shows: its box cut by the screen and by each box around it that hides what overflows. */
  const shown = (e: Element): Side => {
    let o = cut(of(e.getBoundingClientRect()), { l: 0, t: 0, r: innerWidth, b: innerHeight });
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const r = of(a.getBoundingClientRect());
      o = cut(o, { l: s.overflowX !== 'visible' ? r.l : -Infinity, t: s.overflowY !== 'visible' ? r.t : -Infinity, r: s.overflowX !== 'visible' ? r.r : Infinity, b: s.overflowY !== 'visible' ? r.b : Infinity });
    }
    return o;
  };

  /** How far what is in the lit boxes shows past them on each side (a count on a button's corner). */
  const spill = (found: Element[], c: Side): Side => {
    const g: Side = { l: 0, t: 0, r: 0, b: 0 };
    for (const f of found) {
      for (const d of f.querySelectorAll('*')) {
        if (d.closest('[id^="tutorial-"]') || !(d.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true)) continue;
        const o = shown(d);
        if (o.r - o.l < 2 || o.b - o.t < 2) continue;
        g.l = Math.max(g.l, c.l - o.l);
        g.t = Math.max(g.t, c.t - o.t);
        g.r = Math.max(g.r, o.r - c.r);
        g.b = Math.max(g.b, o.b - c.b);
      }
    }
    for (const k of SIDES) if (g[k] <= 2) g[k] = 0;
    return g;
  };

  /**
   * What a viewer sees on the screen, cut where a box around it hides what overflows: each line of words, each icon,
   * picture and field's words, and each edge of a drawn box (not one half the screen or bigger); and where on the
   * screen something shows, top to bottom (the camera never films an empty screen: camera.ts).
   */
  const look = (): { things: Thing[]; rows: [number, number][] } => {
    const things: Thing[] = [];
    const filled: Side[] = [];
    const clips = new Map<Element, Side>();
    const whole = { l: 0, t: 0, r: innerWidth, b: innerHeight };
    const clipOf = (e: Element | null): Side => {
      if (!e || e === document.body) return whole;
      let c = clips.get(e);
      if (!c) {
        c = clipOf(e.parentElement);
        const s = getComputedStyle(e);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const o = of(e.getBoundingClientRect());
          c = cut(c, { l: s.overflowX !== 'visible' ? o.l : -Infinity, t: s.overflowY !== 'visible' ? o.t : -Infinity, r: s.overflowX !== 'visible' ? o.r : Infinity, b: s.overflowY !== 'visible' ? o.b : Infinity });
        }
        clips.set(e, c);
      }
      return c;
    };
    const ours = (e: Element) => !!e.closest('[id^="tutorial-"]');
    const showing = (s: CSSStyleDeclaration) => s.visibility === 'visible' && parseFloat(s.opacity) >= 0.05;
    /** Not under something else: what is at the point is the element, or in it. */
    const seen = (e: Element, x: number, y: number) => {
      const hit = document.elementFromPoint(Math.min(Math.max(x, 0), innerWidth - 1), Math.min(Math.max(y, 0), innerHeight - 1));
      return !!hit && (e.contains(hit) || hit.contains(e));
    };
    /** Adds what shows of `d` inside `clip`; a line of words or an icon only where it is not under something else. */
    const add = (e: Element, clip: Side, d: Side, edge: Thing['edge']) => {
      const s = cut(d, clip);
      if (s.r - s.l < 0.5 || s.b - s.t < 0.5) return;
      if (!edge && !seen(e, (s.l + s.r) / 2, (s.t + s.b) / 2)) return;
      things.push({ ...s, edge });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const e = n.parentElement;
      if (!e || !(n.textContent ?? '').trim() || ours(e) || !showing(getComputedStyle(e))) continue;
      range.selectNodeContents(n);
      for (const d of range.getClientRects()) if (d.width >= 1 && d.height >= 1) add(e, clipOf(e), of(d), null);
    }
    for (const e of document.body.querySelectorAll('*')) {
      if (ours(e) || (e instanceof SVGElement && e.tagName.toLowerCase() !== 'svg')) continue;
      const d = of(e.getBoundingClientRect());
      if (d.r - d.l < 1 || d.b - d.t < 1 || d.r <= 0 || d.b <= 0 || d.l >= innerWidth || d.t >= innerHeight) continue;
      const tag = e.tagName.toLowerCase();
      const s = getComputedStyle(e);
      if (!showing(s)) continue;
      const clip = clipOf(e.parentElement);
      if (['svg', 'img', 'canvas', 'video'].includes(tag)) {
        add(e, clip, d, null);
        continue;
      }
      if ((tag === 'input' || tag === 'textarea') && ((e as HTMLInputElement).value || (e as HTMLInputElement).placeholder)) add(e, clip, d, null);
      if (area(d) >= screen / 2 || d.r - d.l < 4 || d.b - d.t < 4 || !drawn(e, s)) continue;
      filled.push(d);
      // Each side of a drawn box that shows (a point just inside it is the box or in it), one point thick.
      const [mx, my] = [(d.l + d.r) / 2, (d.t + d.b) / 2];
      if (seen(e, mx, d.t + 1.5)) add(e, clip, { l: d.l, t: d.t, r: d.r, b: d.t + 1 }, 'h');
      if (seen(e, mx, d.b - 1.5)) add(e, clip, { l: d.l, t: d.b - 1, r: d.r, b: d.b }, 'h');
      if (seen(e, d.l + 1.5, my)) add(e, clip, { l: d.l, t: d.t, r: d.l + 1, b: d.b }, 'v');
      if (seen(e, d.r - 1.5, my)) add(e, clip, { l: d.r - 1, t: d.t, r: d.r, b: d.b }, 'v');
    }
    const rows: [number, number][] = [];
    for (const r of [...things.filter((t) => !t.edge), ...filled].sort((a, b) => a.t - b.t)) {
      const [t, b] = [Math.round(Math.max(r.t, 0)), Math.round(Math.min(r.b, innerHeight))];
      if (b <= t) continue;
      const last = rows.at(-1);
      if (last && t <= last[1] + 4) last[1] = Math.max(last[1], b);
      else rows.push([t, b]);
    }
    return { things, rows };
  };

  /**
   * How far the light stands off a part with no box of its own, on each side: 6 points, or nearer where the strip
   * between the part and the light's edge would take in other words, an icon, or an edge (the light's edge would cut it).
   */
  const roomRound = (c: Side, things: Thing[]): Side => {
    const off: Side = { l: PAD, t: PAD, r: PAD, b: PAD };
    const inPart = (t: Thing) => (t.l + t.r) / 2 > c.l && (t.l + t.r) / 2 < c.r && (t.t + t.b) / 2 > c.t && (t.t + t.b) / 2 < c.b;
    const others = things.filter((t) => !inPart(t));
    for (const k of SIDES) {
      for (let v = PAD; v >= 0; v--) {
        const lit = { l: c.l - (k === 'l' ? v : 0), t: c.t - (k === 't' ? v : 0), r: c.r + (k === 'r' ? v : 0), b: c.b + (k === 'b' ? v : 0) };
        const strip = { l: { ...lit, r: c.l }, t: { ...lit, b: c.t }, r: { ...lit, l: c.r }, b: { ...lit, t: c.b } }[k];
        off[k] = v;
        if (v === 0 || !others.some((t) => meets(t, strip))) break;
      }
    }
    return off;
  };

  const place = () => {
    const parts = lit();
    // A part gone from the screen (a bar that goes once all is uploaded) takes its light with it.
    if (!parts.length) {
      if ((w.__lit ?? []).length && box.style.opacity !== '0') box.style.opacity = '0';
      return;
    }
    const { c, round, boxed, found } = own(parts);
    if (c.r - c.l <= 0) return;
    // What is around the part is looked at again when the part moves, and every quarter second.
    const key = SIDES.map((k) => Math.round(c[k])).join(',');
    if (!w.__clear || w.__clear.key !== key || performance.now() - w.__clear.at > 250) {
      const { things, rows } = look();
      // A count or a mark on the part's corner that shows past its box is lit with it, the light then 6 points round both.
      const g = spill(found, c);
      const grown = SIDES.some((k) => g[k] > 0);
      const room = boxed && !grown ? { l: 0, t: 0, r: 0, b: 0 } : roomRound({ l: c.l - g.l, t: c.t - g.t, r: c.r + g.r, b: c.b + g.b }, things);
      const off: Side = { l: g.l + room.l, t: g.t + room.t, r: g.r + room.r, b: g.b + room.b };
      if (grown) round.fill(0);
      // The light's corners as round as the box's, stood off as far as the light (a card's corner never shows past it).
      const r = (i: number, side: number) => `${Math.round(Math.max(0, round[i]! + side))}px`;
      const corner = [[off.l, off.t], [off.r, off.t], [off.r, off.b], [off.l, off.b]].map(([x, y], i) => `${r(i, x!)} ${r(i, y!)}`);
      w.__clear = { key, at: performance.now(), rows, round: corner.join(','), off };
    }
    const { off, round: corner } = w.__clear;
    const at = { left: `${c.l - off.l}px`, top: `${c.t - off.t}px`, width: `${Math.max(c.r - c.l + off.l + off.r, 0)}px`, height: `${Math.max(c.b - c.t + off.t + off.b, 0)}px` };
    if (box.style.left !== at.left || box.style.top !== at.top || box.style.width !== at.width || box.style.height !== at.height) Object.assign(box.style, at);
    const [tl, tr, br, bl] = corner.split(',');
    if (box.style.borderTopLeftRadius !== tl || box.style.borderTopRightRadius !== tr || box.style.borderBottomRightRadius !== br || box.style.borderBottomLeftRadius !== bl) {
      Object.assign(box.style, { borderTopLeftRadius: tl, borderTopRightRadius: tr, borderBottomRightRadius: br, borderBottomLeftRadius: bl });
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
    // A box that hides what overflows one way is no scroller a finger can move that way: it stays
    // as it was that way (right to left, it would show a part cut off on the left and shift the
    // whole panel). A list that scrolls up and down, and hides what overflows sideways, still
    // scrolls the part into view, so the light and the camera find it on the screen.
    const held = await handle.evaluateHandle((e) => {
      const kept: { box: Element; x?: number; y?: number }[] = [];
      for (let box = e.parentElement; box; box = box.parentElement) {
        const style = getComputedStyle(box);
        const x = /hidden|clip/.test(style.overflowX) ? box.scrollLeft : undefined;
        const y = /hidden|clip/.test(style.overflowY) ? box.scrollTop : undefined;
        if (x !== undefined || y !== undefined) kept.push({ box, x, y });
      }
      return kept;
    });
    await p.scrollIntoViewIfNeeded();
    // On the screen, but the light's place cut off by the list's edge (the row a word is in, under the bar at the foot
    // of the list) or under something floating over the list (a button): to the middle of the list. The light's place
    // is the part and 8 points round it (it stands 6 off a part with no box of its own), so a part that shows whole with
    // that room stays where it is (the Bible's card above the verses lit with it stays in sight).
    await handle.evaluate((e) => {
      const ROOM = 8;
      let scroller = e.parentElement;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      if (!scroller) return;
      const list = scroller;
      const [r, l] = [e.getBoundingClientRect(), list.getBoundingClientRect()];
      const [top, bottom] = [Math.max(l.top, 0), Math.min(l.bottom, innerHeight)];
      const cut = (r.bottom + ROOM > bottom && list.scrollTop + list.clientHeight < list.scrollHeight - 1) || (r.top - ROOM < top && list.scrollTop > 0);
      // Only what draws something there floats over it: the strip a divider is taken by reaches over the list's
      // foot, but draws nothing there.
      const clear = /^(transparent|rgba\(.*,\s*0\))$/;
      const draws = (h: Element) => {
        const s = getComputedStyle(h);
        return !clear.test(s.backgroundColor) || s.boxShadow !== 'none' || !!(h.textContent ?? '').trim() || h instanceof SVGElement || h instanceof HTMLImageElement ||
          ['top', 'right', 'bottom', 'left'].some((k) => parseFloat(s.getPropertyValue(`border-${k}-width`)) > 0 && !clear.test(s.getPropertyValue(`border-${k}-color`)));
      };
      const under = [r.top - ROOM, r.top + r.height / 2, r.bottom + ROOM].some((y) => {
        if (y < top || y > bottom) return false;
        const hit = document.elementFromPoint(r.left + r.width / 2, y);
        return !!hit && !list.contains(hit) && !hit.contains(list) && !hit.closest('[id^="tutorial-"]') && draws(hit);
      });
      if (cut || under) e.scrollIntoView({ block: 'center' });
    });
    await held.evaluate((kept) => {
      for (const k of kept) {
        if (k.x !== undefined) k.box.scrollLeft = k.x;
        if (k.y !== undefined) k.box.scrollTop = k.y;
      }
    });
    await held.dispose();
    return handle;
  }));
}

const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Where the light is on the screen, as it was placed, and where on the screen something shows (as the light last looked). */
function litBox(): { box: Box; rows: [number, number][] } {
  const r = document.getElementById('tutorial-light')!.getBoundingClientRect();
  const rows = (window as unknown as { __clear?: { rows: [number, number][] } }).__clear?.rows ?? [];
  return { box: { x: r.left, y: r.top, width: r.width, height: r.height }, rows };
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
// A phone draws no browser focus outline round the field being typed in (the frame check found one in two films).
await page.addInitScript(() => {
  const add = () => {
    const style = document.createElement('style');
    style.textContent = 'input:focus, textarea:focus, input:focus-visible, textarea:focus-visible { outline: none !important; }';
    document.head.appendChild(style);
  };
  if (document.head) add();
  else document.addEventListener('DOMContentLoaded', add);
});
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
  // A video never opens on a screen still loading (a blank phone): the first step's part shows first.
  const first = tutorial.steps[0]?.first ? undefined : tutorial.steps[0]?.part?.(page);
  if (first) await (Array.isArray(first) ? first : [first])[0]!.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
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
    // 'end': once the recording has played to its end, however long the voice made it.
    const at = step.atSpeech === 'end' ? speech.find((s) => s.file === last.file)!.seconds + 0.3 : step.atSpeech;
    while (now() < last.t + at) await sleep(20);
  }
  if (step.first) await step.first(page);
  const parts = step.part?.(page);
  const target = parts ? (Array.isArray(parts) ? parts[0]! : parts) : null;
  let lit: Box | null = null;
  if (parts) {
    await page.evaluate(light, await handlesOf(parts));
    const t = now();
    await sleep(350);
    // Where the light is once the screen has settled (a list still scrolling the part into view).
    const seen = await page.evaluate(litBox);
    lit = seen.box;
    focus.push({ t, box: lit, rows: seen.rows });
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
