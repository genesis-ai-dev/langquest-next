import {
  applyEvent,
  emptyState,
  fold,
  REDUCER_VERSION,
  type AnyEvent,
  type EventPayloads,
  type EventType,
  type ProjectState,
  type Snapshot,
  HlcClock
} from '@langquest-next/core';
import type { EventStore, LocalEvent, SyncInspection, Transport } from './types';
import { ClientTooOldError, NotAuthorizedError, OfflineError, rejectCodeOf } from './types';
import { fetchSnapshot } from './snapshotFetch';

/**
 * How a partition's events become state. The project materializer is the
 * default; the org partition (core `org.ts`) supplies its own. Everything
 * else in the client (log, outbox, cursor, checkpoints, snapshots) is the
 * same for both, which is the point: one sync path, two folds.
 */
export interface Materializer<S> {
  empty(): S;
  apply(state: S, event: AnyEvent): S;
  fold(events: Iterable<AnyEvent>, initial: S): S;
  /** Drop bookkeeping a checkpoint no longer needs (applied ids). */
  compact(state: S): void;
  /** Snapshots are tagged with this; a mismatch means fold the log instead. */
  version: number;
}

export const PROJECT_MATERIALIZER: Materializer<ProjectState> = {
  empty: emptyState,
  apply: applyEvent,
  fold,
  compact: (s) => {
    s.appliedEventIds = {};
  },
  version: REDUCER_VERSION
};

/** What one `sync()` attempt did, and why it did nothing when it did nothing. */
export interface SyncResult {
  pushed: number;
  rejected: number;
  pulled: number;
  /** The server refuses this client's protocol version. */
  tooOld: boolean;
  /** The server could not be reached at all. */
  offline: boolean;
  /** The server was reached and refused this actor; its reason, else null. */
  refused: string | null;
}

export interface SyncClientOptions<S = ProjectState> {
  /** Defaults to the project reducer. */
  materializer?: Materializer<S>;
  orgId: string;
  projectId: string;
  actorId: string;
  deviceId: string;
  store: EventStore;
  transport: Transport;
  /** Supply a clock for tests; otherwise one is seeded from the store. */
  clock?: HlcClock;
  now?: () => number;
  newId?: () => string;
  pullPageSize?: number;
  /** Pending events per append call. Small so a weak link makes progress. */
  pushBatchSize?: number;
  /** Confirmed events since the last local checkpoint before taking a new one. */
  checkpointEvery?: number;
  /**
   * Called between pull pages so a long catch-up shares the thread with
   * the screen (mobile passes a macrotask yield). Nothing is folded while it
   * waits; what is already folded is already in state.
   */
  yieldBetweenPages?: () => Promise<void>;
  /** A checkpoint clones the whole state; skip it while this is true (recording) and take it on a later pull. */
  deferCheckpoint?: () => boolean;
  /** Progress per pulled page: events so far this pull. */
  onPullProgress?: (pulled: number) => void;
}

/**
 * One partition (project) on one device.
 *
 * - `append` writes to the local log and folds immediately (PLAN.md section 3:
 *   clients materialize alone; no waiting for a projection).
 * - `push` sends pending events; rejected ones stay in the log marked
 *   rejected (invariant 1) and are removed from the fold.
 * - `pull` pages the partition tail and folds it. Because events commute,
 *   applying remote events after local pending ones needs no rebase.
 */
export class SyncClient<S = ProjectState> {
  private readonly m: Materializer<S>;
  private state: S;
  private loaded = false;
  private clock: HlcClock;
  private readonly newId: () => string;
  private readonly pullPageSize: number;
  private readonly pushBatchSize: number;
  private readonly checkpointEvery: number;

  /** Added to the device's wall clock after the server said it runs ahead. */
  private clockOffsetMs = 0;
  private readonly wall: () => number;

