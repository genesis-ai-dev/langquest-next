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

/**
 * What the language's audio is, read once per state and revision: every
 * file it references, the order the log names them in, and where each
 * passage's audio lives. The upload and download workers, the space
 * reclaimer and the offline screens all ask after every change and every
 * file that arrives; each used to walk the whole language for itself: 0.1
 * to 0.25 s of a Mac's time per change for Koro Miyan's 61,000 files, and
 * as much again for every audio file that came down. Keyed like the
 * passage indexes (`recordIndexes`): the fold bumps a state's revision with
 * every event it applies, so a hit is never stale.
 */
interface BlobPlan {
  refs: ReadonlyMap<string, BlobRef>;
  /** Each referenced file's place in `refs`, so a list made from a few files keeps the log's order. */
  order: ReadonlyMap<string, number>;
  idx: AudioIndex;
  /** Per offline scope asked about at this revision: the files its passages need, and those the server has, in order. */
  scoped: Map<string, { needed: ReadonlySet<string>; stored: readonly BlobRef[] }>;
}

const plans = new WeakMap<LanguageState, { revision: number; plan: BlobPlan }>();

function planOf(state: LanguageState): BlobPlan {
  const revision = stateRevision(state);
  const hit = plans.get(state);
  if (hit && hit.revision === revision) return hit.plan;
  const refs = collectRefs(state);
  const order = new Map<string, number>();
  let n = 0;
  for (const hash of refs.keys()) order.set(hash, n++);
  const plan = { refs, order, idx: audioIndex(state, refs), scoped: new Map() };
  plans.set(state, { revision, plan });
  return plan;
}

/** Every blob the language references: recording cards and reference audio. Read-only: it is shared until the next change. */
export function referencedBlobs(state: LanguageState): ReadonlyMap<string, BlobRef> {
  return planOf(state).refs;
}

/** What a scope needs, worked out once per revision: the workers and the reclaimer ask with the same scope after every file. */
function forScope(state: LanguageState, plan: BlobPlan, scope: ReadonlySet<string>): { needed: ReadonlySet<string>; stored: readonly BlobRef[] } {
  const key = [...scope].sort().join('\n');
  let hit = plan.scoped.get(key);
  if (!hit) {
    const needed = scopedHashes(state, scope, plan);
    hit = { needed, stored: inOrder(plan, needed, (ref) => isStored(state, ref.hash)) };
    // A person has one scope at a time; a few cover the screens that ask about others.
    if (plan.scoped.size >= 4) plan.scoped.delete(plan.scoped.keys().next().value!);
    plan.scoped.set(key, hit);
  }
  return hit;
}

/** Refs for some files, in the order the language names them. */
function inOrder(plan: BlobPlan, hashes: Iterable<string>, keep: (ref: BlobRef) => boolean): BlobRef[] {
  const out: BlobRef[] = [];
  for (const hash of hashes) {
    const ref = plan.refs.get(hash);
    if (ref && keep(ref)) out.push(ref);
  }
  return out.sort((a, b) => plan.order.get(a.hash)! - plan.order.get(b.hash)!);
}

