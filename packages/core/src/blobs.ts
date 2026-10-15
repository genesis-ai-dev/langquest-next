import type { EventPayloads, EventType } from './events';
import { unitAncestry } from './materials';
import { unitsAskedOf } from './passageLines';
import { stateRevision } from './reducer';
import type { LanguageState } from './state';

/**
 * Blob work lists, derived on every pass (PLAN.md section 14 rule 1).
 * There is no queue: a card referenced by the fold that the server has not
 * confirmed and that exists on this device IS the upload list.
 */

export interface BlobRef {
  hash: string;
  format: 'wav' | 'm4a';
  /** The unit this blob belongs to; download scope is a set of units. */
  unitId: string;
}

/** Where each event that can name a voice note keeps its hash. */
const VOICE_NOTE_FIELD: Partial<Record<EventType, string>> = {
  'v1.ReviewRecorded': 'commentBlobHash',
  'v1.RequestMade': 'noteBlobHash',
  'v1.DepartureRecorded': 'reasonBlobHash',
  'v1.NoteAdded': 'blobHash',
  'v1.ResponseRecorded': 'blobHash',
  'v1.KeyTermAdjusted': 'blobHash',
  'v1.MaterialFieldSet': 'blobHash'
};

/**
 * The voice note an event names: audio whose event has no format field
 * (decisions.md 30), so it is m4a unless `v1.AudioFormatSet` says
 * otherwise (decisions.md 77). Every field `referencedBlobs` reads as a
 * voice note is here, so the app can say a note's format with the event
 * that names it.
 */
export function voiceNoteOf(event: { type: EventType; payload: unknown }): string | undefined {
  const field = VOICE_NOTE_FIELD[event.type];
  const hash = field ? (event.payload as Record<string, unknown>)[field] : undefined;
  return typeof hash === 'string' && hash !== '' ? hash : undefined;
}

/**
 * The `v1.AudioFormatSet` events a batch needs: one for each voice note it
 * names whose file here is not m4a and whose format the log does not
 * already say. `formatHere` is the local store's answer for a hash.
 */
export function audioFormatsFor(
  state: LanguageState | null,
  items: readonly { type: EventType; payload: unknown }[],
  formatHere: (hash: string) => string | undefined
): { type: 'v1.AudioFormatSet'; payload: EventPayloads['v1.AudioFormatSet'] }[] {
  const out = new Map<string, 'wav'>();
  for (const item of items) {
    const hash = voiceNoteOf(item);
    if (hash && formatHere(hash) === 'wav' && state?.audioFormats[hash]?.value !== 'wav') out.set(hash, 'wav');
  }
  return [...out].map(([hash, format]) => ({ type: 'v1.AudioFormatSet', payload: { hash, format } }));
}

type Verdict = LanguageState['blobs'][string];

/**
 * What the language's audio is, read once per state and revision: every
 * file it references, the order the log names them in, where each
 * passage's audio lives, and the server's verdict on each. The upload and
 * download workers, the space reclaimer and the offline screens all ask
 * after every change and every file that arrives; each used to walk the
 * whole language for itself: 0.1 to 0.25 s of a Mac's time per change for
 * Koro Miyan's 61,000 files, and as much again for every audio file that
 * came down. Keyed like the passage indexes (`recordIndexes`): the fold
 * bumps a state's revision with every event it applies, so a hit is never
 * stale.
 *
 * A phone that keeps a language on disk (decisions.md 109) makes its own
 * plan (`filePlan`) from the files memory names and those its table lists
 * for the passages or files a question is about, so planning never needs
 * the records themselves.
 */
export interface FilePlan {
  refs: ReadonlyMap<string, BlobRef>;
  /** Each referenced file's place in `refs`, so a list made from a few files keeps the log's order. */
  order: ReadonlyMap<string, number>;
  idx: AudioIndex;
  /** The server's latest verdict on a file. */
  verdict(hash: string): Verdict | undefined;
  units: LanguageState['units'];
  /** Per offline scope asked about with this plan: the files its passages need, and those the server has, in order. */
  scoped: Map<string, { needed: ReadonlySet<string>; stored: readonly BlobRef[] }>;
}

