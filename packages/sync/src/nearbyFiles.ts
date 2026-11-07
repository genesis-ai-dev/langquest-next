import { buildIndexes, forScope, MAX_FILE_BYTES, openForReviewOf, type BlobRef, type FilePlan } from '@langquest-next/core';
import {
  backupsConfirmedOf, copiesOf, nearbyEvictableOf, nearbyGroupOf, nearbyShedOf, wantedFilesOf, type HoldChoice, type Holdings, type NearbyMark, type WantedFile
} from '@langquest-next/core/nearby';
import type { LanguageFiles } from './languageFiles';
import type { LanguageSessionOptions } from './languageSession';
import { nearbyKeepOf } from './nearbyKeep';
import type { NearbyMarks } from './nearbyMarks';
import type { NearbyFileMoves, NearbyFetchJob } from './nearbySession';
import type { SyncClient } from './syncClient';
import { TransferWorker } from './transferWorker';
import { OfflineError } from './types';

/**
 * A language session's nearby files (docs/nearby-sync-plan.md 5.6): the marks, the wanted list,
 * what a phone serves, the third transfer worker, level 2 when space runs short, a backup going
 * once the server confirms it, and shedding with "Hold teammates' recordings" off. Behind
 * `@langquest-next/sync/nearby`, so the web app, which shares nothing nearby, carries none of it.
 * A `LanguageSession` made with `nearbyFiles: nearbyFiles(platform)` and a `fetchFile` hands this
 * its port; without both, nothing here runs and no file is ever marked.
 *
 * Only this phone deletes anything: when it runs short of space, when the server confirms a
 * backup, or with the row off. Nothing here ever lists a file with no mark, so this person's own
 * unsent work, and another person's on a shared phone, are never among them.
 */

/** The app's half of a nearby file move (the `fetchFile` argument beside `upload` and `download`). The native write arrives with the radios. */
export interface NearbyFetchFile {
  /** Where a nearby file lands: `<hash>.<format>.nearby.part`, its own name, because a download deletes any `.part` of the same name. Null for a name the store does not make. */
  stagingUri(file: { hash: string; format: string }): string | null;
  /** Native wrote it and its hash matched: rename it to its name and index it. */
  commit(file: { hash: string; format: string }, stagingUri: string, size: number): Promise<void>;
  discard(stagingUri: string): Promise<void>;
  /** Where a file here is read from to serve it. Null when it is not here. */
  uriOf(file: { hash: string; format: string }): string | null;
  /** Bytes free on the volume now; null when it cannot say. */
  freeBytes(): number | null;
  /** Delete these whatever the space: shed, or a backup the server confirmed. Answers what went. */
  remove(files: readonly { hash: string; format: string }[]): readonly string[];
}

/** What the phone gives once per person and organization. */
export interface NearbyFilesPlatform {
  marks: NearbyMarks;
  /** This install's nearby key; null until one is made, and then no holdings entry speaks for anyone. */
  installKey(): string | null;
  /** May this person review in this language? Files open for review are then their own group, ahead of backups. */
  canReview(languageId: string): boolean;
}

/** Exactly what the nearby files reach of their `LanguageSession`. */
export interface NearbyFilesPort {
  /** The session's options: its language and person, files, `fetchFile`, limits, `holdChoice`, `mayUpload`, `isDeferred`. */
  readonly o: Pick<LanguageSessionOptions, 'orgId' | 'languageId' | 'actorId' | 'files' | 'fetchFile' | 'limits' | 'holdChoice' | 'mayUpload' | 'isDeferred'>;
  readonly client: Pick<SyncClient, 'getState' | 'passageLines' | 'nearbyMeta' | 'writeNearbyMeta'>;
  readonly plan: Pick<LanguageFiles, 'plan' | 'sizeOf'>;
  /** The passages kept offline: asked of this person, worked in, or chosen. */
  scope(): Promise<Set<string>>;
  /** Level 1 for the scope now: files the server still has that no kept passage needs, largest first. */
  level1(): Promise<{ hash: string; format: string }[]>;
  closed(): boolean;
  /** "Holding N for teammates" changed. */
  holding(n: number): void;
  /** Marks moved: the upload worker counts again. */
  nudge(): void;
}

