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
  HlcClock,
  affectedPassages,
  passageKeys,
  passageRow,
  passageRowKey,
  type PassageKey,
  type PassageRow
} from '@langquest-next/core';
import type { EventStore, LocalEvent, SyncInspection, Transport, WriteBatch } from './types';
import { ProjectIndexes } from './projectIndexes';
import { WriteQueue } from './writeQueue';
import { queriesFor, type ProjectQueries } from './queries';
import { ClientTooOldError, NotAuthorizedError, OfflineError, rejectCodeOf } from './types';
import { fetchSnapshot } from './snapshotFetch';
import type { Diagnostics } from './diagnostics';

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

/** What screens subscribe to: the fold, its revision, and how many local writes are not yet on disk. */
export interface PublishedState<S = ProjectState> {
  state: S;
  revision: number;
  saving: number;
}

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
  /** The run stopped at a push or pull budget with work left; run again soon. */
  more: boolean;
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
  /** Push batches per `sync()` before turning to pull, so an offline backlog cannot starve incoming work. */
  pushBatchesPerRun?: number;
  /** Wall time one `sync()` may spend pulling before it yields with `more: true`. */
  pullBudgetMs?: number;
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
  /**
   * Field diagnostics (docs/diagnostics.md): timings of load, snapshot and
   * sync, split into waiting on the network and working on the phone.
   */
  diag?: Diagnostics;
}

/** A sync that moved nothing is recorded only when it took at least this long. */
const SLOW_SYNC_MS = 2_000;
/** A repeated non-ok outcome (offline, refused) is recorded at most this often. */
const REPEAT_OUTCOME_MS = 60 * 60 * 1000;

/**
 * One partition (project) on one device.
 *
 * - `append` writes to the local log and folds immediately (PLAN.md section 3:
 *   clients materialize alone; no waiting for a projection).
 * - `push` sends pending events; rejected ones stay in the log marked
 *   rejected (invariant 1) and are removed from the fold.
 * - `pull` pages the partition tail and folds it. Because events commute,
 *   applying remote events after local pending ones needs no rebase.
 * - `sync` is one bounded slice: a few push batches, then pulling for a
 *   time budget. It reports `more` when it stopped short, and the scheduler
 *   runs it again. A month offline drains in slices, never one long pass.
 */
export class SyncClient<S = ProjectState> {
  private readonly m: Materializer<S>;
  private state: S;
  private loaded = false;
  private clock: HlcClock;
  private readonly newId: () => string;
  private readonly pullPageSize: number;
  private readonly pushBatchSize: number;
  private readonly pushBatchesPerRun: number;
  private readonly pullBudgetMs: number;
  private readonly checkpointEvery: number;

  /** Added to the device's wall clock after the server said it runs ahead. */
  private clockOffsetMs = 0;
  private readonly wall: () => number;
  /** Per-client save tracking; the shared store owns database serialization. */
  private readonly writer = new WriteQueue();
  /** Rows are maintained only for the project materializer. */
  private readonly projectRows: boolean;
  private revision = 0;
  /** Elapsed-time clock for diagnostics; unlike `wall`, never shifted by a clock-ahead offset. */
  private readonly elapsed: () => number;
  /** Network waits in the current `sync()`, for diagnostics. */
  private net = { push: 0, pull: 0, pages: 0 };
  private lastOutcome: { outcome: string; at: number } | null = null;
  private offlineSince: number | null = null;
  private indexes: ProjectIndexes | undefined;
  /** Bump when persisted passage/task/count semantics change. */
  private projectionVersion(): string { return `3:${this.m.version}`; }
  private projectionKey(): string { return `projection:${this.opts.orgId}/${this.opts.projectId}`; }
  private readonly listeners = new Set<(s: PublishedState<S>) => void>();

