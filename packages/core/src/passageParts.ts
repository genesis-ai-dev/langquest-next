import type { AnyEvent } from './events';
import { keptRecording } from './reducer';
import type { LanguageState } from './state';
import { earlier } from './ties';

/**
 * A language cut by passage (decisions.md 143). Most of what a language
 * holds belongs to one passage: its recordings, versions, reviews, notes,
 * requests and the rest. A phone that keeps a big language on disk holds a
 * passage's part in memory only while a screen needs it, so each entry of
 * these maps must say which passage it is about, and two copies of one
 * entry, folded from different events, must combine into what folding
 * every event would give.
 *
 * Both rules sit here beside each other, next to the reducer whose cases
 * they mirror: `merge` is the reducer's own choice between two entries of
 * one key (earliest wins, latest wins, add-wins flags), and `passage` reads
 * the passage from the entry or names the entry it hangs on.
 */

/** The maps of `LanguageState` whose entries each belong to one passage. */
export type PassageMap =
  | 'recordings' | 'takes' | 'submissions' | 'responses' | 'kindReviews' | 'departures' | 'undoneDepartures'
  | 'requests' | 'withdrawnRequests' | 'notes' | 'studyMarks' | 'cardVerses' | 'passageLinks' | 'referencesUsed'
  | 'keyTermLinks' | 'releases' | 'withdrawnReviews' | 'withdrawnNotes' | 'made';

/**
 * Where an entry's passage comes from: the entry itself, or the take,
 * review, departure or request it hangs on, which may be in memory or on
 * disk, or not here yet (then the entry waits in memory until it is).
 */
export type PassageOf =
  | { unitId: string }
  | { take: string }
  | { review: string }
  | { departure: string }
  | { request: string }
  /** A note taken back (decision 111) hangs on its note. */
  | { note: string }
  /** A study mark's key, `${unitId}:${guideId}:${stepId}`: its passage is the longest known unit it starts with. */
  | { studyKey: string };

type Entry<M extends PassageMap> = NonNullable<LanguageState[M]>[string];

export interface PassagePart<M extends PassageMap = PassageMap> {
  map: M;
  /** The kind of a row that keeps one entry on disk. */
  kind: string;
  /**
   * 1: a row per entry of the map. 2: a row per entry of each entry's
   * inner map (a key-term link per take and term), so rows can be found by
   * the inner key (`ref`).
   */
  depth: 1 | 2;
  passage(key: string, value: Entry<M>, inner?: string): PassageOf | null;
  /** The two copies' combination, as folding both copies' events gives it. At depth 2, of two inner entries. */
  merge(a: unknown, b: unknown): unknown;
  /** A second key rows are found by: who made a recording or a take, the term of a key-term link. */
  ref?(key: string, value: unknown, inner?: string): string;
}

type Reg = { hlc: string; eventId: string };
/** A register: the later clock wins, then the higher event id (reducer `lww`). */
const laterRegister = <T extends Reg>(a: T, b: T): T => (a.hlc > b.hlc || (a.hlc === b.hlc && a.eventId > b.eventId) ? a : b);
/** Grow-only by id: the earliest clock, then the lower event id (reducer `firstWins`). */
const firstOf = <T extends Reg>(a: T, b: T): T => (a.hlc < b.hlc || (a.hlc === b.hlc && a.eventId <= b.eventId) ? a : b);
/** An add-wins undo that remembers who undid first (reducer `earliestUndo`). */
const firstUndo = <T extends { hlc: string; by: string }>(a: T, b: T): T => (a.hlc < b.hlc || (a.hlc === b.hlc && a.by <= b.by) ? a : b);

/** Each inner key's entry combined with `merge`. */
function byKey<V>(merge: (a: V, b: V) => V) {
  return (a: Record<string, V>, b: Record<string, V>): Record<string, V> => {
    const out: Record<string, V> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = out[k] ? merge(out[k]!, v) : v;
    return out;
  };
}