  constructor(private readonly opts: SyncClientOptions<S>) {
    this.m = opts.materializer ?? (PROJECT_MATERIALIZER as unknown as Materializer<S>);
    this.state = this.m.empty();
    const base = opts.now ?? (() => Date.now());
    this.wall = () => base() + this.clockOffsetMs;
    this.clock = opts.clock ?? new HlcClock(opts.deviceId, this.wall);
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.pullPageSize = opts.pullPageSize ?? 500;
    this.pushBatchSize = opts.pushBatchSize ?? 200;
    this.checkpointEvery = opts.checkpointEvery ?? 2000;
  }

  /** Rebuild the fold from the local log. Called once, and after a rejection. */
  async load(): Promise<S> {
    if (!this.opts.clock && !this.loaded) {
      const seed = await this.opts.store.meta(this.clockKey());
      this.clockOffsetMs = Number((await this.opts.store.meta(this.offsetKey())) ?? 0);
      this.clock = new HlcClock(this.opts.deviceId, this.wall, seed ?? null);
    }
    // fold() applies redactions first, so the store's order does not matter.
    const locals = await this.opts.store.all(this.opts.orgId, this.opts.projectId);
    const events = locals.map((l) => l.event);
    const snapshot = await this.localSnapshot();
    this.state = snapshot ? this.resume(snapshot, events) : this.m.fold(events, this.m.empty());
    this.loaded = true;
    return this.state;
  }

  /** core `resume` for any materializer: snapshot state plus events after its seq. */
  private resume(snapshot: Snapshot, tail: Iterable<AnyEvent>): S {
    const state = structuredClone(snapshot.state as unknown as S);
    const newer = [...tail].filter((e) => e.serverSeq === undefined || e.serverSeq > snapshot.serverSeq);
    return this.m.fold(newer, state);
  }

  // ---- checkpoints -------------------------------------------------------
  // A checkpoint is a snapshot held locally (PLAN.md invariant 10). Cold start
  // takes the server's; afterwards the device rolls its own every
  // `checkpointEvery` confirmed events and prunes what the checkpoint covers,
  // so replay on launch is bounded by recent history, not project age.

  private snapshotKey(): string {
    return `snapshot:${this.opts.orgId}/${this.opts.projectId}`;
  }

  private minSnapshotKey(): string {
    return `snapshotMinSeq:${this.opts.orgId}/${this.opts.projectId}`;
  }

  private async localSnapshot(): Promise<Snapshot | null> {
    const raw = await this.opts.store.meta(this.snapshotKey());
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    return snap.reducerVersion === this.m.version ? snap : null;
  }

  private async saveSnapshot(snap: Snapshot): Promise<void> {
    await this.opts.store.setMeta(this.snapshotKey(), JSON.stringify(snap));
    await this.opts.store.setCursor(this.opts.orgId, this.opts.projectId, Math.max(
      snap.serverSeq,
      await this.opts.store.cursor(this.opts.orgId, this.opts.projectId)
    ));
    await this.opts.store.prune(this.opts.orgId, this.opts.projectId, snap.serverSeq);
  }

  /** Index of saved pieces: which snapshot seq they belong to and how many there are. */
  private chunkKey(): string {
    return `snapchunks:${this.opts.orgId}/${this.opts.projectId}`;
  }

  /** One piece, stored on its own so saving piece N never rewrites pieces 0..N-1. */
  private chunkPieceKey(serverSeq: number, index: number): string {
    return `${this.chunkKey()}:${serverSeq}:${index}`;
  }

