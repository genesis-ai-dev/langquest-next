import {
  defaultOfflineScope, deriveDownloadWork, deriveUploadWork, keptVerdict, PART_OF_KIND, putEntry, withOwnParts,
  type AnyEvent, type BlobRef, type LanguageState
} from '@langquest-next/core';
import { Diagnostics, MemoryDiagStore } from '../../diagnostics';
import { FILE, PART_KINDS } from '../../keptLanguage';
import { LanguageFiles } from '../../languageFiles';
import { MemoryStore } from '../../memoryStore';
import { LANGUAGE_MATERIALIZER, SyncClient } from '../../syncClient';
import { SyncScheduler } from '../../syncScheduler';
import { DEFAULT_TRANSFER_BUDGET_BYTES, DOWNLOAD_DEFAULTS, TransferBudget, TransferWorker, UPLOAD_DEFAULTS } from '../../transferWorker';
import { OfflineError, type Transport } from '../../types';
import type { FakeServer } from '../fakeServer';
import type { Random } from '../random';
import { LinkPipe, shapeTransport } from '../shapedTransport';
import type { VirtualTime } from '../virtualTime';
import type { Link } from './links';
import type { Persona } from './personas';

/** When a person uses the app: weekdays (0 = Sunday) and hours, UTC, and how often they act. */
export interface WorkPattern {
  days: readonly number[];
  startHour: number;
  endHour: number;
  /** Mean minutes between actions while working. */
  everyMinutes: number;
}

export const OFFICE_HOURS: WorkPattern = { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 16, everyMinutes: 30 };

/** What the fleet shares with its devices. */
export interface FleetContext {
  time: VirtualTime;
  server: FakeServer;
  orgId: string;
  streamId: string;
  /** When each event was appended on its phone, for propagation times. */
  appendedAt: Map<string, number>;
  /** Each phone's `checkpointEvery`; the app's 2000 when undefined. */
  checkpointEvery?: number;
  /** Realtime pokes: on, and how long they take to arrive. */
  realtime: { on: boolean; delayMs: number };
  /** False once the fleet is settling: people stop working. */
  working: () => boolean;
  /** Audio files move too: their size per second of recording. Null: events only. */
  audio: { bytesPerSecond: number } | null;
  /** When each audio file was recorded, for the time until it is on the server and on another phone. */
  recordedAt: Map<string, number>;
  /** Does the phone at this place in the fleet keep the language on disk (decisions.md 140)? */
  keepsOnDisk: (index: number) => boolean;
}

/** One device's numbers. CPU is real milliseconds in this process; delays are simulated milliseconds. */
export class DeviceMetrics {
  syncs = 0;
  offlineSyncs = 0;
  syncErrors = 0;
  /** Real CPU per sync run, network waits excluded. */
  syncCpuMs: number[] = [];
  /** Real CPU per local append (fold, commit, publish). */
  appendCpuMs: number[] = [];
  appended = 0;
  pulled = 0;
  pushedDuplicates = 0;
  /** From append on another phone to arriving here. */
  propagationMs: number[] = [];
  /** From append here to the server accepting it. */
  pushDelayMs: number[] = [];
  maxPending = 0;
  bytesDown = 0;
  /** Cold starts: simulated ms to catch up to where the server was when it began. */
  coldStarts: { ms: number | null; startedAt: number; targetSeq: number }[] = [];
  uploads = 0;
  uploadBytes = 0;
  uploadFailures = 0;
  /** From recording here to the server holding the file. */
  uploadDelayMs: number[] = [];
  downloads = 0;
  downloadBytes = 0;
  downloadFailures = 0;
  /** From recording on another phone to the file being playable here. */
  playableMs: number[] = [];
  /** Real CPU the transfer workers spent working out what to move (they scan the whole language each pass). */
  workListCpuMs = 0;
  workLists = 0;
}