type Take = LanguageState['takes'][string];
type Submission = LanguageState['submissions'][string];
type Response = LanguageState['responses'][string];
type TermLink = LanguageState['keyTermLinks'][string][string];
type Used = LanguageState['referencesUsed'][string][string];

/** The first archive of a take names who deleted it and when (reducer `v1.TakeArchived`, decision 124): the earliest clock, then the lower actor. */
function firstArchive(a: Take['archivedAt'], b: Take['archivedAt']): Take['archivedAt'] {
  if (!a) return b;
  if (!b) return a;
  return a.hlc < b.hlc || (a.hlc === b.hlc && a.by <= b.by) ? a : b;
}

/** v1.TakeComposed: the earliest compose stands; an archive sticks whichever arrived first, with the first archive's who and when; a placeholder from an early archive is filled in. */
export function keptTake(a: Take, b: Take): Take {
  const archivedAt = firstArchive(a.archivedAt, b.archivedAt);
  const flags = { archived: a.archived || b.archived, ...(archivedAt ? { archivedAt } : {}) };
  if (a.unitId === '') return { ...b, ...flags };
  if (b.unitId === '') return { ...a, ...flags };
  const content = (t: Take) => ({ unitId: t.unitId, cardHashes: t.cardHashes, parentTakeId: t.parentTakeId });
  const first = earlier({ hlc: a.hlc, actorId: a.actorId } as AnyEvent, content(a), b, content(b)) ? a : b;
  return { ...first, ...flags };
}

const keptSubmission = (a: Submission, b: Submission): Submission =>
  (earlier({ hlc: a.hlc, actorId: a.actorId } as AnyEvent, { questionSetIds: a.questionSetIds }, b, { questionSetIds: b.questionSetIds }) ? a : b);

const keptResponse = (a: Response, b: Response): Response => {
  const content = (r: Response) => ({ respondsToTakeId: r.respondsToTakeId, note: r.note, blobHash: r.blobHash });
  return earlier({ hlc: a.hlc, actorId: a.actorId } as AnyEvent, content(a), b, content(b)) ? a : b;
};

const keptTermLink = (a: TermLink, b: TermLink): TermLink =>
  (earlier({ hlc: a.hlc, actorId: a.actorId } as AnyEvent, { note: a.note, adjustmentId: a.adjustmentId }, b, { note: b.note, adjustmentId: b.adjustmentId }) ? a : b);

/** v1.ReferencesUsed: the earliest event describes the item; `opened` once anyone says so. */
const keptUse = (a: Used, b: Used): Used => {
  const first = a.hlc < b.hlc || (a.hlc === b.hlc && a.eventId < b.eventId) ? a : b;
  return { ...first, opened: a.opened || b.opened };
};

const usedSubject = (key: string): PassageOf | null =>
  key.startsWith('take:') ? { take: key.slice(5) } : key.startsWith('review:') ? { review: key.slice(7) } : null;

