import type { ProjectState } from './state';

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

/** Every blob the project references: recording cards and reference audio. */
export function referencedBlobs(state: ProjectState): Map<string, BlobRef> {
  const out = new Map<string, BlobRef>();
  for (const r of Object.values(state.recordings)) {
    for (const c of r.cards) {
      if (!out.has(c.hash)) out.set(c.hash, { hash: c.hash, format: c.format ?? 'wav', unitId: r.unitId });
    }
  }
  for (const ref of Object.values(state.references)) {
    if (ref.blobHash && !out.has(ref.blobHash)) {
      out.set(ref.blobHash, { hash: ref.blobHash, format: 'm4a', unitId: ref.unitId });
    }
  }
  for (const m of Object.values(state.materials)) {
    const unitId = m.scope.unitId ?? '';
    for (const f of Object.values(m.fields)) if (f.value.blobHash && !out.has(f.value.blobHash)) out.set(f.value.blobHash, { hash: f.value.blobHash, format: 'm4a', unitId });
  }
  for (const t of Object.values(state.keyTerms)) {
    for (const a of Object.values(t.adjustments)) {
      const unitId = a.duringTakeId ? state.takes[a.duringTakeId]?.unitId ?? '' : '';
      if (a.blobHash && !out.has(a.blobHash)) out.set(a.blobHash, { hash: a.blobHash, format: 'm4a', unitId });
    }
  }
  for (const [takeId, r] of Object.entries(state.responses)) {
    const unitId = state.takes[takeId]?.unitId ?? '';
    if (r.blobHash && !out.has(r.blobHash)) out.set(r.blobHash, { hash: r.blobHash, format: 'm4a', unitId });
  }
  for (const [takeId, bySteps] of Object.entries(state.reviewComments)) {
    const unitId = state.takes[takeId]?.unitId ?? '';
    for (const byActor of Object.values(bySteps)) {
      for (const c of Object.values(byActor)) if (!out.has(c.blobHash)) out.set(c.blobHash, { hash: c.blobHash, format: 'm4a', unitId });
    }
  }
  return out;
}

/** The server's latest verdict says the bytes are there. */
export function isStored(state: ProjectState, hash: string): boolean {
  return state.blobs[hash]?.stored === true;
}

/**
 * Referenced, not confirmed intact, and present locally: upload these.
 * `localSizes`, when given, turns the confirmation's size into an integrity
 * check: a confirmed blob whose stored size differs from the file we have
 * did not land intact and is uploaded again (idempotent overwrite).
 */
export function deriveUploadWork(
  state: ProjectState,
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
  state: ProjectState,
  present: ReadonlySet<string>,
  scope: ReadonlySet<string> | null = null
): BlobRef[] {
  const out: BlobRef[] = [];
  for (const ref of referencedBlobs(state).values()) {
    if (!isStored(state, ref.hash)) continue;
    if (present.has(ref.hash)) continue;
    if (scope && !scope.has(ref.unitId)) continue;
    out.push(ref);
  }
  return out;
}

/**
 * The units a person needs offline by default: everything they are assigned
 * to, plus everything they have recorded or composed in. Explicit "keep
 * offline" choices are unioned in by the app.
 */
export function defaultOfflineScope(state: ProjectState, actorId: string): Set<string> {
  const scope = new Set<string>();
  for (const a of Object.values(state.assignments)) if (a.profileId === actorId) scope.add(a.unitId);
  for (const r of Object.values(state.recordings)) if (r.actorId === actorId) scope.add(r.unitId);
  for (const t of Object.values(state.takes)) if (t.actorId === actorId && t.unitId) scope.add(t.unitId);
  return scope;
}

/** Referenced but neither confirmed nor present anywhere we can see: visibly missing. */
export function deriveMissingBlobs(state: ProjectState, present: ReadonlySet<string>): BlobRef[] {
  return [...referencedBlobs(state).values()].filter((r) => !isStored(state, r.hash) && !present.has(r.hash));
}
