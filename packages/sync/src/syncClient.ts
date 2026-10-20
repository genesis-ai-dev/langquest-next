import {
  applyLanguageEvent,
  emptyLanguageState,
  eventSizeError,
  foldLanguage,
  LINES_VERSION,
  REDUCER_VERSION,
  type AnyEvent,
  type EventPayloads,
  type EventType,
  type LanguageState,
  type PassageLine,
  type PassageLines,
  type Snapshot,
  HlcClock,
  languageLines
} from '@langquest-next/core';
import type { EventStore, LocalEvent, SyncInspection, Transport, WriteBatch } from './types';
import { WriteQueue } from './writeQueue';
import { ClientTooOldError, EventTooLargeError, NotAuthorizedError, OfflineError, UnrenewedError, rejectCodeOf, type RejectCode } from './types';
import { downloadPieces, fetchSnapshot } from './snapshotFetch';
import type { DIAG_SCHEMA, Diagnostics } from './diagnostics';
import { holdsKept, KeptLanguage, LINE, PART_KINDS, SnapshotRows, SPLIT_MAPS } from './keptLanguage';
import { KeptLines, lineRow } from './keptLines';
import { KeptFill } from './keptFill';
import { stateSplitter } from './stateSplit';
import type { KeptRecord } from './types';

/** Why the local log is folded again: the `load` record's `reason`. Only `open` is a person waiting on a screen. */
export type LoadReason = (typeof DIAG_SCHEMA.load.t.reason)[number];
/** Where a sync that ended in `error` failed. */
type SyncPhase = (typeof DIAG_SCHEMA.sync.t.phase)[number];
/** Why a server snapshot was asked for. */
type SnapshotWhy = (typeof DIAG_SCHEMA.snapshot.t.why)[number];

/** A refusal's reason as the `sync` record counts it. */
const REJECT_FIELD: Record<RejectCode, string> = {
  NOT_MEMBER: 'rejNotMember', NOT_ALLOWED: 'rejNotAllowed', NOT_LISTED: 'rejNotListed',
  INVALID: 'rejInvalid', CLOCK_AHEAD: 'rejClockAhead', UNKNOWN: 'rejOther'
};

/** An error's own fixed code (a SQLSTATE, a PostgREST code) or HTTP status, never its message. */
function diagCodeOf(err: unknown): string | undefined {
  const e = (err ?? {}) as { code?: unknown; status?: unknown };
  if (typeof e.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(e.code)) return e.code;
  if (typeof e.status === 'number' && e.status >= 100 && e.status < 600) return `http${e.status}`;
  return undefined;
}

/**
 * How a stream's events become state. The language materializer is the
 * default; the organization stream (core `org.ts`) supplies its own.
 * Everything else in the client (log, outbox, cursor, checkpoints,
 * snapshots) is the same for both, which is the point: one sync path, two
 * folds.
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

/** The default: a language's work (core `reducer.ts`). */
export const LANGUAGE_MATERIALIZER: Materializer<LanguageState> = {
  empty: emptyLanguageState,
  apply: applyLanguageEvent,
  fold: foldLanguage,
  compact: (s) => {
    s.appliedEventIds = {};
  },
  version: REDUCER_VERSION
};

/** What screens subscribe to: the fold, its revision, and how many local writes are not yet on disk. */
interface PublishedState<S = LanguageState> {
  state: S;
  revision: number;
  saving: number;
  /** Each passage's line, for a language kept on disk (`passageLines`). */
  lines?: PassageLines;
  /** Passages filled in of those the server has rows for, while a fill runs (decisions.md 147). */
  fill?: { filled: number; total: number } | null;
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
  /**
   * Passages' rows are still to fill in from the server (decisions.md 147):
   * the language is up to date and every line exact, and the next sync
   * fills in more. Run again soon while online.
   */
  filling: boolean;
}

export interface SyncClientOptions<S = LanguageState> {
  /** Defaults to the language reducer. */
  materializer?: Materializer<S>;
  orgId: string;
  /** The stream: `ORG_STREAM`, a language id, or a profile id under `PERSON_ORG`. */
  streamId: string;
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
  /**
   * Push only, for a person who handed a shared phone on (`deliverQueued`,
   * decisions.md 60): the client never folds, writes projections or
   * re-stamps clocks, because the phone's own client owns those. An event
   * refused for its clock stays queued for the person's own next session.
   */
  deliverOnly?: boolean;
  /**
   * This actor's membership changed in what was just pulled (only the
   * organization stream holds memberships). The app re-queues work its
   * language clients had refused for membership, which may pass now.
   */
  onMembershipChanged?: () => void;
  /**
   * A language stream only: keep its recordings and file verdicts on the
   * phone rather than in memory, and hold in memory only the passages
   * `loadUnits` asks for (decisions.md 143).
   */
  keepOnDisk?: boolean;
  /**
   * The build of the app this runs in. A language kept on disk keeps a line
   * per passage that this code works out, so a line kept by another build is
   * worked out again: a change to what a passage's status means reaches
   * every passage after an update, with no migration (decisions.md 143).
   */
  build?: string;
  /**
   * The passages to fill in first after those a screen or this phone's own
   * work asked for: the person's offline scope (decision 61). Read at each
   * fill step.
   */
  fillFirst?: () => Iterable<string>;
  /** Wall time one `sync()` may spend filling in passages' rows once the language is up to date. */
  fillBudgetMs?: number;
  /** Rows a fill asks for at once (`ROWS_PER_PAGE`); a test makes it small. */
  fillPageRows?: number;
  /** The kept checkpoint format this build writes; a test sets an older one to play a build from before. */
  keptFormat?: number;
}

/**
 * The local checkpoint of a language kept on disk is not the whole language:
 * its passages' records are in the phone's `kept_rows` (decisions.md 143). It is
 * tagged `reducerVersion * 100 + KEPT_CHECKPOINT_FORMAT`, which no build that
 * holds the whole checkpoint matches, so such a build (an update rolled back)
 * drops it with the stream's cursor, as for another reducer (decisions.md 110),
 * and takes the server's snapshot, instead of reading it as the whole
 * language and saving that. Raise the format whenever what a kept checkpoint
 * leaves out changes (the server's cut, option F, does); server snapshots keep
 * the plain reducer version.
 */
export const KEPT_CHECKPOINT_FORMAT = 2;

/**
 * Kept formats this build reads. 1 (decision 143): every passage's rows are
 * on disk. 2 (decision 147): some passages' rows may still be on the server,
 * and the fill's record (`fill:<org>/<stream>`) says which; a build that
 * reads only format 1 would take such a checkpoint for the whole language.
 */
const KEPT_FORMATS_READ: readonly number[] = [1, 2];

/** The version a kept language's local checkpoint carries, for this reducer. */
export function keptCheckpointVersion(reducerVersion: number, format = KEPT_CHECKPOINT_FORMAT): number {
  return reducerVersion * 100 + format;
}

/** Per store and stream, the sync, push, pull or refold running now; the next waits for it (`SyncClient.exclusive`). */
const TURNS = new WeakMap<object, Map<string, Promise<unknown>>>();

/** A sync that moved nothing is recorded only when it took at least this long. */
const SLOW_SYNC_MS = 2_000;
/** After the server says it has no snapshot for a stream, how long before asking again. */
const NO_SNAPSHOT_RECHECK_MS = 5 * 60 * 1000;
/**
 * Snapshot pieces requested at once on a cold start (decisions.md 18,
 * amended). Enough that a phone on a slow, far link is never idle between
 * pieces; few enough that a dropped link wastes little.
 */
const SNAPSHOT_PIECES_IN_FLIGHT = 3;
/** Kept records written per commit while a snapshot is read: bounded memory, few transactions. */
const KEPT_ROWS_PER_COMMIT = 2_000;
/** How long after a change the passages' lines are worked out: once for a burst of events (a pull's pages), not per page. */
const LINES_AFTER_MS = 150;
/** A repeated non-ok outcome (offline, refused) is recorded at most this often. */
const REPEAT_OUTCOME_MS = 60 * 60 * 1000;

/**
 * One stream on one device.
 *
 * - `append` writes to the local log and folds immediately (PLAN.md section 3:
 *   clients materialize alone; no waiting for a projection).
 * - `push` sends pending events; rejected ones stay in the log marked
 *   rejected (invariant 1) and are removed from the fold.
 * - `pull` pages the stream's tail and folds it. Because events commute,
 *   applying remote events after local pending ones needs no rebase.
 * - `sync` is one bounded slice: a few push batches, then pulling for a
 *   time budget. It reports `more` when it stopped short, and the scheduler
 *   runs it again. A month offline drains in slices, never one long pass.
 */
