// A recording session's parts (LAN-82): which bars of the waveform belong
// to which part, as the microphone reports it, and, once recording stops,
// where the person moved a part's edges or dropped it. Each kept part is
// boxed with its number from the moment it starts; its box reaches back as
// far as the part's head does (splitter.ts), so a soft first word visibly
// lands inside it. Sound out of the room that ends up in no part is shown as
// not kept, once nothing can still claim it.
//
// A part is kept in a chunk file with the room around it (chunks.ts): after
// recording stops its edges move within that room, never into another part,
// and leaving the session cuts each part from its chunk where its box is
// (Caleb, 2026-10-16: the boxes as they stand when the session is left are
// the parts; nothing about them is saved). A dropped part's place and number
// stay, and the next part said fills it, as the parts list's bin does
// (LAN-83). Pure: the session store feeds it the module's events.

/** Frames shown before any pinch: about 6 s. */
export const LIVE_BARS = 128;
/** Pinching shows between about 2 s and 30 s; the bars only grow or shrink. */
export const MIN_LIVE_FRAMES = 43;
export const MAX_LIVE_FRAMES = 646;
/** At most this many bars are drawn: zoomed out, each bar is the loudest of the frames it covers. */
export const LIVE_COLUMNS = 128;
/** The waveform is told about frames at most this often (about ten a second, for microphone frames about 46 ms apart). */
export const FRAME_PUBLISH_MS = 90;
/** The shortest a part's box can be dragged to: about a fifth of a second. */
export const MIN_PART_FRAMES = 4;
/** A part's head can reach back this far (splitter.ts maxHeadMs plus its margin); sound newer than this may still be claimed. */
const CLAIM_MS = 3300;
/** Sound counts as out of the room this many dB above the room's quiet level. */
const OUT_OF_ROOM_DB = 3;
/** Until frames arrive, a phone frame is about this long (2048 samples at 44.1 kHz). */
const FRAME_MS_GUESS = 46.4;

export interface LivePart {
  /** Its place among the session's parts; a dropped part's place goes to the next one said. */
  order: number;
  /** First and past-last frame of the session. `to` is null while it is being said. */
  from: number;
  to: number | null;
  /** The recording it becomes when the session is left (its journal entry until then). */
  id?: string;
  /** The chunk it is kept in, and where its box is in that file (ms), once it has ended. */
  chunk?: string;
  fromMs?: number;
  toMs?: number;
  dropped?: boolean;
}

export interface LiveChunk {
  /** The frame of the session where the chunk's file starts. */
  at: number;
  /** The file, and how long it is (ms), once written; null while it is still being written. */
  uri: string | null;
  ms: number | null;
}

export interface LiveState {
  /**
   * Level of each frame heard, dB (-60..0), and the room's quiet level with
   * it (null where the module does not say). Shared between states and
   * written in place at `count`, so a long session costs a number a frame,
   * not a copy of every frame; frames past `count` are not this state's.
   */
  db: number[];
  quiet: (number | null)[];
  /** Frames heard. */
  count: number;
  /** In the order they were said. */
  parts: LivePart[];
  open: LivePart | null;
  chunks: Record<string, LiveChunk>;
  /** The number the session's first part takes in the passage. */
  first: number;
  /** A dropped part's place, which the next part said fills; `insert` is where the parts after it go. */
  hole: number | null;
  insert: number | null;
  /** Frames where recording stopped and carried on: a part never reaches back across one. */
  seams: number[];
  frameMs: number;
  lastAt: number | null;
}

export type LiveBar = { db: number; quiet: number | null; kind: 'kept' | 'open' | 'room' | 'heard' | 'lost' };
export interface LiveBox { index: number; n: number; from: number; to: number; open: boolean }
/** A part as it is cut when the session is left, with the levels its box shows (dB a frame), for its bars. */
export interface KeptPart { id: string | null; chunk: string; uri: string | null; fromMs: number; toMs: number; levels: number[] }

