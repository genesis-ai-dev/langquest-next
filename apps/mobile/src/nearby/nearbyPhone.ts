import type { SyncClientOptions } from '@langquest-next/sync';

/**
 * A language client's nearby half (docs/nearby-sync-plan.md 5.12, `nearbyClient`). Only the
 * Android app passes one (nearbyPhone.android.ts): the web shares nothing nearby (decision 58)
 * and iPhones come in a later phase, so here there is none and the nearby entries stay out of
 * this bundle.
 */
export async function nearbyMakerFor(_orgId: string, _actorId: string): Promise<SyncClientOptions['nearby']> {
  return undefined;
}