  /**
   * Cold start: adopt the server snapshot if there is one we can use. It is
   * fetched in pieces and every piece is persisted first, so a link that
   * drops mid-way resumes from the pieces already here (PLAN.md section 2:
   * small deltas succeed). Pieces are separate rows: persistence cost is
   * linear in snapshot size, not quadratic in piece count.
   */
  private async adoptServerSnapshot(): Promise<number> {
    const minSeq = Number((await this.opts.store.meta(this.minSnapshotKey())) ?? 0);
    const meta = await this.opts.transport.snapshotMeta(this.opts.orgId, this.opts.projectId, this.m.version);
    if (!meta) return 0;
    const savedMap = new Map<number, string>();
    let index: { seq: number; chunks: number } = { seq: 0, chunks: 0 };
    try {
      const parsed = JSON.parse((await this.opts.store.meta(this.chunkKey())) || '{}') as Partial<typeof index>;
      // An older build stored every piece inside this one row; ignore it and refetch.
      if (typeof parsed.seq === 'number' && typeof parsed.chunks === 'number') index = { seq: parsed.seq, chunks: parsed.chunks };
    } catch { /* refetch */ }
    if (index.seq === meta.serverSeq) {
      for (let i = 0; i < index.chunks; i++) {
        const text = await this.opts.store.meta(this.chunkPieceKey(index.seq, i));
        if (text) savedMap.set(i, text);
      }
    }
    const snap = await fetchSnapshot(this.opts.transport, this.opts.orgId, this.opts.projectId, this.m.version, {
      saved: savedMap,
      onChunk: async (serverSeq, i, text) => {
        if (index.seq !== serverSeq) {
          await this.clearChunks(index);
          index = { seq: serverSeq, chunks: meta.chunks };
          await this.opts.store.setMeta(this.chunkKey(), JSON.stringify(index));
        }
        await this.opts.store.setMeta(this.chunkPieceKey(serverSeq, i), text);
      }
    });
    if (!snap || snap.serverSeq < minSeq) return 0;
    await this.clearChunks(index);
    await this.opts.store.setMeta(this.chunkKey(), '');
    await this.saveSnapshot(snap);
    await this.load();
    return snap.serverSeq;
  }

  private async clearChunks(index: { seq: number; chunks: number }): Promise<void> {
    for (let i = 0; i < index.chunks; i++) await this.opts.store.setMeta(this.chunkPieceKey(index.seq, i), '');
  }

  /** Roll the confirmed prefix into a local checkpoint and prune it. */
  private async checkpoint(cursor: number): Promise<void> {
    const base = (await this.localSnapshot()) ?? {
      orgId: this.opts.orgId,
      projectId: this.opts.projectId,
      reducerVersion: this.m.version,
      serverSeq: 0,
      state: this.m.empty() as unknown as ProjectState
    };
    const confirmed = (await this.opts.store.all(this.opts.orgId, this.opts.projectId))
      .filter((l) => l.status === 'confirmed')
      .map((l) => l.event);
    const state = this.resume(base, confirmed);
    this.m.compact(state);
    await this.saveSnapshot({ ...base, serverSeq: cursor, state: state as unknown as ProjectState });
  }

  getState(): S {
    if (!this.loaded) throw new Error('call load() first');
    return this.state;
  }

  /** Record an intent. Durable locally and visible in state before this resolves. */
  async append<T extends EventType>(
    type: T,
    payload: EventPayloads[T],
    parentEventId?: string
  ): Promise<AnyEvent> {
    if (!this.loaded) throw new Error('call load() first');
    const event = {
      id: this.newId(),
      type,
      orgId: this.opts.orgId,
      projectId: this.opts.projectId,
      actorId: this.opts.actorId,
      deviceId: this.opts.deviceId,
      hlc: this.clock.next(),
      payload,
      ...(parentEventId ? { parentEventId } : {})
    } as AnyEvent;
    // Applied to memory before the first await so the UI can show the
    // result now; the write is still awaited before this resolves.
    this.state = this.m.apply(this.state, event);
    try {
      await Promise.all([this.opts.store.put({ event, status: 'pending' }), this.persistClock()]);
    } catch (err) {
      await this.load();
      throw err;
    }
    // Redacting something already folded needs a refold to take effect.
    if (type === 'v1.Redacted') await this.load();
    return event;
  }

