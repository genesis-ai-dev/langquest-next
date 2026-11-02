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
//
// With the silence switch on (Caleb, 2026-10-30; decision 194) the silence
// between two parts is boxed too, and leaving the session keeps it as a part
// of its own, in its place between them. A silence box is never edited
// itself: it always fills the room between the two parts beside it, so it
// follows their edges, and it goes when either goes. Only silence the
// module kept whole is boxed: both parts in one chunk, nothing dropped and
// no stop between them, the two side by side in the passage, and at least
// MIN_SILENCE_MS long. While recording, the silence after the last part
// grows until the next is said, when its chunk is still open.
//
// Once stopped (Caleb, 2026-10-30; LAN-199) every box can go: a silence's ×
// drops that silence alone. A box stretches over a dropped neighbour's sound
// as far as its chunk reaches, and never over another box. A + in room no
// box covers adds a box there; an added box is a part like any said, so
// silences are boxed around it too. The room is kept for this
// (ROOM_KEPT_MS): with the switch off, a chunk stays open through a pause
// of up to half a minute.

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
/**
 * With the silence switch off, the microphone keeps the room this long after
 * the last part ended (chunks.ts keepRoom; LAN-199), so the boxes of a pause
 * between parts can be stretched over or added to. A longer pause closes the
 * chunk, so a phone left listening does not write the room for ever.
 */
export const ROOM_KEPT_MS = 30_000;
/** A part's head can reach back this far (splitter.ts maxHeadMs plus its margin); sound newer than this may still be claimed. */
const CLAIM_MS = 3300;
/** Sound counts as out of the room this many dB above the room's quiet level. */
const OUT_OF_ROOM_DB = 3;
/** Until frames arrive, a phone frame is about this long (2048 samples at 44.1 kHz). */
const FRAME_MS_GUESS = 46.4;
/**
 * The shortest silence boxed: half a second, the least that the room is read
 * in (loudnessModel.ts MIN_SLICES), so a silence kept as a part is known as
 * room and plays as recorded (VOICELESS_DB), never turned up like a voice.
 */
export const MIN_SILENCE_MS = 500;

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
  /** In the order they were said, and then added with a + (LAN-199). */
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
  /** The silence switch (decision 194): the silence between parts is boxed too, and kept as parts of its own. */
  silence: boolean;
  /** Silences dropped with their × (LAN-199), by the parts either side (`silenceKey`). */
  droppedSilences: string[];
}

/** The silence between two parts said one after the other (decision 194), in frames of the session. */
export interface LiveSilence {
  /** The part said before it; it sits right after that part in the passage. */
  after: number;
  /** The part said after it, or null while it is still growing. */
  before: number | null;
  from: number;
  to: number;
  /** Still growing: recording goes on and nothing has been said since the last part. */
  open: boolean;
}

export type LiveBar = { db: number; quiet: number | null; kind: 'kept' | 'open' | 'room' | 'heard' | 'lost' };
/** A box on the waveform: a part's (`index` is the part), or with `silence` the silence after part `index`. */
export interface LiveBox { index: number; n: number; from: number; to: number; open: boolean; silence?: boolean }
/** Room kept in a written chunk that no box covers (LAN-199): where a + adds a box, in frames of the session. */
export interface LiveGap { chunk: string; from: number; to: number }
/** A place the session fills in the passage, with its number: a kept part, a dropped part's free place (`index` null), or a silence. */
export interface LivePlace { index: number | null; n: number; silence?: LiveSilence }
/**
 * A part as it is cut when the session is left, with the levels its box
 * shows (dB a frame), for its bars. A silence (decision 194) is cut from the
 * chunk its two parts share, and has no journal entry (`id` null).
 */
export interface KeptPart { id: string | null; chunk: string; uri: string | null; fromMs: number; toMs: number; levels: number[]; silence?: boolean }

export function liveStart(firstPart: number, silence = false): LiveState {
  return { db: [], quiet: [], count: 0, parts: [], open: null, chunks: {}, first: firstPart, hole: null, insert: null, seams: [], frameMs: FRAME_MS_GUESS, lastAt: null, silence, droppedSilences: [] };
}

/** The silence switch flipped (decision 194): every silence between parts is boxed, or none; turning it on boxes the dropped ones again. */
export function liveSilenceSwitch(s: LiveState, on: boolean): LiveState {
  return s.silence === on ? s : { ...s, silence: on, ...(on ? { droppedSilences: [] } : {}) };
}

