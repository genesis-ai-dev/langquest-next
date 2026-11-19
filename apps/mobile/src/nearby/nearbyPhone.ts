import type { LanguageSessionOptions, SyncClientOptions } from '@langquest-next/sync';
import type { BlobStore } from '../sync/blobs';

/**
 * A language client's nearby half (docs/nearby-sync-plan.md 5.12, `nearbyClient`). Only a phone
 * passes one (nearbyPhone.native.ts, Android and iPhones): the web shares nothing nearby (decision
 * 58), so here there is none and the nearby entries stay out of this bundle.
 */
export async function nearbyMakerFor(_orgId: string, _actorId: string): Promise<SyncClientOptions['nearby']> {
  return undefined;
}

/** What a language session takes for teammates' files over a nearby link (docs/nearby-sync-plan.md 5.6). */
export type NearbyFilesOptions = Pick<LanguageSessionOptions, 'fetchFile' | 'nearbyFiles' | 'holdChoice' | 'mayUpload'>;

/**
 * A language session's nearby files. Only a phone has any: here, on the web, no file is ever marked as
 * a teammate's, and every file here counts as this person's, as it always has.
 */
export async function nearbyFilesFor(_orgId: string, _actorId: string, _languageId: string, _files: BlobStore): Promise<NearbyFilesOptions> {
  return {};
}