  /**
   * Record many intents in one transaction (template instantiation, bulk
   * assignment). Same guarantees as `append`, one store write.
   */
  async appendMany<T extends EventType>(items: { type: T; payload: EventPayloads[T] }[]): Promise<AnyEvent[]> {
    if (!this.loaded) throw new Error('call load() first');
    const events = items.map(
      ({ type, payload }) =>
        ({
          id: this.newId(),
          type,
          orgId: this.opts.orgId,
          projectId: this.opts.projectId,
          actorId: this.opts.actorId,
          deviceId: this.opts.deviceId,
          hlc: this.clock.next(),
          payload
        }) as AnyEvent
    );
    for (const event of events) this.state = this.m.apply(this.state, event);
    try {
      await Promise.all([
        this.opts.store.putMany(events.map((event) => ({ event, status: 'pending' as const }))),
        this.persistClock()
      ]);
    } catch (err) {
      await this.load();
      throw err;
    }
    if (events.some((e) => e.type === 'v1.Redacted')) await this.load();
    return events;
  }

  private clockKey(): string {
    return `hlc:${this.opts.deviceId}`;
  }

  private offsetKey(): string {
    return `clockOffset:${this.opts.deviceId}`;
  }

  private redactionKey(): string {
    return `redactionPending:${this.opts.orgId}/${this.opts.projectId}`;
  }

  private async persistClock(): Promise<void> {
    const last = this.clock.last();
    if (last) await this.opts.store.setMeta(this.clockKey(), last);
  }

  /** Push pending events. Returns how many were rejected. */
  async push(): Promise<{ accepted: number; rejected: number }> {
    // Only this actor's events. A shared device may hold another user's
    // queued events; pushing them under this session would be rejected
    // (actorId must match the caller) and wrongly marked as refused.
    const pending = (await this.opts.store.pending(this.opts.orgId, this.opts.projectId)).filter(
      (p) => p.event.actorId === this.opts.actorId
    );
    if (pending.length === 0) return { accepted: 0, rejected: 0 };

    let accepted = 0;
    let rejected = 0;
    let clockAhead: { local: LocalEvent; reason: string }[] = [];
    try {
      // One bounded request per batch. Each batch's results are persisted
      // before the next is sent, so a dropped link keeps what got through.
      for (let i = 0; i < pending.length; i += this.pushBatchSize) {
        const batch = pending.slice(i, i + this.pushBatchSize);
        const results = await this.opts.transport.append(batch.map((p) => p.event));
        const writes: LocalEvent[] = [];
        for (const r of results) {
          const local = batch.find((p) => p.event.id === r.id);
          if (!local) continue;
          if (r.accepted) {
            accepted += 1;
            writes.push({
              event: { ...local.event, serverSeq: r.serverSeq ?? undefined } as AnyEvent,
              status: 'confirmed'
            });
          } else if (rejectCodeOf(r.reason ?? undefined) === 'CLOCK_AHEAD') {
            // Not a refusal of the intent, only of its timestamp. Handled below.
            clockAhead.push({ local, reason: r.reason ?? '' });
          } else {
            rejected += 1;
            writes.push({ event: local.event, status: 'rejected', rejectReason: r.reason ?? 'rejected' });
          }
        }
        await this.opts.store.putMany(writes);
      }
      if (clockAhead.length > 0) await this.restamp(clockAhead);
    } finally {
      // A rejection means the fold contains something the server refused.
      // Refold from the log; the rejected event is excluded by `all()`.
      if (rejected > 0 || clockAhead.length > 0) await this.load();
    }
    return { accepted, rejected };
  }

