// Fetching a team's guide file into the blob store (study@2): from the organization's guide files
// (`<org>/_org/<hash>.<ext>`, where the guide editor puts them). Shared by a guide's screen
// (useStudyFileUri.ts) and the download ahead for kept passages (guideFilesAhead.ts).
import { ORG_STREAM } from '@langquest-next/core';
import type { BlobStore } from '../sync/blobs';
import type { StoredFile } from '../storage/storedFile';
import { downloadBlob } from '../server/blobTransport';
import { timedTransfer } from '../diagnostics/diagnostics';
import { noteLibraryFiles } from '../library/libraryOrigins';

/** Downloads under way, by hash, so two screens asking for one file fetch it once. */
const inflight = new Map<string, Promise<void>>();
/** Hashes that could not be fetched, and when: tried again after a minute. */
const failedAt = new Map<string, number>();
const RETRY_MS = 60_000;

/** Fetch a guide file into the blob store from the organization's guide files, tallied as a `guide` download of the organization. */
export function fetchGuideFile(orgId: string, ref: StoredFile, store: BlobStore): Promise<void> {
  const last = failedAt.get(ref.hash);
  if (last && Date.now() - last < RETRY_MS) return Promise.reject(new Error('Not available yet.'));
  let p = inflight.get(ref.hash);
  if (!p) {
    p = timedTransfer('down', { orgId, streamId: ORG_STREAM, src: 'guide' }, async (timings) => {
      await downloadBlob(orgId, ORG_STREAM, ref, store, timings);
      // From the organization's guide files: a teammate may be given it as a library file.
      noteLibraryFiles([ref.hash]);
      return store.sizeOf(ref.hash) ?? 0;
    })
      .then(() => undefined)
      .catch((e: unknown) => { failedAt.set(ref.hash, Date.now()); throw e; })
      .finally(() => inflight.delete(ref.hash));
    inflight.set(ref.hash, p);
  }
  return p;
}
