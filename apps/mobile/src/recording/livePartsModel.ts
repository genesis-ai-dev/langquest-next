// The live waveform while recording (LAN-82): which bars belong to which
// part, as the microphone reports it. Each kept part is boxed with its number
// from the moment it starts; its box reaches back as far as the part's head
// does (splitter.ts), so a soft first word visibly lands inside it. Sound out
// of the room that ends up in no part is shown as not kept, once nothing can
// still claim it. Pure: the hook feeds it the module's events.

/** Frames shown before any pinch: about 6 s. */
export const LIVE_BARS = 128;
/** Pinching shows between about 2 s and 30 s; the bars only grow or shrink. */
export const MIN_LIVE_FRAMES = 43;
export const MAX_LIVE_FRAMES = 646;
/** At most this many bars are drawn: zoomed out, each bar is the loudest of the frames it covers. */
export const LIVE_COLUMNS = 128;
/** A part's head can reach back this far (splitter.ts maxHeadMs plus its margin); sound newer than this may still be claimed. */
const CLAIM_MS = 3300;
/** Sound counts as out of the room this many dB above the room's quiet level. */
const OUT_OF_ROOM_DB = 3;
/** Until frames arrive, a phone frame is about this long (2048 samples at 44.1 kHz). */
const FRAME_MS_GUESS = 46.4;

export interface LivePart {
  /** The part's number, as the parts list will show it. */
  n: number;
  /** First and past-last frame, counted from the session's start. `to` is null while the part is open. */
  from: number;
  to: number | null;
}

export interface LiveState {
  /** Level of each frame in the window, dB (-60..0). */
  db: number[];
  /** The room's quiet level with each frame, dB; null where the module does not say (main's detector). */
  quiet: (number | null)[];
  /** Frame number of db[0]. */
  base: number;
  parts: LivePart[];
  open: LivePart | null;
  /** The number the next part will get. */
  next: number;
  frameMs: number;
  lastAt: number | null;
}

export type LiveBar = { db: number; quiet: number | null; kind: 'kept' | 'open' | 'room' | 'heard' | 'lost' };

export function liveStart(firstPart: number): LiveState {
  return { db: [], quiet: [], base: 0, parts: [], open: null, next: firstPart, frameMs: FRAME_MS_GUESS, lastAt: null };
}

const toDb = (energy: number) => Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(energy, 1e-6))));
/** Frames kept in memory: the window and the longest reach of a head. */
const keep = (s: LiveState) => MAX_LIVE_FRAMES + Math.ceil(CLAIM_MS / s.frameMs) + 4;

/** One frame from the microphone: its peak energy (0..1), the room's quiet level if known, and when (ms). */
export function liveFrame(s: LiveState, energy: number, quiet: number | undefined, at: number): LiveState {
  // Frame length from the clock, smoothed: phones differ (Android's reads, iOS's taps).
  const gap = s.lastAt === null ? null : at - s.lastAt;
  const frameMs = gap !== null && gap > 5 && gap < 250 ? s.frameMs * 0.9 + gap * 0.1 : s.frameMs;
  let db = [...s.db, toDb(energy)];
  let q = [...s.quiet, quiet ?? null];
  let base = s.base;
  const max = keep({ ...s, frameMs });
  if (db.length > max) {
    const drop = db.length - max;
    db = db.slice(drop); q = q.slice(drop); base += drop;
  }
  const parts = s.parts.filter((p) => p.to === null || p.to > base);
  return { ...s, db, quiet: q, base, parts, frameMs, lastAt: at };
}

/**
 * A part starts. The module says so just before the frame that started it,
 * and `headMs` is how far back its head reaches, that frame included.
 */
export function livePartStart(s: LiveState, headMs: number | undefined): LiveState {
  if (s.open) return s;
  const now = s.base + s.db.length;
  const head = headMs === undefined ? 0 : Math.max(0, Math.round(headMs / s.frameMs) - 1);
  const last = s.parts[s.parts.length - 1];
  const from = Math.max(s.base, now - head, last?.to ?? 0);
  const open: LivePart = { n: s.next, from, to: null };
  return { ...s, open, parts: [...s.parts, open] };
}

/** The part ended: kept with the file's length, or dropped (`durationMs` null) as a tap or a bump. */
export function livePartEnd(s: LiveState, durationMs: number | null): LiveState {
  const open = s.open;
  if (!open) return s;
  if (durationMs === null) return { ...s, open: null, parts: s.parts.filter((p) => p !== open) };
  const now = s.base + s.db.length;
  const to = Math.min(now, Math.max(open.from + 1, open.from + Math.round(durationMs / s.frameMs)));
  const done = { ...open, to };
  return { ...s, open: null, next: open.n + 1, parts: s.parts.map((p) => (p === open ? done : p)) };
}

/** A frame zoom, kept between the nearest and the farthest the pinch allows. */
export function clampFrames(frames: number): number {
  return Math.round(Math.max(MIN_LIVE_FRAMES, Math.min(MAX_LIVE_FRAMES, frames)));
}

const RANK: Record<LiveBar['kind'], number> = { room: 0, heard: 1, lost: 2, kept: 3, open: 4 };

/**
 * The last `frames` frames as bars, oldest first, padded with silence until
 * the window fills. Zoomed out past LIVE_COLUMNS frames, a bar covers several
 * frames: the loudest of them, and the strongest kind (a part wins over the room).
 */
export function liveBars(s: LiveState, frames = LIVE_BARS): LiveBar[] {
  const now = s.base + s.db.length;
  const first = now - frames;
  const claimFrames = Math.ceil(CLAIM_MS / s.frameMs);
  const one = (f: number): LiveBar => {
    const i = f - s.base;
    if (i < 0) return { db: -60, quiet: null, kind: 'room' };
    const db = s.db[i]!, quiet = s.quiet[i] ?? null;
    const part = s.parts.find((p) => f >= p.from && (p.to === null || f < p.to));
    let kind: LiveBar['kind'];
    if (part) kind = part.to === null ? 'open' : 'kept';
    else if (quiet === null || db <= quiet + OUT_OF_ROOM_DB) kind = 'room';
    else kind = now - f > claimFrames ? 'lost' : 'heard';
    return { db, quiet, kind };
  };
  const per = Math.max(1, Math.ceil(frames / LIVE_COLUMNS));
  const bars: LiveBar[] = [];
  for (let f = first; f < now; f += per) {
    let bar = one(f);
    for (let k = 1; k < per && f + k < now; k++) {
      const b = one(f + k);
      bar = { db: Math.max(bar.db, b.db), quiet: bar.quiet === null ? b.quiet : b.quiet === null ? bar.quiet : Math.min(bar.quiet, b.quiet), kind: RANK[b.kind] > RANK[bar.kind] ? b.kind : bar.kind };
    }
    bars.push(bar);
  }
  return bars;
}

/** The parts with a box in the window of `frames` frames: where each starts and ends, in frames from the window's start. */
export function liveBoxes(s: LiveState, frames = LIVE_BARS): { n: number; from: number; to: number; open: boolean }[] {
  const now = s.base + s.db.length;
  const first = now - frames;
  return s.parts
    .filter((p) => (p.to ?? now) > first)
    .map((p) => ({ n: p.n, from: Math.max(0, p.from - first), to: (p.to ?? now) - first, open: p.to === null }));
}

/** Bar height on a loudness scale (0..1), so a soft voice still shows. */
export function liveHeight(db: number): number {
  return Math.min(1, Math.max(0, (db + 60) / 54));
}
