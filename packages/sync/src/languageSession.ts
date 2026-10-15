import {
  audioFormatsFor, defaultOfflineScope, deriveDownloadWork, deriveUploadWork, evictableBlobs,
  type BlobRef, type EventPayloads, type EventSpec, type EventType, type LanguageState
} from '@langquest-next/core';
import { SyncClient, type SyncClientOptions, type SyncResult } from './syncClient';
import { SyncScheduler } from './syncScheduler';
import { DOWNLOAD_DEFAULTS, TransferWorker, UPLOAD_DEFAULTS, type TransferBudget } from './transferWorker';
import type { EventStore, SyncInspection, Transport } from './types';

/** The files a language's recordings are kept in on this device: the phone's blob store, a fake in tests. */
export interface LocalFiles {
  /** Hashes of the files here now. */
  snapshot(): ReadonlySet<string>;
  sizes(): ReadonlyMap<string, number>;
  sizeOf(hash: string): number | undefined;
  /** The format a file was stored in, which can differ from the one asked for (WAV on a browser without MP4). */
  formatOf(hash: string): string | undefined;
  /** Give back files the server still has, until the limits hold. */
  reclaim(evictable: readonly BlobRef[], limits: { minFreeBytes: number; maxTotalBytes: number }): unknown;
  onChange(listener: () => void): () => void;
}

/** What a screen shows about a language's sync, beyond its state. */
export interface LanguageStatus {
  /** Fold revision, bumped on every local or pulled change. */
  revision: number;
  /** Events not yet accepted by the server. */
  pending: number;
  /** Events the server refused. */
  refusedEvents: number;
  /** The last sync's outcome, for the sync screen and diagnostics. */
  lastSync: string;
  /** Did the server answer? null until the first sync attempt. A refusal is an answer. */
  online: boolean | null;
  /** The server refuses this app version. */
  tooOld: boolean;
  /** The server refused this actor for this language, with its reason. */
  refused: string | null;
  /** Read up to date from the server at least once this session. */
  pulled: boolean;
  /** The realtime channel is up. */
  live: boolean;
  pendingUp: number;
  pendingDown: number;
  /** Highest pending count since the queue was last empty: a progress bar's denominator. */
  peakUp: number;
  peakDown: number;
  /** Hashes of the files on this device now. */
  present: ReadonlySet<string>;
  /** Units this person chose to keep offline, beyond their own work. */
  keptUnits: ReadonlySet<string>;
}

export interface LanguageSessionOptions {
  orgId: string;
  languageId: string;
  actorId: string;
  deviceId: string;
  store: EventStore;
  transport: Transport;
  files: LocalFiles;
  /** Send one recording to the server, and fetch one; each rejects when it could not. */
  upload: (ref: BlobRef) => Promise<void>;
  download: (ref: BlobRef) => Promise<void>;
  /** One budget per device, shared by every language's workers. */
  budget?: TransferBudget;
  /** Keep this much free for recording, and cap the cache. */
  limits: { minFreeBytes: number; maxTotalBytes: number };
  /** Recording and local saves come first: transfers and checkpoints wait while this is true. */
  isDeferred?: () => boolean;
  /** Passed to the SyncClient. */
  client?: Pick<SyncClientOptions, 'newId' | 'yieldBetweenPages' | 'diag' | 'clock' | 'now'>;
  /** Wraps every `client.sync()`, for a test-state probe. */
  aroundSync?: (run: () => Promise<SyncResult>) => Promise<SyncResult>;
  /** A sync left nothing of this device's own to send: a moment to send diagnostics. */
  onSettled?: (o: { blobsWanted: number }) => void;
  /** Poll interval and backoff for the scheduler; its defaults otherwise. */
  scheduler?: { pollMs?: number };
}

const keepKey = (orgId: string, languageId: string) => `keep:${orgId}/${languageId}`;

/**
 * One language's stream on this device, kept and moved (decisions.md 37,
 * 104): its SyncClient, the upload and download workers for its
 * recordings, the scheduler that decides when to sync, the realtime
 * watch, storage reclaim, and which units are kept offline. Platform
 * pieces (the store, transport, files and transfers) are passed in.
 *
 * `open` loads the log; `start` begins syncing and transferring; `close`
 * stops everything. A screen subscribes and reads `state` and `status`.
 */
export class LanguageSession {
  private readonly listeners = new Set<() => void>();
  private readonly up: TransferWorker;
  private readonly down: TransferWorker;
  private readonly scheduler: SyncScheduler;
  private readonly stops: (() => void)[] = [];
  private pulling = false;
  private current: LanguageStatus;
  private closed = false;

  static async open(o: LanguageSessionOptions): Promise<LanguageSession> {
    const client = new SyncClient({
      ...o.client,
      orgId: o.orgId,
      streamId: o.languageId,
      actorId: o.actorId,
      deviceId: o.deviceId,
      store: o.store,
      transport: o.transport,
      ...(o.isDeferred ? { deferCheckpoint: o.isDeferred } : {})
    });
    await client.load();
    const kept = new Set<string>(JSON.parse((await o.store.meta(keepKey(o.orgId, o.languageId))) || '[]') as string[]);
    return new LanguageSession(o, client, kept);
  }

