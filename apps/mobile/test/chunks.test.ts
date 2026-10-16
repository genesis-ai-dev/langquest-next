import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, SAMPLE_RATE } from '../modules/microphone-energy/src/vadCore';
import { Splitter } from '../modules/microphone-energy/src/splitter';
import { CHUNK, Chunks, ringFrames } from '../modules/microphone-energy/src/chunks';

// What of a session is kept on storage (LAN-82): the room near speech, in
// chunk files, and each part's place in its chunk. Levels in dB per frame,
// one 2048-sample frame about every 46 ms, as in splitter.test.ts.
const FRAME_MS = FRAME_SAMPLES / (SAMPLE_RATE / 1000);
const frames = (seconds: number, db: number) => Array.from({ length: Math.round(seconds * 1000 / FRAME_MS) }, () => db);
const energy = (db: number) => 10 ** (db / 20);
const ROOM = -52;

interface Chunk { at: number; length: number; kept: boolean | null; parts: { from: number; to: number }[] }

/** Run levels through a splitter and the chunks; every chunk as frames of the session (where it starts, how long). */
function keep(levels: number[], stopAt = levels.length): { chunks: Chunk[]; written: number } {
  const s = new Splitter(FRAME_MS, null);
  const c = new Chunks(FRAME_MS, SAMPLE_RATE);
  const chunks: Chunk[] = [];
  let open: Chunk | null = null;
  let written = 0;
  const apply = (actions: ReturnType<Chunks['step']>, f: number) => {
    for (const a of actions) {
      if (a.type === 'open') { open = { at: f + 1 - a.frames, length: a.frames, kept: null, parts: [] }; chunks.push(open); written += a.frames; }
      else if (a.type === 'mark') open!.parts.push({ from: open!.at + a.from / FRAME_SAMPLES, to: open!.at + a.to / FRAME_SAMPLES });
      else { open!.kept = a.keep; open = null; }
    }
  };
  for (let f = 0; f < stopAt; f++) {
    // The module's order: ring, the open chunk's file, the splitter, then the chunks' actions.
    const wasOpen = open !== null;
    if (wasOpen) { open!.length++; written++; }
    apply(c.step(FRAME_SAMPLES, s.step(energy(levels[f]!), (f + 1) * FRAME_MS), (f + 1) * FRAME_MS), f);
  }
  apply(c.stop(), stopAt - 1);
  return { chunks, written };
}

const PAD = Math.round(CHUNK.padMs / FRAME_MS);

describe('what of a session is kept (chunks.ts)', () => {
  it('keeps a part with the room on each side of it', () => {
    const lead = frames(6, ROOM).length;
    const { chunks } = keep([...frames(6, ROOM), ...frames(2, -20), ...frames(6, ROOM)]);
    expect(chunks).toHaveLength(1);
    const [c] = chunks;
    expect(c!.kept).toBe(true);
    expect(c!.parts).toHaveLength(1);
    const part = c!.parts[0]!;
    // The room before the part's head, and after its end, is in the file.
    expect(part.from - c!.at).toBeGreaterThanOrEqual(PAD - 1);
    expect(part.from).toBeLessThanOrEqual(lead);
    expect(c!.at + c!.length - part.to).toBeGreaterThanOrEqual(PAD - 1);
  });

  it('puts parts close together in one chunk, and parts far apart in two', () => {
    const near = keep([...frames(4, ROOM), ...frames(1.5, -20), ...frames(1.5, ROOM), ...frames(1.5, -20), ...frames(5, ROOM)]).chunks;
    expect(near).toHaveLength(1);
    expect(near[0]!.parts).toHaveLength(2);
    const far = keep([...frames(4, ROOM), ...frames(1.5, -20), ...frames(8, ROOM), ...frames(1.5, -20), ...frames(5, ROOM)]).chunks;
    expect(far).toHaveLength(2);
    expect(far.every((c) => c.kept && c.parts.length === 1)).toBe(true);
  });

  it('never writes a long silence', () => {
    const levels = [...frames(30, ROOM), ...frames(2, -20), ...frames(30, ROOM), ...frames(2, -20), ...frames(30, ROOM)];
    const { written } = keep(levels);
    expect(written).toBeLessThan(frames(4 * 2 + 2 + 2 + 3, 0).length);
  });

  it('deletes a chunk that only heard a tap', () => {
    const { chunks } = keep([...frames(4, ROOM), ...frames(0.05, -15), ...frames(4, ROOM)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.kept).toBe(false);
    expect(chunks[0]!.parts).toHaveLength(0);
  });

  it('keeps a part still being said when recording stops, to the end of what was heard', () => {
    const levels = [...frames(4, ROOM), ...frames(3, -20)];
    const { chunks } = keep(levels);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.kept).toBe(true);
    expect(chunks[0]!.parts[0]!.to).toBe(levels.length);
  });

  it('places each part where the splitter put its head', () => {
    const levels = [...frames(3, ROOM), ...frames(0.5, -40), ...frames(2, -20), ...frames(1.2, ROOM), ...frames(2, -22), ...frames(4, ROOM)];
    const s = new Splitter(FRAME_MS, null);
    const heads: number[] = [];
    levels.forEach((db, f) => { const a = s.step(energy(db), (f + 1) * FRAME_MS); if (a?.type === 'start') heads.push(f + 1 - a.headFrames); });
    const parts = keep(levels).chunks.flatMap((c) => c.parts);
    expect(parts.map((p) => p.from)).toEqual(heads);
  });

  it('holds a ring long enough for a part\'s longest head and the room before it', () => {
    expect(ringFrames(FRAME_MS) * FRAME_MS).toBeGreaterThanOrEqual(3000 + 140 + CHUNK.padMs);
  });
});
