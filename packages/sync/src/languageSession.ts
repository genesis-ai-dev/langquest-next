import {
  audioFormatsFor, concerning, decodeHlc, eventPassage, filePlanOf, languageLines, passageInMemory, updatesFor, uploadWorkOf,
  type AnyEvent, type BlobRef, type EventPayloads, type EventSpec, type EventType, type LanguageState,
  type LostFilesView, type OfflineSummary, type PassageLine, type PassageLines, type UnitOffline, type Update
} from '@langquest-next/core';
import { RECORD_KINDS } from './keptLanguage';
import { LanguageFiles } from './languageFiles';
import { noteSent, readSentLog, sameUploads, uploadsByPassage, type PassageUploads, type SentEntry } from './sentLog';
import { SyncClient, type SyncClientOptions, type SyncResult } from './syncClient';
import { SyncScheduler } from './syncScheduler';
import { DOWNLOAD_DEFAULTS, TransferWorker, UPLOAD_DEFAULTS, type TransferBudget } from './transferWorker';
import type { EventStore, SyncInspection, Transport } from './types';

/** The files a language's recordings are kept in on this device: the phone's blob store, a fake in tests. */
export interface LocalFiles {
  /** Hashes of the files here now, as a copy that will not change. */
  snapshot(): ReadonlySet<string>;
  /**
   * The same hashes without a copy: the live set, to be read at once and never
   * kept or changed. Work lists, reclaim and the scope ask after every file
   * that lands; a copy of 61,000 entries each time was O(files squared).
   */
  presentView?(): ReadonlySet<string>;
  /** Changes whenever the set of files does: lets a copy be skipped when nothing changed. */
  readonly version?: number;
  /** Sizes of the files here, possibly the live map: read at once, never kept or changed. */
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
  /**
   * The passages kept offline and how much of each one's audio is here,
   * the whole scope at a glance, and the passages this person keeps by
   * default (asked of them or worked in); worked out after changes, so a
   * screen reads them without waiting. Null and empty until first counted.
   */
  keptOffline: ReadonlyMap<string, UnitOffline> | null;
  offlineSummary: OfflineSummary | null;
  scope: ReadonlySet<string>;
  /**
   * Each passage's line: what lists of passages read (Map, Progress, My
   * Work), so none of them needs every passage's record in memory
   * (decisions.md 143). A new object whenever any line changed.
   */
  lines: PassageLines;
  /**
   * Passages filled in of those the server has rows for, while a first
   * download fills them in (decisions.md 147): the Map's and Settings'
   * "Downloading this language". Null when every passage is here.
   */
  fill: { filled: number; total: number } | null;
  /**
   * Recordings waiting to upload, by passage, with how many there were since
   * the passage's queue was last empty: "7 of 9 uploaded" (decisions.md 166).
   */
  uploads: ReadonlyMap<string, PassageUploads>;
  /** What this device sent of the language, newest first: the Sync screen's "Uploaded" (sentLog.ts). */
  sent: readonly SentEntry[];
  /**
   * Passages with a file going up or coming down at this moment: a screen
   * says "Uploading" or shows a download moving only while one is
   * (decisions.md 166), never because work is merely waiting.
   */
  uploading: ReadonlySet<string>;
  downloading: ReadonlySet<string>;
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
  /**
   * A moment to send diagnostics: a sync the server answered left nothing
   * of this person's to send, and every upload waiting has been tried at
   * least once; or the server refused this person or this build, which
   * syncing again will not change. Never offline, never with more to pull.
   */
  onSettled?: (o: { blobsWanted: number }) => void;
  /**
   * The server answered a sync, at `at` (the client's `now`). Every time,
   * though nothing else changed: how recently it answered is what says the
   * device is still online (decisions.md 166), and a status change per sync
   * would redraw every screen.
   */
  onAnswered?: (at: number) => void;
  /** Poll interval and backoff for the scheduler; its defaults otherwise. */
  scheduler?: { pollMs?: number };
  /**
   * Keep the language's recordings and file verdicts on disk, holding in
   * memory only the passages `loadUnits` asks for (decisions.md 143).
   */
  keepOnDisk?: boolean;
  /** The app's build: lines kept by another build are worked out again (`SyncClientOptions.build`). */
  build?: string;
}