/**
 * A phone: the app's real SyncClient and SyncScheduler, on a MemoryStore,
 * over a shaped link to the fake server, on simulated time. Wired the way
 * `apps/mobile/src/sync/useLanguage.ts` wires them: a nudge after each append
 * and on each realtime poke, `connection()` when the channel comes and
 * goes, `wake()` when the signal returns.
 */
export class SimDevice {
  readonly metrics = new DeviceMetrics();
  client!: SyncClient;
  /** Every diagnostics record this device made, across reinstalls (a phone would lose them; the fleet keeps them to count). */
  readonly diag = new MemoryDiagStore();
  private scheduler!: SyncScheduler;
  private linkTimer: unknown = null;
  private workTimer: unknown = null;
  private netWallMs = 0;
  /** Snapshot outcomes already looked at, to notice an adoption. */
  private snapshotsSeen = 0;
  private maxSeen = 0;
  private installs = 0;
  /** The app's database; a reinstall starts a new one, an update keeps it. */
  private store = new MemoryStore();
  /** The reducer version of the app on this phone. */
  private reducerVersion = LANGUAGE_MATERIALIZER.version;
  /** Audio files on this phone and their sizes; they survive a reinstall and an update. */
  private readonly present = new Set<string>();
  private readonly sizes = new Map<string, number>();
  /** The link's bandwidth each way, shared by sync and audio. */
  private readonly pipes = { up: new LinkPipe(), down: new LinkPipe() };
  private up: TransferWorker | null = null;
  private down: TransferWorker | null = null;
  private pulling = false;
  private online: boolean | null = null;

  constructor(
    readonly id: string,
    readonly actorId: string,
    readonly persona: Persona,
    readonly work: WorkPattern,
    public link: Link,
    private readonly fleet: FleetContext,
    private readonly random: Random,
    private readonly index = 0
  ) {}

  private files: LanguageFiles | null = null;

  /** Keeps the language on disk, as the app does (decisions.md 140)? */
  get keepsOnDisk(): boolean {
    return this.fleet.keepsOnDisk(this.index);
  }

  /** The language as this phone has it: memory, and for a phone that keeps it on disk, every kept row combined in. */
  async wholeState(): Promise<LanguageState> {
    const live = this.client.getState();
    if (!this.keepsOnDisk) return live;
    const s = withOwnParts(structuredClone(live));
    const { orgId, streamId } = this.fleet;
    for (const kind of PART_KINDS) for (const row of await this.store.keptAll(orgId, streamId, kind)) putEntry(s, PART_OF_KIND.get(kind)!, row.id, JSON.parse(row.json));
    for (const row of await this.store.keptAll(orgId, streamId, FILE)) {
      const kept = JSON.parse(row.json) as LanguageState['blobs'][string];
      const here = s.blobs[row.id];
      s.blobs[row.id] = here ? keptVerdict(kept, here) : kept;
    }
    return s;
  }

  /** Install the app and open the language. */
  async install(): Promise<void> {
    this.installs += 1;
    await this.open();
  }

  /** Start the app on what this phone already holds. */
  private async open(): Promise<void> {
    const { time } = this.fleet;
    const shaped = shapeTransport(this.fleet.server.transportFor(), {
      link: () => this.link,
      now: time.now,
      sleep: time.sleep,
      random: this.random,
      pipes: this.pipes
    });
    this.client = new SyncClient({
      orgId: this.fleet.orgId,
      streamId: this.fleet.streamId,
      actorId: this.actorId,
      deviceId: `${this.id}.${this.installs}`,
      store: this.store,
      materializer: { ...LANGUAGE_MATERIALIZER, version: this.reducerVersion },
      ...(this.keepsOnDisk ? { keepOnDisk: true } : {}),
      ...(this.fleet.checkpointEvery !== undefined ? { checkpointEvery: this.fleet.checkpointEvery } : {}),
      transport: this.observed(shaped),
      now: time.now,
      newId: () => this.random.uuid(),
      diag: new Diagnostics({ store: this.diag, newId: () => this.random.uuid(), now: time.now, maxRecords: Infinity })
    });
    await this.client.load();
    this.files = this.keepsOnDisk ? new LanguageFiles(this.client, this.store, this.fleet.orgId, this.fleet.streamId) : null;
    this.scheduler = new SyncScheduler({
      run: () => this.run(),
      setTimeout: time.setTimeout,
      clearTimeout: time.clearTimeout,
      now: time.now,
      random: this.random
    });
    this.scheduler.start();
    this.applyLink();
    this.scheduleWork();
    if (this.fleet.audio) this.startTransfers();
  }

