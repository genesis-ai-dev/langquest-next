import {
  defaultOfflineScope, deriveDownloadWork, deriveUploadWork, evictableBlobs, keptRecording, keptVerdict, lostFilesView,
  offlineByUnit, offlineSummary, type BlobRef, type LanguageState, type LostFilesView, type OfflineSummary, type UnitOffline
} from '@langquest-next/core';
import type { SyncClient } from './syncClient';
import type { EventStore } from './types';

type Recording = LanguageState['recordings'][string];
type Verdict = LanguageState['blobs'][string];

/**
 * Which audio files to send, fetch or free, and how much of each passage
 * is on the phone, for a language that keeps its recordings on disk
 * (decisions.md 104). Each answer is core's own (`deriveUploadWork` and the
 * rest), run on a view of the language that adds from disk exactly the
 * recordings and verdicts the question is about: the files on the phone,
 * or the passages kept offline. Memory then follows those, not the whole
 * language. A language that keeps everything in memory answers from memory.
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
    const scope = defaultOfflineScope(this.client.getState(), actorId);
    if (this.client.keptRecords()) for (const u of await this.store.keptUnitsBy(this.orgId, this.streamId, actorId)) scope.add(u);
    return scope;
  }

  /** Files on this phone that have not reached the server intact. */
  async upload(present: ReadonlySet<string>, localSizes?: ReadonlyMap<string, number>): Promise<BlobRef[]> {
    return deriveUploadWork(await this.view({ hashes: present }), present, localSizes);
  }

  /** Files the server has that these passages need and this phone does not. */
  async download(present: ReadonlySet<string>, scope: ReadonlySet<string>): Promise<BlobRef[]> {
    const view = await this.view({ units: scope });
    const list = deriveDownloadWork(view, present, scope);
    this.sizes = new Map(list.map((r) => [r.hash, view.blobs[r.hash]?.size ?? 0]));
    return list;
  }

  /** Files this phone may delete to make room: the server has them and no kept passage needs them. */
  async evictable(present: ReadonlySet<string>, scope: ReadonlySet<string>, localSizes?: ReadonlyMap<string, number>): Promise<BlobRef[]> {
    return evictableBlobs(await this.view({ units: scope, hashes: present }), present, scope, localSizes);
  }

  /** How much of each of these passages' audio is on this phone. */
  async byUnit(unitIds: readonly string[], present: ReadonlySet<string>, actorId: string, chosen: ReadonlySet<string>): Promise<Map<string, UnitOffline>> {
    return offlineByUnit(await this.view({ units: unitIds }), unitIds, present, actorId, chosen);
  }

  /** The offline scope at a glance (Settings). */
  async summary(present: ReadonlySet<string>, actorId: string, chosen: ReadonlySet<string>): Promise<OfflineSummary> {
    const units = await this.scope(actorId);
    for (const u of chosen) units.add(u);
    return offlineSummary(await this.view({ units }), present, actorId, chosen);
  }

  /** What the files a phone lost behind the app's back were (decisions.md 92). */
  async lost(hashes: readonly string[]): Promise<LostFilesView> {
    return lostFilesView(await this.view({ hashes }), hashes);
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

  /** Memory's language plus, from disk, these passages' recordings and the recordings holding these files, with their verdicts. */
  private async view(about: { units?: Iterable<string>; hashes?: Iterable<string> }): Promise<LanguageState> {
    const live = this.client.getState();
    if (!this.client.keptRecords()) return live;
    const { orgId, streamId } = this;
    const recordings: Record<string, Recording> = { ...live.recordings };
    const blobs: Record<string, Verdict> = { ...live.blobs };
    const add = (id: string, json: string) => {
      const kept = JSON.parse(json) as Recording;
      const here = recordings[id];
      recordings[id] = here ? keptRecording(kept, here) : kept;
    };
    const units = [...(about.units ?? [])];
    if (units.length) for (const r of await this.store.keptByUnit(orgId, streamId, 'recording', units)) add(r.id, r.json);
    const hashes = [...(about.hashes ?? [])];
    if (hashes.length) {
      const holding = new Set((await this.store.keptById(orgId, streamId, 'card', hashes)).map((c) => (JSON.parse(c.json) as { recordingId: string }).recordingId));
      for (const r of await this.store.keptById(orgId, streamId, 'recording', [...holding])) add(r.id, r.json);
    }
    const files = new Set(hashes);
    for (const r of Object.values(recordings)) for (const c of r.cards) files.add(c.hash);
    for (const v of await this.store.keptById(orgId, streamId, 'file', [...files])) {
      const kept = JSON.parse(v.json) as Verdict;
      const here = blobs[v.id];
      blobs[v.id] = here ? keptVerdict(kept, here) : kept;
    }
    return { ...live, recordings, blobs };
  }
}