  private constructor(private readonly o: LanguageSessionOptions, readonly client: SyncClient, kept: ReadonlySet<string>) {
    this.current = {
      revision: client.publishedRevision, pending: 0, refusedEvents: 0, lastSync: 'never',
      online: null, tooOld: false, refused: null, pulled: false, live: false,
      pendingUp: 0, pendingDown: 0, peakUp: 0, peakDown: 0, present: o.files.snapshot(), keptUnits: kept
    };
    const files = o.files;
    const common = {
      isOnline: () => this.current.online !== false,
      isPulling: () => this.pulling,
      ...(o.isDeferred ? { isDeferred: o.isDeferred } : {}),
      ...(o.budget ? { budget: o.budget } : {}),
      // Upload size from disk; download size from the server's confirmation.
      sizeOf: (ref: BlobRef) => files.sizeOf(ref.hash) ?? client.getState().blobs[ref.hash]?.size
    };
    this.up = new TransferWorker({
      ...UPLOAD_DEFAULTS,
      ...common,
      // Size from the confirmation versus the file here: a mismatch reopens the upload.
      work: () => deriveUploadWork(client.getState(), files.snapshot(), files.sizes()),
      transfer: o.upload,
      onChange: (n) => this.set({ pendingUp: n, peakUp: n === 0 ? 0 : Math.max(this.current.peakUp, n) })
    });
    this.down = new TransferWorker({
      ...DOWNLOAD_DEFAULTS,
      ...common,
      // Rule 10: by scope, never the whole language. Scope is the actor's
      // own units plus what they explicitly chose to keep offline.
      work: () => deriveDownloadWork(client.getState(), files.snapshot(), this.scope()),
      transfer: o.download,
      onChange: (n) => this.set({ pendingDown: n, peakDown: n === 0 ? 0 : Math.max(this.current.peakDown, n) })
    });
    // Sync on a poke from the server, after a local append, and on a
    // fallback poll that backs off while offline.
    this.scheduler = new SyncScheduler({
      ...o.scheduler,
      run: async () => { const { more } = await this.sync(); return { offline: this.current.online === false, more }; }
    });
  }

  /** Begin syncing, transferring and reclaiming. */
  start(): void {
    const { client, o } = this;
    const files = o.files;
    // The client publishes after every fold change and every commit; the
    // screen follows the fold's revision, not the call sites. Nothing on
    // screen shows that a write is still on its way to disk, so that news
    // changes nothing here: it redrew the whole app twice per commit.
    this.stops.push(client.subscribe((s) => this.set({ revision: s.revision })));
    this.up.start();
    this.down.start();
    this.stops.push(files.onChange(() => {
      this.up.nudge();
      this.down.nudge();
    }));
    // Storage pressure must never reach the recorder: after any change to
    // what is on disk, give back out-of-scope files the server still has.
    this.reclaim();
    this.stops.push(files.onChange(() => this.reclaim()));
    // What is on this device, for the offline marks on passages and in Settings.
    this.stops.push(files.onChange(() => this.set({ present: files.snapshot() })));
    const unwatch = o.transport.watch?.(o.orgId, o.languageId, {
      onPoke: () => this.scheduler.nudge(),
      onStatus: (connected) => { this.set({ live: connected }); this.scheduler.connection(connected); }
    });
    if (unwatch) this.stops.push(unwatch);
    void this.counts();
    this.scheduler.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.up.stop();
    this.down.stop();
    this.scheduler.stop();
    this.listeners.clear();
  }

  /** The live fold. It mutates in place: copy it before handing it to anything that compares by identity. */
  get state(): LanguageState {
    return this.client.getState();
  }

  get status(): LanguageStatus {
    return this.current;
  }

  /** Be told after any change to `state` or `status`. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** One bounded sync slice. Resolves to whether work remains. */
  async sync(): Promise<{ more: boolean }> {
    const { client, o } = this;
    let changed = true;
    let more = false;
    try {
      this.pulling = true;
      const r = await (o.aroundSync ? o.aroundSync(() => client.sync()) : client.sync());
      this.pulling = false;
      more = r.more;
      changed = r.pushed > 0 || r.pulled > 0 || r.rejected > 0;
      const wasOnline = this.current.online;
      // Online is exactly "the server answered". A refusal is an answer, so a
      // device whose membership is missing is online and says so; it must not
      // be shown, or treated, as offline.
      this.set({
        tooOld: r.tooOld,
        refused: r.refused,
        online: !r.offline,
        ...(!r.offline && !r.refused && !r.more ? { pulled: true } : {}),
        lastSync: r.offline
          ? 'offline'
          : r.refused
            ? `refused: ${r.refused}`
            : r.pushed === 0 && r.pulled === 0 && r.rejected === 0
              ? 'up to date'
              : `pushed ${r.pushed}, pulled ${r.pulled}, rejected ${r.rejected}`
      });
      // Diagnostics go only after this device's own work: outbox empty, uploads idle.
      if (!r.offline && !r.more && this.current.pendingUp === 0 && o.onSettled) {
        void client.pendingCount()
          .then((n) => { if (n === 0) o.onSettled?.({ blobsWanted: this.current.pendingDown }); })
          .catch(() => {});
      }
      // New confirmations may have arrived: re-derive. Reconnect retries now,
      // which clears waits. A finished sync while not deferred runs the
      // waiting upload pass now: nudge()'s debounce, restarted by every
      // following sync, held a just-recorded file until the minute tick.
      // Failure backoff stays put; only trigger() clears it.
      if (!r.offline && wasOnline === false) this.up.trigger();
      else if (!r.offline && !o.isDeferred?.()) this.up.nudge(0);
      else this.up.nudge();
      this.down.nudge();
    } catch (err) {
      // Not a transport failure: those come back as `offline` above. Whether
      // the server is reachable is unknown, so the flag stays where it was.
      this.pulling = false;
      this.set({ lastSync: `error: ${(err as Error).message}` });
    }
    if (changed) await this.counts();
    return { more };
  }