  /**
   * The app's own upload and download workers (useLanguage.ts), on
   * simulated time: uploads what was recorded here until the server holds
   * it, downloads what this person's offline scope needs once the server
   * has it. They pause while a sync runs and wait while the last sync could
   * not reach the server, as on the phone.
   */
  private startTransfers(): void {
    const { time } = this.fleet;
    const budget = new TransferBudget(DEFAULT_TRANSFER_BUDGET_BYTES);
    const common = {
      isOnline: () => this.online !== false,
      isPulling: () => this.pulling,
      budget,
      sizeOf: (ref: BlobRef) => this.sizes.get(ref.hash) ?? this.client.getState().blobs[ref.hash]?.size,
      now: time.now,
      setTimer: time.setTimeout,
      clearTimer: time.clearTimeout
    };
    this.up = new TransferWorker({
      ...UPLOAD_DEFAULTS, ...common,
      work: () => this.workList(() => this.uploadWork()),
      transfer: (ref) => this.upload(ref)
    });
    this.down = new TransferWorker({
      ...DOWNLOAD_DEFAULTS, ...common,
      work: () => this.workList(() => this.downloadWork()),
      transfer: (ref) => this.download(ref)
    });
    this.up.start();
    this.down.start();
  }

  private async workList(derive: () => BlobRef[] | Promise<BlobRef[]>): Promise<BlobRef[]> {
    const started = performance.now();
    try {
      return await derive();
    } finally {
      this.metrics.workListCpuMs += performance.now() - started;
      this.metrics.workLists += 1;
    }
  }

  /** What to send: from memory, or for a phone keeping the language on disk, from its file lists (the app's LanguageFiles). */
  private uploadWork(): BlobRef[] | Promise<BlobRef[]> {
    return this.files ? this.files.upload(this.present, this.sizes) : deriveUploadWork(this.client.getState(), this.present, this.sizes);
  }

  private async downloadWork(): Promise<BlobRef[]> {
    const scope = await this.offlineScope();
    return this.files ? this.files.download(this.present, scope) : deriveDownloadWork(this.client.getState(), this.present, scope);
  }

  /** PUT to the Worker: the bytes cross the link, then the server keeps the file and says so (v1.BlobStored). */
  private async upload(ref: BlobRef): Promise<void> {
    const { time, server } = this.fleet;
    const size = this.sizes.get(ref.hash) ?? 0;
    if (!this.link.online(time.now())) throw new OfflineError('offline');
    await this.pipes.up.carry(size + REQUEST_OVERHEAD, this.link, time.now, time.sleep);
    if (!this.link.online(time.now()) || this.random() < this.link.dropRate) {
      this.metrics.uploadFailures += 1;
      throw new OfflineError('fetch failed');
    }
    server.storeBlob(this.fleet.orgId, this.fleet.streamId, ref.hash, size);
    this.metrics.uploads += 1;
    this.metrics.uploadBytes += size;
    const at = this.fleet.recordedAt.get(ref.hash);
    if (at !== undefined) this.metrics.uploadDelayMs.push(time.now() - at);
  }