  /**
   * The server refused these because this device's clock runs ahead of it
   * (audit L2): left alone, every register this device sets would win
   * forever. Adopt the server's time as an offset, then give the events new
   * clocks in their original order. Ids and payloads are unchanged, so the
   * server's idempotency and every parent pointer still hold; they go out
   * on the next push.
   */
  private async restamp(items: { local: LocalEvent; reason: string }[]): Promise<void> {
    const serverMs = Number(/server (?:time|now) (\d+)/.exec(items[0]!.reason)?.[1]);
    if (Number.isFinite(serverMs) && serverMs > 0) {
      this.clockOffsetMs += serverMs - this.wall();
      await this.opts.store.setMeta(this.offsetKey(), String(this.clockOffsetMs));
    } else {
      // No server time in the reason: fall back to one day back per attempt
      // rather than looping on the same refusal.
      this.clockOffsetMs -= 24 * 60 * 60 * 1000;
      await this.opts.store.setMeta(this.offsetKey(), String(this.clockOffsetMs));
    }
    // A fresh clock, seeded only by the corrected wall time, so the new
    // stamps are not dragged forward by the old ones.
    this.clock = new HlcClock(this.opts.deviceId, this.wall);
    const ordered = [...items].sort((a, b) => (a.local.event.hlc < b.local.event.hlc ? -1 : 1));
    await this.opts.store.putMany(
      ordered.map(({ local }) => ({ event: { ...local.event, hlc: this.clock.next() } as AnyEvent, status: 'pending' as const }))
    );
    await this.persistClock();
  }

  /**
   * Put refused events back in the queue. Called with membership codes when
   * a pull shows this actor's membership changed (audit L1), or by the UI
   * for a manual retry. Invalid payloads are never retried.
   */
  async retryRejected(codes: readonly ReturnType<typeof rejectCodeOf>[] = ['NOT_MEMBER', 'NOT_ALLOWED', 'UNKNOWN']): Promise<number> {
    const mine = (await this.opts.store.rejected(this.opts.orgId, this.opts.projectId)).filter(
      (l) => l.event.actorId === this.opts.actorId && codes.includes(rejectCodeOf(l.rejectReason))
    );
    if (mine.length === 0) return 0;
    await this.opts.store.putMany(mine.map((l) => ({ event: l.event, status: 'pending' as const })));
    await this.load();
    return mine.length;
  }

  /** Pull the partition tail and fold it. Returns number of new events. */
  async pull(): Promise<number> {
    if (await this.resolvePendingRedaction()) return await this.pull();
    let after = await this.opts.store.cursor(this.opts.orgId, this.opts.projectId);
    if (after === 0 && !(await this.localSnapshot())) after = await this.adoptServerSnapshot();
    let total = 0;
    let redacted = false;
    let redactedInsideCheckpoint = false;
    let membershipChanged = false;
    for (;;) {
      const page = await this.opts.transport.pull(
        this.opts.orgId,
        this.opts.projectId,
        after,
        this.pullPageSize
      );
      const writes: LocalEvent[] = [];
      for (const event of page) {
        const seq = event.serverSeq;
        if (seq === undefined) continue;
        // Upsert: a pending event of ours whose ack was lost becomes confirmed.
        writes.push({ event, status: 'confirmed' });
        this.clock.receive(event.hlc);
        this.state = this.m.apply(this.state, event);
        if (event.type === 'v1.Redacted') {
          redacted = true;
          // The target is not in the local log: it lives inside the checkpoint,
          // which cannot be edited. Only a fresh snapshot removes it.
          if (!(await this.opts.store.get(event.payload.eventId))) redactedInsideCheckpoint = true;
        }
        if (
          (event.type === 'v1.MemberAdded' || event.type === 'v1.MemberRoleChanged') &&
          event.payload.profileId === this.opts.actorId
        ) {
          membershipChanged = true;
        }
        after = Math.max(after, seq);
        total += 1;
      }
      await this.opts.store.putMany(writes);
      await this.opts.store.setCursor(this.opts.orgId, this.opts.projectId, after);
      await this.persistClock();
      this.opts.onPullProgress?.(total);
      if (page.length < this.pullPageSize) break;
      await this.opts.yieldBetweenPages?.();
    }
    if (redactedInsideCheckpoint) {
      // Prefer a server snapshot at or past this point over re-pulling the
      // whole log (audit L3). Until one exists the checkpoint stays, the
      // target stays visible for a bounded time, and every pull retries.
      await this.opts.store.setMeta(this.minSnapshotKey(), String(after));
      await this.opts.store.setMeta(this.redactionKey(), JSON.stringify({ seq: after, since: this.wall() }));
      if (await this.resolvePendingRedaction()) return total + (await this.pull());
      await this.load();
      return total;
    }
    // A redaction may target an event already folded; only a refold undoes it.
    if (redacted) await this.load();
    const base = (await this.localSnapshot())?.serverSeq ?? 0;
    if (after - base >= this.checkpointEvery && !this.opts.deferCheckpoint?.()) await this.checkpoint(after);
    // Our membership changed on the server: work refused for membership
    // reasons may be acceptable now. Queue it; the next push decides.
    if (membershipChanged) await this.retryRejected(['NOT_MEMBER', 'NOT_ALLOWED']);
    return total;
  }

