import {
  askedOfLines, defaultOfflineScope, downloadWorkOf, evictableOf, filePlan, filePlanOf, keptVerdict, lostFilesOf, offlineCountsOf,
  offlineSummaryOf, referencedBlobs, unitsAskedOf, uploadWorkOf, voiceFormat, workedBy,
  type BlobRef, type FilePlan, type LanguageState, type LostFilesView, type OfflineReasons, type OfflineSummary, type UnitOffline
} from '@langquest-next/core';
import { AUDIO, FILE, type AudioRow } from './keptLanguage';
import type { SyncClient } from './syncClient';
import type { EventStore } from './types';

type Verdict = LanguageState['blobs'][string];

/**
 * Which audio files to send, fetch or free, and how much of each passage
 * is on the phone (decisions.md 110). Each answer is core's own
 * (`uploadWorkOf` and the rest), worked out from a plan of the files in
 * question: those memory names, and, for a language kept on disk, those
 * its table lists for the passages or files a question is about. The
 * table says which record names each file and in which passage (`audio`
 * rows) and what the server said of it (`file` rows), so planning never
 * reads the records themselves, however many passages a person keeps
 * offline. A language held whole in memory answers from memory.
 */
export class LanguageFiles {
  /** Sizes the server gave for files in the last download list, for the transfer budget. */
  private sizes = new Map<string, number>();

  constructor(
    private readonly client: SyncClient<LanguageState>,
    private readonly store: EventStore,
    private readonly orgId: string,
    private readonly streamId: string
  ) {}

  /** The passages a person keeps offline by default: asked of them, or worked in (core `defaultOfflineScope`). */
  async scope(actorId: string): Promise<Set<string>> {
    const live = this.client.getState();
    if (!this.client.keptRecords()) return defaultOfflineScope(live, actorId);
    const scope = askedOfLines(this.client.passageLines(), live, actorId);
    for (const u of workedBy(live, actorId)) scope.add(u);
    for (const u of await this.store.keptUnits(this.orgId, this.streamId, ['recording', 'take'], actorId)) scope.add(u);
    return scope;
  }

  /** Why a person keeps passages, for the offline marks: asked of them, or kept by default. */
  private async reasons(actorId: string): Promise<OfflineReasons> {
    const live = this.client.getState();
    const asked = this.client.keptRecords() ? askedOfLines(this.client.passageLines(), live, actorId) : unitsAskedOf(live, actorId);
    return { mine: await this.scope(actorId), asked };
  }

  /** Files on this phone that have not reached the server intact. */
  async upload(present: ReadonlySet<string>, localSizes?: ReadonlyMap<string, number>): Promise<BlobRef[]> {
    return uploadWorkOf(await this.plan({ hashes: present }), present, localSizes);
  }

  /** Files the server has that these passages need and this phone does not. */
  async download(present: ReadonlySet<string>, scope: ReadonlySet<string>): Promise<BlobRef[]> {
    const plan = await this.plan({ units: scope });
    const list = downloadWorkOf(plan, present, scope);
    this.sizes = new Map(list.map((r) => [r.hash, plan.verdict(r.hash)?.size ?? 0]));
    return list;
  }

  /** Files this phone may delete to make room: the server has them and no kept passage needs them. */
  async evictable(present: ReadonlySet<string>, scope: ReadonlySet<string>, localSizes?: ReadonlyMap<string, number>): Promise<BlobRef[]> {
    return evictableOf(await this.plan({ units: scope, hashes: present }), present, scope, localSizes);
  }

  /** How much of each of these passages' audio is on this phone. */
  async byUnit(unitIds: readonly string[], present: ReadonlySet<string>, actorId: string, chosen: ReadonlySet<string>): Promise<Map<string, UnitOffline>> {
    return offlineCountsOf(await this.plan({ units: unitIds }), unitIds, present, chosen, await this.reasons(actorId));
  }

  /** The offline scope at a glance (Settings). */
  async summary(present: ReadonlySet<string>, actorId: string, chosen: ReadonlySet<string>): Promise<OfflineSummary> {
    const why = await this.reasons(actorId);
    const units = new Set(why.mine);
    for (const u of chosen) units.add(u);
    return offlineSummaryOf(await this.plan({ units }), present, chosen, why);
  }

