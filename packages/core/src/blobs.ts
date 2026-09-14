import type { ProjectState } from './state';

/**
 * Blob work lists, derived on every pass (PLAN.md section 14 rule 1).
 * There is no queue: a card referenced by the fold that the server has not
 * confirmed and that exists on this device IS the upload list.
 */

export interface BlobRef {
  hash: string;
  format: 'wav' | 'm4a';
}

/** Every card hash the project references, with its container. */
export function referencedBlobs(state: ProjectState): Map<string, BlobRef> {
  const out = new Map<string, BlobRef>();
  for (const r of Object.values(state.recordings)) {
    for (const c of r.cards) out.set(c.hash, { hash: c.hash, format: c.format ?? 'wav' });
  }
  return out;
}

/** Referenced, not confirmed, and present locally: upload these. */
export function deriveUploadWork(state: ProjectState, present: ReadonlySet<string>): BlobRef[] {
  const out: BlobRef[] = [];
  for (const ref of referencedBlobs(state).values()) {
    if (state.blobs[ref.hash]) continue;
    if (!present.has(ref.hash)) continue;
    out.push(ref);
  }
  return out;
}

/** Confirmed on the server and missing locally: download these. */
export function deriveDownloadWork(state: ProjectState, present: ReadonlySet<string>): BlobRef[] {
  const out: BlobRef[] = [];
  for (const ref of referencedBlobs(state).values()) {
    if (!state.blobs[ref.hash]) continue;
    if (present.has(ref.hash)) continue;
    out.push(ref);
  }
  return out;
}

/** Referenced but neither confirmed nor present anywhere we can see: visibly missing. */
export function deriveMissingBlobs(state: ProjectState, present: ReadonlySet<string>): BlobRef[] {
  return [...referencedBlobs(state).values()].filter((r) => !state.blobs[r.hash] && !present.has(r.hash));
}
