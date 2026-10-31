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
 * that comes and goes over the screen pushes everything down).
 *
 * Where the ring goes (decisions.md 191): around the button or card the lit
 * part is in (the nearest one tapped as one, or drawn with an edge or a fill
 * of its own, up to a third of the screen), or failing that around each box
 * around it in turn, the first it fits without crossing anything, but never
 * one much bigger with other things to tap in it (a list, a bar). On each
 * side the ring stands 6 points off where it can; where that would cross
 * words, an icon or an edge, it stands nearer or further, or right on an edge
 * so the edge is hidden under it (a row inside a card, a field's own border,
 * a tab at the foot of the screen). An edge just outside or just inside the
 * ring would show as a second line beside it, so the ring moves on or off it.
 * A box drawn round the button or card and little bigger, or as tall and not
 * much wider (a field's box round the field and its icon, a row's card round
 * the row and its handle), is lit with it. The ring's corners are as round
 * as the box's, stood off as far as the ring is.
 * Gemini's frame check held nearly every film of 2026-10-31 for a ring
 * through a card, the words beside it, or a tab's name.
 */
function light(els: Node[] | null): void {
  type Side = { l: number; t: number; r: number; b: number };
  /**
   * Something a viewer sees: a line of words or an icon (edge null), or an edge across (h) or up and down (v) of `box`,
   * drawn as a line (a border) or where a fill or a shadow stops.
   */
  type Thing = Side & { edge: 'h' | 'v' | null; box?: Side; line?: boolean };
  type Clear = { key: string; at: number; off: Side; rows: [number, number][]; round: string };
  const w = window as unknown as { __lit?: Node[]; __litLoop?: boolean; __clear?: Clear };
  let el = document.getElementById('tutorial-light');
  w.__lit = els ?? [];
  w.__clear = undefined;
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
  // The ring is 7 points wide outside the box. The box stands 6 points off the lit part where it can, at most 16, and
  // at most 7 in on the part (the ring then lies on the part's own edge). A border nearer than 14 points beside the
  // ring, outside it or in, reads as a second ring; where a fill stops, 8 points outside and 3 in. Words outside it
  // stay 2 points clear (touching, they read as cut).
  const RING = 7;
  const PAD = 6;
  const OFF = 16;
  const NEAR = 8;
  const NEAR_LINE = 14;
  const CLEAR = 2;
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
    ['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'option'].includes(a.getAttribute('role') ?? '') ||
    (a.getAttribute('tabindex') ?? '-1') !== '-1';
  const lit = () => (w.__lit ?? []).filter((e): e is Element => e.isConnected && e instanceof Element);

  /** How round each corner of `e` is (top left, top right, bottom right, bottom left), no more than half its size. */
  const corners = (e: Element): number[] => {
    const s = getComputedStyle(e);
    const d = e.getBoundingClientRect();
    return ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((k) => Math.min(parseFloat(s.getPropertyValue(`border-${k}-radius`)) || 0, d.width / 2, d.height / 2));
  };
  /**
   * The boxes to try the ring around, smallest first: the button or card each lit part is in, then each box around
   * them; each with how round its corners are (the one box's, the least round of several), and how many other things
   * to tap are in it (the lit part's own aside).
   */
  const tries = (parts: Element[]): { c: Side; round: number[]; crowd: () => number }[] => {
    const own = parts.map((e) => {
      let found: Element | undefined;
      for (let a: Element | null = e; a && a !== document.body; a = a.parentElement) {
        const o = of(a.getBoundingClientRect());
        if (area(o) > screen / 3) break;
        if (found) {
          // A box drawn round it that is little bigger, or as tall and not much wider (a field's box round the field
          // and its icon, a row's card round the row and its handle), is lit with it; never one with another button
          // that has words (the bar at the foot of a screen round Skip and Next question), nor one from one side of the
          // screen to the other (the bar round the main button: its ring would run along the screen's edges).
          if (o.l <= 1 && o.r >= innerWidth - 1) break;
          const f = of(found.getBoundingClientRect());
          const tall = o.t >= f.t - 24 && o.b <= f.b + 24;
          if (!(tall && ((o.l >= f.l - 24 && o.r <= f.r + 24) || f.r - f.l >= 0.6 * (o.r - o.l)))) break;
          const inside = found;
          if ([...a.querySelectorAll('*')].some((x) => control(x) && !inside.contains(x) && !x.contains(inside) && !!(x.textContent ?? '').trim() && x.getBoundingClientRect().width > 0)) break;
          if (drawn(a, getComputedStyle(a))) found = a;
        } else if (control(a) || drawn(a, getComputedStyle(a))) found = a;
      }
      return found ?? e;
    });
    const roundOf = (all: Element[]) => [0, 1, 2, 3].map((i) => Math.min(...all.map((e) => corners(e)[i]!)));
    // The middle of each other button, link, field, tab or switch on the screen (found only when the ring is placed
    // again, not every frame).
    const mine = [...own, ...parts];
    let others: { x: number; y: number }[] | undefined;
    const crowdOf = (c: Side) => () => (others ??= [...document.body.querySelectorAll('*')]
      .filter((e) => control(e) && !e.closest('[id^="tutorial-"]') && !mine.some((m) => m.contains(e) || e.contains(m)))
      .map((e) => of(e.getBoundingClientRect()))
      .filter((d) => d.r - d.l >= 4 && d.b - d.t >= 4)
      .map((d) => ({ x: (d.l + d.r) / 2, y: (d.t + d.b) / 2 }))).filter((p) => p.x > c.l && p.x < c.r && p.y > c.t && p.y < c.b).length;
    const first = join(own.map((e) => of(e.getBoundingClientRect())));
    const out = [{ c: first, round: roundOf(own), crowd: crowdOf(first) }];
    // Each part's box one level out, together (two rows of a list: the rows' cards, then the list), and so on out.
    for (let level = own; ;) {
      level = [...new Set(level.map((e) => e.parentElement!))];
      if (level.some((e) => !e || e === document.body)) break;
      const o = join([...level.map((e) => of(e.getBoundingClientRect())), out[0]!.c]);
      if (area(o) > screen / 2) break;
      const last = out.at(-1)!.c;
      if (SIDES.some((k) => Math.abs(o[k] - last[k]) >= 1)) out.push({ c: o, round: roundOf(level), crowd: crowdOf(o) });
    }
    return out;
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
    const add = (e: Element, clip: Side, d: Side, edge: Thing['edge'], box?: Side, line?: boolean) => {
      const s = cut(d, clip);
      if (s.r - s.l < 0.5 || s.b - s.t < 0.5) return;
      if (!edge && !seen(e, (s.l + s.r) / 2, (s.t + s.b) / 2)) return;
      things.push({ ...s, edge, box, line });
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
      if (tag === 'input' || tag === 'textarea') {
        // A field's words, as wide as they are and a line high in the middle of a field of one line (a field's box
        // is often taller than its words, with room for the ring inside it).
        const px = (p: string) => parseFloat(s.getPropertyValue(p)) || 0;
        const text = (e as HTMLInputElement).value || (e as HTMLInputElement).placeholder;
        if (text) {
          const inner = { l: d.l + px('padding-left') + px('border-left-width'), t: d.t + px('padding-top') + px('border-top-width'), r: d.r - px('padding-right') - px('border-right-width'), b: d.b - px('padding-bottom') - px('border-bottom-width') };
          if (tag === 'input') {
            const pen = (look as unknown as { pen?: CanvasRenderingContext2D }).pen ??= document.createElement('canvas').getContext('2d')!;
            pen.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
            const shown = (e as HTMLInputElement).type === 'password' && (e as HTMLInputElement).value ? '\u2022'.repeat(text.length) : text;
            const wide = Math.min(pen.measureText(shown).width, inner.r - inner.l);
            const high = (parseFloat(s.lineHeight) || px('font-size') * 1.3) / 2;
            const mid = (inner.t + inner.b) / 2;
            const rtl = s.direction === 'rtl' || s.textAlign === 'right' || s.textAlign === 'end';
            add(e, clip, { l: rtl ? inner.r - wide : inner.l, t: Math.max(inner.t, mid - high), r: rtl ? inner.r : inner.l + wide, b: Math.min(inner.b, mid + high) }, null);
          } else add(e, clip, inner, null);
        }
      }
      if (area(d) >= screen / 2 || d.r - d.l < 4 || d.b - d.t < 4 || !drawn(e, s)) continue;
      filled.push(d);
      // Each edge that shows (a point just inside it is the box or in it): a side with a border, as thick as it, or
      // every side of a box with a fill or a shadow of its own, one point thick.
      const solid = s.boxShadow !== 'none' || (!clear.test(s.backgroundColor) && s.backgroundColor !== fillUnder(e.parentElement));
      const width = (side: string) => {
        const bw = parseFloat(s.getPropertyValue(`border-${side}-width`)) || 0;
        return bw > 0 && !clear.test(s.getPropertyValue(`border-${side}-color`)) ? Math.max(bw, 1) : solid ? 1 : 0;
      };
      const [mx, my] = [(d.l + d.r) / 2, (d.t + d.b) / 2];
      const [wt, wb, wl, wr] = [width('top'), width('bottom'), width('left'), width('right')];
      const line = edged(s);
      if (wt && seen(e, mx, d.t + 1.5)) add(e, clip, { l: d.l, t: d.t, r: d.r, b: d.t + wt }, 'h', d, line);
      if (wb && seen(e, mx, d.b - 1.5)) add(e, clip, { l: d.l, t: d.b - wb, r: d.r, b: d.b }, 'h', d, line);
      if (wl && seen(e, d.l + 1.5, my)) add(e, clip, { l: d.l, t: d.t, r: d.l + wl, b: d.b }, 'v', d, line);
      if (wr && seen(e, d.r - 1.5, my)) add(e, clip, { l: d.r - wr, t: d.t, r: d.r, b: d.b }, 'v', d, line);
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
   * The ring around `c`, as how far it stands off each side (in on the part when below 0), and what it would cross on
   * each side: `bad` counts words, icons and edges it crosses or goes round with the part (twice: where it must touch
   * something, it stays beside it rather than across it), and edges left just beside it; `worse` a side off the screen.
   */
  const fit = (c: Side, things: Thing[]): { off: Side; bad: number; worse: number } => {
    const reach = OFF + RING + NEAR_LINE;
    const near = things.filter((t) => meets(t, { l: c.l - reach, t: c.t - reach, r: c.r + reach, b: c.b + reach }));
    const off: Side = { l: PAD, t: PAD, r: PAD, b: PAD };
    const judge = (k: (typeof SIDES)[number]): [number, number] => {
      const i = { l: c.l - off.l, t: c.t - off.t, r: c.r + off.r, b: c.b + off.b };
      const o = { l: i.l - RING, t: i.t - RING, r: i.r + RING, b: i.b + RING };
      const band = { l: { ...o, r: i.l }, t: { ...o, b: i.t }, r: { ...o, l: i.r }, b: { ...o, t: i.b } }[k];
      const gap = { l: { ...i, r: c.l }, t: { ...i, b: c.t }, r: { ...i, l: c.r }, b: { ...i, t: c.b } }[k];
      const across = k === 't' || k === 'b';
      let bad = 0;
      for (const t of near) {
        if (!t.edge) {
          const out = { ...band, [k]: band[k] + (k === 'l' || k === 't' ? -CLEAR : CLEAR) };
          if (meets(t, out)) bad += 2;
          // Words or an icon between the part and the ring: the ring would go round them as well (a heading above a card).
          else if (meets(t, gap) && !((t.l + t.r) / 2 > c.l && (t.l + t.r) / 2 < c.r && (t.t + t.b) / 2 > c.t && (t.t + t.b) / 2 < c.b)) bad += 2;
          continue;
        }
        if ((t.edge === 'h') === across) {
          // An edge along this side: under the ring, or clear of it.
          const [lo, hi, bLo, bHi] = across ? [t.t, t.b, band.t, band.b] : [t.l, t.r, band.l, band.r];
          const along = across ? Math.min(t.r, band.r) - Math.max(t.l, band.l) : Math.min(t.b, band.b) - Math.max(t.t, band.t);
          if (along <= 2) continue;
          // Hidden under the ring: only the lit part's own edge (or the line it shares with the row beside it), or the
          // edge of a box the ring goes into (its card's), not that of a box apart beside it, lost into the ring.
          const own = Math.min(Math.abs(lo - c[k]), Math.abs(hi - c[k])) <= 2;
          const into = !!t.box && Math.min(t.box.r, i.r) - Math.max(t.box.l, i.l) >= 4 && Math.min(t.box.b, i.b) - Math.max(t.box.t, i.t) >= 4;
          if ((own || into) && lo >= bLo - 0.5 && hi <= bHi + 0.5) continue;
          if (hi > bLo && lo < bHi) { bad += 2; continue; }
          // Beside the ring: outside it (the band's outer edge), or just inside (its inner edge).
          const [outer, inner] = { l: [band.l, band.r], t: [band.t, band.b], r: [band.r, band.l], b: [band.b, band.t] }[k] as [number, number];
          const outward = k === 'l' || k === 't' ? -1 : 1;
          const gapOut = outward < 0 ? outer - hi : lo - outer;
          const gapIn = outward < 0 ? lo - inner : inner - hi;
          const [nearOut, nearIn] = t.line ? [NEAR_LINE, NEAR_LINE] : [NEAR, 3];
          if ((gapOut >= 0 && gapOut < nearOut) || (gapIn >= 0 && gapIn < nearIn)) bad++;
        } else {
          // An edge across this side goes through the ring, unless it stops under it (a line ending at a card's edge).
          if (across ? t.l <= i.l || t.r >= i.r : t.t <= i.t || t.b >= i.b) continue;
          const [lo, hi, bLo, bHi] = across ? [t.t, t.b, band.t, band.b] : [t.l, t.r, band.l, band.r];
          if (lo < bLo && hi > bHi) bad += 2;
        }
      }
      const outside = (k === 'l' && o.l < 0) || (k === 't' && o.t < 0) || (k === 'r' && o.r > innerWidth) || (k === 'b' && o.b > innerHeight);
      return [bad, outside ? 2 : 0];
    };
    // Each side in turn takes the place where the ring as a whole crosses least (where one side stands decides whether
    // an edge goes through another), nearest 6 points off; three times round.
    const total = (): [number, number] => SIDES.map((k) => judge(k)).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
    for (let round = 0; round < 3; round++) {
      for (const k of SIDES) {
        let best = { v: off[k], s: [Infinity, Infinity, Infinity] };
        for (let v = -RING; v <= OFF; v++) {
          off[k] = v;
          const [bad, worse] = total();
          // Nearest 6 points off, rather in (onto the part's own edge) than far out.
          const s = [bad, worse, v <= PAD ? PAD - v : 2 * (v - PAD) + 0.5];
          if (s[0]! < best.s[0]! || (s[0] === best.s[0] && (s[1]! < best.s[1]! || (s[1] === best.s[1] && s[2]! < best.s[2]!)))) best = { v, s };
        }
        off[k] = best.v;
      }
    }
    // Opposite sides as far off each other where that crosses nothing more (a ring tight on one side and wide on the
    // other reads as cutting into the part on the tight side), nearest 6 points off.
    for (const [a, z] of [['l', 'r'], ['t', 'b']] as const) {
      if (Math.abs(off[a] - off[z]) <= 4) continue;
      const [was, keep] = [{ a: off[a], z: off[z] }, total()];
      let best: { v: number; d: number } | undefined;
      for (let v = -RING; v <= OFF; v++) {
        [off[a], off[z]] = [v, v];
        const [bad, worse] = total();
        const d = v <= PAD ? PAD - v : 2 * (v - PAD) + 0.5;
        if (bad <= keep[0] && worse <= keep[1] && (!best || d < best.d)) best = { v, d };
      }
      [off[a], off[z]] = best ? [best.v, best.v] : [was.a, was.z];
    }
    const judged = SIDES.map((k) => judge(k));
    return { off, bad: judged.reduce((n, [b]) => n + b, 0), worse: judged.reduce((n, [, x]) => n + x, 0) };
  };

  const place = () => {
    const parts = lit();
    // A part gone from the screen (a bar that goes once all is uploaded) takes its ring with it.
    if (!parts.length) {
      if ((w.__lit ?? []).length && box.style.opacity !== '0') box.style.opacity = '0';
      return;
    }
    const all = tries(parts);
    const first = all[0]!.c;
    if (first.r - first.l <= 0) return;
    // What is around the part is looked at again when the part moves, and every quarter second.
    const key = SIDES.map((k) => Math.round(first[k])).join(',');
    if (!w.__clear || w.__clear.key !== key || performance.now() - w.__clear.at > 250) {
      const { things, rows } = look();
      // The first box the ring fits around without crossing anything; failing that, the one where it crosses least.
      let chosen: { c: Side; round: number[]; off: Side; bad: number; worse: number } | undefined;
      for (const { c, round, crowd } of all) {
        // Never a box much bigger than the part with other things to tap in it: a ring round the list, the bar or both
        // buttons is round the wrong thing (round a link and the sentence it ends, it is not).
        if (c !== first && area(c) > 1.6 * area(first) && crowd() > all[0]!.crowd()) break;
        const f = { c, round, ...fit(c, things) };
        if (!chosen || f.bad < chosen.bad || (f.bad === chosen.bad && f.worse < chosen.worse)) chosen = f;
        if (!f.bad) break;
      }
      const { c, off, round } = chosen!;
      // Kept as how far the ring stands off the first box tried, so it follows the part as it moves until looked at again.
      // The ring's corners as round as the box's, stood off as far as the ring (a card's corner never shows past it).
      const r = (i: number, side: number) => `${Math.round(Math.max(0, round[i]! + side))}px`;
      const corner = [[off.l, off.t], [off.r, off.t], [off.r, off.b], [off.l, off.b]].map(([x, y], i) => `${r(i, x!)} ${r(i, y!)}`);
      w.__clear = {
        key, at: performance.now(), rows, round: corner.join(','),
        off: { l: first.l - (c.l - off.l), t: first.t - (c.t - off.t), r: c.r + off.r - first.r, b: c.b + off.b - first.b }
      };
    }
    const { off, round } = w.__clear;
    const at = { left: `${first.l - off.l}px`, top: `${first.t - off.t}px`, width: `${Math.max(first.r - first.l + off.l + off.r, 0)}px`, height: `${Math.max(first.b - first.t + off.t + off.b, 0)}px` };
    if (box.style.left !== at.left || box.style.top !== at.top || box.style.width !== at.width || box.style.height !== at.height) Object.assign(box.style, at);
    const [tl, tr, br, bl] = round.split(',');
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
    // On the screen, but its ring's place cut off by the list's edge (the row a word is in, under the bar at the foot
    // of the list) or under something floating over the list (a button): to the middle of the list.
    await handle.evaluate((e) => {
      let scroller = e.parentElement;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      if (!scroller) return;
      const list = scroller;
      const [r, l] = [e.getBoundingClientRect(), list.getBoundingClientRect()];
      const [top, bottom] = [Math.max(l.top, 0), Math.min(l.bottom, innerHeight)];
      const cut = (r.bottom + 24 > bottom && list.scrollTop + list.clientHeight < list.scrollHeight - 1) || (r.top - 24 < top && list.scrollTop > 0);
      const under = [r.top - 24, r.top + r.height / 2, r.bottom + 24].some((y) => {
        if (y < top || y > bottom) return false;
        const hit = document.elementFromPoint(r.left + r.width / 2, y);
        return !!hit && !list.contains(hit) && !hit.contains(list) && !hit.closest('[id^="tutorial-"]');
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
    while (now() < last.t + step.atSpeech) await sleep(20);
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
