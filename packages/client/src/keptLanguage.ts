import { keptRecording, keptVerdict, markChanged, referencedBlobs, type LanguageState } from '@langquest-next/core';
import type { EventStore, KeptRecord } from './types';

type Recording = LanguageState['recordings'][string];
type Verdict = LanguageState['blobs'][string];

/**
 * What a big language keeps on the phone instead of in memory (decisions.md
 * 103): its recordings, and the server's verdict on each audio file. In
 * Koro Miyan they are 33 of the language's 40 MB, and they grow with every
 * recording. Everything else about the language stays in memory.
 *
 * Memory holds the recordings of the passages a screen has open and their
 * neighbours (`load`), whatever arrived since the last checkpoint, and the
 * verdicts on files anything in memory names. The checkpoint holds the
 * rest of the language; these rows hold the recordings and verdicts as of
 * the same checkpoint, written in the same commit, so the two never
 * disagree. Rows combine with what a later event folds by the fold's own
 * rules (`keptRecording`, `keptVerdict`), so arrival order still does not
 * matter.
 */
export const KEPT_MAPS: ReadonlySet<string> = new Set(['recordings', 'blobs']);

/** The rows that keep one recording: the recording, and a card row per file so a file can be traced to its passage. */
export function recordingRows(id: string, r: Recording): KeptRecord[] {
  return [
    { kind: 'recording', id, unitId: r.unitId, actorId: r.actorId, json: JSON.stringify(r) },
    ...r.cards.map((c): KeptRecord => ({ kind: 'card', id: c.hash, unitId: r.unitId, actorId: '', json: JSON.stringify({ recordingId: id }) }))
  ];
}

export function fileRow(hash: string, v: Verdict): KeptRecord {
  return { kind: 'file', id: hash, unitId: '', actorId: '', json: JSON.stringify(v) };
}

/** Rows for one entry of a kept map, read from a snapshot's text. */
export function rowsFromText(map: string, id: string, json: string): KeptRecord[] {
  if (map === 'recordings') return recordingRows(id, JSON.parse(json) as Recording);
  return [{ kind: 'file', id, unitId: '', actorId: '', json }];
}

/** A state without its kept maps: what a checkpoint holds. */
export function withoutKept(state: LanguageState): LanguageState {
  return { ...state, recordings: {}, blobs: {} };
}

/** Does this state still hold kept maps' entries (a checkpoint from before decision 103)? */
export function holdsKept(state: LanguageState): boolean {
  for (const _ in state.recordings) return true;
  for (const _ in state.blobs) return true;
  return false;
}

export class KeptLanguage {
  /** Passages whose recordings memory holds, most recently asked for last. */
  private open: string[] = [];

  constructor(
    private readonly store: EventStore,
    private readonly orgId: string,
    private readonly streamId: string,
    /** How many passages' recordings memory holds at once: the open one and its neighbours. */
    private readonly limit = 12
  ) {}

  /** The passages whose recordings are in memory. */
  openUnits(): readonly string[] {
    return this.open;
  }

  /**
   * Rows for every kept-map entry this state holds, each combined with the
   * copy already kept, ready to write with a checkpoint of the same state.
   */
  async rowsFor(state: LanguageState): Promise<KeptRecord[]> {
    const ids = Object.keys(state.recordings);
    const hashes = Object.keys(state.blobs);
    const rows: KeptRecord[] = [];
    const priorRecordings = new Map((await this.store.keptById(this.orgId, this.streamId, 'recording', ids)).map((r) => [r.id, JSON.parse(r.json) as Recording]));
    for (const id of ids) {
      const prior = priorRecordings.get(id);
      const here = state.recordings[id]!;
      rows.push(...recordingRows(id, prior ? keptRecording(prior, here) : here));
    }
    const priorVerdicts = new Map((await this.store.keptById(this.orgId, this.streamId, 'file', hashes)).map((r) => [r.id, JSON.parse(r.json) as Verdict]));
    for (const hash of hashes) {
      const prior = priorVerdicts.get(hash);
      const here = state.blobs[hash]!;
      rows.push(fileRow(hash, prior ? keptVerdict(prior, here) : here));
    }
    return rows;
  }

  /**
   * After a checkpoint of this very state: let go of what is kept now and
   * not in use, the recordings of passages not open and the verdicts on
   * files nothing left in memory names.
   */
  shed(state: LanguageState): void {
    const open = new Set(this.open);
    let changed = false;
    for (const [id, r] of Object.entries(state.recordings)) {
      if (!open.has(r.unitId)) {
        delete state.recordings[id];
        changed = true;
      }
    }
    const named = this.named(state);
    for (const hash of Object.keys(state.blobs)) {
      if (!named.has(hash)) {
        delete state.blobs[hash];
        changed = true;
      }
    }
    if (changed) markChanged(state);
  }

  /**
   * Hold these passages' recordings in memory (and the verdicts on their
   * files), dropping the passages asked for longest ago beyond `limit` at
   * the next checkpoint. True when memory changed.
   */
  async load(state: LanguageState, unitIds: readonly string[]): Promise<boolean> {
    const fresh = unitIds.filter((u) => !this.open.includes(u));
    this.open = [...this.open.filter((u) => !unitIds.includes(u)), ...unitIds].slice(-this.limit);
    if (fresh.length === 0) return false;
    return this.bring(state, fresh);
  }

  /** Bring the open passages' recordings and the verdicts memory needs back after the state was rebuilt from its checkpoint. */
  async hydrate(state: LanguageState): Promise<boolean> {
    return this.bring(state, this.open);
  }

  private async bring(state: LanguageState, unitIds: readonly string[]): Promise<boolean> {
    let changed = false;
    if (unitIds.length > 0) {
      for (const row of await this.store.keptByUnit(this.orgId, this.streamId, 'recording', unitIds)) {
        const kept = JSON.parse(row.json) as Recording;
        const here = state.recordings[row.id];
        state.recordings[row.id] = here ? keptRecording(kept, here) : kept;
        changed = true;
      }
      // What memory names now includes these recordings' files.
      if (changed) markChanged(state);
    }
    const missing = [...this.named(state)].filter((h) => !state.blobs[h]);
    for (const row of await this.store.keptById(this.orgId, this.streamId, 'file', missing)) {
      state.blobs[row.id] = JSON.parse(row.json) as Verdict;
      changed = true;
    }
    if (changed) markChanged(state);
    return changed;
  }

  /**
   * Files something in memory names: a recording in memory, a note, a
   * review or a material. A version's files are its passage's recordings',
   * so they come with the passage; counting every version's would bring
   * back every verdict of a language like Koro, whose versions name 60,000.
   */
  private named(state: LanguageState): Set<string> {
    return new Set(referencedBlobs(state).keys());
  }
}