  /** GET from the Worker: the file the server confirmed crosses the link and is kept here. */
  private async download(ref: BlobRef): Promise<void> {
    const { time, server } = this.fleet;
    const size = this.client.getState().blobs[ref.hash]?.size ?? server.blobs.get(ref.hash) ?? 0;
    if (!this.link.online(time.now())) throw new OfflineError('offline');
    if (!server.blobs.has(ref.hash)) throw new Error('404 not found');
    await this.pipes.down.carry(size + REQUEST_OVERHEAD, this.link, time.now, time.sleep);
    if (!this.link.online(time.now()) || this.random() < this.link.dropRate) {
      this.metrics.downloadFailures += 1;
      throw new OfflineError('fetch failed');
    }
    this.present.add(ref.hash);
    this.sizes.set(ref.hash, size);
    this.metrics.downloads += 1;
    this.metrics.downloadBytes += size;
    const at = this.fleet.recordedAt.get(ref.hash);
    if (at !== undefined) this.metrics.playableMs.push(time.now() - at);
  }

  /**
   * A fresh install: an empty store that catches up through the server
   * snapshot. The person (persona) is the same.
   */
  async reinstall(): Promise<void> {
    this.stop();
    this.metrics.coldStarts.push({ ms: null, startedAt: this.fleet.time.now(), targetSeq: this.fleet.server.head(this.fleet.orgId, this.fleet.streamId) });
    this.store = new MemoryStore();
    await this.install();
  }

  /**
   * An app update that changes the reducer: the same database, log,
   * checkpoint, outbox and clock, opened by a reducer that cannot read the
   * checkpoint (decisions.md 110). Counted as a cold start: the phone
   * catches up again from the server.
   */
  async update(reducerVersion: number): Promise<void> {
    this.stop();
    this.metrics.coldStarts.push({ ms: null, startedAt: this.fleet.time.now(), targetSeq: this.fleet.server.head(this.fleet.orgId, this.fleet.streamId) });
    this.reducerVersion = reducerVersion;
    await this.open();
  }

  setLink(link: Link): void {
    this.link = link;
    this.applyLink();
  }

  /** A realtime poke reached the phone. */
  poke(): void {
    if (this.link.online(this.fleet.time.now())) this.scheduler.nudge();
  }

  stop(): void {
    this.scheduler?.stop();
    this.up?.stop();
    this.down?.stop();
    this.fleet.time.clearTimeout(this.linkTimer);
    this.fleet.time.clearTimeout(this.workTimer);
  }

  /** Has this phone everything the server has, and sent everything it made? */
  async caughtUp(): Promise<boolean> {
    const view = await this.client.inspect();
    const events = view.pending.length === 0 && view.cursor >= this.fleet.server.head(this.fleet.orgId, this.fleet.streamId);
    if (!events || !this.fleet.audio) return events;
    return (await this.uploadWork()).length === 0 && (await this.downloadWork()).length === 0;
  }

  /** What the app keeps offline for this person, plus what they chose to keep (useLanguage scopeNow). */
  private async offlineScope(): Promise<Set<string>> {
    const scope = this.files ? await this.files.scope(this.actorId) : defaultOfflineScope(this.client.getState(), this.actorId);
    for (const unitId of this.persona.wants?.() ?? []) scope.add(unitId);
    return scope;
  }

