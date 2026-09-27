import { deriveTasks } from './tasks';
import { unitAncestry } from './materials';
import type { ProjectState } from './state';

/**
 * Blob work lists, derived on every pass (PLAN.md section 14 rule 1).
 * There is no queue: a card referenced by the fold that the server has not
 * confirmed and that exists on this device IS the upload list.
 */

export interface BlobRef {
  hash: string;
  format: 'wav' | 'm4a' | 'jpg';
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
  for (const byId of Object.values(state.checks)) {
    for (const c of Object.values(byId)) {
      const h = c.value.commentBlobHash;
      if (h && !out.has(h)) out.set(h, { hash: h, format: 'm4a', unitId: c.value.unitId });
      for (const e of c.value.logged?.evidence ?? []) {
        if (!out.has(e.hash)) out.set(e.hash, { hash: e.hash, format: e.format ?? 'm4a', unitId: c.value.unitId });
      }
    }
  }
  for (const r of Object.values(state.produced)) {
    for (const c of r.value.cards) if (!out.has(c.hash)) out.set(c.hash, { hash: c.hash, format: c.format ?? 'm4a', unitId: r.value.unitId });
    const h = r.value.noteBlobHash;
    if (h && !out.has(h)) out.set(h, { hash: h, format: 'm4a', unitId: r.value.unitId });
  }
  for (const r of Object.values(state.contextItems)) {
    const c = r.value;
    const unitId = c.home.unitId ?? c.anchors.map((a) => ('unitId' in a ? a.unitId : undefined)).find((u) => u !== undefined) ?? '';
    if (c.blobHash && !out.has(c.blobHash)) out.set(c.blobHash, { hash: c.blobHash, format: 'm4a', unitId });
    if (c.photoHash && !out.has(c.photoHash)) out.set(c.photoHash, { hash: c.photoHash, format: 'jpg', unitId });
  }
  const keptVoices = Object.values(state.kept).filter((k) => k.value.reasonBlobHash);
  if (keptVoices.length > 0) {
    const checkUnit = new Map<string, string>();
    for (const byId of Object.values(state.checks)) for (const [id, c] of Object.entries(byId)) checkUnit.set(id, c.value.unitId);
    for (const k of keptVoices) {
      const h = k.value.reasonBlobHash!;
      const legacy = k.value.legacyTarget ? state.takes[k.value.legacyTarget.takeId]?.unitId : undefined;
      const unitId = (k.value.checkId !== undefined ? checkUnit.get(k.value.checkId) : undefined) ?? legacy ?? '';
      if (!out.has(h)) out.set(h, { hash: h, format: 'm4a', unitId });
    }
  }
  for (const r of Object.values(state.requests)) {
    const h = r.value.noteBlobHash;
    if (h && !out.has(h)) out.set(h, { hash: h, format: 'm4a', unitId: r.value.unitId });
  }
  for (const d of Object.values(state.departures)) {
    const h = d.value.reasonBlobHash;
    if (h && !out.has(h)) out.set(h, { hash: h, format: 'm4a', unitId: d.value.unitId });
  }
  for (const r of Object.values(state.obt.audio)) {
    for (const c of r.value.cards) out.set(c.hash, { hash: c.hash, format: c.format ?? 'm4a', unitId: r.value.unitId });
  }
  for (const r of Object.values(state.obt.interactions)) {
    if (r.value.photoHash) out.set(r.value.photoHash, { hash: r.value.photoHash, format: 'jpg', unitId: r.value.unitId });
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
  if (scope && scope.size === 0) return [];
  const refs = referencedBlobs(state);
  const needed = new Set<string>();
  if (scope) {
    // Preserve every directly scoped blob, including review comments and
    // responses, then add resources inherited by these passages.
    for (const ref of refs.values()) if (scope.has(ref.unitId)) needed.add(ref.hash);
    const lanesByUnit = new Map<string, Set<string>>();
    for (const item of [
      ...Object.values(state.assignments), ...Object.values(state.recordings),
      ...Object.values(state.takes)
    ]) {
      if (!scope.has(item.unitId)) continue;
      const lanes = lanesByUnit.get(item.unitId) ?? new Set<string>();
      lanes.add(item.laneId);
      lanesByUnit.set(item.unitId, lanes);
    }
    for (const unitId of scope) {
      const ancestors = unitAncestry(state, unitId);
      const lanes = lanesByUnit.get(unitId);
      // Explicit offline selection may precede assignment. In that case
      // resources for this unit in every lane remain available, as before.
      const laneMatches = (lane?: string) => !lane || !lanes || lanes.has(lane);
      for (const ref of Object.values(state.references)) {
        if (ref.blobHash && ancestors.has(ref.unitId)) needed.add(ref.blobHash);
      }
      for (const material of Object.values(state.materials)) {
        if (!laneMatches(material.scope.laneId)) continue;
        if (material.scope.unitId && !ancestors.has(material.scope.unitId)) continue;
        if (material.scope.stepId) continue;
        for (const field of Object.values(material.fields)) {
          if (field.value.blobHash) needed.add(field.value.blobHash);
        }
      }
      for (const term of Object.values(state.keyTerms)) {
        if (!laneMatches(term.laneId)) continue;
        if (term.unitScope.length && !term.unitScope.some((id) => ancestors.has(id))) continue;
        for (const adjustment of Object.values(term.adjustments)) {
          if (adjustment.blobHash) needed.add(adjustment.blobHash);
        }
      }
      // Notes on this passage, its book, or its whole language follow it offline.
      for (const item of Object.values(state.contextItems)) {
        const h = item.value.home;
        if (h.unitId ? !ancestors.has(h.unitId) : !laneMatches(h.laneId)) continue;
        if (item.value.blobHash) needed.add(item.value.blobHash);
        if (item.value.photoHash) needed.add(item.value.photoHash);
      }
    }
  }
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
 * The units a person needs offline by default: everything they are assigned
 * to, plus everything they have recorded or composed in. Explicit "keep
 * offline" choices are unioned in by the app.
 */
export function defaultOfflineScope(state: ProjectState, actorId: string): Set<string> {
  const scope = new Set<string>();
  if (Object.values(state.laneFlows).some(f => f.value.flowId === 'spoken_worldwide')) {
    for (const task of deriveTasks(state,actorId)) if (task.obtStage && !task.done) scope.add(task.unitId);
  }
  for (const a of Object.values(state.assignments)) if (a.profileId === actorId) scope.add(a.unitId);
  for (const r of Object.values(state.recordings)) if (r.actorId === actorId) scope.add(r.unitId);
  for (const t of Object.values(state.takes)) if (t.actorId === actorId && t.unitId) scope.add(t.unitId);
  return scope;
}

/** Referenced but neither confirmed nor present anywhere we can see: visibly missing. */
export function deriveMissingBlobs(state: ProjectState, present: ReadonlySet<string>): BlobRef[] {
  return [...referencedBlobs(state).values()].filter((r) => !isStored(state, r.hash) && !present.has(r.hash));
}

/**
 * Local files this device may delete to reclaim space: referenced by this
 * project, confirmed intact on the server (so they can come back), outside
 * the offline scope, and not upload work. Everything else is protected:
 * unsynced recordings, explicit offline selections, and files of other
 * projects (which this state cannot see, so it never names them).
 */
export function evictableBlobs(
  state: ProjectState,
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
