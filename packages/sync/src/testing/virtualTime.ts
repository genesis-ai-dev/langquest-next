/**
 * Simulated time for running many devices in one process. Timers wait on
 * this clock, not the real one, so a month offline takes as long as the
 * work done in it. Code under test keeps its real async shape: between two
 * timers every promise chain that is not waiting on a timer runs to the
 * end, so a device's sync proceeds exactly as it would, only its network
 * waits (`sleep`) and its scheduler's timers are simulated.
 *
 * Inject `now`, `setTimeout`, `clearTimeout` and `sleep` wherever the code
 * takes them (SyncClient, SyncScheduler, Diagnostics, `shapeTransport`).
 */
interface Timer {
  at: number;
  seq: number;
  fn: () => void;
  cancelled: boolean;
}

export class VirtualTime {
  private current: number;
  private heap: Timer[] = [];
  private seq = 0;
  /** Errors thrown by timer callbacks; a run should end with none. */
  readonly errors: unknown[] = [];

  constructor(start: number) {
    this.current = start;
  }

  readonly now = (): number => this.current;

  readonly setTimeout = (fn: () => void, ms: number): unknown => {
    const timer: Timer = { at: this.current + Math.max(0, ms || 0), seq: this.seq++, fn, cancelled: false };
    this.push(timer);
    return timer;
  };

  readonly clearTimeout = (handle: unknown): void => {
    if (handle) (handle as Timer).cancelled = true;
  };

  readonly sleep = (ms: number): Promise<void> => new Promise((resolve) => { this.setTimeout(resolve, ms); });

  /** Run every timer due up to `end`, then leave the clock at `end`. */
  async runUntil(end: number): Promise<void> {
    await settle();
    for (;;) {
      const next = this.peek();
      if (!next || next.at > end) break;
      this.current = Math.max(this.current, next.at);
      // One timer at a time, and what it starts runs to its next wait before
      // the next timer fires. Firing every due timer together would let many
      // devices' work interleave, and each device's CPU timing would then
      // include the others'.
      this.pop();
      try {
        next.fn();
      } catch (err) {
        this.errors.push(err);
      }
      await settle();
    }
    if (end > this.current) this.current = end;
  }

  runFor(ms: number): Promise<void> {
    return this.runUntil(this.current + ms);
  }

  // A binary heap ordered by due time, then by when the timer was set.
  private before(a: Timer, b: Timer): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  private peek(): Timer | undefined {
    while (this.heap.length > 0 && this.heap[0]!.cancelled) this.pop();
    return this.heap[0];
  }

  private push(t: Timer): void {
    const h = this.heap;
    h.push(t);
    for (let i = h.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (!this.before(h[i]!, h[parent]!)) break;
      [h[i], h[parent]] = [h[parent]!, h[i]!];
      i = parent;
    }
  }

  private pop(): Timer | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0 && last) {
      h[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.before(h[l]!, h[m]!)) m = l;
        if (r < h.length && this.before(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Let every promise chain that is not waiting on a timer finish: a
 * macrotask runs only after the microtask queue is empty.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
