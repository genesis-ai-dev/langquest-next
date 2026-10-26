import {
  dropEntry, hangsOn, keptVerdict, markChanged, PART_OF_KIND, partEntries, passageInMemory, PASSAGE_PARTS, putEntry, recordAudio,
  referencedBlobs, rowId, splitInnerKey, studyMarkUnit, withOwnParts, withoutParts,
  type LanguageState, type PassageOf, type PassagePart
} from '@langquest-next/core';
import type { EventStore, KeptRecord } from './types';

type Verdict = LanguageState['blobs'][string];

/**
 * What a big language keeps on the phone instead of in memory (decisions.md
 * 110): every entry of the maps core cuts by passage (`PASSAGE_PARTS`:
 * recordings, versions and drafts, reviews, notes, requests and the rest),
 * the server's verdict on each audio file, which record names each audio
 * file, and each passage's line for lists (`KeptLines`). What the whole
 * language shares (its passages' order, the flow, teams, materials, key
 * terms) stays in memory.
 *
 * Memory holds the passages a screen has open and their neighbours
 * (`load`), whatever arrived since the last checkpoint, and the verdicts on
 * files anything in memory names. The checkpoint holds the rest of the
 * language; these rows hold the passages as of the same checkpoint,
 * written in the same commit, so the two never disagree. Rows combine with
 * what later events fold by the fold's own rules (each part's `merge`), so
 * arrival order still does not matter. An entry whose passage cannot be
 * found yet (an undo of a departure that has not arrived) waits in memory
 * and in the checkpoint until it can.
 */

/** Row kinds of the parts, in core's order. */
export const PART_KINDS: readonly string[] = PASSAGE_PARTS.map((p) => p.kind);
/** What `derivePassage` reads of a passage: what its line, its versions and its Inbox are worked out from. Not its recordings. */
export const RECORD_KINDS: readonly string[] = [
  'take', 'submission', 'response', 'review', 'withdrawnReview', 'departure', 'undoneDeparture', 'request', 'withdrawnRequest', 'note', 'withdrawnNote'
];
/** The server's verdict on an audio file, by hash. */
export const FILE = 'file';
/** Which record names an audio file, by hash, under that record's passage: planning reads these instead of the records. */
export const AUDIO = 'audio';
/** A passage's line (`KeptLines`). */
export const LINE = 'line';
/** The maps a snapshot's text is split on as it is read: the parts and the verdicts. */
export const SPLIT_MAPS: ReadonlySet<string> = new Set([...PASSAGE_PARTS.map((p) => p.map), 'blobs']);

/** What an audio row says: the record naming the file (kind and row id) and, for a recording's card or an artifact, its format. */
export interface AudioRow { k: string; i: string; f?: 'wav' | 'm4a' }

/** The rows that keep one placed entry: the entry, and an audio row per file it names. `json` is the entry's text when it came as text. */
export function entryRows(part: PassagePart, id: string, unitId: string, value: unknown, json = JSON.stringify(value)): KeptRecord[] {
  const [key, inner] = part.depth === 2 ? splitInnerKey(id) : [id, undefined];
  const rows: KeptRecord[] = [{ kind: part.kind, id, unitId, ref: part.ref?.(key, value, inner) ?? '', json }];
  for (const a of recordAudio(part.map, value)) {
    const audio: AudioRow = { k: part.kind, i: id, ...(a.format ? { f: a.format } : {}) };
    rows.push({ kind: AUDIO, id: a.hash, unitId, ref: '', json: JSON.stringify(audio) });
  }
  return rows;
}

export function fileRow(hash: string, v: Verdict, json = JSON.stringify(v)): KeptRecord {
  return { kind: FILE, id: hash, unitId: '', ref: '', json };
}

/** Does this state hold entries of the parts or verdicts that belong on disk (a checkpoint from before decision 143)? */
export function holdsKept(state: LanguageState): boolean {
  for (const _ in state.blobs) return true;
  for (const part of PASSAGE_PARTS) for (const _ in state[part.map] ?? {}) return true;
  return false;
}

/** An entry placed in a passage: what a checkpoint writes and memory may let go of. */
interface Placed { part: PassagePart; id: string; unitId: string }

export interface Split {
  /** Rows for every placed entry, combined with the copy already kept, and for every verdict. */
  rows: KeptRecord[];
  /** What the checkpoint holds: the shared language, and entries whose passage cannot be found yet. */
  lite: LanguageState;
  placed: Placed[];
}

