import { describe, expect, it } from 'vitest';
import { LIVE_BARS, liveBars, liveBoxes, liveFrame, livePartEnd, livePartStart, liveStart, type LiveState } from '../src/recording/livePartsModel';

// The live waveform's parts (LAN-82): fed the microphone module's events in
// the order the module sends them (a part's start just before the frame that
// started it), one frame every 46 ms.
const MS = 46.4;
const e = (db: number) => 10 ** (db / 20);
function feed(s: LiveState, dbs: number[], quiet = -46): LiveState {
  let at = (s.lastAt ?? 0);
  for (const db of dbs) { at += MS; s = liveFrame(s, e(db), quiet, at); }
  return s;
}
const frames = (n: number, db: number) => Array.from({ length: n }, () => db);

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

  it('closes a kept part at its file length and counts on; a dropped tap gets no box and no number', () => {
    let s = feed(liveStart(1), frames(30, -52));
    s = livePartStart(s, MS);
    s = feed(s, frames(20, -20));
    s = feed(s, frames(22, -52));
    s = livePartEnd(s, 26 * MS);
    expect(liveBoxes(s).at(-1)).toMatchObject({ n: 1, open: false });
    s = livePartStart(s, MS);
    s = feed(s, frames(1, -15));
    s = livePartEnd(s, null);
    expect(liveBoxes(s).map((b) => b.n)).toEqual([1]);
    s = livePartStart(s, MS);
    expect(liveBoxes(s).at(-1)).toMatchObject({ n: 2, open: true });
  });

  it('shows sound out of the room in no part as not kept, once no part can still claim it', () => {
    let s = feed(liveStart(1), frames(30, -52));
    s = feed(s, frames(4, -30)); // heard, never a part
    expect(liveBars(s).slice(-4).every((b) => b.kind === 'heard')).toBe(true);
    s = feed(s, frames(80, -52));
    const kinds = liveBars(s).map((b) => b.kind);
    expect(kinds.filter((k) => k === 'lost')).toHaveLength(4);
  });

  it('keeps a window of the latest bars', () => {
    const s = feed(liveStart(1), frames(500, -52));
    expect(liveBars(s)).toHaveLength(LIVE_BARS);
    expect(s.db.length).toBeLessThanOrEqual(LIVE_BARS + 80);
  });

  it('never starts a box inside the last one', () => {
    let s = feed(liveStart(1), frames(10, -52));
    s = livePartStart(s, MS);
    s = feed(s, frames(10, -20));
    s = livePartEnd(s, 10 * MS);
    s = livePartStart(s, 60 * MS);
    const [a, b] = liveBoxes(s);
    expect(b!.from).toBeGreaterThanOrEqual(a!.to);
  });
});