  constructor(private readonly opts: SyncClientOptions<S>) {
    this.m = opts.materializer ?? (PROJECT_MATERIALIZER as unknown as Materializer<S>);
    this.projectRows = !opts.materializer;
    this.state = this.m.empty();
    this.writer.onChange(() => this.publish());
    const base = opts.now ?? (() => Date.now());
    this.elapsed = base;
    this.wall = () => base() + this.clockOffsetMs;
    this.clock = opts.clock ?? new HlcClock(opts.deviceId, this.wall);
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.pullPageSize = opts.pullPageSize ?? 500;
    this.pushBatchSize = opts.pushBatchSize ?? 200;
    this.pushBatchesPerRun = opts.pushBatchesPerRun ?? 5;
    this.pullBudgetMs = opts.pullBudgetMs ?? 2_000;
    this.checkpointEvery = opts.checkpointEvery ?? 2000;
  }

  /** Rebuild the fold from the local log. Called once, and after a rejection. */
  async load(): Promise<S> {
    const started = this.elapsed();
    const refold = this.loaded;
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
    this.opts.diag?.record('load', {
      ...this.partition(),
      n: { ms: this.elapsed() - started, events: events.length, fromSnapshot: snapshot ? 1 : 0 }
    });
    if (this.projectRows) {
      this.indexes = new ProjectIndexes(this.state as unknown as ProjectState);
      const marker = await this.opts.store.meta(this.projectionKey());
      const cursor = await this.opts.store.cursor(this.opts.orgId, this.opts.projectId);
      if (refold || marker !== `${this.projectionVersion()}:${cursor}`) {
        await this.commit({ rows: this.allRows() });
      }
    }
    this.publish();
    return this.state;
  }

  // ---- the single writer and what it publishes ---------------------------

  /** Every store mutation goes through here, one transaction at a time. */
  private commit(batch: WriteBatch): Promise<void> {
    // Redactions require a refold. A restart between this commit and load()
    // must not trust rows calculated from the pre-refold state.
    if (batch.rows && batch.events?.some((l) => l.event.type === 'v1.Redacted')) {
      delete batch.rows.version;
    }
    if (!batch.rows?.version && !batch.rows?.clear && !batch.rows?.put?.length && !batch.rows?.delete?.length) delete batch.rows;
    if (batch.meta && Object.keys(batch.meta).length === 0) delete batch.meta;
    if (batch.events?.length === 0) delete batch.events;
    if (Object.keys(batch).length === 0) return Promise.resolve();
    return this.writer.run(() => this.opts.store.commit(batch));
  }

  /** How many local writes are queued or in flight; zero means everything shown is on disk. */
  get saving(): number {
    return this.writer.size;
  }