  /** Back on screen or back online: sync now rather than at the end of a backoff. */
  wake(): void {
    this.scheduler.wake();
  }

  /** Someone's membership or a role changed: work refused for want of one may pass now. */
  async membershipChanged(): Promise<void> {
    const n = await this.client.retryRejected(['NOT_MEMBER', 'NOT_ALLOWED']);
    if (n > 0) this.scheduler.nudge();
  }

  async append<T extends EventType>(type: T, payload: EventPayloads[T], parentEventId?: string): Promise<void> {
    const formats = this.formatsFor([{ type, payload }]);
    if (formats.length) await this.client.appendMany(formats);
    await this.client.append(type, payload, parentEventId);
    await this.written();
  }

  /** Many events, one store transaction. */
  async appendMany<T extends EventType>(items: { type: T; payload: EventPayloads[T] }[]): Promise<void> {
    if (items.length === 0) return;
    await this.client.appendMany<EventType>([...this.formatsFor(items), ...items]);
    await this.written();
  }

  /** A command's events (core `commands()`), one store transaction, with the command's stable ids. */
  async run(specs: EventSpec[]): Promise<void> {
    if (specs.length === 0) return;
    await this.client.appendMany<EventType>([...this.formatsFor(specs), ...specs]);
    await this.written();
  }

  async keepOffline(unitId: string, keep: boolean): Promise<void> {
    const next = new Set(this.current.keptUnits);
    if (keep) next.add(unitId);
    else next.delete(unitId);
    this.set({ keptUnits: next });
    await this.o.store.setMeta(keepKey(this.o.orgId, this.o.languageId), JSON.stringify([...next]));
    this.down.nudge();
  }

  /** After recording: clear upload backoff and start a pass now. */
  triggerUpload(): void {
    this.up.trigger();
  }

  /** Recordings here the server has not confirmed: what a hand-over must still send. */
  unsent(): BlobRef[] {
    return deriveUploadWork(this.client.getState(), this.o.files.snapshot(), this.o.files.sizes());
  }

  inspect(): Promise<SyncInspection> {
    return this.client.inspect();
  }

  private scope(): Set<string> {
    const scope = defaultOfflineScope(this.client.getState(), this.o.actorId);
    for (const u of this.current.keptUnits) scope.add(u);
    return scope;
  }

  private reclaim(): void {
    const files = this.o.files;
    try {
      files.reclaim(evictableBlobs(this.client.getState(), files.snapshot(), this.scope(), files.sizes()), this.o.limits);
    } catch { /* disk queries can fail on some devices; try again next change */ }
  }

  /**
   * A voice note this device stored as WAV (a browser without MP4) goes
   * with an event saying so, ahead of the event that names it (decisions.md 77).
   */
  private formatsFor(items: readonly { type: EventType; payload: unknown }[]) {
    return audioFormatsFor(this.client.getState(), items, (hash) => this.o.files.formatOf(hash));
  }

  private async written(): Promise<void> {
    await this.counts();
    this.scheduler.nudge();
  }

  /** Read the revision and counts again, after a write made outside the session (a recovered recording). */
  async refresh(): Promise<void> {
    await this.counts();
  }

  /** The counts are queries; they must not hold a state update. */
  private async counts(): Promise<void> {
    this.set({ revision: this.client.publishedRevision });
    void this.client.pendingCount().then((pending) => this.set({ pending })).catch(() => {});
    void this.client.refusedCount().then((refusedEvents) => this.set({ refusedEvents })).catch(() => {});
  }

  /** Change the status and tell subscribers, only when something changed. */
  private set(change: Partial<LanguageStatus>): void {
    if (this.closed) return;
    let differs = false;
    for (const k of Object.keys(change) as (keyof LanguageStatus)[]) {
      if (this.current[k] !== change[k]) { differs = true; break; }
    }
    if (!differs) return;
    this.current = { ...this.current, ...change };
    for (const l of this.listeners) l();
  }
}
