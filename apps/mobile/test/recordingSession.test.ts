import { describe, expect, it, vi } from 'vitest';
import { RecordingSession } from '../src/recording/recordingSession';

// The session keeps every frame but tells the waveform at about ten a second;
// a part starting or ending is told at once, with the frames heard so far.
const MS = 46.4;

describe('the recording session (recordingSession.ts)', () => {
  it('tells listeners about about every other frame, and keeps them all', () => {
    const session = new RecordingSession(1, () => undefined);
    const told = vi.fn();
    session.subscribe(told);
    for (let i = 0; i < 100; i++) session.frame(0.1, -50, i * MS);
    expect(told.mock.calls.length).toBeGreaterThan(45);
    expect(told.mock.calls.length).toBeLessThan(55);
    // What is shown trails by at most a frame; a part's start shows everything heard.
    expect(session.snapshot().count).toBeGreaterThanOrEqual(99);
    session.partStart(undefined);
    expect(session.snapshot().count).toBe(100);
    expect(session.snapshot().open?.from).toBe(100);
  });

  it('tells the screen of a part at once, between frames', () => {
    const parts = vi.fn();
    const session = new RecordingSession(1, parts);
    const told = vi.fn();
    session.subscribe(told);
    session.frame(0.1, -50, 0);
    session.frame(0.1, -50, MS);
    const before = told.mock.calls.length;
    session.partStart(undefined);
    expect(told.mock.calls.length).toBe(before + 1);
    expect(parts).toHaveBeenCalledTimes(1);
  });

  it('adds a box with a + and drops a silence with its ×, telling the screen of each (LAN-199)', () => {
    const parts = vi.fn();
    const session = new RecordingSession(1, parts, true);
    let heard = 0;
    const hear = (n: number, db: number) => { for (let i = 0; i < n; i++) session.frame(10 ** (db / 20), -46, ++heard * MS); };
    hear(10, -52);
    for (const from of [10, 52]) {
      session.partStart(undefined);
      hear(26, -20);
      session.partEnd({ chunk: 'c1', fromMs: from * MS, toMs: (from + 26) * MS });
      hear(16, -52);
    }
    session.chunkDone('c1', 'file:///c1.wav', heard * MS);
    parts.mockClear();
    session.dropSilence(0);
    expect(session.snapshot().droppedSilences).toEqual(['0-1']);
    session.add({ chunk: 'c1', from: 78, to: 94 }, 'added');
    expect(session.snapshot().parts.at(-1)).toMatchObject({ id: 'added', from: 78, to: 94, chunk: 'c1' });
    expect(parts).toHaveBeenCalledTimes(2);
  });
});
