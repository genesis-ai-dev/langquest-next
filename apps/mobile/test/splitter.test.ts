import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, SAMPLE_RATE } from '../modules/microphone-energy/src/vadCore';
import { SPLIT, Splitter, type SplitAction } from '../modules/microphone-energy/src/splitter';

// Where parts split (LAN-82). Each test feeds frame levels in dB the way the
// microphone does, one 2048-sample frame about every 46 ms, and reads back
// which frames each part holds.
const FRAME_MS = FRAME_SAMPLES / (SAMPLE_RATE / 1000);
const frames = (seconds: number, db: number) => Array.from({ length: Math.round(seconds * 1000 / FRAME_MS) }, () => db);
const energy = (db: number) => 10 ** (db / 20);

interface Kept { from: number; to: number; discarded: boolean }

/**
 * Run levels (dB per frame) through a splitter, with the speech model's score for each frame where
 * given; each part as the frames [from, to) its file holds.
 */
function split(levels: number[], remembered: ConstructorParameters<typeof Splitter>[1] = null, scores?: number[]): { parts: Kept[]; s: Splitter } {
  const s = new Splitter(FRAME_MS, remembered);
  const parts: Kept[] = [];
  let open: number | null = null;
  const take = (a: SplitAction | null, f: number) => {
    if (a?.type === 'start') open = f + 1 - a.headFrames;
    else if (a?.type === 'stop' && open !== null) {
      parts.push({ from: open, to: f + 1 - Math.round(a.trimMs / FRAME_MS), discarded: a.discard });
      open = null;
    }
  };
  levels.forEach((db, f) => take(s.step(energy(db), (f + 1) * FRAME_MS, scores ? scores[f]! : null), f));
  take(s.finish(levels.length * FRAME_MS), levels.length - 1);
  return { parts, s };
}

const ROOM = -52;
const kept = (parts: Kept[]) => parts.filter((p) => !p.discarded);

describe('where parts split (splitter.ts)', () => {
  it('keeps a soft start: the part reaches back to where the voice rose out of the room', () => {
    // 2 s of room, a soft "and..." for 0.5 s at -40 dB, then loud speech.
    const lead = frames(2, ROOM).length;
    const { parts } = split([...frames(2, ROOM), ...frames(0.5, -40), ...frames(2, -20), ...frames(2, ROOM)]);
    expect(kept(parts)).toHaveLength(1);
    expect(kept(parts)[0]!.from).toBeLessThanOrEqual(lead);
  });

  it('keeps the voice falling away at the end, and a little more', () => {
    const until = frames(2, ROOM).length + frames(2, -20).length + frames(0.6, -42).length;
    const { parts } = split([...frames(2, ROOM), ...frames(2, -20), ...frames(0.6, -42), ...frames(2.5, ROOM)]);
    expect(kept(parts)).toHaveLength(1);
    expect(kept(parts)[0]!.to).toBeGreaterThanOrEqual(until + Math.floor(SPLIT.tailMs / FRAME_MS) - 1);
  });

  it('keeps a lone short word but not a tap', () => {
    const word = split([...frames(2, ROOM), ...frames(0.3, -22), ...frames(2, ROOM)]).parts;
    expect(kept(word)).toHaveLength(1);
    const tap = split([...frames(2, ROOM), ...frames(0.05, -15), ...frames(2, ROOM)]).parts;
    expect(kept(tap)).toHaveLength(0);
  });

  it('hears a soft speaker it has never heard before', () => {
    // Speech peaking at -34 dB: today's starting cutoff (-20 dB) never hears it.
    const { parts } = split([...frames(2, ROOM), ...frames(3, -34), ...frames(2, ROOM)]);
    expect(kept(parts)).toHaveLength(1);
  });

  it('ends parts in a noisy room once it has heard the room', () => {
    const FAN = -40;
    const { parts, s } = split([...frames(9, FAN), ...frames(2, -20), ...frames(2, FAN), ...frames(2, -20), ...frames(2, FAN)]);
    expect(kept(parts)).toHaveLength(2);
    expect(s.levels().room).toBeGreaterThan(-42);
  });

  it('never starts a part inside the last one', () => {
    const { parts } = split([...frames(1, ROOM), ...frames(2, -20), ...frames(1.2, ROOM), ...frames(0.4, -38), ...frames(2, -20), ...frames(2, ROOM)]);
    const k = kept(parts);
    expect(k.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < k.length; i++) expect(k[i]!.from).toBeGreaterThanOrEqual(k[i - 1]!.to);
  });

  it('is not fooled by the silence of a microphone starting', () => {
    // Some phones give exact zeros for the first frames: that is not the room.
    const { parts } = split([...frames(0.3, -60), ...frames(2, ROOM), ...frames(2, -20), ...frames(2, ROOM)]);
    expect(kept(parts)).toHaveLength(1);
  });

  it('never lets speech become the room, even when it starts as the microphone opens', () => {
    // The UI tests tap record and speak at once: 0.2 s of exact silence, then 4 s of steady tone.
    const { parts } = split([...frames(0.2, -60), ...frames(4, -7), ...frames(2, -60), ...frames(4, -7), ...frames(2, -60)]);
    expect(kept(parts)).toHaveLength(2);
    expect(kept(parts)[0]!.to - kept(parts)[0]!.from).toBeGreaterThanOrEqual(frames(4, 0).length);
  });

  it('takes lasting exact silence as the room, so a steady sound after it is a part, not the room', () => {
    // The UI tests' microphone: a tone switched on and off over exact silence.
    const { parts, s } = split([...frames(1.5, -60), ...frames(4, -7), ...frames(2, -60), ...frames(4, -7), ...frames(2, -60)]);
    expect(kept(parts)).toHaveLength(2);
    expect(s.levels().room).toBe(-60);
  });

  it('lengthens the pause for someone who pauses long in the middle of what they say', () => {
    const sentence = [...frames(1, -20), ...frames(0.8, ROOM), ...frames(1, -20)];
    const levels = [...frames(2, ROOM)];
    for (let i = 0; i < 6; i++) levels.push(...sentence, ...frames(0.8, ROOM), ...sentence, ...frames(3, ROOM));
    const { s } = split(levels);
    expect(s.levels().pause).toBeGreaterThan(SPLIT.pauseMs);
    expect(s.levels().pause).toBeLessThanOrEqual(SPLIT.maxPauseMs);
  });

  it('remembers the room, the voice and the pause for next time', () => {
    const { s } = split([...frames(2, ROOM), ...frames(2, -20), ...frames(2, ROOM)]);
    const r = s.remember();
    expect(r.room).toBeCloseTo(ROOM, 0);
    expect(r.voice).toBeGreaterThan(-24);
    expect(r.pause).toBe(SPLIT.pauseMs);
  });
});