export class KeptLanguage {
  /** Passages memory holds, most recently asked for last. */
  private open: string[] = [];
  /** Of those, the ones whose rows are all in memory now. */
  private readonly ready = new Set<string>();
  /**
   * Passages brought into memory since memory last let go (`shed`), open or
   * not: only a checkpoint may let go of them, since memory can hold work
   * newer than their rows. Someone reading passage after passage on a quiet
   * language never reached one, so memory grew with every passage, and what
   * memory names was worked out again over all of it at each open
   * (performance-audit-2026-10-26.md item 13).
   */
  private readonly brought = new Set<string>();
  /** Passages with any row on disk; read when the language opens, added to by each checkpoint. */
  private readonly onDisk = new Set<string>();
  /**
   * Passages whose rows the server has and the fill has not brought yet
   * (decisions.md 147): what the phone holds of them is part of their
   * record, so it never works out their lines or shows them as whole.
   */
  private readonly unfilled = new Set<string>();
  /** Of those, the ones a screen or this phone's own work asked for: filled first. */
  private readonly wanted = new Set<string>();
  private revision = 0;

  constructor(
    private readonly store: EventStore,
    private readonly orgId: string,
    private readonly streamId: string,
    /** How many passages memory holds at once: the open one and its neighbours. */
    private readonly limit = 12
  ) {}

  /** The passages memory holds. */
  openUnits(): readonly string[] {
    return this.open;
  }

  /** Is this passage's whole record in memory, so a screen may read it from the state? */
  isLoaded(unitId: string): boolean {
    return this.ready.has(unitId) && !this.unfilled.has(unitId);
  }

  /** Does memory hold everything the disk holds of this passage (it was brought in), whether or not all its rows are here yet? */
  isHeld(unitId: string): boolean {
    return this.ready.has(unitId);
  }

  /** Is everything this passage's record holds in memory: brought in, or never written to disk, and none of it still on the server? Its line can then be read off memory. */
  isWhole(unitId: string): boolean {
    return !this.unfilled.has(unitId) && (this.ready.has(unitId) || !this.onDisk.has(unitId));
  }

  /** Are all this passage's rows on this phone: filled in, or never waiting on the server (decisions.md 147)? */
  isFilled(unitId: string): boolean {
    return !this.unfilled.has(unitId);
  }

  /** The passages still to fill in, read from the fill's record when the language opens. */
  setUnfilled(unitIds: Iterable<string>): void {
    this.unfilled.clear();
    this.wanted.clear();
    for (const u of unitIds) this.unfilled.add(u);
  }

  unfilledCount(): number {
    return this.unfilled.size;
  }

  /** These passages' rows are all here now. */
  filled(unitIds: Iterable<string>): void {
    for (const u of unitIds) { this.unfilled.delete(u); this.wanted.delete(u); }
  }

  /** Fill these first, of those not filled in. */
  want(unitIds: Iterable<string>): void {
    for (const u of unitIds) if (this.unfilled.has(u)) this.wanted.add(u);
  }

  wantedUnits(): string[] {
    return [...this.wanted];
  }

  /** Bumped whenever the rows on disk change (a checkpoint, a fresh snapshot), so lookups cached from them start again. */
  get version(): number {
    return this.revision;
  }

  changed(): void {
    this.revision += 1;
  }

  /**
   * Cut a state for a checkpoint of it: rows for every entry whose passage
   * memory or the rows already kept can name, each combined with the copy
   * already kept; and what the checkpoint itself holds.
   */
  async split(state: LanguageState, opts: { whole?: boolean } = {}): Promise<Split> {
    const entries = [...partEntries(state)];
    // A passage memory can name, else the one the rows say for what an entry hangs on.
    const onDisk = new Map<string, Map<string, string>>();
    const look: { kind: string; id: string }[] = [];
    const found = entries.map((e) => {
      const of = e.part.passage(e.key, e.value as never, e.inner);
      const unitId = passageInMemory(state, of);
      if (!unitId) { const on = hangsOn(of); if (on) look.push(on); }
      return { e, of, unitId };
    });
    for (const [kind, ids] of groupBy(look)) {
      const rows = await this.store.keptById(this.orgId, this.streamId, kind, ids);
      onDisk.set(kind, new Map(rows.map((r) => [r.id, r.unitId])));
    }
    const placed: (Placed & { value: unknown })[] = [];
    const lite = withoutParts(state);
    lite.blobs = {};
    for (const { e, of, unitId } of found) {
      const on = hangsOn(of);
      const at = unitId ?? (on ? onDisk.get(on.kind)?.get(on.id) : undefined);
      if (at) placed.push({ part: e.part, id: rowId(e), unitId: at, value: e.value });
      else putEntry(lite, e.part, rowId(e), e.value);
    }
    // The kept copies of entries memory does not hold whole (passages not loaded), to combine with.
    const priors = new Map<string, unknown>();
    // A whole language (a checkpoint from a build that held it all) is every copy there is: rows on disk are older, never combined in.
    const toRead = opts.whole ? [] : placed.filter((p) => !this.ready.has(p.unitId)).map((p) => ({ kind: p.part.kind, id: p.id }));
    for (const [kind, ids] of groupBy(toRead)) {
      for (const r of await this.store.keptById(this.orgId, this.streamId, kind, ids)) priors.set(`${kind}\u0000${r.id}`, JSON.parse(r.json));
    }
    const rows: KeptRecord[] = [];
    for (const p of placed) {
      const prior = priors.get(`${p.part.kind}\u0000${p.id}`);
      rows.push(...entryRows(p.part, p.id, p.unitId, prior === undefined ? p.value : p.part.merge(prior, p.value)));
    }
    const hashes = Object.keys(state.blobs);
    const priorVerdicts = new Map(opts.whole ? [] : (await this.store.keptById(this.orgId, this.streamId, FILE, hashes)).map((r) => [r.id, JSON.parse(r.json) as Verdict]));
    for (const hash of hashes) {
      const prior = priorVerdicts.get(hash);
      const here = state.blobs[hash]!;
      rows.push(fileRow(hash, prior ? keptVerdict(prior, here) : here));
    }
    return { rows, lite, placed: placed.map(({ part, id, unitId }) => ({ part, id, unitId })) };
  }