export class SyncClient<S = LanguageState> {
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
  private revision = 0;
  /** Elapsed-time clock for diagnostics; unlike `wall`, never shifted by a clock-ahead offset. */
  private readonly elapsed: () => number;
  /** Network waits in the current `sync()`, for diagnostics. */
  private net = { push: 0, pull: 0, pages: 0 };
  /** Refusals in the current `sync()` by reason (`REJECT_FIELD`). */
  private refusals: Record<string, number> = {};
  /** Refused events queued again since the last `sync` record (`retryRejected`). */
  private requeuedSinceRecord = 0;
  /** Where each error a sync step threw came from, innermost step first, so a failed sync says where. */
  private readonly failedIn = new WeakMap<object, SyncPhase>();
  /** The last load dropped a checkpoint from an older reducer: the next snapshot is asked for because of that. */
  private reducerDropped = false;
  /** From `trackOpen` until the first sync that reads the stream up to date; then the `open` record. */
  private opening: { started: number; cold: boolean; syncs: number; pulled: number; snapshotMs: number; loadMs: number } | null = null;
  private lastOutcome: { outcome: string; at: number } | null = null;
  private offlineSince: number | null = null;
  /** The server had no snapshot for this stream; do not ask again before this (elapsed ms). */
  private noSnapshotUntil = 0;
  private readonly listeners = new Set<(s: PublishedState<S>) => void>();
  /** What this language keeps on disk instead of in memory; null when it keeps all of it in memory. */
  private readonly kept: KeptLanguage | null;
  /** Each passage's line for lists, for a language kept on disk. */
  private readonly lines: KeptLines | null;
  private linesAt: ReturnType<typeof setTimeout> | undefined;
  /** A sync asked for and not started yet: everyone who asks meanwhile shares it. */
  private nextSync: Promise<SyncResult> | null = null;
  /** What this client's local checkpoint is tagged with: the reducer version, or a kept language's format (`keptCheckpointVersion`). */
  private readonly checkpointVersion: number;
  /** Filling in passages' rows from the server's cut (decisions.md 147), for a language kept on disk. */
  private readonly fill: KeptFill | null;
  private readonly fillBudgetMs: number;

  constructor(private readonly opts: SyncClientOptions<S>) {
    this.m = opts.materializer ?? (LANGUAGE_MATERIALIZER as unknown as Materializer<S>);
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
    this.kept = opts.keepOnDisk ? new KeptLanguage(opts.store, opts.orgId, opts.streamId) : null;
    this.checkpointVersion = this.kept ? keptCheckpointVersion(this.m.version, opts.keptFormat) : this.m.version;
    this.lines = this.kept
      ? new KeptLines(opts.store, opts.orgId, opts.streamId, this.kept, (b) => this.commit(b), () => this.state as unknown as LanguageState, opts.build ?? '')
      : null;
    this.fill = this.kept && this.lines && (opts.keptFormat ?? KEPT_CHECKPOINT_FORMAT) >= 2
      ? new KeptFill(opts.store, opts.transport, opts.orgId, opts.streamId, this.m.version, this.kept, this.lines, (b) => this.commit(b), () => this.state as unknown as LanguageState, opts.fillPageRows)
      : null;
    this.fillBudgetMs = opts.fillBudgetMs ?? 2_000;
  }

  /**
   * Rebuild the fold from the local log. Called once on open, and again
   * after a rejection, a redaction or a snapshot; `reason` says which, for
   * the `load` record. The first load defaults to `open`. It takes the
   * stream's turn (`exclusive`): a sync of the same language still running
   * on this phone (a session closed while its first download went on) would
   * otherwise find no checkpoint yet and drop the rows being written.
   */
  load(reason: LoadReason = this.loaded ? 'other' : 'open'): Promise<S> {
    return this.exclusive(() => this.refold(reason));
  }

  /** `load` for a caller that already holds the stream's turn: a push, pull or snapshot that must fold again. */
  private refold(reason: LoadReason = this.loaded ? 'other' : 'open'): Promise<S> {
    return this.inPhase('load', async () => {
      const started = this.elapsed();
      if (!this.opts.clock && !this.loaded) {
        const seed = await this.opts.store.meta(this.clockKey());
        this.clockOffsetMs = Number((await this.opts.store.meta(this.offsetKey())) ?? 0);
        this.clock = new HlcClock(this.opts.deviceId, this.wall, seed ?? null);
      }
      // A fold applies redactions first, so the store's order does not matter.
      const locals = await this.opts.store.all(this.opts.orgId, this.opts.streamId);
      const events = locals.map((l) => l.event);
      const checkpoint = await this.storedCheckpoint();
      const readMs = this.elapsed() - started;
      const staleSeq = checkpoint && !this.readable(checkpoint.reducerVersion) ? checkpoint.serverSeq : null;
      if (staleSeq !== null) {
        await this.dropStaleCheckpoint();
        this.reducerDropped = true;
      }
      const snapshot = staleSeq === null ? checkpoint : null;
      if (this.kept && this.lines && !snapshot) {
        // Rows kept on disk belong to a checkpoint; with none here (a first download cut short, a
        // checkpoint dropped or from another reducer) they are not to be trusted.
        await this.commit({ kept: { ...this.stream(), clear: true }, meta: { [this.lines.owedKey()]: '', ...(this.fill?.clear() ?? {}) } });
      }
      if (this.kept && this.lines && snapshot && holdsKept(snapshot.state)) {
        // A checkpoint from before the language kept records on disk: move them there once, with a checkpoint without them.
        // Every checkpoint keeps the entries whose passage cannot be found yet; with only those, there is nothing to move,
        // and working out every line again on each open would cost a big language seconds.
        // It holds the whole language, so rows left on disk from before (a build rolled back and forward again) are
        // older than it: they are replaced, not combined in, in the same write as the checkpoint that leaves them out.
        const split = await this.kept.split(snapshot.state, { whole: true });
        if (split.placed.length > 0) {
          snapshot.state = split.lite;
          this.lines.invalidate();
          await this.commit({ meta: { ...this.snapshotMeta(snapshot).meta, ...this.lines.owed(), ...(this.fill?.clear() ?? {}) }, kept: { ...this.stream(), clear: true, upsert: split.rows } });
        }
      }
      if (this.fill && snapshot && snapshot.reducerVersion !== this.checkpointVersion) {
        // A checkpoint a build without the fill wrote (a whole one, or a kept one of format 1) has every passage's rows:
        // what a fill of before says is still to come belongs to a checkpoint that build dropped (decisions.md 147).
        await this.commit({ meta: this.fill.clear() });
      }
      return this.foldLocal(snapshot, events, { started, readMs, staleSeq, reason });
    });
  }

  /** The end of a load: fold the local log onto `snapshot` (or from empty), bring in what a language kept on disk needs, keep it, record it, publish. */
  private async foldLocal(
    snapshot: Snapshot | null, events: AnyEvent[],
    o: { started: number; readMs: number; staleSeq: number | null; reason: LoadReason }
  ): Promise<S> {
    const folding = this.elapsed();
    this.state = snapshot ? this.resume(snapshot, events) : this.m.fold(events, this.m.empty());
    if (this.kept && this.lines) {
      const lang = this.state as unknown as LanguageState;
      await this.kept.hydrate(lang);
      await this.lines.open();
      await this.fill?.open();
      // The lines of what was folded again (and of what was refused, now out of the fold) are owed,
      // and worked out before anything is shown, so no list reads the language ahead of its lines.
      this.lines.touched(lang, events);
      this.lines.touched(lang, (await this.opts.store.rejected(this.opts.orgId, this.opts.streamId)).map((l) => l.event));
      await this.lines.refresh().catch(() => { /* owed still; the next change tries again */ });
    }
    const foldMs = this.elapsed() - folding;
    this.loaded = true;
    const ms = this.elapsed() - o.started;
    if (this.opening) this.opening.loadMs += ms;
    this.opts.diag?.record('load', {
      ...this.stream(),
      n: {
        ms, events: events.length, fromSnapshot: snapshot ? 1 : 0, readMs: o.readMs, foldMs,
        ...(o.staleSeq !== null ? { staleCheckpointSeq: o.staleSeq } : {})
      },
      t: { reason: o.reason, checkpoint: o.staleSeq !== null ? 'old_reducer' : snapshot ? 'ok' : 'none' }
    });
    this.publish();
    return this.state;
  }