// With the speech model (decision 135): a part is sound out of the room that is also speech.
// Each stretch below is [seconds, level dB, speech score].
type Stretch = [number, number, number];
function heard(stretches: Stretch[], remembered: ConstructorParameters<typeof Splitter>[1] = null) {
  const levels: number[] = [];
  const scores: number[] = [];
  for (const [seconds, db, score] of stretches) for (const level of frames(seconds, db)) { levels.push(level); scores.push(score); }
  return split(levels, remembered, scores);
}
/** A cafe: chatter and clinks rising and falling between -42 and -28 dB, never speech to the model. */
function cafe(seconds: number): Stretch[] {
  const out: Stretch[] = [];
  for (let t = 0, i = 0; t < seconds; t += 0.25, i++) out.push([0.25, -42 + ((i * 7) % 15), 0.08]);
  return out;
}

describe('where parts split, with the speech model (splitter.ts)', () => {
  it('makes no part of steady noise, however loud', () => {
    // A fan at -30 dB after a quiet room remembered from last time: today that is one long part.
    const { parts } = heard([[12, -30, 0.03]], { room: -55, voice: -22, pause: 1000 });
    expect(kept(parts)).toHaveLength(0);
  });

  it('boxes only the reader in a cafe', () => {
    const { parts } = heard([...cafe(4), [2, -18, 0.95], ...cafe(3), [2, -18, 0.95], ...cafe(3), [2, -18, 0.95], ...cafe(3)]);
    expect(kept(parts)).toHaveLength(3);
    for (const p of kept(parts)) expect((p.to - p.from) * FRAME_MS).toBeLessThan(3200);
  });

  it('trusts the room it hears now over a quieter one remembered', () => {
    const { s } = heard([[1, -34, 0.05]], { room: -55, voice: -22, pause: 1000 });
    expect(s.levels().room).toBeGreaterThan(-36);
  });

  it('never lets someone who reads on without pausing become the room', () => {
    // Over 20 s of reading: syllables at -18 dB, the dips between them at -30, all speech to the model.
    const reading: Stretch[] = [];
    for (let i = 0; i < 100; i++) reading.push([0.15, -18, 0.95], [0.1, -30, 0.9]);
    const readingFrames = reading.reduce((n, [seconds]) => n + frames(seconds, 0).length, 0);
    const { parts } = heard([[2, ROOM, 0.02], ...reading, [3, ROOM, 0.02]]);
    expect(kept(parts)).toHaveLength(1);
    const lead = frames(2, ROOM).length;
    expect(kept(parts)[0]!.from).toBeLessThanOrEqual(lead);
    expect(kept(parts)[0]!.to).toBeGreaterThanOrEqual(lead + readingFrames);
  });

  it('starts at once for a reader who speaks as the microphone opens', () => {
    const { parts } = heard([[3, -20, 0.95], [2, ROOM, 0.02], [2, -20, 0.95], [2, ROOM, 0.02]]);
    expect(kept(parts)).toHaveLength(2);
    expect(kept(parts)[0]!.from).toBe(0);
  });

  it('ends a part when the speech stops, though the noise goes on', () => {
    // A reader stops, and a radio at the same level carries on.
    const { parts } = heard([[2, ROOM, 0.02], [3, -20, 0.95], [6, -20, 0.1], [2, ROOM, 0.02]]);
    expect(kept(parts)).toHaveLength(1);
    const lead = frames(2, ROOM).length;
    expect(kept(parts)[0]!.to).toBeLessThan(lead + frames(3 + 1.5, 0).length);
  });
});