export function liveStart(firstPart: number): LiveState {
  return { db: [], quiet: [], count: 0, parts: [], open: null, chunks: {}, first: firstPart, hole: null, insert: null, seams: [], frameMs: FRAME_MS_GUESS, lastAt: null };
}

const toDb = (energy: number) => Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(energy, 1e-6))));

/** Whether a frame heard at `at` (ms) is due to be shown, `shownAt` being when the last shown one was heard. */
export function framePublishDue(shownAt: number | null, at: number): boolean {
  return shownAt === null || at - shownAt >= FRAME_PUBLISH_MS || at < shownAt;
}

/** One frame from the microphone: its peak energy (0..1), the room's quiet level if known, and when (ms). */
export function liveFrame(s: LiveState, energy: number, quiet: number | undefined, at: number): LiveState {
  // Frame length from the clock, smoothed: phones differ (Android's reads, iOS's taps).
  const gap = s.lastAt === null ? null : at - s.lastAt;
  const frameMs = gap !== null && gap > 5 && gap < 250 ? s.frameMs * 0.9 + gap * 0.1 : s.frameMs;
  s.db[s.count] = toDb(energy);
  s.quiet[s.count] = quiet ?? null;
  return { ...s, count: s.count + 1, frameMs, lastAt: at };
}

/** Recording carries on after a stop (or after the source played): a new stretch starts here. */
export function liveSeam(s: LiveState): LiveState {
  if (s.count === 0 || s.seams[s.seams.length - 1] === s.count) return s;
  return { ...s, seams: [...s.seams, s.count], lastAt: null };
}

/** The place key the next part takes: after everything, or a dropped part's place and then after it. */
function nextOrder(s: LiveState): { order: number; hole: number | null; insert: number | null } {
  if (s.hole !== null) return { order: s.hole, hole: null, insert: s.hole };
  if (s.insert !== null) { const order = s.insert + 1e-4; return { order, hole: null, insert: order }; }
  return { order: s.parts.reduce((m, p) => Math.max(m, p.order), 0) + 1, hole: null, insert: null };
}

/**
 * A part starts. The module says so just before the frame that started it,
 * and `headMs` is how far back its head reaches, that frame included.
 */
export function livePartStart(s: LiveState, headMs: number | undefined): LiveState {
  if (s.open) return s;
  const head = headMs === undefined ? 0 : Math.max(0, Math.round(headMs / s.frameMs) - 1);
  const last = s.parts[s.parts.length - 1];
  const from = Math.max(0, s.count - head, last?.to ?? 0, s.seams[s.seams.length - 1] ?? 0);
  const { order, hole, insert } = nextOrder(s);
  const open: LivePart = { order, from, to: null };
  return { ...s, open, hole, insert, parts: [...s.parts, open] };
}

/**
 * The part ended: kept in `chunk` from `fromMs` to `toMs`, or (null) dropped
 * as a tap or a bump, when its place goes back to being free.
 */
export function livePartEnd(s: LiveState, kept: { id?: string; chunk: string; fromMs: number; toMs: number } | null): LiveState {
  const open = s.open;
  if (!open) return s;
  if (!kept) {
    const back = s.insert === open.order;
    return { ...s, open: null, parts: s.parts.filter((p) => p !== open), ...(back ? { hole: open.order, insert: null } : {}) };
  }
  const known = s.chunks[kept.chunk];
  const at = known ? known.at : open.from - kept.fromMs / s.frameMs;
  const to = Math.min(s.count, Math.max(open.from + 1, Math.round(at + kept.toMs / s.frameMs)));
  const done: LivePart = { ...open, to, chunk: kept.chunk, fromMs: kept.fromMs, toMs: kept.toMs, ...(kept.id ? { id: kept.id } : {}) };
  return {
    ...s, open: null, parts: s.parts.map((p) => (p === open ? done : p)),
    chunks: known ? s.chunks : { ...s.chunks, [kept.chunk]: { at, uri: null, ms: null } }
  };
}