  /**
   * After adopting a server snapshot, the events inside it were never
   * pulled one by one, so the person learns what is on their phone from the
   * fold, as they would from its screens. Without this, a phone whose first
   * contact came after the first snapshot never saw the language's
   * passages, and its person never worked.
   */
  private async observeFold(): Promise<void> {
    // A phone that keeps the language on disk reads it all back: the person looks through every screen.
    const s = this.keepsOnDisk ? await this.client.withPassages(Object.keys(this.client.getState().units)) : this.client.getState();
    const seen = (type: string, payload: unknown, actorId = '', id = '') => this.persona.observe({ id, type, payload, actorId } as AnyEvent);
    for (const [unitId, u] of Object.entries(s.units)) seen('v1.UnitAdded', { unitId, ...u });
    for (const [takeId, t] of Object.entries(s.takes)) if (t.unitId) seen('v1.TakeComposed', { takeId, unitId: t.unitId, cardHashes: t.cardHashes, parentTakeId: t.parentTakeId }, t.actorId);
    const mine = new Set(Object.values(s.kindReviews).filter((r) => r.by === this.actorId).map((r) => r.takeId));
    for (const sub of Object.values(s.submissions)) if (!mine.has(sub.takeId)) seen('v1.TakeSubmitted', { takeId: sub.takeId }, sub.actorId);
    for (const r of Object.values(s.kindReviews)) seen('v1.ReviewRecorded', { reviewId: r.id, takeId: r.takeId, kindId: r.kindId, outcome: r.outcome, via: r.via }, r.by);
    for (const n of Object.values(s.notes)) seen('v1.NoteAdded', { noteId: n.id, unitId: n.unitId, anchor: n.anchor }, n.by, n.eventId);
  }

  /** Audio recorded here that the server does not hold: a lost recording if the phone were lost now. */
  unsentAudio(): number {
    return [...this.present].filter((hash) => this.fleet.recordedAt.has(hash) && !this.fleet.server.blobs.has(hash)).length;
  }

  private async run(): Promise<{ offline: boolean; more?: boolean }> {
    const started = performance.now();
    const net = this.netWallMs;
    try {
      this.pulling = true;
      const r = await this.client.sync().finally(() => { this.pulling = false; });
      // As useLanguage: back online after an offline run retries transfers now; otherwise a nudge.
      const was = this.online;
      this.online = !r.offline;
      if (!r.offline && was === false) this.up?.trigger(); else this.up?.nudge();
      this.down?.nudge();
      await this.noticeSnapshot();
      this.metrics.syncs += 1;
      if (r.offline) this.metrics.offlineSyncs += 1;
      this.metrics.syncCpuMs.push(performance.now() - started - (this.netWallMs - net));
      this.metrics.maxPending = Math.max(this.metrics.maxPending, await this.client.pendingCount());
      await this.checkColdStart();
      return { offline: r.offline, more: r.more };
    } catch (err) {
      this.metrics.syncErrors += 1;
      this.fleet.time.errors.push(err);
      return { offline: false };
    }
  }

  private async checkColdStart(): Promise<void> {
    const open = this.metrics.coldStarts.find((c) => c.ms === null);
    if (!open) return;
    if ((await this.client.inspect()).cursor >= open.targetSeq) open.ms = this.fleet.time.now() - open.startedAt;
  }

  /** Watch what crosses the wire: wait time (to keep it out of CPU), arrivals, acceptances. */
  private observed(t: Transport): Transport {
    const { time, appendedAt } = this.fleet;
    const timed = async <T>(f: () => Promise<T>): Promise<T> => {
      const started = performance.now();
      try {
        return await f();
      } finally {
        this.netWallMs += performance.now() - started;
      }
    };
    return {
      append: async (events) => {
        const results = await timed(() => t.append(events));
        for (const r of results) {
          if (r.reason === 'duplicate') this.metrics.pushedDuplicates += 1;
          else if (r.accepted) this.metrics.pushDelayMs.push(time.now() - (appendedAt.get(r.id) ?? time.now()));
        }
        return results;
      },
      pull: async (orgId, streamId, after, limit) => {
        const page = await timed(() => t.pull(orgId, streamId, after, limit));
        this.metrics.pulled += page.length;
        this.metrics.bytesDown += JSON.stringify(page).length;
        for (const e of page) this.arrived(e);
        return page;
      },
      snapshotMeta: (...a) => timed(() => t.snapshotMeta(...a)),
      snapshotChunk: async (...a) => {
        const text = await timed(() => t.snapshotChunk(...a));
        this.metrics.bytesDown += text?.length ?? 0;
        return text;
      }
    };
  }

