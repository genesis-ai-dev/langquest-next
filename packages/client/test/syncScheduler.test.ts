import { SyncScheduler } from '../src/syncScheduler';

/**
 * Why each of these matters: the phone must upload a tap's event within
 * moments while online, must not burn battery polling a dead radio, and
 * must never lose a nudge that lands while a sync is already running.
 */
function harness(results: (() => Promise<{ offline: boolean; more?: boolean }>)[] = [], opts: { maxDelayMs?: number; random?: () => number } = {}) {
  const runs: number[] = [];
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const s = new SyncScheduler({
    run: async () => {
      runs.push(now);
      const next = results.shift();
      return next ? next() : { offline: false };
    },
    livePollMs: 300_000,
    pollMs: 60_000,
    offlineBackoffMs: [15_000, 30_000, 60_000],
    debounceMs: 250,
    maxDelayMs: 2_000,
    // 0.5 is unit jitter, so the timings below are exact unless a test injects its own.
    random: () => 0.5,
    ...opts,
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    }
  });
  /** Advance the fake clock, firing timers in order and letting runs settle. */
  async function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > until) break;
      timers.shift();
      now = t.at;
      t.fn();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    now = until;
  }
  return { s, runs, advance, timers };
}

describe('SyncScheduler', () => {
  it('runs at start, then falls back to the long poll while the channel is live', async () => {
    const h = harness();
    h.s.start();
    h.s.connection(true);
    await h.advance(0);
    expect(h.runs).toEqual([0]);
    await h.advance(299_999);
    expect(h.runs).toEqual([0]);
    await h.advance(1);
    expect(h.runs).toEqual([0, 300_000]);
  });

  it('a nudge runs within the debounce window and coalesces bursts', async () => {
    const h = harness();
    h.s.start();
    await h.advance(0);
    h.s.nudge(); h.s.nudge(); h.s.nudge();
    await h.advance(249);
    expect(h.runs).toHaveLength(1);
    await h.advance(1);
    expect(h.runs).toEqual([0, 250]);
  });

  it('a nudge during a run schedules exactly one more run after it', async () => {
    let release!: () => void;
    const h = harness([() => new Promise((r) => { release = () => r({ offline: false }); })]);
    h.s.start();
    await h.advance(0);
    expect(h.runs).toEqual([0]);
    h.s.nudge(); h.s.nudge();
    release();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await h.advance(0);
    expect(h.runs).toEqual([0, 0]);
  });

  it('offline runs back off geometrically and a success resets the wait', async () => {
    const h = harness([
      async () => ({ offline: true }), async () => ({ offline: true }),
      async () => ({ offline: true }), async () => ({ offline: true }),
      async () => ({ offline: false })
    ]);
    h.s.start();
    await h.advance(0);
    await h.advance(15_000);
    await h.advance(30_000);
    await h.advance(60_000);
    await h.advance(60_000);
    expect(h.runs).toEqual([0, 15_000, 45_000, 105_000, 165_000]);
    await h.advance(60_000);
    expect(h.runs.at(-1)).toBe(225_000);
  });

  it('waking (back on screen, or online again) runs now and starts the backoff over', async () => {
    const h = harness([
      async () => ({ offline: true }), async () => ({ offline: true }), async () => ({ offline: true }),
      async () => ({ offline: true })
    ]);
    h.s.start();
    await h.advance(0);
    await h.advance(15_000);
    await h.advance(30_000);
    expect(h.runs).toEqual([0, 15_000, 45_000]);
    // Waiting 60s now; the network came back after 1s.
    await h.advance(1_000);
    h.s.wake();
    await h.advance(0);
    expect(h.runs).toEqual([0, 15_000, 45_000, 46_000]);
    expect(h.s.offlineStreak).toBe(1);
    // That run was offline again, so the backoff starts over at its first step.
    await h.advance(15_000);
    expect(h.runs.at(-1)).toBe(61_000);
  });

  it('the channel coming up runs immediately', async () => {
    const h = harness();
    h.s.start();
    await h.advance(0);
    await h.advance(10_000);
    h.s.connection(true);
    await h.advance(0);
    expect(h.runs).toEqual([0, 10_000]);
  });

  it('stop cancels the pending run', async () => {
    const h = harness();
    h.s.start();
    await h.advance(0);
    h.s.stop();
    await h.advance(600_000);
    expect(h.runs).toEqual([0]);
  });

  it('continuous nudges cannot postpone a run past maxDelayMs', async () => {
    // Why: a busy project pokes every phone on every event. Debounce alone
    // would keep resetting the timer and a translator's own append could sit
    // unsent for as long as the chatter lasts.
    const h = harness();
    h.s.start();
    await h.advance(0);
    for (let i = 0; i < 30; i++) {
      h.s.nudge();
      await h.advance(100);
    }
    expect(h.runs).toEqual([0, 2_000]);
  });

  it('offline backoff is jittered so reconnecting devices spread out', async () => {
    const lo = harness([async () => ({ offline: true })], { random: () => 0 });
    lo.s.start();
    await lo.advance(0);
    await lo.advance(12_000);
    expect(lo.runs).toEqual([0, 12_000]);
    const hi = harness([async () => ({ offline: true })], { random: () => 0.75 });
    hi.s.start();
    await hi.advance(0);
    await hi.advance(16_500);
    expect(hi.runs).toEqual([0, 16_500]);
  });

  it('a run that reports more work is followed by another run at once', async () => {
    // Why: sync is a bounded slice now. A month offline drains as a series of
    // slices, and the scheduler, not the slice, is what keeps them coming.
    const h = harness([async () => ({ offline: false, more: true }), async () => ({ offline: false, more: true }), async () => ({ offline: false })]);
    h.s.start();
    await h.advance(0);
    expect(h.runs).toEqual([0, 0, 0]);
    await h.advance(59_999);
    expect(h.runs).toHaveLength(3);
  });
});