  /**
   * A session is opening this stream for a person: time it from here to the
   * first sync that reads it up to date, and record that once (`open`).
   * Call before `load`. Clients that only fold or push never call it.
   */
  async trackOpen(): Promise<void> {
    const started = this.elapsed();
    const cursor = await this.opts.store.cursor(this.opts.orgId, this.opts.streamId);
    this.opening = { started, cold: cursor === 0, syncs: 0, pulled: 0, snapshotMs: 0, loadMs: 0 };
  }

  /** Run one step of a sync under its name: an error it throws is marked with it, unless a step inside it marked it first. */
  private async inPhase<T>(phase: SyncPhase, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      this.markFailed(err, phase);
      throw err;
    }
  }

  private markFailed(err: unknown, phase: SyncPhase): void {
    if (err && typeof err === 'object' && !this.failedIn.has(err)) this.failedIn.set(err, phase);
  }

  // ---- the single writer and what it publishes ---------------------------

  /** Every store mutation goes through here, one transaction at a time. */
  private commit(batch: WriteBatch): Promise<void> {
    if (batch.meta && Object.keys(batch.meta).length === 0) delete batch.meta;
    if (batch.events?.length === 0) delete batch.events;
    if (Object.keys(batch).length === 0) return Promise.resolve();
    // What the language keeps on disk changed: lookups cached from it are out of date. Lines alone change nothing they read.
    const keptChanged = batch.kept?.streamId === this.opts.streamId
      && (!!batch.kept.clear || batch.kept.replaceFrom !== undefined || (batch.kept.upsert ?? []).some((r) => r.kind !== LINE));
    // A write that fails is the store's failure, whichever step asked for it.
    return this.writer.run(() => this.opts.store.commit(batch)).then(
      () => { if (keptChanged) this.kept?.changed(); },
      (err: unknown) => { this.markFailed(err, 'store'); throw err; }
    );
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

  /** The fold revision `subscribe` publishes, for a screen catching up outside a publish. */
  get publishedRevision(): number {
    return this.revision;
  }

  private publish(): void {
    const snap = {
      state: this.state, revision: this.revision, saving: this.writer.size,
      ...(this.lines ? { lines: this.lines.view() } : {}), ...(this.fill ? { fill: this.fill.progress() } : {})
    };
    for (const l of this.listeners) l(snap);
  }

  /** Each passage's line, for lists: kept beside a language kept on disk, else read off the state. */
  passageLines(): PassageLines {
    return this.lines ? this.lines.view() : languageLines(this.state as unknown as LanguageState);
  }

  /** Events were folded: their passages' lines are owed, worked out once the burst is over. */
  private folded(events: readonly AnyEvent[]): void {
    if (!this.lines) return;
    this.lines.touched(this.state as unknown as LanguageState, events);
    this.scheduleLines(LINES_AFTER_MS);
  }

  private scheduleLines(ms: number): void {
    if (!this.lines) return;
    if (this.linesAt) clearTimeout(this.linesAt);
    this.linesAt = setTimeout(() => {
      this.linesAt = undefined;
      void this.lines?.refresh().then((changed) => { if (changed) this.publish(); }).catch(() => { /* owed again; the next change tries again */ });
    }, ms);
  }

  /** Work out every owed line now (tests, and a screen that must not show a stale list). */
  async settleLines(): Promise<void> {
    if (this.linesAt) { clearTimeout(this.linesAt); this.linesAt = undefined; }
    if (this.lines && await this.lines.refresh()) this.publish();
  }

  /** core `resume` for any materializer: snapshot state plus events after its seq. */
  /**
   * Both callers pass a checkpoint `localSnapshot` has just parsed, which
   * nothing else holds, so its state is folded onto in place: cloning it
   * first copied the whole language on every load and refold
   * (performance-audit.md item 7).
   */
  private resume(snapshot: Snapshot, tail: Iterable<AnyEvent>): S {
    const state = snapshot.state as unknown as S;
    const newer = [...tail].filter((e) => e.serverSeq === undefined || e.serverSeq > snapshot.serverSeq);
    return this.m.fold(newer, state);
  }

  // ---- checkpoints -------------------------------------------------------
  // A checkpoint is a snapshot held locally (PLAN.md invariant 10). Cold start
  // takes the server's; afterwards the device rolls its own every
  // `checkpointEvery` confirmed events and prunes what the checkpoint covers,
  // so replay on launch is bounded by recent history, not stream age.

  private snapshotKey(): string {
    return `snapshot:${this.opts.orgId}/${this.opts.streamId}`;
  }

  /**
   * The checkpoint's reducer version and seq (`12:4810`), kept beside it in
   * the same commit, so a sync learns the seq without parsing the whole
   * language (performance-audit.md item 3). '' when there is no checkpoint.
   */
  private snapshotSeqKey(): string {
    return `snapshotSeq:${this.opts.orgId}/${this.opts.streamId}`;
  }

  /** What writes a checkpoint: the snapshot and, beside it, its seq; and how long the snapshot's text is, for diagnostics. */
  private snapshotMeta(given: Snapshot, stateText?: string): { meta: Record<string, string>; chars: number } {
    // Every local checkpoint carries this client's tag: a kept language's format, not the server's reducer version (`readable`).
    const snap = given.reducerVersion === this.checkpointVersion ? given : { ...given, reducerVersion: this.checkpointVersion };
    // `stateText` is `snap.state` as the server sent it: the row is built around it, byte for byte what
    // `JSON.stringify(snap)` writes, without serializing the language again.
    const text = stateText === undefined
      ? JSON.stringify(snap)
      : `{"orgId":${JSON.stringify(snap.orgId)},"streamId":${JSON.stringify(snap.streamId)},"reducerVersion":${snap.reducerVersion},"serverSeq":${snap.serverSeq},"state":${stateText}}`;
    return { meta: { [this.snapshotKey()]: text, [this.snapshotSeqKey()]: `${snap.reducerVersion}:${snap.serverSeq}` }, chars: text.length };
  }

  /**
   * Can this client read a local checkpoint tagged `version`? Its own tag; and, for a language kept on
   * disk, a whole checkpoint of the same reducer, written before the language was kept on disk (or by a
   * build rolled back to), which `refold` moves onto disk the first time it opens.
   */
  private readable(version: number): boolean {
    if (version === this.checkpointVersion) return true;
    if (!this.kept) return false;
    // A whole checkpoint of this reducer, or a kept one of a format this build reads (a format-1 one is filled).
    return version === this.m.version || KEPT_FORMATS_READ.some((f) => f <= (this.opts.keptFormat ?? KEPT_CHECKPOINT_FORMAT) && version === keptCheckpointVersion(this.m.version, f));
  }

  /** The local checkpoint's seq, or null when there is none for this reducer. */
  private async checkpointSeq(): Promise<number | null> {
    const kept = await this.opts.store.meta(this.snapshotSeqKey());
    if (kept === undefined) {
      // A checkpoint from an app that did not keep the seq: read it once, keep the seq.
      const raw = await this.opts.store.meta(this.snapshotKey());
      if (!raw) return null;
      const snap = JSON.parse(raw) as Snapshot;
      await this.commit({ meta: { [this.snapshotSeqKey()]: `${snap.reducerVersion}:${snap.serverSeq}` } });
      return this.readable(snap.reducerVersion) ? snap.serverSeq : null;
    }
    const [version, seq] = kept.split(':');
    return kept !== '' && this.readable(Number(version)) ? Number(seq) : null;
  }

  private minSnapshotKey(): string {
    return `snapshotMinSeq:${this.opts.orgId}/${this.opts.streamId}`;
  }

  /** The local checkpoint, whichever reducer wrote it. */
  private async storedCheckpoint(): Promise<Snapshot | null> {
    const raw = await this.opts.store.meta(this.snapshotKey());
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  }

  private async localSnapshot(): Promise<Snapshot | null> {
    const snap = await this.storedCheckpoint();
    return snap && this.readable(snap.reducerVersion) ? snap : null;
  }

  /**
   * An update changed the reducer, and the checkpoint is from the old one.
   * This reducer cannot read it (invariant 10), and the events it covers
   * were pruned from the log, so folding what is left gives part of the
   * language, and a checkpoint taken from that would keep it partial for
   * good. Drop the checkpoint and put the cursor back to the start, in one
   * write: the next pull takes the server's snapshot for this reducer, or
   * pulls the whole stream again when there is none (the organization
   * stream never has one). Until then the screen shows the events still
   * here, the person's unsent work among them, as a first download does.
   * Nothing below the cursor is missing again, so no checkpoint can be
   * partial. A redaction waiting on the old checkpoint waits no more: it is
   * gone, and `snapshotMinSeq` still turns away a snapshot from before it.
   * The rows a language keeps on disk and every line came from this
   * checkpoint, so they go with it (decisions.md 143).
   */
  private async dropStaleCheckpoint(): Promise<void> {
    await this.commit({
      meta: { [this.snapshotKey()]: '', [this.snapshotSeqKey()]: '', [this.redactionKey()]: '', ...(this.lines ? { [this.lines.owedKey()]: '' } : {}), ...(this.fill?.clear() ?? {}) },
      cursor: { orgId: this.opts.orgId, streamId: this.opts.streamId, seq: 0 },
      ...(this.kept ? { kept: { ...this.stream(), clear: true } } : {})
    });
  }

  /**
   * Save a checkpoint, move the cursor to it and prune behind it. Answers
   * the length of its text. `stateText` is the state as the server sent it;
   * `kept` and `meta` are what a language kept on disk writes beside the
   * checkpoint, in the same commit (decisions.md 143).
   */
  private async saveSnapshot(
    snap: Snapshot,
    o: { stateText?: string | undefined; kept?: WriteBatch['kept'] | undefined; meta?: Record<string, string> | undefined } = {}
  ): Promise<number> {
    const { orgId, streamId } = this.opts;
    const seq = Math.max(snap.serverSeq, await this.opts.store.cursor(orgId, streamId));
    const { meta, chars } = this.snapshotMeta(snap, o.stateText);
    await this.commit({
      meta: { ...meta, ...(o.meta ?? {}) },
      cursor: { orgId, streamId, seq },
      prune: { orgId, streamId, uptoSeq: snap.serverSeq },
      ...(o.kept ? { kept: o.kept } : {})
    });
    return chars;
  }

  /** Index of saved pieces: which snapshot (seq and reducer version) they belong to and how many there are. */
  private chunkKey(): string {
    return `snapchunks:${this.opts.orgId}/${this.opts.streamId}`;
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
   *
   * The pieces are bookkeeping, not state: they are written straight to the
   * store, past the writer that tells screens a save is under way. Through
   * it, every piece redrew the app twice, and on a 2 GB phone the redraws
   * were three quarters of a 46-second first open of a 40 MB language.
   */
  private adoptServerSnapshot(why: SnapshotWhy): Promise<number> {
    return this.inPhase('snapshot', () => this.fetchServerSnapshot(why));
  }

  /** A `snapshot` record; its fetch time also counts toward the `open` being timed. */
  private recordSnapshot(n: Record<string, number>, outcome: 'ok' | 'none' | 'stale', why: SnapshotWhy): void {
    if (this.opening) this.opening.snapshotMs += n.ms ?? 0;
    this.opts.diag?.record('snapshot', { ...this.stream(), n, t: { outcome, why } });
  }

  private async fetchServerSnapshot(why: SnapshotWhy): Promise<number> {
    const started = this.elapsed();
    const minSeq = Number((await this.opts.store.meta(this.minSnapshotKey())) ?? 0);
    // The server's cut first: the shared part and the lines, then the passages filled in behind (decisions.md 147).
    const cut = await this.adoptServerCut(why, minSeq, started);
    if (cut !== null) return cut;
    const meta = await this.opts.transport.snapshotMeta(this.opts.orgId, this.opts.streamId, this.m.version);
    if (!meta) {
      // A cold device with no snapshot for its reducer folds the whole log: the first thing to check when a first download is slow.
      this.recordSnapshot({ ms: this.elapsed() - started }, 'none', why);
      this.reducerDropped = false;
      this.noSnapshotUntil = this.elapsed() + NO_SNAPSHOT_RECHECK_MS;
      return 0;
    }
    if (meta.serverSeq < minSeq) {
      // Waiting for a snapshot past a redaction: this one is older, so do not
      // download it to find that out (performance-audit.md item 7).
      this.net.pull += this.elapsed() - started;
      this.recordSnapshot({ ms: this.elapsed() - started, seq: meta.serverSeq }, 'stale', why);
      return 0;
    }
    let index: { seq: number; chunks: number; version: number } = { seq: 0, chunks: 0, version: 0 };
    try {
      const parsed = JSON.parse((await this.opts.store.meta(this.chunkKey())) || '{}') as Partial<typeof index>;
      // An older build stored every piece inside this one row; ignore it and refetch.
      if (typeof parsed.seq === 'number' && typeof parsed.chunks === 'number') {
        // A build that kept no reducer version gets 0, which is no reducer's: its pieces are cleared and refetched.
        index = { seq: parsed.seq, chunks: parsed.chunks, version: typeof parsed.version === 'number' ? parsed.version : 0 };
      }
    } catch { /* refetch */ }
    // Pieces already here from a download a dropped link cut short. A language
    // kept on disk only notes which; the text is read again one piece at a time.
    // Pieces are reused only for the same snapshot: a quiet language keeps its seq across an app update, and
    // another reducer's pieces joined to these would parse as garbage or as the wrong state (invariant 10).
    const saved = new Map<number, string>();
    if (index.seq === meta.serverSeq && index.version === this.m.version) {
      for (let i = 0; i < index.chunks; i++) {
        const text = await this.opts.store.meta(this.chunkPieceKey(index.seq, i));
        if (text) saved.set(i, this.kept ? '' : text);
      }
    } else {
      // Pieces of another snapshot are no use: drop them and say whose pieces follow, before any arrives.
      await this.clearChunks(index);
      index = { seq: meta.serverSeq, chunks: meta.chunks, version: this.m.version };
      await this.opts.store.commit({ meta: { [this.chunkKey()]: JSON.stringify(index) } });
    }
    const onChunk = (serverSeq: number, i: number, text: string) => this.opts.store.commit({ meta: { [this.chunkPieceKey(serverSeq, i)]: text } });
    let snap: Snapshot | null;
    let stateText: string | undefined;
    if (this.kept) {
      const complete = await downloadPieces(this.opts.transport, this.opts.orgId, this.opts.streamId, this.m.version, meta, {
        have: (i) => saved.has(i), onChunk, inFlight: SNAPSHOT_PIECES_IN_FLIGHT
      });
      snap = complete ? { orgId: this.opts.orgId, streamId: this.opts.streamId, reducerVersion: this.m.version, serverSeq: meta.serverSeq, state: emptyLanguageState() } : null;
    } else {
      snap = await fetchSnapshot(this.opts.transport, this.opts.orgId, this.opts.streamId, this.m.version, {
        meta, saved, inFlight: SNAPSHOT_PIECES_IN_FLIGHT, onChunk, onJoined: (text) => { stateText = text; }
      });
    }
    // Fetching pieces is waiting on the network; saving and folding them after this is the phone's work (a `load` record).
    this.net.pull += this.elapsed() - started;
    const fetched = { ms: this.elapsed() - started, chunks: meta.chunks, resumedChunks: saved.size, bytes: meta.bytes, seq: meta.serverSeq };
    if (!snap || snap.serverSeq < minSeq) {
      this.recordSnapshot(fetched, 'stale', why);
      return 0;
    }
    this.recordSnapshot(fetched, 'ok', why);
    this.reducerDropped = false;
    let kept: WriteBatch['kept'];
    let owed: Record<string, string> = {};
    if (this.kept && this.lines) {
      // A phone with a language here reads the new copy aside and switches to it with its checkpoint,
      // so dying part-way keeps what it had. A first download has nothing to keep: its rows go in place,
      // since moving 160,000 rows took Koro Miyan 200 s on a test phone (`load` drops rows with no checkpoint).
      const first = (await this.checkpointSeq()) === null;
      const into = first ? this.opts.streamId : this.incomingStream();
      snap.state = await this.readKept(meta.serverSeq, meta.chunks, into);
      // Every passage's line, worked out before the language opens, so no list shows it half known.
      owed = { ...await this.lines.build(snap.state, into), ...(this.fill?.clear() ?? {}) };
      if (!first) kept = { ...this.stream(), replaceFrom: this.incomingStream() };
    }
    await this.clearChunks(index);
    await this.opts.store.commit({ meta: { [this.chunkKey()]: '' } });
    await this.saveSnapshot(snap, { stateText, kept, meta: owed });
    // Rows written in place bypass the commits that say the table changed.
    this.kept?.changed();
    if (this.loaded && !this.kept) {
      // The checkpoint is committed: fold the local tail onto the state already parsed, rather than reading it back and parsing it again.
      await this.inPhase('load', async () => {
        const started = this.elapsed();
        const events = (await this.opts.store.all(this.opts.orgId, this.opts.streamId)).map((l) => l.event);
        await this.foldLocal(snap, events, { started, readMs: this.elapsed() - started, staleSeq: null, reason: 'snapshot' });
      });
    } else {
      // A language kept on disk reads its small checkpoint back and brings the passages on screen in with it.
      await this.refold('snapshot');
    }
    return snap.serverSeq;
  }

  /**
   * A first download from the server's cut (decisions.md 147): what the
   * whole language shares and every passage's line, from the newest
   * snapshot, kept as the checkpoint in one write that replaces whatever
   * the phone kept of the language before; then the Map opens, and the
   * passages' rows are filled in behind. Null when the server has no cut
   * of the newest snapshot, or no lines of this LINES_VERSION that hold at
   * or past it: the whole snapshot is then read in pieces as before.
   *
   * The cursor goes back to the snapshot, even below a checkpoint the
   * phone had (a redaction's new snapshot): the events past it are pulled
   * again, since the rows that held them are gone.
   */
  private async adoptServerCut(why: SnapshotWhy, minSeq: number, started: number): Promise<number | null> {
    const t = this.opts.transport;
    if (!this.kept || !this.lines || !this.fill?.possible || !t.snapshotHead) return null;
    const head = await t.snapshotHead(this.opts.orgId, this.opts.streamId, this.m.version, LINES_VERSION, true);
    this.net.pull += this.elapsed() - started;
    if (!head || head.shared === undefined || !head.lines || head.lines.seq < head.serverSeq) return null;
    const lines = head.lines;
    const bytes = JSON.stringify(head).length;
    if (head.serverSeq < minSeq) {
      this.recordSnapshot({ ms: this.elapsed() - started, seq: head.serverSeq }, 'stale', why);
      return 0;
    }
    this.recordSnapshot({ ms: this.elapsed() - started, chunks: 0, resumedChunks: 0, bytes, seq: head.serverSeq }, 'ok', why);
    this.reducerDropped = false;
    const shared = head.shared as LanguageState;
    shared.appliedEventIds ??= {};
    const serverLines = lines.lines as PassageLine[];
    const snap: Snapshot = { orgId: this.opts.orgId, streamId: this.opts.streamId, reducerVersion: this.m.version, serverSeq: head.serverSeq, state: shared };
    const { orgId, streamId } = this.opts;
    // Pieces of a whole-snapshot download cut short are no use now.
    await this.dropChunks();
    await this.commit({
      meta: { ...this.snapshotMeta(snap).meta, ...this.lines.adopt(serverLines, shared), ...this.fill.begin({ ...head, lines }) },
      cursor: { orgId, streamId, seq: head.serverSeq },
      prune: { orgId, streamId, uptoSeq: head.serverSeq },
      kept: { ...this.stream(), clear: true, upsert: serverLines.map(lineRow) }
    });
    // The Map opens on the shared part and the lines.
    await this.refold('snapshot');
    // Passages the phone's own events touch (its unsent work, events pulled before) are filled in while the link is up.
    try {
      if ((await this.fill.fillWanted()).length > 0) await this.afterFill();
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
    }
    return head.serverSeq;
  }

  /** Lines of passages just filled in are worked out, and screens told. */
  private async afterFill(): Promise<void> {
    this.revision += 1;
    await this.lines?.refresh().catch(() => { /* owed still; the next change tries again */ });
    this.publish();
  }

  /** Forget pieces kept from a whole-snapshot download. */
  private async dropChunks(): Promise<void> {
    try {
      const parsed = JSON.parse((await this.opts.store.meta(this.chunkKey())) || '{}') as { seq?: number; chunks?: number };
      if (typeof parsed.seq === 'number' && typeof parsed.chunks === 'number') await this.clearChunks({ seq: parsed.seq, chunks: parsed.chunks });
    } catch { /* nothing to clear */ }
    await this.opts.store.commit({ meta: { [this.chunkKey()]: '' } });
  }

  /** Where a fresh snapshot's kept records are written until its checkpoint switches to them. */
  private incomingStream(): string {
    return `${this.opts.streamId}#incoming`;
  }

  /**
   * Read a downloaded snapshot back one piece at a time, writing each
   * passage's records and the file verdicts to disk as they pass
   * (decisions.md 143). Returns what the whole language shares, which is
   * what memory keeps. The records go under a stream id of their own, and
   * the checkpoint that follows moves them in, so a phone that dies part-way
   * still has the language it had.
   */
  private async readKept(serverSeq: number, chunks: number, streamId: string): Promise<LanguageState> {
    const incoming = { orgId: this.opts.orgId, streamId };
    await this.opts.store.commit({ kept: { ...incoming, clear: true } });
    let rows: KeptRecord[] = [];
    const placing = new SnapshotRows();
    const splitter = stateSplitter(SPLIT_MAPS, (map, id, json) => { rows.push(...placing.entry(map, id, json)); });
    for (let i = 0; i < chunks; i++) {
      const text = await this.opts.store.meta(this.chunkPieceKey(serverSeq, i));
      if (!text) throw new Error(`snapshot piece ${i} of ${chunks} is missing`);
      splitter.push(text);
      if (rows.length >= KEPT_ROWS_PER_COMMIT) {
        await this.opts.store.commit({ kept: { ...incoming, upsert: rows } });
        rows = [];
      }
    }
    const lite = JSON.parse(splitter.end()) as LanguageState;
    // What waited for what it hangs on finds its passage now; what has none stays with the language.
    rows.push(...placing.end(lite));
    for (let i = 0; i < rows.length; i += KEPT_ROWS_PER_COMMIT) await this.opts.store.commit({ kept: { ...incoming, upsert: rows.slice(i, i + KEPT_ROWS_PER_COMMIT) } });
    return lite;
  }

  private async clearChunks(index: { seq: number; chunks: number }): Promise<void> {
    const meta: Record<string, string> = {};
    for (let i = 0; i < index.chunks; i++) meta[this.chunkPieceKey(index.seq, i)] = '';
    if (index.chunks > 0) await this.opts.store.commit({ meta });
  }

  /**
   * Roll the confirmed prefix into a local checkpoint and prune it, and
   * record what that cost (`checkpoint`): it serializes the whole state, so
   * on a big language it is the phone's longest single piece of work.
   */
  private async checkpoint(cursor: number): Promise<void> {
    await this.inPhase('checkpoint', async () => {
      const { orgId, streamId } = this.opts;
      const counting = this.opts.diag?.isEnabled ?? false;
      const before = counting ? await this.opts.store.count(orgId, streamId) : 0;
      const started = this.elapsed();
      const taken = await this.takeCheckpoint(cursor);
      const ms = this.elapsed() - started;
      if (!counting || !taken) return;
      const { chars, path } = taken;
      const pruned = Math.max(0, before - (await this.opts.store.count(orgId, streamId)));
      this.opts.diag?.record('checkpoint', { ...this.stream(), n: { ms, kb: Math.round(chars / 1024), seq: cursor, pruned }, t: { path } });
    });
  }

  /** Null when nothing was written: something was folded while the stored copies were read, and the next pull tries again. */
  private async takeCheckpoint(cursor: number): Promise<{ chars: number; path: 'fast' | 'slow' } | null> {
    // With nothing pending, the live state is the confirmed fold up to the
    // cursor (a rejection or redaction refolds it from the log). Save it as
    // is: parsing the last checkpoint, cloning it and replaying onto it held
    // the state four times over. A local append during the await, or one not
    // yet on disk, would put a pending event in it; then take the slow path.
    const revision = this.revision;
    const pending = await this.opts.store.pendingCount(this.opts.orgId, this.opts.streamId);
    if (pending === 0 && this.writer.size === 0 && revision === this.revision) {
      const live = this.state;
      let state = { ...live } as unknown as LanguageState;
      this.m.compact(state as unknown as S);
      let kept: WriteBatch['kept'];
      let placed: Awaited<ReturnType<KeptLanguage['split']>>['placed'] = [];
      let owed: Record<string, string> = {};
      if (this.kept && this.lines) {
        // Each passage's records and the verdicts go to disk with this checkpoint (decisions.md 143), taken as they are now.
        const split = await this.kept.split(state);
        // Something was folded while the stored copies were read: the state is no longer the confirmed one; next time.
        if (revision !== this.revision || this.writer.size !== 0) return null;
        state = split.lite;
        placed = split.placed;
        kept = { ...this.stream(), upsert: split.rows };
        // The lines still owed: the events that owe them are pruned here.
        owed = this.lines.owed();
      }
      const snap: Snapshot = {
        orgId: this.opts.orgId, streamId: this.opts.streamId, reducerVersion: this.m.version, serverSeq: cursor, state
      };
      const { orgId, streamId } = this.opts;
      const { meta, chars } = this.snapshotMeta(snap);
      await this.commit({
        meta: { ...meta, ...owed },
        prune: { orgId, streamId, uptoSeq: cursor },
        ...(kept ? { kept } : {})
      });
      // Memory lets go of what is on disk now and not open, unless something was folded meanwhile.
      if (this.kept && revision === this.revision && this.state === live) this.kept.shed(live as unknown as LanguageState, placed);
      else this.kept?.stored(placed);
      return { chars, path: 'fast' };
    }
    const base = (await this.localSnapshot()) ?? {
      orgId: this.opts.orgId,
      streamId: this.opts.streamId,
      reducerVersion: this.m.version,
      serverSeq: 0,
      state: this.m.empty() as unknown as LanguageState
    };
    const confirmed = (await this.opts.store.all(this.opts.orgId, this.opts.streamId))
      .filter((l) => l.status === 'confirmed')
      .map((l) => l.event);
    const state = this.resume(base, confirmed);
    this.m.compact(state);
    if (this.kept && this.lines) {
      const split = await this.kept.split(state as unknown as LanguageState);
      const chars = await this.saveSnapshot({ ...base, serverSeq: cursor, state: split.lite }, { kept: { ...this.stream(), upsert: split.rows }, meta: this.lines.owed() });
      this.kept.stored(split.placed);
      return { chars, path: 'slow' };
    }
    return { chars: await this.saveSnapshot({ ...base, serverSeq: cursor, state: state as unknown as LanguageState }), path: 'slow' };
  }

  /**
   * Hold these passages' recordings in memory, for a screen that shows them
   * and the passages next to it (decisions.md 143). A language that keeps
   * everything in memory has nothing to do.
   */
  async loadUnits(unitIds: readonly string[]): Promise<void> {
    if (!this.kept || !this.loaded) return;
    if (await this.kept.load(this.state as unknown as LanguageState, unitIds)) {
      this.revision += 1;
      this.publish();
    }
    // A passage whose rows are still on the server is filled in now, if the server can be reached (decisions.md 147).
    if (this.fill?.active() && this.kept.wantedUnits().length > 0) {
      await this.exclusive(async () => {
        if ((await this.fill!.fillWanted()).length > 0) await this.afterFill();
      }).catch(() => { /* offline: the screen says the passage is not on this device yet */ });
    }
  }

  /** Are all this passage's rows on this device (decisions.md 147)? Always, for a language held in memory or filled in. */
  isFilled(unitId: string): boolean {
    return !this.kept || this.kept.isFilled(unitId);
  }

  /** Passages filled in of those the server has rows for, while a fill runs; null otherwise. */
  fillProgress(): { filled: number; total: number } | null {
    return this.fill?.progress() ?? null;
  }

  /** What this language keeps on disk, for the file planner; null when it keeps everything in memory. */
  keptRecords(): KeptLanguage | null {
    return this.kept;
  }

  /** Is this passage's whole record in memory? Always, for a language held whole in memory. */
  isLoaded(unitId: string): boolean {
    return !this.kept || this.kept.isLoaded(unitId);
  }

  /**
   * The language with these passages' records read in from disk: for a
   * screen that lists a few passages beyond those in memory (a key term's
   * uses, the Inbox). A language held whole in memory answers with its state.
   */
  async withPassages(unitIds: readonly string[], kinds: readonly string[] = PART_KINDS): Promise<LanguageState> {
    const lang = this.getState() as unknown as LanguageState;
    return this.kept ? this.kept.view(lang, unitIds, kinds) : lang;
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
      streamId: this.opts.streamId,
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
   * before the disk is touched, then commit the events and the clock as one
   * write. The promise resolves when that commit is durable ("saved
   * locally"); until then `saving` is above zero.
   */
  private async applyLocal(events: AnyEvent[]): Promise<void> {
    for (const event of events) {
      const tooLarge = eventSizeError(event);
      if (tooLarge) throw new EventTooLargeError(`${event.type}: ${tooLarge}`);
    }
    for (const event of events) this.state = this.m.apply(this.state, event);
    this.folded(events);
    // The writer publishes as soon as the commit is queued, carrying this
    // revision and saving > 0: the screen moves now, and can say "saved"
    // only once the queue drains.
    this.revision += 1;
    try {
      await this.commit({
        events: events.map((event) => ({ event, status: 'pending' as const })),
        meta: this.clockMeta()
      });
    } catch (err) {
      await this.refold('other');
      throw err;
    }
    // Redacting something already folded needs a refold to take effect.
    if (events.some((e) => e.type === 'v1.Redacted')) await this.refold('redaction');
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
          streamId: this.opts.streamId,
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
    return `redactionPending:${this.opts.orgId}/${this.opts.streamId}`;
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
   * Syncs, pushes, pulls and refolds of one stream on one phone run one at a
   * time, whichever client starts them. Two syncs at once (the scheduler's
   * and a "sync now") each sent the same pending events: the server took the
   * first copy and refused the second, whose take id it found already used,
   * and the client marked the take refused and folded it out, though the
   * server had it (REC-016). A refold in one while the other pulled could
   * likewise drop the page being pulled. Two clients at once (a session
   * closed mid-download and the one reopened) would each download a first
   * snapshot, and a language kept on disk would lose the rows each clears
   * for the other, so the turn is kept per store and stream, not per client.
   */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    let byStream = TURNS.get(this.opts.store);
    if (!byStream) TURNS.set(this.opts.store, (byStream = new Map()));
    const key = `${this.opts.orgId}/${this.opts.streamId}`;
    const run = (byStream.get(key) ?? Promise.resolve()).then(work, work);
    byStream.set(key, run.catch(() => undefined));
    return run;
  }

  /**
   * Push pending events, at most `pushBatchesPerRun` batches. The outbox is
   * read one page at a time, never whole. Returns how many were accepted
   * and rejected, and whether pending work remains.
   */
  push(): Promise<{ accepted: number; rejected: number; more: boolean }> {
    return this.exclusive(() => this.pushNow());
  }

  private async pushNow(): Promise<{ accepted: number; rejected: number; more: boolean }> {
    let accepted = 0;
    let rejected = 0;
    let more = false;
    const clockAhead: { local: LocalEvent; reason: string }[] = [];
    // A new language's events refused because its organization stream had
    // not arrived yet: send them again now; the server decides.
    const requeued = this.opts.deliverOnly ? 0 : await this.requeue(['NOT_LISTED']);
    try {
      let afterHlc: string | null = null;
      for (let batches = 0; ; ) {
        // Only this actor's events. A shared device may hold another user's
        // queued events; pushing them under this session would be rejected
        // (actorId must match the caller) and wrongly marked as refused.
        const page = await this.opts.store.pendingPage(this.opts.orgId, this.opts.streamId, afterHlc, this.pushBatchSize);
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
        let notListed = false;
        for (const r of results) {
          const local = batch.find((p) => p.event.id === r.id);
          if (!local) continue;
          const code = r.accepted ? null : rejectCodeOf(r.reason ?? undefined);
          if (code) {
            const field = REJECT_FIELD[code];
            this.refusals[field] = (this.refusals[field] ?? 0) + 1;
          }
          if (code === 'NOT_LISTED') notListed = true;
          if (r.accepted) {
            accepted += 1;
            writes.push({
              event: { ...local.event, serverSeq: r.serverSeq ?? undefined } as AnyEvent,
              status: 'confirmed'
            });
          } else if (code === 'CLOCK_AHEAD') {
            // Not a refusal of the intent, only of its timestamp. Handled below.
            clockAhead.push({ local, reason: r.reason ?? '' });
          } else {
            rejected += 1;
            writes.push({ event: local.event, status: 'rejected', rejectReason: r.reason ?? 'rejected' });
          }
        }
        await this.commit({ events: writes });
        // The server refuses the whole stream until the language is listed:
        // the rest would be refused too, and reporting more would run sync
        // again at once, refolding each time (performance-audit.md item 7).
        // The next push asks again.
        if (notListed) break;
      }
      if (clockAhead.length > 0 && !this.opts.deliverOnly) await this.restamp(clockAhead);
    } finally {
      // A rejection means the fold contains something the server refused.
      // Refold from the log; the rejected event is excluded by `all()`.
      // Re-queued events left the fold when they were refused: refold to bring them back.
      if (!this.opts.deliverOnly && (rejected > 0 || clockAhead.length > 0 || requeued > 0)) {
        await this.refold(rejected > 0 || clockAhead.length > 0 ? 'rejected' : 'requeue');
      }
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
  retryRejected(
    codes: readonly RejectCode[] = ['NOT_MEMBER', 'NOT_ALLOWED', 'NOT_LISTED', 'UNKNOWN'],
    reason: LoadReason = 'requeue'
  ): Promise<number> {
    return this.exclusive(() => this.retryNow(codes, reason));
  }

  private async retryNow(codes: readonly RejectCode[], reason: LoadReason = 'requeue'): Promise<number> {
    const n = await this.requeue(codes);
    if (n > 0) {
      this.requeuedSinceRecord += n;
      await this.refold(reason);
    }
    return n;
  }

  /** Mark this actor's refusals with these codes pending again; the caller refolds. */
  private async requeue(codes: readonly RejectCode[]): Promise<number> {
    const mine = (await this.opts.store.rejected(this.opts.orgId, this.opts.streamId)).filter(
      (l) => l.event.actorId === this.opts.actorId && codes.includes(rejectCodeOf(l.rejectReason))
    );
    if (mine.length === 0) return 0;
    await this.commit({ events: mine.map((l) => ({ event: l.event, status: 'pending' as const })) });
    return mine.length;
  }

  /** Pull the whole stream's tail and fold it. Returns number of new events. */
  pull(): Promise<number> {
    return this.exclusive(async () => {
      let total = 0;
      for (;;) {
        const r = await this.pullNow(Infinity);
        total += r.pulled;
        if (!r.more) return total;
      }
    });
  }

  /**
   * Pull pages until caught up or `budgetMs` of wall time has passed.
   * `more` says the budget ended it; `sync()` reports that so the scheduler
   * runs again at once instead of waiting for the next poll.
   */
  pullSlice(budgetMs: number = this.pullBudgetMs): Promise<{ pulled: number; more: boolean }> {
    return this.exclusive(() => this.pullNow(budgetMs));
  }

  private async pullNow(budgetMs: number): Promise<{ pulled: number; more: boolean }> {
    if (await this.resolvePendingRedaction()) return await this.pullNow(budgetMs);
    const started = this.wall();
    let after = await this.opts.store.cursor(this.opts.orgId, this.opts.streamId);
    // A stream with nothing yet would ask for a snapshot on every sync; ask again after a while.
    if (after === 0 && this.elapsed() >= this.noSnapshotUntil && (await this.checkpointSeq()) === null) {
      after = await this.adoptServerSnapshot(this.reducerDropped ? 'reducer' : 'cold');
    }
    let total = 0;
    let more = false;
    let redacted = false;
    let redactedInsideCheckpoint = false;
    /** The newest redaction whose target is inside the checkpoint: a snapshot at or past it will do. */
    let redactionSeq = 0;
    let membershipChanged = false;
    let base = (await this.checkpointSeq()) ?? 0;
    for (;;) {
      const asked = this.elapsed();
      const page = await this.opts.transport.pull(
        this.opts.orgId,
        this.opts.streamId,
        after,
        this.pullPageSize
      );
      this.net.pull += this.elapsed() - asked;
      this.net.pages += 1;
      // Passages this page has news of past the server's lines are filled in before it is folded, so no list shows them stale.
      if (this.fill?.active()) {
        const asking = this.elapsed();
        await this.fill.beforeFold(page);
        this.net.pull += this.elapsed() - asking;
      }
      const writes: LocalEvent[] = [];
      let folded = 0;
      for (const event of page) {
        const seq = event.serverSeq;
        if (seq === undefined) continue;
        // Upsert: a pending event of ours whose ack was lost becomes confirmed.
        writes.push({ event, status: 'confirmed' });
        this.clock.receive(event.hlc);
        this.state = this.m.apply(this.state, event);
        folded += 1;
        if (event.type === 'v1.Redacted') {
          redacted = true;
          // The target is not in the local log: it lives inside the checkpoint,
          // which cannot be edited. Only a fresh snapshot removes it. So too
          // when rows the fill brought hold it, or the server's lines of
          // passages not filled in yet do (decisions.md 147).
          const target = await this.opts.store.get(event.payload.eventId);
          const fromServer = this.fill ? Math.max(this.fill.rowsSeq, this.fill.active() ? this.fill.linesSeq : 0) : 0;
          if (!target || (target.event.serverSeq ?? Infinity) <= fromServer) {
            redactedInsideCheckpoint = true;
            redactionSeq = Math.max(redactionSeq, seq);
          }
        }
        // What this actor may do changed: their membership, or a role's privileges.
        if (((event.type === 'v1.MemberAdded' || event.type === 'v1.MemberRemoved') && event.payload.profileId === this.opts.actorId)
          || event.type === 'v1.RoleDefined' || event.type === 'v1.RoleRetired') {
          membershipChanged = true;
        }
        after = Math.max(after, seq);
        total += 1;
      }
      // One page, one transaction: events, cursor and clock. A crash between
      // them cannot leave the cursor ahead of the log.
      if (folded > 0) {
        // Lines catch up before the page is shown: a list never reads a passage ahead of its line.
        this.lines?.touched(this.state as unknown as LanguageState, page);
        await this.lines?.refresh().catch(() => { /* owed still; the next change tries again */ });
        this.revision += 1;
      }
      await this.commit({
        events: writes,
        cursor: { orgId: this.opts.orgId, streamId: this.opts.streamId, seq: after },
        meta: this.clockMeta()
      });
      this.opts.onPullProgress?.(total);
      // A language kept on disk checkpoints as it goes (decisions.md 143): its checkpoint is the small shared
      // part, and each one moves the passages folded so far onto disk and out of memory, so a pull of the whole
      // log from the start (a reducer bump before the server has a snapshot for it, a redaction waited out)
      // never holds the whole language. Not once a redaction was pulled in this slice: the refold below undoes
      // its target from the log, and a checkpoint before that would prune the target and keep its effects.
      if (this.kept && !redacted && folded > 0 && after - base >= this.checkpointEvery && !this.opts.deferCheckpoint?.()) {
        await this.checkpoint(after);
        base = after;
      }
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
      // Past the redaction, not past what this slice pulled: a snapshot taken
      // right after the redaction excludes the target, and the events after
      // it are already here (performance-audit.md item 7).
      await this.commit({ meta: { [this.minSnapshotKey()]: String(redactionSeq), [this.redactionKey()]: JSON.stringify({ seq: redactionSeq, since: this.wall() }) } });
      if (await this.resolvePendingRedaction()) {
        const rest = await this.pullNow(budgetMs);
        return { pulled: total + rest.pulled, more: rest.more };
      }
      await this.refold('redaction');
      return { pulled: total, more };
    }
    // A redaction may target an event already folded; only a refold undoes it.
    if (redacted) await this.refold('redaction');
    // Still catching up: a language held whole in memory skips the checkpoint
    // (it serializes the whole state) and takes one when the tail is reached;
    // nothing is pruned before it, so a crash mid-catch-up only costs a longer
    // fold on launch. A language kept on disk checkpointed as it went (above).
    if (!more && after - base >= this.checkpointEvery && !this.opts.deferCheckpoint?.()) await this.checkpoint(after);
    // Our membership changed on the server: work refused for membership
    // reasons may be acceptable now. Queue it; the next push decides. The
    // app passes the news on to its language clients.
    if (membershipChanged) {
      await this.retryNow(['NOT_MEMBER', 'NOT_ALLOWED'], 'membership');
      this.opts.onMembershipChanged?.();
    }
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
      adopted = await this.adoptServerSnapshot('redaction');
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
    }
    if (adopted >= seq && adopted > 0) {
      await this.commit({ meta: { [this.redactionKey()]: '' } });
      return true;
    }
    if (this.wall() - since < SyncClient.REDACTION_SNAPSHOT_WAIT_MS) return false;
    await this.commit({
      meta: { [this.redactionKey()]: '', [this.snapshotKey()]: '', [this.snapshotSeqKey()]: '' },
      cursor: { orgId: this.opts.orgId, streamId: this.opts.streamId, seq: 0 },
      // What was kept on disk came from the checkpoint dropped here, and so did every line.
      ...(this.kept ? { kept: { ...this.stream(), clear: true } } : {}),
      ...(this.lines ? { meta: { [this.redactionKey()]: '', [this.snapshotKey()]: '', [this.snapshotSeqKey()]: '', [this.lines.owedKey()]: '' } } : {})
    });
    await this.refold('redaction');
    return true;
  }

  /**
   * Push then pull. Everything stays queued unless the server accepted it, so
   * each outcome is reported rather than guessed at by the caller:
   *
   * - `offline`: the request never reached the server. Only this means the
   *   device is offline.
   * - `refused`: the server answered and refused this actor (not a member
   *   who may read the stream). The device is online; more syncing will not help until
   *   membership or the session changes.
   * - `tooOld`: the server no longer accepts this client's protocol version.
   *
   * A sign-in that could not be renewed (`UnrenewedError`) is offline here
   * too; only its `sync` record says `unrenewed`.
   *
   * One runs at a time (`exclusive`). Asked for while one runs, a sync
   * starts after it, so it sends what was written before it was asked for.
   */
  sync(): Promise<SyncResult> {
    this.nextSync ??= this.exclusive(() => {
      this.nextSync = null;
      return this.syncNow();
    });
    return this.nextSync;
  }

  private async syncNow(): Promise<SyncResult> {
    const idle = { pushed: 0, rejected: 0, pulled: 0, tooOld: false, offline: false, refused: null, more: false, filling: false };
    const started = this.elapsed();
    this.net = { push: 0, pull: 0, pages: 0 };
    this.refusals = {};
    if (this.opening) this.opening.syncs += 1;
    let result: SyncResult;
    let unrenewed = false;
    try {
      const { accepted, rejected, more: morePush } = await this.inPhase('push', () => this.pushNow());
      const { pulled, more: morePull } = await this.inPhase('pull', () => this.pullNow(this.pullBudgetMs));
      // Up to date: passages a screen or this phone's own work asked for are filled in now (decisions.md 147); the rest by `fillSome`.
      if (!morePull && this.fill?.active() && this.kept?.wantedUnits().length) {
        if ((await this.inPhase('snapshot', () => this.fill!.fillWanted())).length > 0) await this.afterFill();
      }
      result = { ...idle, pushed: accepted, rejected, pulled, more: morePush || morePull, filling: !!this.fill?.active() };
    } catch (err) {
      unrenewed = err instanceof UnrenewedError;
      if (err instanceof OfflineError) result = { ...idle, offline: true };
      else if (err instanceof ClientTooOldError) result = { ...idle, tooOld: true };
      else if (err instanceof NotAuthorizedError) result = { ...idle, refused: err.message };
      else {
        const code = diagCodeOf(err);
        await this.recordSync(started, idle, 'error', {
          error: err instanceof Error ? err.name : 'non-error',
          phase: (typeof err === 'object' && err !== null ? this.failedIn.get(err) : undefined) ?? 'push',
          ...(code ? { code } : {})
        });
        throw err;
      }
    }
    const outcome = result.offline ? (unrenewed ? 'unrenewed' : 'offline') : result.tooOld ? 'too_old' : result.refused !== null ? 'refused' : 'ok';
    await this.recordSync(started, result, outcome);
    this.recordOpen(result);
    return result;
  }

  /**
   * Fill in passages' rows for a while, once a sync has read the language up
   * to date (decisions.md 147): what a screen or this phone's own work asked
   * for, then `fillFirst` (the person's offline scope), then the rest. A
   * session calls it between syncs while `filling`, so audio transfers,
   * which wait while a sync pulls, share the link with it.
   */
  fillSome(budgetMs: number = this.fillBudgetMs): Promise<{ filled: number; filling: boolean; offline: boolean }> {
    return this.exclusive(async () => {
      if (!this.fill?.active() || !this.loaded) return { filled: 0, filling: false, offline: false };
      try {
        const filled = await this.inPhase('snapshot', () => this.fill!.step(budgetMs, this.opts.fillFirst, this.elapsed));
        if (filled.length > 0) await this.afterFill();
        return { filled: filled.length, filling: this.fill.active(), offline: false };
      } catch (err) {
        if (err instanceof OfflineError) return { filled: 0, filling: this.fill.active(), offline: true };
        throw err;
      }
    });
  }

  /** The first sync since `trackOpen` that read the stream up to date: what opening it cost, once. */
  private recordOpen(r: SyncResult): void {
    const o = this.opening;
    if (!o) return;
    o.pulled += r.pulled;
    if (r.offline || r.tooOld || r.refused !== null || r.more) return;
    this.opening = null;
    this.opts.diag?.record('open', {
      ...this.stream(),
      n: { ms: this.elapsed() - o.started, syncs: o.syncs, pulled: o.pulled, snapshotMs: o.snapshotMs, loadMs: o.loadMs },
      t: { cold: o.cold ? 'yes' : 'no' }
    });
  }

  /**
   * One record per sync worth knowing about: it moved something, it was
   * slow, it ended a quiet spell, or its outcome changed. A phone polling a
   * dead radio every few minutes for a month writes one record an hour, not
   * thousands. Never throws: a diagnostics failure must not fail a sync.
   */
  private async recordSync(
    started: number,
    r: SyncResult,
    outcome: string,
    failure: { error?: string; code?: string; phase?: SyncPhase } = {}
  ): Promise<void> {
    const diag = this.opts.diag;
    if (!diag?.isEnabled) return;
    try {
      const now = this.elapsed();
      const ms = now - started;
      const repeat = this.lastOutcome?.outcome === outcome && now - this.lastOutcome.at < REPEAT_OUTCOME_MS;
      // A sign-in that cannot be renewed keeps the phone off the server as surely as no signal: one spell.
      const away = outcome === 'offline' || outcome === 'unrenewed';
      const offlineMs = !away && this.offlineSince !== null ? now - this.offlineSince : undefined;
      if (away) this.offlineSince ??= started;
      else this.offlineSince = null;
      const moved = r.pushed + r.pulled + r.rejected + this.requeuedSinceRecord > 0;
      const worth = outcome === 'ok' ? moved || ms >= SLOW_SYNC_MS || offlineMs !== undefined || this.lastOutcome?.outcome !== 'ok' : !repeat;
      if (!worth) return;
      this.lastOutcome = { outcome, at: now };
      const netMs = this.net.push + this.net.pull;
      const requeued = this.requeuedSinceRecord;
      this.requeuedSinceRecord = 0;
      diag.record('sync', {
        ...this.stream(),
        n: {
          ms,
          pushNetMs: this.net.push,
          pullNetMs: this.net.pull,
          applyMs: Math.max(0, ms - netMs),
          pushed: r.pushed,
          rejected: r.rejected,
          ...this.refusals,
          requeued,
          pulled: r.pulled,
          pages: this.net.pages,
          more: r.more ? 1 : 0,
          pending: await this.pendingCount(),
          ...(offlineMs !== undefined ? { offlineMs } : {})
        },
        t: { outcome, ...failure }
      });
    } catch { /* diagnostics never fail a sync */ }
  }

  private stream(): { orgId: string; streamId: string } {
    return { orgId: this.opts.orgId, streamId: this.opts.streamId };
  }

  /** The local log as the sync status screen shows it. */
  async inspect(): Promise<SyncInspection> {
    const { orgId, streamId } = this.opts;
    const [pending, rejected, total, cursor, checkpointSeq] = await Promise.all([
      this.opts.store.pending(orgId, streamId),
      this.opts.store.rejected(orgId, streamId),
      this.opts.store.count(orgId, streamId),
      this.opts.store.cursor(orgId, streamId),
      this.checkpointSeq()
    ]);
    return { pending, rejected, total, cursor, checkpointSeq };
  }

  /**
   * This session's own unsent events: what it can still deliver. Another
   * person's queued events on a shared phone are theirs to send (push skips
   * them), so they are never "waiting to send" here and never hold up this
   * person's sign-out (decisions.md 11, 12).
   */
  async pendingCount(): Promise<number> {
    return this.opts.store.pendingCountBy(this.opts.orgId, this.opts.streamId, this.opts.actorId);
  }

  /** Events of this stream the server refused, kept in the log (invariant 1): what the person must be told about. */
  async refusedCount(): Promise<number> {
    return (await this.opts.store.rejected(this.opts.orgId, this.opts.streamId)).length;
  }
}