const plans = new WeakMap<LanguageState, { revision: number; plan: FilePlan }>();

/** The plan of a language held whole in memory. */
export function filePlanOf(state: LanguageState): FilePlan {
  return planOf(state);
}

function planOf(state: LanguageState): FilePlan {
  const revision = stateRevision(state);
  const hit = plans.get(state);
  if (hit && hit.revision === revision) return hit.plan;
  const plan = filePlan(state, collectRefs(state), (hash) => state.blobs[hash]);
  plans.set(state, { revision, plan });
  return plan;
}

/**
 * A plan from files listed some other way: those a language kept on disk
 * names for the passages or files in question, beside what memory names.
 * `state` gives the materials and key terms passages inherit audio from,
 * and the units they sit in.
 */
export function filePlan(
  state: Pick<LanguageState, 'materials' | 'keyTerms' | 'units'>,
  refs: ReadonlyMap<string, BlobRef>,
  verdict: (hash: string) => Verdict | undefined
): FilePlan {
  const order = new Map<string, number>();
  let n = 0;
  for (const hash of refs.keys()) order.set(hash, n++);
  return { refs, order, idx: audioIndex(state, refs), verdict, units: state.units, scoped: new Map() };
}

/** Every blob the language references: recording cards and reference audio. Read-only: it is shared until the next change. */
export function referencedBlobs(state: LanguageState): ReadonlyMap<string, BlobRef> {
  return planOf(state).refs;
}

/** What a scope needs, worked out once per plan: the workers and the reclaimer ask with the same scope after every file. */
function forScope(plan: FilePlan, scope: ReadonlySet<string>): { needed: ReadonlySet<string>; stored: readonly BlobRef[] } {
  const key = [...scope].sort().join('\n');
  let hit = plan.scoped.get(key);
  if (!hit) {
    const needed = scopedHashes(plan, scope);
    hit = { needed, stored: inOrder(plan, needed, (ref) => plan.verdict(ref.hash)?.stored === true) };
    // A person has one scope at a time; a few cover the screens that ask about others.
    if (plan.scoped.size >= 4) plan.scoped.delete(plan.scoped.keys().next().value!);
    plan.scoped.set(key, hit);
  }
  return hit;
}

/** Refs for some files, in the order the language names them. */
function inOrder(plan: FilePlan, hashes: Iterable<string>, keep: (ref: BlobRef) => boolean): BlobRef[] {
  const out: BlobRef[] = [];
  for (const hash of hashes) {
    const ref = plan.refs.get(hash);
    if (ref && keep(ref)) out.push(ref);
  }
  return out.sort((a, b) => plan.order.get(a.hash)! - plan.order.get(b.hash)!);
}

/** A voice note's format, as its recording device said (decisions.md 77): m4a unless the log says otherwise. */
export function voiceFormat(state: Pick<LanguageState, 'audioFormats'>, hash: string): BlobRef['format'] {
  return state.audioFormats[hash]?.value ?? 'm4a';
}

/** The record's own audio (decision 30) one entry names, with its format when the entry says it; a voice note's comes from the log. */
export function recordAudio(map: string, value: unknown): { hash: string; format?: BlobRef['format'] }[] {
  const out: { hash: string; format?: BlobRef['format'] }[] = [];
  const add = (hash: string | undefined, format?: BlobRef['format']) => { if (hash) out.push(format ? { hash, format } : { hash }); };
  switch (map) {
    case 'recordings': for (const c of (value as LanguageState['recordings'][string]).cards) add(c.hash, c.format ?? 'wav'); break;
    case 'responses': add((value as LanguageState['responses'][string]).blobHash); break;
    case 'notes': add((value as LanguageState['notes'][string]).blobHash); break;
    case 'departures': add((value as LanguageState['departures'][string]).reasonBlobHash); break;
    case 'requests': add((value as LanguageState['requests'][string]).noteBlobHash); break;
    case 'kindReviews': {
      const r = value as LanguageState['kindReviews'][string];
      add(r.commentBlobHash);
      for (const c of r.artifacts ?? []) add(c.hash, c.format ?? 'wav');
      break;
    }
  }
  return out;
}

