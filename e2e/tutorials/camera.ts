// Where a tutorial video's camera looks (compose.ts). A phone's screen fills a
// quarter of the page, so its words are small: the camera moves in on the part
// each step lights, as far as the part lets it (ZOOM_MOST at most), and back
// out to the whole page where a step lights nothing, at the start, and at the
// end, with the title beside the phone whenever it is out (titleShows). It
// holds still where it can: a part that already shows in the shot is not
// chased, and a shot that would last under a second is left out. It never films an empty screen: a part with nothing around it
// (a tab under a short page, a button at the foot of an empty one) is shown
// from further out, with what is on the screen above it.
import type { Box } from './tutorial';

/**
 * Where a step looked, from film.ts: the lit part at the moment it was lit (on the screen, in points), or null for the
 * whole screen; and where on the screen something showed then (words, icons, fields, boxes), top to bottom.
 */
export interface Focus { t: number; box: Box | null; rows?: [number, number][] }
/** What the camera shows: a piece of the page as wide as the page's shape allows at this width. */
export interface View { x: number; y: number; width: number }
/** The camera moves to a view, starting at `at` seconds into the video and taking `for` seconds. */
export interface Move { at: number; for: number; to: View }
interface Size { width: number; height: number }

/** How far in the camera goes: the phone's words at about twice their size, with the lines around them still in the shot. */
export const ZOOM_MOST = 2.2;
/** At most this much of the shot's width, and of its height, is the lit part. */
const FILL = { width: 0.85, height: 0.75 };
/** A close shot with a stretch of empty screen this much of its height, or more, is taken from further out. */
const EMPTY = 0.5;
/** A shot taken from further out that would still cut a little off the screen shows it whole instead. */
const NEARLY_WHOLE = 1.25;
/** The camera keeps a little of the page around the screen (the phone's edge), never more. */
const MARGIN = 28;
const MOVE = 0.8;
/** A move starts this long before its part is lit, so the camera is there as the voice starts (film.ts says each line 0.35 s after lighting). */
const LEAD = 0.35;
/** The whole page, with the title, is held this long at the start. */
const OPEN = 1.2;
/** A shot that would last less than this is left out. */
const HOLD = 1;
/** The camera goes back out to the whole page this long before the end (and the title comes back: compose.ts). */
export const CLOSE = 1.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * The shot of one lit part, on a page `page` big with the app's screen at `screen`: as close as the part allows,
 * on its middle, held to the screen and the page. A screen narrower (or shorter) than the shot stays in its middle.
 * Where half the shot's height or more is one stretch of empty screen (nothing in `rows`, on the page), it is taken
 * from further out.
 */
export function shotOf(box: Box | null, page: Size, screen: Box, rows: [number, number][] = []): View {
  if (!box) return { x: 0, y: 0, width: page.width };
  const along = (middle: number, size: number, from: number, length: number, all: number) => {
    const [lo, hi] = [from - MARGIN, from + length + MARGIN];
    const centre = hi - lo <= size ? (lo + hi) / 2 : clamp(middle, lo + size / 2, hi - size / 2);
    return clamp(centre - size / 2, 0, all - size);
  };
  const at = (zoom: number): View => {
    const width = page.width / zoom;
    return {
      x: along(box.x + box.width / 2, width, screen.x, screen.width, page.width),
      y: along(box.y + box.height / 2, page.height / zoom, screen.y, screen.height, page.height),
      width
    };
  };
  /** The longest stretch of the screen in the shot with nothing on it, as a share of the screen in the shot. */
  const emptiest = (view: View) => {
    const [top, bottom] = [Math.max(view.y, screen.y), Math.min(view.y + (view.width * page.height) / page.width, screen.y + screen.height)];
    if (bottom <= top) return 0;
    let [longest, from] = [0, top];
    for (const [a, b] of [...rows].sort((p, q) => p[0] - q[0])) {
      if (b <= from || a >= bottom) continue;
      longest = Math.max(longest, a - from);
      from = Math.max(from, Math.min(b, bottom));
    }
    return Math.max(longest, bottom - from) / (bottom - top);
  };
  let zoom = clamp(Math.min((FILL.width * page.width) / box.width, (FILL.height * page.height) / box.height), 1, ZOOM_MOST);
  let shot = at(zoom);
  while (rows.length && zoom > 1 && emptiest(shot) >= EMPTY) shot = at((zoom = zoom * 0.9 < NEARLY_WHOLE ? 1 : zoom * 0.9));
  return shot;
}