/**
 * Whether the microphone keeps the room now (chunks.ts keepRoom): always
 * with the silence switch on; off, while a part is said (`endedAgoMs` null)
 * and until ROOM_KEPT_MS after the last one ended.
 */
export function keepRoomNow(silence: boolean, endedAgoMs: number | null): boolean {
  return silence || endedAgoMs === null || endedAgoMs < ROOM_KEPT_MS;
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

/** The kept parts and a dropped part's free place, in passage order. */
function places(s: LiveState): { index: number | null; order: number }[] {
  const out: { index: number | null; order: number }[] = [];
  s.parts.forEach((p, index) => { if (!p.dropped) out.push({ index, order: p.order }); });
  if (s.hole !== null) out.push({ index: null, order: s.hole });
  return out.sort((a, b) => a.order - b.order);
}

/** Whether nothing in the passage sits between places `a` and `b` (orders), `b` after `a`. */
function sideBySide(orders: number[], a: number, b: number): boolean {
  return b > a && !orders.some((o) => o > a && o < b);
}

/** A silence by the parts either side of it, kept when the parts' edges move. */
const silenceKey = (after: number, before: number) => `${after}-${before}`;

/** Where a chunk's file is still being written: what is said next goes into it. */
const chunkOpen = (s: LiveState, chunk: string | undefined) => !!chunk && !!s.chunks[chunk] && s.chunks[chunk]!.ms === null;

/**
 * The silences boxed while the switch is on (decision 194), in the order
 * they were heard. `recording`: the silence after the last part grows while
 * the microphone listens; stopped, nothing grows.
 */
export function liveSilences(s: LiveState, recording = false): LiveSilence[] {
  if (!s.silence) return [];
  const min = Math.ceil(MIN_SILENCE_MS / s.frameMs);
  const orders = places(s).map((p) => p.order);
  // Every part in the order it was said, dropped ones too: a silence never covers a dropped part's sound.
  const heard = s.parts.map((p, index) => ({ p, index })).sort((x, y) => x.p.from - y.p.from);
  const stopBetween = (from: number, to: number) => s.seams.some((f) => f > from && f <= to);
  const out: LiveSilence[] = [];
  for (let k = 0; k + 1 < heard.length; k++) {
    const a = heard[k]!, b = heard[k + 1]!;
    if (a.p.dropped || b.p.dropped || a.p.to === null || !a.p.chunk) continue;
    // Both in one chunk: the part being said goes into the last one's chunk only while it is open.
    if (b.p.to === null ? !chunkOpen(s, a.p.chunk) : b.p.chunk !== a.p.chunk) continue;
    if (b.p.from - a.p.to < min || stopBetween(a.p.to, b.p.from) || !sideBySide(orders, a.p.order, b.p.order)) continue;
    if (b.p.to !== null && s.droppedSilences.includes(silenceKey(a.index, b.index))) continue;
    // Frames and the file's milliseconds agree only to a frame: the cut itself must be long enough too.
    if (a.p.toMs !== undefined && b.p.fromMs !== undefined && b.p.fromMs - a.p.toMs < MIN_SILENCE_MS) continue;
    out.push({ after: a.index, before: b.index, from: a.p.to, to: b.p.from, open: false });
  }
  const last = heard[heard.length - 1];
  if (recording && !s.open && last && !last.p.dropped && last.p.to !== null && last.p.to < s.count
      && chunkOpen(s, last.p.chunk) && !stopBetween(last.p.to, s.count) && sideBySide([...orders, nextOrder(s).order], last.p.order, nextOrder(s).order)) {
    out.push({ after: last.index, before: null, from: last.p.to, to: s.count, open: true });
  }
  return out;
}

/** The kept parts, a dropped part's free place and the silences boxed, in passage order, with their numbers. */
export function liveNumbered(s: LiveState, recording = false): LivePlace[] {
  const silences = new Map(liveSilences(s, recording).map((q) => [q.after, q]));
  const out: LivePlace[] = [];
  for (const p of places(s)) {
    out.push({ index: p.index, n: s.first + out.length });
    const q = p.index === null ? undefined : silences.get(p.index);
    if (q) out.push({ index: null, n: s.first + out.length, silence: q });
  }
  return out;
}

/** The number the part being said has (a growing silence's, while the switch is on), or the next one will. */
export function liveNext(s: LiveState, recording = false): number {
  const all = liveNumbered(s, recording);
  if (s.open) return all.find((p) => p.index !== null && s.parts[p.index] === s.open)?.n ?? s.first + all.length;
  return all.find((p) => p.silence?.open)?.n ?? all.find((p) => p.index === null && !p.silence)?.n ?? s.first + all.length;
}

/** How many parts the session keeps so far, its silences boxed included. */
export function liveKeptCount(s: LiveState): number {
  return s.parts.filter((p) => !p.dropped && p.to !== null).length + liveSilences(s).length;
}

/** The frames a written chunk holds. The frame clock and the file's milliseconds agree only to a hair: a hair is not a frame. */
function chunkFrames(s: LiveState, c: LiveChunk): { lo: number; hi: number } {
  return { lo: Math.max(0, Math.ceil(c.at - 1e-3)), hi: Math.floor(c.at + (c.ms ?? 0) / s.frameMs + 1e-3) };
}

/** Where a part's edge may go: within its chunk's room, over a dropped part's sound too, never into another part. Null until its chunk is written. */
export function liveEdgeRange(s: LiveState, index: number): { lo: number; hi: number } | null {
  const p = s.parts[index];
  const c = p?.chunk ? s.chunks[p.chunk] : undefined;
  if (!p || p.to === null || !c || c.ms === null) return null;
  let { lo, hi } = chunkFrames(s, c);
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

/** Drop the silence after part `after` with its × (LAN-199): the parts either side stay, and the numbers after it close up. */
export function liveDropSilence(s: LiveState, after: number): LiveState {
  const q = liveSilences(s).find((x) => x.after === after && x.before !== null);
  return q ? { ...s, droppedSilences: [...s.droppedSilences, silenceKey(q.after, q.before!)] } : s;
}

/**
 * The room kept but in no box (LAN-199), oldest first: the gaps between the
 * boxes in each written chunk, and before the first and after the last, at
 * least MIN_PART_FRAMES long. Where two chunks hold the same frames, the
 * earlier chunk has them. None while a part is being said.
 */
export function liveGaps(s: LiveState): LiveGap[] {
  if (s.open) return [];
  const taken = s.parts.filter((p) => !p.dropped && p.to !== null).map((p) => ({ from: p.from, to: p.to! })).sort((a, b) => a.from - b.from);
  const chunks = Object.entries(s.chunks).filter(([, c]) => c.ms !== null).sort(([, a], [, b]) => a.at - b.at);
  const out: LiveGap[] = [];
  let before = 0;
  for (const [chunk, c] of chunks) {
    const range = chunkFrames(s, c);
    let at = Math.max(range.lo, before);
    const hi = Math.min(range.hi, s.count);
    for (const p of taken) {
      if (p.to <= at) continue;
      if (p.from >= hi) break;
      if (p.from - at >= MIN_PART_FRAMES) out.push({ chunk, from: at, to: p.from });
      at = Math.max(at, p.to);
    }
    if (hi - at >= MIN_PART_FRAMES) out.push({ chunk, from: at, to: hi });
    before = Math.max(before, hi);
  }
  return out;
}

/**
 * Where a box added at frames `from`..`to` goes in the passage (LAN-199):
 * right after the part before it in time, or, with none, right before the
 * part after it. A dropped part's free place there is filled.
 */
function addedPlace(s: LiveState, from: number, to: number): { order: number; hole: number | null; insert: number | null } {
  const kept = s.parts.filter((p) => !p.dropped && p.to !== null);
  const before = kept.filter((p) => p.to! <= from).sort((a, b) => b.to! - a.to!)[0];
  const after = kept.filter((p) => p.from >= to).sort((a, b) => a.from - b.from)[0];
  const orders = places(s).map((p) => p.order).sort((a, b) => a - b);
  const fill = { order: s.hole!, hole: null, insert: s.insert };
  if (before) {
    const next = orders.find((o) => o > before.order);
    if (next !== undefined && next === s.hole) return fill;
    const order = next === undefined ? before.order + 1 : (before.order + next) / 2;
    // Said parts that were following on from the part before it follow on from it now.
    return { order, hole: s.hole, insert: s.insert === before.order ? order : s.insert };
  }
  if (after) {
    const prev = [...orders].reverse().find((o) => o < after.order);
    if (prev !== undefined && prev === s.hole) return fill;
    return { order: prev === undefined ? after.order - 1 : (prev + after.order) / 2, hole: s.hole, insert: s.insert };
  }
  return s.hole !== null ? fill : { order: nextOrder(s).order, hole: null, insert: s.insert };
}

/**
 * Add a box over frames `from`..`to` of a gap (LAN-199): a part like any
 * said, kept as a voice (the silence switch boxes the room around it), with
 * `id` for the journal. Only where liveGaps still has room for it.
 */
export function liveAdd(s: LiveState, gap: LiveGap, id?: string): LiveState {
  const c = s.chunks[gap.chunk];
  const from = Math.round(gap.from), to = Math.round(gap.to);
  if (!c || c.ms === null || to - from < MIN_PART_FRAMES) return s;
  if (!liveGaps(s).some((g) => g.chunk === gap.chunk && g.from <= from && g.to >= to)) return s;
  const ms = (frames: number) => Math.max(0, Math.min(c.ms!, (frames - c.at) * s.frameMs));
  const { order, hole, insert } = addedPlace(s, from, to);
  const added: LivePart = { order, from, to, chunk: gap.chunk, fromMs: ms(from), toMs: ms(to), ...(id ? { id } : {}) };
  return { ...s, parts: [...s.parts, added], hole, insert };
}

/** Where a box is in its chunk's file: a part's, or a silence's between its two parts (decision 194). Null until it can be cut. */
export function liveClip(s: LiveState, box: Pick<LiveBox, 'index' | 'silence'>): { chunk: string; uri: string | null; fromMs: number; toMs: number; from: number } | null {
  const p = s.parts[box.index];
  if (!p?.chunk) return null;
  const uri = s.chunks[p.chunk]?.uri ?? null;
  if (!box.silence) return p.fromMs === undefined || p.toMs === undefined ? null : { chunk: p.chunk, uri, fromMs: p.fromMs, toMs: p.toMs, from: p.from };
  const q = liveSilences(s).find((x) => x.after === box.index);
  const b = q && q.before !== null ? s.parts[q.before] : undefined;
  if (!q || !b || p.toMs === undefined || b.fromMs === undefined) return null;
  return { chunk: p.chunk, uri, fromMs: p.toMs, toMs: b.fromMs, from: q.from };
}

/** What leaving the session keeps: each part not dropped and each silence boxed, in passage order, as it is cut from its chunk. */
export function liveKept(s: LiveState): KeptPart[] {
  return liveNumbered(s).flatMap(({ index, silence }) => {
    if (silence) {
      const clip = liveClip(s, { index: silence.after, silence: true });
      return clip ? [{ id: null, chunk: clip.chunk, uri: clip.uri, fromMs: clip.fromMs, toMs: clip.toMs, levels: s.db.slice(silence.from, silence.to), silence: true }] : [];
    }
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
  // Sound in a silence box is kept with it (decision 194): heard, never lost.
  const silent: boolean[] = new Array(Math.max(0, end - first));
  for (const q of liveSilences(s, recording)) {
    for (let f = Math.max(q.from, first); f < Math.min(q.to, end); f++) silent[f - first] = true;
  }
  const one = (f: number): LiveBar => {
    if (f < 0 || f >= now) return { db: -60, quiet: null, kind: 'room' };
    const db = s.db[f]!, quiet = s.quiet[f] ?? null;
    const part = owner[f - first];
    let kind: LiveBar['kind'];
    if (part) kind = part.to === null ? 'open' : 'kept';
    else if (quiet === null || db <= quiet + OUT_OF_ROOM_DB) kind = 'room';
    else kind = now - f > claimFrames && !silent[f - first] ? 'lost' : 'heard';
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

/**
 * The parts with a box in the `frames` frames before `end`, and the
 * silences boxed between them (decision 194): where each starts and ends,
 * in frames from the window's start.
 */
export function liveBoxes(s: LiveState, frames = LIVE_BARS, end = s.count, recording = true): LiveBox[] {
  const first = end - frames;
  const all = liveNumbered(s, recording);
  const numbers = new Map(all.flatMap((p) => (p.index === null ? [] : [[p.index, p.n] as const])));
  const parts = s.parts.flatMap((p, index) => {
    const to = p.to ?? s.count;
    // A part being said shows from the frame it started on, before it is a frame wide.
    if (p.dropped || to <= first || (p.from >= end && p.to !== null)) return [];
    return [{ index, n: numbers.get(index) ?? s.first, from: p.from - first, to: to - first, open: p.to === null }];
  });
  const silences = all.flatMap(({ n, silence: q }) => (q && q.to > first && q.from < end
    ? [{ index: q.after, n, from: q.from - first, to: q.to - first, open: q.open, silence: true }] : []));
  return [...parts, ...silences];
}

/** Bar height on a loudness scale (0..1), so a soft voice still shows. */
export function liveHeight(db: number): number {
  return Math.min(1, Math.max(0, (db + 60) / 54));
}