/** A chunk's file is written: its parts can be heard, cut, and their edges moved within it. */
export function liveChunkDone(s: LiveState, chunk: string, uri: string, ms: number): LiveState {
  const c = s.chunks[chunk];
  if (!c) return s;
  return { ...s, chunks: { ...s.chunks, [chunk]: { ...c, uri, ms } } };
}

/** The kept parts and a dropped part's free place, in passage order, with their numbers. */
export function liveNumbered(s: LiveState): { index: number | null; n: number }[] {
  const places: { index: number | null; order: number }[] = [];
  s.parts.forEach((p, index) => { if (!p.dropped) places.push({ index, order: p.order }); });
  if (s.hole !== null) places.push({ index: null, order: s.hole });
  places.sort((a, b) => a.order - b.order);
  return places.map((p, i) => ({ index: p.index, n: s.first + i }));
}

/** The number the part being said has, or the next one will. */
export function liveNext(s: LiveState): number {
  const all = liveNumbered(s);
  if (s.open) return all.find((p) => p.index !== null && s.parts[p.index] === s.open)?.n ?? s.first + all.length;
  return all.find((p) => p.index === null)?.n ?? s.first + all.length;
}

/** How many parts the session keeps so far. */
export function liveKeptCount(s: LiveState): number {
  return s.parts.filter((p) => !p.dropped && p.to !== null).length;
}

/** Where a part's edge may go: within its chunk's room, never into another part. Null until its chunk is written. */
export function liveEdgeRange(s: LiveState, index: number): { lo: number; hi: number } | null {
  const p = s.parts[index];
  const c = p?.chunk ? s.chunks[p.chunk] : undefined;
  if (!p || p.to === null || !c || c.ms === null) return null;
  // The frame clock and the file's milliseconds agree only to a hair: a hair is not a frame.
  let lo = Math.max(0, Math.ceil(c.at - 1e-3));
  let hi = Math.floor(c.at + c.ms / s.frameMs + 1e-3);
  for (const o of s.parts) {
    if (o === p || o.dropped) continue;
    const oTo = o.to ?? s.count;
    if (oTo <= p.from) lo = Math.max(lo, oTo);
    else if (o.from >= p.to) hi = Math.min(hi, o.from);
  }
  return { lo, hi };
}

/** Drag a part's edge to `frame`: it stays within its room and at least MIN_PART_FRAMES long. */
export function liveEdge(s: LiveState, index: number, edge: 'from' | 'to', frame: number): LiveState {
  const p = s.parts[index];
  const range = liveEdgeRange(s, index);
  if (!p || p.to === null || !range || !p.chunk) return s;
  const c = s.chunks[p.chunk]!;
  const f = Math.round(frame);
  const from = edge === 'from' ? Math.max(range.lo, Math.min(p.to - MIN_PART_FRAMES, f)) : p.from;
  const to = edge === 'to' ? Math.min(range.hi, Math.max(p.from + MIN_PART_FRAMES, f)) : p.to;
  if (from === p.from && to === p.to) return s;
  const ms = (frames: number) => Math.max(0, Math.min(c.ms ?? Infinity, (frames - c.at) * s.frameMs));
  const moved: LivePart = { ...p, from, to, fromMs: edge === 'from' ? ms(from) : p.fromMs, toMs: edge === 'to' ? ms(to) : p.toMs };
  return { ...s, parts: s.parts.map((x, i) => (i === index ? moved : x)) };
}

/** Drop a part: its place and number stay, and what is said next fills it. */
export function liveDrop(s: LiveState, index: number): LiveState {
  const p = s.parts[index];
  if (!p || p.dropped || p.to === null) return s;
  return { ...s, parts: s.parts.map((x, i) => (i === index ? { ...x, dropped: true } : x)), hole: p.order, insert: null };
}