/** Every map cut by passage, with how its entries find their passage and combine. */
export const PASSAGE_PARTS: readonly PassagePart[] = [
  { map: 'recordings', kind: 'recording', depth: 1, passage: (_k, r) => ({ unitId: (r as Entry<'recordings'>).unitId }),
    merge: (a, b) => keptRecording(a as Entry<'recordings'>, b as Entry<'recordings'>), ref: (_k, r) => (r as Entry<'recordings'>).actorId },
  // A placeholder from an archive that came first has no passage yet; its compose may be on disk.
  { map: 'takes', kind: 'take', depth: 1, passage: (k, t) => ((t as Take).unitId ? { unitId: (t as Take).unitId } : { take: k }),
    merge: (a, b) => keptTake(a as Take, b as Take), ref: (_k, t) => (t as Take).actorId },
  { map: 'submissions', kind: 'submission', depth: 1, passage: (k) => ({ take: k }), merge: (a, b) => keptSubmission(a as Submission, b as Submission) },
  { map: 'responses', kind: 'response', depth: 1, passage: (k) => ({ take: k }), merge: (a, b) => keptResponse(a as Response, b as Response) },
  { map: 'kindReviews', kind: 'review', depth: 1, passage: (_k, r) => ({ take: (r as Entry<'kindReviews'>).takeId }), merge: (a, b) => firstOf(a as Reg, b as Reg) },
  { map: 'departures', kind: 'departure', depth: 1, passage: (_k, d) => ({ unitId: (d as Entry<'departures'>).unitId }), merge: (a, b) => firstOf(a as Reg, b as Reg) },
  { map: 'undoneDepartures', kind: 'undoneDeparture', depth: 1, passage: (k) => ({ departure: k }),
    merge: (a, b) => firstUndo(a as Entry<'undoneDepartures'>, b as Entry<'undoneDepartures'>) },
  { map: 'requests', kind: 'request', depth: 1, passage: (_k, r) => ({ unitId: (r as Entry<'requests'>).unitId }), merge: (a, b) => firstOf(a as Reg, b as Reg) },
  { map: 'withdrawnRequests', kind: 'withdrawnRequest', depth: 1, passage: (k) => ({ request: k }),
    merge: (a, b) => firstUndo(a as Entry<'withdrawnRequests'>, b as Entry<'withdrawnRequests'>) },
  // A review or note taken back (decision 111) hangs on what it takes back; the first undo stands, as the reducer's `earliestUndo` has it.
  { map: 'withdrawnReviews', kind: 'withdrawnReview', depth: 1, passage: (k) => ({ review: k }),
    merge: (a, b) => firstUndo(a as Entry<'withdrawnReviews'>, b as Entry<'withdrawnReviews'>) },
  { map: 'notes', kind: 'note', depth: 1, passage: (_k, n) => ({ unitId: (n as Entry<'notes'>).unitId }), merge: (a, b) => firstOf(a as Reg, b as Reg) },
  { map: 'withdrawnNotes', kind: 'withdrawnNote', depth: 1, passage: (k) => ({ note: k }),
    merge: (a, b) => firstUndo(a as Entry<'withdrawnNotes'>, b as Entry<'withdrawnNotes'>) },
  { map: 'studyMarks', kind: 'studyMark', depth: 1, passage: (k) => ({ studyKey: k }), merge: (a, b) => laterRegister(a as Reg, b as Reg) },
  { map: 'cardVerses', kind: 'cardVerses', depth: 1, passage: (k) => ({ unitId: k }), merge: (a, b) => byKey(laterRegister)(a as Record<string, Reg>, b as Record<string, Reg>) },
  { map: 'passageLinks', kind: 'passageLinks', depth: 1, passage: (k) => ({ unitId: k }), merge: (a, b) => byKey(laterRegister)(a as Record<string, Reg>, b as Record<string, Reg>) },
  { map: 'referencesUsed', kind: 'used', depth: 1, passage: (k) => usedSubject(k), merge: (a, b) => byKey(keptUse)(a as Record<string, Used>, b as Record<string, Used>) },
  { map: 'keyTermLinks', kind: 'termLink', depth: 2, passage: (k) => ({ take: k }), merge: (a, b) => keptTermLink(a as TermLink, b as TermLink), ref: (_k, _v, term) => term ?? '' },
  { map: 'releases', kind: 'release', depth: 1, passage: (k) => ({ take: k }), merge: (a, b) => byKey(laterRegister)(a as Record<string, Reg>, b as Record<string, Reg>) },
  // What a step made from a version (decisions.md 146) names its passage; the first made under an id stands (reducer `firstWins`).
  // A written part's words (`writings`) are shared by the whole language: one id is the same words wherever they are written.
  { map: 'made', kind: 'made', depth: 1, passage: (_k, m) => ({ unitId: (m as Entry<'made'>).unitId }), merge: (a, b) => firstOf(a as Reg, b as Reg) }
];

export const PASSAGE_PART: Readonly<Record<PassageMap, PassagePart>> =
  Object.fromEntries(PASSAGE_PARTS.map((p) => [p.map, p])) as Record<PassageMap, PassagePart>;