/** What a `LanguageSession` asks of its nearby files. */
export interface NearbyFilesPart {
  load(): Promise<void>;
  start(): void;
  stop(): void;
  /** Every marked hash, in any language: the 2 GB cap leaves these alone, and a lost one is not this person's. */
  marked(): ReadonlySet<string>;
  /** The upload list less teammates' files when this person may not write files (`mayUpload`); their own stay. */
  uploadable(list: BlobRef[]): BlobRef[];
  /** This person's own: the list less teammates' files. */
  mine(list: BlobRef[]): BlobRef[];
  /** The upload worker's count `n` of `list` less teammates' files, never below what of this person's is left. */
  own(n: number, list: readonly BlobRef[]): number;
  /** Free space: level 1 as given, then level 2, in one pass; marks of what went, go. Answers the bytes freed. */
  reclaim(level1: readonly { hash: string; format: string }[]): Promise<number>;
  /** At the end of each sync the server answered: confirmed backups go, and with the row off, what need not be kept. Never rejects. */
  afterSync(): Promise<void>;
  /** For a `NearbySession` in this language. */
  moves(): NearbyFileMoves;
}

/** Null without a `fetchFile`: then no file is ever marked. */
export type NearbyFilesMaker = (port: NearbyFilesPort) => NearbyFilesPart | null;

/** With the row's choice not known yet, a phone asks as it would with the row off, and sheds nothing. */
const UNKNOWN_CHOICE: HoldChoice = { hold: false, reviewWindow: 5 };

/** One file at a time on a link; a dropped link ends the job, so backoff matters only across jobs. */
const NEARBY_WORKER = { concurrency: 1, backoffMs: [5_000, 30_000], graceMs: 0, debounceMs: 0, tickMs: 60_000 } as const;

export function nearbyFiles(platform: NearbyFilesPlatform): NearbyFilesMaker {
  return (port) => (port.o.fetchFile ? new LanguageNearbyFiles(platform, port, port.o.fetchFile) : null);
}

interface Job extends NearbyFetchJob {
  byHash: Map<string, WantedFile>;
  tried: Set<string>;
  noRoom: boolean;
  finish(error?: unknown): void;
}

class LanguageNearbyFiles implements NearbyFilesPart {
  private readonly all = new Map<string, NearbyMark>();
  private readonly worker: TransferWorker;
  private job: Job | null = null;

  constructor(private readonly platform: NearbyFilesPlatform, private readonly port: NearbyFilesPort, private readonly fetchFile: NearbyFetchFile) {
    const { isDeferred } = port.o;
    this.worker = new TransferWorker({
      ...NEARBY_WORKER,
      // Link up, not the server: a nearby file moves with no internet at all (5.4's trap table).
      isOnline: () => this.job?.linkUp() ?? false,
      // Its own: the session's flips true on every offline sync attempt.
      isPulling: () => false,
      ...(isDeferred ? { isDeferred } : {}),
      // No shared byte budget: it bounds bytes held in JavaScript, and a native move holds none.
      work: () => this.jobWork(),
      transfer: (ref) => this.fetchOne(ref)
    });
  }

  async load(): Promise<void> {
    for (const m of await this.platform.marks.all()) this.all.set(m.hash, m);
  }

  start(): void { this.worker.start(); }

  stop(): void {
    this.worker.stop();
    this.job?.finish(new OfflineError('the language closed'));
  }

  marked(): ReadonlySet<string> { return new Set(this.all.keys()); }

  uploadable(list: BlobRef[]): BlobRef[] {
    return this.port.o.mayUpload?.() ?? true ? list : this.mine(list);
  }

  mine(list: BlobRef[]): BlobRef[] {
    return list.filter((r) => !this.all.has(r.hash));
  }

  /** The worker counts down as files go, in any order, so the smaller of the two is never below what of this person's is left. */
  own(n: number, list: readonly BlobRef[]): number {
    return Math.min(n, list.filter((r) => !this.all.has(r.hash)).length);
  }

  private get files() { return this.port.o.files; }
  private get languageId() { return this.port.o.languageId; }

  private here(): ReadonlySet<string> {
    return this.files.presentView?.() ?? this.files.snapshot();
  }

  private marksHere(): NearbyMark[] {
    return [...this.all.values()].filter((m) => m.languageId === this.languageId);
  }