/** What leaving the session keeps: each part not dropped, in passage order, as it is cut from its chunk. */
export function liveKept(s: LiveState): KeptPart[] {
  return liveNumbered(s).flatMap(({ index }) => {
    const p = index === null ? undefined : s.parts[index];
    if (!p || !p.chunk || p.fromMs === undefined || p.toMs === undefined) return [];
    return [{ id: p.id ?? null, chunk: p.chunk, uri: s.chunks[p.chunk]?.uri ?? null, fromMs: p.fromMs, toMs: p.toMs,
      levels: s.db.slice(p.from, p.to ?? s.count) }];
  });
}

/** A frame zoom, kept between the nearest and the farthest the pinch allows. */
export function clampFrames(frames: number): number {
  return Math.round(Math.max(MIN_LIVE_FRAMES, Math.min(MAX_LIVE_FRAMES, frames)));
}

const RANK: Record<LiveBar['kind'], number> = { room: 0, heard: 1, lost: 2, kept: 3, open: 4 };

/**
 * The `frames` frames before `end` (now, unless looking back) as bars, oldest
 * first, padded with silence before the session started. Zoomed out past
 * LIVE_COLUMNS frames, a bar covers several frames: the loudest of them, and
 * the strongest kind (a part wins over the room). While recording, sound
 * newer than a head can reach is heard, not yet lost.
 */
export function liveBars(s: LiveState, frames = LIVE_BARS, end = s.count, recording = true): LiveBar[] {
  const now = s.count;
  const first = end - frames;
  const claimFrames = recording ? Math.ceil(CLAIM_MS / s.frameMs) : 0;
  // Which part holds each frame of the window (the earliest said wins), found once for the window, not once per bar.
  const owner: (LivePart | undefined)[] = new Array(Math.max(0, end - first));
  for (const p of s.parts) {
    if (p.dropped) continue;
    const hi = Math.min(p.to ?? now, end), lo = Math.max(p.from, first);
    for (let f = lo; f < hi; f++) owner[f - first] ??= p;
  }
  const one = (f: number): LiveBar => {
    if (f < 0 || f >= now) return { db: -60, quiet: null, kind: 'room' };
    const db = s.db[f]!, quiet = s.quiet[f] ?? null;
    const part = owner[f - first];
    let kind: LiveBar['kind'];
    if (part) kind = part.to === null ? 'open' : 'kept';
    else if (quiet === null || db <= quiet + OUT_OF_ROOM_DB) kind = 'room';
    else kind = now - f > claimFrames ? 'lost' : 'heard';
    return { db, quiet, kind };
  };
  const per = Math.max(1, Math.ceil(frames / LIVE_COLUMNS));
  const bars: LiveBar[] = [];
  for (let f = first; f < end; f += per) {
    let bar = one(f);
    for (let k = 1; k < per && f + k < end; k++) {
      const b = one(f + k);
      bar = { db: Math.max(bar.db, b.db), quiet: bar.quiet === null ? b.quiet : b.quiet === null ? bar.quiet : Math.min(bar.quiet, b.quiet), kind: RANK[b.kind] > RANK[bar.kind] ? b.kind : bar.kind };
    }
    bars.push(bar);
  }
  return bars;
}

/** The parts with a box in the `frames` frames before `end`: where each starts and ends, in frames from the window's start. */
export function liveBoxes(s: LiveState, frames = LIVE_BARS, end = s.count): LiveBox[] {
  const first = end - frames;
  const numbers = new Map(liveNumbered(s).flatMap((p) => (p.index === null ? [] : [[p.index, p.n] as const])));
  return s.parts.flatMap((p, index) => {
    const to = p.to ?? s.count;
    // A part being said shows from the frame it started on, before it is a frame wide.
    if (p.dropped || to <= first || (p.from >= end && p.to !== null)) return [];
    return [{ index, n: numbers.get(index) ?? s.first, from: p.from - first, to: to - first, open: p.to === null }];
  });
}

/** Bar height on a loudness scale (0..1), so a soft voice still shows. */
export function liveHeight(db: number): number {
  return Math.min(1, Math.max(0, (db + 60) / 54));
}