  /**
   * After a checkpoint of this very state: let go of what is kept now and
   * not in use, the entries of passages not open and the verdicts on files
   * nothing left in memory names.
   */
  shed(state: LanguageState, placed: readonly Placed[]): void {
    const open = new Set(this.open);
    for (const u of [...this.brought]) if (!open.has(u)) this.brought.delete(u);
    let changed = false;
    this.stored(placed);
    for (const p of placed) {
      if (open.has(p.unitId)) continue;
      dropEntry(state, p.part, p.id);
      changed = true;
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
   * Hold these passages in memory (and the verdicts on their files),
   * dropping the passages asked for longest ago beyond `limit` at the next
   * checkpoint. True when a passage became ready.
   */
  /** Has memory taken in far more passages than it keeps open? Then a checkpoint should let go of them. */
  holdsTooMany(): boolean {
    return this.brought.size > this.limit * 4;
  }

  async load(state: LanguageState, unitIds: readonly string[]): Promise<boolean> {
    // A passage a screen opens before its rows arrive is filled next (decisions.md 147).
    this.want(unitIds);
    const fresh = unitIds.filter((u) => !this.open.includes(u));
    this.open = [...this.open.filter((u) => !unitIds.includes(u)), ...unitIds].slice(-this.limit);
    for (const u of [...this.ready]) if (!this.open.includes(u)) this.ready.delete(u);
    if (fresh.length === 0) return false;
    for (const u of fresh) this.brought.add(u);
    await this.bring(state, fresh);
    // Ready now, whether or not anything came in: a screen waiting on it must be told.
    return true;
  }

  /** Bring the open passages and the verdicts memory needs back after the state was rebuilt from its checkpoint. */
  async hydrate(state: LanguageState): Promise<boolean> {
    this.ready.clear();
    this.onDisk.clear();
    for (const u of await this.store.keptUnits(this.orgId, this.streamId, PART_KINDS)) this.onDisk.add(u);
    return this.bring(state, this.open);
  }

  /** These entries are on disk now (a checkpoint wrote them). */
  stored(placed: readonly Placed[]): void {
    for (const p of placed) this.onDisk.add(p.unitId);
  }

  private async bring(state: LanguageState, unitIds: readonly string[]): Promise<boolean> {
    let changed = false;
    if (unitIds.length > 0) {
      for (const row of await this.store.keptByUnit(this.orgId, this.streamId, PART_KINDS, unitIds)) {
        putEntry(state, PART_OF_KIND.get(row.kind)!, row.id, JSON.parse(row.json));
        changed = true;
      }
      for (const u of unitIds) if (this.open.includes(u)) this.ready.add(u);
      // What memory names now includes these passages' files.
      if (changed) markChanged(state);
    }
    const missing = [...this.named(state)].filter((h) => !state.blobs[h]);
    for (const row of await this.store.keptById(this.orgId, this.streamId, FILE, missing)) {
      state.blobs[row.id] = JSON.parse(row.json) as Verdict;
      changed = true;
    }
    if (changed) markChanged(state);
    return changed;
  }

  /**
   * The language as memory holds it plus, from disk, these passages' rows
   * of these kinds: what a list works out a few passages from (their lines,
   * the Inbox, a key term's uses). Memory's entries are taken before the
   * rows are read, so a checkpoint meanwhile loses nothing; the state
   * itself is never changed.
   */
  async view(live: LanguageState, unitIds: readonly string[], kinds: readonly string[] = PART_KINDS, streamId = this.streamId): Promise<LanguageState> {
    const out = withOwnParts(live);
    if (unitIds.length > 0) {
      for (const row of await this.store.keptByUnit(this.orgId, streamId, kinds, unitIds)) putEntry(out, PART_OF_KIND.get(row.kind)!, row.id, JSON.parse(row.json));
    }
    return out;
  }

  /** The passage an entry, or what it hangs on, belongs to: from memory, else from the rows kept. Null when it is nowhere yet. */
  async passageOf(state: LanguageState, of: PassageOf | null): Promise<string | null> {
    const unitId = passageInMemory(state, of);
    if (unitId) return unitId;
    const on = hangsOn(of);
    if (!on) return of && 'studyKey' in of ? studyMarkUnit(state.units, of.studyKey) : null;
    return (await this.store.keptById(this.orgId, this.streamId, on.kind, [on.id]))[0]?.unitId || null;
  }

  /**
   * Files something in memory names: a recording, a note or a review of a
   * passage in memory, a material. A version's files are its passage's
   * recordings', so they come with the passage; counting every version's
   * would bring back every verdict of a language like Koro, whose versions
   * name 60,000.
   */
  private named(state: LanguageState): Set<string> {
    return new Set(referencedBlobs(state).keys());
  }
}

/** `{kind, id}` pairs as kind -> distinct ids. */
function groupBy(items: readonly { kind: string; id: string }[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const { kind, id } of items) {
    const ids = out.get(kind);
    if (ids) ids.add(id); else out.set(kind, new Set([id]));
  }
  return new Map([...out].map(([k, ids]) => [k, [...ids]]));
}

/**
 * A snapshot's maps cut by passage, read as text one entry at a time
 * (`stateSplitter`), turned into rows. An entry that hangs on a take,
 * review, departure or request finds its passage from those already read;
 * one read before what it hangs on waits for the end; one whose passage is
 * nowhere stays with the state. Only ids are held, never the entries.
 */
export class SnapshotRows {
  private readonly unitOf = new Map<string, string>();
  private waiting: { part: PassagePart; key: string; json: string }[] = [];

  /** The rows for one entry, or none yet. */
  entry(map: string, key: string, json: string): KeptRecord[] {
    if (map === 'blobs') return [fileRow(key, JSON.parse(json) as Verdict, json)];
    const part = PASSAGE_PARTS.find((p) => p.map === map)!;
    const value = JSON.parse(json) as unknown;
    const unitId = this.place(part, key, value);
    if (unitId === undefined) {
      this.waiting.push({ part, key, json });
      return [];
    }
    return this.rows(part, key, unitId, value, json);
  }

  /** Rows for what waited, now every entry has been read; what still has no passage goes back to the state. */
  end(lite: LanguageState): KeptRecord[] {
    const rows: KeptRecord[] = [];
    // An entry may hang on one that waited too: go round until nothing more is placed.
    for (let placedAny = true; placedAny && this.waiting.length > 0;) {
      placedAny = false;
      const still: typeof this.waiting = [];
      for (const w of this.waiting) {
        const value = JSON.parse(w.json) as unknown;
        const unitId = this.place(w.part, w.key, value, lite.units);
        if (unitId === undefined) still.push(w);
        else { rows.push(...this.rows(w.part, w.key, unitId, value, w.json)); placedAny = true; }
      }
      this.waiting = still;
    }
    for (const w of this.waiting) {
      const value = JSON.parse(w.json) as unknown;
      if (w.part.depth === 1) putEntry(lite, w.part, w.key, value);
      else for (const [inner, v] of Object.entries(value as Record<string, unknown>)) putEntry(lite, w.part, `${w.key}\u001f${inner}`, v);
    }
    this.waiting = [];
    this.unitOf.clear();
    return rows;
  }

  private place(part: PassagePart, key: string, value: unknown, units?: LanguageState['units']): string | undefined {
    const of = part.passage(key, value as never);
    if (!of) return undefined;
    if ('unitId' in of) return of.unitId || undefined;
    if ('studyKey' in of) return units ? studyMarkUnit(units, of.studyKey) ?? undefined : undefined;
    const on = hangsOn(of)!;
    return this.unitOf.get(`${on.kind}\u0000${on.id}`);
  }

  private rows(part: PassagePart, key: string, unitId: string, value: unknown, json: string): KeptRecord[] {
    // Remember what others hang on: a take's passage, a review's, a departure's, a request's.
    if (part.kind === 'take' || part.kind === 'review' || part.kind === 'departure' || part.kind === 'request' || part.kind === 'note') {
      this.unitOf.set(`${part.kind}\u0000${key}`, unitId);
    }
    if (part.depth === 1) return entryRows(part, key, unitId, value, json);
    return Object.entries(value as Record<string, unknown>).flatMap(([inner, v]) => entryRows(part, `${key}\u001f${inner}`, unitId, v));
  }
}
