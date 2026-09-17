import type { BlobRef } from '@langquest-next/core';
import { DOWNLOAD_DEFAULTS, TransferBudget, TransferWorker, UPLOAD_DEFAULTS } from '../src/transferWorker';

/** Deterministic timers and clock so backoff and grace are testable. */
function harness() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const setTimer = (fn: () => void, ms: number) => {
    const id = nextId++;
    timers.push({ at: now + ms, fn, id });
    return id;
  };
  const clearTimer = (id: unknown) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  /** Advance time, firing due timers in order, and let promises settle. */
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      now = next.at;
      timers.shift();
      next.fn();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    }
    now = target;
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { now: () => now, setTimer, clearTimer, advance };
}

function ref(h: string): BlobRef {
  return { hash: h, format: 'wav', unitId: 'u1' };
}

describe('TransferWorker (PLAN.md section 14)', () => {
  it('derives work every pass and stops listing a hash once the server confirms it', async () => {
    // Why: no persisted queue. Confirmation, not the client, ends the work.
    const h = harness();
    let unconfirmed = ['a', 'b'];
    const sent: string[] = [];
    const w = new TransferWorker({
      ...UPLOAD_DEFAULTS,
      work: () => unconfirmed.map(ref),
      transfer: async (r) => void sent.push(r.hash),
      isOnline: () => true,
      isPulling: () => false,
      ...h
    });
    w.start();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(sent.sort()).toEqual(['a', 'b']);

    // Grace: a second pass right away does not re-send.
    w.nudge();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(sent.length).toBe(2);

    // Confirmation arrives for a; b's grace expires -> only b is re-sent.
    unconfirmed = ['b'];
    await h.advance(UPLOAD_DEFAULTS.graceMs);
    w.nudge();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(sent).toEqual(['a', 'b', 'b']);
    w.stop();
  });

  it('backs off per hash, never terminally; trigger clears waits but keeps counts', async () => {
    const h = harness();
    let fail = true;
    const attempts: string[] = [];
    const w = new TransferWorker({
      ...UPLOAD_DEFAULTS,
      work: () => [ref('x')],
      transfer: async (r) => {
        attempts.push(r.hash);
        if (fail) throw new Error('boom');
      },
      isOnline: () => true,
      isPulling: () => false,
      ...h
    });
    w.start();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(attempts.length).toBe(1);

    // Nudge inside the 30 s backoff: nothing.
    w.nudge();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(attempts.length).toBe(1);

    // Trigger clears the wait: retried now, second failure -> 60 s wait.
    w.trigger();
    await h.advance(1);
    expect(attempts.length).toBe(2);
    w.nudge();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(attempts.length).toBe(2);

    // Retries ride on the next signal or tick after the wait, not on a
    // per-hash timer. After the wait, a nudge retries (third failure -> 5 m).
    await h.advance(60_000);
    w.nudge();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(attempts.length).toBe(3);

    // The periodic tick picks it up once the 5 m wait has passed.
    fail = false;
    await h.advance(300_000 + UPLOAD_DEFAULTS.tickMs);
    expect(attempts.length).toBe(4);
    w.stop();
  });

  it('attempts nothing offline or while pulling, but reports pending honestly', async () => {
    // Why: the runaway-train incident. A pull in progress means local
    // confirmation state is stale; transferring would waste a metered link.
    const h = harness();
    let online = false;
    let pulling = false;
    const sent: string[] = [];
    const counts: number[] = [];
    const w = new TransferWorker({
      ...UPLOAD_DEFAULTS,
      work: () => ['a', 'b', 'c'].map(ref),
      transfer: async (r) => void sent.push(r.hash),
      isOnline: () => online,
      isPulling: () => pulling,
      onChange: (n) => counts.push(n),
      ...h
    });
    w.start();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(sent).toEqual([]);
    expect(counts[0]).toBe(3);
    expect(w.pending()).toBe(3);

    online = true;
    pulling = true;
    w.trigger();
    await h.advance(1);
    expect(sent).toEqual([]);

    pulling = false;
    w.trigger();
    await h.advance(1);
    expect(sent.sort()).toEqual(['a', 'b', 'c']);
    w.stop();
  });

  it('a pull starting mid-batch stops the batch before the next file', async () => {
    const h = harness();
    let pulling = false;
    const sent: string[] = [];
    const w = new TransferWorker({
      ...UPLOAD_DEFAULTS,
      concurrency: 1,
      work: () => ['a', 'b', 'c'].map(ref),
      transfer: async (r) => {
        sent.push(r.hash);
        if (r.hash === 'a') pulling = true;
      },
      isOnline: () => true,
      isPulling: () => pulling,
      ...h
    });
    w.start();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(sent).toEqual(['a']);
    w.stop();
  });

  it('a signal during a pass schedules exactly one more pass', async () => {
    const h = harness();
    let passes = 0;
    const w = new TransferWorker({
      ...UPLOAD_DEFAULTS,
      work: () => {
        passes += 1;
        return [];
      },
      transfer: async () => {},
      isOnline: () => true,
      isPulling: () => false,
      ...h
    });
    w.start();
    w.nudge();
    w.nudge();
    w.nudge();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    // work() is called at pass start and pass end: one pass = 2 calls.
    expect(passes).toBe(2);
    w.stop();
  });
});

