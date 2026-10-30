// Where a tutorial video's camera looks (compose.ts). A phone's screen fills a
// quarter of the page, so its words are small: the camera moves in on the part
// each step lights, as far as the part lets it (ZOOM_MOST at most), and back
// out to the whole page where a step lights nothing, at the start with the
// title, and at the end. It holds still where it can: a part that already
// shows in the shot is not chased, and a shot that would last under a second
// is left out.
import type { Box } from './tutorial';

/** Where a step looked, from film.ts: the lit part at the moment it was lit (on the screen, in points), or null for the whole screen. */
export interface Focus { t: number; box: Box | null }
/** What the camera shows: a piece of the page as wide as the page's shape allows at this width. */
export interface View { x: number; y: number; width: number }
/** The camera moves to a view, starting at `at` seconds into the video and taking `for` seconds. */
export interface Move { at: number; for: number; to: View }
interface Size { width: number; height: number }

/** How far in the camera goes: the phone's words at about twice their size, with the lines around them still in the shot. */
export const ZOOM_MOST = 2.2;
/** At most this much of the shot's width, and of its height, is the lit part. */
const FILL = { width: 0.85, height: 0.75 };
/** The camera keeps a little of the page around the screen (the phone's edge), never more. */
const MARGIN = 28;
const MOVE = 0.8;
/** A move starts this long before its part is lit, so the camera is there as the voice starts (film.ts says each line 0.35 s after lighting). */
const LEAD = 0.35;
/** The whole page, with the title, is held this long at the start. */
const OPEN = 1.2;
/** A shot that would last less than this is left out. */
const HOLD = 1;
/** The camera goes back out to the whole page this long before the end. */
const CLOSE = 1.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * The shot of one lit part, on a page `page` big with the app's screen at `screen`: as close as the part allows,
 * on its middle, held to the screen and the page. A screen narrower (or shorter) than the shot stays in its middle.
 */
export function shotOf(box: Box | null, page: Size, screen: Box): View {
  if (!box) return { x: 0, y: 0, width: page.width };
  const zoom = clamp(Math.min((FILL.width * page.width) / box.width, (FILL.height * page.height) / box.height), 1, ZOOM_MOST);
  const width = page.width / zoom;
  const height = page.height / zoom;
  const along = (middle: number, size: number, from: number, length: number, all: number) => {
    const [lo, hi] = [from - MARGIN, from + length + MARGIN];
    const centre = hi - lo <= size ? (lo + hi) / 2 : clamp(middle, lo + size / 2, hi - size / 2);
    return clamp(centre - size / 2, 0, all - size);
  };
  return {
    x: along(box.x + box.width / 2, width, screen.x, screen.width, page.width),
    y: along(box.y + box.height / 2, height, screen.y, screen.height, page.height),
    width
  };
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
    const to = shotOf(f.box, page, screen);
    if (same(at, to) || (f.box && keeps(at, to, f.box, page))) continue;
    const start = Math.max(f.t - LEAD, free);
    if (start + MOVE > end - CLOSE) break;
    moves.push({ at: start, for: MOVE, to });
    [at, free] = [to, start + MOVE];
  }
  if (!same(at, whole)) moves.push({ at: Math.max(end - CLOSE, free), for: MOVE, to: whole });
  return moves;
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
