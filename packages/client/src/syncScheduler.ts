/**
 * When to sync. One place decides, so the hooks in apps/mobile do not each
 * grow their own timers:
 *
 * - `nudge()` after a local append or a realtime poke: run soon, coalesced.
 *   A nudge during a run marks it dirty and runs once more when it ends, so
 *   an event appended mid-push is never left waiting for the next poll.
 * - `connection(true)` when the realtime channel comes up: run now, then a
 *   long fallback poll. `connection(false)`: a shorter poll carries on.
 * - A run that reports offline backs off geometrically; nothing here polls
 *   a dead radio every fifteen seconds. Any success resets the backoff.
 *
 * Timers are injectable so the tests are deterministic.
 */
export interface SyncSchedulerOptions {
  run: () => Promise<{ offline: boolean }>;
  /** Fallback poll while the realtime channel is up. */
  livePollMs?: number;
  /** Poll while the channel is down but the last run answered. */
  pollMs?: number;
  /** Waits after consecutive offline runs; the last value repeats. */
  offlineBackoffMs?: number[];
  /** Coalescing window for nudges. */
  debounceMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export class SyncScheduler {
  private readonly o: Required<SyncSchedulerOptions>;
  private timer: unknown = null;
  private running = false;
  private dirty = false;
  private live = false;
  private offlineRuns = 0;
  private stopped = true;

  constructor(opts: SyncSchedulerOptions) {
    this.o = {
      livePollMs: 5 * 60_000,
      pollMs: 60_000,
      offlineBackoffMs: [15_000, 30_000, 60_000, 120_000, 300_000],
      debounceMs: 250,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...opts
    };
  }

  start(): void {
    this.stopped = false;
    this.soon(0);
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  nudge(): void {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.soon(this.o.debounceMs);
  }

  connection(connected: boolean): void {
    const was = this.live;
    this.live = connected;
    if (connected && !was) this.soon(0);
    else if (!connected && was && !this.running) this.schedule();
  }

  /** Consecutive offline runs so far; the UI reads it as "how long quiet". */
  get offlineStreak(): number {
    return this.offlineRuns;
  }

  private clear(): void {
    if (this.timer !== null) this.o.clearTimeout(this.timer);
    this.timer = null;
  }

  private soon(ms: number): void {
    if (this.stopped) return;
    this.clear();
    this.timer = this.o.setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    try {
      const r = await this.o.run();
      this.offlineRuns = r.offline ? this.offlineRuns + 1 : 0;
    } catch {
      this.offlineRuns += 1;
    } finally {
      this.running = false;
    }
    if (this.dirty) {
      this.dirty = false;
      this.soon(0);
      return;
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    const backoff = this.o.offlineBackoffMs;
    const ms = this.offlineRuns > 0
      ? backoff[Math.min(this.offlineRuns, backoff.length) - 1] ?? 60_000
      : this.live ? this.o.livePollMs : this.o.pollMs;
    this.soon(ms);
  }
}