  /** What the files a phone lost behind the app's back were (decisions.md 92). */
  async lost(hashes: readonly string[]): Promise<LostFilesView> {
    return lostFilesOf(await this.plan({ hashes }), hashes);
  }

  /** Does the language hold this recording, in memory or on disk? */
  async hasRecording(id: string): Promise<boolean> {
    if (this.client.getState().recordings[id]) return true;
    return !!this.client.keptRecords() && (await this.store.keptById(this.orgId, this.streamId, 'recording', [id])).length > 0;
  }

  /** A file's size as the server confirmed it, from memory or the last download list. */
  sizeOf(hash: string): number | undefined {
    return this.client.getState().blobs[hash]?.size ?? this.sizes.get(hash);
  }

  /**
   * What was read from disk, kept until the rows there change (a checkpoint,
   * a fresh snapshot): the transfer workers ask after every sync and every
   * file, and a work list that waited on the database each time (behind the
   * sync's own writes, on the web) kept missing the moments between syncs
   * when uploads may run, so a recording made offline could wait minutes.
   * Each audio row and verdict is a few dozen bytes: a person who keeps a
   * whole language offline holds its file list, never its records.
   */
  private cache = {
    version: -1,
    unitFiles: new Map<string, string[]>(),
    audio: new Map<string, (AudioRow & { unitId: string }) | null>(),
    verdicts: new Map<string, Verdict | null>()
  };

  /** The files memory names, and, from disk, those of these passages and these files, with the server's verdict on each. */
  private async plan(about: { units?: Iterable<string>; hashes?: Iterable<string> }): Promise<FilePlan> {
    const live = this.client.getState();
    const kept = this.client.keptRecords();
    if (!kept) return filePlanOf(live);
    const { orgId, streamId } = this;
    let c = this.cache;
    if (c.version !== kept.version) {
      c = this.cache = { version: kept.version, unitFiles: new Map(), audio: new Map(), verdicts: new Map() };
    }
    const hold = (hash: string, unitId: string, json: string) => { c.audio.set(hash, { ...(JSON.parse(json) as AudioRow), unitId }); };

    const units = [...(about.units ?? [])];
    const newUnits = units.filter((u) => !c.unitFiles.has(u));
    if (newUnits.length) {
      for (const u of newUnits) c.unitFiles.set(u, []);
      for (const r of await this.store.keptByUnit(orgId, streamId, [AUDIO], newUnits)) {
        hold(r.id, r.unitId, r.json);
        c.unitFiles.get(r.unitId)?.push(r.id);
      }
    }
    const hashes = [...(about.hashes ?? [])];
    const newHashes = hashes.filter((h) => !c.audio.has(h));
    if (newHashes.length) {
      for (const h of newHashes) c.audio.set(h, null);
      for (const r of await this.store.keptById(orgId, streamId, AUDIO, newHashes)) hold(r.id, r.unitId, r.json);
    }

    const refs = new Map(referencedBlobs(live));
    const add = (hash: string) => {
      if (refs.has(hash)) return;
      const a = c.audio.get(hash);
      if (a) refs.set(hash, { hash, format: a.f ?? voiceFormat(live, hash), unitId: a.unitId });
    };
    for (const u of units) for (const h of c.unitFiles.get(u) ?? []) add(h);
    for (const h of hashes) add(h);

    const files = new Set([...refs.keys(), ...hashes]);
    const newFiles = [...files].filter((h) => !c.verdicts.has(h));
    if (newFiles.length) {
      for (const h of newFiles) c.verdicts.set(h, null);
      for (const v of await this.store.keptById(orgId, streamId, FILE, newFiles)) c.verdicts.set(v.id, JSON.parse(v.json) as Verdict);
    }
    return filePlan(live, refs, (hash) => {
      const here = live.blobs[hash];
      const keptCopy = c.verdicts.get(hash);
      return here && keptCopy ? keptVerdict(keptCopy, here) : here ?? keptCopy ?? undefined;
    });
  }
}
