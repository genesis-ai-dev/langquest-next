import type { BlobRef } from '@langquest-next/core';

/**
 * Derived-work-list transfer worker (PLAN.md section 14). Used for both
 * uploads and downloads; the direction is in `work` and `transfer`.
 *
 * Rules it implements:
 * 1. No persisted queue: `work()` is recomputed on every pass.
 * 3. Grace after success: leave a hash alone for `graceMs`, then re-derive.
 * 4. `trigger()` clears backoff waits; `nudge()` does not.
 * 5. Backoff ladder, never terminal; failure counts survive a trigger.
 * 6. Concurrency, debounce, periodic tick, drain/dirty re-entrancy.
 * 7. Stop while pulling, checked before every file.
 * 8. Offline: report, attempt nothing, keep backoff.
 *
 * Beyond the plan: `isDeferred` (recording in progress) pauses transfers
 * exactly like a pull does, and an optional shared `TransferBudget` bounds
 * the bytes every worker holds in memory at once, so several large files
 * finishing together cannot spike a weak phone.
 */
export interface TransferWorkerOptions {
  work: () => BlobRef[];
  transfer: (ref: BlobRef) => Promise<void>;
  isOnline: () => boolean;
  isPulling: () => boolean;
  /** Something more important is running (recording); attempt nothing, report honestly. */
  isDeferred?: () => boolean;
  /** Shared across workers; `sizeOf` must be given with it. Unknown sizes count as one byte. */
  budget?: TransferBudget;
  sizeOf?: (ref: BlobRef) => number | undefined;
  concurrency: number;
  backoffMs: readonly number[];
  graceMs: number;
  debounceMs: number;
  tickMs: number;
  onChange?: (pending: number) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

interface Attempt {
  failures: number;
  nextAttemptAt: number;
  lastError?: string;
}

export class TransferWorker {
  private attempts = new Map<string, Attempt>();
  private draining = false;
  private dirty = false;
  private debounceId: unknown;
  private tickId: unknown;
  private stopped = false;
  private lastPending = -1;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(private readonly o: TransferWorkerOptions) {
    this.now = o.now ?? (() => Date.now());
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  start(): void {
    this.stopped = false;
    this.scheduleTick();
    this.nudge();
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceId !== undefined) this.clearTimer(this.debounceId);
    if (this.tickId !== undefined) this.clearTimer(this.tickId);
    this.debounceId = undefined;
    this.tickId = undefined;
  }

  /** Retry everything now: clears waits, keeps failure counts. */
  trigger(): void {
    for (const a of this.attempts.values()) a.nextAttemptAt = 0;
    this.requestPass(0);
  }

  /** Ask for a pass without touching backoff or grace. */
  nudge(): void {
    this.requestPass(this.o.debounceMs);
  }

  /** Work outstanding right now, regardless of backoff. Honest even offline. */
  pending(): number {
    return this.o.work().length;
  }

  private scheduleTick(): void {
    if (this.stopped) return;
    this.tickId = this.setTimer(() => {
      this.tickId = undefined;
      this.requestPass(0);
      this.scheduleTick();
    }, this.o.tickMs);
  }

  private requestPass(delay: number): void {
    if (this.stopped) return;
    if (this.debounceId !== undefined) this.clearTimer(this.debounceId);
    this.debounceId = this.setTimer(() => {
      this.debounceId = undefined;
      void this.drain();
    }, delay);
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      this.dirty = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.dirty = false;
        await this.pass();
      } while (this.dirty && !this.stopped);
    } finally {
      this.draining = false;
    }
  }

  private async pass(): Promise<void> {
    const list = this.o.work();
    // Drop attempt records for hashes that got confirmed or disappeared.
    const live = new Set(list.map((r) => r.hash));
    for (const h of [...this.attempts.keys()]) if (!live.has(h)) this.attempts.delete(h);
    this.publish(list.length);

    if (!this.o.isOnline() || this.o.isPulling() || this.o.isDeferred?.()) return;

    const now = this.now();
    const queue = list.filter((r) => (this.attempts.get(r.hash)?.nextAttemptAt ?? 0) <= now);
    let done = 0;

    const worker = async () => {
      for (;;) {
        // Re-check before pulling each file: a pull may have started mid-batch.
        if (this.stopped || !this.o.isOnline() || this.o.isPulling() || this.o.isDeferred?.()) return;
        const ref = queue.shift();
        if (!ref) return;
        const bytes = Math.max(1, this.o.sizeOf?.(ref) ?? 1);
        try {
          if (this.o.budget) await this.o.budget.acquire(bytes);
          try {
            await this.o.transfer(ref);
          } finally {
            this.o.budget?.release(bytes);
          }
          // Success is not completion: only the server's confirmation removes
          // it from work(). Grace prevents hammering while that round-trips.
          this.attempts.set(ref.hash, { failures: 0, nextAttemptAt: this.now() + this.o.graceMs });
          done += 1;
          this.publish(Math.max(0, list.length - done));
        } catch (err) {
          const prev = this.attempts.get(ref.hash) ?? { failures: 0, nextAttemptAt: 0 };
          const failures = prev.failures + 1;
          const wait = this.o.backoffMs[Math.min(failures, this.o.backoffMs.length) - 1] ?? 0;
          this.attempts.set(ref.hash, {
            failures,
            nextAttemptAt: this.now() + wait,
            lastError: err instanceof Error ? err.message : String(err)
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, this.o.concurrency) }, worker));
    // Re-derive at pass end so the published count is exact.
    this.publish(this.o.work().length);
  }

  private publish(pending: number): void {
    if (pending === this.lastPending) return;
    this.lastPending = pending;
    this.o.onChange?.(pending);
  }
}

/**
 * Bytes-in-flight budget shared by every worker on a device. A transfer
 * waits until its bytes fit, except that one transfer always proceeds when
 * nothing else is in flight: a file larger than the budget must still move.
 */
export class TransferBudget {
  private inFlight = 0;
  private waiters: (() => void)[] = [];

  constructor(readonly maxBytes: number) {}

  bytesInFlight(): number {
    return this.inFlight;
  }

  async acquire(bytes: number): Promise<void> {
    while (this.inFlight > 0 && this.inFlight + bytes > this.maxBytes) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inFlight += bytes;
  }

  release(bytes: number): void {
    this.inFlight = Math.max(0, this.inFlight - bytes);
    const woken = this.waiters.splice(0);
    for (const w of woken) w();
  }
}

/** Start conservative (one upload, two downloads); tune on representative devices. */
export const UPLOAD_DEFAULTS = {
  concurrency: 1,
  backoffMs: [30_000, 60_000, 300_000, 1_800_000],
  graceMs: 10 * 60_000,
  debounceMs: 2000,
  tickMs: 60_000
} as const;

export const DOWNLOAD_DEFAULTS = {
  concurrency: 2,
  backoffMs: [30_000, 120_000, 600_000],
  graceMs: 0,
  debounceMs: 500,
  tickMs: 60_000
} as const;

/** Files held in memory across all transfers at once: about two long WAV cards. */
export const DEFAULT_TRANSFER_BUDGET_BYTES = 24 * 1024 * 1024;