/** How long after a change the offline counts are worked out again: one count for a burst of changes. */
const OFFLINE_RECOUNT_MS = 750;
/** Passages read from disk at once for the Inbox: a bounded slice of the language in memory. */
const INBOX_PASSAGES_PER_READ = 25;
/** How long file arrivals are gathered before screens are told, and between storage reclaims. */
export const FILE_NEWS_MS = 500;

const keepKey = (orgId: string, languageId: string) => `keep:${orgId}/${languageId}`;
const sentKey = (orgId: string, languageId: string) => `sent:${orgId}/${languageId}`;
/** Recordings of a language still to upload, as its session last counted them: what other languages' screens say is waiting there. */
export const filesWaitingKey = (orgId: string, languageId: string) => `files-waiting:${orgId}/${languageId}`;
/** How long what went up gathers before the log is written to the store. */
const SENT_SAVE_MS = 1000;

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
  /** Which files to send, fetch or free, from memory and, for a language kept on disk, the phone's table. */
  private readonly plan: LanguageFiles;
  private recountAt: ReturnType<typeof setTimeout> | undefined;
  /** The upload worker's last work list: what `probe` reports for a language kept on disk. */
  private lastUnsent: BlobRef[] = [];
  /** Files sent this session that the server has not confirmed yet: uploaded, though still on the upload list. */
  private readonly sentFiles = new Set<string>();
  /** Each passage's most recordings waiting since its queue was last empty. */
  private readonly upPeaks = new Map<string, number>();
  private sentSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Trailing timers: the file set shown to screens, and reclaim after file changes. */
  private presentTimer: ReturnType<typeof setTimeout> | null = null;
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReclaim = -Infinity;
  /** The file set last published, to skip a copy when nothing changed since. */
  private publishedVersion: number | undefined;

  static async open(o: LanguageSessionOptions): Promise<LanguageSession> {
    // The person's offline scope fills in first, after what a screen asks for (decisions.md 61, 147).
    let session: LanguageSession | null = null;
    const client = new SyncClient({
      fillFirst: () => session?.fillFirst() ?? [],
      ...o.client,
      orgId: o.orgId,
      streamId: o.languageId,
      actorId: o.actorId,
      deviceId: o.deviceId,
      store: o.store,
      transport: o.transport,
      ...(o.isDeferred ? { deferCheckpoint: o.isDeferred } : {}),
      ...(o.keepOnDisk ? { keepOnDisk: true } : {}),
      ...(o.build ? { build: o.build } : {}),
      onSent: (events) => session?.changesSent(events)
    });
    await client.trackOpen();
    await client.load('open');
    const kept = new Set<string>(JSON.parse((await o.store.meta(keepKey(o.orgId, o.languageId))) || '[]') as string[]);
    const sent = readSentLog(await o.store.meta(sentKey(o.orgId, o.languageId)));
    session = new LanguageSession(o, client, kept, sent);
    return session;
  }

  /** What fills in first: the passages this person keeps offline, by default and by choice, and those whose record concerns them. */
  private fillFirst(): string[] {
    const lines = this.client.passageLines();
    return [...this.current.scope, ...this.current.keptUnits, ...concerning(lines, this.o.actorId)];
  }

  private constructor(private readonly o: LanguageSessionOptions, readonly client: SyncClient, kept: ReadonlySet<string>, sent: readonly SentEntry[]) {
    this.current = {
      revision: client.publishedRevision, pending: 0, refusedEvents: 0, lastSync: 'never',
      online: null, tooOld: false, refused: null, pulled: false, live: false,
      pendingUp: 0, pendingDown: 0, peakUp: 0, peakDown: 0, present: o.files.snapshot(), keptUnits: kept,
      keptOffline: null, offlineSummary: null, scope: new Set(), lines: client.passageLines(), fill: client.fillProgress(),
      uploads: new Map(), sent, uploading: new Set(), downloading: new Set()
    };
    this.publishedVersion = o.files.version;
    const files = o.files;
    const plan = new LanguageFiles(client, o.store, o.orgId, o.languageId);
    this.plan = plan;
    const common = {
      isOnline: () => this.current.online !== false,
      isPulling: () => this.pulling,
      ...(o.isDeferred ? { isDeferred: o.isDeferred } : {}),
      ...(o.budget ? { budget: o.budget } : {}),
      // Upload size from disk; download size from the server's confirmation.
      sizeOf: (ref: BlobRef) => files.sizeOf(ref.hash) ?? plan.sizeOf(ref.hash)
    };
    this.up = new TransferWorker({
      ...UPLOAD_DEFAULTS,
      ...common,
      // Size from the confirmation versus the file here: a mismatch reopens the upload.
      work: async () => { const list = await plan.upload(this.here(), files.sizes()); this.lastUnsent = list; this.countUploads(); return list; },
      transfer: async (ref) => {
        await this.moving('uploading', ref, () => o.upload(ref));
        this.sentFiles.add(ref.hash);
        this.noteSent({ unitId: ref.unitId || null, files: 1 });
        this.countUploads();
      },
      onChange: (n) => this.set({ pendingUp: n, peakUp: n === 0 ? 0 : Math.max(this.current.peakUp, n) })
    });
    this.down = new TransferWorker({
      ...DOWNLOAD_DEFAULTS,
      ...common,
      // Rule 10: by scope, never the whole language. Scope is the actor's
      // own units plus what they explicitly chose to keep offline.
      work: async () => plan.download(this.here(), await this.scope()),
      transfer: (ref) => this.moving('downloading', ref, () => o.download(ref)),
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
    this.stops.push(client.subscribe((s) => { this.set({ revision: s.revision, lines: s.lines ?? languageLines(s.state), fill: s.fill ?? null }); this.recount(); }));
    this.up.start();
    this.down.start();
    this.stops.push(files.onChange(() => {
      this.up.nudge();
      this.down.nudge();
    }));
    // Storage pressure must never reach the recorder: after any change to
    // what is on disk, give back out-of-scope files the server still has.
    void this.reclaim();
    this.stops.push(files.onChange(() => { this.reclaimSoon(); this.recount(); }));
    // What is on this device, for the offline marks on passages and in Settings.
    // Told once per window however many files landed in it: a copy per file
    // (and a redraw per copy) made a full download quadratic.
    this.stops.push(files.onChange(() => this.presentSoon()));
    const unwatch = o.transport.watch?.(o.orgId, o.languageId, {
      onPoke: () => this.scheduler.nudge(),
      onStatus: (connected) => { this.set({ live: connected }); this.scheduler.connection(connected); }
    });
    if (unwatch) this.stops.push(unwatch);
    void this.counts();
    this.recount();
    this.scheduler.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.recountAt) clearTimeout(this.recountAt);
    for (const stop of this.stops.splice(0)) stop();
    this.up.stop();
    this.down.stop();
    this.scheduler.stop();
    if (this.presentTimer) clearTimeout(this.presentTimer);
    if (this.reclaimTimer) clearTimeout(this.reclaimTimer);
    if (this.sentSaveTimer) { clearTimeout(this.sentSaveTimer); this.sentSaveTimer = null; void this.saveSent(); }
    this.presentTimer = this.reclaimTimer = null;
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
      // Up to date with passages still to fill in: a slice of the fill, outside the pull, so audio moves meanwhile (decisions.md 147).
      if (r.filling && !r.offline && !r.more && r.refused === null) {
        const f = await client.fillSome();
        more = f.filling && !f.offline;
        if (f.filled > 0) changed = true;
      }
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
      if (!r.offline) o.onAnswered?.(o.client?.now?.() ?? Date.now());
      // Diagnostics go after this device's own work has had its turn: the
      // outbox empty and every waiting upload tried. An upload that fails
      // every time (they retry forever) must not hold them back for good: it
      // is what support most needs to hear about. A refusal or a build the
      // server no longer takes is an answer that syncing will not change.
      // Asked of the worker, not `pendingUp`: a sync right after recording
      // runs before the worker's first pass has counted the new file.
      if (!r.offline && !r.more && o.onSettled) {
        const settled = () => o.onSettled?.({ blobsWanted: this.current.pendingDown });
        if (r.refused !== null || r.tooOld) settled();
        else {
          void this.up.untried()
            .then(async (untried) => { if (untried === 0 && (await client.pendingCount()) === 0) settled(); })
            .catch(() => {});
        }
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
    const n = await this.client.retryRejected(['NOT_MEMBER', 'NOT_ALLOWED'], 'membership');
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
    this.recount();
  }

  /**
   * Hold these passages' recordings in memory: the one a screen shows and
   * those next to it (decisions.md 143). Others stay on the phone's disk.
   */
  async loadUnits(unitIds: readonly string[]): Promise<void> {
    await this.client.loadUnits(unitIds);
  }

  /** Is this passage's whole record in memory, so a screen may read it from `state`? */
  isLoaded(unitId: string): boolean {
    return this.client.isLoaded(unitId);
  }

  /** Are all this passage's rows on this device, or still on the server while the language fills in (decisions.md 147)? */
  isFilled(unitId: string): boolean {
    return this.client.isFilled(unitId);
  }

  /**
   * The language with these passages' records read in from disk, for a
   * screen that lists a few passages beyond those in memory. The session's
   * own state is not changed.
   */
  withPassages(unitIds: readonly string[]): Promise<LanguageState> {
    return this.client.withPassages(unitIds);
  }

  /** The passage a take is in, from memory or disk; null when it is nowhere. */
  passageOfTake(takeId: string): Promise<string | null> {
    const kept = this.client.keptRecords();
    if (!kept) return Promise.resolve(this.client.getState().takes[takeId]?.unitId || null);
    return kept.passageOf(this.client.getState(), { take: takeId });
  }

  /** Passages whose versions tied in this key term (TERM-5): its uses are read from them. */
  async passagesLinkingTerm(termId: string): Promise<string[]> {
    const state = this.client.getState();
    const units = new Set<string>();
    for (const [takeId, byTerm] of Object.entries(state.keyTermLinks)) {
      if (!byTerm[termId]) continue;
      const u = await this.passageOfTake(takeId);
      if (u) units.add(u);
    }
    if (this.client.keptRecords()) {
      for (const r of await this.o.store.keptByRef(this.o.orgId, this.o.languageId, 'termLink', [termId])) units.add(r.unitId);
    }
    return [...units];
  }

  /** What each passage's Inbox entries were worked out from: its line then. */
  private inbox = { actorId: '', byUnit: new Map<string, { line: PassageLine; updates: Update[] }>() };

  /**
   * What happened that concerns this person (core `updatesFor`), newest
   * first. A language kept on disk reads only the passages whose line says
   * they concern the person, a slice at a time, and reads a passage again
   * only when its line changed.
   */
  async updatesFor(actorId: string): Promise<Update[]> {
    if (!this.client.keptRecords()) return updatesFor(this.client.getState(), actorId);
    if (this.inbox.actorId !== actorId) this.inbox = { actorId, byUnit: new Map() };
    const lines = this.client.passageLines();
    const units = concerning(lines, actorId);
    const known = this.inbox.byUnit;
    const need = units.filter((u) => known.get(u)?.line !== lines.get(u));
    for (let i = 0; i < need.length; i += INBOX_PASSAGES_PER_READ) {
      const slice = need.slice(i, i + INBOX_PASSAGES_PER_READ);
      const view = await this.client.withPassages(slice, RECORD_KINDS);
      const found = updatesFor(view, actorId);
      for (const u of slice) known.set(u, { line: lines.get(u), updates: found.filter((x) => x.unitId === u) });
    }
    const wanted = new Set(units);
    for (const u of [...known.keys()]) if (!wanted.has(u)) known.delete(u);
    return units.flatMap((u) => known.get(u)?.updates ?? [])
      .sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Does the language hold this recording, in memory or on disk? (A recovered recording's check.) */
  hasRecording(id: string): Promise<boolean> {
    return this.plan.hasRecording(id);
  }

  /** What these files a phone lost were (decisions.md 92). */
  lost(hashes: readonly string[]): Promise<LostFilesView> {
    return this.plan.lost(hashes);
  }

  /** After recording: clear upload backoff and start a pass now. */
  triggerUpload(): void {
    this.up.trigger();
  }

  /** Recordings here the server has not confirmed: what a hand-over must still send. */
  unsent(): Promise<BlobRef[]> {
    return this.plan.upload(this.o.files.snapshot(), this.o.files.sizes());
  }

  inspect(): Promise<SyncInspection> {
    return this.client.inspect();
  }

  /**
   * This language's part of the `device` diagnostics record: recordings
   * waiting to go up, how long the oldest has waited, and how long the
   * download waiting longest has, in minutes. A recording's age is from
   * when it was recorded (its event's clock) while its recording is in
   * memory, so it survives a restart; for a recording on disk
   * (decisions.md 143), or a file no recording names, from when this
   * session first saw it. A language kept on disk answers with the upload
   * worker's last list, since the list is worked out from the phone's table.
   */
  probe(): { uploadsWaiting: number; oldestUnsentMin?: number; wantedStuckMin?: number } {
    const unsent = this.client.keptRecords() ? this.lastUnsent : uploadWorkOf(filePlanOf(this.client.getState()), this.here(), this.o.files.sizes());
    const now = this.o.client?.now?.() ?? Date.now();
    const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));
    const out: { uploadsWaiting: number; oldestUnsentMin?: number; wantedStuckMin?: number } = { uploadsWaiting: unsent.length };
    if (unsent.length > 0) {
      const waiting = new Set(unsent.map((r) => r.hash));
      const recordedAt = new Map<string, number>();
      for (const rec of Object.values(this.client.getState().recordings)) {
        for (const card of rec.cards) if (waiting.has(card.hash)) recordedAt.set(card.hash, decodeHlc(rec.hlc).wallMs);
      }
      let oldest = now;
      for (const hash of waiting) oldest = Math.min(oldest, recordedAt.get(hash) ?? this.up.waitingSince(hash) ?? now);
      out.oldestUnsentMin = minutes(now - oldest);
    }
    const stuck = this.down.oldestWaitingMs();
    if (stuck !== null) out.wantedStuckMin = minutes(stuck);
    return out;
  }

  /** The files here, read at once and not kept: the live set where the store offers one, else a copy. */
  private here(): ReadonlySet<string> {
    return this.o.files.presentView?.() ?? this.o.files.snapshot();
  }

  /** The passages kept offline: this person's own and asked-of, and the ones they chose. */
  private async scope(): Promise<Set<string>> {
    const scope = await this.plan.scope(this.o.actorId);
    for (const u of this.current.keptUnits) scope.add(u);
    return scope;
  }

  private async reclaim(): Promise<void> {
    const files = this.o.files;
    this.lastReclaim = Date.now();
    try {
      const scope = await this.scope();
      const evictable = await this.plan.evictable(this.here(), scope, files.sizes());
      // The plan was read from the phone's table; a session closed meanwhile frees nothing.
      if (this.closed) return;
      files.reclaim(evictable, this.o.limits);
    } catch { /* disk queries can fail on some devices; try again next change */ }
  }

  /** The offline marks and Settings' summary, worked out after a burst of changes rather than on every draw. */
  private recount(): void {
    if (this.closed) return;
    if (this.recountAt) clearTimeout(this.recountAt);
    this.recountAt = setTimeout(() => {
      void (async () => {
        // The window's published copy of the files here (`presentSoon`), not another copy per recount.
        const present = this.current.present;
        const own = await this.plan.scope(this.o.actorId);
        const kept = await this.scope();
        const chosen = this.current.keptUnits;
        const [counted, summary] = await Promise.all([
          this.plan.byUnit([...kept], present, this.o.actorId, chosen),
          this.plan.summary(present, this.o.actorId, chosen)
        ]);
        // "On this device" is a passage's rows as well as its audio (decisions.md 147): one a first download has not reached is not ready.
        let waiting = 0;
        const keptOffline = new Map(counted);
        for (const [u, x] of counted) {
          if (!x.ready || this.client.isFilled(u)) continue;
          keptOffline.set(u, { ...x, ready: false });
          waiting += 1;
        }
        const offlineSummary = waiting ? { ...summary, ready: Math.max(0, summary.ready - waiting) } : summary;
        this.set({ keptOffline: waiting ? keptOffline : counted, offlineSummary, scope: own });
      })().catch(() => { /* counted again after the next change */ });
    }, OFFLINE_RECOUNT_MS);
  }

  /**
   * After a file change: reclaim now if it has been a while, else once more
   * when the window ends. Storage pressure is still answered within
   * FILE_NEWS_MS, and a burst of arrivals costs one pass, not one per file.
   */
  private reclaimSoon(): void {
    if (this.closed || this.reclaimTimer) return;
    const wait = this.lastReclaim + FILE_NEWS_MS - Date.now();
    if (wait <= 0) { void this.reclaim(); return; }
    this.reclaimTimer = setTimeout(() => { this.reclaimTimer = null; if (!this.closed) void this.reclaim(); }, wait);
  }

  /** Tell screens which files are here, once per window. */
  private presentSoon(): void {
    if (this.closed || this.presentTimer) return;
    this.presentTimer = setTimeout(() => {
      this.presentTimer = null;
      const version = this.o.files.version;
      if (version !== undefined && version === this.publishedVersion) return;
      this.publishedVersion = version;
      this.set({ present: this.o.files.snapshot() });
    }, FILE_NEWS_MS);
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

  /** Files in flight by passage, so "Uploading" and a moving download are said only while one moves. */
  private readonly inFlight = { uploading: new Map<string, number>(), downloading: new Map<string, number>() };

  private async moving(way: 'uploading' | 'downloading', ref: BlobRef, transfer: () => Promise<void>): Promise<void> {
    const counts = this.inFlight[way];
    const unit = ref.unitId || '';
    counts.set(unit, (counts.get(unit) ?? 0) + 1);
    this.set({ [way]: new Set(counts.keys()) } as Partial<LanguageStatus>);
    try {
      await transfer();
    } finally {
      const left = (counts.get(unit) ?? 1) - 1;
      if (left > 0) counts.set(unit, left);
      else counts.delete(unit);
      this.set({ [way]: new Set(counts.keys()) } as Partial<LanguageStatus>);
    }
  }

  /** Recordings waiting by passage, from the last upload list less what went up since (decisions.md 166). */
  private countUploads(): void {
    const listed = new Set(this.lastUnsent.map((r) => r.hash));
    // Confirmed: off the list, so no longer counted as sent and waiting for the server.
    for (const h of [...this.sentFiles]) if (!listed.has(h)) this.sentFiles.delete(h);
    const uploads = uploadsByPassage(this.lastUnsent, this.sentFiles, this.upPeaks);
    for (const unitId of [...this.upPeaks.keys()]) if (!uploads.has(unitId)) this.upPeaks.delete(unitId);
    for (const [unitId, u] of uploads) this.upPeaks.set(unitId, u.of);
    if (!sameUploads(uploads, this.current.uploads)) this.set({ uploads });
    // Kept for other languages' screens: work waiting here is still waiting when someone opens another.
    let files = 0;
    for (const u of uploads.values()) files += u.waiting;
    if (files !== this.filesWaitingSaved) {
      this.filesWaitingSaved = files;
      void this.o.store.setMeta(filesWaitingKey(this.o.orgId, this.o.languageId), String(files)).catch(() => {});
    }
  }
  private filesWaitingSaved = -1;

  /** The server accepted these events of this device's: noted by passage, as far as memory says which. */
  private changesSent(events: readonly AnyEvent[]): void {
    const state = this.client.getState();
    const byUnit = new Map<string | null, number>();
    for (const e of events) {
      const of = eventPassage(e);
      const unitId = of === 'settings' ? null : passageInMemory(state, of);
      byUnit.set(unitId, (byUnit.get(unitId) ?? 0) + 1);
    }
    for (const [unitId, changes] of byUnit) this.noteSent({ unitId, changes });
  }

  private noteSent(sent: { unitId: string | null; files?: number; changes?: number }): void {
    if (this.closed) return;
    this.set({ sent: noteSent(this.current.sent, { at: Date.now(), ...sent }) });
    if (this.sentSaveTimer) return;
    this.sentSaveTimer = setTimeout(() => { this.sentSaveTimer = null; void this.saveSent(); }, SENT_SAVE_MS);
  }

  private async saveSent(): Promise<void> {
    await this.o.store.setMeta(sentKey(this.o.orgId, this.o.languageId), JSON.stringify(this.current.sent)).catch(() => {});
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