const same = (a: View, b: View) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1;

/** The shot `at` already shows the part well enough: about as close as its own shot, with the part clear of its edges. */
function keeps(at: View, to: View, box: Box, page: Size): boolean {
  const ratio = to.width / at.width;
  if (ratio < 0.8 || ratio > 1.25) return false;
  const height = (at.width * page.height) / page.width;
  const [mx, my] = [0.06 * at.width, 0.06 * height];
  return box.x >= at.x + mx && box.x + box.width <= at.x + at.width - mx && box.y >= at.y + my && box.y + box.height <= at.y + height - my;
}

/** The camera's moves over a video `end` seconds long, from where each step looked (boxes on the page). */
export function cameraPath(focus: Focus[], end: number, page: Size, screen: Box): Move[] {
  const whole = { x: 0, y: 0, width: page.width };
  const moves: Move[] = [];
  let at: View = whole;
  let free = OPEN;
  const held = focus.filter((f, i) => (focus[i + 1]?.t ?? end - CLOSE) - f.t >= HOLD);
  for (const f of held) {
    const to = shotOf(f.box, page, screen, f.rows);
    if (same(at, to) || (f.box && keeps(at, to, f.box, page))) continue;
    const start = Math.max(f.t - LEAD, free);
    if (start + MOVE > end - CLOSE) break;
    moves.push({ at: start, for: MOVE, to });
    [at, free] = [to, start + MOVE];
  }
  if (!same(at, whole)) moves.push({ at: Math.max(end - CLOSE, free), for: MOVE, to: whole });
  return moves;
}

/**
 * When the title beside the phone shows (compose.ts): whenever the camera is out on the whole page, so a whole shot
 * in the middle of a video (a step that lights nothing, a part at the foot of an empty screen) has its title, not an
 * empty page beside the phone. Each stretch fades in as the camera goes out (`from`, over `in` seconds; the first
 * stretch shows from the start) and out as it next goes in (`to`, over half a second; null at the end).
 */
export function titleShows(moves: Move[], page: Size): { from: number; in: number; to: number | null }[] {
  const out = (v: View) => v.width >= page.width - 1;
  const shown: { from: number; in: number; to: number | null }[] = [{ from: 0, in: 0, to: null }];
  for (const m of moves) {
    const last = shown.at(-1)!;
    if (out(m.to) && last.to !== null) shown.push({ from: m.at, in: m.for, to: null });
    else if (!out(m.to) && last.to === null) last.to = m.at;
  }
  return shown;
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * One side of the camera's view as an ffmpeg expression of the time `time` (zoompan's `it`): the whole page's, plus
 * each move's change times its share so far, eased in and out (smoothstep). ld(1) holds the sum, ld(0) a move's share.
 */
export function viewExpression(moves: Move[], side: keyof View, page: Size, time = 'it'): string {
  let from = side === 'width' ? page.width : 0;
  const terms = [`st(1,${n(from)})`];
  for (const m of moves) {
    const by = m.to[side] - from;
    from = m.to[side];
    if (Math.abs(by) < 0.001) continue;
    terms.push(`st(0,clip((${time}-${n(m.at)})/${n(m.for)},0,1))`, `st(1,ld(1)+(${n(by)})*ld(0)*ld(0)*(3-2*ld(0)))`);
  }
  return [...terms, 'ld(1)'].join(';');
}