  /** How long a redacted-inside-checkpoint device waits for a snapshot before re-pulling the whole log. */
  static readonly REDACTION_SNAPSHOT_WAIT_MS = 30 * 60 * 1000;

  /**
   * A redaction targeted something inside our checkpoint. Try to replace the
   * checkpoint with a server snapshot that already excludes it. Returns true
   * when state was rebuilt and the caller should pull again from the new
   * cursor. After the wait window, fall back to dropping the checkpoint and
   * re-pulling everything, which is always correct, only expensive.
   */
  private async resolvePendingRedaction(): Promise<boolean> {
    const raw = await this.opts.store.meta(this.redactionKey());
    if (!raw) return false;
    const { seq, since } = JSON.parse(raw) as { seq: number; since: number };
    // adoptServerSnapshot fetches in persisted pieces and refuses anything
    // older than snapshotMinSeq, which pull() set to the redaction's seq.
    let adopted = 0;
    try {
      adopted = await this.adoptServerSnapshot();
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
    }
    if (adopted >= seq && adopted > 0) {
      await this.opts.store.setMeta(this.redactionKey(), '');
      return true;
    }
    if (this.wall() - since < SyncClient.REDACTION_SNAPSHOT_WAIT_MS) return false;
    await this.opts.store.setMeta(this.redactionKey(), '');
    await this.opts.store.setMeta(this.snapshotKey(), '');
    await this.opts.store.setCursor(this.opts.orgId, this.opts.projectId, 0);
    await this.load();
    return true;
  }

  /**
   * Push then pull. Everything stays queued unless the server accepted it, so
   * each outcome is reported rather than guessed at by the caller:
   *
   * - `offline`: the request never reached the server. Only this means the
   *   device is offline.
   * - `refused`: the server answered and refused this actor (not a member of
   *   the partition). The device is online; more syncing will not help until
   *   membership or the session changes.
   * - `tooOld`: the server no longer accepts this client's protocol version.
   */
  async sync(): Promise<SyncResult> {
    const idle = { pushed: 0, rejected: 0, pulled: 0, tooOld: false, offline: false, refused: null };
    try {
      const { accepted, rejected } = await this.push();
      const pulled = await this.pull();
      return { ...idle, pushed: accepted, rejected, pulled };
    } catch (err) {
      if (err instanceof OfflineError) return { ...idle, offline: true };
      if (err instanceof ClientTooOldError) return { ...idle, tooOld: true };
      if (err instanceof NotAuthorizedError) return { ...idle, refused: err.message };
      throw err;
    }
  }

  /** The local log as the sync status screen shows it. */
  async inspect(): Promise<SyncInspection> {
    const { orgId, projectId } = this.opts;
    const [pending, rejected, all, cursor, snap] = await Promise.all([
      this.opts.store.pending(orgId, projectId),
      this.opts.store.rejected(orgId, projectId),
      this.opts.store.all(orgId, projectId),
      this.opts.store.cursor(orgId, projectId),
      this.localSnapshot()
    ]);
    return { pending, rejected, total: all.length, cursor, checkpointSeq: snap?.serverSeq ?? null };
  }

  async pendingCount(): Promise<number> {
    return this.opts.store.pendingCount(this.opts.orgId, this.opts.projectId);
  }
}