function collectRefs(state: LanguageState): Map<string, BlobRef> {
  const out = new Map<string, BlobRef>();
  const voice = (hash: string): BlobRef['format'] => voiceFormat(state, hash);
  for (const r of Object.values(state.recordings)) {
    for (const c of r.cards) {
      if (!out.has(c.hash)) out.set(c.hash, { hash: c.hash, format: c.format ?? 'wav', unitId: r.unitId });
    }
  }
  for (const m of Object.values(state.materials)) {
    const unitId = m.scope.unitId ?? '';
    for (const f of Object.values(m.fields)) if (f.value.blobHash && !out.has(f.value.blobHash)) out.set(f.value.blobHash, { hash: f.value.blobHash, format: voice(f.value.blobHash), unitId });
  }
  for (const t of Object.values(state.keyTerms)) {
    for (const a of Object.values(t.adjustments)) {
      const unitId = a.duringTakeId ? state.takes[a.duringTakeId]?.unitId ?? '' : '';
      if (a.blobHash && !out.has(a.blobHash)) out.set(a.blobHash, { hash: a.blobHash, format: voice(a.blobHash), unitId });
    }
  }
  for (const [takeId, r] of Object.entries(state.responses)) {
    const unitId = state.takes[takeId]?.unitId ?? '';
    if (r.blobHash && !out.has(r.blobHash)) out.set(r.blobHash, { hash: r.blobHash, format: voice(r.blobHash), unitId });
  }
  // The record's own audio (decision 30): voice notes, spoken feedback and
  // reasons, directions, and what a producing kind made. Named only by the
  // event that uses it; voice notes are m4a unless the log says otherwise
  // (77), artifacts carry their format.
  const add = (hash: string | undefined, unitId: string, format?: BlobRef['format']) => {
    if (hash && !out.has(hash)) out.set(hash, { hash, format: format ?? voice(hash), unitId });
  };
  for (const n of Object.values(state.notes)) add(n.blobHash, n.unitId);
  for (const d of Object.values(state.departures)) add(d.reasonBlobHash, d.unitId);
  for (const r of Object.values(state.requests)) add(r.noteBlobHash, r.unitId);
  for (const r of Object.values(state.kindReviews)) {
    const unitId = state.takes[r.takeId]?.unitId ?? '';
    add(r.commentBlobHash, unitId);
    for (const c of r.artifacts ?? []) add(c.hash, unitId, c.format ?? 'wav');
  }
  return out;
}

/** The server's latest verdict says the bytes are there. */
export function isStored(state: LanguageState, hash: string): boolean {
  return state.blobs[hash]?.stored === true;
}

/**
 * Referenced, not confirmed intact, and present locally: upload these.
 * `localSizes`, when given, turns the confirmation's size into an integrity
 * check: a confirmed blob whose stored size differs from the file we have
 * did not land intact and is uploaded again (idempotent overwrite).
 */
export function deriveUploadWork(
  state: LanguageState,
  present: ReadonlySet<string>,
  localSizes?: ReadonlyMap<string, number>
): BlobRef[] {
  return uploadWorkOf(planOf(state), present, localSizes);
}

export function uploadWorkOf(plan: FilePlan, present: ReadonlySet<string>, localSizes?: ReadonlyMap<string, number>): BlobRef[] {
  // Only files on this phone can go up: look at those, not at every file the language names.
  return inOrder(plan, present, (ref) => {
    const verdict = plan.verdict(ref.hash);
    if (!verdict?.stored) return true;
    const local = localSizes?.get(ref.hash);
    return local !== undefined && local !== verdict.size;
  });
}

/**
 * Confirmed on the server, missing locally, and inside the offline scope:
 * download these (rule 10). `scope` is the set of unit ids the user keeps
 * offline; null means everything, which only a coordinator on wifi wants.
 */
export function deriveDownloadWork(
  state: LanguageState,
  present: ReadonlySet<string>,
  scope: ReadonlySet<string> | null = null
): BlobRef[] {
  return downloadWorkOf(planOf(state), present, scope);
}