  /** Marks or files moved: "Holding N" and this person's own count again. */
  private changed(): void {
    if (this.port.closed()) return;
    void this.holding().then((n) => this.port.holding(n)).catch(() => {});
    this.port.nudge();
  }

  /** What teammates' phones said they hold. None when they cannot be read: then nothing is shed for another's sake, and copies count as none. */
  private async holdings(): Promise<Holdings> {
    const { client } = this.port;
    const { orgId, languageId } = this.port.o;
    try {
      return await nearbyKeepOf({ nearbyMeta: (k) => client.nearbyMeta(k), writeNearbyMeta: (r) => client.writeNearbyMeta(r) }, { orgId, streamId: languageId }).holdings();
    } catch {
      return new Map();
    }
  }

  /** Stored at the size held here, as `evictableOf` asks. */
  private storedHere(plan: FilePlan): (hash: string) => boolean {
    const sizes = this.files.sizes();
    return (hash) => {
      const v = plan.verdict(hash);
      return v?.stored === true && sizes.get(hash) === v.size;
    };
  }

  private async holding(): Promise<number> {
    const present = this.here();
    const hashes = this.marksHere().map((m) => m.hash).filter((h) => present.has(h));
    if (hashes.length === 0) return 0;
    const plan = await this.port.plan.plan({ hashes });
    return hashes.filter((h) => plan.verdict(h)?.stored !== true).length;
  }

  /** File hashes per open-for-review passage, in the order the app offers them; null for someone who cannot review. */
  private async reviewOrder(): Promise<string[][] | null> {
    if (!this.platform.canReview(this.languageId)) return null;
    const passages = openForReviewOf(this.port.client.passageLines(), buildIndexes(this.port.client.getState()).passages);
    if (passages.length === 0) return [];
    const plan = await this.port.plan.plan({ units: passages });
    return passages.map((u) => [...(plan.idx.own.get(u) ?? [])]);
  }

  /**
   * This language's marks with their groups and copies worked out now (`nearbyGroupOf`), so a
   * backup in a passage this person is later asked to review is needed, and a file open for
   * review is a backup once someone has checked it. Written back when anything moved, so another
   * language's session can free them from the mark alone.
   */
  private async freshMarks(holdings?: Holdings): Promise<{ marks: NearbyMark[]; plan: FilePlan }> {
    const old = this.marksHere();
    const scope = await this.port.scope();
    const plan = await this.port.plan.plan({ units: scope, hashes: old.map((m) => m.hash) });
    const named = new Set(old.map((m) => m.hash).filter((h) => plan.refs.has(h)));
    const offlineScope = scope.size === 0 ? new Set<string>() : forScope(plan, scope).needed;
    const review = new Set((await this.reviewOrder())?.flat() ?? []);
    const copies = copiesOf(holdings ?? await this.holdings());
    const marks = old.map((m) => ({ ...m, group: nearbyGroupOf(m.hash, { named, offlineScope, review }), copies: copies.get(m.hash) ?? 0 }));
    const moved = marks.filter((m, i) => m.group !== old[i]!.group || m.copies !== old[i]!.copies);
    if (moved.length) {
      await this.platform.marks.put(moved);
      for (const m of moved) this.all.set(m.hash, m);
    }
    return { marks, plan };
  }

  /** Level 2, in the order it goes, with this language's groups worked out now. */
  private async level2(): Promise<{ hash: string; format: string }[]> {
    if (this.all.size === 0) return [];
    const { marks, plan } = await this.freshMarks();
    const stored = this.storedHere(plan);
    const fresh = new Map(marks.map((m) => [m.hash, m]));
    // Another language's from its mark alone, as its session last saw it: this one cannot see its verdicts.
    const every = [...this.all.values()].map((m) => fresh.get(m.hash) ?? m);
    return nearbyEvictableOf(every, this.here(), this.files.sizes(), (h) => fresh.has(h) && stored(h));
  }

