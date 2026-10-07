/**
 * When to sync. One place decides, so the hooks in apps/mobile do not each
 * grow their own timers:
 *
 * - `nudge()` after a local append or a realtime poke: run soon, coalesced.
 *   A nudge during a run marks it dirty and runs once more when it ends, so
 *   an event appended mid-push is never left waiting for the next poll.
 * - `connection(true)` when the realtime channel comes up: run now, then a
 *   long fallback poll. `connection(false)`: a shorter poll carries on.
 * - `wake()` when the app comes back to the screen or the device says it
 *   is online again: run now and forget the offline backoff, since the
 *   reason for waiting may be gone (a browser also slows timers in a
 *   hidden tab, so a backoff timer may be far behind).
 * - A run that reports offline backs off geometrically, with jitter so a
 *   room full of phones does not reconnect in lockstep; nothing here polls
 *   a dead radio every fifteen seconds. Any success resets the backoff.
 * - A steady stream of nudges (a busy stream) cannot postpone a run
 *   forever: `maxDelayMs` after the first unserved nudge the run happens
 *   regardless of further nudges.
 * - A run that reports `more` (it hit its push or pull budget) is followed
 *   by another run at once, so a backlog drains in bounded slices instead
 *   of one unbounded pass.
 *
 * Timers are injectable so the tests are deterministic.
 */
interface SyncSchedulerOptions {
  run: () => Promise<{ offline: boolean; more?: boolean }>;
  /** Fallback poll while the realtime channel is up. */
  livePollMs?: number;
  /** Poll while the channel is down but the last run answered. */
  pollMs?: number;
  /** Waits after consecutive offline runs; the last value repeats. */
  offlineBackoffMs?: number[];
  /** Coalescing window for nudges. */
  debounceMs?: number;
  /** Upper bound on how long continuous nudges may postpone a run. */
  maxDelayMs?: number;
  /** Random in [0, 1) for backoff jitter; injectable for tests. */
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Monotonic-enough clock for the nudge deadline; injectable for tests. */
  now?: () => number;
}

/** Spread a wait over [0.8, 1.2) of itself. */
function jittered(ms: number, random: number): number {
  return Math.round(ms * (0.8 + 0.4 * random));
}

export class SyncScheduler {
  private readonly o: Required<SyncSchedulerOptions>;
  private timer: unknown = null;
  private running = false;
  private dirty = false;
  private live = false;
  private offlineRuns = 0;
  private stopped = true;
  /** Deadline of the oldest unserved nudge, or null. */
  private nudgeDeadline: number | null = null;

  constructor(opts: SyncSchedulerOptions) {
    this.o = {
      livePollMs: 5 * 60_000,
      pollMs: 60_000,
      offlineBackoffMs: [15_000, 30_000, 60_000, 120_000, 300_000],
      debounceMs: 250,
      maxDelayMs: 2_000,
      random: Math.random,
      now: () => Date.now(),
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
    const now = this.now();
    if (this.nudgeDeadline === null) this.nudgeDeadline = now + this.o.maxDelayMs;
    this.soon(Math.min(this.o.debounceMs, Math.max(0, this.nudgeDeadline - now)));
  }

  connection(connected: boolean): void {
    const was = this.live;
    this.live = connected;
    if (connected && !was) this.soon(0);
    else if (!connected && was && !this.running) this.schedule();
  }

  wake(): void {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.offlineRuns = 0;
    this.soon(0);
  }

  /** Consecutive offline runs so far; the UI reads it as "how long quiet". */
  get offlineStreak(): number {
    return this.offlineRuns;
  }

  private clear(): void {
    if (this.timer !== null) this.o.clearTimeout(this.timer);
    this.timer = null;
  }

  private now(): number {
    return this.o.now();
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
    this.nudgeDeadline = null;
    let more = false;
    try {
      const r = await this.o.run();
      this.offlineRuns = r.offline ? this.offlineRuns + 1 : 0;
      more = !r.offline && !!r.more;
    } catch {
      this.offlineRuns += 1;
    } finally {
      this.running = false;
    }
    if (this.dirty || more) {
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
      ? jittered(backoff[Math.min(this.offlineRuns, backoff.length) - 1] ?? 60_000, this.o.random())
      : this.live ? this.o.livePollMs : this.o.pollMs;
    this.soon(ms);
  }
}