/** The row kind's part. */
export const PART_OF_KIND: ReadonlyMap<string, PassagePart> = new Map(PASSAGE_PARTS.map((p) => [p.kind, p]));

/**
 * Core's answers about every passage of a language at once. Given the state
 * of a language kept on disk (decisions.md 143), which holds only the
 * passages a screen has open, each answers about those alone. An app calls
 * them on a language held whole, on a few passages read in (`withPassages`),
 * or not at all, and reads lines instead (`apps/mobile/test/wholeLanguage.test.ts`).
 */
export const READS_EVERY_PASSAGE = [
  'filePlanOf', 'referencedBlobs', 'deriveUploadWork', 'deriveDownloadWork', 'defaultOfflineScope', 'workedBy',
  'deriveMissingBlobs', 'lostFilesView', 'evictableBlobs', 'offlineByUnit', 'offlineSummary',
  'takesLinkingTerm', 'usualTarget', 'updatesFor', 'languageLines', 'languageProgress', 'highlightsFor',
  'unitsAskedOf', 'waitingOn', 'upNext', 'languageReport'
] as const;

/** The passage a study mark's key names: the longest prefix that is a unit, up to a colon. */
export function studyMarkUnit(units: LanguageState['units'], key: string): string | null {
  for (let cut = key.lastIndexOf(':'); cut > 0; cut = key.lastIndexOf(':', cut - 1)) {
    const unitId = key.slice(0, cut);
    if (units[unitId]) return unitId;
  }
  return null;
}

/**
 * Which passage an event is about, or what names it: a screen showing a
 * list of passages redraws that passage's line. `settings` for events
 * that change how every passage reads (the flow, its kinds and steps,
 * review teams); null for the rest of the language, which no passage's
 * line shows.
 */
export function eventPassage(e: AnyEvent): PassageOf | 'settings' | null {
  switch (e.type) {
    case 'v1.RecordingAdded':
    case 'v1.TakeComposed':
    case 'v1.DepartureRecorded':
    case 'v1.RequestMade':
    case 'v1.NoteAdded':
    case 'v1.StudyStepMarked':
    case 'v1.CardVerseSet':
    case 'v1.PassageReferenceLinked':
    case 'v1.ReferencesUsed':
    case 'v1.UnitAdded':
    case 'v1.UnitHidden':
    case 'v1.WritingAdded':
    case 'v1.Made':
      return { unitId: e.payload.unitId };
    case 'v1.TakeArchived':
    case 'v1.TakeSubmitted':
    case 'v1.ResponseRecorded':
    case 'v1.ReviewRecorded':
    case 'v1.KeyTermLinked':
    case 'v1.VersionReleased':
      return { take: e.payload.takeId };
    case 'v1.DepartureUndone':
      return { departure: e.payload.departureId };
    case 'v1.RequestWithdrawn':
      return { request: e.payload.requestId };
    case 'v1.ReviewWithdrawn':
      return { review: e.payload.reviewId };
    case 'v1.NoteWithdrawn':
      return { note: e.payload.noteId };
    case 'v1.FlowSelected':
    case 'v1.FlowStepSet':
    case 'v1.FlowStepRemoved':
    case 'v1.ReviewKindDefined':
    case 'v1.FlowStepLinksSet':
    case 'v1.ReviewTeamDefined':
    case 'v1.ReviewTeamMemberSet':
    case 'v1.ReviewTeamKindSet':
    // What a language makes, and its steps that make something or read what one made (decisions.md 146), change how every passage reads.
    case 'v1.MediaAllowedSet':
    case 'v1.StepMakesSet':
    case 'v1.CheckLooksAtSet':
      return 'settings';
    default:
      return null;
  }
}

/**
 * Find an entry's passage from memory: its own field, or the take, review,
 * departure or request it hangs on when that is in memory. Null when what
 * it hangs on is not in memory (look on disk) or nowhere yet.
 */