  /** With `reserve`, level 1 alone, keeping that much more free: it gives way for a nearby file, and level 2 never does. */
  async reclaim(level1: readonly { hash: string; format: string }[], reserve?: number): Promise<number> {
    const lists = reserve === undefined ? [level1, await this.level2()] : [level1];
    if (this.port.closed()) return 0;
    const { limits } = this.port.o;
    const sizes = new Map(this.files.sizes());
    const gone = this.files.reclaim(lists, { ...limits, minFreeBytes: limits.minFreeBytes + (reserve ?? 0), uncapped: this.marked() });
    if (!Array.isArray(gone)) return 0;
    await this.forgotten(gone as string[]);
    return (gone as string[]).reduce((n, h) => n + (sizes.get(h) ?? 0), 0);
  }

  /** The store deleted these: their marks go. */
  private async forgotten(hashes: readonly string[]): Promise<void> {
    const gone = hashes.filter((h) => this.all.has(h));
    if (gone.length === 0) return;
    await this.platform.marks.drop(gone);
    for (const h of gone) this.all.delete(h);
    this.changed();
  }

  private remove(hashes: readonly string[]): readonly string[] {
    const refs = hashes.map((hash) => ({ hash, format: this.files.formatOf(hash) ?? this.all.get(hash)?.format ?? 'm4a' }));
    return this.fetchFile.remove(refs);
  }

  async afterSync(): Promise<void> {
    try {
      await this.settle();
    } catch { /* disk queries can fail on some devices; the next sync tries again */ }
  }

  private async settle(): Promise<void> {
    if (this.marksHere().length === 0) return;
    const holdings = await this.holdings();
    const { marks, plan } = await this.freshMarks(holdings);
    const present = this.here();
    const sizes = this.files.sizes();
    // A backup the server holds at the size held here goes at once, on every phone, whatever the row says.
    const confirmed = backupsConfirmedOf(marks.filter((m) => present.has(m.hash)), (h) => plan.verdict(h), sizes);
    const gone = new Set(this.remove(confirmed));
    // A file open for review falls to level 1 and a needed one stays: they are no longer nearby files.
    const stored = this.storedHere(plan);
    const unmark = marks.filter((m) => !gone.has(m.hash) && (m.group === 'review' || m.group === 'needed') && stored(m.hash)).map((m) => m.hash);
    await this.forgotten([...gone, ...unmark]);
    await this.shed(holdings);
  }

  /** The wanted list with no file left out for being here already. */
  private async wantedAll(holdings: Holdings, choice: HoldChoice): Promise<WantedFile[]> {
    const state = this.port.client.getState();
    // Every file the language names, kept on disk or not: a store query over audio rows, not a walk of memory's plan.
    const plan = await this.port.plan.plan({ units: Object.keys(state.units) });
    const scope = await this.port.scope();
    const refs = [...plan.refs.values()].map((r) => ({ hash: r.hash, format: r.format, confirmed: plan.verdict(r.hash)?.stored === true }));
    return wantedFilesOf({
      refs, offlineScope: scope.size === 0 ? new Set() : forScope(plan, scope).needed, reviewOrder: await this.reviewOrder(),
      copies: copiesOf(holdings), planOrder: [...plan.order.keys()]
    }, choice);
  }

  /** With the row off: what need not be kept (`nearbyShedOf`). With it on or not known, nothing. */
  private async shed(holdings: Holdings): Promise<void> {
    const choice = this.choice();
    if (!choice || choice.hold) return;
    const present = this.here();
    const { marks, plan } = await this.freshMarks(holdings);
    const here = marks.filter((m) => present.has(m.hash));
    if (here.length === 0) return;
    const wanted = new Set((await this.wantedAll(holdings, choice)).map((w) => w.hash));
    const key = this.platform.installKey();
    const out = nearbyShedOf(here, wanted, key ? holdings : new Map(), { key: key ?? '', signedIn: this.port.o.actorId }, this.storedHere(plan));
    await this.forgotten(this.remove(out));
  }

  // ---- the third worker ------------------------------------------------------------

  private jobWork(): BlobRef[] {
    const job = this.job;
    if (!job) return [];
    const present = this.here();
    const left = job.list.filter((f) => !job.tried.has(f.hash) && !present.has(f.hash));
    if (left.length === 0 || !job.linkUp()) {
      job.finish();
      return [];
    }
    return left.map((f) => ({ hash: f.hash, format: f.format as BlobRef['format'], unitId: '' }));
  }

