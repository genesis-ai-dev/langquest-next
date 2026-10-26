import { describe, expect, it } from 'vitest';
import {
  clampFrames, FRAME_PUBLISH_MS, framePublishDue, LIVE_BARS, LIVE_COLUMNS, MAX_LIVE_FRAMES, MIN_LIVE_FRAMES, MIN_PART_FRAMES, liveBars, liveBoxes, liveChunkDone, liveDrop, liveEdge,
  liveEdgeRange, liveFrame, liveKept, liveKeptCount, liveNext, livePartEnd, livePartStart, liveSeam, liveStart, type LiveState
} from '../src/recording/livePartsModel';

// A recording session's parts (LAN-82): fed the microphone module's events
// in the order the module sends them (a part's start just before the frame
// that started it, its end with where it is kept in its chunk), one frame
// every 46 ms.
const MS = 46.4;
const e = (db: number) => 10 ** (db / 20);
function feed(s: LiveState, dbs: number[], quiet = -46): LiveState {
  let at = (s.lastAt ?? 0);
  for (const db of dbs) { at += MS; s = liveFrame(s, e(db), quiet, at); }
  return s;
}
const frames = (n: number, db: number) => Array.from({ length: n }, () => db);

/**
 * Say a part: `before` frames of room, `n` of voice, `after` of room, kept in
 * `chunk` with 10 frames of room before its head; the part ends where the
 * module would say so, after the room that follows it.
 */
function say(s: LiveState, chunk: string, n: number, after = 22, before = 10): LiveState {
  s = feed(s, frames(before, -52));
  const from = s.count;
  s = livePartStart(s, MS);
  s = feed(s, frames(n, -20));
  s = feed(s, frames(after, -52));
  const at = s.chunks[chunk]?.at ?? from - 10;
  return livePartEnd(s, { chunk, fromMs: (from - at) * MS, toMs: (from + n + 6 - at) * MS });
}

describe('the live waveform (livePartsModel.ts)', () => {
  it('boxes a part from where its head reaches, numbered from the first part', () => {
    let s = feed(liveStart(3), frames(30, -52));
    s = feed(s, frames(6, -40)); // a soft start, before the part is confirmed
    s = livePartStart(s, 7 * MS); // the head: those six frames and the one that starts it
    s = feed(s, frames(20, -20));
    const box = liveBoxes(s).at(-1)!;
    expect(box).toMatchObject({ n: 3, open: true });
    expect(box.to - box.from).toBe(26);
    expect(liveBars(s).slice(-26).every((b) => b.kind === 'open')).toBe(true);
  });

  it('closes a kept part where its chunk says and counts on; a dropped tap gets no box and no number', () => {
    let s = say(liveStart(1), 'c1', 20);
    expect(liveBoxes(s).at(-1)).toMatchObject({ n: 1, open: false });
    expect(liveBoxes(s).at(-1)!.to - liveBoxes(s).at(-1)!.from).toBe(26);
    s = livePartStart(s, MS);
    s = feed(s, frames(1, -15));
    s = livePartEnd(s, null);
    expect(liveBoxes(s).map((b) => b.n)).toEqual([1]);
    s = livePartStart(s, MS);
    expect(liveBoxes(s).at(-1)).toMatchObject({ n: 2, open: true });
    expect(liveNext(s)).toBe(2);
  });

  it('shows sound out of the room in no part as not kept, once no part can still claim it', () => {
    let s = feed(liveStart(1), frames(30, -52));
    s = feed(s, frames(4, -30)); // heard, never a part
    expect(liveBars(s).slice(-4).every((b) => b.kind === 'heard')).toBe(true);
    s = feed(s, frames(80, -52));
    const kinds = liveBars(s).map((b) => b.kind);
    expect(kinds.filter((k) => k === 'lost')).toHaveLength(4);
  });

  it('keeps every frame of a long session, so it can be looked back over once stopped', () => {
    const s = feed(liveStart(1), frames(2000, -52));
    expect(s.count).toBe(2000);
    expect(liveBars(s)).toHaveLength(LIVE_BARS);
    expect(liveBars(s, LIVE_BARS, 200, false)).toHaveLength(LIVE_BARS);
  });

  it('never starts a box inside the last one, or before recording carried on', () => {
    let s = feed(liveStart(1), frames(10, -52));
    s = livePartStart(s, MS);
    s = feed(s, frames(10, -20));
    s = livePartEnd(s, { chunk: 'c', fromMs: 0, toMs: 10 * MS });
    s = livePartStart(s, 60 * MS);
    const [a, b] = liveBoxes(s);
    expect(b!.from).toBeGreaterThanOrEqual(a!.to);
    let t = feed(liveStart(1), frames(10, -52));
    t = liveSeam(t);
    t = feed(t, frames(3, -20));
    t = livePartStart(t, 60 * MS);
    expect(t.open!.from).toBe(10);
  });

  it('zooms: nearer shows fewer, wider bars; farther keeps the bar count and lets a part win over the room', () => {
    let s = feed(liveStart(1), frames(600, -52));
    s = livePartStart(s, MS);
    s = feed(s, frames(3, -20));
    s = livePartEnd(s, { chunk: 'c', fromMs: 0, toMs: 3 * MS });
    s = feed(s, frames(40, -52));
    expect(liveBars(s, 50)).toHaveLength(50);
    const far = liveBars(s, MAX_LIVE_FRAMES);
    expect(far.length).toBeLessThanOrEqual(LIVE_COLUMNS);
    expect(far.filter((b) => b.kind === 'kept').length).toBeGreaterThanOrEqual(1);
    expect(liveBoxes(s, MAX_LIVE_FRAMES)[0]).toMatchObject({ n: 1, open: false });
    expect(clampFrames(5)).toBe(MIN_LIVE_FRAMES);
    expect(clampFrames(10_000)).toBe(MAX_LIVE_FRAMES);
  });
});