  private arrived(e: AnyEvent): void {
    const seq = e.serverSeq ?? 0;
    if (seq <= this.maxSeen) return;
    this.maxSeen = seq;
    const at = this.fleet.appendedAt.get(e.id);
    if (at !== undefined && !e.deviceId.startsWith(`${this.id}.`)) this.metrics.propagationMs.push(this.fleet.time.now() - at);
    this.persona.observe(e);
  }

  private applyLink(): void {
    const { time, realtime } = this.fleet;
    time.clearTimeout(this.linkTimer);
    const up = this.link.online(time.now());
    this.scheduler.connection(up && realtime.on);
    if (up) this.scheduler.wake();
    const next = this.link.nextChange(time.now());
    if (Number.isFinite(next)) this.linkTimer = time.setTimeout(() => this.applyLink(), next - time.now());
  }

  /** Did the last sync adopt a server snapshot? Then read the fold (observeFold). */
  private async noticeSnapshot(): Promise<void> {
    const records = this.diag.records;
    let adopted = false;
    for (let i = this.snapshotsSeen; i < records.length; i++) {
      const r = records[i]!;
      if (r.kind === 'snapshot' && r.t.outcome === 'ok') adopted = true;
    }
    this.snapshotsSeen = records.length;
    if (adopted) {
      await this.observeFold();
      this.maxSeen = Math.max(this.maxSeen, (await this.client.inspect()).cursor);
    }
  }

  /** The cards just recorded are files on this phone, as big as their audio. */
  private recorded(events: AnyEvent[]): void {
    const audio = this.fleet.audio!;
    for (const e of events) {
      if (e.type !== 'v1.RecordingAdded') continue;
      for (const card of e.payload.cards) {
        this.present.add(card.hash);
        this.sizes.set(card.hash, Math.round((card.durationMs / 1000) * audio.bytesPerSecond));
        this.fleet.recordedAt.set(card.hash, this.fleet.time.now());
      }
    }
    this.up?.nudge();
  }

  private scheduleWork(): void {
    const { time } = this.fleet;
    const at = nextWorkTime(time.now(), this.work, this.random);
    this.workTimer = time.setTimeout(() => void this.act(), at - time.now());
  }

  private async act(): Promise<void> {
    if (!this.fleet.working()) return;
    const action = this.persona.next(this.fleet.audio ? { hasAudio: (hashes) => hashes.every((h) => this.present.has(h)) } : undefined);
    if (action) {
      const started = performance.now();
      try {
        const events = await this.client.appendMany(action);
        this.metrics.appendCpuMs.push(performance.now() - started);
        this.metrics.appended += events.length;
        for (const e of events) this.fleet.appendedAt.set(e.id, this.fleet.time.now());
        if (this.fleet.audio) this.recorded(events);
        this.scheduler.nudge();
      } catch (err) {
        this.fleet.time.errors.push(err);
      }
    }
    this.scheduleWork();
  }
}

/** Headers and the signed URL a transfer carries besides the file. */
const REQUEST_OVERHEAD = 1_000;

const HOUR = 3_600_000;

/** The next moment this person acts: soon if they are at work, else some way into their next working hours. */
export function nextWorkTime(now: number, w: WorkPattern, random: Random): number {
  const gap = Math.max(1, Math.round(w.everyMinutes * (0.5 + random()))) * 60_000;
  const t = now + gap;
  if (atWork(t, w)) return t;
  // Start of the next working day, plus up to one gap.
  const day = Math.floor(t / (24 * HOUR));
  for (let d = day; d < day + 8; d++) {
    const start = d * 24 * HOUR + w.startHour * HOUR;
    if (start > t && w.days.includes(new Date(start).getUTCDay())) return start + Math.round(random() * gap);
  }
  return t + 24 * HOUR;
}

function atWork(t: number, w: WorkPattern): boolean {
  const d = new Date(t);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return w.days.includes(d.getUTCDay()) && h >= w.startHour && h < w.endHour;
}