  private async fetchOne(ref: BlobRef): Promise<void> {
    const job = this.job;
    const file = job?.byHash.get(ref.hash);
    if (!job || !file) return;
    if (job.stop(file)) { job.finish(); return; }
    job.tried.add(file.hash);
    let stage: Awaited<ReturnType<NearbyFileMoves['fetchFile']>>;
    try {
      stage = await this.stage(file);
    } catch {
      return;
    }
    if (!stage) {
      job.noRoom = true;
      job.finish();
      return;
    }
    try {
      await job.fetch(file, stage);
    } catch (err) {
      job.finish(err);
      throw err instanceof Error ? err : new OfflineError('the link dropped');
    }
    if (this.jobWork().length === 0) job.finish();
  }

  /** Level 1 gives way first, before a nearby file lands, not after; level 2 never gives way for one. */
  private async stage(file: WantedFile): Promise<{ stagingUri: string; maxBytes: number; minFreeBytes: number } | null> {
    const { fetchFile } = this;
    const { limits } = this.port.o;
    const reserve = this.port.plan.sizeOf(file.hash) ?? 0;
    const freed = await this.reclaim(await this.port.level1(), reserve);
    const free = fetchFile.freeBytes();
    if (free !== null && free + freed - reserve < limits.minFreeBytes) return null;
    const stagingUri = fetchFile.stagingUri(file);
    if (!stagingUri) throw new Error('not a file name this store makes');
    return { stagingUri, maxBytes: MAX_FILE_BYTES, minFreeBytes: limits.minFreeBytes };
  }

  private choice(): HoldChoice | null {
    return this.port.o.holdChoice?.() ?? null;
  }

  moves(): NearbyFileMoves {
    const { port, fetchFile, files } = this;
    return {
      wanted: async (holdings) => {
        const present = this.here();
        return (await this.wantedAll(holdings, this.choice() ?? UNKNOWN_CHOICE)).filter((w) => !present.has(w.hash));
      },
      serveFile: async ({ hash, format }) => {
        // Only a file this language names: a redacted event's file is no longer named (5.6).
        const plan = await port.plan.plan({ hashes: [hash] });
        if (!plan.refs.has(hash)) return { no: 'not-referenced' };
        if (!this.here().has(hash)) return { no: 'not-here' };
        const uri = fetchFile.uriOf({ hash, format: files.formatOf(hash) ?? format });
        return uri ? { uri, size: files.sizeOf(hash) ?? 0 } : { no: 'not-here' };
      },
      fetchFile: (file) => this.stage(file),
      landed: async (file, stagingUri, size) => {
        // The same bytes are here already, maybe this person's own: no mark can make them deletable.
        if (this.here().has(file.hash) && !this.all.has(file.hash)) {
          await fetchFile.discard(stagingUri);
          return;
        }
        // The mark before the name: a crash between leaves a mark on nothing, never a teammate's file unmarked and so counted as this person's.
        const mark: NearbyMark = { hash: file.hash, format: file.format, languageId: this.languageId, group: file.group, copies: 0 };
        await this.platform.marks.put([mark]);
        this.all.set(mark.hash, mark);
        await fetchFile.commit(file, stagingUri, size);
        this.changed();
      },
      discard: (stagingUri) => fetchFile.discard(stagingUri),
      held: async () => {
        const present = [...this.here()];
        const plan = await port.plan.plan({ hashes: present });
        return present.filter((h) => plan.refs.has(h) && plan.verdict(h)?.stored !== true).sort();
      },
      holds: () => this.choice()?.hold === true,
      shed: (holdings) => this.shed(holdings),
      take: (job) => this.take(job)
    };
  }

  /** A session's files through the third worker: its backoff and its pause while recording. Resolves when each was tried once, the link went, room ran out or `stop` said so. */
  private take(asked: NearbyFetchJob): Promise<{ noRoom: boolean }> {
    this.job?.finish(new OfflineError('a later session took over'));
    return new Promise((resolve, reject) => {
      const job: Job = {
        ...asked,
        byHash: new Map(asked.list.map((f) => [f.hash, f])),
        tried: new Set(),
        noRoom: false,
        finish: (error) => {
          if (this.job !== job) return;
          this.job = null;
          if (error === undefined) resolve({ noRoom: job.noRoom });
          else reject(error instanceof Error ? error : new OfflineError(String(error)));
        }
      };
      this.job = job;
      this.worker.trigger();
    });
  }
}
