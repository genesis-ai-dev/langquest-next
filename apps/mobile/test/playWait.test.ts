import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Why (LAN-323): a web play waited 4.2 s for sound and only the total was
// kept, so nobody could say whether the server's link, the network or the
// page's own work took the time. Each part is measured on its own.

const env = vi.hoisted(() => ({ waits: [] as { ms: number; parts: Record<string, unknown> }[] }));
vi.mock('../src/diagnostics/diagnostics', () => ({
  diagnostics: { audioWait: (_where: unknown, ms: number, parts: Record<string, unknown>) => env.waits.push({ ms, parts }) }
}));

import { PlayWait } from '../src/audio/playWait';

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const language = { orgId: 'o', languageId: 'l' };

describe('PlayWait', () => {
  beforeEach(() => { vi.useFakeTimers(); env.waits.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('splits a streamed play into link, copy and the player loading the file', async () => {
    const wait = new PlayWait();
    await vi.advanceTimersByTimeAsync(200);
    const link = wait.link(after(900).then(() => 'https://x'));
    await vi.advanceTimersByTimeAsync(900);
    await link;
    const copy = wait.copy(after(100).then(() => 'https://x'));
    await vi.advanceTimersByTimeAsync(100);
    await copy;
    wait.played();
    await vi.advanceTimersByTimeAsync(3000);
    wait.heard(language);
    expect(env.waits).toEqual([{ ms: 4200, parts: { linkMs: 900, copyMs: 100, loadMs: 3000, busyMs: 0, streamed: true } }]);
  });

  it('a file on the device is not streamed', async () => {
    const wait = new PlayWait();
    wait.played();
    await vi.advanceTimersByTimeAsync(300);
    wait.heard(language);
    expect(env.waits[0]!.parts).toMatchObject({ linkMs: 0, loadMs: 300, streamed: false });
  });

  it('measures how long the app held the page', async () => {
    const wait = new PlayWait();
    wait.played();
    await vi.advanceTimersByTimeAsync(150);
    // The page is held: the clock moves, and no timer runs.
    vi.setSystemTime(Date.now() + 2500);
    wait.heard(language);
    expect(env.waits[0]!.parts.busyMs).toBeGreaterThanOrEqual(2400);
  });

  it('a play stopped before sound tallies nothing and stops its timer', () => {
    const wait = new PlayWait();
    wait.end();
    expect(vi.getTimerCount()).toBe(0);
    expect(env.waits).toEqual([]);
  });
});