export function downloadWorkOf(plan: FilePlan, present: ReadonlySet<string>, scope: ReadonlySet<string> | null = null): BlobRef[] {
  if (scope && scope.size === 0) return [];
  // A scope is a person's passages: look at their files, not at every file the language names.
  if (scope) return forScope(plan, scope).stored.filter((ref) => !present.has(ref.hash));
  return [...plan.refs.values()].filter((ref) => plan.verdict(ref.hash)?.stored === true && !present.has(ref.hash));
}

/**
 * Where the audio a passage needs lives, read once per call: each unit's
 * own files, and the material and key-term audio a passage inherits, by the
 * unit it is scoped to or for the whole language (rule 10). Looking these
 * up per passage made offline planning walk the whole language for every
 * passage (performance-audit.md item 6).
 */
interface AudioIndex {
  own: Map<string, string[]>;
  byScope: Map<string, string[]>;
  everywhere: string[];
}

function audioIndex(state: Pick<LanguageState, 'materials' | 'keyTerms'>, refs: ReadonlyMap<string, BlobRef>): AudioIndex {
  const own = new Map<string, string[]>();
  const byScope = new Map<string, string[]>();
  const everywhere: string[] = [];
  const add = (map: Map<string, string[]>, key: string, hash: string) => {
    const list = map.get(key);
    if (list) list.push(hash); else map.set(key, [hash]);
  };
  for (const ref of refs.values()) add(own, ref.unitId, ref.hash);
  for (const material of Object.values(state.materials)) {
    if (material.scope.stepId) continue;
    for (const field of Object.values(material.fields)) {
      const hash = field.value.blobHash;
      if (!hash) continue;
      if (material.scope.unitId) add(byScope, material.scope.unitId, hash); else everywhere.push(hash);
    }
  }
  for (const term of Object.values(state.keyTerms)) {
    for (const adjustment of Object.values(term.adjustments)) {
      if (!adjustment.blobHash) continue;
      if (term.unitScope.length === 0) everywhere.push(adjustment.blobHash);
      else for (const unitId of term.unitScope) add(byScope, unitId, adjustment.blobHash);
    }
  }
  return { own, byScope, everywhere };
}

/** One passage's audio, leaving out what the whole language shares (`everywhere`). */
function unitHashes(plan: FilePlan, unitId: string, into = new Set<string>()): Set<string> {
  for (const hash of plan.idx.own.get(unitId) ?? []) into.add(hash);
  for (const ancestor of unitAncestry(plan, unitId)) for (const hash of plan.idx.byScope.get(ancestor) ?? []) into.add(hash);
  return into;
}

/**
 * Every blob a set of units needs offline: their own audio plus the
 * reference audio, materials and key terms they inherit (rule 10).
 */
function scopedHashes(plan: FilePlan, scope: ReadonlySet<string>): Set<string> {
  const needed = new Set<string>();
  if (scope.size === 0) return needed;
  for (const unitId of scope) unitHashes(plan, unitId, needed);
  for (const hash of plan.idx.everywhere) needed.add(hash);
  return needed;
}

/**
 * The units a person needs offline by default: everything they are asked to
 * record or review, plus everything they have recorded or composed in.
 * Explicit "keep offline" choices are unioned in by the app.
 */
const scopes = new WeakMap<LanguageState, { revision: number; byActor: Map<string, ReadonlySet<string>> }>();

export function defaultOfflineScope(state: LanguageState, actorId: string): Set<string> {
  // Asked after every change by the workers and the reclaimer; it reads every recording, so once per revision.
  const revision = stateRevision(state);
  let hit = scopes.get(state);
  if (!hit || hit.revision !== revision) scopes.set(state, (hit = { revision, byActor: new Map() }));
  let scope = hit.byActor.get(actorId);
  if (!scope) {
    const units = unitsAskedOf(state, actorId);
    for (const u of workedBy(state, actorId)) units.add(u);
    hit.byActor.set(actorId, (scope = units));
  }
  return new Set(scope);
}

/** Passages this person recorded or composed in, from what the state holds. */
export function workedBy(state: LanguageState, actorId: string): Set<string> {
  const units = new Set<string>();
  for (const r of Object.values(state.recordings)) if (r.actorId === actorId) units.add(r.unitId);
  for (const t of Object.values(state.takes)) if (t.actorId === actorId && t.unitId) units.add(t.unitId);
  return units;
}