describe('TransferWorker deferral and budget', () => {
  it('attempts nothing while deferred (recording) but still reports the honest pending count', async () => {
    // Why: background work must never compete with the microphone or a local save.
    const h = harness();
    let deferred = true;
    const sent: string[] = [];
    let pending = -1;
    const w = new TransferWorker({
      ...UPLOAD_DEFAULTS,
      work: () => ['a', 'b'].map(ref),
      transfer: async (r) => void sent.push(r.hash),
      isOnline: () => true,
      isPulling: () => false,
      isDeferred: () => deferred,
      onChange: (n) => { pending = n; },
      ...h
    });
    w.start();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(sent).toEqual([]);
    expect(pending).toBe(2);
    deferred = false;
    w.nudge();
    await h.advance(UPLOAD_DEFAULTS.debounceMs);
    expect(sent.sort()).toEqual(['a', 'b']);
  });

  it('a shared budget keeps bytes in flight bounded across workers, yet never starves an oversized file', async () => {
    // Why: several large files finishing together is the peak-memory risk on a weak phone.
    const budget = new TransferBudget(100);
    let peak = 0;
    let release: (() => void)[] = [];
    const transfer = () => new Promise<void>((resolve) => {
      peak = Math.max(peak, budget.bytesInFlight());
      release.push(resolve);
    });
    const opts = (names: string[], size: number) => ({
      ...DOWNLOAD_DEFAULTS,
      concurrency: 4,
      work: () => names.map(ref),
      transfer,
      isOnline: () => true,
      isPulling: () => false,
      budget,
      sizeOf: () => size
    });
    const h = harness();
    const a = new TransferWorker({ ...opts(['a', 'b', 'c'], 60), ...h });
    const b = new TransferWorker({ ...opts(['big'], 500), ...h });
    a.start();
    b.start();
    await h.advance(DOWNLOAD_DEFAULTS.debounceMs);
    // Only one 60-byte file fits at a time under a 100-byte budget.
    expect(release).toHaveLength(1);
    expect(peak).toBe(60);
    release.splice(0).forEach((r) => r());
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(release).toHaveLength(1);
    // Drain everything; the 500-byte file goes once nothing else is in flight.
    for (let i = 0; i < 6 && release.length; i++) {
      release.splice(0).forEach((r) => r());
      for (let j = 0; j < 20; j++) await Promise.resolve();
    }
    expect(peak).toBe(500);
    expect(budget.bytesInFlight()).toBe(0);
  });
});