describe('editing a stopped session (livePartsModel.ts)', () => {
  /** Two parts in one chunk, its file written: 10 frames of room, part 1 (20), room (22), part 2 (20), room. */
  function twoParts(): LiveState {
    let s = say(liveStart(1), 'c1', 20);
    s = say(s, 'c1', 20, 22, 0);
    return liveChunkDone(s, 'c1', 'file:///c1.wav', (s.count - s.chunks['c1']!.at) * MS);
  }

  it('moves an edge out into the room, never into the next part, and keeps a part at least a fifth of a second', () => {
    let s = twoParts();
    const [a, b] = s.parts;
    expect(liveEdgeRange(s, 0)).toEqual({ lo: 0, hi: b!.from });
    s = liveEdge(s, 0, 'from', -50);
    expect(s.parts[0]!.from).toBe(0);
    expect(s.parts[0]!.fromMs).toBe(0);
    s = liveEdge(s, 0, 'to', 1000);
    expect(s.parts[0]!.to).toBe(b!.from);
    s = liveEdge(s, 1, 'from', a!.from + 3);
    expect(s.parts[1]!.from).toBe(s.parts[0]!.to);
    s = liveEdge(s, 1, 'to', s.parts[1]!.from);
    expect(s.parts[1]!.to! - s.parts[1]!.from).toBe(MIN_PART_FRAMES);
    // Where the part is cut follows its box.
    expect(s.parts[1]!.toMs! - s.parts[1]!.fromMs!).toBeCloseTo(MIN_PART_FRAMES * MS, 0);
  });

  it('leaves edges alone until the chunk is written', () => {
    const s = say(liveStart(1), 'c1', 20);
    expect(liveEdgeRange(s, 0)).toBeNull();
    expect(liveEdge(s, 0, 'from', 0)).toBe(s);
  });

  it('drops a part: its place and number stay, and the next part said fills it', () => {
    let s = twoParts();
    s = say(s, 'c2', 10, 22, 60);
    s = liveDrop(s, 1);
    expect(liveBoxes(s, s.count).map((b) => b.n)).toEqual([1, 3]);
    expect(liveNext(s)).toBe(2);
    expect(liveKeptCount(s)).toBe(2);
    s = say(s, 'c3', 10, 22, 60);
    expect(liveBoxes(s, s.count).map((b) => [b.index, b.n])).toEqual([[0, 1], [2, 3], [3, 2]]);
    s = say(s, 'c4', 10, 22, 60);
    // Said after the one that filled the place: it follows it, before part 4.
    expect(liveBoxes(s, s.count).find((b) => b.index === 4)!.n).toBe(3);
  });

  it('keeps the parts not dropped, in passage order, as they are cut from their chunks', () => {
    let s = twoParts();
    s = say(s, 'c2', 10, 22, 60);
    s = liveChunkDone(s, 'c2', 'file:///c2.wav', 40 * MS);
    s = liveDrop(s, 0);
    s = say(s, 'c3', 10, 22, 60);
    const kept = liveKept(s);
    expect(kept.map((k) => k.chunk)).toEqual(['c3', 'c1', 'c2']);
    expect(kept[1]).toMatchObject({ uri: 'file:///c1.wav' });
    expect(kept[1]!.toMs - kept[1]!.fromMs).toBeCloseTo(26 * MS, 0);
  });

  it('gives each kept part the levels its box shows, for its bars, and follows a dragged edge', () => {
    let s = twoParts();
    const box = s.parts[0]!;
    const levels = liveKept(s).find((k) => k.fromMs === box.fromMs)!.levels;
    expect(levels).toHaveLength(box.to! - box.from);
    expect(levels.slice(0, 20).every((db) => Math.abs(db + 20) < 0.01)).toBe(true);
    expect(levels.slice(20).every((db) => Math.abs(db + 52) < 0.01)).toBe(true);
    s = liveEdge(s, 0, 'from', box.from - 4);
    const moved = liveKept(s).find((k) => k.toMs === box.toMs)!.levels;
    expect(moved).toHaveLength(box.to! - box.from + 4);
    expect(moved.slice(0, 4).every((db) => Math.abs(db + 52) < 0.01)).toBe(true);
  });

  it('shows a dropped part as not kept', () => {
    let s = twoParts();
    s = liveDrop(s, 0);
    const bars = liveBars(s, s.count, s.count, false);
    expect(bars.slice(10, 30).every((b) => b.kind === 'lost')).toBe(true);
  });

  it('marks each bar by the earliest part that holds its frame, as a search over the parts would', () => {
    let s = say(liveStart(1), 'c1', 20);
    s = say(s, 'c1', 30);
    s = say(s, 'c2', 12);
    s = livePartStart(s, MS);
    s = feed(s, frames(15, -20));
    s = liveDrop(s, 1);
    for (const [n, end] of [[LIVE_BARS, s.count], [100, 120], [LIVE_COLUMNS, 60], [MIN_LIVE_FRAMES, 60]] as const) {
      const bars = liveBars(s, n, end);
      expect(bars).toHaveLength(n);
      bars.forEach((bar, i) => {
        const f = end - n + i;
        const part = s.parts.find((p) => !p.dropped && f >= p.from && (p.to === null || f < p.to));
        const inPart = bar.kind === 'kept' || bar.kind === 'open';
        expect(inPart && f >= 0 && f < s.count ? bar.kind : null).toBe(f >= 0 && f < s.count && part ? (part.to === null ? 'open' : 'kept') : null);
      });
    }
  });

  it('tells the waveform about frames about ten times a second, the first one at once', () => {
    expect(framePublishDue(null, 1000)).toBe(true);
    expect(framePublishDue(1000, 1000 + MS)).toBe(false);
    expect(framePublishDue(1000, 1000 + 2 * MS)).toBe(true);
    expect(framePublishDue(1000, 1000 + FRAME_PUBLISH_MS - 1)).toBe(false);
    // A clock that went back (a restarted stream) does not hold the waveform still.
    expect(framePublishDue(5000, 100)).toBe(true);
    let shown: number | null = null, told = 0;
    for (let at = 0; at < 60_000; at += MS) if (framePublishDue(shown, at)) { shown = at; told++; }
    expect(told / 60).toBeGreaterThan(9);
    expect(told / 60).toBeLessThan(12);
  });
});