export function passageInMemory(state: LanguageState, of: PassageOf | null): string | null {
  if (!of) return null;
  if ('unitId' in of) return of.unitId || null;
  if ('take' in of) return state.takes[of.take]?.unitId || null;
  if ('review' in of) {
    const r = state.kindReviews[of.review];
    return r ? state.takes[r.takeId]?.unitId || null : null;
  }
  if ('departure' in of) return state.departures[of.departure]?.unitId || null;
  if ('request' in of) return state.requests[of.request]?.unitId || null;
  if ('note' in of) return state.notes[of.note]?.unitId || null;
  return studyMarkUnit(state.units, of.studyKey);
}

/** What `of` hangs on, as a row kind and id to look up on disk; null when its passage is in the entry or a key. */
export function hangsOn(of: PassageOf | null): { kind: string; id: string } | null {
  if (!of) return null;
  if ('take' in of) return { kind: 'take', id: of.take };
  if ('review' in of) return { kind: 'review', id: of.review };
  if ('departure' in of) return { kind: 'departure', id: of.departure };
  if ('request' in of) return { kind: 'request', id: of.request };
  if ('note' in of) return { kind: 'note', id: of.note };
  return null;
}

/** One entry of a map cut by passage, as a row: its key (at depth 2, `${key}\u001f${inner}`) and value. */
export interface PartEntry {
  part: PassagePart;
  key: string;
  inner?: string;
  value: unknown;
}

export const innerKey = (key: string, inner: string): string => `${key}\u001f${inner}`;
export function splitInnerKey(id: string): [string, string] {
  const cut = id.indexOf('\u001f');
  return [id.slice(0, cut), id.slice(cut + 1)];
}

/** Every entry this state holds of the maps cut by passage. */
export function* partEntries(state: LanguageState): Generator<PartEntry> {
  for (const part of PASSAGE_PARTS) {
    const map = (state[part.map] ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(map)) {
      if (part.depth === 1) yield { part, key, value };
      else for (const [inner, v] of Object.entries(value as Record<string, unknown>)) yield { part, key, inner, value: v };
    }
  }
}

/** The row id of an entry. */
export const rowId = (e: Pick<PartEntry, 'key' | 'inner'>): string => (e.inner === undefined ? e.key : innerKey(e.key, e.inner));

/** Put an entry into a state, combined with what it holds under the same key. */
export function putEntry(state: LanguageState, part: PassagePart, id: string, value: unknown): void {
  const map = ((state as unknown as Record<string, Record<string, unknown>>)[part.map] ??= {});
  if (part.depth === 1) {
    const here = map[id];
    map[id] = here === undefined ? value : part.merge(here, value);
    return;
  }
  const [key, inner] = splitInnerKey(id);
  const byInner = (map[key] ??= {}) as Record<string, unknown>;
  const here = byInner[inner];
  byInner[inner] = here === undefined ? value : part.merge(here, value);
}

/** Take an entry out of a state. */
export function dropEntry(state: LanguageState, part: PassagePart, id: string): void {
  const map = (state as unknown as Record<string, Record<string, unknown>>)[part.map];
  if (!map) return;
  if (part.depth === 1) { delete map[id]; return; }
  const [key, inner] = splitInnerKey(id);
  const byInner = map[key] as Record<string, unknown> | undefined;
  if (!byInner) return;
  delete byInner[inner];
  if (Object.keys(byInner).length === 0) delete map[key];
}

/** A copy of the state whose maps cut by passage are copied one level down, so entries can be added or taken out of the copy alone. */
export function withOwnParts(state: LanguageState): LanguageState {
  const out = { ...state } as unknown as Record<string, unknown>;
  for (const part of PASSAGE_PARTS) {
    const map = (state[part.map] ?? {}) as Record<string, unknown>;
    out[part.map] = part.depth === 1 ? { ...map } : Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { ...(v as object) }]));
  }
  return out as unknown as LanguageState;
}

/** The state with every map cut by passage empty: what the whole language shares. */
export function withoutParts(state: LanguageState): LanguageState {
  const out = { ...state } as unknown as Record<string, unknown>;
  for (const part of PASSAGE_PARTS) out[part.map] = {};
  return out as unknown as LanguageState;
}