  /**
   * Be told after every change to what a screen should show: a fold
   * revision (memory) and the number of writes still in flight (disk).
   * Listeners receive the live state; treat it as read-only.
   */
  subscribe(listener: (s: PublishedState<S>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    const snap = { state: this.state, revision: this.revision, saving: this.writer.size };
    for (const l of this.listeners) l(snap);
  }

  /**
   * Compare the persisted rows with a rebuild from the fold. The check the
   * dev menu runs on a real device before trusting rows; empty means equal.
   */
  async verifyRows(): Promise<{ rows: number; mismatches: string[] }> {
    const expected = this.allRows();
    if (!expected) return { rows: 0, mismatches: [] };
    const want = new Map((expected.put ?? []).map((r) => [passageRowKey(r), JSON.stringify(r)]));
    const have = new Map<string, string>();
    let after: { order: string; unitId: string; laneId: string } | null = null;
    for (;;) {
      const page = await this.opts.store.passages(this.opts.orgId, this.opts.projectId, { after, limit: 500 });
      for (const r of page) have.set(passageRowKey(r), JSON.stringify(r));
      if (page.length < 500) break;
      const last = page[page.length - 1]!;
      after = { order: last.order, unitId: last.unitId, laneId: last.laneId };
    }
    const mismatches: string[] = [];
    for (const [k, v] of want) if (have.get(k) !== v) mismatches.push(have.has(k) ? `differs: ${k}` : `missing: ${k}`);
    for (const k of have.keys()) if (!want.has(k)) mismatches.push(`extra: ${k}`);
    return { rows: want.size, mismatches };
  }

  /** Queries over the persisted rows (queries.ts). */
  queries(): ProjectQueries {
    return queriesFor(this.opts.store, this.opts.orgId, this.opts.projectId, () => this.state as unknown as ProjectState,
      (unitId, laneId, actorId) => this.indexes!.pendingRecordings(unitId, laneId, actorId));
  }

  private rowsBatch(put: PassageRow[], clear = false): NonNullable<WriteBatch['rows']> {
    return { orgId: this.opts.orgId, projectId: this.opts.projectId, put, clear, version: this.projectionVersion() };
  }

  /** Every row of the project, from the current fold. */
  private allRows(): NonNullable<WriteBatch['rows']> | undefined {
    if (!this.projectRows) return undefined;
    const state = this.state as unknown as ProjectState;
    const idx = this.indexes!.get();
    return this.rowsBatch(passageKeys(state, idx).map((k) => passageRow(state, k.unitId, k.laneId, idx)), true);
  }

  /**
   * The rows these just-applied events changed. One passage's events cost
   * one row; a project-wide input (membership, workflow, units) costs a
   * rebuild, which is still one pass over the passages, not one per event.
   */
  private rowsFor(events: AnyEvent[]): NonNullable<WriteBatch['rows']> | undefined {
    if (!this.projectRows || events.length === 0) return undefined;
    const state = this.state as unknown as ProjectState;
    const keys = new Map<string, PassageKey>();
    for (const e of events) {
      const hit = affectedPassages(e, state);
      if (hit === 'all') return this.allRows();
      for (const k of hit) keys.set(passageRowKey(k), k);
    }
    if (keys.size === 0) return this.rowsBatch([]);
    const idx = this.indexes!.get();
    return this.rowsBatch([...keys.values()].map((k) => passageRow(state, k.unitId, k.laneId, idx)));
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

  private async saveSnapshot(snap: Snapshot, invalidateRows = true): Promise<void> {
    const { orgId, projectId } = this.opts;
    const seq = Math.max(snap.serverSeq, await this.opts.store.cursor(orgId, projectId));
    await this.commit({
      meta: { ...(invalidateRows ? { [this.projectionKey()]: '' } : {}), [this.snapshotKey()]: JSON.stringify(snap) },
      cursor: { orgId, projectId, seq },
      prune: { orgId, projectId, uptoSeq: snap.serverSeq }
    });
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
    const started = this.elapsed();
    const minSeq = Number((await this.opts.store.meta(this.minSnapshotKey())) ?? 0);
    const meta = await this.opts.transport.snapshotMeta(this.opts.orgId, this.opts.projectId, this.m.version);
    if (!meta) {
      // A cold device with no snapshot for its reducer folds the whole log: the first thing to check when a first download is slow.
      this.opts.diag?.record('snapshot', { ...this.partition(), n: { ms: this.elapsed() - started }, t: { outcome: 'none' } });
      return 0;
    }
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
          await this.commit({ meta: { [this.chunkKey()]: JSON.stringify(index) } });
        }
        await this.commit({ meta: { [this.chunkPieceKey(serverSeq, i)]: text } });
      }
    });
    // Fetching pieces is waiting on the network; saving and folding them after this is the phone's work (a `load` record).
    this.net.pull += this.elapsed() - started;
    const fetched = { ...this.partition(), n: { ms: this.elapsed() - started, chunks: meta.chunks, resumedChunks: savedMap.size, bytes: meta.bytes, seq: meta.serverSeq } };
    if (!snap || snap.serverSeq < minSeq) {
      this.opts.diag?.record('snapshot', { ...fetched, t: { outcome: 'stale' } });
      return 0;
    }
    this.opts.diag?.record('snapshot', { ...fetched, t: { outcome: 'ok' } });
    await this.clearChunks(index);
    await this.commit({ meta: { [this.chunkKey()]: '' } });
    await this.saveSnapshot(snap);
    await this.load();
    return snap.serverSeq;
  }

  private async clearChunks(index: { seq: number; chunks: number }): Promise<void> {
    const meta: Record<string, string> = {};
    for (let i = 0; i < index.chunks; i++) meta[this.chunkPieceKey(index.seq, i)] = '';
    if (index.chunks > 0) await this.commit({ meta });
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
    await this.saveSnapshot({ ...base, serverSeq: cursor, state: state as unknown as ProjectState }, false);
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
    await this.applyLocal([event]);
    return event;
  }

  /**
   * Fold local events into memory now, so the screen shows the result
   * before the disk is touched, then commit the events, the clock and the
   * rows they changed as one write. The promise resolves when that commit
   * is durable ("saved locally"); until then `saving` is above zero.
   */
  private applyIndexed(event: AnyEvent): void {
    const state = this.state as unknown as ProjectState;
    const duplicate = this.projectRows && !!state.appliedEventIds[event.id];
    this.state = this.m.apply(this.state, event);
    if (!duplicate && this.projectRows && !state.invalidEvents[event.id] && !state.redactions[event.id]) {
      this.indexes?.applied(event);
    }
  }

  private async applyLocal(events: AnyEvent[]): Promise<void> {
    for (const event of events) this.applyIndexed(event);
    // The writer publishes as soon as the commit is queued, carrying this
    // revision and saving > 0: the screen moves now, and can say "saved"
    // only once the queue drains.
    this.revision += 1;
    try {
      await this.commit({
        events: events.map((event) => ({ event, status: 'pending' as const })),
        meta: this.clockMeta(),
        rows: this.rowsFor(events)
      });
    } catch (err) {
      await this.load();
      throw err;
    }
    // Redacting something already folded needs a refold to take effect.
    if (events.some((e) => e.type === 'v1.Redacted')) await this.load();
  }

  /**
   * Record many intents in one transaction (template instantiation, bulk
   * assignment). Same guarantees as `append`, one store write. An item may
   * carry its own id (a command's stable id): re-appending it is an upsert
   * of the same row, so a retried command does not double-write.
   */
  async appendMany<T extends EventType>(items: { id?: string; type: T; payload: EventPayloads[T] }[]): Promise<AnyEvent[]> {
    if (!this.loaded) throw new Error('call load() first');
    const events = items.map(
      ({ id, type, payload }) =>
        ({
          id: id ?? this.newId(),
          type,
          orgId: this.opts.orgId,
          projectId: this.opts.projectId,
          actorId: this.opts.actorId,
          deviceId: this.opts.deviceId,
          hlc: this.clock.next(),
          payload
        }) as AnyEvent
    );
    await this.applyLocal(events);
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

  /** The clock's last stamp, for the commit that carries the events it stamped. */
  private clockMeta(): Record<string, string> {
    const last = this.clock.last();
    return last ? { [this.clockKey()]: last } : {};
  }

  private async persistClock(): Promise<void> {
    await this.commit({ meta: this.clockMeta() });
  }

  /**
   * Push pending events, at most `pushBatchesPerRun` batches. The outbox is
   * read one page at a time, never whole. Returns how many were accepted
   * and rejected, and whether pending work remains.
   */
  async push(): Promise<{ accepted: number; rejected: number; more: boolean }> {
    let accepted = 0;
    let rejected = 0;
    let more = false;
    const clockAhead: { local: LocalEvent; reason: string }[] = [];
    try {
      let afterHlc: string | null = null;
      for (let batches = 0; ; ) {
        // Only this actor's events. A shared device may hold another user's
        // queued events; pushing them under this session would be rejected
        // (actorId must match the caller) and wrongly marked as refused.
        const page = await this.opts.store.pendingPage(this.opts.orgId, this.opts.projectId, afterHlc, this.pushBatchSize);
        if (page.length === 0) break;
        afterHlc = page[page.length - 1]!.event.hlc;
        const batch = page.filter((p) => p.event.actorId === this.opts.actorId);
        if (batch.length === 0) continue;
        if (batches >= this.pushBatchesPerRun) {
          more = true;
          break;
        }
        batches += 1;
        // One bounded request per batch. Each batch's results are persisted
        // before the next is sent, so a dropped link keeps what got through.
        const sent = this.elapsed();
        const results = await this.opts.transport.append(batch.map((p) => p.event));
        this.net.push += this.elapsed() - sent;
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
        await this.commit({ events: writes, rows: this.projectRows && writes.every((l) => l.status === 'confirmed') ? this.rowsBatch([]) : undefined });
      }
      if (clockAhead.length > 0) await this.restamp(clockAhead);
    } finally {
      // A rejection means the fold contains something the server refused.
      // Refold from the log; the rejected event is excluded by `all()`.
      if (rejected > 0 || clockAhead.length > 0) await this.load();
    }
    return { accepted, rejected, more };
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
    } else {
      // No server time in the reason: fall back to one day back per attempt
      // rather than looping on the same refusal.
      this.clockOffsetMs -= 24 * 60 * 60 * 1000;
    }
    // A fresh clock, seeded only by the corrected wall time, so the new
    // stamps are not dragged forward by the old ones.
    this.clock = new HlcClock(this.opts.deviceId, this.wall);
    const ordered = [...items].sort((a, b) => (a.local.event.hlc < b.local.event.hlc ? -1 : 1));
    const events = ordered.map(({ local }) => ({ event: { ...local.event, hlc: this.clock.next() } as AnyEvent, status: 'pending' as const }));
    await this.commit({ events, meta: { ...this.clockMeta(), [this.offsetKey()]: String(this.clockOffsetMs) } });
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
    await this.commit({ events: mine.map((l) => ({ event: l.event, status: 'pending' as const })) });
    await this.load();
    return mine.length;
  }

  /** Pull the whole partition tail and fold it. Returns number of new events. */
  async pull(): Promise<number> {
    let total = 0;
    for (;;) {
      const r = await this.pullSlice(Infinity);
      total += r.pulled;
      if (!r.more) return total;
    }
  }

  /**
   * Pull pages until caught up or `budgetMs` of wall time has passed.
   * `more` says the budget ended it; `sync()` reports that so the scheduler
   * runs again at once instead of waiting for the next poll.
   */
  async pullSlice(budgetMs: number = this.pullBudgetMs): Promise<{ pulled: number; more: boolean }> {
    if (await this.resolvePendingRedaction()) return await this.pullSlice(budgetMs);
    const started = this.wall();
    let after = await this.opts.store.cursor(this.opts.orgId, this.opts.projectId);
    if (after === 0 && !(await this.localSnapshot())) after = await this.adoptServerSnapshot();
    let total = 0;
    let more = false;
    let redacted = false;
    let redactedInsideCheckpoint = false;
    let membershipChanged = false;
    for (;;) {
      const asked = this.elapsed();
      const page = await this.opts.transport.pull(
        this.opts.orgId,
        this.opts.projectId,
        after,
        this.pullPageSize
      );
      this.net.pull += this.elapsed() - asked;
      this.net.pages += 1;
      const writes: LocalEvent[] = [];
      const folded: AnyEvent[] = [];
      for (const event of page) {
        const seq = event.serverSeq;
        if (seq === undefined) continue;
        // Upsert: a pending event of ours whose ack was lost becomes confirmed.
        writes.push({ event, status: 'confirmed' });
        this.clock.receive(event.hlc);
        this.applyIndexed(event);
        folded.push(event);
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
      // One page, one transaction: events, cursor, clock, and the rows the
      // page changed. A crash between them cannot leave the cursor ahead of
      // the log or the rows behind it.
      if (folded.length > 0) this.revision += 1;
      await this.commit({
        events: writes,
        cursor: { orgId: this.opts.orgId, projectId: this.opts.projectId, seq: after },
        meta: this.clockMeta(),
        rows: this.rowsFor(folded)
      });
      this.opts.onPullProgress?.(total);
      if (page.length < this.pullPageSize) break;
      if (this.wall() - started >= budgetMs) {
        more = true;
        break;
      }
      await this.opts.yieldBetweenPages?.();
    }
    if (redactedInsideCheckpoint) {
      // Prefer a server snapshot at or past this point over re-pulling the
      // whole log (audit L3). Until one exists the checkpoint stays, the
      // target stays visible for a bounded time, and every pull retries.
      await this.commit({ meta: { [this.minSnapshotKey()]: String(after), [this.redactionKey()]: JSON.stringify({ seq: after, since: this.wall() }) } });
      if (await this.resolvePendingRedaction()) {
        const rest = await this.pullSlice(budgetMs);
        return { pulled: total + rest.pulled, more: rest.more };
      }
      await this.load();
      return { pulled: total, more };
    }
    // A redaction may target an event already folded; only a refold undoes it.
    if (redacted) await this.load();
    const base = (await this.localSnapshot())?.serverSeq ?? 0;
    if (after - base >= this.checkpointEvery && !this.opts.deferCheckpoint?.()) await this.checkpoint(after);
    // Our membership changed on the server: work refused for membership
    // reasons may be acceptable now. Queue it; the next push decides.
    if (membershipChanged) await this.retryRejected(['NOT_MEMBER', 'NOT_ALLOWED']);
    return { pulled: total, more };
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
      await this.commit({ meta: { [this.redactionKey()]: '' } });
      return true;
    }
    if (this.wall() - since < SyncClient.REDACTION_SNAPSHOT_WAIT_MS) return false;
    await this.commit({
      meta: { [this.redactionKey()]: '', [this.snapshotKey()]: '' },
      cursor: { orgId: this.opts.orgId, projectId: this.opts.projectId, seq: 0 }
    });
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
    const idle = { pushed: 0, rejected: 0, pulled: 0, tooOld: false, offline: false, refused: null, more: false };
    const started = this.elapsed();
    this.net = { push: 0, pull: 0, pages: 0 };
    let result: SyncResult;
    try {
      const { accepted, rejected, more: morePush } = await this.push();
      const { pulled, more: morePull } = await this.pullSlice();
      result = { ...idle, pushed: accepted, rejected, pulled, more: morePush || morePull };
    } catch (err) {
      if (err instanceof OfflineError) result = { ...idle, offline: true };
      else if (err instanceof ClientTooOldError) result = { ...idle, tooOld: true };
      else if (err instanceof NotAuthorizedError) result = { ...idle, refused: err.message };
      else {
        await this.recordSync(started, idle, 'error', err instanceof Error ? err.name : 'non-error');
        throw err;
      }
    }
    const outcome = result.offline ? 'offline' : result.tooOld ? 'too_old' : result.refused !== null ? 'refused' : 'ok';
    await this.recordSync(started, result, outcome);
    return result;
  }

  /**
   * One record per sync worth knowing about: it moved something, it was
   * slow, it ended a quiet spell, or its outcome changed. A phone polling a
   * dead radio every few minutes for a month writes one record an hour, not
   * thousands. Never throws: a diagnostics failure must not fail a sync.
   */
  private async recordSync(started: number, r: SyncResult, outcome: string, error?: string): Promise<void> {
    const diag = this.opts.diag;
    if (!diag?.isEnabled) return;
    try {
      const now = this.elapsed();
      const ms = now - started;
      const repeat = this.lastOutcome?.outcome === outcome && now - this.lastOutcome.at < REPEAT_OUTCOME_MS;
      const offlineMs = outcome !== 'offline' && this.offlineSince !== null ? now - this.offlineSince : undefined;
      if (outcome === 'offline') this.offlineSince ??= started;
      else this.offlineSince = null;
      const moved = r.pushed + r.pulled + r.rejected > 0;
      const worth = outcome === 'ok' ? moved || ms >= SLOW_SYNC_MS || offlineMs !== undefined || this.lastOutcome?.outcome !== 'ok' : !repeat;
      if (!worth) return;
      this.lastOutcome = { outcome, at: now };
      const netMs = this.net.push + this.net.pull;
      diag.record('sync', {
        ...this.partition(),
        n: {
          ms,
          pushNetMs: this.net.push,
          pullNetMs: this.net.pull,
          applyMs: Math.max(0, ms - netMs),
          pushed: r.pushed,
          rejected: r.rejected,
          pulled: r.pulled,
          pages: this.net.pages,
          pending: await this.pendingCount(),
          ...(offlineMs !== undefined ? { offlineMs } : {})
        },
        t: { outcome, ...(error ? { error } : {}) }
      });
    } catch { /* diagnostics never fail a sync */ }
  }

  private partition(): { orgId: string; projectId: string } {
    return { orgId: this.opts.orgId, projectId: this.opts.projectId };
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