function collectRefs(state: LanguageState): Map<string, BlobRef> {
  const out = new Map<string, BlobRef>();
  // A voice note's format, as its recording device said (decisions.md 77).
  const voice = (hash: string): BlobRef['format'] => state.audioFormats[hash]?.value ?? 'm4a';
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
  // Only files on this phone can go up: look at those, not at every file the language names.
  return inOrder(planOf(state), present, (ref) => {
    const verdict = state.blobs[ref.hash];
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
  if (scope && scope.size === 0) return [];
  const plan = planOf(state);
  // A scope is a person's passages: look at their files, not at every file the language names.
  if (scope) return forScope(state, plan, scope).stored.filter((ref) => !present.has(ref.hash));
  return [...plan.refs.values()].filter((ref) => isStored(state, ref.hash) && !present.has(ref.hash));
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

function audioIndex(state: LanguageState, refs: ReadonlyMap<string, BlobRef>): AudioIndex {
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
function unitHashes(state: LanguageState, unitId: string, idx: AudioIndex, into = new Set<string>()): Set<string> {
  for (const hash of idx.own.get(unitId) ?? []) into.add(hash);
  for (const ancestor of unitAncestry(state, unitId)) for (const hash of idx.byScope.get(ancestor) ?? []) into.add(hash);
  return into;
}

/**
 * Every blob a set of units needs offline: their own audio plus the
 * reference audio, materials and key terms they inherit (rule 10).
 */
function scopedHashes(state: LanguageState, scope: ReadonlySet<string>, plan = planOf(state)): Set<string> {
  const needed = new Set<string>();
  if (scope.size === 0) return needed;
  for (const unitId of scope) unitHashes(state, unitId, plan.idx, needed);
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
    for (const r of Object.values(state.recordings)) if (r.actorId === actorId) units.add(r.unitId);
    for (const t of Object.values(state.takes)) if (t.actorId === actorId && t.unitId) units.add(t.unitId);
    hit.byActor.set(actorId, (scope = units));
  }
  return new Set(scope);
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
  const refs = referencedBlobs(state);
  const out: LostFilesView = { safe: 0, unsent: 0, unitIds: [] };
  const units = new Set<string>();
  for (const hash of hashes) {
    const ref = refs.get(hash);
    if (!ref) continue;
    if (isStored(state, hash)) { out.safe++; continue; }
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
  const plan = planOf(state);
  // Only a file on this phone can be deleted: look at those. Kept passages need theirs; a file
  // going up stays (a stored file goes up again only when its size here differs from the server's).
  const needed = scope ? (scope.size === 0 ? new Set<string>() : forScope(state, plan, scope).needed) : null;
  return inOrder(plan, present, (ref) => {
    const verdict = state.blobs[ref.hash];
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
  return countOffline(state, unitIds, present, chosen, planOf(state).idx, defaultOfflineScope(state, actorId), unitsAskedOf(state, actorId));
}

function countOffline(
  state: LanguageState,
  unitIds: Iterable<string>,
  present: ReadonlySet<string>,
  chosen: ReadonlySet<string>,
  idx: AudioIndex,
  mine: ReadonlySet<string>,
  asked: ReadonlySet<string>
): Map<string, UnitOffline> {
  // What the whole language shares is the same for every passage: count it once.
  const shared = new Set(idx.everywhere);
  const sharedCount = tally(state, shared, present);
  const out = new Map<string, UnitOffline>();
  for (const unitId of unitIds) {
    if (out.has(unitId)) continue;
    const reason: OfflineReason | null = asked.has(unitId) ? 'asked' : mine.has(unitId) ? 'worked' : chosen.has(unitId) ? 'chosen' : null;
    const own = unitHashes(state, unitId, idx);
    for (const hash of shared) own.delete(hash);
    const c = tally(state, own, present);
    const audio = own.size + shared.size;
    const toFetch = c.toFetch + sharedCount.toFetch;
    out.set(unitId, {
      reason, audio, here: c.here + sharedCount.here, toFetch, bytesToFetch: c.bytesToFetch + sharedCount.bytesToFetch,
      notSent: c.notSent + sharedCount.notSent, ready: reason !== null && toFetch === 0
    });
  }
  return out;
}

function tally(state: LanguageState, hashes: Iterable<string>, present: ReadonlySet<string>) {
  let here = 0;
  let toFetch = 0;
  let bytesToFetch = 0;
  let notSent = 0;
  for (const hash of hashes) {
    if (present.has(hash)) here++;
    else if (isStored(state, hash)) { toFetch++; bytesToFetch += state.blobs[hash]?.size ?? 0; }
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
  const plan = planOf(state);
  const idx = plan.idx;
  const mine = defaultOfflineScope(state, actorId);
  const scope = new Set(mine);
  for (const u of chosen) scope.add(u);
  const out: OfflineSummary = { kept: 0, ready: 0, chosen: 0, filesToFetch: 0, bytesToFetch: 0, notSent: 0 };
  // Per passage, so a file two passages share is counted under each; the totals below are by file.
  for (const u of countOffline(state, scope, present, chosen, idx, mine, unitsAskedOf(state, actorId)).values()) {
    out.kept++;
    if (u.ready) out.ready++;
    if (u.reason === 'chosen') out.chosen++;
  }
  for (const hash of scopedHashes(state, scope, plan)) {
    if (present.has(hash)) continue;
    if (isStored(state, hash)) { out.filesToFetch++; out.bytesToFetch += state.blobs[hash]?.size ?? 0; }
    else out.notSent++;
  }
  return out;
}
