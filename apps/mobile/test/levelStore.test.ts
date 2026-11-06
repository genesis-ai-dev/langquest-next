import { beforeEach, describe, expect, it, vi } from 'vitest';

// A play of a recording waits on its copy at even loudness at most READY_MS
// (decision 182, amended 2026-11-04), and the copy it waits for goes ahead
// of the others still waiting (levelTurns.ts).

const made: string[] = [];
const copies = new Map<string, { resolve: () => void }>();

vi.mock('../src/audio/levelCopy', () => ({
  keptCopy: () => null,
  dropCopy: () => undefined,
  makeCopy: (name: string, uri: string) => new Promise((resolve) => {
    made.push(name);
    copies.set(name, { resolve: () => resolve({ sound: { lufs: -30, peakDb: -6, noiseDb: -60, amps: [] }, copy: `copy-of-${uri}` }) });
  })
}));
vi.mock('../src/audio/loudnessStore', () => ({ loadSound: async () => null, rememberSound: () => undefined }));
vi.mock('../src/audio/levelModel', () => ({ needsCopy: () => true }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));

const { playable, READY_MS } = await import('../src/audio/levelStore');
const { inTurn, waitingKeys } = await import('../src/audio/levelTurns');

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const finish = async (name: string) => { await settle(); copies.get(name)!.resolve(); await settle(); };

describe('a play waiting on its copy at even loudness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    made.length = 0;
    copies.clear();
  });

  it('plays the copy when it is ready in time', async () => {
    const file = playable('h-ready', 'file:///h-ready.m4a', READY_MS);
    await finish('h-ready');
    await expect(file).resolves.toBe('copy-of-file:///h-ready.m4a');
  });

  it('plays the recording as it is after READY_MS, and the copy, still made, plays next time', async () => {
    const file = playable('h-slow', 'file:///h-slow.m4a', READY_MS);
    await settle();
    vi.advanceTimersByTime(READY_MS);
    await expect(file).resolves.toBe('file:///h-slow.m4a');
    await finish('h-slow');
    expect(made).toEqual(['h-slow']);
  });

  it('never waits on a recording streamed from the server', async () => {
    await expect(playable('h-net', 'https://example.org/h-net.m4a', READY_MS)).resolves.toBe('https://example.org/h-net.m4a');
    expect(made).toEqual([]);
  });

  it('goes ahead of the copies and measures already waiting', async () => {
    let release!: () => void;
    const busy = inTurn('busy', () => new Promise<void>((resolve) => { release = resolve; }));
    void inTurn('measure:h-row', async () => undefined);
    void playable('h-next', 'file:///h-next.m4a');
    await settle();
    expect(waitingKeys()).toEqual(['measure:h-row', 'h-next']);
    // Its own tap: the next part's copy, already waiting, moves up.
    void playable('h-next', 'file:///h-next.m4a', READY_MS);
    expect(waitingKeys()).toEqual(['h-next', 'measure:h-row']);
    // A part tapped now goes first of all.
    void playable('h-tapped', 'file:///h-tapped.m4a', READY_MS);
    await settle();
    expect(waitingKeys()).toEqual(['h-tapped', 'h-next', 'measure:h-row']);
    release();
    await busy;
    await finish('h-tapped');
    await finish('h-next');
    expect(made).toEqual(['h-tapped', 'h-next']);
    expect(waitingKeys()).toEqual([]);
  });
});