/** Referenced but neither confirmed nor present anywhere we can see: visibly missing. */
export function deriveMissingBlobs(state: LanguageState, present: ReadonlySet<string>): BlobRef[] {
  return [...referencedBlobs(state).values()].filter((r) => !isStored(state, r.hash) && !present.has(r.hash));
}

/** What losing files from this device means for one language (decisions.md 92). */
export interface LostFilesView {
  /** The server has these, so nothing is lost there; kept passages download them again. */
  safe: number;
  /** The server never confirmed these: they may exist nowhere else. */
  unsent: number;
  /** Passages that had an unsent file among the lost, in the order first lost, each once. */
  unitIds: string[];
}

/**
 * Sort lost hashes by what the language knows of them. A hash this language
 * does not name (another language's recording, a source's or a guide's
 * file) counts in neither total; the caller still counts it as lost.
 */
export function lostFilesView(state: LanguageState, hashes: Iterable<string>): LostFilesView {
  return lostFilesOf(planOf(state), hashes);
}

export function lostFilesOf(plan: FilePlan, hashes: Iterable<string>): LostFilesView {
  const out: LostFilesView = { safe: 0, unsent: 0, unitIds: [] };
  const units = new Set<string>();
  for (const hash of hashes) {
    const ref = plan.refs.get(hash);
    if (!ref) continue;
    if (plan.verdict(hash)?.stored) { out.safe++; continue; }
    out.unsent++;
    if (ref.unitId && !units.has(ref.unitId)) { units.add(ref.unitId); out.unitIds.push(ref.unitId); }
  }
  return out;
}

/**
 * Local files this device may delete to reclaim space: referenced by this
 * language, confirmed intact on the server (so they can come back), outside
 * the offline scope, and not upload work. Everything else is protected:
 * unsynced recordings, explicit offline selections, and files of other
 * languages (which this state cannot see, so it never names them).
 */
export function evictableBlobs(
  state: LanguageState,
  present: ReadonlySet<string>,
  scope: ReadonlySet<string> | null,
  localSizes?: ReadonlyMap<string, number>
): BlobRef[] {
  return evictableOf(planOf(state), present, scope, localSizes);
}

export function evictableOf(plan: FilePlan, present: ReadonlySet<string>, scope: ReadonlySet<string> | null, localSizes?: ReadonlyMap<string, number>): BlobRef[] {
  // Only a file on this phone can be deleted: look at those. Kept passages need theirs; a file
  // going up stays (a stored file goes up again only when its size here differs from the server's).
  const needed = scope ? (scope.size === 0 ? new Set<string>() : forScope(plan, scope).needed) : null;
  return inOrder(plan, present, (ref) => {
    const verdict = plan.verdict(ref.hash);
    if (!verdict?.stored) return false;
    if (!needed || needed.has(ref.hash)) return false;
    const local = localSizes?.get(ref.hash);
    return local === undefined || local === verdict.size;
  });
}

/** Why a passage is kept on this phone; null when it is not. */
type OfflineReason = 'asked' | 'worked' | 'chosen';

/**
 * What a passage has on this phone for use without a connection. Text,
 * status and history are always here once its language is open (the whole
 * language syncs); audio is here only for passages in the offline scope.
 */
export interface UnitOffline {
  reason: OfflineReason | null;
  /** Audio files this passage plays: its recordings and what it inherits. */
  audio: number;
  /** Of those, how many are on this phone now. */
  here: number;
  /** Not here and on the server: what a download would still fetch. */
  toFetch: number;
  /** Bytes of `toFetch`, from the server's confirmations. */
  bytesToFetch: number;
  /** Not here and not on the server yet (someone else has not sent it): no download can help. */
  notSent: number;
  /** Kept, and every file that can be fetched is here. */
  ready: boolean;
}

/** Counts for one passage's audio on this phone, kept or not. */
export function unitOffline(
  state: LanguageState,
  unitId: string,
  present: ReadonlySet<string>,
  actorId: string,
  chosen: ReadonlySet<string>
): UnitOffline {
  return offlineByUnit(state, [unitId], present, actorId, chosen).get(unitId)!;
}

