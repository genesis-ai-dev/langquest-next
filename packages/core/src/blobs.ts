import type { EventPayloads, EventType } from './events';
import { unitAncestry } from './materials';
import { unitsAskedOf } from './passage';
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
 * otherwise (decisions.md 75). Every field `referencedBlobs` reads as a
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

/** Every blob the language references: recording cards and reference audio. */
export function referencedBlobs(state: LanguageState): Map<string, BlobRef> {
  const out = new Map<string, BlobRef>();
  // A voice note's format, as its recording device said (decisions.md 75).
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
  // (75), artifacts carry their format.
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
  const out: BlobRef[] = [];
  for (const ref of referencedBlobs(state).values()) {
    if (!present.has(ref.hash)) continue;
    const verdict = state.blobs[ref.hash];
    if (verdict?.stored) {
      const local = localSizes?.get(ref.hash);
      if (local === undefined || local === verdict.size) continue;
    }
    out.push(ref);
  }
  return out;
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
  const refs = referencedBlobs(state);
  const needed = scope ? scopedHashes(state, scope, refs) : new Set<string>();
  const out: BlobRef[] = [];
  for (const ref of refs.values()) {
    if (scope && !needed.has(ref.hash)) continue;
    if (!isStored(state, ref.hash)) continue;
    if (present.has(ref.hash)) continue;
    out.push(ref);
  }
  return out;
}

/**
 * Every blob a set of units needs offline: their own audio plus the
 * reference audio, materials and key terms they inherit (rule 10).
 */
function scopedHashes(state: LanguageState, scope: ReadonlySet<string>, refs = referencedBlobs(state)): Set<string> {
  const needed = new Set<string>();
  // Preserve every directly scoped blob, including feedback and responses,
  // then add resources inherited by these passages.
  for (const ref of refs.values()) if (scope.has(ref.unitId)) needed.add(ref.hash);
  for (const unitId of scope) {
    const ancestors = unitAncestry(state, unitId);
    for (const material of Object.values(state.materials)) {
      if (material.scope.unitId && !ancestors.has(material.scope.unitId)) continue;
      if (material.scope.stepId) continue;
      for (const field of Object.values(material.fields)) {
        if (field.value.blobHash) needed.add(field.value.blobHash);
      }
    }
    for (const term of Object.values(state.keyTerms)) {
      if (term.unitScope.length && !term.unitScope.some((id) => ancestors.has(id))) continue;
      for (const adjustment of Object.values(term.adjustments)) {
        if (adjustment.blobHash) needed.add(adjustment.blobHash);
      }
    }
  }
  return needed;
}

/**
 * The units a person needs offline by default: everything they are asked to
 * record or review, plus everything they have recorded or composed in.
 * Explicit "keep offline" choices are unioned in by the app.
 */
export function defaultOfflineScope(state: LanguageState, actorId: string): Set<string> {
  const scope = unitsAskedOf(state, actorId);
  for (const r of Object.values(state.recordings)) if (r.actorId === actorId) scope.add(r.unitId);
  for (const t of Object.values(state.takes)) if (t.actorId === actorId && t.unitId) scope.add(t.unitId);
  return scope;
}

/** Referenced but neither confirmed nor present anywhere we can see: visibly missing. */
export function deriveMissingBlobs(state: LanguageState, present: ReadonlySet<string>): BlobRef[] {
  return [...referencedBlobs(state).values()].filter((r) => !isStored(state, r.hash) && !present.has(r.hash));
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
  const needed = new Set(deriveDownloadWork(state, new Set(), scope).map((r) => r.hash));
  const uploading = new Set(deriveUploadWork(state, present, localSizes).map((r) => r.hash));
  const out: BlobRef[] = [];
  for (const ref of referencedBlobs(state).values()) {
    if (!present.has(ref.hash) || !isStored(state, ref.hash)) continue;
    if (needed.has(ref.hash) || uploading.has(ref.hash)) continue;
    out.push(ref);
  }
  return out;
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
  const refs = referencedBlobs(state);
  const mine = defaultOfflineScope(state, actorId);
  const asked = unitsAskedOf(state, actorId);
  const out = new Map<string, UnitOffline>();
  for (const unitId of unitIds) {
    if (out.has(unitId)) continue;
    const reason: OfflineReason | null = asked.has(unitId) ? 'asked' : mine.has(unitId) ? 'worked' : chosen.has(unitId) ? 'chosen' : null;
    out.set(unitId, countUnit(state, unitId, reason, present, refs));
  }
  return out;
}

function countUnit(state: LanguageState, unitId: string, reason: OfflineReason | null, present: ReadonlySet<string>, refs: Map<string, BlobRef>): UnitOffline {
  let here = 0;
  let toFetch = 0;
  let bytesToFetch = 0;
  let notSent = 0;
  const hashes = scopedHashes(state, new Set([unitId]), refs);
  for (const hash of hashes) {
    if (present.has(hash)) here++;
    else if (isStored(state, hash)) { toFetch++; bytesToFetch += state.blobs[hash]?.size ?? 0; }
    else notSent++;
  }
  return { reason, audio: hashes.size, here, toFetch, bytesToFetch, notSent, ready: reason !== null && toFetch === 0 };
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
  const scope = defaultOfflineScope(state, actorId);
  for (const u of chosen) scope.add(u);
  const out: OfflineSummary = { kept: 0, ready: 0, chosen: 0, filesToFetch: 0, bytesToFetch: 0, notSent: 0 };
  // Per passage, so a file two passages share is counted under each; the totals below are by file.
  for (const u of offlineByUnit(state, scope, present, actorId, chosen).values()) {
    out.kept++;
    if (u.ready) out.ready++;
    if (u.reason === 'chosen') out.chosen++;
  }
  for (const hash of scopedHashes(state, scope)) {
    if (present.has(hash)) continue;
    if (isStored(state, hash)) { out.filesToFetch++; out.bytesToFetch += state.blobs[hash]?.size ?? 0; }
    else out.notSent++;
  }
  return out;
}