/** `unitOffline` for many passages (a map's rows), reading the language's audio once. */
export function offlineByUnit(
  state: LanguageState,
  unitIds: Iterable<string>,
  present: ReadonlySet<string>,
  actorId: string,
  chosen: ReadonlySet<string>
): Map<string, UnitOffline> {
  return offlineCountsOf(planOf(state), unitIds, present, chosen, { mine: defaultOfflineScope(state, actorId), asked: unitsAskedOf(state, actorId) });
}

/** Why a person keeps passages: those asked of them, and those they keep by default (asked of them or worked in). */
export interface OfflineReasons {
  mine: ReadonlySet<string>;
  asked: ReadonlySet<string>;
}

export function offlineCountsOf(
  plan: FilePlan,
  unitIds: Iterable<string>,
  present: ReadonlySet<string>,
  chosen: ReadonlySet<string>,
  why: OfflineReasons
): Map<string, UnitOffline> {
  // What the whole language shares is the same for every passage: count it once.
  const shared = new Set(plan.idx.everywhere);
  const sharedCount = tally(plan, shared, present);
  const out = new Map<string, UnitOffline>();
  for (const unitId of unitIds) {
    if (out.has(unitId)) continue;
    const reason: OfflineReason | null = why.asked.has(unitId) ? 'asked' : why.mine.has(unitId) ? 'worked' : chosen.has(unitId) ? 'chosen' : null;
    const own = unitHashes(plan, unitId);
    for (const hash of shared) own.delete(hash);
    const c = tally(plan, own, present);
    const audio = own.size + shared.size;
    const toFetch = c.toFetch + sharedCount.toFetch;
    out.set(unitId, {
      reason, audio, here: c.here + sharedCount.here, toFetch, bytesToFetch: c.bytesToFetch + sharedCount.bytesToFetch,
      notSent: c.notSent + sharedCount.notSent, ready: reason !== null && toFetch === 0
    });
  }
  return out;
}

function tally(plan: FilePlan, hashes: Iterable<string>, present: ReadonlySet<string>) {
  let here = 0;
  let toFetch = 0;
  let bytesToFetch = 0;
  let notSent = 0;
  for (const hash of hashes) {
    const verdict = plan.verdict(hash);
    if (present.has(hash)) here++;
    else if (verdict?.stored) { toFetch++; bytesToFetch += verdict.size; }
    else notSent++;
  }
  return { here, toFetch, bytesToFetch, notSent };
}

/** The whole offline scope at a glance: how many kept passages are ready, and what is left to fetch. */
export interface OfflineSummary {
  kept: number;
  ready: number;
  /** Kept passages that chose to be kept, as opposed to asked of the person or worked in. */
  chosen: number;
  filesToFetch: number;
  bytesToFetch: number;
  /** Files no download can bring yet: not sent by whoever recorded them. */
  notSent: number;
}

export function offlineSummary(
  state: LanguageState,
  present: ReadonlySet<string>,
  actorId: string,
  chosen: ReadonlySet<string>
): OfflineSummary {
  return offlineSummaryOf(planOf(state), present, chosen, { mine: defaultOfflineScope(state, actorId), asked: unitsAskedOf(state, actorId) });
}

export function offlineSummaryOf(plan: FilePlan, present: ReadonlySet<string>, chosen: ReadonlySet<string>, why: OfflineReasons): OfflineSummary {
  const scope = new Set(why.mine);
  for (const u of chosen) scope.add(u);
  const out: OfflineSummary = { kept: 0, ready: 0, chosen: 0, filesToFetch: 0, bytesToFetch: 0, notSent: 0 };
  // Per passage, so a file two passages share is counted under each; the totals below are by file.
  for (const u of offlineCountsOf(plan, scope, present, chosen, why).values()) {
    out.kept++;
    if (u.ready) out.ready++;
    if (u.reason === 'chosen') out.chosen++;
  }
  for (const hash of scopedHashes(plan, scope)) {
    if (present.has(hash)) continue;
    const verdict = plan.verdict(hash);
    if (verdict?.stored) { out.filesToFetch++; out.bytesToFetch += verdict.size; }
    else out.notSent++;
  }
  return out;
}
